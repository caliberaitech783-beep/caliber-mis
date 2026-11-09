import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

test("equipment details use live request-based road status", () => {
  const equipmentSource = source.slice(source.indexOf("function Equipment({"), source.indexOf("function EquipmentForm"));

  assert.match(equipmentSource, /const roadStatusFor = \(record\) => Array\.isArray\(statusRequests\)/);
  assert.match(equipmentSource, /roadStatusFor\(v\) === road/);
  assert.match(equipmentSource, /!location \|\| recordBelongsToSite\(v, location\)/);
  assert.match(source, /<Equipment[\s\S]*statusRequests=\{requests\}/);
});
