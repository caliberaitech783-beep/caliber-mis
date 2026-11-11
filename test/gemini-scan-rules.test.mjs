import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../shared/gemini-scan-rules.mjs';
import {cardPrompt} from '../server/services/gemini-card-reader.mjs';
import {promptA,promptB} from '../server/services/gemini-hybrid.mjs';

const ruleNames=Object.keys(rules).filter(name=>typeof rules[name]==='string');

test('the cloud Gemini prompt carries every shared card-reading rule for VLB and ELB',()=>{
 assert.ok(ruleNames.length>=14);
 for(const kind of ['vehicle','equipment'])for(const name of ruleNames)assert.ok(cardPrompt(kind).includes(rules[name]),`${kind} cloud prompt is missing ${name}`);
});

test('the local hybrid Gemini prompts carry the same rules as the cloud prompt',()=>{
 const header=['SAFETY_RULES','NO_INVENTION_RULE','HEADER_RULES','SITE_RULES','EMPLOYEE_RULES','METER_DIGIT_RULE','DOOR_RULES','NAME_AND_FORM_RULES','MACHINE_NOTATION_RULES'];
 for(const kind of ['vehicle','equipment'])for(const name of header)assert.ok(promptA(kind).includes(rules[name]),`${kind} Priority A is missing ${name}`);
 for(const name of ['M_NO_READING_RULES','M_NO_COMPLETENESS_RULES','DEMO_PREFIX_RULES'])assert.ok(promptA('vehicle').includes(rules[name]),`VLB machine summary is missing ${name}`);
 for(const name of ['SAFETY_RULES','NO_INVENTION_RULE','MACHINE_NOTATION_RULES','M_NO_READING_RULES','M_NO_COMPLETENESS_RULES','DEMO_PREFIX_RULES','TIME_RULES','TRIP_ROW_RULES'])assert.ok(promptB('vehicle').includes(rules[name]),`VLB Priority B is missing ${name}`);
 // ELB still returns no vehicle trips and no trip-row instructions.
 assert.match(promptB('equipment'),/Return exactly \{"p":false,"r":\[\]\}/);
 assert.ok(!promptB('equipment').includes(rules.TRIP_ROW_RULES));
 assert.ok(!promptA('equipment').includes(rules.M_NO_READING_RULES));
});

test('notepad rules reach every Gemini prompt: fleet letters, door slash, meters, date, shift, site and employee ID',()=>{
 const prompts=[cardPrompt('vehicle'),cardPrompt('equipment'),promptA('vehicle'),promptA('equipment')];
 for(const text of prompts){
  assert.match(text,/V maps to VPC, E maps to TPC, S maps to SPC and bare H maps to Hydra/);
  assert.match(text,/S\/62 must never become S162 or S:162/);
  assert.match(text,/83995:6 means 83995\.6/);
  assert.match(text,/19 \/ 10 \/ 26 means 2026-10-19/);
  assert.match(text,/Map A\/1\/S1 to I, B\/2\/S2 to II, C\/3\/S3 to III/);
  assert.match(text,/Transcribe DCH \(East\) and DCH \(West\) literally/);
  assert.match(text,/numeric 3228 can identify Employee ID CMPL3228 or Caliber ID CMLL3228/);
 }
 for(const text of [cardPrompt('vehicle'),promptA('vehicle'),promptB('vehicle')]){
  assert.match(text,/if the image says DE, transcribe DE exactly, never DC/);
  assert.match(text,/V in M with 5 in NO means V5, never just V/);
 }
 for(const text of [cardPrompt('vehicle'),promptB('vehicle')])assert.match(text,/7:5 means 07:05/);
 // The hybrid prompt no longer tells Gemini to copy Trip Card shift hours as written.
 assert.ok(!promptA('vehicle').includes('shiftHours as written'));
});
