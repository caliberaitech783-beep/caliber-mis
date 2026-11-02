import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const scope={React};
for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){
 if(!match[2].startsWith('.'))continue;
 const module=await import(new URL('../src/'+match[2],import.meta.url));
 for(const name of match[1].split(',').map(v=>v.trim()))scope[name]=module[name];
}
for(const name of ['ScanBatchMismatchDialog','ScanEquipmentReviewDialog','ScanExtractionStatus','ScanExtractionLine','ScanCorrectionStatus','BreakdownHoursField','ScanBatchReport','SmartSelect','GroqScanSettings','EmployeeIdLookup','LocalScannerPanel','ScanLine','Upload','Check','Save','Plus','Trash2','RefreshCw','ZoomIn','ZoomOut'])scope[name]=()=>null;
scope.ApplicationErrorBoundary=({children})=>children;
const {code}=await transformWithOxc(source.replace('const fleetCards=cards.filter','testCapture.setCards=setCards; testCapture.setSelected=setSelected; testCapture.setOptions=setOptions; testCapture.setDirty=setDirty;testCapture.setBatch=setBatch; testCapture.setBatches=setBatches; testCapture.autoSaveFailures=autoSaveFailures; testCapture.setFailureTick=setFailureTick; const fleetCards=cards.filter').replace('const mismatchPromptedCards=useRef', 'testCapture.setContextGate=setContextGate; const mismatchPromptedCards=useRef').replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'bulk-card-scanning.jsx',{jsx:{runtime:'classic'}});
const nodes=(tree,predicate)=>{const rows=[];const visit=n=>{if(Array.isArray(n))return n.forEach(visit);if(!React.isValidElement(n))return;if(predicate(n))rows.push(n);visit(n.props.children)};visit(tree);return rows};
function harness(search='',kind='vehicle'){
 const testCapture={},slots=[],refs=[],effects=[],listeners=new Map();let cursor=0,refCursor=0;
 const location={href:'https://example.com/?page=vlb-scan'+search,get search(){return new URL(this.href).search}};
 const window={location,history:{pushState(_state,_unused,path){location.href=new URL(path,location.href).href},replaceState(_state,_unused,path){location.href=new URL(path,location.href).href}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:()=>{}};
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const useRef=initial=>{const i=refCursor++;return refs[i]||(refs[i]={current:initial})};
 const Component=new Function(...Object.keys({...scope,testCapture,window,useState,useRef,useEffect:()=>{}}),code+';return BulkCardScanning')(...Object.values({...scope,testCapture,window,useState,useRef,useEffect:fn=>effects.push(fn)}));
 const render=(props={})=>{cursor=0;refCursor=0;effects.length=0;return Component({kind,session:{token:'test'},...props})};
 return {render,window,listeners,effects,slots,testCapture};
}
test('VLB overview keeps compact input panels separate from corrections; attention opens a separate URL and Back restores overview',()=>{
 const app=harness();let tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 assert.equal(nodes(tree,n=>n.props.className==='scan-draft'||n.props.className==='scan-source').length,0);
 const uploadTab=nodes(tree,n=>n.type==='button'&&n.props.children==='Upload files')[0];uploadTab.props.onClick();tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className?.split(' ').includes('scan-upload-panel')).length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-brown')[0].props.onClick();tree=app.render();
 assert.equal(new URL(app.window.location.href).searchParams.get('scanView'),'review');
 assert.equal(new URL(app.window.location.href).searchParams.get('scanGroup'),'brown');
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,0);
 assert.equal(nodes(tree,n=>n.props.role==='status'&&n.props.className==='scan-review-empty').length,1);
 nodes(tree,n=>n.type==='button'&&n.props.children==='Back to card status')[0].props.onClick();tree=app.render();
 assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
});
test('review links survive refresh and browser Back restores card status',()=>{
 const app=harness('&scanView=review&scanGroup=brown');let tree=app.render();
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 app.effects[0]();app.window.location.href='https://example.com/?page=vlb-scan';app.listeners.get('popstate')();tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
});

