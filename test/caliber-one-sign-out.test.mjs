import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isCaliberOneSignOut,CALIBER_ONE_ORIGIN,CALIBER_ONE_SIGN_OUT} from '../src/caliber-one-sign-out.mjs';

// Caliber One (owner, 28 Nov 2026): "Sign out all" on pulse.cmll.in/one signs the Pulse-II tab out.
// Only the Caliber One window holding this tab can ask; Pulse-II opened alone ignores the message.
test('only Caliber One, holding Pulse-II as a tab, can sign Pulse-II out by message',()=>{
 const parent={},self={parent};
 const message=(over={})=>({source:parent,origin:CALIBER_ONE_ORIGIN,data:{type:CALIBER_ONE_SIGN_OUT},...over});
 assert.equal(isCaliberOneSignOut(message(),self),true);
 assert.equal(isCaliberOneSignOut(message({origin:'https://evil.example'}),self),false,'another website');
 assert.equal(isCaliberOneSignOut(message({source:{}}),self),false,'not the window that holds the tab');
 assert.equal(isCaliberOneSignOut(message({data:{type:'something-else'}}),self),false);
 const alone={};alone.parent=alone;
 assert.equal(isCaliberOneSignOut({source:alone,origin:CALIBER_ONE_ORIGIN,data:{type:CALIBER_ONE_SIGN_OUT}},alone),false,'Pulse-II opened alone');
 assert.equal(isCaliberOneSignOut(null,self),false);
});

test('the message runs the same sign-out as the Sign out button',async()=>{
 const main=(await readFile(new URL('../src/main.jsx',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
 assert.match(main,/import \{isCaliberOneSignOut\} from '\.\/caliber-one-sign-out\.mjs';/);
 assert.match(main,/const onMessage=event=>\{if\(isCaliberOneSignOut\(event\)\)logout\(\);\};window\.addEventListener\('message',onMessage\);/);
 assert.match(main,/logout = \(\) => \{\n\s+setSharedSignedOut\(true\);\n\s+const token=session\?\.token\|\|authToken;\n\s+if\(token\)void fetch\('\/api\/mis-credentials\/logout'/);
});
