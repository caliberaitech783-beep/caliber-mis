import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';
export async function createIntegrationSecretStore(pool,keyFile){
 await mkdir(path.dirname(keyFile),{recursive:true});let key;
 try{key=await readFile(keyFile)}catch(e){if(e.code!=='ENOENT')throw e;try{await writeFile(keyFile,randomBytes(32),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}key=await readFile(keyFile)}
 if(key.length!==32)throw Error('Integration encryption key is invalid.');
 await pool.query('CREATE TABLE IF NOT EXISTS mis_integration_secrets(name TEXT PRIMARY KEY,ciphertext TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
 return {
  async read(name){const row=(await pool.query('SELECT ciphertext FROM mis_integration_secrets WHERE name=$1',[name])).rows[0];if(!row)return null;const bytes=Buffer.from(row.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(Buffer.from(name));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());},
  async write(name,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(name));const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);await pool.query('INSERT INTO mis_integration_secrets(name,ciphertext) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW()',[name,Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64')]);},
  async remove(name){await pool.query('DELETE FROM mis_integration_secrets WHERE name=$1',[name]);}
 };
}
