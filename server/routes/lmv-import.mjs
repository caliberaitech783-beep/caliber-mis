import {masterAccessAllows} from '../../shared/admin-access.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {isLmv} from '../../shared/equipment-kind.mjs';

const fields=['door','registration','currentLocation','equipmentName','category','group','itemName','itemSpecification',
  'acquisitionDate','make','model','manufacturerSerialNo','engineNo','chassisNo','documentStatus','assetNo','status'];
const clean=value=>String(value??'').trim().replace(/^[\s–—-]+$/u,'');
const key=value=>clean(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
const identity=record=>({
  door:key(record.door||record.doorNo||record.equipmentName),
  registration:key(record.registration||record.reg),
  chassis:key(record.chassisNo||record.chassis),
});

export async function importLmvRecords(pool,records){
  const result={inserted:0,existing:0,conflicts:0,invalid:0};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(783,42)');
    const {rows}=await client.query("SELECT record_data FROM master_records WHERE master_name='Equipment master'");
    const equipment=rows.map(row=>row.record_data);
    for(const input of records){
      const record=Object.fromEntries(fields.map(field=>[field,clean(input?.[field])]));
      const incoming=identity(record);
      const site=canonicalSiteName(record.currentLocation);
      if(!isLmv(record)||!site||!incoming.door||(!incoming.registration&&!incoming.chassis)){
        result.invalid++;
        continue;
      }
      const matches=equipment.filter(existing=>{
        const candidate=identity(existing);
        return Object.keys(incoming).some(field=>incoming[field]&&incoming[field]===candidate[field]);
      });
      if(matches.length){
        const match=matches[0], candidate=identity(match);
        const sameSite=canonicalSiteName(match.currentLocation||match.site||match.location)===site;
        const disagrees=Object.keys(incoming).some(field=>incoming[field]&&candidate[field]&&incoming[field]!==candidate[field]);
        if(matches.length===1&&isLmv(match)&&sameSite&&!disagrees)result.existing++;
        else result.conflicts++;
        continue;
      }
      record.location=record.currentLocation;
      record.chassis=record.chassisNo;
      await client.query("INSERT INTO master_records(master_name,record_data) VALUES ('Equipment master',$1::jsonb)",[JSON.stringify(record)]);
      equipment.push(record);
      result.inserted++;
    }
    await client.query('COMMIT');
    return result;
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}

export function registerLmvImport(app,{pool,requireSession,requireAdministrator}){
  app.post('/api/lmv-master/import',requireSession,requireAdministrator,async(req,res,next)=>{
    const permissions=req.session.permissions;
    if(!masterAccessAllows(permissions,'Equipment master')&&!masterAccessAllows(permissions,'Equipment master','mobileMasterAccess'))
      return res.status(403).json({error:'Equipment Master access is required.'});
    const records=req.body?.records;
    if(!Array.isArray(records)||!records.length||records.length>1000)return res.status(400).json({error:'Select an Excel export containing 1 to 1,000 LMV rows.'});
    try{res.json(await importLmvRecords(pool,records));}
    catch(error){next(error);}
  });
}
