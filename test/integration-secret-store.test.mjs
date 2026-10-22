import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createIntegrationSecretStore} from '../integration-secret-store.mjs';
test('connection credentials are encrypted, survive restart, and reject modified ciphertext',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'mis-vault-'));t.after(()=>rm(dir,{recursive:true,force:true}));const data=new Map();
 const pool={query:async(sql,args=[])=>{if(sql.startsWith('INSERT'))data.set(args[0],args[1]);if(sql.startsWith('DELETE'))data.delete(args[0]);return {rows:sql.startsWith('SELECT')&&data.has(args[0])?[{ciphertext:data.get(args[0])}]:[]}}};
 const key=path.join(dir,'key'),a=await createIntegrationSecretStore(pool,key),credentials={username:'test-account',password:'synthetic-password'};
 await a.write('pulse',credentials);assert.ok(!data.get('pulse').includes('synthetic-password'));
 const b=await createIntegrationSecretStore(pool,key);assert.deepEqual(await b.read('pulse'),credentials);
 data.set('oracle',data.get('pulse'));await assert.rejects(()=>b.read('oracle'));
 await b.remove('pulse');assert.equal(await b.read('pulse'),null);
});
