import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {SUBSCRIPTION, GROUP, APP, driveSpace, maskLine, safeName} from './repair-mis-staging-slot.mjs';

// Free space on the App Service plan's shared drive (owner, 24 Nov 2026: "plz clear unwanted files").
// On 24 Nov 2026 the drive held 500 of 500 GB and every release was refused at the staging upload (Kudu 409
// "deployment in progress", the same as on 13 Nov). Without --delete this only lists: free space and the size of
// each item below. With --delete it removes ONLY the items in REMOVABLE, on the production and staging slots.
// Nothing under /home/data is ever touched: the integration key, the database backups (bdms-backups) and the
// scanned card archive are the app's own files and safety copies.
export const REMOVABLE = [
  {name: 'code history (.git) in the app folder; the app never reads it, it reads DEPLOYMENT_SHA', path: '/home/site/wwwroot/.git', remove: 'rm -rf /home/site/wwwroot/.git'},
  {name: 'trace files of the deployment service (diagnostics only)', path: '/home/LogFiles/kudu/trace', remove: 'find /home/LogFiles/kudu/trace -mindepth 1 -delete'},
];
// Sized for the owner's decision, never deleted here.
export const LOOK_ONLY = [
  {name: 'app data: integration key, database backups, scanned card archive (never deleted here)', path: '/home/data'},
  {name: 'old deployment records', path: '/home/site/deployments'},
  {name: 'all log files', path: '/home/LogFiles'},
  {name: 'the app folder as a whole', path: '/home/site/wwwroot'},
];
const ARM = 'https://management.azure.com';
const WEB_API = '2023-12-01';
// Kudu stops a command after about 40 seconds, so each command is cut at 35 and a removal is repeated until done.
const STEP_SECONDS = 35;
const REMOVE_ROUNDS = 8;
const SAFE_PATH = /^\/home\/(?:site\/wwwroot\/\.git|LogFiles\/kudu\/trace|data|site\/deployments|LogFiles|site\/wwwroot)$/;

export class FreeStop extends Error {}

