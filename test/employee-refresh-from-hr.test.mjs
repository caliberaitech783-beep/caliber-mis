// Owner, 23 Nov 2026: "If a caliber ID is not found in HR employee list, caliber plus HR employee list, then it should
// say ID not found. Please contact your HR team. And there one refresh button should be there. If [it] is added and
// then the refresh button is done and it is showing from HR Pulse, then it should allow to move further."
//   - the line a person sees for such a number is "ID not found. Please contact your HR team.";
//   - Refresh asks HR Pulse for that one number now (the rules of the minute copy, for that person alone);
//   - when HR Pulse holds the person, Employee Master takes him and the ordinary lookup answers, so the card goes on;
//   - a number HR Pulse does not hold changes nothing: a Refresh never switches anyone off;
//   - nothing is created or edited in Pulse-II by a person.
// The people and numbers below are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {transformWithOxc} from 'vite';
import {createHrEmployeeMinuteCopy,HR_COPY_STATE_KEY,HR_REFRESH_KEEP_MS,HR_REFRESH_BLOCKS} from '../server/services/hr-employee-minute-copy.mjs';
import {registerErpEmployees,hrRefreshBlockLine} from '../server/routes/erp-employee-source.mjs';
import {ID_NOT_FOUND,CONTACT_HR,HR_REFRESH_REASONS,REFRESH_HINT,caliberCheckMessage,fetchRefusal} from '../shared/caliber-id-check.mjs';
import {canRefreshFromHr,canConfirmSaved,RECHECK_REASONS,recheckLine} from '../shared/caliber-recheck.mjs';
import {employeeAtLocation} from '../shared/log-book-access.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';

const MAJRI='Majri OC',SASTI='Sasti OC',START=Date.parse('2026-11-23T09:00:00.000Z');
const person=(number,name,site,extra={})=>({caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,site,currentLocation:site,currentDesignationName:'TIPPER DRIVER',currentDepartmentName:'PRODUCTION',
 hrListed:true,hrLeft:false,status:'Active',hrSite:site===MAJRI?'Majri OB':'Sasti OB',hrStatus:'ACTIVE',hrCategory:'SKILLED',hrRegion:'WCL',employeeMasterRevision:3,panNo:'KEEP'+number,...extra});
const hrLine=(number,name,site='Majri OB',extra={})=>({employeeId:'CMLL'+number,name,region:'WCL',site,department:'PRODUCTION',designation:'TIPPER DRIVER',category:'SKILLED',status:'ACTIVE',reportingTo:'',contact:'',leavingDate:'',...extra});

