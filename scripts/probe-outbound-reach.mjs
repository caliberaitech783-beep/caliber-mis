// Read-only: can the live MIS server reach an outside service? Runs a small Node check on the
// production deployment host (same outbound network as the app): DNS answers, a TCP connect to each
// IPv4 and IPv6 address on 443, and one HTTPS request, for Telegram and for Google as a control.
// 15 Nov 2026: saving the MIS Telegram bot waited 15 s and gave up while Gemini calls worked.
import {execFileSync} from 'node:child_process';

const az = args => execFileSync('az', args, {encoding: 'utf8', timeout: 60000}).trim();
const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
const hosts = JSON.parse(az(['webapp', 'show', '-g', 'coalmine-fleet-maintenance-rg', '-n', 'caliber-mis-783', '--query', 'enabledHostNames', '-o', 'json']));
const scm = hosts.find(value => /^caliber-mis-783[a-z0-9-]*\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(value));
if (!scm) throw Error('Azure did not return the production deployment hostname.');

const code = `
const dns=require('node:dns').promises,net=require('node:net');
const connect=(address,family)=>new Promise(done=>{const t0=Date.now();const s=net.connect({host:address,port:443,family});
 const end=r=>{s.destroy();done({address,family,...r,ms:Date.now()-t0})};s.setTimeout(8000,()=>end({ok:false,error:'timeout'}));
 s.once('connect',()=>end({ok:true}));s.once('error',e=>end({ok:false,error:e.code||e.message}))});
(async()=>{const out={node:process.version};
 for(const host of ['api.telegram.org','generativelanguage.googleapis.com']){
  const r={};try{r.v4=(await dns.resolve4(host))}catch(e){r.v4=e.code}try{r.v6=(await dns.resolve6(host))}catch(e){r.v6=e.code}
  try{r.lookup=(await dns.lookup(host,{all:true})).map(a=>a.family)}catch(e){r.lookup=e.code}
  r.connect=[];for(const a of (Array.isArray(r.v4)?r.v4.slice(0,2):[]))r.connect.push(await connect(a,4));
  for(const a of (Array.isArray(r.v6)?r.v6.slice(0,1):[]))r.connect.push(await connect(a,6));
  const t0=Date.now();try{const res=await fetch('https://'+host+'/',{signal:AbortSignal.timeout(15000)});r.fetch={status:res.status,ms:Date.now()-t0}}
  catch(e){r.fetch={error:(e.cause&&(e.cause.code||e.cause.message))||e.name,ms:Date.now()-t0}}
  out[host]=r;}
 console.log(JSON.stringify(out,null,1));})();`;

const encoded = Buffer.from(code).toString('base64');
const response = await fetch(`https://${scm}/api/command`, {
  method: 'POST',
  headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
  body: JSON.stringify({command: `node -e "eval(Buffer.from('${encoded}','base64').toString())"`, dir: '/home'}),
  signal: AbortSignal.timeout(120000),
});
if (!response.ok) throw Error('The deployment host refused the check (HTTP ' + response.status + ').');
const {Output, Error: stderr, ExitCode} = await response.json();
console.log(Output || '');
if (ExitCode !== 0) console.log('::warning::Check exited ' + ExitCode + ': ' + String(stderr || '').slice(0, 500));
