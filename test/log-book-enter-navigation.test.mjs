import {employeeAtLocation} from '../log-book-access.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';
import {advanceLogBookField,focusNextLogBookField,isEmptyTripPlaceholder,advanceEquipmentLogBookField} from '../src/log-book-enter-navigation.mjs';
import {blankTrip,nextTripEntry} from '../trip-entry.mjs';
import * as rules from '../trip-card-rules.mjs';
import {canonicalSiteName} from '../site-location.mjs';
import {missingAssetMessage} from '../src/log-book-asset-options.mjs';

function control(name, overrides={}) {
  return {name,tagName:'INPUT',type:'text',value:'value',readOnly:false,tabIndex:0,dataset:{},
    matches:selector=>selector!==':disabled',getClientRects:()=>[{}],closest:()=>null,
    getAttribute:()=>null,checkValidity:()=>true,reportValidity(){this.reported=true},
    focus(){this.focused=true},...overrides};
}
const event=(target,form,extra={})=>({key:'Enter',target,currentTarget:form,preventDefault(){this.defaultPrevented=true},...extra});
function withFrames(run) {
  const previous=globalThis.requestAnimationFrame,frames=[];
  globalThis.requestAnimationFrame=fn=>frames.push(fn);
  try {return run(()=>{while(frames.length)frames.shift()()})} finally {globalThis.requestAnimationFrame=previous}
}

test('Enter traverses the full VLB field order and includes Add trip, skipping fetched/read-only fields',()=>withFrames(flush=>{
  const names=['Location','Doc type','Book date','Book no.','Door no.','Wo.Cont.','Employee ID','Shift hours','Driver name','Shift','A Form','Opening KMR','Closing KMR','Opening HMR','Closing HMR','Remark','Time mode','Add trip','Equipment','Loading','Unloading','Trips','Save'];
  const fields=names.map(name=>control(name,{readOnly:['Doc type','Book no.'].includes(name),closest:()=>name==='Driver name'?{}:null}));
  fields[17].tagName=fields[22].tagName='BUTTON';
  const form={querySelectorAll:()=>fields};
  const sequence=fields.filter(f=>!f.readOnly&&f.name!=='Driver name');
  for(let i=0;i<sequence.length-1;i++) {
    if(sequence[i].tagName==='BUTTON')focusNextLogBookField(sequence[i],form);
    else advanceLogBookField(event(sequence[i],form));
    flush();assert.equal(sequence[i+1].focused,true,`${sequence[i].name} → ${sequence[i+1].name}`);
  }
}));

test('native shift dropdown arrows select without advancing; Enter advances even for unchanged selection',()=>withFrames(flush=>{
  const options=[{},{disabled:true},{}],changes=[];
  const shift=control('Shift hours',{tagName:'SELECT',options,selectedIndex:0,dispatchEvent:e=>changes.push(e.type),ownerDocument:{defaultView:{Event}}});
  const next=control('Shift'),form={querySelectorAll:()=>[shift,next]};
  advanceLogBookField(event(shift,form,{key:'ArrowDown'}));
  assert.equal(shift.selectedIndex,2);assert.deepEqual(changes,['change']);assert.equal(next.focused,undefined);
  advanceLogBookField(event(shift,form));flush();assert.equal(next.focused,true);
}));

test('unresolved dropdown stays focused; highlighted and already selected options advance',()=>withFrames(flush=>{
  let active=null,selected=false;
  const choices=[{getAttribute:()=>selected?'true':'false',querySelector:()=>({textContent:'Chosen'})},{getAttribute:()=>false}];
  const input=control('Door',{value:'search',getAttribute:name=>({role:'combobox','aria-expanded':'true','aria-controls':'doors','aria-activedescendant':active})[name]});
  const next=control('Work order'),form={querySelectorAll:()=>[input,next],ownerDocument:{getElementById:()=>({querySelectorAll:()=>choices})}};
  advanceLogBookField(event(input,form,{defaultPrevented:true}));flush();assert.equal(next.focused,undefined);
  active='door-1';advanceLogBookField(event(input,form,{defaultPrevented:true}));flush();assert.equal(next.focused,true);
  next.focused=false;active=null;selected=true;input.value='Chosen';advanceLogBookField(event(input,form,{defaultPrevented:true}));flush();assert.equal(next.focused,true);
}));