async function fixture(people){
 const db=new PGlite();
 await db.exec("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 for(const record of people)await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify(record)]);
 const query=(sql,params)=>/pg_advisory/.test(sql)?Promise.resolve({rows:[]}):!params&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 // HR Pulse: `all` is its whole list at this moment; `reads` counts how often it was asked.
 const state={now:START,all:[],reads:0,fail:null,connected:true};
 const hr={configured:()=>state.connected,changes:async after=>({ready:true,after,latest:String(after),more:false,numbers:[],employees:[]}),
  employees:async()=>{state.reads++;if(state.fail)throw Object.assign(new Error(state.fail),{status:502});return {employees:state.all};}};
 const copy=createHrEmployeeMinuteCopy({pool,hr,now:()=>state.now});
 const all=async()=>(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Employee master' ORDER BY id")).rows.map(row=>({id:Number(row.id),...row.record_data}));
 const saved=async()=>(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[HR_COPY_STATE_KEY])).rows[0]?.setting_value||{};
 // HR changes its list: the next Refresh reads it afresh.
 const hrNow=lines=>{state.all=lines;state.now+=HR_REFRESH_KEEP_MS;};
 return {db,pool,copy,state,all,saved,hrNow,close:()=>db.close()};
}

test('the line for a number HR does not carry: ID not found, contact your HR team',()=>{
 assert.equal(ID_NOT_FOUND,'ID not found. Please contact your HR team.');
 const at=MAJRI,none={lookAlikes:[]};
 assert.equal(caliberCheckMessage({reason:'not-listed',read:'7001',at,name:'WORKING MAN',designation:'TIPPER DRIVER',...none}),'Scan read 7001. ID not found. Please contact your HR team. No look-alike ID at Majri OC.');
 assert.equal(caliberCheckMessage({reason:'unknown',read:'7999',at,lookAlikes:[{id:'7099',name:'NEAR MAN'}]}),'Scan read 7999. ID not found. Please contact your HR team. Look-alike IDs at Majri OC: 7099 (NEAR MAN).','the look-alike IDs stay: most such numbers are a misread');
 assert.equal(caliberCheckMessage({reason:'left',read:'7004',at,name:'GONE MAN',designation:'DRIVER',left:'hr',...none}),"Scan read 7004. This is GONE MAN, DRIVER. HR's list says this person has left. Please contact your HR team. No look-alike ID at Majri OC.");
 assert.equal(fetchRefusal({name:'WORKING MAN',hrListed:false},MAJRI),ID_NOT_FOUND);
 assert.equal(fetchRefusal({name:'GONE MAN',currentDesignationName:'DRIVER',hrListed:true,hrLeft:true},MAJRI),"This is GONE MAN, DRIVER. HR's list says this person has left."+CONTACT_HR);
 // Caliber ID Re-check: the same words, and which lines have Refresh.
 assert.equal(RECHECK_REASONS['not-listed'],'ID not found');
 assert.equal(recheckLine({reason:'not-listed',read:'7001',at,name:'WORKING MAN'}),ID_NOT_FOUND);
 assert.equal(recheckLine({reason:'unknown',read:'7999',at}),ID_NOT_FOUND);
 assert.deepEqual(HR_REFRESH_REASONS,['unknown','not-listed','left']);
 for(const reason of Object.keys(RECHECK_REASONS))assert.equal(canRefreshFromHr({reason}),HR_REFRESH_REASONS.includes(reason),reason);
 assert.equal(canRefreshFromHr(null),false);
 assert.equal(canConfirmSaved({reason:'not-listed'}),false,'such a card is never settled with a tick: only HR Pulse settles it');
});

test("Refresh asks HR Pulse for one number: nothing changes until HR has it, then the person is taken at once",async()=>{
 const f=await fixture([person(7001,'WORKING MAN',MAJRI,{hrListed:false}),person(7002,'LISTED MAN',MAJRI)]);
 try{
  // HR Pulse does not hold the number: nothing is written, and a Refresh never switches anyone off.
  f.state.all=[hrLine(7009,'SOMEBODY ELSE')];
  assert.deepEqual(await f.copy.person('CMPL7001',{by:'site.operator'}),{found:false,changed:false,blocked:null});
  assert.deepEqual(await f.copy.person('7002'),{found:false,changed:false,blocked:null});
  assert.deepEqual((await f.all()).map(row=>[row.caliberId,row.hrListed]),[['CMPL7001',false],['CMPL7002',true]],'a listed person HR Pulse does not show is left alone');
  assert.equal(f.state.reads,1,"presses within a few seconds share one read of HR Pulse's list");
  assert.deepEqual(await f.saved(),{},'nothing was written');
  // HR adds the person in HR Pulse.
  f.hrNow([hrLine(7001,'WORKING MAN','Majri OB',{designation:'VOLVO DRIVER'})]);
  const taken=await f.copy.person('CMLL7001',{by:'site.operator'});
  assert.deepEqual([taken.found,taken.changed,taken.added,taken.blocked],[true,true,false,null]);assert.equal(f.state.reads,2);
  const now=(await f.all())[0];
  assert.deepEqual([now.id,now.hrListed,now.hrLeft,now.status,now.currentDesignationName,now.site,now.panNo],[1,true,false,'Active','VOLVO DRIVER',MAJRI,'KEEP7001'],'the same line, so every saved card keeps its driver');
  assert.equal(employeeAtLocation(now,MAJRI),true);
  assert.equal((await f.saved()).lastRefreshBy,'site.operator');
  assert.equal((await f.copy.person('7001')).changed,false,'pressed again: nothing to write');
  assert.equal((await f.copy.status()).started,false,'it works before the minute copy has been started');
 }finally{await f.close();}
});

test('Refresh adds a new joiner, and never puts another name on a number',async()=>{
 const f=await fixture([person(7001,'OLD HOLDER',MAJRI,{hrListed:false})]);
 try{
  f.state.all=[hrLine(22501,'NEW JOINER','Sasti OB'),hrLine(7001,'QUITE ANOTHER'),hrLine(7005,'TWICE A'),hrLine(7005,'TWICE B','Sasti OB')];
  const added=await f.copy.person('22501');
  assert.deepEqual([added.found,added.changed,added.added,added.blocked],[true,true,true,null]);
  assert.deepEqual((await f.all()).filter(row=>row.caliberId==='CMPL22501').map(row=>[row.name,row.site,row.hrListed,row.source]),[['NEW JOINER',SASTI,true,'HR Pulse']]);
  const other=await f.copy.person('7001');
  assert.deepEqual([other.found,other.changed,other.blocked.reason,other.blocked.name],[true,false,'old-person','QUITE ANOTHER']);
  assert.equal((await f.all())[0].hrListed,false,'nobody was changed');
  assert.deepEqual((await f.saved()).held.map(item=>[item.number,item.reason]),[['7001','old-person']],'what is held shows on Sync all masters, as after a minute copy');
  assert.equal((await f.copy.person('7005')).blocked.reason,'two-lines');
  assert.deepEqual(HR_REFRESH_BLOCKS,['bad-id','two-lines','no-name','other-name','old-person']);
  assert.equal(hrRefreshBlockLine({reason:'old-person',name:'QUITE ANOTHER'}),'HR Pulse has this ID under another name (QUITE ANOTHER). Please contact your HR team.');
  assert.equal(hrRefreshBlockLine({reason:'two-lines'}),'HR Pulse has this ID on more than one line. Please contact your HR team.');
  assert.equal(hrRefreshBlockLine({reason:'bad-id'}),'HR Pulse holds this ID in a form Pulse-II cannot use. Please contact your HR team.');
  await assert.rejects(f.copy.person('EMP-X'),error=>error.status===400);
  f.state.connected=false;
  await assert.rejects(f.copy.person('7001'),error=>error.status===503);
 }finally{await f.close();}
});

test('the Refresh of the Fetch box: ID not found until HR Pulse has it, then the card goes on as after a Fetch',async()=>{
 const f=await fixture([person(7001,'WORKING MAN',MAJRI,{hrListed:false}),person(7003,'OTHER SITE MAN',SASTI),person(7004,'GONE MAN',MAJRI,{hrLeft:true,status:'Left'})]);
 const app=express();app.use(express.json());
 const audits=[];let scope={sites:null,label:'All sites'},copy=f.copy;
 app.use((req,res,next)=>{res.on('finish',()=>{if(req.audit)audits.push(req.audit)});next()});
 registerErpEmployees(app,{pool:f.pool,requireSession:(req,res,next)=>{req.session={login:'site.operator',name:'Site Operator'};next()},requireAdministrator:(req,res,next)=>next(),getSiteScope:async()=>scope,hrCopy:()=>copy});
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>({}))};};
 const lookup=(id,location=MAJRI)=>post('/api/log-books/employee-lookup',{caliberId:id,location,bookDate:'2026-11-20'});
 const refresh=(id,location=MAJRI)=>post('/api/log-books/employee-refresh',{caliberId:id,location,bookDate:'2026-11-20'});
 try{
  // What the Fetch box is told, with the mark that offers Refresh.
  assert.deepEqual(await lookup('7001'),{status:403,body:{error:ID_NOT_FOUND,refresh:true}});
  assert.deepEqual(await lookup('7999'),{status:404,body:{error:ID_NOT_FOUND,refresh:true}});
  const gone=await lookup('7004');
  assert.deepEqual([gone.status,gone.body.refresh],[403,true]);assert.match(gone.body.error,/HR's list says this person has left\. Please contact your HR team\.$/);
  const elsewhere=await lookup('7003');
  assert.equal(elsewhere.status,403);assert.equal(elsewhere.body.refresh,undefined,'a worker of another site is the OTP move, not HR');

  // HR Pulse does not have it yet: the same line, nothing written.
  assert.deepEqual(await refresh('7001'),{status:404,body:{error:ID_NOT_FOUND,refresh:true}});
  assert.equal(audits.length,0);assert.equal((await f.all())[0].hrListed,false);

  // HR adds the person in HR Pulse. Refresh takes him and answers as a Fetch does.
  f.hrNow([hrLine(7001,'WORKING MAN'),hrLine(7999,'SOMEONE NEW'),hrLine(7004,'GONE MAN','Majri OB',{status:'LEFT'})]);
  const taken=await refresh('7001');
  assert.equal(taken.status,200,JSON.stringify(taken.body));
  assert.deepEqual([taken.body.id,taken.body.name,taken.body.caliberId,taken.body.site],['1','WORKING MAN','CMPL7001',MAJRI]);
  assert.deepEqual(audits.map(audit=>[audit.action,audit.targetReference,audit.details.added]),[['Refresh from HR Pulse','7001',false]]);
  assert.equal((await lookup('7001')).status,200,'and the ordinary Fetch finds him from now on');
  const joiner=await refresh('CMLL7999');
  assert.deepEqual([joiner.status,joiner.body.name,joiner.body.caliberId],[200,'SOMEONE NEW','CMPL7999']);
  // HR Pulse still says LEFT: the line stays, with its Refresh.
  const still=await refresh('7004');
  assert.deepEqual([still.status,still.body.refresh],[403,true]);assert.match(still.body.error,/has left\. Please contact your HR team\.$/);
  // Taken from HR Pulse but working at another site: the answer is the ordinary one for another site.
  const away=await refresh('7001',SASTI);
  assert.equal(away.status,403);assert.equal(away.body.refresh,undefined);assert.equal(away.body.siteMove.from,MAJRI);

  // HR Pulse gives the number to another name: nobody is changed.
  f.hrNow([hrLine(7003,'QUITE ANOTHER','Sasti OB')]);
  assert.deepEqual(await refresh('7003',SASTI),{status:409,body:{error:'HR Pulse has this ID under another name (QUITE ANOTHER). Please contact your HR team.',refresh:true}});
  assert.equal((await f.all())[1].name,'OTHER SITE MAN');

  // HR Pulse does not answer, or is not connected: said plainly, the button stays.
  f.state.fail='HR did not answer. Existing data retained.';f.state.now+=HR_REFRESH_KEEP_MS;
  assert.deepEqual(await refresh('7001'),{status:502,body:{error:'HR Pulse did not answer. Press Refresh again in a minute.',refresh:true}});
  f.state.fail=null;copy=null;
  const off=await refresh('7001');
  assert.deepEqual([off.status,off.body.refresh],[503,true]);assert.match(off.body.error,/not connected.*Please contact your HR team\.$/);

  // The same guards as the lookup beside it: the site of the login, and a number that can be one.
  copy=f.copy;scope={sites:['sasti ob'],label:SASTI};
  assert.equal((await refresh('7001')).status,403,'a Sasti login cannot ask for a Majri card');
  assert.equal((await post('/api/log-books/employee-refresh',{caliberId:'not an id!',location:SASTI})).status,400);
 }finally{server.close();await f.close();}
});

