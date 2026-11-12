// Reading a scan entry used to run every card's checks again on every read. While cards are being
// read the browser reloads the entry after each one, so a 100-card entry ran about 100 x 100 checks,
// each with several database queries, and one read could hold a connection for over a minute.
//
// A card's result is now kept in memory and reused while nothing it was worked out from has changed:
//  - `key` covers everything the work reads directly (the card, the entry's date/site/shift, the
//    master-data revision, the equipment aliases);
//  - `questions` are the lookups whose answers depend on other cards or saved log books (duplicates,
//    earlier meter readings). Each question asked is recorded with its answer; a later read asks the
//    same questions again, from data the entry read has already loaded in one query, and reuses the
//    result only when every answer is unchanged.
// So a result is never served after its inputs changed; it is only never recomputed without cause.
// Saving a card does not use this: every save runs its checks directly against the database.
import {createHash} from 'node:crypto';

export const memoKey=(...parts)=>{
 const hash=createHash('sha1');
 for(const part of parts)hash.update(typeof part==='string'?part:JSON.stringify(part)??'null').update('\0');
 return hash.digest('base64');
};

export function createScanCheckMemo({limit=4000}={}){
 const entries=new Map();
 let hits=0,misses=0;
 async function run(id,key,questions,compute){
  const entry=entries.get(id);
  if(entry?.key===key){
   let unchanged=true;
   for(const asked of entry.asked)if(memoKey(await questions[asked.name](asked.arg))!==asked.answer){unchanged=false;break;}
   if(unchanged){hits++;entries.delete(id);entries.set(id,entry);return structuredClone(entry.result);}
  }
  misses++;
  const asked=[];
  const recording=Object.fromEntries(Object.keys(questions).map(name=>[name,async arg=>{
   const answer=await questions[name](arg);
   asked.push({name,arg:arg===undefined?undefined:structuredClone(arg),answer:memoKey(answer)});
   return answer;
  }]));
  // A failed computation stores nothing, so the next read tries again.
  const result=await compute(recording);
  entries.delete(id);entries.set(id,{key,asked,result:structuredClone(result)});
  while(entries.size>limit)entries.delete(entries.keys().next().value);
  return result;
 }
 run.stats=()=>({hits,misses,cached:entries.size});
 return run;
}
