import {createPublicKey,verify} from 'node:crypto';

// Verifies a GitHub Actions OIDC token (RS256 JWT signed by GitHub). The release
// workflow presents one, so Pulse-II can trust a request without a shared secret:
// only a run of the named workflow file, in this repository, on main, can mint it.
export const GITHUB_OIDC_ISSUER='https://token.actions.githubusercontent.com';
const JWKS_URL=`${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const fail=message=>{throw Object.assign(new Error(message),{status:401})};
const b64json=part=>{try{return JSON.parse(Buffer.from(part,'base64url').toString('utf8'))}catch{return fail('Invalid release identity.')}};

export function createGithubOidcVerifier({audience,repository,workflowFile,ref='refs/heads/main',fetchImpl=fetch,now=()=>Date.now(),cacheMs=60*60*1000}){
 let cache={at:0,keys:new Map()};
 const keyFor=async kid=>{
  if(!cache.keys.has(kid)||now()-cache.at>cacheMs){
   const response=await fetchImpl(JWKS_URL,{signal:AbortSignal.timeout(10000)});
   if(!response.ok)fail('GitHub signing keys are unavailable.');
   const {keys=[]}=await response.json();
   cache={at:now(),keys:new Map(keys.filter(k=>k.kty==='RSA'&&k.kid).map(k=>[k.kid,createPublicKey({key:k,format:'jwk'})]))};
  }
  return cache.keys.get(kid)||fail('Unknown release identity key.');
 };
 return async token=>{
  const parts=String(token||'').split('.');
  if(parts.length!==3)fail('A release identity is required.');
  const header=b64json(parts[0]),claims=b64json(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string')fail('Invalid release identity.');
  const key=await keyFor(header.kid);
  if(!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),key,Buffer.from(parts[2],'base64url')))fail('Invalid release identity.');
  const seconds=now()/1000,audiences=[].concat(claims.aud);
  if(claims.iss!==GITHUB_OIDC_ISSUER||!audiences.includes(audience))fail('Invalid release identity.');
  if(!(claims.exp>seconds)||(claims.nbf&&claims.nbf>seconds+60))fail('The release identity has expired.');
  if(claims.repository!==repository||claims.ref!==ref)fail('Releases are accepted only from main of this repository.');
  if(!String(claims.workflow_ref||'').startsWith(`${repository}/.github/workflows/${workflowFile}@${ref}`))fail('Releases are accepted only from the production release workflow.');
  return claims;
 };
}
