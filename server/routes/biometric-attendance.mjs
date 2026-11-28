import {readBiometricShifts} from '../services/biometric-shifts.mjs';
import {cShiftDays,adjacentDate} from '../../shared/c-shift-punches.mjs';
// Biometric integration (owner, 20 Nov 2026): the punches exported from the biometric device are uploaded here and kept
// one line per employee code and date (first In, last Out, site). Attendance Management > Mismatch attendance and the
// Attendance Regularization pages compare them with trip card attendance (shared/attendance-mismatch.mjs).
// The routes sit under /api/reports, so the Reports menu right and the login's sites decide who reads and uploads.
// Owner, 23 Nov 2026: a device that knows people by their A Form no. is read through A Form Master. The A Form no. is
// changed to the CMLL number of that site before the line is kept (shared/biometric-a-form.mjs), and kept beside it.
import {siteAllowed} from '../../shared/log-book-access.mjs';
import {employeeCode} from '../../shared/attendance-mismatch.mjs';
import {resolveBiometricCodes,BIOMETRIC_CODE_KINDS} from '../../shared/biometric-a-form.mjs';
import {readAFormPeople} from '../services/a-form-people-index.mjs';

export const BIOMETRIC_PUNCH_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_biometric_punches(
 caliber_code TEXT NOT NULL,punch_date DATE NOT NULL,in_time TEXT NOT NULL DEFAULT '',out_time TEXT NOT NULL DEFAULT '',
 site TEXT NOT NULL DEFAULT '',employee_name TEXT NOT NULL DEFAULT '',source_file TEXT NOT NULL DEFAULT '',
 uploaded_by TEXT NOT NULL DEFAULT '',uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(caliber_code,punch_date));`;
// The A Form no. the device gave, kept beside the CMLL number it was changed to (23 Nov 2026). Its own statement:
// the table already exists on live.
export const BIOMETRIC_A_FORM_COLUMN="ALTER TABLE mis_biometric_punches ADD COLUMN IF NOT EXISTS a_form_no TEXT NOT NULL DEFAULT ''";
export const BIOMETRIC_MAX_ROWS=20000,BIOMETRIC_MAX_DAYS=31;

const ISO=/^\d{4}-\d{2}-\d{2}$/,TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/,CODE=/^[A-Z0-9][A-Z0-9/_-]{0,29}$/;
const validDate=d=>{if(!ISO.test(String(d)))return false;const t=new Date(d+'T00:00:00Z');return !Number.isNaN(t.getTime())&&t.toISOString().slice(0,10)===d;};
const clip=(v,n)=>String(v??'').trim().slice(0,n);
const fail=(res,status,error)=>res.status(status).json({error});

// Checks one uploaded line; returns the stored line or the reason it is refused.
export function biometricLine(row,scope){
 const code=employeeCode(row?.caliberCode),date=String(row?.date||''),inTime=String(row?.inTime||''),outTime=String(row?.outTime||'');
 if(!CODE.test(code))return {error:'employee code not readable'};
 if(!validDate(date))return {error:'date not readable'};
 if(inTime&&!TIME.test(inTime)||outTime&&!TIME.test(outTime))return {error:'time not readable'};
 if(!inTime&&!outTime)return {error:'no In or Out punch'};
 const site=clip(row?.site,120);
 if(site?!siteAllowed(scope,site):scope?.sites!==null)return {error:site?`site ${site} is not assigned to your login`:'site missing (your login holds only some sites)'};
 return {line:{caliberCode:code,date,inTime,outTime,site,employeeName:clip(row?.employeeName,120)}};
}

// readIndex: the employee lists and A Form Master together (server/services/a-form-people-index.mjs); a test passes its own.
export function registerBiometricAttendance(app,{pool,protect,ensureBooks,readIndex=readAFormPeople}){
 let ready;
 const ensure=async()=>{await ensureBooks?.();return ready??=pool.query(BIOMETRIC_PUNCH_SCHEMA).then(()=>pool.query(BIOMETRIC_A_FORM_COLUMN)).catch(error=>{ready=null;throw error;});};

 app.get('/api/reports/biometric-punches',...protect,async(req,res,next)=>{
  try{
   const {from,to}=req.query;
   if(!validDate(from)||!validDate(to)||to<from)return fail(res,400,'Select a valid From and To date.');
   if((Date.parse(to)-Date.parse(from))/86400000>BIOMETRIC_MAX_DAYS)return fail(res,400,`Select up to ${BIOMETRIC_MAX_DAYS} days.`);
   await ensure();
   const shiftDates=req.query.shiftDates==='1',masters=shiftDates?await readBiometricShifts(pool):[];
   const {rows}=await pool.query(`SELECT caliber_code,punch_date::text AS date,in_time,out_time,site,employee_name,source_file,uploaded_by,uploaded_at,a_form_no
    FROM mis_biometric_punches WHERE punch_date BETWEEN $1 AND $2 ORDER BY punch_date,site,caliber_code LIMIT ${BIOMETRIC_MAX_ROWS*2+1}`,[shiftDates?adjacentDate(from,-1):from,shiftDates?adjacentDate(to,1):to]);
   const scope=req.logBookScope;
   const punches=rows.filter(r=>r.site?siteAllowed(scope,r.site):scope?.sites===null).map(r=>({caliberCode:r.caliber_code,date:r.date,inTime:r.in_time,outTime:r.out_time,site:r.site,
    employeeName:r.employee_name,sourceFile:r.source_file,uploadedBy:r.uploaded_by,uploadedAt:r.uploaded_at,aFormNo:r.a_form_no||''}));
   res.set('Cache-Control','private, no-store').json({punches:shiftDates?cShiftDays(punches,{masters}).filter(p=>p.date>=from&&p.date<=to):punches,masters,truncated:rows.length>BIOMETRIC_MAX_ROWS*2});
  }catch(error){next(error);}
 });

 // Upload: lines already read from the device export in the browser. A line for the same employee code and date replaces
 // the earlier one, so the same export can be uploaded again after a correction on the device.
 // codeKind says what the code column of the file is: "auto" (found per site), "caliber" (CMLL id) or "aform" (A Form no.).
 app.post('/api/reports/biometric-punches',...protect,async(req,res,next)=>{
  try{
   const {rows,fileName}=req.body||{},codeKind=BIOMETRIC_CODE_KINDS.includes(req.body?.codeKind)?req.body.codeKind:'auto';
   if(!Array.isArray(rows)||!rows.length)return fail(res,400,'The file has no punch lines.');
   if(rows.length>BIOMETRIC_MAX_ROWS)return fail(res,400,`Upload up to ${BIOMETRIC_MAX_ROWS} lines at a time.`);
   const lines=[],refused=[];
   rows.forEach((row,i)=>{const r=biometricLine(row,req.logBookScope);if(r.error)refused.push(`Line ${i+1}: ${r.error}`);else lines.push(r.line);});
   if(refused.length)return res.status(400).json({error:`${refused.length} line(s) could not be saved. Nothing was saved.`,refused:refused.slice(0,50)});
   // The masters are read before the transaction: the shared copy's revision check must not run inside it.
   const resolved=resolveBiometricCodes(lines,await readIndex(pool),codeKind);
   const unique=[...new Map(resolved.lines.map(l=>[l.caliberCode+'|'+l.date,l])).values()];
   const leftOut=resolved.leftOut.slice(0,50).map(row=>`${row.site}, ${row.date}, code ${row.code}: ${row.reason}`);
   if(!unique.length)return res.status(400).json({error:'No line could be saved: the codes of this file are not in A Form Master for their site. Nothing was saved.',refused:leftOut});
   await ensure();
   const by=clip(req.session?.login||req.session?.name||req.session?.username,120),file=clip(fileName,200);
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    for(let at=0;at<unique.length;at+=2000){
     const part=unique.slice(at,at+2000),col=f=>part.map(l=>l[f]||'');
     await client.query(`INSERT INTO mis_biometric_punches(caliber_code,punch_date,in_time,out_time,site,employee_name,a_form_no,source_file,uploaded_by)
      SELECT c,d::date,i,o,s,n,a,$8,$9 FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[]) AS t(c,d,i,o,s,n,a)
      ON CONFLICT(caliber_code,punch_date) DO UPDATE SET in_time=EXCLUDED.in_time,out_time=EXCLUDED.out_time,site=EXCLUDED.site,
      employee_name=EXCLUDED.employee_name,a_form_no=EXCLUDED.a_form_no,source_file=EXCLUDED.source_file,uploaded_by=EXCLUDED.uploaded_by,uploaded_at=NOW()`,
     [col('caliberCode'),col('date'),col('inTime'),col('outTime'),col('site'),col('employeeName'),col('aFormNo'),file,by]);
    }
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
   finally{client.release();}
   res.json({saved:unique.length,sites:resolved.sites,leftOut:resolved.leftOut.length,leftOutLines:leftOut});
  }catch(error){next(error);}
 });
}
