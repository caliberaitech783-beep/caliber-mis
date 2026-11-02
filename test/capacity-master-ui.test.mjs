import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {capacityRegionLocations} from '../production-report-api.mjs';

const source=readFileSync(new URL('../src/capacity-master.jsx',import.meta.url),'utf8');

test('capacity master adds Region Master location and job type in the requested positions and history',()=>{
 const location=source.indexOf('<label>Location<select');
 const make=source.indexOf('<label>Make<select');
 const capacity=source.indexOf('<label>Capacity (CUM/trip)');
 const jobType=source.indexOf('<label>Job type<input');
 assert.ok(location>=0&&location<make,'location is before make');
 assert.ok(capacity>=0&&capacity<jobType,'job type is after capacity');
 assert.match(source,/data\.locations\.map\(location=>/);
 assert.match(source,/Make<select required disabled=\{!form\.location\}/);
 assert.match(source,/Model<select required disabled=\{!form\.make\}/);
 assert.match(source,/\['location','Location'\].*\['jobType','Job type'\]/s);
});

test('capacity locations include the Region Master locations shown before database records exist',()=>{
 const locations=capacityRegionLocations([]);
 assert.ok(locations.includes('Sasti OC'));
 assert.ok(locations.includes('Jayant OC'));
 assert.deepEqual(capacityRegionLocations([{id:1,master_name:'Region master',record_data:{sites:['Custom Mine','Sasti OB']}}]).filter(location=>['Custom Mine','Sasti OC'].includes(location)),['Custom Mine','Sasti OC']);
});
