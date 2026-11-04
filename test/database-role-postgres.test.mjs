import test from'node:test';import assert from'node:assert/strict';import {mkdtemp}from'node:fs/promises';import path from'node:path';import os from'node:os';import net from'node:net';import{randomBytes}from'node:crypto';import pg from'pg';import EmbeddedPostgres from'embedded-postgres';import{provisionMisDatabaseRole}from'../server/services/provision-database-role.mjs';
test('restricted MIS role owns only MIS objects and cannot read a separate application database',async t=>{
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const dir=await mkdtemp(path.join(os.tmpdir(),'mis-role-check-')),adminPassword=randomBytes(32).toString('hex'),password=randomBytes(48).toString('base64url');
 // Retain this isolated test directory; stopping the cluster never performs a
 // recursive deletion. It contains generated fixture credentials, no user data.
 const cluster=new EmbeddedPostgres({databaseDir:path.join(dir,'db'),user:'postgres',password:adminPassword,port,persistent:true,authMethod:'scram-sha-256',onLog(){},onError(){}});
 await cluster.initialise();await cluster.start();const clients=[];t.after(async()=>{for(const client of clients)await client.end();await cluster.stop();});const root=cluster.getPgClient();await root.connect();clients.push(root);
 await root.query(`CREATE ROLE mis_migration_admin LOGIN CREATEDB CREATEROLE BYPASSRLS PASSWORD '${adminPassword}'`);
 await root.query('CREATE DATABASE caliber_mis OWNER mis_migration_admin');await root.query('CREATE DATABASE pulse_fixture');
 const other=cluster.getPgClient('pulse_fixture');await other.connect();await other.query('CREATE TABLE private_records(id INT); INSERT INTO private_records VALUES(1)');await other.end();
 const admin=new pg.Client({host:'127.0.0.1',port,user:'mis_migration_admin',password:adminPassword,database:'caliber_mis'});await admin.connect();clients.push(admin);
 await admin.query("CREATE TABLE example(id BIGSERIAL PRIMARY KEY,label TEXT);INSERT INTO example(label) VALUES('fixture');CREATE VIEW example_view AS SELECT * FROM example;CREATE FUNCTION example_count() RETURNS BIGINT LANGUAGE SQL AS 'SELECT count(*) FROM example'");
 const result=await provisionMisDatabaseRole(admin,{password});assert.equal(result.role,'caliber_mis_app');assert.ok(result.inventory.length>=4);
 const app=new pg.Client({host:'127.0.0.1',port,user:'caliber_mis_app',password,database:'caliber_mis'});await app.connect();clients.push(app);
 const flags=(await app.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(flags,{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false});
 assert.equal((await app.query('SELECT * FROM example')).rowCount,1);await app.query("INSERT INTO example(label) VALUES('new fixture')");assert.equal(Number((await app.query('SELECT example_count() AS count')).rows[0].count),2);
 await app.query('BEGIN;CREATE TABLE migration_probe(id INT);DROP TABLE migration_probe;ROLLBACK');
 await assert.rejects(app.query('CREATE ROLE forbidden_admin'),error=>error.code==='42501');
 const forbidden=new pg.Client({host:'127.0.0.1',port,user:'caliber_mis_app',password,database:'pulse_fixture'});await forbidden.connect();try{await assert.rejects(forbidden.query('SELECT * FROM private_records'),error=>error.code==='42501');}finally{await forbidden.end();}
});
