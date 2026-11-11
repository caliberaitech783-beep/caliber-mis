// Preserve every OCR digit. Equipment-master matching may recover a likely
// separator or one-character OCR error later, after it knows the selected site.
export function formatScannedDoor(value,kind='vehicle'){
 if(kind!=='vehicle'||typeof value!=='string')return value??'';
 const literal=value.match(/^\s*([A-Z]{1,5})\s*[:.]?\s*[/／⁄∕]\s*(\d+)\s*$/i);
 return literal?literal[1].toUpperCase()+'/'+literal[2]:value;
}
