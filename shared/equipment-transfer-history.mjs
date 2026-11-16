import {canonicalSiteName} from './site-location.mjs';

const clean=value=>String(value??'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):'';

// Prefer stable identifiers. A name is deliberately not enough to associate a transfer.
export function transferForAsset(transfer={},asset={}){
 const transferId=String(transfer.equipmentMasterId||''),assetId=String(asset.id||'');
 if(transferId)return Boolean(assetId&&transferId===assetId);
 const oracle=clean(transfer.oracleEquipmentTno),assetOracle=clean(asset.oracleEquipmentTno);
 if(oracle&&assetOracle)return oracle===assetOracle;
 const candidates=[transfer.equipment,transfer.door].map(clean).filter(Boolean);
 return [asset.door,asset.doorNo].map(clean).filter(Boolean).some(value=>candidates.includes(value));
}

const PENDING=new Set(['Awaiting source approval','Awaiting destination MIS verification','Awaiting destination PM acceptance']);

// A transfer waiting for its approvals (often about three days, 16 Nov 2026) leaves the Vehicle
// Master at the source site while the machine already works at the destination. Such a transfer
// lets its destination enter log books from the transfer date on; the source keeps its own dates.
export function pendingTransfers(asset={},transfers=[]){
 const current=canonicalSiteName(asset.currentLocation||asset.site||asset.location);
 if(!current)return [];
 return transfers.filter(t=>transferForAsset(t,asset)&&PENDING.has(String(t.status||'').trim())&&date(t.transferDate)
  &&canonicalSiteName(t.source)===current&&canonicalSiteName(t.destination)&&canonicalSiteName(t.destination)!==current);
}

// Walk backwards from the present assignment; only a continuous, completed transfer
// chain is evidence. On the transfer date both sites can have valid cards.
export function assetAtSiteOnDate(asset={},transfers=[],site='',bookDate=''){
 const target=canonicalSiteName(site),day=date(bookDate);
 if(!target||!day)return false;
 let current=canonicalSiteName(asset.currentLocation||asset.site||asset.location);
 if(!current)return false;
 if(pendingTransfers(asset,transfers).some(t=>canonicalSiteName(t.destination)===target&&day>=t.transferDate))return true;
 const history=transfers.filter(t=>transferForAsset(t,asset)&&(!t.status||t.status==='Completed')&&date(t.transferDate)&&canonicalSiteName(t.source)&&canonicalSiteName(t.destination))
  .sort((a,b)=>b.transferDate.localeCompare(a.transferDate));
 for(const transfer of history){
  const source=canonicalSiteName(transfer.source),destination=canonicalSiteName(transfer.destination);
  if(destination!==current)return false;
  if(day>transfer.transferDate)return target===current;
  if(day===transfer.transferDate)return target===current||target===source;
  current=source;
 }
 return target===current;
}

export function assetForSiteOnDate(asset,site,bookDate){
 if(!assetAtSiteOnDate(asset,asset.transferHistory||[],site,bookDate))return asset;
 return {...asset,site,currentLocation:site,location:site};
}

export function attachTransferHistory(assets=[],transfers=[]){
 const histories=new Map(assets.map(asset=>[String(asset.id),[]]));
 const ids=new Map(),oracles=new Map(),doors=new Map();
 const add=(map,key,asset)=>{if(!key)return;const list=map.get(key)||[];list.push(asset);map.set(key,list);};
 for(const asset of assets){add(ids,String(asset.id||''),asset);add(oracles,clean(asset.oracleEquipmentTno),asset);for(const key of new Set([asset.door,asset.doorNo].map(clean).filter(Boolean)))add(doors,key,asset);}
 for(const transfer of transfers){
  const id=String(transfer.equipmentMasterId||''),oracle=clean(transfer.oracleEquipmentTno);
  const matches=id?(ids.get(id)||[]):oracle&&oracles.has(oracle)?oracles.get(oracle):[...new Set([transfer.equipment,transfer.door].map(clean).filter(Boolean).flatMap(key=>doors.get(key)||[]))];
  if(matches.length===1)histories.get(String(matches[0].id)).push(transfer);
 }
 return assets.map(asset=>({...asset,transferHistory:histories.get(String(asset.id))||[]}));
}
