// Byte sniffing shared by the browser, the PC connector and the server.
// Scan images are PNG, JPEG or WebP; anything else is treated as PNG and
// rejected later by the dimension check.
const RIFF=[0x52,0x49,0x46,0x46],WEBP=[0x57,0x45,0x42,0x50];
export function sniffScanImageType(bytes){
 if(!bytes||bytes.length<2)return 'image/png';
 if(bytes[0]===0xff&&bytes[1]===0xd8)return 'image/jpeg';
 if(bytes.length>=12&&RIFF.every((b,i)=>bytes[i]===b)&&WEBP.every((b,i)=>bytes[8+i]===b))return 'image/webp';
 return 'image/png';
}
export const SCAN_IMAGE_EXTENSIONS={'image/jpeg':'.jpg','image/webp':'.webp','image/png':'.png'};
export const scanImageExtension=bytes=>SCAN_IMAGE_EXTENSIONS[sniffScanImageType(bytes)];
export const scanImageExtensionForType=type=>SCAN_IMAGE_EXTENSIONS[type]||'.png';
