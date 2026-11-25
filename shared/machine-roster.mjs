// Machine Roster (owner, 25 Nov 2026: "vehicle and equipment roster", site-wise machine list). Every machine the
// Equipment Master puts at a site, by the book it belongs to: VLB a Vehicle, ELB an Equipment, LMV an LMV. It is read
// with the same rules as the batch page's machine coverage (shared/batch-fleet-coverage.mjs), so a site's VLB, ELB and
// LMV figures here are the machines its batches have to answer for. Read only: a machine is changed in Pulse.
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName} from './region-scope.mjs';
import {masterCategory} from './equipment-kind.mjs';
import {activeAsset,assetCoverageKind,assetSite,assetDoor,assetName} from './batch-fleet-coverage.mjs';

export const ROSTER_VIEWS=Object.freeze([
 {key:'vlb',label:'VLB · Vehicle',short:'VLB'},
 {key:'elb',label:'ELB · Equipment',short:'ELB'},
 {key:'lmv',label:'LMV',short:'LMV'},
 {key:'all',label:'All active machines',short:'All active'},
 {key:'unset',label:'Category not set in the master (judged by group)',short:'Category not set'},
 {key:'inactive',label:'Not active in the master',short:'Not active'},
]);
const BOOK_OF_KIND={vehicle:'vlb',equipment:'elb',lmv:'lmv'};
const BOOK_LABEL={vlb:'VLB',elb:'ELB',lmv:'LMV'};
export const NO_SITE='—';
const text=value=>String(value??'').trim();
const byDoor=(a,b)=>String(a.door).localeCompare(String(b.door),undefined,{numeric:true});

// One machine as the roster shows it.
export function rosterMachine(id,asset={}){
 const raw=assetSite(asset),siteKey=canonicalSiteName(raw)||NO_SITE,book=BOOK_OF_KIND[assetCoverageKind(asset)]||'vlb';
 return {assetId:String(id),siteKey,site:raw?displaySiteName(raw)||raw:'No site in the master',door:assetDoor(asset),name:assetName(asset),
  registration:text(asset.reg||asset.registration),category:text(asset.category||asset.equipmentCategory),group:text(asset.group||asset.equipmentGroup),
  make:text(asset.make),model:text(asset.model||asset.modelNo),status:text(asset.status||asset.equipmentStatus)||(asset.sourceMissing?'Not in Pulse any more':''),
  book,bookLabel:BOOK_LABEL[book],categorySet:Boolean(masterCategory(asset)),active:activeAsset(asset)};
}
// Does the machine belong to the view a figure opens?
export function inView(machine,view){
 if(view==='inactive')return !machine.active;
 if(!machine.active)return false;
 if(view==='all')return true;
 if(view==='unset')return !machine.categorySet;
 return machine.book===view;
}
// The roster of the sites the login may see. `assets` is [[id, record], …]; `allowed(site)` says whether a site is shown.
export function machineRoster(assets=[],{allowed=()=>true}={}){
 const machines=[],sites=new Map();
 for(const [id,asset] of assets){
  const machine=rosterMachine(id,asset||{});
  if(!allowed(assetSite(asset||{})))continue;
  machines.push(machine);
  if(!sites.has(machine.siteKey))sites.set(machine.siteKey,{key:machine.siteKey,site:machine.site,vlb:0,elb:0,lmv:0,all:0,unset:0,inactive:0});
  const site=sites.get(machine.siteKey);
  for(const view of ROSTER_VIEWS)if(inView(machine,view.key))site[view.key]++;
 }
 machines.sort((a,b)=>a.site.localeCompare(b.site)||a.book.localeCompare(b.book)||byDoor(a,b));
 const rows=[...sites.values()].sort((a,b)=>(a.key===NO_SITE)-(b.key===NO_SITE)||a.site.localeCompare(b.site));
 const total={key:'*',site:'All sites',total:true};
 for(const view of ROSTER_VIEWS)total[view.key]=rows.reduce((sum,row)=>sum+row[view.key],0);
 return {sites:rows,total,machines};
}
export const machinesOf=(machines,siteKey,view)=>machines.filter(machine=>(siteKey==='*'||machine.siteKey===siteKey)&&inView(machine,view));
