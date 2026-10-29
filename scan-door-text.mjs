// User-confirmed Scania notation: S/NN separators can be read as 1,
// sometimes with stray colon/dot punctuation after the fleet letter.
export function formatScannedDoor(value,kind='vehicle'){
 if(kind!=='vehicle'||typeof value!=='string')return value??'';
 // Preserve all actual digits when OCR has retained an explicit slash.
 const literal=value.match(/^\s*([A-Z]{1,5})\s*[:.]?\s*[/／⁄∕]\s*(\d+)\s*$/i);
 if(literal)return literal[1].toUpperCase()+'/'+literal[2];
 // Apply the confirmed S/NN rule only, never arbitrary digit removal.
 const match=value.match(/^\s*S\s*[:.]?\s*(?:1|[Iil|])\s*(\d{2})\s*$/i);
 return match?'S/'+match[1]:value;
}
