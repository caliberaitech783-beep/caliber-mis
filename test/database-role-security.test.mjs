import test from'node:test';import assert from'node:assert/strict';import{PGlite}from'@electric-sql/pglite';import{provisionMisDatabaseRole}from'../server/services/provision-database-role.mjs';
test('database provisioning refuses any database except MIS before creating roles',async t=>{
 const db=new PGlite();t.after(()=>db.close());await assert.rejects(provisionMisDatabaseRole(db,{password:'a'.repeat(64)}),/Only caliber_mis/);
 assert.equal((await db.query("SELECT rolname FROM pg_roles WHERE rolname='caliber_mis_app'")).rows.length,0);
 await assert.rejects(provisionMisDatabaseRole(db,{role:'other_db_admin',password:'a'.repeat(64)}),/Invalid MIS/);
});
