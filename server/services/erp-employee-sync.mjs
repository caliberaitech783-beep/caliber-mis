// One-way copy of ERP (Oracle CMPL.EMPLOYEE) into Employee Master.
// ERP owns the fields in ERP_EMPLOYEE_FIELDS; Pulse-II keeps everything else
// (current site location, Caliber ID mapping, status, resignation, cost centre).
import oracle from 'oracledb';
import {employeeIdentity} from '../../shared/employee-identity.mjs';
import {ERP_EMPLOYEE_COLUMNS,ERP_EMPLOYEE_FIELDS} from '../../shared/erp-employee-fields.mjs';
export {ERP_EMPLOYEE_COLUMNS,ERP_EMPLOYEE_FIELDS};

const name=(table,key,label,column)=>`(SELECT MAX(x.${label}) FROM CMPL.${table} x WHERE x.${key}=${column})`;
const day=column=>`TO_CHAR(${column},'YYYY-MM-DD')`;

// About half the employees have no EMPLOYEECURRENTSTATUS row; their current department and designation are the base ones.
// Each ERP lookup is a scalar subquery so a repeated code in a lookup table cannot duplicate an employee row.
export const ERP_EMPLOYEE_QUERY=`SELECT e.TNO,e.EMPLOYEECODE,e.EMPLOYEEID,e.EMPLOYEENAME,e.EMPLOYEESHORTNAME,e.FATHERNAME,e.HUSBANDNAME,e.GENDER,e.MARITALSTATUS,e.BLOODGROUP,
 ${day('e.DATEOFBIRTH')} DATEOFBIRTH,${day('e.DATEOFAPPOINTMENT')} DATEOFAPPOINTMENT,${day('e.DATEOFJOINING')} DATEOFJOINING,${day('e.DRIVINGLICENSEEXPIRYDATE')} DRIVINGLICENSEEXPIRYDATE,
 e.DEPARTMENTCODE,${name('DEPARTMENT','DEPARTMENTCODE','DEPARTMENTNAME','e.DEPARTMENTCODE')} DEPARTMENTNAME,
 e.DESIGNATIONCODE,${name('DESIGNATION','DESIGNATIONCODE','DESIGNATIONNAME','e.DESIGNATIONCODE')} DESIGNATIONNAME,
 ${name('DEPARTMENT','DEPARTMENTCODE','DEPARTMENTNAME','NVL(cs.DEPARTMENTCODE,e.DEPARTMENTCODE)')} CURRENTDEPARTMENTNAME,
 ${name('DESIGNATION','DESIGNATIONCODE','DESIGNATIONNAME','NVL(cs.DESIGNATIONCODE,e.DESIGNATIONCODE)')} CURRENTDESIGNATIONNAME,
 e.LOCATIONCODE,${name('LOCATION','LOCATIONCODE','LOCATIONNAME','e.LOCATIONCODE')} LOCATIONNAME,
 e.SHIFTCODE,${name('SHIFT','SHIFTCODE','SHIFTNAME','e.SHIFTCODE')} SHIFTNAME,
 e.STAFFTYPECODE,${name('STAFFTYPE','STAFFTYPECODE','STAFFTYPENAME','e.STAFFTYPECODE')} STAFFTYPENAME,
 e.EMPLOYEETYPECODE,${name('EMPLOYEETYPE','EMPLOYEETYPECODE','EMPLOYEETYPENAME','e.EMPLOYEETYPECODE')} EMPLOYEETYPENAME,
 e.COMPANYCODE,${name('COMPANY','COMPANYCODE','COMPANYNAME','e.COMPANYCODE')} COMPANYNAME,
 e.LEAVESCHEMECODE,${name('LEAVESCHEME','LEAVESCHEMECODE','LEAVESCHEMENAME','e.LEAVESCHEMECODE')} LEAVESCHEMENAME,
 e.SALARYSCHEMECODE,${name('SALARYSCHEME','SALARYSCHEMECODE','SALARYSCHEMENAME','e.SALARYSCHEMECODE')} SALARYSCHEMENAME,
 e.SKILLSCODE,${name('SKILLS','SKILLSCODE','SKILLSNAME','e.SKILLSCODE')} SKILLSNAME,
 ${name('WORKCENTRE','WORKCENTRECODE','WORKCENTRENAME','e.WORKCENTRECODE')} WORKCENTRENAME,
 ${name('MONEYTRANSFERMODE','MONEYTRANSFERMODECODE','MONEYTRANSFERMODENAME','e.MONEYTRANSFERMODECODE')} PAYMENTMODENAME,
 e.BANKCODE,${name('BANK','BANKCODE','BANKNAME','e.BANKCODE')} BANKNAME,e.IFSCCODE,e.BANKACCOUNTNO,
 e.PRESENTADDRESS,${name('CITY','CITYCODE','CITYNAME','e.PRESENTCITYCODE')} PRESENTCITY,${name('STATE','STATECODE','STATENAME','e.PRESENTSTATECODE')} PRESENTSTATE,e.PRESENTPHONENO,
 e.PERMANENTADDRESS,${name('CITY','CITYCODE','CITYNAME','e.PERMANENTCITYCODE')} PERMANENTCITY,${name('STATE','STATECODE','STATENAME','e.PERMANENTSTATECODE')} PERMANENTSTATE,
 e.OFFICEMOBILENO,e.OFFICEEMAILID,e.PERSONALMOBILENO,e.PERSONALEMAILID,e.MONTHLYCTC,e.SALARYACCOUNTCODE,
 e.PFDEDUCTIONON,e.ISESICAPPLICABLE,e.OFFDAY,e.ISHOD,e.CANALLOWVISITOR,e.ISSIGNATORY,e.ISGROUPSIGNATORY,e.COFFALLOWED,e.ISSINGLEPUNCHALLOWED,
 NVL(e.ADHARNO,e.AADHARNO) ADHARNO,e.PFACCOUNTNO,e.ESICACCOUNTNO,e.ESICESTABLISHMENTCODENO,e.PANNO,e.UAN,e.DRIVINGLICENSENO
 FROM CMPL.EMPLOYEE e LEFT JOIN CMPL.EMPLOYEECURRENTSTATUS cs ON cs.EMPLOYEECODE=e.EMPLOYEECODE
 WHERE e.EMPLOYEEID IS NOT NULL AND TRIM(e.EMPLOYEENAME) IS NOT NULL ORDER BY e.TNO`;

