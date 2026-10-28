import test from 'node:test';import assert from 'node:assert/strict';
import {chooseConnectedScanner,captureScanner} from '../scanner-selection.mjs';
const a={id:'a',name:'Canon'},b={id:'b',name:'Epson'},c={id:'c',name:'Brother'};
test('detects all Windows models and preserves an explicit selection',()=>{
 const brother={id:'brother',name:'Brother ADS-3100 USB'},canon={id:'canon',name:'Canon DR-C225II USB'};
 assert.equal(chooseConnectedScanner([b,brother],''),'b');
 assert.equal(chooseConnectedScanner([b,canon],''),'b');
 assert.equal(chooseConnectedScanner([brother,canon],'canon'),'canon');
 assert.equal(chooseConnectedScanner([brother,canon],'brother',['brother']),'brother');
 assert.equal(chooseConnectedScanner([canon],'brother',['brother']),'canon');
 assert.equal(chooseConnectedScanner([b],''),'b');
 assert.equal(chooseConnectedScanner([],'canon'),'');
});
test('accepts every model reported by Windows regardless of driver naming',()=>{
 for(const name of ['Brother ADS 3100','BROTHER ADS-3100 LAN','Canon DR-C225 II','Canon DR-C225II','CANON DR C225II USB'])assert.equal(chooseConnectedScanner([{id:'match',name}]),'match',name);
 for(const name of ['Canon iR C3326','Brother ADS-31000','Canon DR-C225','Canon DR-C225III','Epson'])assert.equal(chooseConnectedScanner([{id:'other',name}]),'other',name);
 assert.equal(chooseConnectedScanner([null,{id:''},{id:'working',name:'USB scanner'}]),'working');
 assert.equal(chooseConnectedScanner([a,b],'disconnected',['a']),'b');
});
test('capture follows a replacement scanner only when exactly one is connected',()=>{
 assert.equal(captureScanner([b],'old-disconnected'),b);
 assert.equal(captureScanner([a,b],'old-disconnected'),null);
 assert.equal(captureScanner([a,b],'b'),b);
 assert.equal(captureScanner([],''),null);
});
