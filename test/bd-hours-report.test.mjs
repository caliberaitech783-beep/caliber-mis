// Owner, 17 Nov 2026: BD hours of every loading machine from Pulse and from the ELB, side by side, high to low, and a
// mismatch report of the two (30 minutes tolerance).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mismatchKind,bdLines,summariseBd,machineShiftLines,hoursText,differenceText,BD_TOLERANCE_MINUTES,MISMATCH_KINDS} from '../shared/bd-hours-report.mjs';
import {isDurationColumn} from '../src/duration-sort.mjs';

test('Pulse and the ELB agree within 30 minutes; otherwise the kind says which side is missing or more',()=>{
 assert.equal(BD_TOLERANCE_MINUTES,30);
 assert.equal(mismatchKind({pulseMinutes:120,elbHours:2}),'match');
 assert.equal(mismatchKind({pulseMinutes:120,elbHours:2.5}),'match','exactly 30 minutes apart still agrees');
 assert.equal(mismatchKind({pulseMinutes:120,elbHours:2.6}),'elbmore');
 assert.equal(mismatchKind({pulseMinutes:150,elbHours:1.9}),'pulsemore');
 assert.equal(mismatchKind({pulseMinutes:45,elbHours:0}),'pulseonly');
 assert.equal(mismatchKind({pulseMinutes:45,elbHours:null}),'pulseonly','ELB saved with BD hours left blank');
 assert.equal(mismatchKind({pulseMinutes:0,elbHours:1}),'elbonly');
 assert.equal(mismatchKind({pulseMinutes:90,elbEntered:false}),'noelb');
 assert.equal(mismatchKind({pulseMinutes:0,elbEntered:false}),null,'no ELB and no Pulse breakdown: nothing to compare');
 assert.equal(mismatchKind({pulseMinutes:0,elbHours:0}),null);
 assert.deepEqual(MISMATCH_KINDS.map(k=>k.tone),['red','red','orange','orange','brown','green']);
});

test('hours read like the site writes them, the difference with its sign',()=>{
 assert.equal(hoursText(150),'2.5');assert.equal(hoursText(0),'0');assert.equal(hoursText(null),'—');
 assert.equal(differenceText(48),'+0.8');assert.equal(differenceText(-72),'-1.2');assert.equal(differenceText(0),'0');assert.equal(differenceText(null),'—');
});

const entry=(door,{site='Site A',date='2026-11-16',shift='Shift I',pulse=0,elb=null,elbEntered=true,category='Excavator',requests=[]}={})=>({
 id:site+date+shift+door,slotKey:site+'|'+date+'|'+shift,machineKey:'m-'+door,site,date,shift,door,machineName:'EXCAVATOR '+door,category,operator:'OP '+door,
 statusLabel:'Working',reason:'',elbBooks:'ELB-'+door,bdMinutes:pulse,bdHours:elb,elbEntered,bdRequests:requests,bdPeriods:[],lines:[],axis:{known:true,start:300,minutes:480}});

test('only machine shifts with a breakdown on either side are listed, with both figures and the difference',()=>{
 const lines=bdLines([entry('EX1',{pulse:120,elb:2,requests:[{reference:'BD-1',reason:'Hose burst',ongoing:false}]}),entry('EX2'),entry('EX3',{pulse:0,elb:0}),entry('EX4',{pulse:60,elbEntered:false,requests:[{reference:'BD-4',reason:'Engine',ongoing:true}]})]);
 assert.deepEqual(lines.map(l=>[l.door,l.kind,l.pulseMinutes,l.elbMinutes,l.diffMinutes]),[['EX1','match',120,120,0],['EX4','noelb',60,null,null]]);
 assert.equal(lines[0].pulseRefs,'BD-1');assert.equal(lines[0].pulseReasons,'Hose burst');assert.equal(lines[0].breakdownCount,1);
 assert.equal(lines[1].stillOpen,true);
});