test('Needs attention, Blank / no data and Error open review; All okay stays on overview',()=>{
 for(const group of ['brown','red','error']){
  const app=harness(),tree=app.render();
  nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-'+group)[0].props.onClick();
  assert.equal(new URL(app.window.location.href).searchParams.get('scanView'),'review');
  assert.equal(new URL(app.window.location.href).searchParams.get('scanGroup'),group);
  assert.equal(nodes(app.render(),n=>n.props.className==='scan-card-groups').length,0);
 }
 const app=harness(),tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-orange')[0].props.onClick();
 assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
});

test('review starts compact and heading can be restored while keeping Back and review content available',()=>{
 const app=harness('&scanView=review&scanGroup=brown');let tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className==='scan-hero').length,0);
 assert.equal(nodes(tree,n=>n.props.className?.includes('scan-review-compact')).length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Back to card status').length,1);
 nodes(tree,n=>n.type==='button'&&n.props.children==='Show heading and summary')[0].props.onClick();
 assert.equal(nodes(app.render(),n=>n.props.className==='scan-hero').length,1);
 nodes(app.render(),n=>n.type==='button'&&n.props.children==='Hide heading and summary')[0].props.onClick();
 assert.equal(nodes(app.render(),n=>n.props.className==='scan-hero').length,0);
});
test('scan overview uses the compact title-only banner',()=>{
 const hero=nodes(harness().render(),n=>n.props.className==='scan-hero')[0];
 assert.equal(hero.type,'header');
 assert.equal(React.Children.count(hero.props.children),1);
 const heading=React.Children.only(hero.props.children);
 assert.equal(heading.type,'h1');
 assert.match(String(heading.props.children[1]),/Trip Cards · Scan & Review/);
});

test('the purple extraction strip stays on the overview and is omitted from card review',()=>{
 assert.equal(nodes(harness().render(),node=>node.type===scope.ScanExtractionStatus).length,1);
 assert.equal(nodes(harness('&scanView=review&scanGroup=brown').render(),node=>node.type===scope.ScanExtractionStatus).length,0);
});

test('fleet upload details start collapsed and the automatic-save alert names the refused card and the server reason',()=>{
 assert.match(source,/fleetRejection\)&&<details className="scan-fleet-rejection-details"><summary>Show fresh-upload details/);
 assert.match(source,/autoSaveError&&<div role="alert" className="scan-error"><strong>Automatic saving stopped at card \{autoSaveError\.ordinal\}\.<\/strong> \{autoSaveError\.message\}/);
 assert.match(source,/autoSaveFailures\.current\.set\(key,e\.message\)/);
 assert.match(source,/autoSaveFailures\.current\.clear\(\);setFailureTick/);
});