export const ERP_EMPLOYEE_MAX_ROWS=100000;
// A snapshot that would mark more than this share of linked employees "Not in ERP" is refused.
export const ERP_EMPLOYEE_MISSING_LIMIT={share:0.05,minimum:50};

const text=v=>v==null?'':String(v).trim().slice(0,4000);
export function mapErpEmployee(row){
 const record=Object.fromEntries(Object.entries(ERP_EMPLOYEE_COLUMNS).map(([field,column])=>[field,text(row[column])]));
 record.caliberId=record.caliberId.toUpperCase();
 record.employeeId=record.caliberId;
 return record;
}

export async function readErpEmployees(config){
 const c=await oracle.getConnection({...config,connectTimeout:15,transportConnectTimeout:10});
 try{
  c.callTimeout=180000;
  await c.execute('SET TRANSACTION READ ONLY');
  const result=await c.execute(ERP_EMPLOYEE_QUERY,{},{outFormat:oracle.OUT_FORMAT_OBJECT,maxRows:ERP_EMPLOYEE_MAX_ROWS+1,fetchArraySize:1000});
  if(result.rows.length>ERP_EMPLOYEE_MAX_ROWS)throw new Error('ERP employee list exceeds the supported size. The last good copy was retained.');
  return result.rows.map(mapErpEmployee);
 }finally{await c.close();}
}

export function validateErpEmployees(rows){
 if(!Array.isArray(rows)||!rows.length)throw new Error('ERP returned an empty employee list. The last good copy was retained.');
 const ids=new Set(),codes=new Set();
 for(const row of rows){
  if(!row.caliberId||!row.name||!row.employeeCode)throw new Error('ERP returned an employee without Employee ID, code or name. The last good copy was retained.');
  if(ids.has(row.caliberId)||codes.has(row.employeeCode))throw new Error('ERP returned duplicate Employee IDs or codes. The last good copy was retained.');
  ids.add(row.caliberId);codes.add(row.employeeCode);
 }
 return rows;
}

const same=(a,b)=>String(a??'')===String(b??'');
const recordId=data=>String(data.caliberId||data.employeeId||'').trim().toUpperCase();

