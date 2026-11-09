import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {registerShiftAttendance,SHIFT_ATTENDANCE_SCHEMA} from '../server/routes/shift-attendance.mjs';

test('VLB and ELB save attendance without an asset and update the same shift record',async t=>{
 const pool=new PGlite();
 t.after(()=>pool.close());
 await pool.exec(`CREATE TABLE master_records (id BIGINT PRIMARY KEY, master_name TEXT, record_data JSONB);
  INSERT INTO master_records VALUES
   (1,'Employee master','{"name":"Driver","site":"Sasti OC"}'),
   (2,'Shift Master','{"shiftCode":"A","site":"Sasti OC"}');`+SHIFT_ATTENDANCE_SCHEMA);
 let handler;
 registerShiftAttendance({post(path,...steps){assert.equal(path,'/api/shift-attendance');handler=steps.at(-1);}},
  {pool,protect:[],ensureBooks:async()=>{}});
 const save=async (overrides={})=>{
  let status=200,payload;
  await handler({
   session:{login:'supervisor'},logBookScope:{sites:['sasti ob']},
   body:{kind:'vehicle',bookDate:'2026-11-10',location:'Sasti OC',shiftId:'2',employeeId:'1',assetId:'',reason:'Rain',...overrides}
  },{status(value){status=value;return this;},json(value){payload=value;}},error=>{throw error;});
  return {status,payload};
 };
 assert.equal((await save({reason:'Other',remarks:'   '})).status,400);
 assert.equal((await save({location:'Jayant OC'})).status,403);
 assert.equal((await save({assetId:'3'})).status,400);
 assert.deepEqual((await save()).payload,{present:true,trips:0});
 assert.equal((await save({kind:'equipment',location:'Sasti OB',reason:'Other',remarks:'Work suspended'})).status,200);
 const {rows}=await pool.query('SELECT site,shift,asset_id,kind,reason,remarks FROM mis_shift_attendance');
 assert.deepEqual(rows,[{site:'sasti ob',shift:'S1',asset_id:null,kind:'equipment',reason:'Other',remarks:'Work suspended'}]);
});
