import React, {useState} from 'react';

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

export default function LmvImport({token,onImported}) {
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const importFile=async event=>{
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    setBusy(true);
    setMessage('');
    try{
      const {default:readXlsxFile}=await import('read-excel-file');
      const sheet=await readXlsxFile(file);
      const header=sheet.findIndex(row=>row.some(cell=>String(cell).trim().toLowerCase()==='door / registration'));
      if(header<0)throw Error('Select an LMV Master Excel export.');
      const keys=sheet[header].map(cell=>columns[String(cell).trim().toLowerCase()]);
      const records=sheet.slice(header+1).map(row=>Object.fromEntries(keys.flatMap((key,index)=>{
        const value=row[index];
        return key?[[key,value instanceof Date?value.toISOString().slice(0,10):String(value??'').trim()]]:[];
      })));
      const response=await fetch('/api/lmv-master/import',{
        method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({records}),
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'LMV import failed.');
      setMessage(`Imported ${result.inserted}. Already present ${result.existing}. Conflicts ${result.conflicts}. Invalid rows ${result.invalid}.`);
      onImported();
    }catch(error){setMessage(error.message);}
    finally{setBusy(false);}
  };
  return <div className="toolbar">
    <label>Import LMV Excel export <input type="file" accept=".xlsx" disabled={busy} onChange={importFile}/></label>
    <span role="status">{busy?'Importing LMVs…':message}</span>
  </div>;
}
