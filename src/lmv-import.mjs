const columns = {
  'door / registration': 'door', 'registration no.': 'registration',
  'current location': 'currentLocation', 'equipment name': 'equipmentName',
  'equipment category': 'category', 'equipment group': 'group',
  'item name': 'itemName', 'item specification name': 'itemSpecification',
  'acquisition date': 'acquisitionDate', make: 'make', model: 'model',
  'manufacturer serial no.': 'manufacturerSerialNo', 'engine no.': 'engineNo',
  'chassis no.': 'chassisNo', 'document status': 'documentStatus',
  'asset no.': 'assetNo', 'equipment status': 'status',
};

export const lmvCsvFields = Object.entries(columns).map(([label,key])=>[key,label]);

export async function readLmvExport(file,parseCsv){
  if(file.name.toLowerCase().endsWith('.csv')){
    const lines=(await file.text()).split(/\r?\n/);
    const header=lines.findIndex(line=>/(?:^|,)\s*"?door \/ registration"?\s*,/i.test(line)&&/equipment category/i.test(line));
    if(header<0)throw Error('Select a Pulse LMV Master CSV export.');
    return parseCsv(lines.slice(header).join('\n'),lmvCsvFields);
  }
  const {default:readXlsxFile}=await import('read-excel-file');
  const sheet=await readXlsxFile(file);
  const header=sheet.findIndex(row=>row.some(cell=>String(cell).trim().toLowerCase()==='door / registration'));
  if(header<0)throw Error('Select a Pulse LMV Master Excel export.');
  const keys=sheet[header].map(cell=>columns[String(cell).trim().toLowerCase()]);
  return sheet.slice(header+1).map(row=>Object.fromEntries(keys.flatMap((key,index)=>{
    const value=row[index];
    return key?[[key,value instanceof Date?value.toISOString().slice(0,10):String(value??'').trim()]]:[];
  })));
}

export async function saveLmvExport(token,records){
  const response=await fetch('/api/lmv-master/import',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({records}),
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'LMV import failed.');
  return result;
}
