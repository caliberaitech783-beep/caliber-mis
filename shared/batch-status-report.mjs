// Batch Status & Turnaround: where every due shift stands (batch not created, VLB open, LMV open, ELB open, locked),
// how long each stage took by the clock, and how much of that was actual work on the website.
// A report only. It reads batches, their history log and LMV log books; it changes nothing.
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName} from './region-scope.mjs';
import {operationalDate,OPERATIONAL_START} from './operational-start.mjs';
import {selectedMasterShift,bookShiftCode} from './trip-card-rules.mjs';

export const IDLE_LIMIT_MINUTES=10,TARGET_HOURS=24,MAX_DAYS=31;
// Rating of a site by the share of its due shifts that are locked: Good from 50%, Poor below 25%, Average in between.
export const GOOD_PERCENT=50,POOR_PERCENT=25;
export const RATING_LABELS={good:'Good',average:'Average',poor:'Poor'};
export const ratingOf=percent=>percent===null||percent===undefined?'':percent>=GOOD_PERCENT?'good':percent>=POOR_PERCENT?'average':'poor';
const indiaDate=time=>new Date(time+19800000).toISOString().slice(0,10);
export const SHIFT_CODES=['S1','S2','S3','D','N'];
export const SHIFT_LABELS={S1:'Shift 1',S2:'Shift 2',S3:'Shift 3',D:'Day shift',N:'Night shift'};
export const STAGE_LABELS={none:'Batch not created',vlb_open:'VLB open',lmv_open:'LMV open',elb_open:'ELB open',locked:'Locked'};
export const PENDING_STAGES=['none','vlb_open','lmv_open','elb_open'];

const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const ms=value=>value===null||value===undefined||value===''?null:new Date(value).getTime();
const round1=value=>Math.round(value*10)/10;
const hoursBetween=(from,to)=>from===null||to===null||from===undefined||to===undefined?null:round1(Math.max(0,to-from)/3600000);
const average=values=>{const known=values.filter(v=>v!==null&&v!==undefined);return known.length?round1(known.reduce((a,b)=>a+b,0)/known.length):null;};
const clock=value=>{const m=String(value||'').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null;};
const nextDate=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
export const displayDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date.slice(8)+'-'+date.slice(5,7)+'-'+date.slice(2,4):date||'';
const DEFAULT_CLOCK={S1:[300,780],S2:[780,1260],S3:[1260,300]};

export function batchStatusFilters(query={}){
 const from=String(query.from||''),to=String(query.to||'');
 if(!operationalDate(from)||!operationalDate(to))fail('Select valid dates on or after 1 November 2026.');
 if(from>to)fail('The From date must not be after the To date.');
 if((Date.parse(to)-Date.parse(from))/86400000>=MAX_DAYS)fail('Choose a range of at most '+MAX_DAYS+' days.');
 return {from,to};
}

// The moment a shift ends, in India time, from the Shift Master. A shift that ends at or before its start ends on the next day.
export function shiftEndTime(shifts,site,code,date){
 const master=selectedMasterShift(shifts,site,code,date);
 let start=clock(master?.startTime||master?.start),end=clock(master?.endTime||master?.end);
 if(start===null||end===null){if(!DEFAULT_CLOCK[code])return null;[start,end]=DEFAULT_CLOCK[code];}
 return Date.parse(date+'T00:00:00+05:30')+(end>start?end:end+1440)*60000;
}

// Shifts a site is expected to enter on a date. A site configured for both three shifts and day / night follows the pattern its batches use.
function dueShifts(shifts,site,date,used){
 const configured=SHIFT_CODES.filter(code=>selectedMasterShift(shifts,site,code,date));
 const three=configured.filter(code=>code.startsWith('S')),dayNight=configured.filter(code=>!code.startsWith('S'));
 const usesDayNight=[...used].some(code=>!code.startsWith('S')),usesThree=[...used].some(code=>code.startsWith('S'));
 if(three.length&&dayNight.length)return usesDayNight&&!usesThree?dayNight:three;
 if(configured.length)return configured;
 return usesDayNight&&!usesThree?['D','N']:['S1','S2','S3'];
}

// Minutes of actual work: the gaps between one action and the next, counting only gaps up to the idle limit.
export function workingMinutes(times,limit=IDLE_LIMIT_MINUTES){
 const sorted=times.filter(t=>t!==null).sort((a,b)=>a-b);let total=0;
 for(let i=1;i<sorted.length;i++){const gap=(sorted[i]-sorted[i-1])/60000;if(gap<=limit)total+=gap;}
 return Math.round(total);
}

