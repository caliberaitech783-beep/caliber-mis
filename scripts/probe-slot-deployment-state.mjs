// Read-only look at why a slot refuses a new release with "There is a deployment currently in progress" (HTTP 409),
// as the staging slot did for almost every release from 12 Nov 2026 22:35 UTC. It changes nothing on either slot.
//
// Two earlier runs (13 Nov 2026) settled this much: both slots answer quickly, no deployment lock file is held, the
// drive's own "500G used of 500G" is a nominal figure that says nothing, the live slot's app folder holds 54 GB
// against 2.4 GB on staging, and the one deployment the staging slot accepted (a46a6c34) failed on the slot.
// This version reads what was still missing:
//   - the storage Azure itself counts against the plan and each slot, with the limit;
//   - the raw log file of the deployment that failed (Kudu's own log route answered HTTP 500);
//   - the error lines of the newest upload request in Kudu's trace, and of the deployment container's log;
//   - what fills the app folder, the log folder and the data folder (largest files and entries).
// The build log is public: process names only, no command lines; lines are cut short and anything that looks like
// a key or token is masked.
import {execFileSync} from 'node:child_process';

const group = 'coalmine-fleet-maintenance-rg';
// PROBE_APP reads another web app of the same resource group instead, one without a staging slot:
// the scan engine app, whose uploads were refused with HTTP 409 on 13 Nov 2026.
const otherApp = /^[a-z0-9-]{3,60}$/.test(process.env.PROBE_APP || '') ? process.env.PROBE_APP : '';
const app = otherApp || 'caliber-mis-783';
const slots = otherApp ? ['production'] : ['production', 'staging'];
const slot = process.env.MIS_STAGING_SLOT || 'staging';
const az = args => execFileSync('az', args, {encoding: 'utf8', timeout: 60000}).trim();
const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
const slotArgs = name => name === 'staging' ? ['--slot', slot] : [];
function scm(name) {
  const hosts = JSON.parse(az(['webapp', 'show', '-g', group, '-n', app, ...slotArgs(name), '--query', 'enabledHostNames', '-o', 'json']));
  const host = hosts.find(value => value.startsWith(app) && /^[a-z0-9-]+\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(value));
  if (!host) throw Error('Azure did not return a recognized deployment hostname.');
  return 'https://' + host;
}

