import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('runtime imports resolve after the folder migration and root entry points remain stable',()=>{
 assert.deepEqual(readdirSync(root).filter(name=>name.endsWith('.mjs')).sort(),['build-site.mjs','server.mjs','vite.config.mjs']);
 const failures=[],visited=new Set();
 const visit=file=>{
   if(visited.has(file)||!/\.(mjs|jsx|js)$/.test(file))return;
   visited.add(file);
   const source=readFileSync(file,'utf8');
   // Literal import/export paths only; package imports are resolved by build/startup.
   for(const [,specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)){
    const target=path.resolve(path.dirname(file),specifier.split('?')[0]);
    if(!existsSync(target))failures.push(path.relative(root,file)+': '+specifier);
    else visit(target);
   }
 };
 for(const entry of ['server.mjs','src/main.jsx','public/scanner-connector.js'])visit(path.join(root,entry));
 assert.deepEqual(failures,[]);
 const scripts=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).scripts;
 assert.equal(scripts.start,'node server.mjs');assert.equal(scripts.build,'node build-site.mjs');
});