test('invalid fields block advancement; IME, modifiers, held Enter and employee-owned actions do not double-advance',()=>withFrames(flush=>{
  const field=control('Date',{checkValidity:()=>false}),next=control('Door'),form={querySelectorAll:()=>[field,next]};
  advanceLogBookField(event(field,form));flush();assert.equal(field.reported,true);assert.equal(next.focused,undefined);
  field.checkValidity=()=>true;
  for(const extra of [{isComposing:true},{nativeEvent:{isComposing:true}},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true},{repeat:true},{defaultPrevented:true}])advanceLogBookField(event(field,form,extra));
  flush();assert.equal(next.focused,undefined);
}));

test('Enter on untouched next row focuses Save, while partial rows are retained and must validate',()=>{
  const save=control('Save'),input=control('Equipment',{value:'',dataset:{enterEmptyTrip:'true'}});
  advanceLogBookField(event(input,{querySelector:()=>save}));assert.equal(save.focused,true);
  assert.equal(isEmptyTripPlaceholder(blankTrip()),true);
  for(const patch of [{equipmentName:'V12'},{loadingTime:'08:00'},{unloadingTime:'08:20'},{tripCount:2},{tripCount:''}])assert.equal(isEmptyTripPlaceholder({...blankTrip(),...patch}),false);
});

// Exercise the actual JSX handlers/state and submitted payload without live records.
const source=readFileSync(new URL('../src/log-book-form.jsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'log-book-form.jsx',{jsx:{runtime:'classic'}});
const all=(tree,predicate)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))found.push(node);visit(node.props.children)};visit(tree);return found};
function harness(){
  const slots=[],effects=[];let cursor=0;
  const state=initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value}]};
  const Null=()=>null;
  const scope={employeeAtLocation,React,useEffect:(run,deps)=>effects.push({run,deps}),useRef:value=>state(()=>({current:value}))[0],useState:state,blankTrip,nextTripEntry,...rules,canonicalSiteName,missingAssetMessage,advanceLogBookField,focusNextLogBookField,isEmptyTripPlaceholder,advanceEquipmentLogBookField};
  for(const name of ['SmartSelect','DoorCombobox','EmployeeIdLookup','ManualBookDate','Plus','Save','Trash2','RotateCcw','BookOpen','Search','ChevronsLeft','ChevronsRight','Pencil','Printer','X','LogOut','Info','ListFilter'])scope[name]=Null;
  const Component=new Function(...Object.keys(scope),code+';return LogBookForm')(...Object.values(scope));
  const render=(kind='vehicle')=>{cursor=0;effects.length=0;return Component({kind,session:{token:'test'}})};
  render();slots[2]={sites:[],assets:[],employees:[],shifts:[],workOrders:[]};slots[9]=false;
  return {render,slots,runAccountLocation:()=>effects.find(effect=>effect.deps?.length===3&&effect.deps[2]===slots[2].accountLocation).run(),focusLocation:()=>effects.find(effect=>effect.deps?.length===5).run()};
}

test('VLB and ELB opening focus Location once after masters load without selecting a value or stealing focus',()=>withFrames(flush=>{
  const previous=globalThis.document,focused=[];
  globalThis.document={getElementById:()=>({querySelector:selector=>({matches:()=>false,focus:()=>focused.push(selector)})})};
  try {
    const app=harness();app.slots[9]=true;app.render();app.focusLocation();flush();assert.equal(focused.length,0);
    app.slots[9]=false;app.render();app.focusLocation();flush();assert.equal(focused.length,1);assert.match(focused[0],/input.*select/);
    assert.equal(app.slots[0].location,'','autofocus never chooses a location for the user');
    app.slots[2]={...app.slots[2]};app.render();app.focusLocation();flush();assert.equal(focused.length,1);
    const elb=harness();elb.slots[9]=true;elb.render('equipment');elb.focusLocation();flush();assert.equal(focused.length,1);
    elb.slots[9]=false;elb.render('equipment');elb.focusLocation();flush();assert.equal(focused.length,2);
    elb.slots[2]={...elb.slots[2]};elb.render('equipment');elb.focusLocation();flush();assert.equal(focused.length,2);
    const saved=harness();saved.slots[1]={book_no:'SAVED',data:{}};saved.render();saved.focusLocation();flush();assert.equal(focused.length,2);
  } finally {globalThis.document=previous}
}));

