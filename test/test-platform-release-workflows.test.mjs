import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The release path since the test platform (docs/test-platform-setup.md):
// main -> test platform automatically; production only from a release tag or a
// manual run, approved in the GitHub "production" environment. The yaml package
// is not a dependency, so the workflow files are checked at source level.
const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const testWorkflow=read('../.github/workflows/main_caliber-mis-test.yml');
const productionWorkflow=read('../.github/workflows/main_caliber-mis-783.yml');
const validation=read('../.github/workflows/ci.yml');
const uiReleaseScript=read('../scripts/verify-ui-release.mjs');
const geminiScript=read('../scripts/configure-gemini-azure.py');

// Lines of one top-level YAML key: everything indented (or blank) after `key:`.
const topLevel=(text,key)=>{
  const lines=text.split('\n');
  const start=lines.findIndex(line=>line===`${key}:`||line.startsWith(`${key}: `));
  if(start<0)return '';
  const block=[];
  for(const line of lines.slice(start+1)){if(line.trim()!==''&&!/^[ \t]/.test(line))break;block.push(line);}
  return block.join('\n');
};
// One step of the single job, from its `- name:` to the next step.
const step=(text,name)=>{
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=new RegExp(`- name: '?${escaped}'?[\\s\\S]*?(?=\\n {6}- (?:name|uses):|\\n*$)`).exec(text);
  assert.ok(match,`step "${name}" exists`);
  return match[0];
};
const deployStep=text=>{const match=/- name: '?Deploy to [^\n]*[\s\S]*?uses: azure\/webapps-deploy@v3[\s\S]*?(?=\n {6}- name:)/.exec(text);assert.ok(match,'deploy step exists');return match[0];};
const verificationSteps=['npm run ocr:prepare','npm run build','npm test','node --check server.mjs','node scripts/verify-server-start.mjs','node scripts/verify-ui-release.mjs\n','node scripts/verify-ui-release.mjs --live',"await import('./local-card-ocr.mjs')","loadHandwritingModel","h.commit!==process.env.EXPECTED_COMMIT",'printf \'%s\\n\'','> DEPLOYMENT_SHA'];

test('a merge to main releases the test platform, never production',()=>{
  const triggers=topLevel(testWorkflow,'on');
  assert.match(triggers,/push:\n\s+branches: \[main\]/);
  assert.match(triggers,/paths-ignore:\n\s+- 'docs\/\*\*'\n\s+- '\*\.md'/,'documentation-only merges still skip the release');
  assert.match(triggers,/^\s+workflow_dispatch:/m);
  assert.doesNotMatch(triggers,/tags:/);

  const deploy=deployStep(testWorkflow);
  assert.match(deploy,/app-name: \$\{\{ env\.TEST_WEBAPP_NAME \}\}/);
  assert.match(deploy,/package: \.\s*$/m,'the complete validated workspace is deployed, as production receives it');
  assert.match(testWorkflow,/TEST_WEBAPP_NAME: \$\{\{ vars\.PULSE_TEST_WEBAPP_NAME \|\| 'caliber-mis-test-783' \}\}/);
  assert.match(testWorkflow,/TEST_RESOURCE_GROUP: \$\{\{ vars\.PULSE_TEST_RESOURCE_GROUP \|\| 'caliber-mis-test-rg' \}\}/);
  assert.match(testWorkflow,/TEST_PUBLIC_URL: \$\{\{ vars\.PULSE_TEST_URL \}\}/);
  assert.doesNotMatch(testWorkflow,/app-name:\s*'?caliber-mis-783/);
  assert.doesNotMatch(testWorkflow,/https:\/\/pulse-ll\.cmll\.in/,'the live address is never contacted');
  assert.doesNotMatch(testWorkflow,/slot-name/);

  const guard=step(testWorkflow,'Refuse to touch the production app');
  assert.match(guard,/''\|caliber-mis-783\)/);
  assert.match(guard,/\*pulse-ll\.cmll\.in\*\|\*pulseii\.cmll\.in\*\|\*caliber-mis-783\*\)/);
  const address=step(testWorkflow,'Resolve the test platform address');
  assert.match(address,/steps\.deploy-to-webapp\.outputs\.webapp-url/);
  assert.match(address,/\*pulse-ll\.cmll\.in\*\|\*pulseii\.cmll\.in\*\|\*caliber-mis-783\*\)/);
  assert.match(address,/https:\/\/\[A-Za-z0-9\]\*\) ;;/);
});