test('Refresh is allowed to the same MIS menus as the lookup beside it',()=>{
 const login=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}}),request={path:'/api/log-books/employee-refresh',method:'POST'};
 for(const page of ['Trip Card Bulk Scan','Job Card Bulk Scan','Vehicle Log Book','Equipment Log Book'])assert.equal(misRequestAllowed(login([page]),request),true,page);
 assert.equal(misRequestAllowed(login(['Reports','Dashboard']),request),false,'a login with no card menu');
 assert.equal(misRequestAllowed(login(['Trip Card Bulk Scan']),{path:'/api/log-books/employee-lookup',method:'POST'}),true);
});

// The Fetch box itself: compiled from its source and driven with stand-in hooks and a server, as in
// test/caliber-id-check.test.mjs.
const lookupBox=async({answers,...props})=>{
 const source=readFileSync(new URL('../src/employee-id-lookup.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 const {code}=await transformWithOxc(source,'employee-id-lookup.jsx',{jsx:{runtime:'classic'}});
 const slots=[],effects=[],timers=[],calls=[];let cursor=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]};
 const useRef=initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]};
 const useEffect=(run,deps)=>{const i=cursor++,before=slots[i];if(!before||deps.some((dep,n)=>dep!==before[n])){slots[i]=deps;effects.push(run);}};
 const fetchStub=async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});const answer=answers(url,body);return {ok:answer.status===200,status:answer.status,json:async()=>answer.body};};
 const Box=new Function('React','useState','useEffect','useRef','fetch','setTimeout','clearTimeout','AbortController',code+';return EmployeeIdLookup')(React,useState,useEffect,useRef,fetchStub,run=>{timers.push(run);return timers.length},()=>{},AbortController);
 const resolved=[];
 const render=()=>{cursor=0;const tree=Box({token:'t',location:MAJRI,bookDate:'2026-11-20',onResolved:async employee=>{resolved.push(employee)},...props});for(const run of effects.splice(0))run();return tree;};
 const find=(tree,match)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(match(node))found.push(node);visit(node.props.children)};visit(tree);return found};
 const words=node=>[].concat(node?.props?.children??[]).flat(Infinity).filter(part=>typeof part==='string'||typeof part==='number').join('');
 return {render,find,calls,resolved,words,runTimers:async()=>{for(const run of timers.splice(0))await run();},input:tree=>find(tree,node=>node.type==='input')[0],
  button:(tree,label)=>find(tree,node=>node.type==='button').find(node=>words(node)===label),alert:tree=>words(find(tree,node=>node.props?.role==='alert')[0])};
};

