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
// Every query from an HTTP request runs with that request's site scope set on
// its connection (mis.request_scope), which the mis_log_books policy reads.
//
// Until 14 November 2026 the scope was set transaction-locally, so each pooled
// query cost four round trips to the database server (BEGIN, set_config, the
// query, COMMIT) while holding one of the ten pool connections; on scanning
// days that alone kept the pool full. The scope is now set at session level and
// remembered per connection: a query sends only itself while the connection
// already carries the scope it needs. A query from no request (a background
// job, a backup) sets the trusted empty scope first, so a scope never leaks from
// one caller to the next. A ROLLBACK undoes a session-level set_config made in
// that transaction, so after any rollback (or a failed COMMIT, or a failed
// statement) the connection's scope is treated as unknown and set again.
const TRUSTED_SCOPE='';
export function rowSecurityPool(pool,{enabled=false,resolveScope}={}){
 if(!enabled)return pool;
 const nativeConnect=pool.connect.bind(pool);
 const scopeFor=async()=>{
  const context=requests.getStore();if(!context)return TRUSTED_SCOPE;
  if(!rlsReady)throw Object.assign(Error('Database security is initializing. Please retry.'),{status:503,code:'57P03'});
  const session=context.req.securitySession||context.req.session;
  if(!session||context.resolving)return JSON.stringify({mode:'sites',sites:[]});
  // Resolve once per HTTP request, using the same current master assignment as
  // the API's authorization checks. Never accept a site from request input.
  if(!context.scope)context.scope=requests.run({...context,resolving:true},()=>Promise.resolve(resolveScope(context.req)));
  const scope=await context.scope;
  return JSON.stringify({mode:scope.sites===null?'all':'sites',sites:(scope.sites||[]).map(canonicalSiteName)});
 };
 // The scope each native connection is known to carry; absent means unknown.
 const known=new WeakMap();
 const ensureScope=async(client,scope)=>{
  if(known.get(client)===scope)return;
  known.delete(client);
  await client.query("SELECT set_config('mis.request_scope',$1,false)",[scope]);
  known.set(client,scope);
 };
 const wrap=client=>{
  const query=async(...args)=>{
   const text=typeof args[0]==='string'?args[0]:args[0]?.text||'';
   if(/^\s*(BEGIN|START TRANSACTION)\b/i.test(text))return client.query(...args);
   if(/^\s*ROLLBACK\b/i.test(text)){try{return await client.query(...args);}finally{known.delete(client);}}
   if(/^\s*(COMMIT|END)\b/i.test(text)){try{return await client.query(...args);}catch(error){known.delete(client);throw error;}}
   const scope=await scopeFor();
   try{await ensureScope(client,scope);return await client.query(...args);}
   catch(error){known.delete(client);throw error;}
  };
  return new Proxy(client,{get(target,key){if(key==='query')return(...args)=>{const cb=typeof args.at(-1)==='function'?args.pop():null,promise=query(...args);if(cb){promise.then(value=>cb(null,value),error=>cb(error));return;}return promise;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 };
 // The scope is resolved before a connection is taken, so a slow master lookup
 // never holds one of the pool's connections.
 const connect=async()=>{if(requests.getStore())await scopeFor();return wrap(await nativeConnect());};
 const overrides=new Map();
 return new Proxy(pool,{get(target,key){
  if(overrides.has(key))return overrides.get(key);
  if(key==='connect')return callback=>{const promise=connect();if(callback){promise.then(client=>callback(null,client,client.release.bind(client)),error=>callback(error));return;}return promise;};
  if(key==='query')return(...args)=>{
   const cb=typeof args.at(-1)==='function'?args.pop():null;
   const promise=(async()=>{const client=await connect();try{return await client.query(...args);}finally{client.release();}})();
   if(cb){promise.then(value=>cb(null,value),error=>cb(error));return;}return promise;
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 },set(target,key,value){if(key==='query'||key==='connect'){overrides.set(key,value);return true;}return Reflect.set(target,key,value);}});
}