test('a refused automatic save moves the card from All okay to Needs attention and the entry chip follows the tiles',()=>{
 const app=harness('&batch=batch-1');app.render();
 const okay=n=>({id:'card-'+n,batch_id:'batch-1',ordinal:n,filename:'ok'+n+'.png',status:'review',revision:3,checks:{errors:[],warnings:[]},draft:{bookDate:'2026-11-01',doorText:'V'+n,assetId:String(n),employeeId:'1',shiftId:'1',cardShift:'I',shiftHours:8,openingHmr:1,closingHmr:2,openingKmr:1,closingKmr:2,location:'Sasti OC',timeMode:'without',trips:[{equipmentName:'E1',tripCount:1}],scanMachineSummary:[{equipmentName:'E1',tripCount:1}]},raw_fields:{}});
 const saved={...okay(9),status:'posted',book_no:'VLB_S/1ST-NOV26/S1/001'};
 app.testCapture.setBatch({id:'batch-1',kind:'vehicle',expected_context:{bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I'}});
 app.testCapture.setCards([okay(1),okay(2),saved]);
 app.testCapture.setBatches([{id:'batch-1',name:'B1',cards:3,posted:1},{id:'batch-2',name:'B2',cards:4,posted:1}]);
 let tree=app.render({vlbBatch:{id:'vlb-1'}});
 const tile=id=>nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-'+id)[0];
 const count=id=>nodes(tile(id),n=>n.type==='strong')[0].props.children.join('');
 const chip=name=>nodes(tree,n=>n.type==='button'&&nodes(n,m=>m.type==='strong'&&m.props.children===name).length)[0];
 assert.equal(count('orange'),'3/3');
 assert.deepEqual(nodes(tile('orange'),n=>n.type==='small')[0].props.children,'1 saved · 2 waiting to save');
 assert.equal(nodes(chip('B1'),n=>n.type==='span')[0].props.children[0],'3 cards · 1 saved · 2 waiting to save');
 assert.equal(nodes(chip('B2'),n=>n.type==='span')[0].props.children[0],'4 cards · 1 saved · 3 unsaved','other entries keep the server counts');
 app.testCapture.autoSaveFailures.current.set('card-2:3','VLB is locked for batch B1. Ask the site PM to unlock VLB before adding or changing tipper cards.');
 app.testCapture.setFailureTick(n=>n+1);
 tree=app.render({vlbBatch:{id:'vlb-1'}});
 assert.equal(count('orange'),'2/3');
 assert.equal(count('brown'),'1/3');
 assert.deepEqual(nodes(tile('orange'),n=>n.type==='small')[0].props.children,'1 saved · 1 waiting to save');
 assert.equal(nodes(chip('B1'),n=>n.type==='span')[0].props.children[0],'3 cards · 1 saved · 1 waiting to save · 1 needs attention');
 const refused=nodes(tree,n=>n.props?.['aria-label']==='Cards in batch');
 assert.equal(refused.length,0,'overview keeps the tiles; the refused card opens from Needs attention');
 app.testCapture.autoSaveFailures.current.set('card-9:3','stale');
 app.testCapture.setFailureTick(n=>n+1);
 tree=app.render({vlbBatch:{id:'vlb-1'}});
 assert.equal(count('orange'),'2/3','a saved card is never marked refused');
});


test('highlighted equipment review returns without reprompting and permits manual reopening',()=>{
 const app=harness('&batch=batch-1');app.render();
 const card={id:'card-1',batch_id:'batch-1',ordinal:1,filename:'trip.png',status:'review',draft:{},raw_fields:{fleetReview:{issues:[{key:'trip',door:'E1',selectedSite:'Sasti',pulseSite:'Majri',fields:['trips.0.equipmentName']}]}}};
 app.testCapture.setCards([card]);
 let tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.children==='Equipment review')[0].props.onClick();
 tree=app.render();
 nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog)[0].props.onReview();
 // Keep the card unselected so this navigation test does not need editor fixtures.
 app.testCapture.setSelected('');tree=app.render();
 assert.equal(new URL(app.window.location.href).searchParams.get('scanReviewReturn'),card.id);
 assert.equal(new URL(app.window.location.href).searchParams.get('batch'),'batch-1');
 const backApp=app;
 nodes(tree,n=>n.type==='button'&&n.props.children==='Back to equipment review')[0].props.onClick();
 tree=backApp.render();
 assert.equal(nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog).length,0);
 nodes(tree,n=>n.type==='button'&&n.props.children==='Equipment review')[0].props.onClick();
 tree=backApp.render();
 assert.equal(nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog)[0].props.card.id,card.id);
 assert.equal(new URL(backApp.window.location.href).searchParams.has('scanView'),false);
 assert.equal(new URL(backApp.window.location.href).searchParams.get('batch'),'batch-1');
 const origin='&batch=batch-1';
 for(const refreshed of [false,true]){
  const target=harness(refreshed?origin:'&batch=batch-1&scanView=review&scanReviewReturn=card-1');target.render();target.testCapture.setCards([card]);
  if(!refreshed){target.effects[0]();target.window.location.href='https://example.com/?page=vlb-scan'+origin;target.listeners.get('popstate')();}
  assert.equal(nodes(target.render(),n=>n.type===scope.ScanEquipmentReviewDialog).length,0);
 }
});


