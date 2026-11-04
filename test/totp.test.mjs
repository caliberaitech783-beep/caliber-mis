import test from 'node:test';import assert from 'node:assert/strict';
import {base32,totp,verifyTotp,recoveryCodes,recoveryHash} from '../server/services/totp.mjs';
test('TOTP matches RFC 6238 SHA1 test vectors',()=>{
 const secret=base32(Buffer.from('12345678901234567890'));
 for(const [seconds,expected]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,Math.floor(seconds/30),{digits:8}),expected);
});
test('TOTP tolerates one time step, rejects invalid input, expired codes and replay',()=>{
 const secret=base32(Buffer.alloc(20,7)),now=1234567890000,counter=Math.floor(now/30000),code=totp(secret,counter);
 assert.equal(verifyTotp(secret,code,{now}),counter);assert.equal(verifyTotp(secret,code,{now:now+30000}),counter);
 assert.equal(verifyTotp(secret,code,{now:now+60000}),null);assert.equal(verifyTotp(secret,code,{now,lastCounter:counter}),null);
 for(const code of ['123','0000000','abcdef',{},null])assert.equal(verifyTotp(secret,code,{now}),null);
 const codes=recoveryCodes();assert.equal(new Set(codes).size,10);assert.ok(codes.every(x=>x.replaceAll('-','').length===20));assert.equal(recoveryHash(codes[0]),recoveryHash(codes[0].replaceAll('-','').toUpperCase()));
});
