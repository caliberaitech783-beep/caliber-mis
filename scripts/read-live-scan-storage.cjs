// Read-only verification through the existing authenticated Azure SCM connection.
// Supply TASK_AZ_TOKEN and TASK_AZ_SITE in the invoking process; neither is logged.
const fs=require('fs'),path=require('path'),z=require('zlib');
const files={},maps={};
function add(file){
 if(files[file])return;files[file]=fs.readFileSync(file,'utf8');maps[file]={};if(file.endsWith('.json'))return;
 for(const match of files[file].matchAll(/require\(['"]([^'"]+)['"]\)/g))try{const resolved=require.resolve(match[1],{paths:[path.dirname(file)]});if(path.isAbsolute(resolved)){maps[file][match[1]]=resolved;add(resolved)}}catch{}
}
const entry=require.resolve('pg');add(entry);
const payload=z.gzipSync(Buffer.from(JSON.stringify({files,maps,entry}))).toString('base64');
const queries=[
 "SELECT count(*) AS cards,COALESCE(sum(octet_length(image)),0)::text AS image_bytes,md5(string_agg(id::text||':'||image_hash||':'||COALESCE(logbook_id::text,''),',' ORDER BY id)) AS identity_digest FROM mis_scan_cards",
 "SELECT count(*) AS logbooks,md5(string_agg(md5(row_to_json(l)::text),',' ORDER BY id)) AS saved_logbook_digest FROM mis_log_books l",
 "SELECT column_name FROM information_schema.columns WHERE table_name='mis_scan_cards' AND column_name IN ('image_blob_key','image_bytes','blob_uploaded_at') ORDER BY column_name",
 "SELECT to_regclass('mis_scan_backups') AS backup_table"
];
const remote=`const b=JSON.parse(require('zlib').gunzipSync(Buffer.from('${payload}','base64')));const cache={};function load(f){if(cache[f])return cache[f].exports;const m={exports:{}};cache[f]=m;if(f.endsWith('.json')){m.exports=JSON.parse(b.files[f]);return m.exports;}const r=n=>b.maps[f][n]?load(b.maps[f][n]):require(n);new Function('require','module','exports','__filename','__dirname',b.files[f])(r,m,m.exports,f,require('path').dirname(f));return m.exports;}const {Client}=load(b.entry);(async()=>{const u=new URL(process.env.DATABASE_URL);u.pathname='/caliber_mis';for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])u.searchParams.delete(key);const db=new Client({connectionString:u.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});try{await db.connect();await db.query('BEGIN READ ONLY');await db.query("SET LOCAL statement_timeout='30000'");for(const sql of ${JSON.stringify(queries)})console.log(JSON.stringify((await db.query(sql)).rows));await db.query('ROLLBACK');}catch(e){console.log(JSON.stringify({error:e.message}));}finally{await db.end();}})();`;
(async()=>{
 const host=JSON.parse(process.env.TASK_AZ_SITE).enabledHostNames.find(h=>h.includes('.scm.'));
 const command='node -e "eval(require(\'zlib\').gunzipSync(Buffer.from(\''+z.gzipSync(Buffer.from(remote)).toString('base64')+'\',\'base64\')).toString())"';
 const response=await fetch('https://'+host+'/api/command',{method:'POST',headers:{Authorization:'Bearer '+process.env.TASK_AZ_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({command,dir:'/home/site/wwwroot'}),signal:AbortSignal.timeout(55000)});
 const result=await response.json();console.log(result.Output||'No audit output.');if(result.ExitCode)throw Error('Read-only audit failed.');
})().catch(error=>{console.error(error.message);process.exitCode=1});
