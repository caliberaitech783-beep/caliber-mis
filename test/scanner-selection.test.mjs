import test from 'node:test';import assert from 'node:assert/strict';
import {chooseConnectedScanner,captureScanner} from '../scanner-selection.mjs';
const a={id:'a',name:'Canon'},b={id:'b',name:'Epson'},c={id:'c',name:'Brother'};
test('detects and selects newly connected scanners without a brand preference',()=>{
 assert.equal(chooseConnectedScanner([a],'',[]),'a');
 assert.equal(chooseConnectedScanner([a,b],'a',['a']),'b');
 assert.equal(chooseConnectedScanner([a,b],'a',['a','b']),'a');
 assert.equal(chooseConnectedScanner([b],'a',['a','b']),'b');
 assert.equal(chooseConnectedScanner([],'b',['b']),'');
 assert.equal(chooseConnectedScanner([b,c],''),'b');
});
test('capture follows a replacement scanner only when exactly one is connected',()=>{
 assert.equal(captureScanner([b],'old-disconnected'),b);
 assert.equal(captureScanner([a,b],'old-disconnected'),null);
 assert.equal(captureScanner([a,b],'b'),b);
 assert.equal(captureScanner([],''),null);
});
