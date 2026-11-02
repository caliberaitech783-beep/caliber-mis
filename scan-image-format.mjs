import {sniffScanImageType,scanImageExtension} from './public/scan-image-type.mjs';
export const scanImageMime=bytes=>sniffScanImageType(bytes);
export {scanImageExtension};
export const SCAN_IMAGE_TYPES=['image/png','image/jpeg','image/webp'];
function webpDimensions(bytes){
 // RIFF container: chunk four-character code at 12, payload at 20.
 if(bytes.length<30)return null;
 const chunk=bytes.subarray(12,16).toString('latin1');
 if(chunk==='VP8X')return {width:bytes.readUIntLE(24,3)+1,height:bytes.readUIntLE(27,3)+1};
 if(chunk==='VP8L'&&bytes[20]===0x2f){const bits=bytes.readUInt32LE(21);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
 if(chunk==='VP8 '&&bytes[23]===0x9d&&bytes[24]===0x01&&bytes[25]===0x2a)return {width:bytes.readUInt16LE(26)&0x3fff,height:bytes.readUInt16LE(28)&0x3fff};
 return null;
}
export function scanImageDimensions(bytes){
 let width=0,height=0;
 if(bytes.length>=24&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'){
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
 }else if(scanImageMime(bytes)==='image/webp'){
  const size=webpDimensions(bytes);if(size){width=size.width;height=size.height;}
 }else if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9){
  let offset=2;
  while(offset+3<bytes.length){
   if(bytes[offset++]!==0xff)break;while(bytes[offset]===0xff)offset++;
   const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
   if(offset+2>bytes.length)break;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}
   offset+=length;
  }
 }
 if(!width||!height)throw Error('Invalid PNG, JPEG or WebP scan.');
 if(width*height>20000000)throw Error('Scan must contain at most 20 million pixels.');
 return {width,height};
}