test('BD hours: sites and machines highest Pulse BD hours first; the mismatch tab puts the biggest difference on top',()=>{
 const lines=bdLines([
  entry('EX1',{pulse:60,elb:1}),entry('EX2',{pulse:300,elb:5}),entry('EX3',{pulse:120,elb:4}),entry('EX4',{pulse:0,elb:2}),
  entry('EX9',{site:'Site B',pulse:600,elb:10})]);
 assert.deepEqual(summariseBd(lines,'site').rows.map(r=>r.site),['Site B','Site A']);
 const a=summariseBd(lines.filter(l=>l.site==='Site A'),'machine');
 assert.deepEqual(a.rows.map(r=>r.door),['EX2','EX3','EX1','EX4'],'Pulse hours high to low; ELB-only last');
 assert.equal(a.total.pulseMinutes,480);assert.equal(a.total.elbMinutes,720);assert.equal(a.total.diffMinutes,240);
 assert.equal(a.total.mismatches,2);assert.equal(a.total.elbmore,1);assert.equal(a.total.elbonly,1);assert.equal(a.total.match,2);
 const m=summariseBd(lines.filter(l=>l.site==='Site A'),'machine','mismatch');
 // EX3 and EX4 are both 2 hours apart: the worse kind (BD on one side only) goes first.
 assert.deepEqual(m.rows.map(r=>[r.door,r.kind]),[['EX4','elbonly'],['EX3','elbmore'],['EX2','match'],['EX1','match']],'mismatches first, the biggest difference on top');
 const wider=summariseBd(bdLines([entry('EX3',{pulse:120,elb:5}),entry('EX4',{pulse:0,elb:1})]),'machine','mismatch');
 assert.deepEqual(wider.rows.map(r=>r.door),['EX3','EX4'],'3 hours apart before 1 hour apart');
 assert.deepEqual(machineShiftLines([...lines].reverse(),'mismatch').map(l=>l.kind).slice(0,2),['elbonly','elbmore']);
});

test('the Loading machines report has the BD hours and BD mismatch tabs, drilled down step by step',()=>{
 const report=fs.readFileSync(new URL('../src/loading-machine-report.jsx',import.meta.url),'utf8');
 assert.match(report,/\['bd','BD hours \(Pulse \+ ELB\)'\],\['mismatch','BD mismatch'\]/);
 assert.match(report,/if\(mode==='bd'\|\|mode==='mismatch'\)return [^\n]*<BdHoursReport key=\{mode\} mode=\{mode\} entries=\{visible\}/);
 const screen=fs.readFileSync(new URL('../src/bd-hours-report.jsx',import.meta.url),'utf8');
 for(const step of ["'Step 1 · '+name+' · All sites · '","'Step 2 · '+name+' · '+siteLabel+' · date by shift · '","'Step 3 · '+name+' · '+slotWhere+' · by equipment category'","'Step 4 · '+name+' · '+where","'Step 5 · '+name+' · '+item.label","'Step 6 · Breakdowns in Pulse · '"])assert.ok(screen.includes(step),step);
 assert.match(screen,/<DateShiftGrid grid=\{grid\}/,'Step 2 is the date by shift table');
 assert.ok(!/from '\.\/loading-machine-report\.jsx'/.test(screen),'the two screens do not import each other');
 // The table sorts itself by a column it takes for a duration; none of these may be one, or the lines lose their order.
 for(const [,key,label] of screen.matchAll(/column\('([^']+)','([^']+)'/g))assert.ok(!isDurationColumn(label,key),label+' must not be taken for a duration');
 assert.ok(screen.includes("column('pulseBd','Pulse BD hours'")&&screen.includes("column('elbBd','ELB BD hours'")&&screen.includes("column('bdDifference','Difference (ELB − Pulse, h)'"));
 const css=fs.readFileSync(new URL('../src/bd-hours-report.css',import.meta.url),'utf8');
 for(const tone of ['red','orange','brown','green'])assert.ok(css.includes('.bd-report .bd-kind-'+tone+'{'),tone);
});

test('a machine shift says whether its ELB was entered',()=>{
 const shared=fs.readFileSync(new URL('../shared/loading-machine-report.mjs',import.meta.url),'utf8');
 assert.match(shared,/elbEntered:m\.cards\.length>0,/);
});
