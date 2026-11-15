import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {readFileSync} from 'node:fs';import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/breakdown-hours-field.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
const {code}=await transformWithOxc(source,'breakdown-hours-field.jsx',{jsx:{runtime:'classic'}});
const Field=new Function('React',code+';return BreakdownHoursField')(React);
const nodes=tree=>React.Children.toArray(tree.props.children);
test('manual BD entry appears only after Pulse fails, and keyboard entry preserves zero',()=>{
 let changed;const props={ready:true,shiftHours:8,manualValue:0,error:'Offline',onChange:value=>changed=value};
 const input=nodes(Field(props)).find(n=>n.type==='input');assert.equal(input.props.value,0);assert.equal(input.props.max,8);input.props.onChange({target:{value:'2.5'}});assert.equal(changed,'2.5');
 for(const other of [{loading:true},{ready:false},{error:'',pulse:{breakdownHours:0}}])assert.equal(nodes(Field({...props,...other})).some(n=>n.type==='input'),false);
 assert.equal(nodes(Field({...props,error:'',pulse:{breakdownHours:null}})).some(n=>n.type==='input'),true);
 assert.equal(nodes(Field({...props,readOnly:true,savedValue:2})).find(n=>n.type==='output').props.children,'2.00');
});

test('BD hours from the stored Pulse copy say when Pulse was read, and an old copy says what may be missing',()=>{
 const small=tree=>nodes(tree).filter(n=>n.type==='small').map(n=>n.props.children);
 assert.deepEqual(small(Field({ready:true,pulse:{breakdownHours:1.5,pulseAsOf:'2026-11-15T14:05:00.000Z',warnings:[]}})),['From Pulse · as of 19:35']);
 const old=small(Field({ready:true,pulse:{breakdownHours:1.5,pulseAsOf:'2026-11-15T14:05:00.000Z',warnings:['Pulse could not be read since 15 Nov, 19:35 IST; breakdowns after that are not counted yet.']}}));
 assert.equal(old.length,2);assert.match(old[1],/not counted yet/);
 assert.deepEqual(small(Field({ready:true,pulse:{breakdownHours:0}})),['From Pulse'],'live answers keep the old wording');
});
