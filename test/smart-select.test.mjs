import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import React from 'react';import {transformWithOxc} from 'vite';
test('long master lists become searchable while preserving IDs, required validation and native short choices',async()=>{
 const source=fs.readFileSync(new URL('../src/smart-select.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),{code}=await transformWithOxc(source,'smart-select.jsx',{jsx:{runtime:'classic'}}),SearchableSelect=()=>null;
 const Component=new Function('React','SearchableSelect',code+';return SmartSelect;')(React,SearchableSelect);
 const options=[React.createElement('option',{key:'empty',value:''},'Select driver'),...Array.from({length:10},(_,i)=>React.createElement('option',{key:i,value:String(i+1)},'Driver '+i))];let changed;
 const result=Component({children:options,required:true,name:'employeeId',value:'2',onChange:e=>{changed=e.target.value}});assert.equal(result.type,SearchableSelect);assert.equal(result.props.options.length,10);assert.equal(result.props.value,'2');result.props.onChange('5');assert.equal(changed,'5');
 assert.equal(Component({children:options.slice(0,3)}).type,'select');assert.equal(Component({children:options,multiple:true}).type,'select');
});