test('the test platform uses its own identity, environment, concurrency group and optional Gemini key',()=>{
  for(const secret of ['AZURE_TEST_CLIENT_ID','AZURE_TEST_TENANT_ID','AZURE_TEST_SUBSCRIPTION_ID'])assert.match(testWorkflow,new RegExp(`secrets\\.${secret}`));
  assert.doesNotMatch(testWorkflow,/AZUREAPPSERVICE_/,'the production deployment identity is not used');
  assert.doesNotMatch(testWorkflow,/secrets\.MIS_GEMINI_API_KEY/,'the production Gemini key is not copied');

  assert.match(testWorkflow,/environment:\n\s+name: test\n\s+url: \$\{\{ steps\.test-address\.outputs\.url \}\}/);
  assert.doesNotMatch(testWorkflow,/name: production/);
  assert.match(topLevel(testWorkflow,'concurrency'),/group: caliber-mis-test-release\n\s+cancel-in-progress: false/);
  assert.match(testWorkflow,/id-token: write/);

  const gemini=step(testWorkflow,'Configure Gemini extraction on the test app (only with a test key)');
  assert.match(gemini,/if: env\.TEST_GEMINI_CONFIGURED == 'true'/);
  assert.match(gemini,/GEMINI_API_KEY: \$\{\{ secrets\.MIS_TEST_GEMINI_API_KEY \}\}/);
  assert.match(gemini,/AZURE_WEBAPP_NAME: \$\{\{ env\.TEST_WEBAPP_NAME \}\}/);
  assert.match(gemini,/AZURE_RESOURCE_GROUP: \$\{\{ env\.TEST_RESOURCE_GROUP \}\}/);
  assert.match(testWorkflow,/TEST_GEMINI_CONFIGURED: \$\{\{ secrets\.MIS_TEST_GEMINI_API_KEY != '' \}\}/);
});

