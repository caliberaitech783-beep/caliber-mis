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

// Equipment Deployment by category (owner, 13 Nov 2026): the Equipment category of each machine in the Equipment master,
// as Pulse keeps it (EQUIPMENT, VEHICLE, and LMV once Pulse moves a machine there), with a subtotal under each category.
// The category is read, never guessed: a machine moved to another category in Pulse moves here with the next sync.
const CATEGORY_ORDER=['EQUIPMENT','VEHICLE','LMV'];
const CATEGORY_LABELS={EQUIPMENT:'Equipment',VEHICLE:'Vehicle',LMV:'LMV'};
const NO_CATEGORY='';
// A group of the standard list with no machine at any site still shows, as 0, under the category of its kind of machine.
const EMPTY_GROUP_CATEGORY=Object.fromEntries(groups.map(group=>[group,['Dumper/Tipper','Water Tanker','Diesel Bowser','Service Van'].includes(group)?'VEHICLE':'EQUIPMENT']));
export const assetCategory=asset=>String(asset?.category||asset?.equipmentCategory||'').trim().replace(/\s+/g,' ').toUpperCase();
export const categoryLabel=category=>CATEGORY_LABELS[category]||category||'No category in the master';
const categoryRank=category=>category===NO_CATEGORY?CATEGORY_ORDER.length+1:CATEGORY_ORDER.includes(category)?CATEGORY_ORDER.indexOf(category):CATEGORY_ORDER.length;
const groupRank=equipment=>groups.includes(equipment)?groups.indexOf(equipment):groups.length;

export function fleetPopulationReports({assets,locations,capacities}){
 const sites=new Map(locations.map(site=>[canonicalSiteName(site),site]));
 const capacityRows=new Map(capacities.map(row=>[pairKey(row),{...row,population:{}}]));
 const deployment=new Map(groups.map(equipment=>[equipment,{equipment,population:{}}]));
 const byCategory=new Map();
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
  const category=assetCategory(asset),categoryKey=category+'|'+equipment;
  if(!byCategory.has(categoryKey))byCategory.set(categoryKey,{category,categoryLabel:categoryLabel(category),equipment,population:{}});
  const inCategory=byCategory.get(categoryKey).population;
  inCategory[site]=(inCategory[site]||0)+1;
  const capacity=capacityRows.get(pairKey(assetCapacityPair(asset)));
  if(capacity)capacity.population[site]=(capacity.population[site]||0)+1;
 }
 const placed=new Set([...byCategory.values()].map(row=>row.equipment));
 for(const equipment of groups)if(!placed.has(equipment)){const category=EMPTY_GROUP_CATEGORY[equipment];byCategory.set(category+'|'+equipment,{category,categoryLabel:categoryLabel(category),equipment,population:{}});}
 // Equipment, Vehicle, LMV, any other category, then machines with no category; inside a category the standard list
 // order first, then other groups A to Z.
 const deploymentByCategory=[...byCategory.values()].sort((a,b)=>categoryRank(a.category)-categoryRank(b.category)||a.category.localeCompare(b.category)
  ||groupRank(a.equipment)-groupRank(b.equipment)||a.equipment.localeCompare(b.equipment));
 return {sites:[...sites].map(([key,label])=>({key,label})),capacity:[...capacityRows.values()],deployment:[...deployment.values()],deploymentByCategory};
}

// The Equipment Deployment table: under each category its groups and then a subtotal line, with the grand total last.
// rows: deploymentByCategory; siteKeys: the site columns. Each line carries population by site and its total.
export function deploymentTableRows(rows=[],siteKeys=[]){
 const sum=(list,key)=>list.reduce((n,row)=>n+(row.population[key]||0),0);
 const withTotal=row=>({...row,total:siteKeys.reduce((n,key)=>n+(row.population[key]||0),0)});
 const lines=[],categories=[...new Set(rows.map(row=>row.category))];
 for(const category of categories){
  const inside=rows.filter(row=>row.category===category);
  for(const row of inside)lines.push(withTotal({...row,kind:'group',id:'group|'+category+'|'+row.equipment}));
  lines.push(withTotal({kind:'subtotal',id:'subtotal|'+category,category,categoryLabel:categoryLabel(category),equipment:categoryLabel(category)+' subtotal',
   groups:inside.length,population:Object.fromEntries(siteKeys.map(key=>[key,sum(inside,key)]))}));
 }
 lines.push(withTotal({kind:'total',id:'total',category:'',categoryLabel:'',equipment:'Total',population:Object.fromEntries(siteKeys.map(key=>[key,sum(rows,key)]))}));
 return lines;
}