test('actual ELB form follows the approved Enter sequence through Save regardless of its visual column order',()=>withFrames(flush=>{
  const app=harness(),tree=app.render('equipment');
  const fields=all(tree,node=>node.props.label&&node.props.children);
  const ordered=fields.filter(node=>node.props.enterOrder).sort((a,b)=>a.props.enterOrder-b.props.enterOrder);
  assert.deepEqual(ordered.map(node=>node.props.label),['Location','Book date','Equipment','Wo.Cont.','Employee ID / Caliber ID','Shift hour','Shift','Job Card no.','Opening reading (HMR)','Closing reading (HMR)','Remark']);
  assert.equal(fields.find(node=>node.props.label==='Operator name').props.skipEnter,true);
  assert.equal(fields.some(node=>/KMR/.test(node.props.label)),false);
  const controls=fields.filter(node=>node.props.enterOrder||node.props.label==='Operator name').map(node=>control(node.props.label,{
    closest:selector=>selector==='[data-enter-skip="true"]'?(node.props.skipEnter?{}:null):node.props.enterOrder?{dataset:{enterOrder:node.props.enterOrder}}:null,
  }));
  const save=control('Save',{tagName:'BUTTON'});controls.push(save);
  const form={querySelectorAll:()=>controls};
  const sequence=[...ordered.map(node=>controls.find(c=>c.name===node.props.label)),save];
  for(let i=0;i<sequence.length-1;i++){
    advanceLogBookField(event(sequence[i],form));flush();
    assert.equal(sequence[i+1].focused,true,`${sequence[i].name} → ${sequence[i+1].name}`);
  }
  const nativeFields=fields.filter(node=>['Shift hour','Shift'].includes(node.props.label));
  for(const node of nativeFields)assert.doesNotMatch(String(node.props.children.props.onChange),/focusNextLogBookField/);
  assert.equal(all(tree,node=>node.type==='form')[0].props.onKeyDown,advanceLogBookField);
}));

test('rendered VLB header follows the requested sequence and driver is explicitly skipped',()=>{
  const tree=harness().render();
  const fields=all(tree,node=>node.props.label&&node.props.children);
  assert.deepEqual(fields.slice(0,16).filter(node=>!['Doc type','Book no.','Driver name'].includes(node.props.label)).map(node=>node.props.label),[
    'Location','Book date','Door no.','Wo.Cont.','Employee ID / Caliber ID','Shift','Shift hour','A Form no. (Trip Card)',
    'Opening reading (KMR)','Closing reading (KMR)','Opening reading (HMR)','Closing reading (HMR)','Remark',
  ]);
  assert.equal(fields.find(node=>node.props.label==='Driver name').props.skipEnter,true);
  for(const label of ['Shift hour','Shift']) {
    const dropdown=fields.find(node=>node.props.label===label).props.children;
    assert.doesNotMatch(String(dropdown.props.onChange),/focusNextLogBookField/,'arrow changes must not move focus');
  }
});

test('VLB and ELB employee ID dropdowns contain only employees at the selected site and reset on site change',()=>{
  for(const kind of ['vehicle','equipment']){
    const app=harness();app.slots[2].employees=[{id:'1',name:'Local operator',caliberId:'CMPL1234',site:'Sasti OB'},{id:'2',name:'Other operator',caliberId:'CMPL5678',site:'Jayant OC'},{id:'3',name:'Unassigned',caliberId:'CMPL9999',site:''}];
    app.slots[0]={...app.slots[0],location:'Sasti OC'};
    const fields=all(app.render(kind),node=>node.props.label&&node.props.children);
    const picker=fields.find(node=>node.props.label==='Employee ID / Caliber ID').props.children;
    assert.equal(picker.props.searchable,true);
    assert.deepEqual(all(picker,node=>node.type==='option').map(node=>node.props.value),['','1']);
    picker.props.onChange({target:{value:'1'}});assert.equal(app.slots[0].employeeId,'1');assert.match(app.slots[7],/Local operator/);
    if(kind==='vehicle'){app.slots[2].accountLocation='Jayant OC';app.render(kind);app.runAccountLocation();}else fields.find(node=>node.props.label==='Location').props.children.props.onChange({target:{value:'Jayant OC'}});
    assert.equal(app.slots[0].employeeId,'');
    const changed=all(app.render(kind),node=>node.props.label==='Employee ID / Caliber ID')[0].props.children;
    assert.deepEqual(all(changed,node=>node.type==='option').map(node=>node.props.value),['','2']);
  }
});

