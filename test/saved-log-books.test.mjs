import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {savedLogBookFilters} from '../saved-log-book-filters.mjs';
import {registerLogBooks,LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {SCAN_SCHEMA} from '../bulk-card-scanning.mjs';
import {requestedMisPage,misPageUrl} from '../src/mis-navigation.mjs';
import {misPageAllowed} from '../mis-application-access.mjs';

test('Saved VLB/ELB deep links preserve separate types and inherit the existing log-book permission',()=>{
  for(const [slug,page,permission] of [['vlb-saved','Saved VLB','Vehicle Log Book'],['elb-saved','Saved ELB','Equipment Log Book']]){
    assert.equal(requestedMisPage('?page='+slug),page);
    assert.equal(misPageUrl('https://pulse-ll.cmll.in/?page=trip-scan&batch=test&card=old',page),'/?page='+slug);
    const session={permissions:{separateMisCredentials:true,misDesktopAccess:[permission]}};
    assert.equal(misPageAllowed(session,page,'desktop'),true);
    assert.equal(misPageAllowed(session,page==='Saved VLB'?'Saved ELB':'Saved VLB','desktop'),false);
  }
});

test('saved log-book filters validate dates and escape literal search wildcards',()=>{
  assert.deepEqual(savedLogBookFilters({search:'  CARD_10%  ',from:'2026-10-01',to:'2026-10-28'}),{from:'2026-10-01',to:'2026-10-28',location:'',search:'%CARD\\_10\\%%'});
  for(const query of [{from:'2026-02-30'},{to:'bad'},{from:'2026-10-28',to:'2026-10-01'},{location:['Sasti OC']}])assert.throws(()=>savedLogBookFilters(query),{status:400});
});

test('saved records filter before pagination, stay site-scoped and serve only their associated original scan',async t=>{
  const db=new PGlite();t.after(()=>db.close());await db.exec(LOG_BOOK_SCHEMA);await db.exec(SCAN_SCHEMA);
  const insert=async(book,kind,site,date,data={})=>(await db.query('INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,$2,$3,$4,1,$5,$6,$7) RETURNING id',[book,kind,date,site,JSON.stringify({location:site,bookDate:date,...data}),randomUUID(),'test'])).rows[0].id;
  const target=await insert('VLB-OLD-TARGET','vehicle','Sasti OB','2026-10-01',{employeeName:'Local operator',caliberId:'EMP100'});
  for(let i=0;i<102;i++)await insert('VLB-'+i,'vehicle','Sasti OC','2026-10-28');
  const equipment=await insert('ELB-100','equipment','Sasti OC','2026-10-15',{jobCardNo:'JOB-ABC'});
  const other=await insert('VLB-REMOTE','vehicle','Jayant OC','2026-10-01');
  const batch=randomUUID(),card=randomUUID(),image=Buffer.from([255,216,255,217]);
  await db.query("INSERT INTO mis_scan_batches(id,kind,name,created_by) VALUES($1,'vehicle','source','test')",[batch]);
  await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status,logbook_id) VALUES($1,$2,1,'source.jpg',$3,'hash','posted',$4)",[card,batch,image,target]);
  await db.query("UPDATE mis_log_books SET data=data||$1::jsonb WHERE id=$2",[JSON.stringify({scanCardId:card}),target]);
  await db.query("UPDATE mis_log_books SET data=data||$1::jsonb WHERE id=$2",[JSON.stringify({scanCardId:card}),equipment]);
  const app=express();const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
  const requireSession=(req,res,next)=>{req.session={login:'site',role:'super',site:'Sasti OC',permissions:{separateMisCredentials:true,adminLevel:'Admin'}};next()};
  registerLogBooks(app,{pool:{query},requireSession,requireAdministrator:(req,res,next)=>next()});
  app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
  const server=app.listen(0);t.after(()=>{server.closeAllConnections();server.close()});
  const get=route=>fetch('http://127.0.0.1:'+server.address().port+route);
  const list=async query=>{const response=await get('/api/log-books/vehicle'+query);assert.equal(response.status,200);return response.json()};
  const first=await list('');assert.equal(first.records.length,100);assert.ok(first.nextCursor);
  const second=await list('?before='+first.nextCursor);assert.equal(second.records.length,3);assert.equal(second.nextCursor,null);
  assert.ok([...first.records,...second.records].every(row=>row.data.location!=='Jayant OC'));
  assert.equal((await list('?search=Local%20operator')).records[0].id,target,'search includes records beyond initial page');
  assert.equal((await list('?from=2026-10-01&to=2026-10-01&location=Sasti%20OC')).records[0].id,target,'location aliases match saved source site');
  assert.equal((await list('?search=ELB')).records.length,0,'VLB and ELB are separate');
  assert.equal((await get('/api/log-books/vehicle?location=Jayant%20OC')).status,403);
  assert.equal((await get('/api/log-books/vehicle?from=2026-02-30')).status,400);
  const source=await get('/api/log-books/vehicle/'+target+'/source-image');assert.equal(source.status,200);assert.match(source.headers.get('content-type'),/image\/jpeg/);assert.deepEqual(Buffer.from(await source.arrayBuffer()),image);
  assert.equal((await get('/api/log-books/vehicle/'+other+'/source-image')).status,404);
  assert.equal((await get('/api/log-books/equipment/'+equipment+'/source-image')).status,404,'cannot borrow another record’s scan');
});
