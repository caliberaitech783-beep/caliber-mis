import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

function segment(value){
 const original=String(value||'Unknown location').normalize('NFC');
 let clean=original.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,90)||'Unknown location';
 if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(clean))clean='_'+clean;
 return clean+'-'+createHash('sha256').update(original).digest('hex').slice(0,6);
}
export function archiveRelativePath(batch,card){
 if(!/^[a-f0-9-]{36}$/i.test(batch.id)||!['vehicle','equipment'].includes(batch.kind))throw Error('Invalid archive batch.');
 const date=String(card.draft?.bookDate||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('A valid card date is required for the archive.');
 return path.join(batch.kind==='vehicle'?'Trip Card':'Job Card',date,segment(card.draft.location),batch.id);
}
// Writes to a local test folder or the persistent Pulse-II App Service volume.
// No credentials enter the archive; folders retain originals and saved data.
export function createLocalCardArchive(root,{target:storageTarget='local'}={}){
 if(!['local','azure'].includes(storageTarget))throw Error('Invalid archive target.');
 const base=path.resolve(root);
 return async function archive(batch,cards){
  if(!cards.length||cards.some(c=>c.status!=='posted'||!c.checked_by))throw Error('Only a fully saved batch can be archived.');
  const groups=new Map();
  for(const card of cards){
   if(!/^[a-f0-9-]{36}$/i.test(card.id))throw Error('Invalid archive card.');
   const relative=archiveRelativePath(batch,card);if(!groups.has(relative))groups.set(relative,[]);groups.get(relative).push(card);
  }
  const folders=[];
  for(const [relative,rows] of groups){
   const target=path.resolve(base,relative);
   if(!target.startsWith(base+path.sep))throw Error('Invalid archive folder.');
   await fs.mkdir(path.dirname(target),{recursive:true});
   const manifest={version:1,batchId:batch.id,kind:batch.kind,cards:rows.map(c=>({id:c.id,ordinal:c.ordinal,filename:c.filename,bookNumber:c.book_no,logBookId:c.logbook_id,saveMode:c.draft?.scanSaveMode||'manual-review',checkedBy:c.checked_by,checkedAt:c.checked_at,draft:c.draft,originalExtraction:c.raw_fields,image:c.id+'.png',imageSha256:createHash('sha256').update(c.image).digest('hex')}))};
   const serialized=JSON.stringify(manifest,null,2)+'\n';
   try{const prior=await fs.readFile(path.join(target,'saved-values.json'),'utf8');if(prior!==serialized)throw Error('An archive with different saved values already exists.');folders.push(relative);continue;}catch(e){if(e.code!=='ENOENT')throw e;}
   const staging=target+'.pending-'+randomUUID();await fs.mkdir(staging);
   for(const row of rows)await fs.writeFile(path.join(staging,row.id+'.png'),row.image);
   await fs.writeFile(path.join(staging,'saved-values.json'),serialized);
   await fs.rename(staging,target);folders.push(relative);
  }
  return {status:'saved',target:storageTarget,azureUploadEnabled:storageTarget==='azure',folders};
 };
}

export function scanArchiveConfig(env=process.env){
 if(env.MIS_LOCAL_SCANNER_DATABASE==='true')return env.LOCAL_SCAN_ARCHIVE_ROOT?{root:env.LOCAL_SCAN_ARCHIVE_ROOT,target:'local'}:null;
 if(env.WEBSITE_SITE_NAME==='caliber-mis-783')return {root:env.MIS_SCAN_ARCHIVE_ROOT||'/home/data/caliber-mis/scanned-cards',target:'azure'};
 return null;
}
