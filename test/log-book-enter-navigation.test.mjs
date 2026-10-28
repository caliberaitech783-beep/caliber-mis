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
  const slots=[];let cursor=0;
  const state=initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value}]};
  const Null=()=>null;
  const scope={React,useEffect:()=>{},useState:state,blankTrip,nextTripEntry,...rules,canonicalSiteName,missingAssetMessage,advanceLogBookField,focusNextLogBookField,isEmptyTripPlaceholder,advanceEquipmentLogBookField};
  for(const name of ['SmartSelect','DoorCombobox','EmployeeIdLookup','ManualBookDate','Plus','Save','Trash2','RotateCcw','BookOpen','Search','ChevronsLeft','ChevronsRight','Pencil','Printer','X','LogOut','Info','ListFilter'])scope[name]=Null;
  const Component=new Function(...Object.keys(scope),code+';return LogBookForm')(...Object.values(scope));
  const render=()=>{cursor=0;return Component({kind:'vehicle',session:{token:'test'}})};
  render();slots[2]={sites:[],assets:[],employees:[],shifts:[],workOrders:[]};slots[9]=false;
  return {render,slots};
}

test('rendered VLB header follows the requested sequence and driver is explicitly skipped',()=>{
  const tree=harness().render();
  const fields=all(tree,node=>node.props.label&&node.props.children);
  assert.deepEqual(fields.slice(0,16).filter(node=>!['Doc type','Book no.','Driver name'].includes(node.props.label)).map(node=>node.props.label),[
    'Location','Book date','Door no.','Wo.Cont.','Employee ID / Caliber ID','Shift hour','Shift','A Form no. (Trip Card)',
    'Opening reading (KMR)','Closing reading (KMR)','Opening reading (HMR)','Closing reading (HMR)','Remark',
  ]);
  assert.equal(fields.find(node=>node.props.label==='Driver name').props.skipEnter,true);
  for(const label of ['Shift hour','Shift']) {
    const dropdown=fields.find(node=>node.props.label===label).props.children;
    assert.doesNotMatch(String(dropdown.props.onChange),/focusNextLogBookField/,'arrow changes must not move focus');
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