test('Scan and Upload require complete setup and activate only the selected input card',()=>{
 const complete={site:'Test site',report_date:'2026-11-01',shift:'S1'};
 const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&n.props.children===label)[0];
 const scanner=tree=>nodes(tree,n=>n.props.className==='scan-scanner-card')[0];
 const uploader=tree=>nodes(tree,n=>n.props.className==='scan-upload-panel scan-input-card')[0];
 for(const missing of ['site','report_date','shift']){
  const app=harness(),tree=app.render({vlbBatch:{...complete,[missing]:''}});
  assert.equal(button(tree,'Scan').props.disabled,true,missing);
  assert.equal(button(tree,'Upload files').props.disabled,true,missing);
  assert.equal(scanner(tree).props.inert,true,missing);
  assert.equal(uploader(tree).props.inert,true,missing);
 }
 const app=harness(),props={vlbBatch:complete};let tree=app.render(props);
 assert.equal(button(tree,'Scan').props.disabled,false);
 assert.equal(button(tree,'Upload files').props.disabled,false);
 assert.equal(scanner(tree).props.inert,true);assert.equal(uploader(tree).props.inert,true);
 button(tree,'Scan').props.onClick();tree=app.render(props);
 assert.equal(scanner(tree).props.inert,false);assert.equal(uploader(tree).props.inert,true);
 assert.equal(nodes(tree,n=>n.type===scope.LocalScannerPanel)[0].props.disabled,false);
 assert.equal(button(tree,'Choose scan files').props.disabled,true);
 button(tree,'Upload files').props.onClick();tree=app.render(props);
 assert.equal(scanner(tree).props.inert,true);assert.equal(uploader(tree).props.inert,false);
 assert.equal(nodes(tree,n=>n.type===scope.LocalScannerPanel)[0].props.disabled,true);
 assert.equal(button(tree,'Choose scan files').props.disabled,false);
});

test('scan setup fills its single read-only Site from the Pulse account options',()=>{
 const app=harness();app.render();app.testCapture.setOptions({accountLocation:'Sasti OC',sites:['Sasti OC','Jayant OC'],shifts:[]});let tree=app.render();
 const site=nodes(tree,n=>n.type==='input'&&n.props['aria-label']==='Site')[0];
 assert.equal(site.props.readOnly,true);assert.equal(site.props.value,'Sasti OC');assert.equal(site.props.onChange,undefined);
 const sync=app.effects.find(fn=>/accountSite/.test(String(fn))&&/current.location/.test(String(fn)));assert.ok(sync);sync();tree=app.render();
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,true,'date and shift are still required');
 const date=nodes(tree,n=>n.type==='input'&&n.props['aria-label']==='Card date')[0];date.props.onInput({target:{value:'2026-11-01'}});
 nodes(tree,n=>n.props['aria-label']==='Shift')[0].props.onChange({target:{value:'I'}});tree=app.render();
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,false);
});

