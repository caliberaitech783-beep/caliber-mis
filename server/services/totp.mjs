import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,value=0,result='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(value>>>bits)&31];}}if(bits)result+=alphabet[(value<<(5-bits))&31];return result;}
function decode(value){let bits=0,n=0;const bytes=[];for(const char of String(value).toUpperCase().replace(/=+$/,'')){const index=alphabet.indexOf(char);if(index<0)throw Error('Invalid authenticator secret');n=(n<<5)|index;bits+=5;if(bits>=8){bits-=8;bytes.push((n>>>bits)&255);}}return Buffer.from(bytes);}
export const newTotpSecret=()=>base32(randomBytes(20));
export function totp(secret,counter,{digits=6,algorithm='sha1'}={}){const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(counter));const digest=createHmac(algorithm,decode(secret)).update(bytes).digest(),offset=digest.at(-1)&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function verifyTotp(secret,code,{now=Date.now(),lastCounter=-1}={}){if(!/^\d{6}$/.test(String(code)))return null;const counter=Math.floor(now/30000);for(const offset of [0,-1,1]){const step=counter+offset;if(step<=lastCounter||step<0)continue;if(timingSafeEqual(Buffer.from(totp(secret,step)),Buffer.from(String(code))))return step;}return null;}
export const recoveryHash=value=>createHash('sha256').update(String(value).replace(/[ -]/g,'').toLowerCase()).digest('hex');
export const recoveryCodes=()=>Array.from({length:10},()=>randomBytes(10).toString('hex').match(/.{1,5}/g).join('-'));
