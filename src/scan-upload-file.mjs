const types={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',bmp:'image/bmp'};
export const SCAN_UPLOAD_ACCEPT=Object.keys(types).map(ext=>'.'+ext).concat([...new Set(Object.values(types))]).join(',');
export function scanUploadType(file={}){
 const mime=String(file.type||'').toLowerCase();
 if(Object.values(types).includes(mime))return mime;
 const extension=String(file.name||'').toLowerCase().match(/\.([a-z]+)$/)?.[1];
 if((!mime||['application/octet-stream','image/jpg','image/x-png','image/x-ms-bmp'].includes(mime))&&types[extension])return types[extension];
 throw new Error('Use a PDF, PNG, JPG/JPEG, WEBP or BMP scan.');
}
