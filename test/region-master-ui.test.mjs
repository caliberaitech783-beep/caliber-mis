import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Region / Site Master opens directly in the searchable master table", () => {
  const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const region = source.slice(source.indexOf("function RegionSiteMaster"), source.indexOf("function InfoPulseTimelineModal"));
  assert.match(source, /<RegionSiteMaster \/>/);
  assert.match(region, /useMasterRecords\("Region master"\)/);
  assert.match(region, /<MasterPage name="Region master" records=/);
  assert.match(region, /displaySiteSelection\(record.sites\)/);
  assert.match(region, /pulse.cmll.in/);
  assert.doesNotMatch(region, /onAdd|onEdit|onDelete/);
});
