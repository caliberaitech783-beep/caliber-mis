import {recoverCardResponse} from '../../shared/scan-response-recovery.mjs';
import {normalizeScannedMeter} from '../rules/scan-meter-text.mjs';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {allCardDetailViews} from './gemini-card-images.mjs';
import {scanImageMime} from '../rules/scan-image-format.mjs';
import {normalizeCardShift} from '../../shared/trip-card-rules.mjs';
import {formatScannedDoor} from '../../shared/scan-door-text.mjs';
import {siteKeySlug} from '../rules/scan-lanes.mjs';
import {SAFETY_RULES,NO_INVENTION_RULE,HEADER_RULES,SITE_RULES,TIME_RULES,EMPLOYEE_RULES,MACHINE_NOTATION_RULES,M_NO_READING_RULES,M_NO_COMPLETENESS_RULES,DEMO_PREFIX_RULES,METER_DIGIT_RULE,DOOR_RULES,NAME_AND_FORM_RULES,FINAL_CHECK_RULE,TRIP_ROW_RULES} from '../../shared/gemini-scan-rules.mjs';
import {MODEL,localGeminiKey,aFields,validateA,validateB,normalizeTripNumbers,hybridHints} from './gemini-hybrid.mjs';

export {MODEL};
export const geminiEnabled=env=>env.MIS_GEMINI_API==='true'||(env.MIS_LOCAL_SCANNER_DATABASE==='true'&&env.MIS_GEMINI_HYBRID==='true');
export function geminiHttpError(status){
 if(status===402)return 'Gemini extraction failed (HTTP 402). Billing is not active for the Google AI project used by this server. Ask an administrator to enable billing or replace MIS_GEMINI_API_KEY with a key from a billed project, then click Retry OCR. The original scan is retained; no alternate provider was used.';
 if(status===429)return 'Gemini extraction failed (HTTP 429). The Google AI project quota is exhausted or temporarily rate-limited. Wait for quota to reset or ask an administrator to increase it, then click Retry OCR. The original scan is retained; no alternate provider was used.';
 if([401,403].includes(status))return `Gemini extraction failed (HTTP ${status}). The server API key is invalid or does not have access to this Gemini model. Ask an administrator to verify MIS_GEMINI_API_KEY, then click Retry OCR. The original scan is retained; no alternate provider was used.`;
 return `Gemini extraction failed (HTTP ${status}). The Gemini service rejected the request. Click Retry OCR after the service is available. The original scan is retained; no alternate provider was used.`;
}
// Each site can read with its own Gemini key (its own Google Cloud project and
// quota): GEMINI_API_KEY_<SITE>, for example GEMINI_API_KEY_SASTI_OB. A site
// without its own key reads with the shared GEMINI_API_KEY.
export function geminiSiteKeyName(site){const slug=siteKeySlug(site);return slug?'GEMINI_API_KEY_'+slug:'';}
export function geminiKeySource(env=process.env,site=''){const name=geminiSiteKeyName(site);return name&&env[name]?.trim()?'site':'shared';}
export async function configuredGeminiKey(env=process.env,site=''){
 const siteKey=geminiSiteKeyName(site);
 if(siteKey&&env[siteKey]?.trim())return env[siteKey].trim();
 if(env.GEMINI_API_KEY?.trim())return env.GEMINI_API_KEY.trim();
 if(env.MIS_LOCAL_SCANNER_DATABASE==='true')return localGeminiKey();
 throw Error('Gemini key is not configured on the MIS server. Contact your administrator; no alternate provider was used.');
}
export function cardPrompt(kind,{rotated=true}={}){
 return `${SAFETY_RULES} All images are views of ONE physical card: the first is the full original; ${rotated?'subsequent labelled images are overlapping full-height columns of that same page supplied in both 0 and 180 degree orientations. Choose the upright views to transcribe handwriting; rotated alternatives are duplicates of the same rows.':'subsequent labelled images are overlapping full-height columns, bands and details of that same page, all cut from the original without rotation.'} Do not count overlapping rows twice. The card may be upside down (180 degrees), with its printed header at the bottom. Determine its orientation first and mentally rotate every view to read the card upright. Read header fields from the actual printed header wherever it appears; footer signatures are not header values. Transcribe in ONE response. ${NO_INVENTION_RULE}
First identify documentType as "VLB", "ELB" or "unknown" from the actual printed headings and layout. A TRIP CARD with individual loading/unloading trip rows and KMR is VLB, even when submitted through the ELB page. An equipment job card is ELB. Do not let the requested page override the visible document type. Requested type: ${kind==='vehicle'?'VLB':'ELB'}. If the visible type differs, return {"documentType":actualType,"fields":null,"trips":{"p":false,"r":[]}}. Otherwise return JSON only: {"documentType":"${kind==='vehicle'?'VLB':'ELB'}","fields":{...},"trips":{"p":${kind==='vehicle'},"r":[]}}.
fields must contain ${aFields(kind).join(', ')}. Each named field is {"value":string|null,"status":"clear"|"missing"|"unclear"}. Use null unless clear. ${HEADER_RULES}
${SITE_RULES}
${TIME_RULES} ${EMPLOYEE_RULES}
${MACHINE_NOTATION_RULES}
fields.machineSummary is ${kind==='vehicle'?'an array of {equipmentType:{value,status},equipmentNumber:{value,status},tripCount:{value,status}} from the MACHINE-WISE SUMMARY box printed below the trip table, reading M and NO as separate cells. Always inside fields, one row for every populated summary row. Inspect the summary band views before returning; return an empty array only when the box is truly blank':'an empty array'}. ${M_NO_READING_RULES} Return the literal M text and NO digit string separately; the application combines them. ${M_NO_COMPLETENESS_RULES}
${DEMO_PREFIX_RULES} ${METER_DIGIT_RULE} ${DOOR_RULES} ${NAME_AND_FORM_RULES} ${FINAL_CHECK_RULE} ${TRIP_ROW_RULES}
${kind==='vehicle'?'trips.p is true. trips.r contains EVERY populated individual trip row across both columns of the whole card in printed order: [tripNo,equipmentType,equipmentNumber,loadingTime,unloadingTime]. The five cells are the printed trip number, literal M fleet text, literal NO digits, loading time and unloading time. For M=V and NO=5 return [1,"V","5","05:51","06:04"], not a row with equipment V alone. Preserve printed positive integer trip numbers, leading zeros in equipmentNumber and literal times. Use "" for blank cells and null for unreadable cells. Ignore unused blank rows. Never copy summary counts into individual rows, infer repeated equipment, invent times, or omit rows to match totals.':'trips must be {"p":false,"r":[]}. Never extract or invent vehicle trips or KMR fields for ELB.'}`;
}
const summaryMissing=(parsed,kind)=>kind==='vehicle'&&parsed.trips.r.length>0&&!parsed.fields.machineSummary.length;
export function parseCardResponse(raw,kind){
 let parsed;try{parsed=JSON.parse(raw);}catch{throw Error('Gemini returned invalid JSON. The scan is retained; retry extraction.');}
 const expected=kind==='vehicle'?'VLB':'ELB';
 if(parsed?.documentType!==expected)throw Error(['VLB','ELB'].includes(parsed?.documentType)?`This is a ${parsed.documentType} card scanned on the ${expected} page. Open ${parsed.documentType} Card Scanning and scan or upload it there. The original scan is retained.`:'Card type could not be confirmed. Check the scan and select VLB or ELB before retrying.');
 if(!parsed.fields||typeof parsed.fields!=='object'||Array.isArray(parsed.fields))throw Error('Invalid Priority A JSON.');
 if(kind==='equipment'&&(parsed.trips?.p||parsed.trips?.r?.length||parsed.fields?.machineSummary?.length))throw Error('Invalid Job Card response: vehicle trips or summary are not allowed.');
 const recovered=recoverCardResponse(parsed,kind,aFields(kind));
 for(const key of ['openingKmr','closingKmr','openingHmr','closingHmr'])if(recovered.fields[key]?.status==='clear')recovered.fields[key]={...recovered.fields[key],value:normalizeScannedMeter(recovered.fields[key].value)};
 validateA(recovered.fields,kind);validateB(recovered.trips,kind);
 return recovered;
}
// The shared start gate caps extraction starts a minute across every worker.
// 500 ms allows 120 starts a minute so five workers are never held back by the
// gate; HTTP 429 responses still widen the spacing adaptively per key.
// MIS_GEMINI_MIN_INTERVAL_MS overrides it (e.g. 1000 or 2000 if quota is tight).
export function geminiMinIntervalMs(env=process.env){const raw=env.MIS_GEMINI_MIN_INTERVAL_MS,value=Number(raw);return raw?.trim()&&Number.isFinite(value)&&value>=0&&value<=60000?Math.round(value):500;}
// A healthy card read finishes well inside 25 s; abandon a hung connection so
// its retained scan can be retried without keeping the card blocked for minutes.
// MIS_GEMINI_TIMEOUT_MS overrides it (10 s to 180 s).
export function geminiRequestTimeoutMs(env=process.env){const raw=env.MIS_GEMINI_TIMEOUT_MS,value=Number(raw);return raw?.trim()&&Number.isFinite(value)&&value>=10000&&value<=180000?Math.round(value):25000;}
// MIS_GEMINI_UPRIGHT_ONLY=true skips 180 degree views on the first read, for
// scanners that always feed cards upright. A content retry restores them.
export const geminiUprightOnly=(env=process.env)=>env.MIS_GEMINI_UPRIGHT_ONLY==='true';
// Limit native decoding/encoding across readers; API calls remain concurrent.
// Five cards each preparing six canvases at once can otherwise crowd uploads.
let imagePreparation=Promise.resolve();
export const MAX_GEMINI_CONCURRENCY=10;
const keyGates=new Map();
const RATE_LIMIT_BACKOFF_MS=[10000,20000,40000];
const RATE_LIMIT_SPACING_MS=12500;
const RATE_LIMIT_IDLE_RESET_MS=60000;
const RATE_LIMIT_RECOVERY_SUCCESSES=3;
const MAX_TIMER_DELAY_MS=2_147_483_647;
// Prepared pictures are kept for the verification read of the same card: a
// few cards at most, and never longer than this.
const PREPARED_VIEWS_KEEP_MS=5*60_000;
const PREPARED_VIEWS_MAX=16;
const requestGate=()=>({last:0,notBefore:0,spacingMs:0,limitGeneration:0,successes:0,chain:Promise.resolve()});
const rateLimitError=()=>Object.assign(Error(geminiHttpError(429)),{status:429,provider:'gemini'});
// Google's error text for a refused request, e.g. "Your prepayment credits are depleted."
async function upstreamMessage(response){
 try{if(typeof response.json==='function'){const body=await response.json();return String(body?.error?.message||'').replace(/\s+/g,' ').trim().slice(0,300);}}catch{}
 try{await response.body?.cancel?.();}catch{}
 return '';
}

