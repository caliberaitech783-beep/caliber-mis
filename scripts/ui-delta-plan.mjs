import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseTestPlan} from './release-test-plan.mjs';

// A delta can only replace existing client files. Server/shared modules, public
// files, additions, renames and deletions always use the complete release path.
export function uiDeltaPlan(changes, {baseline, current, healthy = false} = {}) {
 const valid = value => /^[0-9a-f]{40}$/.test(value || '');
 const files = changes.map(change => change.path);
 const safe = file => /^src\/[A-Za-z0-9_/-]+\.(?:css|jsx)$/.test(file);
 const controllers = new Set(['scripts/deploy-ui-delta.mjs','scripts/ui-delta-plan.mjs','test/ui-delta-deployment.test.mjs']);
 const hasController = files.some(file => controllers.has(file) && file.startsWith('scripts/'));
 const applicationFiles = files.filter(file => !controllers.has(file));
 const controllerOnlyOrSafeUi = applicationFiles.length === 0 || releaseTestPlan(applicationFiles).lane === 'fast';
 const ui = files.filter(file => file.startsWith('src/') || (file.startsWith('scripts/') && controllers.has(file)));
 const plan = releaseTestPlan(files);
 return {
  eligible: healthy && valid(baseline) && valid(current) && baseline !== current
   // Controller patches still select the full test suite in the workflow. They
   // do not change the server runtime, so resending its dependencies is needless.
   && (plan.lane === 'fast' || (hasController && controllerOnlyOrSafeUi)) && ui.length > 0
   && changes.every(change => change.status === 'M')
   && ui.every(file => safe(file) || controllers.has(file)) && files.every(file => safe(file) || controllers.has(file) || /^test\/[A-Za-z0-9_-]+\.test\.mjs$/.test(file)),
  files: ui, baseline, current, tests: plan.tests
 };
}

export function gitUiDeltaPlan(baseline, current, {healthy = false, cwd = process.cwd()} = {}) {
 try {
  if (![baseline, current].every(value => /^[0-9a-f]{40}$/.test(value || ''))) return {eligible:false};
  execFileSync('git', ['merge-base', '--is-ancestor', baseline, current], {cwd, stdio:'pipe'});
  const entries = execFileSync('git', ['diff', '--no-renames', '--name-status', '-z', baseline, current], {cwd, encoding:'utf8'}).split('\0').filter(Boolean);
  const changes = [];
  for (let i=0; i<entries.length; i+=2) changes.push({status:entries[i], path:entries[i+1] || ''});
  return uiDeltaPlan(changes, {baseline, current, healthy});
 } catch { return {eligible:false}; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 let health;
 try { health = JSON.parse(readFileSync(process.argv[2], 'utf8')); } catch {}
 const current = process.env.RELEASE_COMMIT;
 const baseline = health?.commit;
 const healthy = health?.status === 'ok' && health?.database === 'connected' && health?.scheduledJobsEnabled === false;
 const plan = gitUiDeltaPlan(baseline, current, {healthy});
 console.log(`delta=${plan.eligible === true}\nbaseline=${plan.eligible ? baseline : ''}`);
}
