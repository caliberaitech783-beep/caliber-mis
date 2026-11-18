import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('ERP login has MIS and HR entries and the supplied ERP identity',async()=>{
 const source=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
 const links=source.split('<div className="login-application-links">')[1].split('</div>')[0];
 assert.equal((links.match(/<button\b/g)||[]).length,1);
 assert.match(links,/<strong>MIS<\/strong>/);
 assert.match(links,/<a className="login-hr-link" href="\/hr\/"><[^>]+\/><span><strong>HR<\/strong>/);
 assert.doesNotMatch(links,/href="(?!\/hr\/")|Fleet Operation|Accident|Accounts|Tender/);
 assert.match(source,/src="\/pulse-ii-icon.png" alt="Caliber Pulse-II"/);
 assert.doesNotMatch(source,/Fleet operations platform|Sign in to access your fleet operations workspace/);
});