test('VLB JSX adds one trip, continues rows, and saves entered data while excluding only untouched placeholders',async()=>{
  const frames=[],priorFrame=globalThis.requestAnimationFrame,priorDocument=globalThis.document,priorFetch=globalThis.fetch;
  const focused=[],requests=[];
  globalThis.requestAnimationFrame=fn=>frames.push(fn);
  globalThis.document={getElementById:()=>({querySelector:selector=>({focus:()=>focused.push(selector)})})};
  globalThis.fetch=async(url,config)=>{requests.push({url,body:config?.body&&JSON.parse(config.body)});return{ok:true,json:async()=>url.includes('?')||!config?{records:[],nextCursor:null}:{book_no:'TEST',revision:1}}};
  try {
    const app=harness();let tree=app.render();
    all(tree,node=>node.props['data-enter-action']==='add-trip')[0].props.onClick();
    while(frames.length)frames.shift()();assert.equal(app.slots[0].trips.length,1);assert.match(focused[0],/="0"/);
    app.slots[0]={...app.slots[0],trips:[{equipmentName:'V12',loadingTime:'08:00',unloadingTime:'08:30',tripCount:1}]};
    tree=app.render();
    const count=all(tree,node=>node.props['aria-label']==='No. of trips row 1')[0];
    const root={querySelector:selector=>({focus:()=>focused.push(selector)})};
    count.props.onKeyDown(event({},{},{currentTarget:{closest:()=>root}}));
    while(frames.length)frames.shift()();assert.equal(app.slots[0].trips.length,2);assert.match(focused.at(-1),/="1"/);
    tree=app.render();
    const empty=all(tree,node=>node.props['aria-label']==='Equipment name row 2')[0];
    assert.equal(empty.props.required,false);assert.equal(empty.props['data-enter-empty-trip'],true);
    const entry=all(tree,node=>node.type==='form')[0];
    await entry.props.onSubmit({preventDefault(){}});
    const payload=requests.find(r=>r.body)?.body;
    assert.equal(payload.trips.length,1);assert.deepEqual(payload.trips[0],app.slots[0].trips[0]);
    assert.equal(app.slots[0].trips.length,2,'draft is not erased');
  } finally {globalThis.requestAnimationFrame=priorFrame;globalThis.document=priorDocument;globalThis.fetch=priorFetch}
});

test('VLB location comes from account, Shift precedes Shift Hours, and trip search lists only local vehicles',()=>{
 const app=harness();app.slots[2]={...app.slots[2],accountLocation:'Sasti OC',sites:['Sasti OC','Jayant OC'],assets:[{id:'v1',kind:'vehicle',site:'Sasti OC',door:'V12',name:'Volvo 12'},{id:'v2',kind:'vehicle',site:'Jayant OC',door:'V99',name:'Volvo 99'},{id:'e1',kind:'equipment',site:'Sasti OC',door:'EX1',name:'Excavator'}]};
 app.render();app.runAccountLocation();assert.equal(app.slots[0].location,'Sasti OC');
 app.slots[0].trips=[blankTrip()];const tree=app.render();
 const location=all(tree,node=>node.props['aria-label']==='Location')[0];assert.equal(location.type,'input');assert.equal(location.props.readOnly,true);
 const shifts=all(tree,node=>['shiftId','shiftHours'].includes(node.props.name));assert.deepEqual(shifts.map(node=>node.props.name),['shiftId','shiftHours']);
 const equipment=all(tree,node=>node.props['aria-label']==='Equipment name row 1')[0];assert.equal(equipment.props.searchable,true);
 const choices=React.Children.toArray(equipment.props.children).filter(node=>node.props.value);assert.deepEqual(choices.map(node=>node.props.value),['V12']);
 all(tree,node=>node.type==='button'&&React.Children.toArray(node.props.children).includes('New entry'))[0].props.onClick();assert.equal(app.slots[0].location,'Sasti OC');
});
