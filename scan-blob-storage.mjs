import {createHash} from 'node:crypto';

export const imageHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function scanBlobConfig(env=process.env){
 if(env.MIS_LOCAL_SCANNER_DATABASE==='true'||env.MIS_SCAN_BLOB_ENABLED!=='true')return null;
 if(env.WEBSITE_SITE_NAME!=='caliber-mis-783')throw Error('Scan Blob storage is limited to Pulse-II.');
 const account=env.MIS_SCAN_BLOB_ACCOUNT,container=env.MIS_SCAN_BLOB_CONTAINER||'scanned-cards';
 if(!/^[a-z0-9]{3,24}$/.test(account||'')||!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(container))throw Error('Invalid scan Blob account or container.');
 return {account,container};
}

// Uses App Service managed identity. No account keys or public image URLs.
export function createScanBlobStorage(config,{fetchImpl=fetch,env=process.env}={}){
 if(!config)return null;
 const base=`https://${config.account}.blob.core.windows.net/${config.container}/`;let cached;
 async function token(){
  if(cached&&cached.expires>Date.now()+120000)return cached.value;
  if(!env.IDENTITY_ENDPOINT||!env.IDENTITY_HEADER)throw Error('Scan storage managed identity is unavailable.');
  const url=new URL(env.IDENTITY_ENDPOINT);url.searchParams.set('resource','https://storage.azure.com/');url.searchParams.set('api-version','2019-08-01');
  const response=await fetchImpl(url,{headers:{'X-IDENTITY-HEADER':env.IDENTITY_HEADER},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Scan storage identity could not be verified.');
  const result=await response.json();cached={value:result.access_token,expires:Number(result.expires_on)*1000};return cached.value;
 }
 async function request(key,options={}){
  if(!/^(vehicle|equipment)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png)$/.test(key))throw Error('Invalid scan image reference.');
  return fetchImpl(base+key,{...options,headers:{Authorization:`Bearer ${await token()}`,'x-ms-version':'2023-11-03',...options.headers},signal:AbortSignal.timeout(60000)});
 }
 async function read(key,expectedHash){
  const response=await request(key);if(!response.ok)throw Error('The scan image could not be read from Hot storage. Retry shortly.');
  const bytes=Buffer.from(await response.arrayBuffer());if(imageHash(bytes)!==expectedHash)throw Error('The scan image checksum does not match.');return bytes;
 }
 return {
  async check(){
   const response=await fetchImpl(base+'?restype=container',{method:'HEAD',headers:{Authorization:`Bearer ${await token()}`,'x-ms-version':'2023-11-03'},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('The private Hot scan container is not accessible.');return true;
  },
  async put({id,batchId,kind,image}){
   const hash=imageHash(image),key=`${kind}/${batchId}/${id}.${image[0]===255?'jpg':'png'}`.toLowerCase();
   const response=await request(key,{method:'PUT',headers:{'x-ms-blob-type':'BlockBlob','x-ms-access-tier':'Hot','If-None-Match':'*','Content-Type':image[0]===255?'image/jpeg':'image/png','x-ms-meta-sha256':hash,'Content-MD5':createHash('md5').update(image).digest('base64')},body:image});
   if(!response.ok&&response.status!==412)throw Error('The scan was not saved to Hot storage. Retry the upload.');
   // Verify successful writes and idempotent retries before persisting the reference.
   await read(key,hash);return {key,bytes:image.length,uploadedAt:new Date()};
  },
  read,
  async hydrate(card){if(card?.image_blob_key)card.image=await read(card.image_blob_key,card.image_hash);return card;},
 };
}
