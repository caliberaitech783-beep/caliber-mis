// Read-only look at why a slot refuses a new release with "There is a deployment currently in progress" (HTTP 409),
// as the staging slot did for every release from 12 Nov 2026 22:35 UTC. It changes nothing on either slot.
// For production and staging it prints: the last deployments the slot knows, the deployment lock it holds, the
// longest-running processes in its deployment container, and how much the release has to check in the two folders
// it preserves. The build log is public: process names only, no command lines, no file names.
import {execFileSync} from 'node:child_process';

const group = 'coalmine-fleet-maintenance-rg';
const app = 'caliber-mis-783';
const slot = process.env.MIS_STAGING_SLOT || 'staging';
const az = args => execFileSync('az', args, {encoding: 'utf8', timeout: 60000}).trim();
const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
const slotArgs = name => name === 'staging' ? ['--slot', slot] : [];
function scm(name) {
  const hosts = JSON.parse(az(['webapp', 'show', '-g', group, '-n', app, ...slotArgs(name), '--query', 'enabledHostNames', '-o', 'json']));
  const host = hosts.find(value => /^caliber-mis-783[a-z0-9-]*\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(value));
  if (!host) throw Error('Azure did not return a recognized deployment hostname.');
  return 'https://' + host;
}

const headers = {Authorization: 'Bearer ' + token, 'Accept-Encoding': 'identity'};
const seconds = started => ((Date.now() - started) / 1000).toFixed(1) + ' s';
async function get(host, route, timeout = 20000) {
  const started = Date.now();
  const response = await fetch(host + route, {headers, redirect: 'error', signal: AbortSignal.timeout(timeout)});
  return {status: response.status, text: await response.text(), took: seconds(started)};
}
// Runs a read-only shell line in the slot's deployment container.
async function shell(host, line, timeout = 45000) {
  const code = `try{console.log(require('node:child_process').execSync(${JSON.stringify(line)},{encoding:'utf8',timeout:40000}))}catch(e){console.log('command failed: '+String(e.message).slice(0,200))}`;
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

for (const name of ['production', 'staging']) {
  console.log('\n===================== ' + name + ' slot, ' + new Date().toISOString());
  await attempt('state in Azure', async () => az(['webapp', 'show', '-g', group, '-n', app, ...slotArgs(name), '--query', '{state:state,availabilityState:availabilityState,usageState:usageState,lastModifiedTimeUtc:lastModifiedTimeUtc}', '-o', 'json']));
  const host = scm(name);

  await attempt('last deployments the slot knows', async () => {
    const {status, text, took} = await get(host, '/api/deployments');
    if (status !== 200) return `HTTP ${status}, ${took}: ${text.slice(0, 300)}`;
    const list = JSON.parse(text).sort((a, b) => String(b.received_time).localeCompare(String(a.received_time))).slice(0, 6);
    return `HTTP 200, ${took}\n` + list.map(d => JSON.stringify({id: String(d.id).slice(0, 8), status: d.status, status_text: d.status_text, complete: d.complete, active: d.active,
      received: d.received_time, start: d.start_time, end: d.end_time, deployer: d.deployer, progress: d.progress, message: String(d.message || '').slice(0, 60)})).join('\n');
  });

  await attempt('deployment lock folder (/home/site/locks)', async () => {
    const {status, text, took} = await get(host, '/api/vfs/site/locks/');
    if (status !== 200) return `HTTP ${status}, ${took}: ${text.slice(0, 200)}`;
    const lines = [`HTTP 200, ${took}`];
    for (const entry of JSON.parse(text)) {
      lines.push(JSON.stringify({name: entry.name, kind: entry.mime, size: entry.size, changed: entry.mtime}));
      if (entry.mime !== 'inode/directory') continue;
      const inner = await get(host, '/api/vfs/site/locks/' + encodeURIComponent(entry.name) + '/');
      if (inner.status !== 200) { lines.push('  inside: HTTP ' + inner.status); continue; }
      for (const file of JSON.parse(inner.text)) {
        lines.push('  ' + JSON.stringify({name: file.name, size: file.size, changed: file.mtime}));
        if (file.mime === 'inode/directory' || file.size > 4000) continue;
        const content = await get(host, '/api/vfs/site/locks/' + encodeURIComponent(entry.name) + '/' + encodeURIComponent(file.name));
        lines.push('    content: ' + content.text.slice(0, 600).replace(/\s+/g, ' '));
      }
    }
    return lines.join('\n');
  });

  await attempt('longest-running processes in the deployment container (name only)', () =>
    shell(host, 'date -u; uptime; ps -eo pid,ppid,etimes,pcpu,pmem,comm --sort=-etimes | head -45'));

  await attempt('folders the release preserves, and the disk', () =>
    shell(host, 'for d in /home/data/bdms-backups /home/data/caliber-mis/scanned-cards; do echo "$d: $(timeout 12 find "$d" -type f 2>/dev/null | wc -l) files, $(timeout 12 du -sm "$d" 2>/dev/null | cut -f1) MB, largest $(timeout 12 find "$d" -type f -printf "%s\\n" 2>/dev/null | sort -n | tail -1) bytes"; done; df -h /home | tail -1; ls -la --time-style=long-iso /home/site/deployments 2>/dev/null | tail -8'));
}
