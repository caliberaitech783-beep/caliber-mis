// Tells the release-alert people on Telegram that production went live outside the release
// schedule (06:00, 09:00, 12:00, 15:00, 18:00, 21:00 and 00:00 IST). Runs at the end of a Run workflow release, after
// Pulse-II is serving the new commit. A scheduled release never sends.
//
// The numbers come from the RELEASE_ALERT_MOBILES secret and are never printed: this repository
// and its logs are public. The request is signed with a key derived from the live server's
// integration key file, read through Azure with the release's own sign-in.
import {execFileSync} from 'node:child_process';
import {integrationSignature} from '../server/services/integration-secret-store.mjs';
import {RELEASE_NOTICE_PURPOSE, releaseNoticePayload} from '../server/routes/release-notice.mjs';

const trigger = process.env.GITHUB_EVENT_NAME || '';
if (trigger === 'schedule') {
  console.log('Scheduled release: no off-schedule notice.');
  process.exit(0);
}
const mobiles = String(process.env.RELEASE_ALERT_MOBILES || '').split(/[,;\s]+/).map(value => value.replace(/\D/g, '')).filter(Boolean);
if (!mobiles.length) {
  console.log('::warning::RELEASE_ALERT_MOBILES is not set, so nobody was told about this off-schedule release.');
  process.exit(0);
}
const commit = String(process.env.RELEASE_COMMIT || '').trim();
if (!/^[0-9a-f]{40}$/.test(commit)) throw Error('The release commit is missing.');

const az = args => execFileSync('az', args, {encoding: 'utf8', timeout: 60000}).trim();
const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
const hosts = JSON.parse(az(['webapp', 'show', '-g', 'coalmine-fleet-maintenance-rg', '-n', 'caliber-mis-783', '--query', 'enabledHostNames', '-o', 'json']));
const scm = hosts.find(value => /^caliber-mis-783[a-z0-9-]*\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(value));
if (!scm) throw Error('Azure did not return the production deployment hostname.');
const keyResponse = await fetch(`https://${scm}/api/vfs/data/caliber-mis/integration.key`, {
  headers: {Authorization: 'Bearer ' + token, 'Accept-Encoding': 'identity'}, redirect: 'error', signal: AbortSignal.timeout(60000),
});
if (!keyResponse.ok) throw Error('The live integration key could not be read (HTTP ' + keyResponse.status + ').');
const key = Buffer.from(await keyResponse.arrayBuffer());
if (key.length !== 32) throw Error('The live integration key is not valid.');

const subject = (() => { try { return execFileSync('git', ['log', '-1', '--format=%s', commit], {encoding: 'utf8'}).trim(); } catch { return ''; } })();
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
const notice = {commit, subject, trigger, actor: process.env.GITHUB_ACTOR || '', runUrl, sentAt: new Date().toISOString(), mobiles};
const response = await fetch((process.env.RELEASE_NOTICE_BASE_URL || 'https://pulse-ll.cmll.in') + '/api/release-notice', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'X-Release-Signature': integrationSignature(key, RELEASE_NOTICE_PURPOSE, releaseNoticePayload(notice))},
  body: JSON.stringify(notice), redirect: 'error', signal: AbortSignal.timeout(60000),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw Error('Pulse-II refused the release notice (HTTP ' + response.status + '): ' + (result.error || ''));
console.log(`Off-schedule release notice: ${result.told} of ${mobiles.length} people told on Telegram.`);
if (result.noLogin) console.log(`::warning::${result.noLogin} release-alert number(s) match no MIS user in Users & employees.`);
if (result.noTelegram) console.log(`::warning::${result.noTelegram} release-alert person(s) have not linked Telegram in MIS (My profile > Telegram).`);