export const batchStageKey=batch=>!batch?'none':batch.closed_at?'locked':['lmv_open','elb_open'].includes(batch.stage)?batch.stage:'vlb_open';
const lastEvent=(events,action)=>events.filter(e=>e.action===action).map(e=>ms(e.at)).sort((a,b)=>b-a)[0]??null;
// Final lock times. An unlock clears the column, so a batch that moved on without it falls back to its history log.
function milestones(batch,events){
 const stage=batchStageKey(batch),created=ms(batch.created_at),closed=ms(batch.closed_at);
 const vlbLocked=stage==='vlb_open'?null:ms(batch.vlb_locked_at)??lastEvent(events,'vlb_locked');
 const lmvLocked=['vlb_open','lmv_open'].includes(stage)?null:ms(batch.lmv_locked_at)??lastEvent(events,'lmv_locked');
 return {created,vlbLocked,lmvLocked,closed};
}
const REWORK_ACTIONS=['vlb_unlocked','reopened'];
const scopeKey=(site,date,shift)=>canonicalSiteName(site)+'|'+date+'|'+shift;

export function buildBatchStatusReport({from,to,now=Date.now(),siteStarts=[],shifts=[],batches=[],events=[],lmvBooks=[]}){
 const byScope=new Map(),eventsByBatch=new Map(),lmvByScope=new Map();
 for(const batch of batches)byScope.set(scopeKey(batch.site,batch.date,bookShiftCode(batch.shift)||batch.shift),batch);
 for(const event of events){if(!eventsByBatch.has(event.batch_id))eventsByBatch.set(event.batch_id,[]);eventsByBatch.get(event.batch_id).push(event);}
 for(const book of lmvBooks){const key=scopeKey(book.site,book.date,book.shift);if(!lmvByScope.has(key))lmvByScope.set(key,[]);lmvByScope.get(key).push(book);}
 // One entry per site, counted from the date of its first batch.
 const sites=new Map();
 for(const {site,firstDate} of siteStarts){const key=canonicalSiteName(site);if(!key)continue;const known=sites.get(key);if(!known||firstDate<known.firstDate)sites.set(key,{key,site:displaySiteName(site),firstDate});}
 const rows=[],today=indiaDate(now);
 for(const entry of [...sites.values()].sort((a,b)=>a.site.localeCompare(b.site))){
  const used=new Set(batches.filter(b=>canonicalSiteName(b.site)===entry.key).map(b=>bookShiftCode(b.shift)||b.shift));
  for(let date=from;date<=to;date=nextDate(date)){
   const have=SHIFT_CODES.filter(code=>byScope.has(scopeKey(entry.key,date,code)));
   const due=date<entry.firstDate?[]:dueShifts(shifts,entry.site,date,used);
   const listed=SHIFT_CODES.filter(code=>due.includes(code)||have.includes(code));
   if(date===today){entry.todayShifts=listed.length;entry.todayCounted=0;}
   for(const code of listed){
    const batch=byScope.get(scopeKey(entry.key,date,code))||null,shiftEnd=shiftEndTime(shifts,entry.site,code,date);
    if(!batch&&(shiftEnd===null||shiftEnd>now))continue; // not yet due
    if(date===today)entry.todayCounted++;
    const batchEvents=batch?eventsByBatch.get(batch.id)||[]:[],books=lmvByScope.get(scopeKey(entry.key,date,code))||[];
    const stage=batchStageKey(batch),m=batch?milestones(batch,batchEvents):{created:null,vlbLocked:null,lmvLocked:null,closed:null};
    rows.push({id:entry.key+'|'+date+'|'+code,siteKey:entry.key,site:entry.site,date,shift:code,shiftLabel:SHIFT_LABELS[code]||code,shiftEnd:shiftEnd===null?null:new Date(shiftEnd).toISOString(),
     batchId:batch?.id||'',batchName:batch?.name||'',stage,stageLabel:STAGE_LABELS[stage],
     pendingHours:stage==='locked'||shiftEnd===null?null:Math.round(Math.max(0,now-shiftEnd)/3600000),
     waitHours:batch?hoursBetween(shiftEnd,m.created):null,vlbHours:hoursBetween(m.created,m.vlbLocked),lmvHours:hoursBetween(m.vlbLocked,m.lmvLocked),elbHours:hoursBetween(m.lmvLocked,m.closed),
     lockHours:stage==='locked'?hoursBetween(shiftEnd,m.closed):null,
     workHours:batch?round1(workingMinutes([...batchEvents.map(e=>ms(e.at)),...books.map(b=>ms(b.at))])/60):null,
     cards:batch?Number(batch.cards)||0:null,lmvBooks:batch?books.length:null,machinesSaved:batch&&stage!=='vlb_open'&&stage!=='lmv_open'?Number(batch.machines_saved)||0:null,machinesTotal:batch&&stage!=='vlb_open'&&stage!=='lmv_open'?Number(batch.machines_total)||0:null,
     rework:batch?batchEvents.filter(e=>REWORK_ACTIONS.includes(e.action)).length:null,enteredBy:batch?.created_by||''});
   }
  }
 }
 const siteRows=rankSites([...sites.values()].map(entry=>siteSummary(entry,rows.filter(r=>r.siteKey===entry.key))).filter(s=>s.due));
 return {from,to,today:today>=from&&today<=to?today:'',asOf:new Date(now).toISOString(),targetHours:TARGET_HOURS,idleLimitMinutes:IDLE_LIMIT_MINUTES,sites:siteRows,total:allSitesRow(siteRows),shifts:rows};
}

