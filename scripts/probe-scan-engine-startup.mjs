import {execFileSync} from 'node:child_process';
import {tailLines} from './slot-configuration-compare.mjs';

const app = process.env.SCAN_ENGINE_APP;
if (!app || !/^[a-z0-9-]+$/.test(app)) throw Error('Scan engine app name is unavailable.');
const where = ['-g', 'coalmine-fleet-maintenance-rg', '-n', app];
const az = args => execFileSync('az', args, {
  encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe']
}).trim();
const config = JSON.parse(az(['webapp', 'config', 'show', ...where, '--query',
  '{runtime:linuxFxVersion,engineEntry:appCommandLine==`"node server/scan-engine.mjs"`,health:healthCheckPath}', '-o', 'json']));
console.log(config);
const hosts = JSON.parse(az(['webapp', 'show', ...where, '--query', 'enabledHostNames', '-o', 'json']));
const scm = hosts.find(host => /^[a-z0-9-]+\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(host));
if (!scm) throw Error('Scan engine SCM host is unavailable.');
const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
async function get(route) {
  const response = await fetch('https://' + scm + route, {
    headers: {Authorization: 'Bearer ' + token},
    redirect: 'error', signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw Error('SCM returned HTTP ' + response.status + ' for ' + route);
  return response;
}
const files = (await (await get('/api/vfs/LogFiles/')).json())
  .filter(file => /docker\.log$/i.test(file.name) && !/_scm_/.test(file.name))
  .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
for (const file of [files.find(item => /_default_docker/.test(item.name)), files.find(item => !/_default_docker/.test(item.name))].filter(Boolean)) {
  console.log(file.name);
  if (file.size > 8 * 1024 * 1024) continue;
  const lines = tailLines(await (await get('/api/vfs/LogFiles/' + encodeURIComponent(file.name))).text(), 80, 240);
  for (const line of lines) {
    if (/oryx|node_modules|ERR_MODULE|cannot find|container|extract|startup|listening|crash|failed/i.test(line)
      && !/secret|token|key|password|connection string|postgres:|postgresql:/i.test(line)) console.log(line);
  }
}