test('the test release keeps every verification step and checks the test address for the commit with scheduled jobs off',()=>{
  for(const fragment of verificationSteps)assert.ok(testWorkflow.includes(fragment),fragment);
  assert.match(testWorkflow,/EXPECTED_COMMIT="\$GITHUB_SHA" node scripts\/verify-ui-release\.mjs/);
  const health=step(testWorkflow,'Verify test platform release health');
  assert.match(health,/EXPECTED_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(health,/RELEASE_CHECK_BASE_URL: \$\{\{ steps\.test-address\.outputs\.url \}\}/);
  assert.match(health,/"\$\{RELEASE_CHECK_BASE_URL\}\/api\/health\?test-release=\$\{EXPECTED_COMMIT\}"/);
  assert.match(health,/h\.scheduledJobsEnabled!==false/,'a test copy must never run scheduled jobs or notifications');
  assert.match(health,/for attempt in \{1\.\.30\}/);
  assert.match(uiReleaseScript,/process\.env\.RELEASE_CHECK_BASE_URL\|\|'https:\/\/pulse-ll\.cmll\.in'/);
  assert.match(uiReleaseScript,/verifyPublishedUiRelease\(\{base,expected:process\.env\.EXPECTED_COMMIT\}\)/);
});

test('production releases only from a release tag or a manual run, gated by the production environment',()=>{
  const triggers=topLevel(productionWorkflow,'on');
  assert.match(triggers,/push:\n\s+tags:\n\s+- 'release-\*'/);
  assert.match(triggers,/^\s+workflow_dispatch:/m);
  assert.match(triggers,/reason:[\s\S]*required: true/);
  assert.doesNotMatch(triggers,/branches/,'a push to main no longer releases production');
  assert.doesNotMatch(triggers,/paths-ignore/,'tags carry no path filter; the test workflow keeps the documentation filter');

  assert.match(productionWorkflow,/environment:\n\s+name: production\n\s+url: https:\/\/pulse-ll\.cmll\.in/);
  assert.match(topLevel(productionWorkflow,'concurrency'),/group: caliber-mis-783-release\n\s+cancel-in-progress: false/);
  assert.notEqual(/group: ([^\n]+)/.exec(topLevel(productionWorkflow,'concurrency'))[1],/group: ([^\n]+)/.exec(topLevel(testWorkflow,'concurrency'))[1]);

  const reviewer=step(productionWorkflow,'Confirm the production environment still requires a reviewer');
  assert.match(reviewer,/gh api "repos\/\$\{GITHUB_REPOSITORY\}\/environments\/production"/);
  assert.match(reviewer,/select\(\.type == "required_reviewers"\)/);
  assert.match(reviewer,/exit 1/);
  const commit=step(productionWorkflow,'Resolve the release commit and confirm it is on main');
  assert.match(commit,/git rev-parse 'HEAD\^\{commit\}'/);
  assert.match(commit,/compare\/main\.\.\.\$\{RELEASE_COMMIT\}/);
  assert.match(commit,/identical\|behind\) ;;/);
  assert.match(commit,/RELEASE_COMMIT=\$\{RELEASE_COMMIT\}" >> "\$GITHUB_ENV"/);
  assert.match(commit,/RELEASE_REASON: \$\{\{ inputs\.reason \}\}/);
  const stepOrder=['Confirm the production environment still requires a reviewer','Resolve the release commit and confirm it is on main','Set up Node.js and npm download cache','Deploy to Azure Web App'].map(name=>productionWorkflow.indexOf(name));
  assert.deepEqual([...stepOrder].sort((a,b)=>a-b),stepOrder,'both gates run before anything is built or deployed');
});

test('the production release keeps its identity, app, verification steps and live health check',()=>{
  for(const secret of ['AZUREAPPSERVICE_CLIENTID_248B6AEDDDF04A74B67402B5BD0DC3EB','AZUREAPPSERVICE_TENANTID_6B5963E6143745DD89CD80664168F76E','AZUREAPPSERVICE_SUBSCRIPTIONID_6D6C9CBBB0A24F138D5B5B2F35480688','MIS_GEMINI_API_KEY'])assert.match(productionWorkflow,new RegExp(`secrets\\.${secret}`));
  assert.doesNotMatch(productionWorkflow,/secrets\.(?:AZURE_TEST_|MIS_TEST_GEMINI_API_KEY)|vars\.PULSE_TEST_/,'the test identity and test settings never reach production');
  const deploy=deployStep(productionWorkflow);
  assert.match(deploy,/app-name: 'caliber-mis-783'/);
  assert.doesNotMatch(deploy,/caliber-mis-test/);
  assert.match(deploy,/package: \.\s*$/m);
  for(const fragment of verificationSteps)assert.ok(productionWorkflow.includes(fragment),fragment);
  assert.match(productionWorkflow,/APP_VERSION_SOURCE: \$\{\{ env\.RELEASE_COMMIT \}\}/,'the UI version is the released commit even for an annotated tag');
  assert.match(productionWorkflow,/EXPECTED_COMMIT="\$RELEASE_COMMIT" node scripts\/verify-ui-release\.mjs/);
  assert.match(productionWorkflow,/printf '%s\\n' "\$RELEASE_COMMIT" > DEPLOYMENT_SHA/);
  const health=step(productionWorkflow,'Verify Pulse-II release health');
  assert.match(health,/EXPECTED_COMMIT: \$\{\{ env\.RELEASE_COMMIT \}\}/);
  assert.match(health,/RELEASE_CHECK_BASE_URL: https:\/\/pulse-ll\.cmll\.in/);
  assert.match(health,/https:\/\/pulse-ll\.cmll\.in\/api\/health\?gemini-release=\$\{EXPECTED_COMMIT\}/);
  assert.match(health,/node scripts\/verify-ui-release\.mjs --live/);
  assert.match(productionWorkflow,/id-token: write/);
});

test('the Gemini configuration script targets production by default and the test app only when told',()=>{
  assert.match(geminiScript,/DEFAULT_WEBAPP_NAME = 'caliber-mis-783'/);
  assert.match(geminiScript,/DEFAULT_RESOURCE_GROUP = 'coalmine-fleet-maintenance-rg'/);
  assert.match(geminiScript,/env\.get\('AZURE_WEBAPP_NAME', ''\)\.strip\(\) or DEFAULT_WEBAPP_NAME/);
  assert.match(geminiScript,/env\.get\('AZURE_RESOURCE_GROUP', ''\)\.strip\(\) or DEFAULT_RESOURCE_GROUP/);
  assert.match(geminiScript,/re\.fullmatch\(r'\[A-Za-z0-9-\]\{2,60\}', site\)/);
});

test('the branch protection checks on main still come from the validation workflow on pull requests',()=>{
  const triggers=topLevel(validation,'on');
  assert.match(triggers,/^\s+pull_request:/m);
  const jobs=topLevel(validation,'jobs');
  assert.match(jobs,/^  build:/m);
  assert.match(jobs,/^  logbook-layout:/m);
  assert.doesNotMatch(validation,/webapps-deploy/,'validation never deploys');
});
