// Run with the existing administrator connection, only against caliber_mis.
// The role has authority inside MIS, including its startup migrations, and no
// server administration privileges. It never inherits the administrator role.
export async function provisionMisDatabaseRole(client,{password,role='caliber_mis_app'}={}){
 if(role!=='caliber_mis_app'||typeof password!=='string'||!/^[A-Za-z0-9_-]{40,120}$/.test(password))throw Error('Invalid MIS role provisioning request.');
 const current=(await client.query('SELECT current_database() AS database,current_user AS role')).rows[0];
 if(current.database!=='caliber_mis')throw Error('Database isolation check failed. Only caliber_mis may be modified.');
 if((await client.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[role])).rows.length)throw Error('MIS role already exists. Reuse its Key Vault credential instead of resetting it.');
 await client.query('BEGIN');
 try{
  await client.query("SET LOCAL lock_timeout='5s'");await client.query('SELECT pg_advisory_xact_lock(709224199)');
  const sql=(await client.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', $1::text,$2::text) AS sql",[role,password])).rows[0].sql;
  await client.query(sql);
  await client.query(`GRANT caliber_mis_app TO ${'"'+current.role.replaceAll('"','""')+'"'}`);
  await client.query('GRANT USAGE,CREATE ON SCHEMA public TO caliber_mis_app');
  // Enumerate only application objects in this database, excluding extension
  // members. Do not use REASSIGN OWNED: that can also affect shared objects.
  const inventory=(await client.query(`SELECT 'relation' AS kind,n.nspname AS schema,c.relname AS name,pg_get_userbyid(c.relowner) AS owner
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','S','v','m','f')
   AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype='e')
   UNION ALL SELECT 'routine',n.nspname,p.proname,pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')`)).rows;
  await client.query(`DO $mis_owner$ DECLARE r record; BEGIN
   FOR r IN SELECT c.relkind,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN('r','p','S','v','m','f')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype='e')
    ORDER BY CASE WHEN c.relkind='S' THEN 1 ELSE 0 END LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO caliber_mis_app',CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,r.nspname,r.relname);
   END LOOP;
   FOR r IN SELECT p.oid,p.prokind,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e') LOOP
    EXECUTE format('ALTER %s %I.%I(%s) OWNER TO caliber_mis_app',CASE r.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END,r.nspname,r.proname,r.args);
   END LOOP;
   FOR r IN SELECT t.oid,t.typtype,n.nspname,t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN('e','d')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=t.oid AND d.classid='pg_type'::regclass AND d.deptype='e') LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO caliber_mis_app',CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END,r.nspname,r.typname);
   END LOOP;
  END $mis_owner$`);
  await client.query('GRANT CONNECT,TEMPORARY ON DATABASE caliber_mis TO caliber_mis_app');
  await client.query('ALTER DATABASE caliber_mis OWNER TO caliber_mis_app');
  await client.query('COMMIT');return {database:current.database,role,previousAdministrator:current.role,inventory};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
