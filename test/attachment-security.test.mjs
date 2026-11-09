import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32,deflateRawSync} from 'node:zlib';
import PDFDocument from 'pdfkit';
import {validateAttachment} from '../server/rules/attachment-validation.mjs';
import {auditSubmittedFields,auditSafeError} from '../server/rules/audit-trail.mjs';

const invalid=error=>error.status===400;

function zip(parts){
 const local=[],central=[];
 let offset=0;
 for(const [path,xml] of Object.entries(parts)){
  const name=Buffer.from(path),data=Buffer.from(xml),compressed=deflateRawSync(data);
  const entry=Buffer.alloc(30),record=Buffer.alloc(46);
  entry.writeUInt32LE(0x04034b50);
  entry.writeUInt16LE(20,4);
  entry.writeUInt16LE(8,8);
  entry.writeUInt32LE(crc32(data),14);
  entry.writeUInt32LE(compressed.length,18);
  entry.writeUInt32LE(data.length,22);
  entry.writeUInt16LE(name.length,26);
  record.writeUInt32LE(0x02014b50);
  entry.copy(record,6,4,30);
  record.writeUInt32LE(offset,42);
  local.push(entry,name,compressed);
  central.push(record,name);
  offset+=entry.length+name.length+compressed.length;
 }
 const end=Buffer.alloc(22),directory=Buffer.concat(central);
 end.writeUInt32LE(0x06054b50);
 end.writeUInt16LE(Object.keys(parts).length,8);
 end.writeUInt16LE(Object.keys(parts).length,10);
 end.writeUInt32LE(directory.length,12);
 end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}

function office(kind,{mainXml,omit}={}){
 const word=kind==='docx';
 const part=word?'word/document.xml':'xl/workbook.xml';
 const family=word?'wordprocessingml':'spreadsheetml';
 const mainType=word?'document':'sheet';
 const base='http://schemas.openxmlformats.org';
 const parts={
  '[Content_Types].xml':`<Types xmlns="${base}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${family}.${mainType}.main+xml"/>${word?'':'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'}</Types>`,
  '_rels/.rels':`<Relationships xmlns="${base}/package/2006/relationships"><Relationship Id="rId1" Type="${base}/officeDocument/2006/relationships/officeDocument" Target="${part}"/></Relationships>`,
  [part]:mainXml??(word?`<w:document xmlns:w="${base}/${family}/2006/main"><w:body><w:p/></w:body></w:document>`:
   `<workbook xmlns="${base}/${family}/2006/main" xmlns:r="${base}/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  ...(word?{}:{
   'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${base}/package/2006/relationships"><Relationship Id="rId1" Type="${base}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
   'xl/worksheets/sheet1.xml':`<worksheet xmlns="${base}/${family}/2006/main"><sheetData/></worksheet>`,
  }),
 };
 delete parts[omit];
 return zip(parts);
}

async function pdf(){
 const doc=new PDFDocument();
 const chunks=[];
 const result=new Promise((resolve,reject)=>{
  doc.on('data',chunk=>chunks.push(chunk));
  doc.on('end',()=>resolve(Buffer.concat(chunks)));
  doc.on('error',reject);
 });
 doc.text('Contract attachment');
 doc.end();
 return result;
}

test('contract attachments reject active content, executable names and mismatched signatures',async()=>{
 assert.equal(await validateAttachment('summary.csv',Buffer.from('date,amount\n2026-11-04,100')),true);
 for(const [name,data] of [['contract.pdf','<script>alert(1)</script>'],['script.svg','<svg/>'],['file.exe','MZpayload'],['macro.xlsm','PK\x03\x04payload'],['photo.png','%PDF-1.7'],['readme.txt','<html>malicious</html>'],['sheet.csv','MZpayload']]){
  await assert.rejects(validateAttachment(name,Buffer.from(data)),invalid,name);
 }
});

test('contract PDFs must contain a readable document with a complete trailer',async()=>{
 const complete=await pdf();
 assert.equal(await validateAttachment('contract.pdf',complete),true);
 for(const data of [Buffer.from('%PDF-'),complete.subarray(0,-12),Buffer.from('%PDF-1.7\nxref\nstartxref\n9\n%%EOF\n')]){
  await assert.rejects(validateAttachment('contract.pdf',data),invalid);
 }
});

for(const extension of ['docx','xlsx']){
 test(`contract ${extension} uploads require an intact archive with matching Office parts`,async()=>{
  const complete=office(extension),corrupt=Buffer.from(complete);
  corrupt[30+corrupt.readUInt16LE(26)]^=0xff;
  const filename='contract.'+extension;
  assert.equal(await validateAttachment(filename,complete),true);
  for(const data of [
   Buffer.from('504b0304','hex'),
   complete.subarray(0,-12),
   corrupt,
   zip({'readme.txt':'a generic ZIP'}),
   office(extension==='docx'?'xlsx':'docx'),
   office(extension,{mainXml:'<broken>'}),
   office(extension,{omit:extension==='docx'?'word/document.xml':'xl/worksheets/sheet1.xml'}),
  ]){
   await assert.rejects(validateAttachment(filename,data),invalid);
  }
 });
}

test('MFA codes, recovery material, credentials and connection passwords are redacted from audit logs',()=>{
 const fields=auditSubmittedFields({code:'123456',recoveryCodes:['secret'],connectionString:'postgres://user:password@db/mis',note:'ordinary'});
 assert.ok(fields.slice(0,3).every(x=>x.after==='[protected]'));assert.equal(fields[3].after,'ordinary');
 assert.ok(!auditSafeError(new Error('Cannot connect postgres://user:secret-password@db/mis')).message.includes('secret-password'));
});
