// Private test gate: locks a whole Pulse-II copy to one owner.
//
// A visitor must type the gate password, then a one-time code that is sent by
// Telegram to the owner's chat only. Nobody else in the organisation can pass,
// because the code never reaches them. Only /api/health stays open, so the
// deploy workflow can confirm which commit is running.
//
// Switched on with PRIVATE_GATE=on. Every other variable is read only then:
//   PRIVATE_GATE_PASSWORD_HASH        scrypt:<salt>:<hash> from scripts/private-gate-password.mjs
//   PRIVATE_GATE_SECRET               long random string; signs the gate cookie
//   PRIVATE_GATE_TELEGRAM_BOT_TOKEN   bot that sends the code (may be the production bot's token;
//                                     a separate name keeps this copy from taking the live webhook)
//   PRIVATE_GATE_TELEGRAM_CHAT_ID     owner's Telegram chat id, or
//   PRIVATE_GATE_OWNER_LOGIN          owner's Pulse-II login, looked up in the Telegram links table
//   PRIVATE_GATE_LABEL                optional heading on the gate page
// When switched on but incomplete the gate fails closed: every page answers 503.
import {createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {verifyPassword} from './password-auth.mjs';

const COOKIE='pulse_private_gate';
const GATE_PATH='/__private-gate';
const SESSION_MS=12*60*60*1000;
const OTP_MS=10*60*1000;
const OTP_ATTEMPTS=5;
const OTP_RESEND_MS=60*1000;
const PASSWORD_WINDOW_MS=15*60*1000;
const PASSWORD_ATTEMPTS_PER_IP=5;
const PASSWORD_ATTEMPTS_TOTAL=20;
const OPEN_PATHS=new Set(['/api/health']);

const text=value=>String(value??'').trim();

export function privateGateEnabled(env=process.env){
  return ['on','true','1','yes'].includes(text(env.PRIVATE_GATE).toLowerCase());
}

export function privateGateConfig(env=process.env){
  const config={
    enabled:privateGateEnabled(env),
    passwordHash:text(env.PRIVATE_GATE_PASSWORD_HASH),
    secret:text(env.PRIVATE_GATE_SECRET),
    botToken:text(env.PRIVATE_GATE_TELEGRAM_BOT_TOKEN),
    chatId:text(env.PRIVATE_GATE_TELEGRAM_CHAT_ID),
    ownerLogin:text(env.PRIVATE_GATE_OWNER_LOGIN).toLowerCase(),
    label:text(env.PRIVATE_GATE_LABEL)||'Pulse-II private test',
  };
  const missing=[];
  if(!config.passwordHash.startsWith('scrypt:'))missing.push('PRIVATE_GATE_PASSWORD_HASH');
  if(config.secret.length<32)missing.push('PRIVATE_GATE_SECRET (at least 32 characters)');
  if(!config.botToken)missing.push('PRIVATE_GATE_TELEGRAM_BOT_TOKEN');
  if(config.chatId&&!/^-?\d+$/.test(config.chatId))missing.push('PRIVATE_GATE_TELEGRAM_CHAT_ID (digits only)');
  if(!config.chatId&&!config.ownerLogin)missing.push('PRIVATE_GATE_TELEGRAM_CHAT_ID or PRIVATE_GATE_OWNER_LOGIN');
  return {...config,missing};
}

const sign=(config,payload)=>createHmac('sha256',`${config.secret}|${config.passwordHash}`).update(payload).digest('base64url');

export function issueGateToken(config,nowMs=Date.now()){
  const payload=`v1.${nowMs+SESSION_MS}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(config,payload)}`;
}

export function gateTokenValid(config,token,nowMs=Date.now()){
  const parts=text(token).split('.');
  if(parts.length!==4||parts[0]!=='v1')return false;
  const payload=parts.slice(0,3).join('.');
  const expected=Buffer.from(sign(config,payload)),actual=Buffer.from(parts[3]);
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return false;
  return Number(parts[1])>nowMs;
}

const readCookie=(req,name)=>{
  for(const part of String(req.headers.cookie||'').split(';')){
    const index=part.indexOf('=');
    if(index>0&&part.slice(0,index).trim()===name)return decodeURIComponent(part.slice(index+1).trim());
  }
  return '';
};

const readJson=req=>new Promise((resolve)=>{
  if(req.body&&typeof req.body==='object')return resolve(req.body);
  let raw='';
  req.setEncoding('utf8');
  req.on('data',chunk=>{raw+=chunk;if(raw.length>4096)req.destroy();});
  req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch{resolve({});}});
  req.on('error',()=>resolve({}));
});

