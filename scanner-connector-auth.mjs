import {parseScanContext} from './scan-batch-context.mjs';
import {randomBytes} from 'node:crypto';
const ONLINE='https://pulse-ll.cmll.in',LOCAL='http://127.0.0.1:4174';
export async function redeemScannerTicket(fetchOnline,payload,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;attempt<2;attempt++){
  try{return await fetchOnline(ONLINE+'/api/scanner-connector/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});}
  catch(error){
   // A connect timeout occurs before the one-use ticket reaches the server.
   // Never replay a request whose authorization may already have been consumed.
   if(attempt===0&&error?.cause?.code==='UND_ERR_CONNECT_TIMEOUT'){await sleep(1000);continue;}
   throw error;
  }
 }
}
export function registerScannerConnectorAuth(app,{pool,requireSession,requireAdministrator,localEnabled=false,fetchOnline=fetch}){
 const tickets=new Map(),connections=new Map();
 const prune=()=>{for(const map of [tickets,connections])for(const [key,value]of map)if(value.expires<Date.now())map.delete(key)};
 app.post('/api/scanner-connector/ticket',requireSession,requireAdministrator,(req,res)=>{
  prune();const {nonce,kind}=req.body;
  if(!/^[a-f0-9-]{36}$/i.test(nonce||'')||!['vehicle','equipment'].includes(kind))return res.status(400).json({error:'Invalid scanner connection.'});
  let expectedContext;try{expectedContext=parseScanContext(req.body.expectedContext)}catch(e){return res.status(400).json({error:e.message})}const ticket=randomBytes(32).toString('hex');tickets.set(ticket,{nonce,kind,expectedContext,expires:Date.now()+120000});res.set('Cache-Control','no-store').json({ticket});
 });
 app.post('/api/scanner-connector/redeem',(req,res)=>{
  prune();const record=tickets.get(req.body.ticket);tickets.delete(req.body.ticket);
  if(!record||record.nonce!==req.body.nonce||record.kind!==req.body.kind)return res.status(401).json({error:'Scanner connection expired. Reconnect from online MIS.'});
  res.set('Cache-Control','no-store').json({authorized:true,nonce:record.nonce,kind:record.kind,expectedContext:record.expectedContext});
 });
 const loopback=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&['127.0.0.1:4174','127.0.0.1:4175'].includes(req.headers.host)&&(!req.headers.origin||req.headers.origin===LOCAL)&&req.headers['x-caliber-scanner']==='1';
 app.post('/api/scanner-connector/connect',async(req,res,next)=>{try{
  if(!localEnabled||!loopback(req))return res.status(403).json({error:'Scanner connection is available only on this PC.'});
  const {ticket,nonce,kind}=req.body;if(!/^[a-f0-9]{64}$/.test(ticket||'')||!/^[a-f0-9-]{36}$/i.test(nonce||'')||!['vehicle','equipment'].includes(kind))return res.status(400).json({error:'Reconnect using Connect PC scanner in online MIS.'});
  let response,proof;try{response=await redeemScannerTicket(fetchOnline,{ticket,nonce,kind});if(response.status>=500){await response.body?.cancel?.();return res.status(503).json({error:'Pulse-II is temporarily unavailable. Close this window and reconnect from online MIS.'});}proof=await response.json();}catch{return res.status(503).json({error:'This PC could not reach Pulse-II. Check the internet connection, then close this window and click Connect PC scanner again. Your saved scans remain on this PC.'});}
  if(!response.ok||!proof.authorized||proof.nonce!==nonce||proof.kind!==kind)return res.status(401).json({error:'Online scanner authorization expired. Reconnect from MIS.'});
  let expectedContext;try{expectedContext=parseScanContext(proof.expectedContext)}catch{return res.status(401).json({error:'Select the card date, site and shift in online MIS, then reconnect the scanner.'})}prune();const token='scanner_'+randomBytes(32).toString('hex');connections.set(token,{kind,expectedContext,actor:'pc-scanner:'+randomBytes(16).toString('hex'),expires:Date.now()+2*60*60*1000});res.set('Cache-Control','no-store').json({token});
 }catch(e){next(e)}});
 return {async authenticate(req){
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');if(!token.startsWith('scanner_'))return null;
  prune();const record=connections.get(token);if(!localEnabled||!loopback(req)||!record)throw Object.assign(new Error('Reconnect the PC scanner from online MIS.'),{status:401});
  const path=req.path,read=req.method==='GET';let allowed=read&&path==='/api/local-scanner/status';
  if(req.method==='POST'&&/^\/api\/local-scanner\/(capture|folder|files)$/.test(path)){allowed=req.body.kind===record.kind;if(allowed)req.body.expectedContext={...record.expectedContext};}
  let match;if(read&&(match=path.match(/^\/api\/local-scanner\/jobs\/([a-f0-9-]{36})(?:\/pdf)?$/i)))allowed=Boolean((await pool.query('SELECT id FROM local_scan_jobs WHERE id=$1 AND created_by=$2',[match[1],record.actor])).rows[0]);
  if(read&&(match=path.match(/^\/api\/scan-batches\/([a-f0-9-]{36})$/i)))allowed=Boolean((await pool.query('SELECT b.id FROM mis_scan_batches b WHERE b.id=$1 AND (b.created_by=$2 OR EXISTS(SELECT 1 FROM local_scan_jobs j WHERE j.batch_id=b.id AND j.created_by=$2))',[match[1],record.actor])).rows[0]);
  if(read&&(match=path.match(/^\/api\/scan-cards\/([a-f0-9-]{36})\/image$/i)))allowed=Boolean((await pool.query('SELECT c.id FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id WHERE c.id=$1 AND (b.created_by=$2 OR EXISTS(SELECT 1 FROM local_scan_jobs j WHERE j.batch_id=b.id AND j.created_by=$2))',[match[1],record.actor])).rows[0]);
  if(!allowed)throw Object.assign(new Error('Scanner connection cannot access this operation.'),{status:403});
  return {role:'super',permissions:{adminLevel:'Admin'},login:record.actor,name:'PC scanner connector'};
 }};
}
