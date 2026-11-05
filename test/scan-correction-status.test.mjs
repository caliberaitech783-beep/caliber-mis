import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {scanReviewHelp} from '../src/scan-review-layout.mjs';
const source=readFileSync(new URL('../src/scan-correction-status.jsx',import.meta.url),'utf8').replace(/\r\n/g,'\n').replace(/^import .*;\n/gm,'').replace('export default function','function');
const {code}=await transformWithOxc(source,'scan-correction-status.jsx',{jsx:{runtime:'classic'}});
const Status=new Function('React','scanReviewHelp',code+';return ScanCorrectionStatus;')(React,scanReviewHelp);
test('saved corrections and remaining checks produce one truthful combined status',()=>{
 const html=renderToStaticMarkup(React.createElement(Status,{status:'All scan corrections saved to MIS.',errors:['Select a shift.']}));
 assert.equal((html.match(/role="status"/g)||[]).length,1);
 assert.match(html,/User input needed/);assert.match(html,/1 item needs checking\./);assert.match(html,/Corrections saved\./);assert.match(html,/<details open="">/);assert.match(html,/Select a shift/);assert.match(html,/scan-warning/);
 const saved=renderToStaticMarkup(React.createElement(Status,{status:'All scan corrections saved to MIS.'}));assert.match(saved,/scan-success/);assert.match(saved,/Corrections saved/);
 const failed=renderToStaticMarkup(React.createElement(Status,{status:'Not saved to MIS: offline'}));assert.match(failed,/scan-error/);assert.doesNotMatch(failed,/Corrections saved/);
});

test('yellow issue messages use short wording without changing validation details',()=>{
 const html=renderToStaticMarkup(React.createElement(Status,{errors:['Enter the trip card number from the original scan.','Closing HMR must be greater than or equal to opening HMR.'],warnings:['Check the time against the original card.']}));
 assert.match(html,/2 items need checking/);
 assert.match(html,/Enter the trip card number\./);
 assert.match(html,/Check the time\./);
 assert.match(html,/Closing HMR must be greater than or equal to opening HMR\./);
 assert.doesNotMatch(html,/original (?:scan|card)/);
});

test('active checks replace stale input prompts and advisory notes do not request input',()=>{
 const working=renderToStaticMarkup(React.createElement(Status,{working:'Checking card 5 and saving corrections',errors:['Select a shift.']}));
 assert.match(working,/System is working/);assert.match(working,/Checking card 5/);assert.match(working,/scan-review-spinner/);assert.doesNotMatch(working,/User input needed|Select a shift/);
 const advisory=renderToStaticMarkup(React.createElement(Status,{warnings:['Batch values applied.']}));
 assert.match(advisory,/View notes/);assert.doesNotMatch(advisory,/User input needed|System is working/);
});