test('the Fetch box: a number that is not found shows the line and Refresh; Refresh that finds the person hands him on',async()=>{
 const worker={id:'1',name:'WORKING MAN',caliberId:'CMPL7001'};let inHr=false;
 const answers=(url,body)=>url.startsWith('/api/log-books/employee-refresh')&&inHr?{status:200,body:worker}:{status:404,body:{error:ID_NOT_FOUND,refresh:true}};
 // A manual form: the worker is handed on at once.
 const box=await lookupBox({answers});
 let tree=box.render();
 assert.equal(box.button(tree,'Refresh'),undefined,'no Refresh until a number was refused for this reason');
 box.input(tree).props.onChange({target:{value:'7001'}});
 tree=box.render();await box.runTimers();tree=box.render();
 assert.equal(box.alert(tree),ID_NOT_FOUND);
 const refresh=box.button(tree,'Refresh');
 assert.ok(refresh,'Refresh sits under the line');
 assert.equal(box.words(box.find(tree,node=>node.props?.className==='employee-id-refresh')[0].props.children[1]),REFRESH_HINT,'the hint under it is the shared one');
 await refresh.props.onClick();tree=box.render();
 assert.deepEqual(box.calls.map(call=>[call.url,call.body.caliberId,call.body.location,call.body.bookDate]),[['/api/log-books/employee-lookup','7001',MAJRI,'2026-11-20'],['/api/log-books/employee-refresh','7001',MAJRI,'2026-11-20']]);
 assert.equal(box.alert(tree),ID_NOT_FOUND,'HR Pulse does not have it yet: the same line');assert.ok(box.button(tree,'Refresh'));assert.equal(box.resolved.length,0);
 inHr=true;
 await box.button(tree,'Refresh').props.onClick();tree=box.render();
 assert.deepEqual(box.resolved,[worker],'HR Pulse has him now: the card goes on');
 assert.equal(box.input(tree).props.value,'CMPL7001');assert.equal(box.button(tree,'Refresh'),undefined);assert.equal(box.find(tree,node=>node.props?.role==='alert').length,0);

 // Caliber ID Re-check (Submit mode): Refresh shows whose number it is, and Submit puts him on the card.
 inHr=false;
 const line=await lookupBox({answers,scanMode:true,submitLabel:'Submit'});
 tree=line.render();line.input(tree).props.onChange({target:{value:'7001'}});
 tree=line.render();await line.runTimers();tree=line.render();
 assert.equal(line.alert(tree),ID_NOT_FOUND);
 inHr=true;
 await line.button(tree,'Refresh').props.onClick();tree=line.render();
 assert.equal(line.calls.at(-1).url,'/api/log-books/employee-refresh?scan=1');
 assert.equal(line.resolved.length,0,'nothing is handed over until Submit');
 assert.equal(line.words(line.find(tree,node=>node.props?.className==='employee-id-found')[0].props.children[0]),'CMPL7001 · WORKING MAN');
 await line.button(tree,'Submit').props.onClick();
 assert.deepEqual(line.resolved,[worker]);

 // A scanned card the scan already held for this reason: Refresh is there before any Fetch, for the number read.
 inHr=true;
 const held=await lookupBox({answers,scanMode:true,suggestedId:'7001',refreshFirst:true});
 tree=held.render();await held.runTimers();
 assert.equal(held.calls.length,0,'the number the scan read is still never fetched by itself');
 await held.button(tree,'Refresh').props.onClick();
 assert.deepEqual([held.calls.map(call=>call.url),held.resolved],[['/api/log-books/employee-refresh?scan=1'],[worker]]);
 assert.equal((await lookupBox({answers,scanMode:true,suggestedId:'7001'})).button((await lookupBox({answers,scanMode:true,suggestedId:'7001'})).render(),'Refresh'),undefined,'only when the card was held for that reason');
});

