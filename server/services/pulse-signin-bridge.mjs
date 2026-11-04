// Reuse the server-held login grant. Passwords are neither copied nor stored.
export function createPulseSignInBridge({pool,fetchImpl=fetch}){
 let connected=false,timer;
 const rows=async(actor)=>{const result=await pool.query(`SELECT c.grant_token FROM mis_credential_sessions c JOIN auth_sessions s ON s.token=c.session_token
  WHERE s.created_at>NOW()-INTERVAL '7 days' AND ($1::text IS NULL OR lower(s.login_name)=lower($1))
  AND (s.permissions->'misDesktopAccess' ?| ARRAY['Pulse Master Sync','Vehicle Log Book','Trip Card Bulk Scan'] OR s.permissions->'misMobileAccess' ?| ARRAY['Pulse Master Sync','Vehicle Log Book','Trip Card Bulk Scan'])
  ORDER BY s.created_at DESC LIMIT 1`,[actor||null]);if(!actor)connected=Boolean(result.rows.length);return result.rows;};
 const refresh=async()=>{try{await rows()}catch{connected=false}};
 return {
  status:()=>({connected}),
  async start(){await refresh();timer=setInterval(()=>void refresh(),15000);timer.unref?.()},stop(){clearInterval(timer)},
  async request(action,payload={},actor){
   const [session]=await rows(actor);
   if(!session)throw Object.assign(new Error('Sign in to Pulse II normally to reconnect Pulse automatically.'),{status:401});
   let response;try{response=await fetchImpl('https://pulse.cmll.in/api/integrations/mis/pulse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant:session.grant_token,action,...payload}),redirect:'error',signal:AbortSignal.timeout(45000)});}catch{throw Error('Pulse is temporarily unavailable; automatic retry is pending.');}
   const data=await response.json().catch(()=>null);
   if(!response.ok)throw Object.assign(new Error(response.status===404?'Pulse connection update is still being applied; automatic retry is pending.':data?.error||'Pulse connection failed.'),{status:response.status===404?503:response.status});
   return data;
  }
 };
}
