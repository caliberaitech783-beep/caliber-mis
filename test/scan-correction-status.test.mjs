import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/scan-correction-status.jsx',import.meta.url),'utf8').replace(/\r\n/g,'\n').replace(/^import .*;\n/gm,'').replace('export default function','function');
const {code}=await transformWithOxc(source,'scan-correction-status.jsx',{jsx:{runtime:'classic'}});
const Status=new Function('React',code+';return ScanCorrectionStatus;')(React);
test('saved corrections and remaining checks produce one truthful combined status',()=>{
 const html=renderToStaticMarkup(React.createElement(Status,{status:'All scan corrections saved to MIS.',errors:['Select a shift.']}));
 assert.equal((html.match(/role="status"/g)||[]).length,1);
 assert.match(html,/Corrections saved\. 1 item needs checking\./);assert.match(html,/Select a shift/);assert.match(html,/scan-warning/);
 const saved=renderToStaticMarkup(React.createElement(Status,{status:'All scan corrections saved to MIS.'}));assert.match(saved,/scan-success/);assert.match(saved,/Corrections saved/);
 const failed=renderToStaticMarkup(React.createElement(Status,{status:'Not saved to MIS: offline'}));assert.match(failed,/scan-error/);assert.doesNotMatch(failed,/Corrections saved/);
});
