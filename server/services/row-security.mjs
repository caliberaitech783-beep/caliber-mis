import {AsyncLocalStorage} from 'node:async_hooks';
import {SITE_ALIASES,canonicalSiteName} from '../../shared/site-location.mjs';
const requests=new AsyncLocalStorage();
let rlsReady=false;
export const rowSecurityContext=(req,_res,next)=>requests.run({req},next);
export const withoutRowSecurityRequest=task=>requests.exit(task);
// The HTTP request the current code is serving, if any (used to name who holds a database connection).
export const currentRequest=()=>requests.getStore()?.req||null;
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function initializeRowSecurity(pool,{enabled=false}={}){
 if(!enabled)return;
 rlsReady=false;
 const role=(await pool.query('SELECT current_user AS name,rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(role?.rolbypassrls||role?.rolsuper)throw Error('RLS requires the restricted MIS database role; administrator credentials are not accepted.');
 const aliases=[...SITE_ALIASES].map(([key,value])=>'('+literal(key)+','+literal(value)+')').join(',');
 const client=await pool.connect();
 try{await client.query('BEGIN');
 await client.query('CREATE SCHEMA IF NOT EXISTS mis_security');
 await client.query(`CREATE OR REPLACE FUNCTION mis_security.canonical_site(input text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $site$
  WITH normalized AS (SELECT trim(regexp_replace(regexp_replace(lower(trim(COALESCE(input,''))),'[^a-z0-9]+',' ','g'),'\\moc\\M','ob','g')) AS value)
  SELECT COALESCE((SELECT canonical FROM (VALUES ${aliases}) AS aliases(alias,canonical) WHERE alias=normalized.value),normalized.value) FROM normalized $site$`);
 // No request context means a trusted server background job or a migration.
 // HTTP reads/writes always receive an explicit transaction-local scope below.
 await client.query(`CREATE OR REPLACE FUNCTION mis_security.site_allowed(input text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $scope$
  SELECT CASE WHEN COALESCE(current_setting('mis.request_scope',true),'')='' THEN true
   ELSE (current_setting('mis.request_scope',true)::jsonb->>'mode'='all'
    OR COALESCE(current_setting('mis.request_scope',true)::jsonb->'sites','[]'::jsonb) ? mis_security.canonical_site(input)) END $scope$`);
 await client.query(`DROP POLICY IF EXISTS mis_log_book_site_scope ON mis_log_books`);
 await client.query(`DROP POLICY IF EXISTS mis_log_book_backend ON mis_log_books`);
 await client.query(`CREATE POLICY mis_log_book_backend ON mis_log_books AS PERMISSIVE TO "${role.name.replaceAll('"','""')}" USING(true) WITH CHECK(true)`);
 await client.query(`CREATE POLICY mis_log_book_site_scope ON mis_log_books AS RESTRICTIVE USING(mis_security.site_allowed(site)) WITH CHECK(mis_security.site_allowed(site))`);
 await client.query('ALTER TABLE mis_log_books ENABLE ROW LEVEL SECURITY');
 await client.query('ALTER TABLE mis_log_books FORCE ROW LEVEL SECURITY');
 await client.query('COMMIT');rlsReady=true;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export function rowSecurityPool(pool,{enabled=false,resolveScope}={}){
 if(!enabled)return pool;
 const nativeConnect=pool.connect.bind(pool),nativeQuery=pool.query.bind(pool);
 const settings=async()=>{
  const context=requests.getStore();if(!context)return null;
  if(!rlsReady)throw Object.assign(Error('Database security is initializing. Please retry.'),{status:503,code:'57P03'});
  const session=context.req.securitySession||context.req.session;
  if(!session||context.resolving)return JSON.stringify({mode:'sites',sites:[]});
  // Resolve once per HTTP request, using the same current master assignment as
  // the API's authorization checks. Never accept a site from request input.
  if(!context.scope)context.scope=requests.run({...context,resolving:true},()=>Promise.resolve(resolveScope(context.req)));
  const scope=await context.scope;
  return JSON.stringify({mode:scope.sites===null?'all':'sites',sites:(scope.sites||[]).map(canonicalSiteName)});
 };
 const wrap=client=>{
  let transaction=false,configured=false;
  const query=async(...args)=>{
   const text=typeof args[0]==='string'?args[0]:args[0]?.text||'';
   if(/^\s*(BEGIN|START TRANSACTION)\b/i.test(text)){const result=await client.query(...args);transaction=true;configured=false;return result;}
   if(/^\s*ROLLBACK\s+TO\b/i.test(text)){const result=await client.query(...args);configured=false;return result;}
   if(/^\s*(COMMIT|ROLLBACK|END)\b/i.test(text)){try{return await client.query(...args);}finally{transaction=false;configured=false;}}
   if(!requests.getStore())return client.query(...args);
   const scope=await settings();
   if(transaction){if(!configured){await client.query("SELECT set_config('mis.request_scope',$1,true)",[scope]);configured=true;}return client.query(...args);}
   await client.query('BEGIN');
   try{await client.query("SELECT set_config('mis.request_scope',$1,true)",[scope]);const result=await client.query(...args);await client.query('COMMIT');return result;}
   catch(error){await client.query('ROLLBACK');throw error;}
  };
  return new Proxy(client,{get(target,key){if(key==='query')return(...args)=>{const cb=typeof args.at(-1)==='function'?args.pop():null,promise=query(...args);if(cb){promise.then(value=>cb(null,value),error=>cb(error));return;}return promise;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 };
 const connect=async()=>{const req=requests.getStore()?.req;if(req?.securitySession||req?.session)await settings();return wrap(await nativeConnect());};
 const overrides=new Map();
 return new Proxy(pool,{get(target,key){
  if(overrides.has(key))return overrides.get(key);
  if(key==='connect')return callback=>{const promise=connect();if(callback){promise.then(client=>callback(null,client,client.release.bind(client)),error=>callback(error));return;}return promise;};
  if(key==='query')return(...args)=>{
   if(!requests.getStore())return nativeQuery(...args);
   const cb=typeof args.at(-1)==='function'?args.pop():null;
   const promise=(async()=>{await settings();const client=await nativeConnect();try{return await wrap(client).query(...args);}finally{client.release();}})();
   if(cb){promise.then(value=>cb(null,value),error=>cb(error));return;}return promise;
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 },set(target,key,value){if(key==='query'||key==='connect'){overrides.set(key,value);return true;}return Reflect.set(target,key,value);}});
}
