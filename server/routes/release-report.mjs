// Production release report for the owner. At the end of every production release
// (scheduled window, backup trigger or urgent), the release workflow posts what it
// deployed, and the owner gets one Telegram message: done or failed, which window,
// the version before and after, and every change (pull request) in the release.
// The workflow identifies itself with its GitHub OIDC token (same check as the
// urgent release OTP), so no shared secret is needed. One message per workflow run.
const text=(value,max=300)=>String(value??'').replace(/[\u0000-\u001f]+/g,' ').trim().slice(0,max);
const sha=value=>/^[0-9a-f]{40}$/.test(String(value||''))?String(value):'';
const MAX_CHANGES=30;
const istTime=date=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' IST';

// How the release was started, from the workflow event and its Run workflow choice.
export function releaseTrigger(eventName,when){
 if(eventName==='schedule')return 'Scheduled window (GitHub timer)';
 if(String(when||'').startsWith('Scheduled window'))return 'Scheduled window (Pulse-II trigger)';
 if(String(when||'').startsWith('Urgent'))return 'Urgent release (owner OTP)';
 return 'Run workflow';
}

export function releaseReportMessage({status,trigger,commit,previous,live,changes=[],more=0,runUrl,at}){
 const done=status==='success';
 const short=value=>sha(value).slice(0,7)||'unknown';
 const lines=[
  done?'✅ Pulse-II production release DONE':'❌ Pulse-II production release FAILED',
  `How: ${trigger}`,
  `${done?'Live at':'Ended at'}: ${istTime(at)}`,
  done?`Version: ${short(commit)} (before: ${short(previous)})`
      :`Tried: ${short(commit)}. Production now serves: ${short(live)}${sha(live)&&sha(live)===sha(previous)?' (unchanged)':''}`,
  '',
  changes.length?`Changes in this release (${changes.length+more}):`:'Changes in this release: none listed',
  ...changes.map(c=>`• ${c.pr?`#${c.pr} `:''}${c.title}`),
  ...(more?[`• …and ${more} more`]:[]),
 ];
 if(runUrl)lines.push('',`Details: ${runUrl}`);
 return lines.join('\n').slice(0,4000);
}

export function registerReleaseReport(app,{verifyIdentity,ownerLogins,telegram,now=()=>new Date(),audit=()=>{}}){
 app.post('/api/release-report',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const claims=await verifyIdentity(String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim());
   const body=req.body||{};
   const changes=(Array.isArray(body.changes)?body.changes:[]).slice(0,MAX_CHANGES)
    .map(c=>({pr:/^\d{1,6}$/.test(String(c?.pr??''))?String(c.pr):'',title:text(c?.title,160)})).filter(c=>c.title);
   const more=Math.max(0,(Array.isArray(body.changes)?body.changes.length:0)-changes.length);
   const runId=text(claims.run_id,40);
   const message=releaseReportMessage({
    status:body.status==='success'?'success':'failed',
    trigger:releaseTrigger(claims.event_name,body.when),
    commit:body.commit,previous:body.previous,live:body.live,changes,more,
    runUrl:runId?`https://github.com/${claims.repository}/actions/runs/${runId}`:'',at:now(),
   });
   let told=0;
   for(const login of await ownerLogins()){
    try{if(await telegram.send(login,message,`release-report:${runId}:${login}`))told++;}catch{}
   }
   audit(req,{action:'Production release report sent',reference:runId,details:{status:body.status,told}});
   if(!told)return res.status(503).json({error:'The owner has no linked Telegram, so the report was not sent.'});
   res.json({told});
  }catch(error){res.status(error.status||503).json({error:error.status?error.message:'The release report could not be sent.'});}
 });
}