test('all-site administrators can select any authorized scan site while keeping date and shift required',()=>{
 const app=harness();app.render();app.testCapture.setOptions({canSelectSite:true,accountLocation:'Sasti OC',sites:['Sasti OC','Jayant OC'],shifts:[]});let tree=app.render();
 const sync=app.effects.find(fn=>/accountSite/.test(String(fn))&&/current.location/.test(String(fn)));sync();tree=app.render();
 const site=nodes(tree,n=>n.props['aria-label']==='Site')[0];assert.equal(site.type,scope.SmartSelect);assert.equal(site.props.readOnly,undefined);
 site.props.onChange({target:{value:'Jayant OC'}});tree=app.render();
 nodes(tree,n=>n.type==='input'&&n.props['aria-label']==='Card date')[0].props.onInput({target:{value:'2026-11-01'}});
 assert.equal(nodes(app.render(),n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,true);
 nodes(tree,n=>n.props['aria-label']==='Shift')[0].props.onChange({target:{value:'I'}});tree=app.render();
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Site')[0].props.value,'Jayant OC');
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,false);
 nodes(tree,n=>n.props['aria-label']==='Site')[0].props.onChange({target:{value:'Not authorized'}});tree=app.render();
 nodes(tree,n=>n.props['aria-label']==='Shift')[0].props.onChange({target:{value:'I'}});assert.equal(nodes(app.render(),n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,true);
});

test('opening a site batch keeps its own site ahead of the account default',()=>{
 const app=harness(),vlbBatch={id:'selected',site:'Jayant OC',report_date:'2026-11-01',shift:'S1'};app.render({vlbBatch});
 app.testCapture.setOptions({canSelectSite:true,accountLocation:'Sasti OC',sites:['Sasti OC','Jayant OC'],shifts:[]});const tree=app.render({vlbBatch});
 const site=nodes(tree,n=>n.props['aria-label']==='Site')[0];assert.equal(site.props.value,'Jayant OC');assert.equal(site.props.readOnly,true);
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,false);
});
test('right-click on a status tile offers to reject every unsaved card in that group and sends them for manual entry',async()=>{
 const app=harness('&batch=batch-1');app.render();
 const mismatch=i=>({id:'card-'+i,batch_id:'batch-1',ordinal:i,filename:'trip'+i+'.png',status:'review',revision:3,draft:{bookDate:'2026-11-01',doorText:'V1',assetId:'1',trips:[{equipmentName:'L01',tripCount:1}],scanMachineSummary:[{equipmentName:'L01',tripCount:9}]},raw_fields:{}});
 const saved={id:'card-9',batch_id:'batch-1',ordinal:9,filename:'ok.png',status:'posted',revision:1,draft:{bookDate:'2026-11-01',doorText:'V1',assetId:'1'},raw_fields:{}};
 app.testCapture.setBatch({id:'batch-1',kind:'vehicle',expected_context:{bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I'}});
 app.testCapture.setCards([mismatch(1),mismatch(2),saved]);
 let tree=app.render();
 const tile=id=>nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-'+id)[0];
 assert.equal(tile('orange').props.onContextMenu,undefined,'All okay cards save on their own; no bulk reject there');
 assert.equal(nodes(tree,n=>n.props.role==='menu').length,0);
 let prevented=0;tile('wrong-caliber').props.onContextMenu({preventDefault:()=>prevented++,clientX:40,clientY:50});tree=app.render();
 assert.equal(prevented,1);
 const menu=nodes(tree,n=>n.props.role==='menu')[0];assert.equal(menu.props['aria-label'],'Actions for Wrong Caliber ID');
 const reject=nodes(menu,n=>n.props.className==='scan-group-menu-reject')[0];
 assert.deepEqual(reject.props.children,['Reject all ',2,' card(s) in "','Wrong Caliber ID','"']);
 assert.equal(reject.props.disabled,false);
 const calls=[];app.window.confirm=message=>{calls.push(message);return true};
 const requests=[];globalThis.fetch=async(path,config)=>{requests.push({path,body:config?.body?JSON.parse(config.body):null});
  if(path.endsWith('/reject-group'))return {ok:true,status:200,text:async()=>JSON.stringify({rejected:2,remaining:0})};
  if(path.startsWith('/api/scan-batches/batch-1'))return {ok:true,status:200,text:async()=>JSON.stringify({batch:{id:'batch-1',kind:'vehicle'},cards:[],duplicates:[]})};
  return {ok:true,status:200,text:async()=>JSON.stringify({batches:[]})}};
 try{await reject.props.onClick();}finally{delete globalThis.fetch;}
 assert.match(calls[0],/Reject all 2 card\(s\) in "Wrong Caliber ID"/);
 const sent=requests.find(r=>r.path==='/api/scan-batches/batch-1/reject-group');
 assert.deepEqual(sent.body,{group:'Wrong Caliber ID',cards:[{id:'card-1',revision:3},{id:'card-2',revision:3}]},'only the unsaved cards of that group are sent, never the saved card');
 tree=app.render();
 assert.equal(nodes(tree,n=>n.props.role==='menu').length,0,'the menu closes after the action');
 assert.equal(nodes(tree,n=>n.props.role==='status'&&String(n.props.children).includes('rejected for manual entry')).length>0||app.slots.some(v=>typeof v==='string'&&v.includes('2 card(s) in "Wrong Caliber ID" rejected for manual entry')),true);
});
test('declining the confirmation leaves every card as it was',async()=>{
 const app=harness('&batch=batch-1');app.render();
 app.testCapture.setBatch({id:'batch-1',kind:'vehicle',expected_context:{bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I'}});
 app.testCapture.setCards([{id:'card-1',batch_id:'batch-1',ordinal:1,filename:'a.png',status:'review',revision:1,draft:{},raw_fields:{}}]);
 let tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-red')[0].props.onContextMenu({preventDefault(){},clientX:1,clientY:1});tree=app.render();
 app.window.confirm=()=>false;let fetched=0;globalThis.fetch=async()=>{fetched++;throw Error('must not be called')};
 try{await nodes(tree,n=>n.props.className==='scan-group-menu-reject')[0].props.onClick();}finally{delete globalThis.fetch;}
 assert.equal(fetched,0);
});
test('Back to card status stays usable while a draft is dirty, so a rejected autosave cannot trap the reviewer',()=>{
 const app=harness('&scanView=review&scanGroup=brown');app.render();
 app.testCapture.setDirty(true);let tree=app.render();
 const back=nodes(tree,n=>n.type==='button'&&n.props.children==='Back to card status')[0];
 assert.equal(back.props.disabled,false);
 back.props.onClick();tree=app.render();
 assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,1);
});

test('automatic equipment prompts stay closed during corrections and open only once on overview',()=>{
 const app=harness('&scanView=review');app.render();
 const draft={doorText:'V99',location:'Sasti OC'};
 const card={id:'once-card',status:'review',draft,raw_fields:{fleetReview:{signature:scope.scanFleetSignature(draft),issues:[{door:'V99',fields:['assetId']}]}}};
 app.testCapture.setCards([card]);app.render();
 const prompt=()=>app.effects.find(fn=>String(fn).includes('nextFleetReviewPrompt'))();
 prompt();
 assert.equal(nodes(app.render(),n=>n.type===scope.ScanEquipmentReviewDialog).length,0);
 nodes(app.render(),n=>n.type==='button'&&n.props.children==='Back to card status')[0].props.onClick();
 app.render();prompt();
 let tree=app.render();
 assert.equal(nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog).length,1);
 nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog)[0].props.onReview();
 app.testCapture.setSelected('');tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.children==='Back to equipment review')[0].props.onClick();
 app.render();prompt();
 assert.equal(nodes(app.render(),n=>n.type===scope.ScanEquipmentReviewDialog).length,0);
});


test('mismatch panel prompts once per card despite changing errors and preserves manual opening',()=>{
 const app=harness();app.render();app.testCapture.setBatch({id:'batch-errors'});
 const gate=rows=>({context:{},mismatches:rows});
 const row={id:'error-1',issues:['Date mismatch','Shift mismatch']};
 app.testCapture.setContextGate(gate([row]));app.render();
 const prompt=()=>app.effects.find(fn=>String(fn).includes('mismatchPromptedCards'))();
 const toggle=tree=>nodes(tree,n=>n.type==='button'&&n.props['aria-controls']==='scan-mismatch-list')[0];
 const opened=tree=>toggle(tree).props['aria-expanded'];
 prompt();let tree=app.render();assert.equal(opened(tree),true);
 toggle(tree).props.onClick();app.render();
 app.testCapture.setContextGate(gate([{...row,issues:['Shift mismatch']}]));app.render();prompt();
 assert.equal(opened(app.render()),false);
 app.testCapture.setContextGate(gate([]));app.render();prompt();
 app.testCapture.setContextGate(gate([{...row,issues:['Location mismatch']}]));app.render();prompt();
 assert.equal(opened(app.render()),false);
 app.testCapture.setContextGate(gate([row,{id:'error-2',issues:['Date mismatch']}]));app.render();prompt();
 tree=app.render();assert.equal(opened(tree),true);
 toggle(tree).props.onClick();tree=app.render();toggle(tree).props.onClick();assert.equal(opened(app.render()),true);
});

test('date/site/shift prompts do not interrupt correction of an error card',()=>{
 const app=harness('&scanView=review');app.render();
 app.testCapture.setBatch({id:'batch-errors'});app.testCapture.setSelected('error-1');
 app.testCapture.setContextGate({context:{},mismatches:[{id:'error-1',issues:['Date mismatch','Shift mismatch']}]});
 app.render();app.effects.find(fn=>String(fn).includes('mismatchPromptedCards'))();
 app.testCapture.setSelected('');let tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.children==='Back to card status')[0].props.onClick();
 app.render();app.effects.find(fn=>String(fn).includes('mismatchPromptedCards'))();
 tree=app.render();
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props['aria-controls']==='scan-mismatch-list')[0].props['aria-expanded'],false);
});
