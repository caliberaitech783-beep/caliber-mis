import {assetCapacityPair,pairKey} from './production-report.mjs';
import {canonicalSiteName,equipmentSiteName} from './site-location.mjs';
import {equipmentGroupValue} from './equipment-group.mjs';

export const fleetCapacitySeed=[
 ['CAT','215LC',1.02,0],
 ['LiuGong','965E',4.1,6000],['LiuGong','975HD',5.6,9000],['LiuGong','CLG922E',1,0],
 ['LiuGong','CLG922EA',1.1,0],['LiuGong','CLG926',1.5,2000],['LiuGong','CLG935',1.9,0],
 ['Volvo','EC480',3.1,5000],['Volvo','EC550',4,6200],['Volvo','EC650',4.6,6800],
 ['JCB','JCB215',1.02,0],['LiuGong','LGI921',1,0],
 ['Sany','SANY580',3.6,5250],['Sany','SY215C',0.93,0],['Sany','SY380',2,3000],
 ['Tata Hitachi','ZX470',3.1,5000],['Tata Hitachi','ZX490',3.1,5000],['Tata Hitachi','ZX650',3.8,5000],
 ['Tata Hitachi','ZX670',4.1,6000],['Tata Hitachi','ZX870',5.4,9000],['Tata Hitachi','ZX890',6,9500],
 ['Liebherr','G935',1.02,2000]
];

const groups=['Excavator','Surface Miner','Payloader','Dumper/Tipper','Water Tanker','Dozer','Drill','Grader','Diesel Bowser','Crane','Service Van','Rock Breaker'];
const groupKey=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const groupNames=new Map(groups.map(group=>[groupKey(group),group]));
for(const name of ['dumper','tipper','tippers','dumpers','tipperdumper'])groupNames.set(name,'Dumper/Tipper');

export function fleetPopulationReports({assets,locations,capacities}){
 const sites=new Map(locations.map(site=>[canonicalSiteName(site),site]));
 const capacityRows=new Map(capacities.map(row=>[pairKey(row),{...row,population:{}}]));
 const deployment=new Map(groups.map(equipment=>[equipment,{equipment,population:{}}]));
 for(const asset of assets){
  if(asset.sourceMissing)continue;
  const site=canonicalSiteName(equipmentSiteName(asset)||asset.siteName);
  if(!sites.has(site))continue;
  const label=equipmentGroupValue(asset,asset.equipment||'Unclassified');
  const key=groupKey(label);
  const equipment=groupNames.get(key)||groupNames.get(key.replace(/s$/,''))||label;
  if(!deployment.has(equipment))deployment.set(equipment,{equipment,population:{}});
  const counts=deployment.get(equipment).population;
  counts[site]=(counts[site]||0)+1;
  const capacity=capacityRows.get(pairKey(assetCapacityPair(asset)));
  if(capacity)capacity.population[site]=(capacity.population[site]||0)+1;
 }
 return {sites:[...sites].map(([key,label])=>({key,label})),capacity:[...capacityRows.values()],deployment:[...deployment.values()]};
}
