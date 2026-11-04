import {readFileSync} from 'node:fs';

const safeUiPath = path =>
  /^src\/[^/]*(?:dashboard|report|reconciliation)[^/]*\.jsx$/.test(path)
  || /^src\/.*\.css$/.test(path)
  || path === 'shared/fleet-reconciliation-summary.mjs'
  || path === 'scripts/release-test-plan.mjs';

const safeTestPath = path =>
  /^test\/(?:dashboard|report|fleet-reconciliation|release-test-plan)[^/]*\.test\.mjs$/.test(path);

export function releaseTestPlan(files = []) {
  const changed = [...new Set(files.map(file => String(file).trim().replaceAll('\\', '/')).filter(Boolean))];
  const fast = changed.length > 0 && changed.every(path => safeUiPath(path) || safeTestPath(path));
  const focused = new Set(['test/module-layout.test.mjs', 'test/release-test-plan.test.mjs']);
  for (const path of changed) {
    // Include changed allowlisted tests instead of silently skipping them.
    if (safeTestPath(path)) focused.add(path);
    if (path.includes('fleet-reconciliation')) focused.add('test/fleet-reconciliation-summary.test.mjs');
    if (path.includes('dashboard')) focused.add('test/dashboard-readable-typography.test.mjs');
  }
  return {lane: fast ? 'fast' : 'full', tests: [...focused]};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  const files = process.argv[2] ? readFileSync(process.argv[2], 'utf8').split(/\r?\n/) : [];
  const plan = releaseTestPlan(files);
  process.stdout.write(`lane=${plan.lane}\ntests=${plan.tests.join(' ')}\n`);
}
