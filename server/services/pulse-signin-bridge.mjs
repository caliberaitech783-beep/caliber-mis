// Reuse the server-held login grant. Passwords are neither copied nor stored.
export function createPulseSignInBridge({pool,fetchImpl=fetch}){
 let connected=false,timer;
 // menu: only a sign-in whose MIS menus include it (the background breakdown copy needs
 // 'Pulse Master Sync', because Pulse gives the whole list only to that menu).
 const rows=async(actor,menu=null)=>{const result=await pool.query(`SELECT c.grant_token FROM mis_credential_sessions c JOIN auth_sessions s ON s.token=c.session_token
  WHERE s.created_at>NOW()-CASE WHEN c.remembered THEN INTERVAL '40 days' ELSE INTERVAL '7 days' END AND ($1::text IS NULL OR lower(s.login_name)=lower($1))
  AND (s.permissions->'misDesktopAccess' ?| ARRAY['Pulse Master Sync','Vehicle Log Book','Trip Card Bulk Scan','Equipment Log Book','Job Card Bulk Scan'] OR s.permissions->'misMobileAccess' ?| ARRAY['Pulse Master Sync','Vehicle Log Book','Trip Card Bulk Scan'])
  AND ($2::text IS NULL OR s.permissions->'misDesktopAccess' ? $2 OR s.permissions->'misMobileAccess' ? $2)
  ORDER BY s.created_at DESC LIMIT 1`,[actor||null,menu||null]);if(!actor&&!menu)connected=Boolean(result.rows.length);return result.rows;};
 const refresh=async()=>{try{await rows()}catch{connected=false}};
 return {
  status:()=>({connected}),
  async start(){await refresh();timer=setInterval(()=>void refresh(),15000);timer.unref?.()},stop(){clearInterval(timer)},
  // timeoutMs: how long to wait for Pulse (45 s for background reads; a person waiting on a
  // button gets less). A 404 that carries Pulse's own error sentence is Pulse's answer (for
  // example "not a site in Pulse") and keeps its status; a bare 404 means the bridge route is missing.
  // raw: answer with Pulse's bytes (a Buffer) instead of parsed JSON, for the breakdown copy,
  // which compares the bytes before it parses anything (pulse-breakdown-mirror.mjs).
  async request(action,payload={},actor,{menu=null,timeoutMs=45000,raw=false}={}){
   const [session]=await rows(actor,menu);
   if(!session)throw Object.assign(new Error('Sign in to Pulse II normally to reconnect Pulse automatically.'),{status:401});
   let response;try{response=await fetchImpl('https://pulse.cmll.in/api/integrations/mis/pulse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant:session.grant_token,action,...payload}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{throw Error('Pulse is temporarily unavailable; automatic retry is pending.');}
   if(raw&&response.ok)return Buffer.from(await response.arrayBuffer());
   const data=await response.json().catch(()=>null);
   const bare404=response.status===404&&!data?.error;
   if(!response.ok)throw Object.assign(new Error(bare404?'Pulse connection update is still being applied; automatic retry is pending.':data?.error||'Pulse connection failed.'),{status:bare404?503:response.status});
   return data;
  }
 };
}