async function readRateLimit(response,now){
 const header=response.headers?.get('retry-after')?.trim();
 const headerDelay=header&&/^\d+(?:\.\d+)?$/.test(header)
  ? Number(header)*1000 : header ? Date.parse(header)-now() : 0;
 const body=await response.json?.().catch(()=>null);
 const details=Array.isArray(body?.error?.details)?body.error.details:[];
 let delayMs=Number.isFinite(headerDelay)?Math.max(0,headerDelay):0;
 let quotaExhausted=false;
 for(const detail of details){
  const retryDelay=/^(\d+(?:\.\d+)?)s$/.exec(detail?.retryDelay);
  const retryMs=retryDelay?Math.ceil(Number(retryDelay[1])*1000):0;
  if(Number.isFinite(retryMs))delayMs=Math.max(delayMs,retryMs);
  for(const violation of Array.isArray(detail?.violations)?detail.violations:[]){
   if(/per[_ -]?(?:day|month)|daily|monthly/i.test(violation?.quotaId+' '+violation?.quotaMetric)||
      String(violation?.quotaValue)==='0')quotaExhausted=true;
  }
 }
 return {delayMs,quotaExhausted};
}

const vehicleDoorInstruction='For the DOOR NO field, use the upright header detail and compare it with the original. Read the fleet prefix, then inspect the mark immediately after it separately from the digits. A narrow slash may be almost vertical or look like 1. Count only the digits after the separator. For example, if the handwritten strokes are S, slash, 274, return S/274. If they are S followed by the four digits 1274 with no separator, return S1274. Use the same rule for V, E and other prefixes. Scania suffixes can have two or three digits. Never infer a digit or a separator from suffix length. If the mark could be either a separator or a real digit, return door with status unclear.';
export function createGeminiCardReader({getKey=configuredGeminiKey,fetchImpl=fetch,prepareImage=async image=>image,prepareViews=allCardDetailViews,cacheDir=path.join(process.env.LOCALAPPDATA||process.env.HOME||os.tmpdir(),'CaliberERP','gemini-cards'),sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,minIntervalMs=geminiMinIntervalMs(),maxPending=12,concurrency=5,requestTimeoutMs=geminiRequestTimeoutMs(),uprightOnly=geminiUprightOnly(),shareGateByKey=false}={}){
 let pending=0,active=0;const ownGate=requestGate(),queue=[],inFlight=new Map();
 // Every trip card is read twice: the first read, then a fresh read that
 // verifies the door number. Both reads send the same pictures, and making
 // them (decode, eight crops, WebP and PNG encoding) is the one step that runs
 // one card at a time. The pictures of the first read are kept for the second,
 // so a card is prepared once, not twice. A fresh read still asks Gemini again;
 // only the unchanged pictures of the unchanged scan are reused.
 const preparedViews=new Map();
 const prepareParts=(image,imageHash,kind,rotated,release)=>{
  const id=imageHash+':'+kind+':'+rotated,queuedAt=now(),kept=preparedViews.get(id);
  if(kept&&now()-kept.at<PREPARED_VIEWS_KEEP_MS){
   if(release)preparedViews.delete(id);
   return kept.parts.then(parts=>({parts,prepMs:0,prepWaitMs:now()-queuedAt,prepReused:true}));
  }
  let started=0;
  const preparation=imagePreparation.then(async()=>{
   started=now();
   const source=await prepareImage(image),views=await prepareViews(source,kind,{rotated});
   return [{inlineData:{mimeType:scanImageMime(source),data:source.toString('base64')}},...views.flatMap(v=>[{text:v.label+' - detail of the same card, not another card.'},{inlineData:{mimeType:v.mimeType||'image/png',data:v.image.toString('base64')}}])];
  });
  imagePreparation=preparation.then(()=>{},()=>{});
  if(!release){
   const entry={at:queuedAt,parts:preparation};preparedViews.set(id,entry);
   preparation.catch(()=>{if(preparedViews.get(id)===entry)preparedViews.delete(id);});
   for(const [key,value] of preparedViews){if(preparedViews.size<=PREPARED_VIEWS_MAX&&now()-value.at<PREPARED_VIEWS_KEEP_MS)break;preparedViews.delete(key);}
  }
  return preparation.then(parts=>({parts,prepMs:now()-started,prepWaitMs:started-queuedAt,prepReused:false}));
 };
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>MAX_GEMINI_CONCURRENCY)throw Error(`Gemini concurrency must be between 1 and ${MAX_GEMINI_CONCURRENCY}.`);
 // Readers using the same key in this process share start spacing and cooldowns.
 const gateFor=key=>{
  if(!shareGateByKey)return ownGate;
  const id=createHash('sha256').update(key).digest('hex');
  if(!keyGates.has(id))keyGates.set(id,requestGate());
  return keyGates.get(id);
 };
 async function startRequest(gate,onStart){
  const turn=gate.chain.then(async()=>{
   let notified=false;
   while(true){
    const time=now();
    if(time>=Math.max(gate.last,gate.notBefore)+RATE_LIMIT_IDLE_RESET_MS){gate.spacingMs=0;gate.successes=0;}
    const spacing=Math.max(minIntervalMs,gate.spacingMs);
    const delay=Math.max(gate.notBefore,gate.last+spacing)-time;
    if(delay<=0){
     if(!notified){
      notified=true;
      await onStart();
      continue;
     }
     gate.last=time;
     return gate.limitGeneration;
    }
    // Another in-flight response may extend the cooldown during this wait.
    await sleep(Math.min(delay,MAX_TIMER_DELAY_MS));
   }
  });
  gate.chain=turn.catch(()=>{});
  return turn;
 }
 async function run(image,kind,onProgress,forceRead=false){
  if(!['vehicle','equipment'].includes(kind))throw Error('Invalid card type.');
  const imageHash=createHash('sha256').update(image).digest('hex'),file=path.join(cacheDir,`${imageHash}-${kind}-single-${kind==='vehicle'?'v17':'v16'}.json`);
  let record;try{if(forceRead)throw Error('Fresh image read requested');const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.imageHash===imageHash&&saved.model===MODEL&&saved.kind===kind&&saved.finishReason==='STOP'&&saved.raw) {const parsed=parseCardResponse(saved.raw,kind);if(!parsed.issues.some(issue=>/equipment (?:number|fleet prefix) missing or unreadable/.test(issue))&&!summaryMissing(parsed,kind))record=saved;}}catch{}
  if(!record){
   const key=await getKey(),gate=gateFor(key);await onProgress?.('extracting');
   const timing={prepMs:0,prepWaitMs:0,prepReused:true};
   const buildParts=async rotated=>{
    const prepared=await prepareParts(image,imageHash,kind,rotated,forceRead);
    timing.prepMs+=prepared.prepMs;timing.prepWaitMs+=prepared.prepWaitMs;timing.prepReused&&=prepared.prepReused;
    return [{text:cardPrompt(kind,{rotated})+(kind==='vehicle'?'\n'+vehicleDoorInstruction:'')+(forceRead?' Re-inspect the Door No cell, Caliber employee ID, all opening and closing HMR/KMR cells, printed date/site, ticked shift, and every trip and machine-summary row in the full image and detail views. The previous reading contained missing, unmatched or conflicting fields. Read each value from this image; do not infer replacements from another card, a master list or arithmetic. Preserve actual disagreements between the printed summary and details. If writing is blank or unclear, mark it missing or unclear.':'')},...prepared.parts];
   };
   const parts=await buildParts(!uprightOnly);let fullParts=uprightOnly?null:parts;
   const totalStarted=Date.now();
   let retryInstruction='',attempt=0,rateLimitRetries=0,requests=0;
   while(attempt<2){
    const requestParts=retryInstruction?[...(fullParts??=await buildParts(true)),{text:retryInstruction}]:parts;
    const requestBody=JSON.stringify({contents:[{role:'user',parts:requestParts}],generationConfig:{temperature:0,responseMimeType:'application/json',maxOutputTokens:8192}});
    const limitGeneration=await startRequest(gate,()=>onProgress?.('extracting',{attempt:attempt+1,maxAttempts:2,startedAt:new Date().toISOString()}));
    const started=Date.now();let res;
    requests++;
    try{res=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},signal:AbortSignal.timeout(requestTimeoutMs),body:requestBody});}
    catch{if(++attempt<2){await onProgress?.('retrying',{attempt:2,maxAttempts:2,reason:'connection timeout',delayMs:500});await sleep(500);continue;}throw Error('Gemini connection timed out or failed after 2 attempts. The scan is retained; retry extraction.');}
    if(res.status===429){
     // Pause the key as soon as the response headers arrive, then use any
     // longer delay Google gives us in Retry-After or google.rpc.RetryInfo.
     const backoff=RATE_LIMIT_BACKOFF_MS[Math.min(rateLimitRetries,RATE_LIMIT_BACKOFF_MS.length-1)];
     gate.spacingMs=RATE_LIMIT_SPACING_MS;
     gate.limitGeneration++;
     gate.successes=0;
     gate.notBefore=Math.max(gate.notBefore,now()+backoff);
     const {delayMs,quotaExhausted}=await readRateLimit(res,now);
     if(quotaExhausted)throw rateLimitError();
     // A long retry window is still a temporary pause for this key.
     // Keep waiting cards behind the gate instead of marking them failed.
     gate.notBefore=Math.max(gate.notBefore,now()+delayMs);
     if(rateLimitRetries===RATE_LIMIT_BACKOFF_MS.length)throw rateLimitError();
     rateLimitRetries++;
     await onProgress?.('retrying',{attempt:rateLimitRetries+1,maxAttempts:RATE_LIMIT_BACKOFF_MS.length+1,reason:'Gemini rate limit (HTTP 429)',delayMs:Math.max(gate.notBefore,gate.last+RATE_LIMIT_SPACING_MS)-now()});
     continue;
    }
    if(!res.ok){
     if([500,502,503,504].includes(res.status)&&++attempt<2){
      await res.body?.cancel?.();
      const seconds=Number(res.headers?.get('retry-after')),delayMs=Math.min(60000,Math.max(2000,Number.isFinite(seconds)?seconds*1000:0));
      await onProgress?.('retrying',{attempt:2,maxAttempts:2,reason:'HTTP '+res.status,delayMs});
      await sleep(delayMs);
      continue;
     }
     // The status and Google's own words travel with the error: an account
     // failure (no credit, key refused) holds the queue instead of failing the card.
     throw Object.assign(Error(geminiHttpError(res.status)),{status:res.status,upstream:await upstreamMessage(res)});
    }
    attempt++;
    let body;try{body=await res.json();}catch{throw Error('Gemini response was interrupted. The scan is retained; retry extraction.');}
    record={imageHash,kind,model:MODEL,modelVersion:body.modelVersion||null,usage:body.usageMetadata||null,elapsedMs:Date.now()-started,totalElapsedMs:Date.now()-totalStarted,attempts:requests,...timing,finishReason:body.candidates?.[0]?.finishReason||null,raw:body.candidates?.[0]?.content?.parts?.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('')||''};
    if(record.finishReason!=='STOP')throw Error('Gemini response was incomplete. The scan is retained; retry extraction.');
    const parsed=parseCardResponse(record.raw,kind);
    // Count only requests started after the latest 429. Older in-flight
    // successes do not show that the key can handle a faster request rate.
    if(gate.spacingMs>0&&limitGeneration===gate.limitGeneration&&++gate.successes===RATE_LIMIT_RECOVERY_SUCCESSES){
     const nextSpacing=Math.floor(gate.spacingMs/2);
     gate.spacingMs=nextSpacing>minIntervalMs?nextSpacing:0;
     gate.successes=0;
    }
    const malformed=parsed.issues.filter(issue=>/invalid response|expected four cells|unreadable or invalid|printed trip number unreadable|duplicate printed numbers|gaps or out-of-order|not clearly confirmed|equipment (?:number|fleet prefix) missing or unreadable/i.test(issue));
    const noSummary=summaryMissing(parsed,kind);
    if(attempt<2&&(parsed.fields.site.status!=='clear'||malformed.length||noSummary)){
     const siteMissing=parsed.fields.site.status!=='clear',missingMachineNumber=malformed.some(issue=>/equipment number missing or unreadable/.test(issue)),reason=[siteMissing?'printed site missing or unclear':'',missingMachineNumber?'equipment number missing in NO column':malformed.length?'malformed card content':'',noSummary?'machine-wise summary not returned':''].filter(Boolean).join('; ');
     retryInstruction=(noSummary?'The previous response returned no machine-wise summary. Re-inspect the MACHINE-WISE SUMMARY box below the trip table in the summary band views and return every populated row in fields.machineSummary. ':'')+(missingMachineNumber?'Re-inspect the M and adjacent NO columns for every populated trip and machine-summary row. The previous response dropped machine numbers. For a V in M and 5 in NO, transcribe equipmentType V and equipmentNumber 5. Read the number from that row; never guess it from another card or the fleet master. ':'')+(siteMissing?'Re-inspect the printed SITE header in the full image and upright header detail. If it is legible, transcribe it exactly with status clear; do not infer it from other fields. ':'')+(malformed.length?'The previous response contained malformed or incomplete content. Re-read every populated header, meter, summary and trip-table cell from the images. Return every trip row as exactly [tripNo,equipmentType,equipmentNumber,loadingTime,unloadingTime], preserving blank cells as empty strings and unreadable cells as null. Do not omit visible loading or unloading times.':'');
     await onProgress?.('retrying',{attempt:2,maxAttempts:2,reason,delayMs:0});continue;
    }
    await fs.mkdir(cacheDir,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(record),{mode:0o600});await fs.rename(temp,file);
    break;
   }
  }
  const {fields,trips,issues:responseRecoveryIssues}=parseCardResponse(record.raw,kind);
  // Reuse the existing field-to-form adapter and consistency checks; no A/B API calls occur.
  const hints=hybridHints(fields,trips,kind,{}),{hybrid,...rest}=hints;
  if(responseRecoveryIssues.length){hybrid.rows=hybrid.rows.map((row,index)=>({...row,equipmentName:trips.r[index][1]??''}));hybrid.issues.push(...responseRecoveryIssues);}
  const originalDoor=rest.handwrittenFields.door,door=formatScannedDoor(originalDoor,kind);
  rest.handwrittenFields={...rest.handwrittenFields,door};
  if(rest.handwritingCandidates.door)rest.handwritingCandidates.door={...rest.handwritingCandidates.door,value:door,text:door};
  rest.cardShift=normalizeCardShift(rest.cardShift);
  if(kind==='vehicle')rest.shiftSelectionStatus=fields.shift.status==='clear'&&rest.cardShift?'clear':fields.shift.status==='missing'?'missing':'unclear';
  return {...rest,responseRecoveryIssues,provider:'gemini',extraction:{imageHash,model:MODEL,originalResponse:record.raw,doorFormatting:{original:originalDoor,value:door,rule:kind==='vehicle'?'Literal slash after fleet prefix; legacy S/NN separator':'Literal equipment notation'},usage:record.usage,elapsedMs:record.elapsedMs,totalElapsedMs:record.totalElapsedMs??record.elapsedMs,attempts:record.attempts??1,prepMs:record.prepMs??null,prepWaitMs:record.prepWaitMs??null,prepReused:record.prepReused??null,fields,trips,issues:hybrid.issues,rows:hybrid.rows,summary:hybrid.summary},extractionWarning:['Gemini: check extracted values against the scan.',...hybrid.issues].join(' ')};
 }
 function drain(){while(active<concurrency&&queue.length){const job=queue.shift();active++;Promise.resolve().then(()=>run(job.image,job.kind,job.onProgress,job.forceRead)).then(job.resolve,job.reject).finally(()=>{active--;pending--;drain();});}}
 return {recognize(image,{kind='vehicle',onProgress,forceRead=false}={}){const key=kind+':'+(forceRead?'fresh:':'cached:')+createHash('sha256').update(image).digest('hex');if(inFlight.has(key))return inFlight.get(key).then(result=>structuredClone(result));if(pending>=maxPending)return Promise.reject(Error('Gemini queue full; retry the retained scan.'));pending++;const task=new Promise((resolve,reject)=>{queue.push({image,kind,onProgress,forceRead,resolve,reject});drain();}).finally(()=>inFlight.delete(key));inFlight.set(key,task);return task;}};
}
