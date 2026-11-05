import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const ci=read('.github/workflows/ci.yml');
const layout=ci.slice(ci.indexOf('  logbook-layout:'));

test('PR and manual layout checks reuse a successful validated build',()=>{
  assert.match(ci,/Share the validated UI build[\s\S]*uses: actions\/upload-artifact@v4[\s\S]*name: validated-ui\n\s+path: dist\/\n\s+retention-days: 1/);
  assert.match(layout,/needs: build/);
  assert.match(layout,/if: always\(\) && \(github.event_name == 'push' \|\| needs.build.result == 'success'\)/);
  assert.match(layout,/Reuse the validated UI[^\n]*\n\s+if: github.event_name != 'push'\n\s+uses: actions\/download-artifact@v4\n\s+with:\n\s+name: validated-ui\n\s+path: dist\//);
});

test('main pushes still build and run every existing browser check when validation is skipped',()=>{
  assert.match(ci,/build:\n\s+# [^\n]*\n\s+if: github.event_name != 'push'/);
  assert.match(layout,/Build UI for main-push[^\n]*\n\s+if: github.event_name == 'push'\n\s+run: npm run build/);
  for(const script of ['verify-logbook-layout.mjs','verify-batch-entry-handoff.mjs','verify-account-security-browser.mjs']) assert.ok(layout.includes(`node scripts/${script}`),script);
  assert.match(layout,/mis-layout-dependencies-v1-/);
  assert.match(layout,/security-checks\//);
});

test('production retains existing UI delta, full validation, rollback and production environment',()=>{
  const workflow=read('.github/workflows/main_caliber-mis-783.yml');
  assert.match(workflow,/environment:\n\s+name: production/);
  assert.match(workflow,/branches: \[main\]/);
  for(const text of ['node scripts/deploy-ui-delta.mjs','node scripts/release-test-plan.mjs','Preserve UI rollback evidence','npm test -- --test-concurrency=4','node scripts/verify-server-start.mjs','node scripts/verify-ui-release.mjs --live']) assert.ok(workflow.includes(text),text);
  for(const file of ['scripts/classify-ui-release.mjs','scripts/release-model-cache.mjs','scripts/test-release-ui.mjs','.github/actions/check-logbook-layout/action.yml']) assert.equal(existsSync(new URL(`../${file}`,import.meta.url)),false,file);
});
