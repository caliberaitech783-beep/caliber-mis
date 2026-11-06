import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../src/log-book-form.css',import.meta.url),'utf8');

test('desktop VLB manual overrides large shared controls with its single-page sheet sizing',()=>{
 assert.match(css,/@media screen and \(min-width:1000px\)[\s\S]*?\.logbook-vehicle #logbook-entry-form \.logbook-field\{display:grid;grid-template-columns:100px minmax\(0,1fr\)/);
 assert.match(css,/\.logbook-vehicle #logbook-entry-form \.logbook-field :is\([^}]+\)\{min-height:25px!important;height:25px!important/);
 assert.match(css,/\.logbook-vehicle #logbook-entry-form \.logbook-table :is\(input,select,output\)\{min-height:23px!important;height:23px!important/);
 assert.match(css,/\.logbook-vehicle #logbook-entry-form \.logbook-save-bar\{display:none\}/);
});
