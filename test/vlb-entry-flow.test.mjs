import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerVlbBatches} from '../vlb-batches.mjs';
import {syncVlbBatchRecord} from '../vlb-batch-policy.mjs';
import {vlbEntryContext,vlbEntryFields,sameVlbEntryContext} from '../src/vlb-entry-context.mjs';

test('selected batch fixes manual and scan context with the effective site shift',()=>{
 const batch={site:'Jayant OB',report_date:'2026-10-31',shift:'S1'};
 const options={shifts:[{id:1,site:'Sasti OC',shiftCode:'I'},{id:2,site:'Jayant OB',shiftCode:'I',effectiveTo:'2026-10-30'},{id:3,site:'Jayant OB',shiftCode:'I',effectiveFrom:'2026-10-31'}]};
 const fields=vlbEntryFields(batch,options);assert.equal(fields.shiftId,'3');assert.equal(fields.bookDate,'2026-10-31');assert.equal(fields.shiftHours,8);assert.equal(fields.cardShift,'I');assert.ok(sameVlbEntryContext(batch,fields));assert.ok(sameVlbEntryContext(batch,vlbEntryContext(batch)));
 for(const patch of [{location:'Sasti OC'},{bookDate:'2026-10-30'},{cardShift:'II'}])assert.equal(sameVlbEntryContext(batch,{...vlbEntryContext(batch),...patch}),false);
});

test('empty batches accept repeated manual and scan cards; admin can use other authorized sites',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,site TEXT,book_date DATE,data JSONB,revision INTEGER DEFAULT 1,created_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),deleted_at TIMESTAMPTZ)');
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const protect=[(req,res,next)=>{const user=req.headers.authorization;req.session={login:user,role:user==='admin'?'super':'normal',permissions:user==='admin'?{adminLevel:'Admin'}:{}};req.logBookScope={sites:user==='restricted'?['jayant ob']:null};next()}];
 registerVlbBatches(app,{pool,protect,ensureBooks:async()=>{},getActor:async s=>({login:s.login,mis:true,pm:false,pmScope:{sites:[]}})});
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(path='',body,user='alice')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/vlb-batches'+path,{method:body?'POST':'GET',headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const create=(site,user='alice',shift='S1')=>call('',{site,date:'2026-10-31',shift,requestKey:randomUUID()},user);
 const created=await create('Jayant OB');assert.equal(created.status,201,JSON.stringify(created.data));const batch=created.data;assert.equal(batch.entry_count,0);assert.equal(batch.closed_at,null);assert.ok(batch.continuous_entry);
 for(const [index,scan] of [false,true,false,true].entries()){
  const record={id:index+1,book_no:'VLB-'+index,book_type:'vehicle',data:{location:'Jayant OB',bookDate:'2026-10-31',bookShiftCode:'S1',...(scan?{scanCardId:randomUUID()}:{}),door:'V07'}};
  await db.query('INSERT INTO mis_log_books(id,book_no,book_type,site,book_date,data,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[record.id,record.book_no,record.book_type,record.data.location,record.data.bookDate,JSON.stringify(record.data),'alice']);
  await syncVlbBatchRecord(pool,record,'alice');
  const current=await call('/'+batch.id);assert.equal(current.data.entry_count,index+1);assert.equal(current.data.closed_at,null,'each save leaves continuous batch open');
 }
 const found=await call('',undefined,'bob');assert.ok(found.data.batches.some(b=>b.id===batch.id&&!b.closed_at),'same batch discoverable by either entry mode');
 assert.equal((await create('Sasti OC')).status,409,'ordinary user must finish the open batch');
 const a=await create('Sasti OC','admin'),b=await create('Jayant OB','admin','S2');assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(b.status,201,JSON.stringify(b.data));assert.equal(a.data.closed_at,null);assert.equal(b.data.closed_at,null);assert.equal(a.data.created_by,'admin');assert.equal(b.data.created_by,'admin');assert.ok(a.data.canClose&&b.data.canClose);assert.equal((await call('/'+a.data.id+'/close',{},'admin')).status,200);assert.equal((await call('/'+b.data.id,undefined,'admin')).data.closed_at,null);
 assert.equal((await create('Sasti OC','restricted','S2')).status,403,'admin flow does not bypass site authorization');
 assert.equal((await create('Jayant OB','bob')).status,409,'same scope cannot create a duplicate');
 assert.equal((await call('/'+batch.id+'/close',{})).status,200);
 await assert.rejects(()=>syncVlbBatchRecord(pool,{id:8,book_no:'VLB-8',book_type:'vehicle',data:{location:'Jayant OB',bookDate:'2026-10-31',bookShiftCode:'S1'}},'alice'),/closed/);
});

test('batch selection offers the requested entry action and passes the same batch to either editor',async()=>{
 const fs=await import('node:fs');const React=(await import('react')).default;const {renderToStaticMarkup}=await import('react-dom/server');const {transformWithOxc}=await import('vite');
 const source=fs.readFileSync(new URL('../src/vlb-entry-workspace.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function');
 const {code}=await transformWithOxc(source,'vlb-entry-workspace.jsx',{jsx:{runtime:'classic'}});
 const batch={id:randomUUID(),name:'Jayant 31 Oct S1',site:'Jayant OB',report_date:'2026-10-31',shift:'S1',closed_at:null,canClose:true,canContinue:true};
 const nodes=(tree,predicate)=>{const found=[];const walk=n=>{if(Array.isArray(n))return n.forEach(walk);if(!React.isValidElement(n))return;if(predicate(n))found.push(n);walk(n.props.children)};walk(tree);return found};
 for(const mode of ['manual','scan']){
  const slots=[];let cursor=0;const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]};
  const Picker=()=>null,Editor=()=>null;const saved=[];let closed=false;
  const fetch=async()=>({ok:true,json:async()=>({...batch,closed_at:closed?'locked':null})});
  const workspace=new Function('React','useState','useEffect','VlbCreateBatch','fetch','sessionStorage','window',code+';return VlbEntryWorkspace')(React,useState,()=>{},Picker,fetch,{setItem:(...v)=>saved.push(v)},{location:{href:'https://example.test/?page=trip-scan&batch=old'},history:{replaceState(){}}});
  const render=()=>{cursor=0;return workspace({kind:'vehicle',session:{login:'alice',token:'test'},mode,children:React.createElement(Editor)})};
  nodes(render(),n=>n.type===Picker)[0].props.onSelected(batch);
  const title=mode==='manual'?'Manual entry':'Scan / Upload files';let tree=render();assert.ok(saved.some(v=>v[1]===batch.id));
  await nodes(tree,n=>n.type==='button'&&n.props.children===title)[0].props.onClick();tree=render();assert.equal(nodes(tree,n=>n.type===Editor)[0].props.vlbBatch.id,batch.id);
  nodes(tree,n=>n.type==='button'&&n.props.children==='Search / change batch')[0].props.onClick();nodes(render(),n=>n.type===Picker)[0].props.onSelected(batch);closed=true;
  await nodes(render(),n=>n.type==='button'&&n.props.children===title)[0].props.onClick();tree=render();assert.equal(nodes(tree,n=>n.type===Editor).length,0);assert.match(renderToStaticMarkup(tree),/has been locked/);
 }
});
