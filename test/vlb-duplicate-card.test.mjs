import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerLogBooks} from '../log-book.mjs';
import {prepareVlbFixture} from './operational-fixture.mjs';

process.env.VLB_TWO_STAGE_BATCHES='0';

async function harness(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const masters=[
  [1,'Equipment master',{category:'Vehicle',door:'V07',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  [5,'Equipment master',{category:'Vehicle',door:'V08',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  [2,'C-Dir Employee master',{employee:'Driver',employeeId:'EMP1',site:'Sasti OC'}],
  [3,'Shift Master',{site:'Sasti OC',shiftName:'Shift A',shiftCode:'I'}],
  [4,'Shift Master',{site:'Sasti OC',shiftName:'Shift B',shiftCode:'II'}],
  [10,'Users & employees',{login:'alice',userType:'Mobile User',userGroup:'MIS User',site:'Sasti OC'}],
  [30,'Equipment master',{category:'Equipment',door:'VPC28',currentLocation:'Sasti OC'}],
 ];
 for(const [id,name,row] of masters)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,name,JSON.stringify(row)]);
 const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const requireSession=(req,res,next)=>{const login=req.headers.authorization;if(!login)return res.status(401).json({error:'Sign in'});req.session={login,role:'super',permissions:{adminLevel:'Admin',separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book']}};next()};
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(_req,_res,next)=>next(),getSiteScope:async()=>({sites:['sasti ob']})});
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(path,method='GET',body,user='alice')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()}};
 return {db,call};
}
const input={bookDate:'2026-12-30',location:'Sasti OC',assetId:1,employeeId:2,shiftId:3,cardShift:'I',shiftHours:8,openingKmr:0,closingKmr:10,openingHmr:100,closingHmr:106,manualBreakdownHours:0,timeMode:'without',trips:[{equipmentName:'VPC28',tripCount:2}]};

test('a second manual card for the same tipper and shift needs a reason, is audited and flagged',async t=>{
 const {db,call}=await harness(t);
 assert.equal((await call('/api/log-books/options')).status,200);
 await prepareVlbFixture(db,input,'alice');
 const first=await call('/api/log-books/vehicle','POST',{...input,requestKey:randomUUID()});assert.equal(first.status,201,JSON.stringify(first.data));
 const second=await call('/api/log-books/vehicle','POST',{...input,requestKey:randomUUID()});
 assert.equal(second.status,409);assert.equal(second.data.code,'duplicate_card');assert.equal(second.data.existing[0].bookNo,first.data.book_no);assert.match(second.data.error,new RegExp(first.data.book_no));
 const short=await call('/api/log-books/vehicle','POST',{...input,requestKey:randomUUID(),duplicateReason:'short'});assert.equal(short.status,409,'a reason under ten characters is not accepted');
 const extra=await call('/api/log-books/vehicle','POST',{...input,requestKey:randomUUID(),duplicateReason:'Card full, continuation card for second half of shift'});
 assert.equal(extra.status,201,JSON.stringify(extra.data));assert.equal(extra.data.data.duplicateReason,'Card full, continuation card for second half of shift');assert.deepEqual(extra.data.data.duplicateOf,[first.data.book_no]);
 const audit=(await db.query("SELECT detail FROM mis_vlb_batch_audit WHERE action='card_added_duplicate'")).rows;assert.equal(audit.length,1);assert.deepEqual(audit[0].detail.existing,[first.data.book_no]);
 // editing either card does not trip the rule against itself; the extra card keeps its reason
 assert.equal((await call('/api/log-books/vehicle/'+first.data.id,'PUT',{...input,closingKmr:12,revision:first.data.revision})).status,200);
 const edited=await call('/api/log-books/vehicle/'+extra.data.id,'PUT',{...input,closingKmr:14,revision:extra.data.revision});assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.data.duplicateReason,'Card full, continuation card for second half of shift');
 // the first card without a reason cannot be edited into a different tipper that already has a card
 const other=await call('/api/log-books/vehicle','POST',{...input,assetId:5,requestKey:randomUUID()});assert.equal(other.status,201);
 assert.equal((await call('/api/log-books/vehicle/'+other.data.id,'PUT',{...input,assetId:1,revision:other.data.revision})).status,409);
 // a different shift or site is a different card
 await prepareVlbFixture(db,{...input,cardShift:'II'},'alice');
 assert.equal((await call('/api/log-books/vehicle','POST',{...input,shiftId:4,cardShift:'II',requestKey:randomUUID()})).status,201);
});
