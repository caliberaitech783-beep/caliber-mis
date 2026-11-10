import {posix as path} from 'node:path';
import {crc32,inflateRawSync} from 'node:zlib';
import {DOMParser} from '@xmldom/xmldom';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import unzipper from 'unzipper';

const MAX_EXPANDED_BYTES=64*1024*1024;
const PACKAGE_RELS='http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELS=[
 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
 'http://purl.oclc.org/ooxml/officeDocument/relationships',
];
const OFFICE_TYPES={
 '.docx':{part:'word/document.xml',root:'document',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'},
 '.xlsx':{part:'xl/workbook.xml',root:'workbook',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'},
};

export async function validPdf(bytes){
 const header=bytes.subarray(0,16).toString('latin1');
 const trailer=bytes.subarray(-1024).toString('latin1').match(/startxref\s+(\d+)\s+%%EOF[\t\n\f\r ]*$/);
 if(!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header)||!trailer)return false;
 const offset=Number(trailer[1]);
 if(!Number.isSafeInteger(offset)||offset>=bytes.length||
    !/^(?:xref\s+\d+\s+\d+\s+\d{10}\s+\d{5}\s+[nf]\s|\d+\s+\d+\s+obj\s*<<)/.test(bytes.subarray(offset,offset+80).toString('latin1')))return false;
 const task=getDocument({data:new Uint8Array(bytes),stopAtErrors:true,isEvalSupported:false,enableXfa:false});
 try{
  const document=await task.promise;
  if(document.numPages<1)return false;
  await document.getPage(1);
  await document.getPage(document.numPages);
  return true;
 }finally{await task.destroy();}
}

function xmlRoot(bytes){
 const bom=bytes.length>=2?bytes.readUInt16BE(0):0;
 const encoding=bom===0xfeff?'utf-16be':bom===0xfffe?'utf-16le':'utf-8';
 const source=new TextDecoder(encoding,{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error('Office XML must not contain a DTD.');
 const reject=()=>{throw Error('Invalid Office XML.');};
 return new DOMParser({errorHandler:{warning:reject,error:reject,fatalError:reject}})
  .parseFromString(source,'application/xml').documentElement;
}

function officeRelationships(root){
 if(root?.localName!=='Relationships'||root.namespaceURI!==PACKAGE_RELS)return [];
 return Array.from(root.getElementsByTagNameNS(PACKAGE_RELS,'Relationship'));
}

function hasWorkbookSheets(workbook,relationships,names){
 const sheets=Array.from(workbook.getElementsByTagNameNS(workbook.namespaceURI,'sheet'));
 const links=officeRelationships(relationships);
 return sheets.length>0&&sheets.every(sheet=>links.some(link=>{
  const target=link.getAttribute('Target');
  const entry=target.startsWith('/')?target.slice(1):path.normalize('xl/'+target);
  return link.getAttribute('TargetMode')!=='External'&&names.has(entry)&&OFFICE_RELS.some(namespace=>
   sheet.getAttributeNS(namespace,'id')===link.getAttribute('Id')&&
   ['worksheet','chartsheet','dialogsheet'].some(type=>link.getAttribute('Type')===namespace+'/'+type));
 }));
}

export async function validOfficeDocument(bytes,extension){
 if(bytes.length<22||bytes.readUInt32LE(0)!==0x04034b50)return false;
 const end=bytes.lastIndexOf(Buffer.from('504b0506','hex'));
 if(end<0||end+22>bytes.length||end+22+bytes.readUInt16LE(end+20)!==bytes.length)return false;
 const directoryOffset=bytes.readUInt32LE(end+16);
 const count=bytes.readUInt16LE(end+10);
 if(bytes.readUInt32LE(end+4)!==0||bytes.readUInt16LE(end+8)!==count||
    !count||count>4096||directoryOffset+bytes.readUInt32LE(end+12)!==end)return false;
 const {files}=await unzipper.Open.buffer(bytes,{tailSize:bytes.length-end});
 const {part,root,type}=OFFICE_TYPES[extension];
 const required=new Map([['[Content_Types].xml',null],['_rels/.rels',null],[part,null]]);
 if(extension==='.xlsx')required.set('xl/_rels/workbook.xml.rels',null);
 const names=new Set();
 let expanded=0,centralOffset=directoryOffset;
 for(const file of files){
  const {path,flags,compressionMethod,compressedSize,uncompressedSize,offsetToLocalFileHeader:offset}=file;
  if(centralOffset+46>end||bytes.readUInt32LE(centralOffset)!==0x02014b50||file.diskNumber!==0)return false;
  centralOffset+=46+file.fileNameLength+file.extraFieldLength+file.fileCommentLength;
  expanded+=uncompressedSize;
  if(expanded>MAX_EXPANDED_BYTES||names.has(path)||/vbaProject\.bin$/i.test(path)||
     flags&1||![0,8].includes(compressionMethod)||offset+30>directoryOffset||
     bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+8)!==compressionMethod)return false;
  names.add(path);
  const nameLength=bytes.readUInt16LE(offset+26);
  const dataOffset=offset+30+nameLength+bytes.readUInt16LE(offset+28);
  if(dataOffset+compressedSize>directoryOffset||
     bytes.subarray(offset+30,offset+30+nameLength).toString('utf8')!==path)return false;
  const compressed=bytes.subarray(dataOffset,dataOffset+compressedSize);
  const content=compressionMethod===0?compressed:inflateRawSync(compressed,{maxOutputLength:Math.max(1,uncompressedSize)});
  if(content.length!==uncompressedSize||crc32(content)!==file.crc32)return false;
  if(required.has(path))required.set(path,xmlRoot(content));
 }
 if(centralOffset!==end)return false;
 const manifest=required.get('[Content_Types].xml');
 const relationships=required.get('_rels/.rels');
 const document=required.get(part);
 const namespace=extension==='.docx'?'wordprocessingml':'spreadsheetml';
 if(manifest?.localName!=='Types'||manifest.namespaceURI!=='http://schemas.openxmlformats.org/package/2006/content-types'||
    document?.localName!==root||![
     'http://schemas.openxmlformats.org/'+namespace+'/2006/main',
     'http://purl.oclc.org/ooxml/'+namespace+'/main',
    ].includes(document.namespaceURI))return false;
 if(extension==='.docx'){
  if(!document.getElementsByTagNameNS(document.namespaceURI,'body').length)return false;
 }else if(!hasWorkbookSheets(document,required.get('xl/_rels/workbook.xml.rels'),names))return false;
 return Array.from(manifest.getElementsByTagNameNS(manifest.namespaceURI,'Override')).some(node=>
  node.getAttribute('PartName')==='/'+part&&node.getAttribute('ContentType')===type)&&
  officeRelationships(relationships).some(node=>
   OFFICE_RELS.some(namespace=>node.getAttribute('Type')===namespace+'/officeDocument')&&
   node.getAttribute('TargetMode')!=='External'&&node.getAttribute('Target').replace(/^\//,'')===part);
}