// Works out every change without writing; applyErpEmployees writes the plan.
export function planErpEmployees(existing,rows,now=new Date().toISOString()){
 validateErpEmployees(rows);
 const byId=new Map(),byCode=new Map();
 for(const r of existing){
  const id=recordId(r.record_data);if(id&&!byId.has(id))byId.set(id,r);
  const code=String(r.record_data.employeeCode||'').trim();if(code)byCode.set(code,byCode.has(code)?null:r);
 }
 const erpIds=new Set(rows.map(r=>r.caliberId)),used=new Set(),updates=[],inserts=[];let unchanged=0;
 for(const row of rows){
  let prev=byId.get(row.caliberId);
  // An Employee ID changed in ERP: the same ERP employee code keeps the same local record and its links.
  if(!prev){const byErpCode=byCode.get(row.employeeCode);if(byErpCode&&!erpIds.has(recordId(byErpCode.record_data))&&!used.has(byErpCode.id))prev=byErpCode;}
  if(prev&&used.has(prev.id))prev=undefined;
  if(prev){
   used.add(prev.id);
   const saved=prev.record_data;
   const changed=prev.master_name!=='Employee master'||saved.erpMissing===true||ERP_EMPLOYEE_FIELDS.some(k=>!same(saved[k],row[k]));
   if(!changed){unchanged++;continue;}
   const merged={...saved,...row};
   const identity=employeeIdentity(merged);
   merged.caliberCode=identity.caliberCode;
   merged.currentLocation=saved.currentLocation??'';
   merged.site=merged.currentLocation||saved.site||row.locationName||'';
   Object.assign(merged,{erpMissing:false,employeeSyncSource:'ERP',erpSyncedAt:now,employeeMasterRevision:Number(saved.employeeMasterRevision||0)+1});
   updates.push({id:prev.id,data:merged});
  }else{
   const identity=employeeIdentity({...row});
   inserts.push({...row,caliberCode:identity.caliberCode,currentLocation:'',site:row.locationName,source:'ERP',employeeSyncSource:'ERP',erpMissing:false,erpSyncedAt:now,employeeMasterRevision:1});
  }
 }
 const missing=existing.filter(r=>!used.has(r.id)&&r.record_data.erpMissing!==true);
 return {updates,inserts,missing,unchanged,total:rows.length};
}

export async function applyErpEmployees(pool,rows,{dryRun=false}={}){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(709224109)');
  const existing=(await c.query("SELECT id,master_name,record_data FROM master_records WHERE master_name IN('Employee master','ERP Employee master')")).rows;
  const plan=planErpEmployees(existing,rows);
  const linked=existing.length;
  if(plan.missing.length>Math.max(ERP_EMPLOYEE_MISSING_LIMIT.minimum,linked*ERP_EMPLOYEE_MISSING_LIMIT.share))
   throw new Error(`ERP is missing ${plan.missing.length.toLocaleString('en-IN')} of ${linked.toLocaleString('en-IN')} employees in Employee Master, which is too many to be a normal change. Nothing was changed; check the ERP before syncing again.`);
  const summary={total:plan.total,added:plan.inserts.length,updated:plan.updates.length,unchanged:plan.unchanged,notInErp:plan.missing.length};
  if(dryRun){await c.query('ROLLBACK');return {...summary,dryRun:true};}
  for(let i=0;i<plan.updates.length;i+=500)
   await c.query("UPDATE master_records m SET master_name='Employee master',record_data=v.d FROM jsonb_to_recordset($1::jsonb) AS v(id bigint,d jsonb) WHERE m.id=v.id",[JSON.stringify(plan.updates.slice(i,i+500).map(u=>({id:u.id,d:u.data})))]);
  for(let i=0;i<plan.inserts.length;i+=500)
   await c.query("INSERT INTO master_records(master_name,record_data) SELECT 'Employee master',d FROM jsonb_array_elements($1::jsonb) AS d",[JSON.stringify(plan.inserts.slice(i,i+500))]);
  if(plan.missing.length)
   await c.query(`UPDATE master_records SET record_data=record_data||jsonb_build_object('erpMissing',true,'employeeMasterRevision',COALESCE((record_data->>'employeeMasterRevision')::bigint,0)+1) WHERE id=ANY($1::bigint[])`,[plan.missing.map(r=>r.id)]);
  await c.query('COMMIT');
  return summary;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
 finally{c.release();}
}
