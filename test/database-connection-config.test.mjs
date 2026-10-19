import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {misDatabaseConfig} from '../mis-database-config.mjs';

const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

test("MIS loopback uses a dedicated database while Azure validates TLS", () => {
  assert.equal(misDatabaseConfig({DATABASE_URL:'postgresql://u:p@127.0.0.1/caliber_mis'}).ssl,false);
  assert.deepEqual(misDatabaseConfig({DATABASE_URL:'postgresql://u:p@server.postgres.database.azure.com/caliber_mis'}).ssl,{rejectUnauthorized:true});
  assert.match(server, /ssl:databaseSsl/);
});
