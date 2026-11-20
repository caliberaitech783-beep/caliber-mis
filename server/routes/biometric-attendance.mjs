// Biometric integration (owner, 20 Nov 2026): the punches exported from the biometric device are uploaded here and kept
// one line per employee code and date (first In, last Out, site). Attendance Management > Mismatch attendance and the
// Attendance Regularization pages compare them with trip card attendance (shared/attendance-mismatch.mjs).
// The routes sit under /api/reports, so the Reports menu right and the login's sites decide who reads and uploads.
import {siteAllowed} from '../../shared/log-book-access.mjs';
import {employeeCode} from '../../shared/attendance-mismatch.mjs';

export const BIOMETRIC_PUNCH_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_biometric_punches(
 caliber_code TEXT NOT NULL,punch_date DATE NOT NULL,in_time TEXT NOT NULL DEFAULT '',out_time TEXT NOT NULL DEFAULT '',
 site TEXT NOT NULL DEFAULT '',employee_name TEXT NOT NULL DEFAULT '',source_file TEXT NOT NULL DEFAULT '',
 uploaded_by TEXT NOT NULL DEFAULT '',uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(caliber_code,punch_date));`;
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

export function registerBiometricAttendance(app,{pool,protect,ensureBooks}){
 let ready;
 const ensure=async()=>{await ensureBooks?.();return ready??=pool.query(BIOMETRIC_PUNCH_SCHEMA).catch(error=>{ready=null;throw error;});};

 app.get('/api/reports/biometric-punches',...protect,async(req,res,next)=>{
  try{
   const {from,to}=req.query;
   if(!validDate(from)||!validDate(to)||to<from)return fail(res,400,'Select a valid From and To date.');
   if((Date.parse(to)-Date.parse(from))/86400000>BIOMETRIC_MAX_DAYS)return fail(res,400,`Select up to ${BIOMETRIC_MAX_DAYS} days.`);
   await ensure();
   const {rows}=await pool.query(`SELECT caliber_code,punch_date::text AS date,in_time,out_time,site,employee_name,source_file,uploaded_by,uploaded_at
    FROM mis_biometric_punches WHERE punch_date BETWEEN $1 AND $2 ORDER BY punch_date,site,caliber_code LIMIT ${BIOMETRIC_MAX_ROWS*2+1}`,[from,to]);
   const scope=req.logBookScope;
   const punches=rows.filter(r=>r.site?siteAllowed(scope,r.site):scope?.sites===null).map(r=>({caliberCode:r.caliber_code,date:r.date,inTime:r.in_time,outTime:r.out_time,site:r.site,
    employeeName:r.employee_name,sourceFile:r.source_file,uploadedBy:r.uploaded_by,uploadedAt:r.uploaded_at}));
   res.set('Cache-Control','private, no-store').json({punches,truncated:rows.length>BIOMETRIC_MAX_ROWS*2});
  }catch(error){next(error);}
 });

 // Upload: lines already read from the device export in the browser. A line for the same employee code and date replaces
 // the earlier one, so the same export can be uploaded again after a correction on the device.
 app.post('/api/reports/biometric-punches',...protect,async(req,res,next)=>{
  try{
   const {rows,fileName}=req.body||{};
   if(!Array.isArray(rows)||!rows.length)return fail(res,400,'The file has no punch lines.');
   if(rows.length>BIOMETRIC_MAX_ROWS)return fail(res,400,`Upload up to ${BIOMETRIC_MAX_ROWS} lines at a time.`);
   const lines=[],refused=[];
   rows.forEach((row,i)=>{const r=biometricLine(row,req.logBookScope);if(r.error)refused.push(`Line ${i+1}: ${r.error}`);else lines.push(r.line);});
   if(refused.length)return res.status(400).json({error:`${refused.length} line(s) could not be saved. Nothing was saved.`,refused:refused.slice(0,50)});
   const unique=[...new Map(lines.map(l=>[l.caliberCode+'|'+l.date,l])).values()];
   await ensure();
   const by=clip(req.session?.login||req.session?.name||req.session?.username,120),file=clip(fileName,200);
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    for(let at=0;at<unique.length;at+=2000){
     const part=unique.slice(at,at+2000),col=f=>part.map(l=>l[f]);
     await client.query(`INSERT INTO mis_biometric_punches(caliber_code,punch_date,in_time,out_time,site,employee_name,source_file,uploaded_by)
      SELECT c,d::date,i,o,s,n,$7,$8 FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[]) AS t(c,d,i,o,s,n)
      ON CONFLICT(caliber_code,punch_date) DO UPDATE SET in_time=EXCLUDED.in_time,out_time=EXCLUDED.out_time,site=EXCLUDED.site,
      employee_name=EXCLUDED.employee_name,source_file=EXCLUDED.source_file,uploaded_by=EXCLUDED.uploaded_by,uploaded_at=NOW()`,
     [col('caliberCode'),col('date'),col('inTime'),col('outTime'),col('site'),col('employeeName'),file,by]);
    }
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
   finally{client.release();}
   res.json({saved:unique.length});
  }catch(error){next(error);}
 });
}
