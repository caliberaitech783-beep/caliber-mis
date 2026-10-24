export function parseCaptureTiming(value){
 if(!value||typeof value!=='object'||!['scanner','folder','files'].includes(value.mode)||!Number.isInteger(value.pages)||value.pages<1||value.pages>120||!Number.isFinite(value.durationMs)||value.durationMs<0||value.durationMs>2*60*60*1000)return null;
 return {mode:value.mode,pages:value.pages,durationMs:Math.round(value.durationMs)};
}
export function captureTiming(job,now=Date.now()){
 const start=Date.parse(job?.created_at),end=job?.completed_at?Date.parse(job.completed_at):now;
 return parseCaptureTiming({mode:job?.mode,pages:job?.pages,durationMs:end-start});
}
export function formatScanDuration(ms){const seconds=Math.floor(Math.max(0,ms)/1000);return Math.floor(seconds/60)+' min '+String(seconds%60).padStart(2,'0')+' sec';}
export function scanTimingLabel(value){const timing=parseCaptureTiming(value);return timing?`${timing.pages} pages ${timing.mode==='scanner'?'scanned':'imported'} in ${formatScanDuration(timing.durationMs)}`:'';}