const STAGE_HOUR_KEYS=[['VLB','vlbHours'],['LMV','lmvHours'],['ELB','elbHours']];
function siteSummary(entry,rows){
 const count=stage=>rows.filter(r=>r.stage===stage).length,locked=rows.filter(r=>r.stage==='locked'),timed=locked.filter(r=>r.lockHours!==null);
 const pending=rows.filter(r=>r.stage!=='locked').sort((a,b)=>(a.shiftEnd||a.date).localeCompare(b.shiftEnd||b.date));
 const stageAverages=STAGE_HOUR_KEYS.map(([stage,key])=>({stage,hours:average(locked.map(r=>r[key]))})).filter(s=>s.hours!==null).sort((a,b)=>b.hours-a.hours);
 const percentDone=rows.length?Math.round(locked.length/rows.length*100):null;
 return {id:entry.key,siteKey:entry.key,site:entry.site,rank:null,percentDone,rating:ratingOf(percentDone),ratingLabel:RATING_LABELS[ratingOf(percentDone)]||'',todayShifts:entry.todayShifts??null,todayCounted:entry.todayCounted??null,due:rows.length,locked:locked.length,balance:rows.length-locked.length,notCreated:count('none'),vlbOpen:count('vlb_open'),lmvOpen:count('lmv_open'),elbOpen:count('elb_open'),
  oldestPending:pending[0]?displayDate(pending[0].date)+' '+pending[0].shiftLabel:'',oldestPendingHours:pending[0]?.pendingHours??null,
  timedLocked:timed.length,withinTarget:timed.filter(r=>r.lockHours<=TARGET_HOURS).length,withinTargetPercent:timed.length?Math.round(timed.filter(r=>r.lockHours<=TARGET_HOURS).length/timed.length*100):null,
  averageLockHours:average(timed.map(r=>r.lockHours)),slowestStage:stageAverages[0]?.stage||'',slowestStageHours:stageAverages[0]?.hours??null,rework:rows.reduce((n,r)=>n+(r.rework||0),0)};
}
// Rank 1 is the site with the largest share of its due shifts locked. Sites with the same share hold the same rank.
export function rankSites(sites){
 const share=s=>s.due?s.locked/s.due:0,sorted=[...sites].sort((a,b)=>share(b)-share(a)||a.site.localeCompare(b.site));
 sorted.forEach((s,index)=>{s.rank=index&&share(sorted[index-1])===share(s)?sorted[index-1].rank:index+1;});
 return sorted;
}
export function allSitesRow(sites){
 const sum=key=>sites.reduce((n,s)=>n+(s[key]||0),0),timed=sum('timedLocked'),percentDone=sum('due')?Math.round(sum('locked')/sum('due')*100):null,today=sites.some(s=>s.todayShifts!==null&&s.todayShifts!==undefined);
 return {id:'all-sites',siteKey:'',site:'ALL SITES',rank:null,percentDone,rating:ratingOf(percentDone),ratingLabel:RATING_LABELS[ratingOf(percentDone)]||'',todayShifts:today?sum('todayShifts'):null,todayCounted:today?sum('todayCounted'):null,due:sum('due'),locked:sum('locked'),balance:sum('balance'),notCreated:sum('notCreated'),vlbOpen:sum('vlbOpen'),lmvOpen:sum('lmvOpen'),elbOpen:sum('elbOpen'),oldestPending:'',oldestPendingHours:null,
  timedLocked:timed,withinTarget:sum('withinTarget'),withinTargetPercent:timed?Math.round(sum('withinTarget')/timed*100):null,
  averageLockHours:timed?round1(sites.reduce((n,s)=>n+(s.averageLockHours||0)*s.timedLocked,0)/timed):null,slowestStage:'',slowestStageHours:null,rework:sum('rework')};
}

