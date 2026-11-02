import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {drawCard} from './scan-card-fixture.mjs';
import {fingerprintScanImage,fingerprintDistance,classifyFingerprintMatch,closestFingerprint,scanFingerprintSettings,FINGERPRINT_MAX,FINGERPRINT_VERSION} from '../scan-fingerprint.mjs';

test('a rescan of the same paper lands within the skip threshold; a different card does not',async()=>{
 const settings=scanFingerprintSettings({SCAN_DUPLICATE_FINGERPRINT:'true'});
 const original=await fingerprintScanImage(drawCard({seed:1}));
 assert.equal(original.version,FINGERPRINT_VERSION);assert.equal(original.cols,64);assert.equal(Buffer.from(original.cells,'base64').length,original.cols*original.rows);
 for(const [label,variant] of [['shifted, brighter, noisy',{seed:1,shiftX:6,shiftY:-4,brightness:.06,noise:12}],['shifted further, darker, noisier',{seed:1,shiftX:15,shiftY:12,brightness:-.08,noise:20}],['fed upside down',{seed:1,rotate:true,shiftX:3,noise:6}],['far off the feed edge',{seed:1,shiftX:40,shiftY:-30,noise:10}]]){
  const distance=fingerprintDistance(original,await fingerprintScanImage(drawCard(variant)));
  assert(distance.max<=settings.skipPercent,label+': '+JSON.stringify(distance));
  assert.equal(classifyFingerprintMatch(distance,settings),'duplicate',label);
 }
 for(const [label,variant] of [['other handwriting',{seed:2,writing:'B'}],['third card',{seed:3,writing:'C'}],['same header, different trips',{seed:4,writing:'A'}]]){
  const distance=fingerprintDistance(original,await fingerprintScanImage(drawCard(variant)));
  assert(distance.max>settings.suspectPercent,label+': '+JSON.stringify(distance));
  assert.equal(classifyFingerprintMatch(distance,settings),'different',label);
 }
});

test('closest candidate is reported with its classification and unknown fingerprints never match',async()=>{
 const settings=scanFingerprintSettings({SCAN_DUPLICATE_FINGERPRINT:'true',SCAN_DUPLICATE_SKIP_PERCENT:'15',SCAN_DUPLICATE_SUSPECT_PERCENT:'30'});
 const target=await fingerprintScanImage(drawCard({seed:5,writing:'E'}));
 const candidates=[{id:'a',fingerprint:await fingerprintScanImage(drawCard({seed:6,writing:'F'}))},{id:'b',fingerprint:await fingerprintScanImage(drawCard({seed:5,writing:'E',shiftX:4,noise:8}))},{id:'c',fingerprint:null},{id:'d',fingerprint:{version:99}}];
 const best=closestFingerprint(target,candidates,settings);
 assert.equal(best.candidate.id,'b');assert.equal(best.match,'duplicate');
 assert.equal(closestFingerprint(target,[candidates[2],candidates[3]],settings),null);
 assert.equal(fingerprintDistance(target,{version:99}).max,FINGERPRINT_MAX);
 assert.equal(fingerprintDistance(target,{...target,rows:target.rows+1}).max,FINGERPRINT_MAX);
 assert.equal(classifyFingerprintMatch({max:16},settings),'suspect');
 assert.deepEqual(scanFingerprintSettings({}),{enabled:false,skipPercent:15,suspectPercent:30});
 assert.deepEqual(scanFingerprintSettings({SCAN_DUPLICATE_FINGERPRINT:'true',SCAN_DUPLICATE_SKIP_PERCENT:'5',SCAN_DUPLICATE_SUSPECT_PERCENT:'999'}),{enabled:true,skipPercent:5,suspectPercent:30});
});

test('webp and jpeg scans fingerprint the same as the png source',async()=>{
 const png=drawCard({seed:9,writing:'W'});
 const image=await loadImage(png),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);
 const base=await fingerprintScanImage(png);
 for(const [format,quality] of [['webp',82],['jpeg',85]]){
  const distance=fingerprintDistance(base,await fingerprintScanImage(await canvas.encode(format,quality)));
  assert(distance.max<=3,format+' distance '+JSON.stringify(distance));
 }
});
