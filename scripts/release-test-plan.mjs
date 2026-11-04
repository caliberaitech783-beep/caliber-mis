import {readFileSync} from 'node:fs';

const safeUiPath = path =>
  /^src\/[^/]*(?:dashboard|report|reconciliation)[^/]*\.jsx$/.test(path)
  || /^src\/.*\.css$/.test(path)
  || path === 'shared/fleet-reconciliation-summary.mjs';

const safeTestPath = path =>
  /^test\/(?:dashboard|report|fleet-reconciliation|frontend-module-boundary)[^/]*\.test\.mjs$/.test(path);

export function releaseTestPlan(files = []) {
  const changed = [...new Set(files.map(file => String(file).trim().replaceAll('\\', '/')).filter(Boolean))];
  const fast = changed.length > 0 && changed.every(path => safeUiPath(path) || safeTestPath(path));
  const focused = new Set(['test/frontend-module-boundary.test.mjs']);
  for (const path of changed) {
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
