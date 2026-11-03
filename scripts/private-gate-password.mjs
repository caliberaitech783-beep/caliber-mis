// Creates the private test gate password and cookie secret.
//
//   node scripts/private-gate-password.mjs            new random password
//   node scripts/private-gate-password.mjs --write F  also write them into env file F (kept out of git)
//
// Only PRIVATE_GATE_PASSWORD_HASH and PRIVATE_GATE_SECRET go to the server.
// The plain password stays with the owner.
import {randomBytes} from 'node:crypto';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {hashPassword} from '../password-auth.mjs';

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const pick=length=>[...randomBytes(length)].map(byte=>alphabet[byte%alphabet.length]).join('');
const password=`${pick(5)}-${pick(5)}-${pick(5)}-${pick(5)}`;
const secret=randomBytes(48).toString('base64url');
const lines={
  PRIVATE_GATE:'on',
  PRIVATE_GATE_PASSWORD:password,
  PRIVATE_GATE_PASSWORD_HASH:hashPassword(password),
  PRIVATE_GATE_SECRET:secret,
};

const target=process.argv[process.argv.indexOf('--write')+1];
if(process.argv.includes('--write')&&target){
  const kept=existsSync(target)?readFileSync(target,'utf8').split(/\r?\n/).filter(line=>line&&!Object.keys(lines).some(key=>line.startsWith(`${key}=`))):[];
  writeFileSync(target,[...kept,...Object.entries(lines).map(([key,value])=>`${key}=${value}`)].join('\n')+'\n',{mode:0o600});
  console.log(`Wrote the gate password, hash and secret to ${target}.`);
}else{
  for(const [key,value] of Object.entries(lines))console.log(`${key}=${value}`);
}
