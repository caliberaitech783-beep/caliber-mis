import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('OCR completion replaces the reading draft without autosaving stale empty values',async()=>{
 const file=new URL('../src/bulk-card-scanning.jsx',import.meta.url);
 let source=readFileSync(file,'utf8');
 const scope={SmartSelect: "select",};
 for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+\.mjs)';/gm)){
  const module=await import(new URL(match[2],file));
  for(const name of match[1].split(',').map(v=>v.trim()))scope[name]=module[name];
 }
 source=source.replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 source=source.slice(0,source.indexOf(' const originalScan='))+' return {draft,dirty,update,visibleField};\n}';
 const model={card:{id:'one',revision:1,status:'reading',draft:{},raw_fields:{}}};
 source=source.replace('const card=cards.find(c=>c.id===selected);','const card=model.card;');
 const hooks=[],pending=[];let cursor=0,changed=false;
 scope.model=model;
 scope.useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(hooks[i].value,next)){hooks[i].value=next;changed=true;}}];};
 scope.useRef=initial=>{const i=cursor++;hooks[i]??={current:initial};return hooks[i];};
 scope.useEffect=(effect,deps)=>{const i=cursor++,previous=hooks[i];if(!previous||deps.some((v,n)=>!Object.is(v,previous.deps[n]))){hooks[i]={deps};pending.push(()=>{previous?.cleanup?.();hooks[i].cleanup=effect();});}};
 scope.window={location:{search:''},addEventListener(){},removeEventListener(){}};
 scope.localStorage={getItem(){return null},setItem(){},removeItem(){}};
 scope.fetch=()=>new Promise(()=>{});
 scope.setTimeout=()=>1;scope.clearTimeout=()=>{};scope.setInterval=()=>1;scope.clearInterval=()=>{};
 const Component=new Function(...Object.keys(scope),source+';return BulkCardScanning;')(...Object.values(scope));
 function settle(){let result;for(let i=0;i<12;i++){changed=false;cursor=0;result=Component({kind:'vehicle',session:{token:'test',login:'test'}});for(const effect of pending.splice(0))effect();if(!changed)return result;}throw Error('Draft rendering did not settle');}
 settle();
 const fresh={bookDate:'2026-10-19',bookDateSource:'scan',doorText:'S/09',openingKmr:'30867',closingKmr:'30963',trips:[{rowNumber:1,equipmentName:'B75',loadingTime:'09:30',unloadingTime:'09:44',tripCount:1}],scanMachineSummary:[]};
 model.card={...model.card,revision:2,status:'review',draft:fresh};
 const result=settle();
 assert.equal(result.draft.bookDate,fresh.bookDate);
 assert.equal(result.draft.openingKmr,fresh.openingKmr);
 assert.equal(result.draft.trips.length,1);
 assert.equal(result.dirty,false,'loading extracted data must not schedule an empty autosave');
 assert.equal(result.visibleField('trips.0.loadingTime'),true,'valid loading times stay visible in correction view');
 assert.equal(result.visibleField('trips.0.unloadingTime'),true,'valid unloading times stay visible in correction view');
 assert.equal(result.visibleField('trips.0.tripCount'),true,'trip count stays with its time pair');
 result.update('trips',[...result.draft.trips,{rowNumber:2,equipmentName:'',loadingTime:'10:00',unloadingTime:'10:15',tripCount:1}]);
 const edited=settle();assert.equal(edited.draft.trips[1].equipmentName,'B75');assert.equal(edited.draft.scanMachineSummary[0].tripCount,2);
 assert.equal(edited.draft.bookDate,fresh.bookDate);assert.equal(edited.dirty,true);
});