// The lines in plain words shown above each step. Worked out from the same rows as the table.
export function sitesInsights(sites,total){
 if(!sites.length||!total.due)return [];
 const lines=[],parts=[['Batch not created',total.notCreated],['VLB open',total.vlbOpen],['LMV open',total.lmvOpen],['ELB open',total.elbOpen]].sort((a,b)=>b[1]-a[1]);
 lines.push(total.balance?`${total.balance} of ${total.due} shifts are not yet locked. Most of them: ${parts[0][0]} (${parts[0][1]}).`:`All ${total.due} shifts are locked.`);
 const names=list=>list.map(s=>s.site).join(', '),ranked=sites.filter(s=>s.rank),first=ranked.filter(s=>s.rank===1),lastRank=Math.max(0,...ranked.map(s=>s.rank)),last=ranked.filter(s=>s.rank===lastRank);
 if(lastRank>1)lines.push(`Rank 1: ${names(first)}, ${first[0].percentDone}% of due shifts locked. Last (rank ${lastRank}): ${names(last)}, ${last[0].percentDone}%.`);
 if(total.todayShifts!==null&&total.todayShifts!==undefined)lines.push(`Today's shifts are counted as soon as they end: ${total.todayCounted} of today's ${total.todayShifts} site shifts are already in Shifts due.`);
 const timed=sites.filter(s=>s.averageLockHours!==null).sort((a,b)=>b.averageLockHours-a.averageLockHours);
 if(timed.length>1)lines.push(`Slowest to lock: ${timed[0].site}, ${timed[0].averageLockHours} hours after shift end on average. Fastest: ${timed.at(-1).site}, ${timed.at(-1).averageLockHours} hours.`);
 else if(timed.length)lines.push(`Locked shifts took ${timed[0].averageLockHours} hours on average after shift end.`);
 return lines;
}
export function shiftsInsight(rows){
 if(!rows.length)return '';
 const locked=rows.filter(r=>r.stage==='locked'),none=rows.filter(r=>r.stage==='none').length,timed=locked.filter(r=>r.lockHours!==null),late=timed.filter(r=>r.lockHours>TARGET_HOURS).length;
 return `${locked.length} of ${rows.length} shifts locked. ${none} ${none===1?'shift has':'shifts have'} no batch yet.`+(timed.length?` Locked shifts took ${average(timed.map(r=>r.lockHours))} hours on average after shift end; ${late} took more than ${TARGET_HOURS} hours.`:'');
}

const ACTIONS={created:['Batch','Batch created'],restored_to_batch_list:['Batch','Batch restored to the list'],batch_restored:['Batch','Deleted batch restored'],
 card_added:['VLB','Trip card saved',true],card_added_duplicate:['VLB','Duplicate trip card recorded'],card_updated:['VLB','Trip card changed'],card_deleted:['VLB','Trip card deleted'],vlb_locked:['VLB','VLB locked'],
 lmv_saved:['LMV','LMV log book saved',true],lmv_locked:['LMV','LMV locked'],
 machine_saved:['ELB','Machine entry saved',true],machine_updated:['ELB','Machine entry changed'],elb_card_linked:['ELB','ELB card linked'],saved_and_locked:['ELB','Batch locked'],
 vlb_unlocked:['Rework','VLB unlocked'],reopen_requested:['Rework','Reopening requested'],reopen_approved:['Rework','Reopening approved'],reopen_rejected:['Rework','Reopening rejected'],reopen_request_withdrawn:['Rework','Reopening request withdrawn'],
 reopened:['Rework','Batch reopened'],approval_otp_sent:['Rework','Approval code sent'],approval_invalidated:['Rework','Approval cancelled'],saved_lock_policy_enabled:['Batch','Locked by the system']};

// Stage of a recorded batch action: VLB, LMV, ELB, Batch, Rework or Other.
export const actionStage=action=>ACTIONS[action]?.[0]||'Other';