test('the screens: the Re-check line and the scan review offer Refresh where HR settles the card',()=>{
 const page=readFileSync(new URL('../src/caliber-recheck.jsx',import.meta.url),'utf8'),scan=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8'),route=readFileSync(new URL('../server/routes/caliber-recheck.mjs',import.meta.url),'utf8'),server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.ok(route.includes('canRefresh:canRefreshFromHr(verdict)'),'the server says which lines HR settles');
 assert.ok(page.includes("api('/api/log-books/employee-refresh',{method:'POST',body:JSON.stringify({caliberId:row.savedId,location:row.site,bookDate:row.date,kind:row.kind})})"));
 assert.ok(page.includes("{row.canRefresh&&<div className=\"employee-id-refresh cr-refresh\">"));
 assert.ok(page.includes('<small>{REFRESH_HINT}</small>'));
 assert.equal(page.includes('send to HR'),false,'there is no HR button: HR Pulse itself settles the card');
 assert.ok(scan.includes("refreshFirst={['unknown','not-listed','left'].includes(card?.raw_fields?.caliberCheck?.reason)&&!draft.employeeId}"));
 assert.ok(server.includes('hrCopy:()=>hrEmployeeCopy'),'the Fetch box reaches the copy from HR Pulse');
 for(const name of ['src/caliber-recheck.css','src/bulk-card-scanning.css'])assert.ok(readFileSync(new URL('../'+name,import.meta.url),'utf8').includes('.employee-id-refresh-button{'),name);
});
