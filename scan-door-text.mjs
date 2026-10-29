// User-confirmed Scania notation: S/NN separators can be read as 1,
// sometimes with stray colon/dot punctuation after the fleet letter.
export function formatScannedDoor(value,kind='vehicle'){
 if(kind!=='vehicle'||typeof value!=='string')return value??'';
 // Scania's handwritten S/ is commonly read as 51.
 const scania=value.match(/^\s*5\s*[:.]?\s*1\s*(\d{2,5})\s*$/);
 if(scania)return 'S/'+scania[1];
 // User-confirmed widths: Scania S/NN and Volvo V/NNN. A duplicated
 // separator stroke can add a spurious 1 after the slash.
 const literal=value.match(/^\s*([A-Z]{1,5})\s*[:.]?\s*[/／⁄∕]\s*(\d+)\s*$/i);
 if(literal){const prefix=literal[1].toUpperCase(),digits=literal[2];
  const duplicate=prefix==='S'&&/^1\d{2}$/.test(digits)||prefix==='V'&&/^1\d{3}$/.test(digits);
  return prefix+'/'+(duplicate?digits.slice(1):digits);
 }
 // Apply the confirmed S/NN rule only, never arbitrary digit removal.
 const match=value.match(/^\s*S\s*[:.]?\s*(?:1|[Iil|])\s*(\d{2})\s*$/i);
 return match?'S/'+match[1]:value;
}
