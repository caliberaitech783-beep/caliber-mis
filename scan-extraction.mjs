import {canonicalSiteName} from './site-location.mjs';
import {assetBookKind,employeeCode} from './log-book.mjs';
const key=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const one=(rows,predicate)=>{const found=rows.filter(predicate);return found.length===1?found[0]:null};
export function extractCard(text,kind,masters=[]){
 const pick=pattern=>String(text||'').match(new RegExp('(?:^|\\n)\\s*(?:'+pattern+')\\s*[:=#-]\\s*([^\\n]+)','i'))?.[1]?.trim()||'';
 const numeric=pattern=>{const raw=pick(pattern).replaceAll(',','');return /^\d+(?:\.\d+)?$/.test(raw)?raw:''};
 const rawDate=pick('book date|date'),m=rawDate.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
 const bookDate=/^\d{4}-\d{2}-\d{2}$/.test(rawDate)?rawDate:m?`${m[3].length===2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:'';
 const raw={door:pick('door(?:\\s*(?:no\\.?|number))?|vehicle(?:\\s*(?:no\\.?|number))?|equipment(?:\\s*(?:no\\.?|number))?'),location:pick('location|site'),employee:pick('driver(?: name)?|operator(?: name)?'),employeeCode:pick('caliber id|employee id|emp(?:loyee)? code'),shift:pick('shift'),workOrder:pick('wo\\.?\\s*cont\\.?|work order(?: no\\.?)?|contract'),cardNo:pick('trip card(?: no\\.?)?|job card(?: no\\.?)?|card(?: no\\.?)?|a form(?: no\\.?)?')};
 const assets=masters.filter(r=>r.master_name==='Equipment master'&&assetBookKind(r.record_data)===kind);
 const asset=raw.door?one(assets,r=>[r.record_data.door,r.record_data.doorNo,r.record_data.registration,r.record_data.reg].some(v=>v&&key(v)===key(raw.door))):null;
 const location=raw.location||asset?.record_data.currentLocation||asset?.record_data.site||asset?.record_data.location||'';
 const employees=masters.filter(r=>['C-Dir Employee master','ERP Employee master','Employee master'].includes(r.master_name));
 const matchingEmployee=r=>raw.employeeCode?[employeeCode(r.record_data),r.record_data.erpEmployeeCode,r.record_data.employeeCode].some(v=>v&&key(v)===key(raw.employeeCode)):raw.employee&&key(r.record_data.name||r.record_data.employee)===key(raw.employee);
 const employee=one(employees.filter(r=>r.master_name==='Employee master'),matchingEmployee)||one(employees.filter(r=>r.master_name!=='Employee master'),matchingEmployee);
 const shift=raw.shift?one(masters,r=>r.master_name==='Shift Master'&&canonicalSiteName(r.record_data.site||r.record_data.siteName)===canonicalSiteName(location)&&key(r.record_data.shiftName||r.record_data.name||r.record_data.shift)===key(raw.shift)):null;
 const wo=raw.workOrder?one(masters,r=>r.master_name==='Work Order master'&&key(r.record_data.workOrderNo)===key(raw.workOrder)&&!r.record_data.sourceMissing):null;
 const trips=[];for(const line of String(text).split('\n')){const m=line.match(/^\s*([A-Z][A-Z0-9-]{1,24})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d+)\s*$/i);if(m)trips.push({equipmentName:m[1],loadingTime:m[2],unloadingTime:m[3],tripCount:Number(m[4])});}
 return {raw,draft:{bookDate,location,assetId:asset?String(asset.id):'',employeeId:employee?String(employee.id):'',shiftId:shift?String(shift.id):'',workOrderId:wo?String(wo.id):'',shiftHours:/^12\s*(?:hours?|hrs?)?$/i.test(pick('shift hours?|shift hrs?'))?12:/^8\s*(?:hours?|hrs?)?$/i.test(pick('shift hours?|shift hrs?'))?8:'',openingKmr:numeric('opening (?:reading[ (]*)?(?:kmr|km)\\)?|opening kmr'),closingKmr:numeric('closing (?:reading[ (]*)?(?:kmr|km)\\)?|closing kmr'),openingHmr:numeric('opening (?:reading[ (]*)?(?:hmr|hour|hours)\\)?|opening hmr'),closingHmr:numeric('closing (?:reading[ (]*)?(?:hmr|hour|hours)\\)?|closing hmr'),aFormNo:kind==='vehicle'?raw.cardNo:'',jobCardNo:kind==='equipment'?raw.cardNo:'',remark:pick('remarks?'),timeMode:'with',trips}};
}