const headers = {Authorization: 'Bearer ' + token, 'Accept-Encoding': 'identity'};
const seconds = started => ((Date.now() - started) / 1000).toFixed(1) + ' s';
// One line, cut short, with anything that looks like a key or token masked: the build log is public.
const clean = (value, length) => String(value ?? '').replace(/\s+/g, ' ').replace(/[A-Za-z0-9+/=_-]{40,}/g, '<long value>').slice(0, length);
const mask = '| sed -E "s#[A-Za-z0-9+/=_-]{40,}#<long value>#g"';
async function get(host, route, timeout = 20000) {
  const started = Date.now();
  const response = await fetch(host + route, {headers, redirect: 'error', signal: AbortSignal.timeout(timeout)});
  return {status: response.status, text: await response.text(), took: seconds(started)};
}
// Azure's own management API, for figures the slot cannot give about itself.
async function arm(path) {
  const response = await fetch('https://management.azure.com' + path + '?api-version=2023-12-01', {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error('HTTP ' + response.status + ' ' + clean(await response.text(), 160));
  return response.json();
}
// Runs a read-only shell line in the slot's deployment container. What it printed before a time limit is kept.
async function shell(host, line, timeout = 45000) {
  const code = `const r=require('node:child_process').spawnSync('sh',['-c',${JSON.stringify(line)}],{encoding:'utf8',timeout:38000});console.log((r.stdout||'')+(r.stderr?'\\nstderr: '+r.stderr.slice(0,400):'')+(r.error?'\\nstopped: '+r.error.message:''))`;
  const started = Date.now();
  const response = await fetch(host + '/api/command', {
    method: 'POST',
    headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({command: `node -e "eval(Buffer.from('${Buffer.from(code).toString('base64')}','base64').toString())"`, dir: '/home'}),
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let output = text;
  try { const parsed = JSON.parse(text); output = (parsed.Output || '') + (parsed.Error ? '\nstderr: ' + parsed.Error : '') + '\nexit code: ' + parsed.ExitCode; } catch {}
  return `HTTP ${response.status}, ${seconds(started)}\n${output.trim()}`;
}
async function attempt(title, work) {
  console.log('\n--- ' + title);
  try { console.log(await work()); } catch (error) { console.log('could not be read: ' + (error?.name || 'Error') + ': ' + String(error?.message).slice(0, 200)); }
}
const usageLines = usages => (usages.value || []).map(u => {
  const bytes = /byte/i.test(u.unit || '');
  const show = n => bytes ? (n / 1073741824).toFixed(2) + ' GB' : String(n);
  return `${u.name?.value}: ${show(u.currentValue)} of ${u.limit > 0 ? show(u.limit) : 'no limit given'}${bytes ? '' : ' ' + (u.unit || '')}`;
}).join('\n') || 'no usage figures returned';

console.log('===================== storage that Azure counts, ' + new Date().toISOString());
const siteId = az(['webapp', 'show', '-g', group, '-n', app, '--query', 'id', '-o', 'tsv']);
const planId = JSON.parse(az(['webapp', 'show', '-g', group, '-n', app, '--query', '[serverFarmId, appServicePlanId]', '-o', 'json'])).find(Boolean);
await attempt('the App Service plan', async () => {
  const plan = await arm(planId);
  return JSON.stringify({sku: plan.sku?.name, tier: plan.sku?.tier, instances: plan.sku?.capacity, appsOnThePlan: plan.properties?.numberOfSites, status: plan.properties?.status});
});
await attempt('plan usage against its limits', async () => usageLines(await arm(planId + '/usages')));
await attempt('production slot usage against its limits', async () => usageLines(await arm(siteId + '/usages')));
if (!otherApp) await attempt('staging slot usage against its limits', async () => usageLines(await arm(siteId + '/slots/' + encodeURIComponent(slot) + '/usages')));

for (const name of slots) {
  console.log('\n===================== ' + name + ' slot, ' + new Date().toISOString());
  await attempt('state in Azure', async () => az(['webapp', 'show', '-g', group, '-n', app, ...slotArgs(name), '--query', '{state:state,availabilityState:availabilityState,usageState:usageState,lastModifiedTimeUtc:lastModifiedTimeUtc}', '-o', 'json']));
  const host = scm(name);

  let failed;
  await attempt('last deployments the slot knows', async () => {
    const {status, text, took} = await get(host, '/api/deployments');
    if (status !== 200) return `HTTP ${status}, ${took}: ${text.slice(0, 300)}`;
    const all = JSON.parse(text).sort((a, b) => String(b.received_time).localeCompare(String(a.received_time)));
    failed = all.find(d => d.status === 3);
    return `HTTP 200, ${took}\n` + all.slice(0, 4).map(d => JSON.stringify({id: String(d.id).slice(0, 8), status: d.status, complete: d.complete, active: d.active,
      received: d.received_time, start: d.start_time, end: d.end_time, deployer: d.deployer})).join('\n');
  });

  await attempt('raw files of the newest deployment that failed on the slot', async () => {
    if (!failed) return 'no failed deployment on record';
    const folder = '/api/vfs/site/deployments/' + encodeURIComponent(failed.id) + '/';
    const listing = await get(host, folder);
    if (listing.status !== 200) return `folder: HTTP ${listing.status}`;
    const lines = [`deployment ${String(failed.id).slice(0, 8)}, received ${failed.received_time}`];
    for (const file of JSON.parse(listing.text)) {
      lines.push(JSON.stringify({name: file.name, size: file.size, changed: file.mtime}));
      if (file.mime === 'inode/directory' || file.size > 2000000) continue;
      const content = await get(host, folder + encodeURIComponent(file.name));
      if (content.status !== 200) { lines.push('  HTTP ' + content.status); continue; }
      for (const line of content.text.split(/\r?\n/).filter(Boolean).slice(-30)) lines.push('  ' + clean(line, 260));
    }
    return lines.join('\n');
  });

  await attempt('deployment lock folder (/home/site/locks)', async () => {
    const {status, text, took} = await get(host, '/api/vfs/site/locks/');
    if (status !== 200) return `HTTP ${status}, ${took}: ${text.slice(0, 200)}`;
    const lines = [`HTTP 200, ${took}`];
    for (const entry of JSON.parse(text)) {
      lines.push(JSON.stringify({name: entry.name, kind: entry.mime, size: entry.size, changed: entry.mtime}));
      // A lock file says which operation holds it and since when.
      if (entry.mime !== 'inode/directory' && entry.size <= 20000) lines.push('  content: ' + clean((await get(host, '/api/vfs/site/locks/' + encodeURIComponent(entry.name))).text, 200));
    }
    return lines.join('\n');
  });

  await attempt('load, and the longest-running processes in the deployment container (name only)', () =>
    shell(host, 'date -u; uptime; nproc; ps -eo pid,ppid,etimes,pcpu,pmem,comm --sort=-etimes | head -16'));

  // Kudu names each trace file after the request: time, method, route, answer and duration. One unsorted listing
  // is read (the folder was too slow to sort on 13 Nov 2026), then the error lines of the newest upload request.
  await attempt('Kudu trace: the newest upload requests and why the newest one was answered as it was', () =>
    shell(host, 'cd /home/LogFiles/kudu/trace 2>/dev/null || { echo "no trace folder"; exit 0; }; list=$(timeout 22 ls -U 2>/dev/null); echo "trace files listed: $(echo "$list" | grep -c .)"; echo "newest names:"; echo "$list" | sort | tail -3 | cut -c1-120; echo "newest upload requests:"; echo "$list" | grep -iE "publish|zipdeploy" | sort | tail -6 | cut -c1-120; f=$(echo "$list" | grep -iE "publish|zipdeploy" | sort | tail -1); [ -n "$f" ] && { echo "error lines of the newest upload request:"; timeout 8 grep -aoiE "type=.error.[^>]{0,300}|[A-Za-z.]*Exception[^<\\"]{0,220}" "$f" ' + mask + ' | head -10; }'));

  await attempt('deployment container log: lines about locks, space or conflicts', () =>
    shell(host, 'cd /home/LogFiles 2>/dev/null || exit 0; list=$(timeout 8 ls -U 2>/dev/null); echo "entries in the log folder: $(echo "$list" | grep -c .)"; f=$(echo "$list" | grep -iE "scm.*docker|kudu.*docker" | sort | tail -1); echo "newest deployment container log: ${f:-none found}"; [ -n "$f" ] && { timeout 12 tail -c 400000 "$f" | grep -aiE "lock|exception|no space|quota|conflict| 409" | tail -12 | cut -c1-260 ' + mask + '; }'));

  await attempt('app folder: files over 200 MB, two levels deep', () =>
    shell(host, 'cd /home/site/wwwroot 2>/dev/null || exit 0; timeout 30 find . -maxdepth 2 -type f -size +200M -printf "%s bytes, changed %TY-%Tm-%Td, %p\\n" 2>/dev/null | sort -rn | head -14 ' + mask));

  await attempt('app folder: size of each top entry in MB (an entry that takes over 1 s shows "slow")', () =>
    shell(host, 'cd /home/site/wwwroot 2>/dev/null || exit 0; echo "entries: $(ls -A | wc -l)"; for d in $(ls -A | head -32); do s=$(timeout 1 du -sm "$d" 2>/dev/null | cut -f1); echo "${s:-slow} $d"; done'));

  await attempt('log folder and data folder: files over 200 MB, three levels deep', () =>
    shell(host, 'echo "log folder:"; timeout 15 find /home/LogFiles -maxdepth 3 -type f -size +200M -printf "%s bytes, changed %TY-%Tm-%Td, %p\\n" 2>/dev/null | sort -rn | head -8 ' + mask + '; echo "data folder:"; timeout 15 find /home/data -maxdepth 3 -type f -size +200M -printf "%s bytes, changed %TY-%Tm-%Td, %p\\n" 2>/dev/null | sort -rn | head -8 ' + mask));
}
