const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function mergeObject(base,edited,latest){
 const result={...latest};
 for(const key of new Set([...Object.keys(base),...Object.keys(edited)])){
  if(same(base[key],edited[key]))continue;
  if(!Object.hasOwn(edited,key)){delete result[key];continue;}
  result[key]=isObject(base[key])&&isObject(edited[key])&&isObject(latest[key])
   ?mergeObject(base[key],edited[key],latest[key]):edited[key];
 }
 return result;
}

export function mergeScanCorrections(base,edited,latest){
 const result=mergeObject(base,edited,latest);
 // Trip detail rows are in printed order. Merge individual cells when all
 // versions have the same row count. A changed row count is a whole-grid edit.
 if(!same(base.trips,edited.trips)&&[base.trips,edited.trips,latest.trips].every(Array.isArray)
   &&base.trips.length===edited.trips.length&&base.trips.length===latest.trips.length){
  result.trips=edited.trips.map((row,i)=>mergeObject(base.trips[i],row,latest.trips[i]));
 }
 return result;
}

export function saveDraftRecovery(storage,key,revision,draft,baseline){
 try{storage.setItem(key,JSON.stringify({revision,draft,baseline,savedAt:Date.now()}));return true;}catch{return false;}
}

export function loadDraftRecovery(storage,key,revision,latest){
 try{
  const value=JSON.parse(storage.getItem(key)||'null');
  if(!isObject(value?.draft))return null;
  if(value.revision===revision)return value.draft;
  if(value.revision<revision&&isObject(value.baseline)&&isObject(latest)){
   return mergeScanCorrections(value.baseline,value.draft,latest);
  }
  return null;
 }catch{return null;}
}

export async function saveScanCorrections({revision,baseline,draft,write,refresh}){
 try{return {saved:await write(revision,draft),draft,rebased:false};}
 catch(error){
  if(error.status!==409||error.message!=='Card changed. Reload before saving.')throw error;
  const latest=await refresh();
  if(!latest||latest.revision<=revision||!['review','error'].includes(latest.status))throw error;
  const merged=mergeScanCorrections(baseline,draft,latest.draft);
  return {saved:await write(latest.revision,merged),draft:merged,rebased:true};
 }
}