// Steps 3 and 4 for one batch: its milestones, the time taken in each stage and every recorded action.
export function buildBatchDetail({batch,shifts=[],events=[],lmvBooks=[],now=Date.now()}){
 const code=bookShiftCode(batch.shift)||batch.shift,shiftEnd=shiftEndTime(shifts,batch.site,code,batch.date),m=milestones(batch,events),stage=batchStageKey(batch);
 const actor=action=>events.filter(e=>e.action===action).sort((a,b)=>ms(b.at)-ms(a.at))[0]?.actor||'';
 const points=[['Shift ended',shiftEnd,''],['Batch created',m.created,batch.created_by||actor('created')],['VLB locked',m.vlbLocked,actor('vlb_locked')],['LMV locked',m.lmvLocked,actor('lmv_locked')],['Batch locked',m.closed,actor('saved_and_locked')]];
 let previous=null;
 const timeline=points.map(([label,at,by],index)=>{const row={id:'m'+index,label,at:at===null?null:new Date(at).toISOString(),by:at===null?'':by,sincePrevious:index&&at!==null?hoursBetween(previous,at):null,sinceShiftEnd:index&&at!==null?hoursBetween(shiftEnd,at):null};if(at!==null)previous=at;return row;});
 const listed=[...events.map(e=>({at:ms(e.at),action:e.action,by:e.actor||'',item:e.item||''})),...lmvBooks.map(b=>({at:ms(b.at),action:'lmv_saved',by:b.by||'',item:b.book_no||''}))].filter(e=>e.at!==null).sort((a,b)=>a.at-b.at);
 const actions=listed.map((e,index)=>{
  const [group,label,item]=ACTIONS[e.action]||['Other',String(e.action||'').replaceAll('_',' ')],gap=index?Math.round((e.at-listed[index-1].at)/60000):null,waiting=gap!==null&&gap>IDLE_LIMIT_MINUTES;
  return {id:'a'+index,sr:index+1,at:new Date(e.at).toISOString(),stage:group,action:label,item:e.item,by:e.by,gapMinutes:gap,workMinutes:gap===null?null:waiting?0:gap,waiting,counted:Boolean(item),remark:waiting?'Waiting: gap above the idle limit':''};
 });
 const stageRow=(name,from,to,list)=>{const clockHours=hoursBetween(from,to),work=list.reduce((n,a)=>n+(a.workMinutes||0),0),items=list.filter(a=>a.counted).length;
  return {id:'s-'+name,stage:name,clockHours,workMinutes:work,waitHours:clockHours===null?null:round1(Math.max(0,clockHours-work/60)),items,minutesPerItem:items?round1(work/items):null};};
 const stages=[stageRow('VLB',m.created,m.vlbLocked,actions.filter(a=>a.stage==='VLB')),stageRow('LMV',m.vlbLocked,m.lmvLocked,actions.filter(a=>a.stage==='LMV')),stageRow('ELB',m.lmvLocked,m.closed,actions.filter(a=>a.stage==='ELB')),stageRow('Whole batch',m.created,m.closed,actions)];
 const count=name=>events.filter(e=>e.action===name).length;
 const rework=[['VLB unlocked after locking',count('vlb_unlocked')],['Batch reopened after locking',count('reopened')],['Trip cards changed after saving',count('card_updated')],['Trip cards deleted',count('card_deleted')],['Machine entries changed after saving',count('machine_updated')]].map(([label,value],index)=>({id:'r'+index,label,count:value}));
 const whole=stages[3],slowest=stages.slice(0,3).filter(s=>s.waitHours!==null).sort((a,b)=>b.waitHours-a.waitHours)[0],lockedAfter=hoursBetween(shiftEnd,m.closed);
 const insight=stage==='locked'
  ?`${lockedAfter===null?'Locked.':`Locked ${lockedAfter} hours after the shift ended.`} On the batch: ${whole.clockHours??'—'} hours by the clock, ${whole.workMinutes} minutes of actual work.${slowest&&slowest.waitHours>0?` Longest wait: ${slowest.stage} stage, ${slowest.waitHours} hours.`:''}`
  :`${STAGE_LABELS[stage]}. ${shiftEnd===null?'':`Pending for ${Math.round(Math.max(0,now-shiftEnd)/3600000)} hours since the shift ended. `}${whole.workMinutes} minutes of actual work so far.`;
 return {batch:{id:batch.id,name:batch.name,site:displaySiteName(batch.site),date:batch.date,shift:code,shiftLabel:SHIFT_LABELS[code]||code,stage,stageLabel:STAGE_LABELS[stage],enteredBy:batch.created_by||''},
  idleLimitMinutes:IDLE_LIMIT_MINUTES,insight,timeline,stages,rework,actions};
}
export {OPERATIONAL_START};