export const sizeLine = kilobytes => kilobytes === null ? 'too many files to size in ' + STEP_SECONDS + ' s' : (kilobytes / 1024 / 1024).toFixed(2) + ' GB';
// `du -sk` prints "<kilobytes>\t<path>"; null when it did not finish.
export function sizeFrom(output) {
  const match = String(output ?? '').match(/^(\d+)\s+\/home\//m);
  return match && !/stopped: |exit=124/.test(String(output)) ? Number(match[1]) : null;
}

// `request(host, line)` runs one shell line on a slot's deployment site and answers its output as text.
export async function freeDiskSpace({request, slots, remove = false, log = console.log}) {
  for (const item of [...REMOVABLE, ...LOOK_ONLY]) if (!SAFE_PATH.test(item.path)) throw new FreeStop('An item outside the fixed list was asked for.');
  const report = {before: null, after: null, removed: [], left: []};
  log(`===================== MIS disk space, ${remove ? 'DELETE' : 'list only, nothing is changed'}, ${new Date().toISOString()}`);
  const drive = async label => {
    const space = driveSpace(await request(slots[0].host, 'df -Pk /home'));
    log(`\n--- free space on the shared drive (${label}): ` + (space ? `${space.totalGb} GB in all, ${space.usedGb} GB used, ${space.freeGb} GB free` : 'could not be read'));
    return space;
  };
  report.before = await drive('before');
  for (const slot of slots) {
    log(`\n===== ${slot.name} slot`);
    for (const item of [...REMOVABLE, ...LOOK_ONLY]) {
      const output = await request(slot.host, `if [ -e ${item.path} ]; then timeout ${STEP_SECONDS} du -sk ${item.path} 2>/dev/null; echo "exit=$?"; else echo absent; fi`);
      const present = !/^absent$/m.test(output);
      log(`${item.path}: ${present ? sizeLine(sizeFrom(output)) : 'not present'} (${item.name})`);
      if (!remove || !present || !REMOVABLE.includes(item)) continue;
      let gone = false;
      for (let round = 1; round <= REMOVE_ROUNDS && !gone; round++) {
        const after = await request(slot.host, `timeout ${STEP_SECONDS} ${item.remove} 2>/dev/null; if [ -e ${item.path} ] && [ -n "$(ls -AU ${item.path} 2>/dev/null | head -1)" ]; then echo left; else echo gone; fi`);
        gone = /^gone$/m.test(after);
      }
      (gone ? report.removed : report.left).push(slot.name + ' ' + item.path);
      log(`  ${gone ? 'removed' : 'partly removed: run again to go on'}`);
    }
  }
  if (remove) report.after = await drive('after');
  log(remove ? `\nRemoved: ${report.removed.join(', ') || 'nothing'}.${report.left.length ? ' Not finished: ' + report.left.join(', ') + '.' : ''}` : '\nNothing was changed. Run again with "delete" ticked to remove the items in the first list.');
  return report;
}

// One shell line on a slot, through the deployment site's command route (as scripts/probe-slot-deployment-state.mjs).
function slotShell(token, fetchImpl = fetch) {
  return async (host, line) => {
    const code = `const r=require('node:child_process').spawnSync('sh',['-c',${JSON.stringify(line)}],{encoding:'utf8',timeout:38000});console.log((r.stdout||'')+(r.error?'\\nstopped: '+r.error.code:''))`;
    const response = await fetchImpl('https://' + host + '/api/command', {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({command: `node -e "eval(Buffer.from('${Buffer.from(code).toString('base64')}','base64').toString())"`, dir: '/home'}),
      redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new FreeStop(`The deployment site refused a command (HTTP ${response.status}).`);
    const body = await response.json().catch(() => ({}));
    return String(body.Output ?? '') + (body.Error ? '\n' + maskLine(body.Error, 200) : '');
  };
}

async function slotHosts(token, stagingSlot, fetchImpl = fetch) {
  if (!/^[a-z0-9-]{1,40}$/.test(stagingSlot) || stagingSlot === 'production') throw new FreeStop('The staging slot name is not valid.');
  const site = `/subscriptions/${SUBSCRIPTION}/resourceGroups/${GROUP}/providers/Microsoft.Web/sites/${APP}`;
  const host = async (path, name) => {
    const response = await fetchImpl(ARM + path + '?api-version=' + WEB_API, {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(90000)});
    if (!response.ok) throw new FreeStop(`The ${name} slot could not be read (HTTP ${response.status}).`);
    const found = ((await response.json()).properties?.enabledHostNames || []).find(value => String(value).startsWith(APP) && /^[a-z0-9-]+\.scm\.(?:[a-z0-9-]+\.)?azurewebsites\.net$/.test(value));
    if (!found) throw new FreeStop(`Azure did not return the ${name} slot's deployment hostname.`);
    return {name, host: found};
  };
  return [await host(site, 'production'), await host(`${site}/slots/${stagingSlot}`, safeName(stagingSlot))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const remove = process.argv.includes('--delete');
  try {
    const token = execFileSync('az', ['account', 'get-access-token', '--resource', ARM + '/', '--query', 'accessToken', '-o', 'tsv'],
      {encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
    // The same Azure sign-in reaches the deployment sites (as scripts/repair-mis-staging-slot.mjs does).
    const slots = await slotHosts(token, process.env.MIS_STAGING_SLOT || 'staging');
    const report = await freeDiskSpace({request: slotShell(token), slots, remove});
    if (remove && report.left.length) process.exitCode = 1;
  } catch (error) {
    console.log('Stopped: ' + (error instanceof FreeStop ? error.message : maskLine(error?.message || 'unexpected error', 160)));
    process.exitCode = 1;
  }
}