const otpHash=(config,challengeId,code)=>createHmac('sha256',config.secret).update(`${challengeId}|${code}`).digest();

async function telegramSend(config,chatId,message,fetchImpl){
  const response=await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text:message,disable_web_page_preview:true}),
    signal:AbortSignal.timeout(10000),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false)throw new Error(data.description||`Telegram answered HTTP ${response.status}`);
}

async function ownerChatId(config,pool){
  if(config.chatId)return config.chatId;
  if(!pool)return '';
  for(const sql of [
    'SELECT chat_id FROM mis_telegram_links WHERE lower(login_name)=$1 LIMIT 1',
    'SELECT chat_id FROM telegram_user_links WHERE lower(login)=$1 LIMIT 1',
  ]){
    try{const {rows}=await pool.query(sql,[config.ownerLogin]);if(rows[0]?.chat_id)return text(rows[0].chat_id);}catch{}
  }
  return '';
}

const escapeHtml=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function gatePage(label){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(label)}</title><style>
:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:"Segoe UI",Arial,sans-serif;background:#0b3d6e}
main{background:#fff;color:#1d2433;width:min(380px,calc(100% - 32px));padding:28px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25)}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 18px;color:#55607a;font-size:14px}label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input{width:100%;box-sizing:border-box;font-size:16px;padding:10px;border:1px solid #c3cddb;border-radius:8px;margin-bottom:14px}
button{width:100%;font-size:15px;padding:11px;border:0;border-radius:8px;background:#0b3d6e;color:#fff;cursor:pointer}button:disabled{opacity:.6}
#msg{min-height:20px;font-size:13px;margin-top:12px;color:#b42318}#msg.ok{color:#067647}[hidden]{display:none}</style></head><body><main>
<h1>${escapeHtml(label)}</h1><p>Private test copy. Access needs the password and a code sent by Telegram to the owner.</p>
<form id="pw"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required autofocus><button>Send Telegram code</button></form>
<form id="otp" hidden><label for="code">6-digit code from Telegram</label><input id="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required><button>Open test copy</button></form>
<div id="msg" role="status"></div></main><script>
const msg=document.getElementById('msg');let challenge='';
const post=async(path,body)=>{const r=await fetch('${GATE_PATH}/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});return {ok:r.ok,data:await r.json().catch(()=>({}))};};
const say=(t,ok)=>{msg.textContent=t;msg.className=ok?'ok':'';};
document.getElementById('pw').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;
 const r=await post('password',{password:document.getElementById('password').value});b.disabled=false;
 if(!r.ok)return say(r.data.error||'Could not send the code.');challenge=r.data.challengeId;
 document.getElementById('pw').hidden=true;document.getElementById('otp').hidden=false;document.getElementById('code').focus();say(r.data.message,true);};
document.getElementById('otp').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;
 const r=await post('otp',{challengeId:challenge,code:document.getElementById('code').value});b.disabled=false;
 if(!r.ok){if(r.data.restart){document.getElementById('otp').hidden=true;document.getElementById('pw').hidden=false;}return say(r.data.error||'Code not accepted.');}
 const next=new URLSearchParams(location.search).get('next')||'/';location.replace(next.startsWith('/')&&!next.startsWith('//')?next:'/');};
</script></body></html>`;
}

export function createPrivateGate({env=process.env,pool=null,fetchImpl=fetch,now=()=>Date.now(),log=console}={}){
  const config=privateGateConfig(env);
  const challenges=new Map();
  const passwordFailures=[];
  let lastSentAt=0;

  const recentFailures=(ip,nowMs)=>{
    while(passwordFailures.length&&passwordFailures[0].at<nowMs-PASSWORD_WINDOW_MS)passwordFailures.shift();
    return {ip:passwordFailures.filter(f=>f.ip===ip).length,total:passwordFailures.length};
  };

  const secureCookie=req=>req.secure||text(req.headers['x-forwarded-proto']).startsWith('https');

  async function handlePassword(req,res){
    const nowMs=now(),ip=text(req.ip||req.socket?.remoteAddress);
    const failures=recentFailures(ip,nowMs);
    if(failures.ip>=PASSWORD_ATTEMPTS_PER_IP||failures.total>=PASSWORD_ATTEMPTS_TOTAL)
      return res.status(429).json({error:'Too many wrong passwords. Wait 15 minutes and try again.'});
    const body=await readJson(req);
    if(!verifyPassword(text(body.password),config.passwordHash)){
      passwordFailures.push({ip,at:nowMs});
      return res.status(401).json({error:'Wrong password.'});
    }
    if(nowMs-lastSentAt<OTP_RESEND_MS)
      return res.status(429).json({error:`A code was sent less than a minute ago. Wait ${Math.ceil((OTP_RESEND_MS-(nowMs-lastSentAt))/1000)} seconds.`});
    const chatId=await ownerChatId(config,pool);
    if(!chatId)return res.status(503).json({error:'The owner Telegram chat is not configured on this test copy.'});
    const challengeId=randomBytes(16).toString('base64url');
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    try{
      await telegramSend(config,chatId,`${config.label} sign-in code: ${code}\nValid for 10 minutes. Requested from ${ip||'unknown address'}.\nIf this was not you, change PRIVATE_GATE_PASSWORD_HASH.`,fetchImpl);
    }catch(error){
      log.error?.('Private gate could not send the Telegram code.',error.message);
      return res.status(502).json({error:'Telegram did not accept the code. Nothing was sent; try again shortly.'});
    }
    lastSentAt=nowMs;
    for(const [id,item] of challenges)if(item.expiresAt<nowMs)challenges.delete(id);
    challenges.set(challengeId,{hash:otpHash(config,challengeId,code),expiresAt:nowMs+OTP_MS,attempts:0});
    return res.json({challengeId,message:'Code sent to the owner on Telegram. It is valid for 10 minutes.'});
  }

  async function handleOtp(req,res){
    const nowMs=now(),body=await readJson(req);
    const challengeId=text(body.challengeId),code=text(body.code);
    const item=challenges.get(challengeId);
    if(!item||item.expiresAt<nowMs){challenges.delete(challengeId);return res.status(401).json({error:'The code has expired. Enter the password again.',restart:true});}
    item.attempts+=1;
    const actual=otpHash(config,challengeId,code);
    if(!/^\d{6}$/.test(code)||!timingSafeEqual(item.hash,actual)){
      if(item.attempts>=OTP_ATTEMPTS){challenges.delete(challengeId);return res.status(401).json({error:'Too many wrong codes. Enter the password again.',restart:true});}
      return res.status(401).json({error:`Wrong code. ${OTP_ATTEMPTS-item.attempts} attempts left.`});
    }
    challenges.delete(challengeId);
    res.cookie?.(COOKIE,issueGateToken(config,nowMs),{httpOnly:true,secure:secureCookie(req),sameSite:'lax',maxAge:SESSION_MS,path:'/'});
    return res.json({ok:true});
  }

  function middleware(req,res,next){
    if(!config.enabled)return next();
    if(OPEN_PATHS.has(req.path))return next();
    res.set('X-Robots-Tag','noindex, nofollow');
    if(config.missing.length){
      if(req.path===GATE_PATH||!req.path.startsWith('/api/'))return res.status(503).type('text').send(`This private test copy is locked because its gate is not configured. Missing: ${config.missing.join(', ')}.`);
      return res.status(503).json({error:'Private test gate is not configured.'});
    }
    if(req.path===GATE_PATH&&req.method==='GET'){res.set('Cache-Control','no-store');return res.type('html').send(gatePage(config.label));}
    if(req.path===`${GATE_PATH}/password`&&req.method==='POST')return void handlePassword(req,res).catch(next);
    if(req.path===`${GATE_PATH}/otp`&&req.method==='POST')return void handleOtp(req,res).catch(next);
    if(req.path===`${GATE_PATH}/logout`){res.clearCookie?.(COOKIE,{path:'/'});return res.redirect(302,GATE_PATH);}
    if(gateTokenValid(config,readCookie(req,COOKIE),now()))return next();
    if(req.path.startsWith('/api/'))return res.status(401).json({error:'Private test copy. Open the site and pass the gate first.'});
    if(req.method!=='GET'&&req.method!=='HEAD')return res.status(401).type('text').send('Private test copy.');
    return res.redirect(302,`${GATE_PATH}?next=${encodeURIComponent(req.originalUrl||'/')}`);
  }

  if(config.enabled)log.log?.(config.missing.length?`Private test gate ON but incomplete; every page is locked. Missing: ${config.missing.join(', ')}.`:`Private test gate ON (${config.label}).`);
  return {config,middleware};
}
