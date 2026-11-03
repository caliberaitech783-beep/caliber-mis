// A refactor that removes a variable but leaves a use behind ships a
// ReferenceError that only fires when that branch renders in an operator's
// browser: TIME_24H_PATTERN earlier, meterLimitIssues on 1 November 2026
// (every VLB card opened in review crashed for a day). Neither Vite nor the
// page tests catch a free identifier, so this test asks the TypeScript checker
// for "Cannot find name" across every UI source file. Only that diagnostic
// counts; type errors are ignored because the sources are untyped JavaScript.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const sources=readdirSync(path.join(root,'src')).filter(name=>/\.(jsx|mjs)$/.test(name)).map(name=>'src/'+name);
// Replaced by Vite at build time (vite.config.mjs `define`).
const buildTimeDefines=new Set(['__CALIBER_APP_VERSION__']);

test('UI source files reference no undefined names',()=>{
 const tsc=path.join(root,'node_modules','typescript','bin','tsc');
 const result=spawnSync(process.execPath,[tsc,'--noEmit','--allowJs','--checkJs','--jsx','preserve','--target','es2022','--module','esnext','--moduleResolution','bundler','--skipLibCheck','--lib','es2022,dom,dom.iterable','--pretty','false',...sources],{cwd:root,encoding:'utf8',maxBuffer:256*1024*1024});
 assert.ok(result.stdout||result.stderr,'tsc produced no output: '+(result.error?.message||''));
 const undefinedNames=[];
 for(const line of (result.stdout+'\n'+result.stderr).split(/\r?\n/)){
  const match=line.match(/^(.+?)\((\d+),(\d+)\): error TS2304: Cannot find name '([^']+)'/);
  if(!match||buildTimeDefines.has(match[4]))continue;
  undefinedNames.push(`${match[1]}:${match[2]}:${match[3]} ${match[4]}`);
 }
 assert.deepEqual(undefinedNames,[],'every identifier used in src/ must be declared or imported');
});
