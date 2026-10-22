import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import React from 'react';import {transformWithOxc} from 'vite';
import {searchSiteDoors,doorLabel} from '../src/door-search.mjs';
test('typing filters the site list and arrow/Enter chooses the master ID rather than free text',async()=>{
 const source=fs.readFileSync(new URL('../src/door-combobox.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 const {code}=await transformWithOxc(source,'door-combobox.jsx',{jsx:{runtime:'classic'}});
 const state=[];let cursor=0,value='';const scope={React,ChevronDown:()=>null,searchSiteDoors,doorLabel,useId:()=> 'door-test',useRef:()=>({current:{focus(){},setCustomValidity(){},querySelector(){return null}}}),useEffect:()=>{},useState:initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next}];}};
 const Component=new Function(...Object.keys(scope),code+';return DoorCombobox;')(...Object.values(scope));
 const records=[{id:'s2',door:'S2',kind:'vehicle',site:'Dhoptala OC'},{id:'s12',door:'S12',kind:'vehicle',site:'Dhoptala OB'},{id:'v1',door:'V1',kind:'vehicle',site:'Dhoptala OC'},{id:'other',door:'S99',kind:'vehicle',site:'Sasti OC'}];
 const render=(location='Dhoptala OC')=>{cursor=0;return Component({records,kind:'vehicle',location,value,onSelect:id=>{value=id}})};
 const find=(node,predicate)=>{if(!React.isValidElement(node))return [];return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>find(child,predicate))];};
 let tree=render();find(tree,n=>n.type==='input')[0].props.onChange({target:{value:'s'}});tree=render();
 assert.deepEqual(find(tree,n=>n.props.role==='option').map(n=>n.props.children.props.children),['S2','S12']);
 find(tree,n=>n.type==='input')[0].props.onKeyDown({key:'ArrowDown',preventDefault(){}});tree=render();find(tree,n=>n.type==='input')[0].props.onKeyDown({key:'Enter',preventDefault(){}});assert.equal(value,'s2');
 assert.equal(find(render(),n=>n.type==='input')[0].props.value,'S2');
 assert.equal(find(render(''),n=>n.type==='input')[0].props.disabled,true);
});
