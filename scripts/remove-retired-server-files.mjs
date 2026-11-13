import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// A release adds and replaces files on a server but never deletes one that left the package, so a file removed
// from the code stays on each server's disk. Each entry names one folder under site/wwwroot and the only file
// names that may be deleted from it. Anything else found there is reported and left alone, and so is the folder.
const manualPdf = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:en|hi)\.pdf$/;
export const retiredFolders = [
  // Report operating manuals, switched off by the owner on 13 November 2026 (64 PDFs, last in commit 2872070).
  {folder: ['public', 'guides'], file: manualPdf},
  {folder: ['dist', 'guides'], file: manualPdf},
];

const route = parts => '/api/vfs/site/wwwroot/' + parts.map(encodeURIComponent).join('/');

// `request(route, options)` answers like fetch against one server's deployment site.
// With `remove` false nothing is changed: the folders are only listed.
export async function removeRetiredFiles({request, folders = retiredFolders, remove = false}) {
  const report = [];
  for (const {folder, file} of folders) {
    if (!folder.length || folder.some(part => !/^[a-z0-9][a-z0-9-]*$/.test(part))) throw Error('Invalid retired folder.');
    const name = folder.join('/');
    const directory = route(folder) + '/';
    const list = async () => {
      const listing = await request(directory);
      if (listing.status === 404) return null;
      if (!listing.ok) throw Error(`Listing ${name} failed with HTTP ${listing.status}.`);
      const entries = await listing.json();
      if (!Array.isArray(entries)) throw Error(`Listing ${name} was not a file list.`);
      return entries;
    };
    const split = entries => {
      const retired = [], kept = [];
      for (const entry of entries) {
        const entryName = String(entry?.name ?? '');
        if (entry?.mime !== 'inode/directory' && file.test(entryName)) retired.push({name: entryName, size: Number(entry.size) || 0});
        else kept.push(entryName);
      }
      return {retired, kept};
    };

    const entries = await list();
    if (!entries) {
      report.push({folder: name, present: false, found: 0, bytes: 0, removed: 0, kept: [], folderRemoved: false});
      continue;
    }
    const {retired, kept} = split(entries);
    const line = {folder: name, present: true, found: retired.length, bytes: retired.reduce((sum, item) => sum + item.size, 0), removed: 0, kept, folderRemoved: false};
    report.push(line);
    if (!remove) continue;

    for (const item of retired) {
      const gone = await request(route([...folder, item.name]), {method: 'DELETE', headers: {'If-Match': '*'}});
      if (!gone.ok && gone.status !== 404) throw Error(`Deleting ${name}/${item.name} failed with HTTP ${gone.status}.`);
      line.removed++;
    }
    // The folder goes only when nothing else was in it; a folder that will not go is not an error.
    if (!kept.length) await request(directory, {method: 'DELETE', headers: {'If-Match': '*'}});
    // Believe the server's own list, not the replies to the deletes.
    const after = await list();
    line.folderRemoved = !after;
    const left = after ? split(after).retired : [];
    if (left.length) throw Error(`${left.length} retired files are still in ${name} after deleting.`);
  }
  return report;
}

const megabytes = bytes => (bytes / 1048576).toFixed(1) + ' MB';
export function describe(report, remove) {
  return report.map(line => {
    if (!line.present) return `${line.folder}: folder is not there`;
    const found = `${line.found} old files found (${megabytes(line.bytes)})`;
    const other = line.kept.length ? `; ${line.kept.length} other entries left alone: ${line.kept.slice(0, 10).join(', ')}` : '';
    if (!remove) return `${line.folder}: ${found}; nothing deleted, list only${other}`;
    const folder = line.folderRemoved ? 'folder removed' : 'folder kept';
    return `${line.folder}: ${found}; ${line.removed} deleted; ${folder}${other}`;
  });
}

async function main() {
  const group = 'coalmine-fleet-maintenance-rg';
  const app = 'caliber-mis-783';
  const slot = process.env.MIS_STAGING_SLOT || 'staging';
  const engine = process.env.SCAN_ENGINE_APP || '';
  const remove = process.env.DELETE_RETIRED_FILES === 'true';
  for (const value of [slot, engine]) if (value && !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw Error('Invalid slot or app name.');

  const az = args => execFileSync('az', args, {encoding: 'utf8', timeout: 60000}).trim();
  const token = az(['account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv']);
  const scm = (name, show) => {
    const hosts = JSON.parse(az(['webapp', 'show', ...show, '--query', 'enabledHostNames', '-o', 'json']));
    const host = hosts.find(value => new RegExp('^' + name + '[a-z0-9-]*\\.scm\\.(?:[a-z0-9-]+\\.)?azurewebsites\\.net$').test(value));
    if (!host) throw Error('Azure did not return a recognized deployment hostname.');
    return 'https://' + host;
  };
  const targets = [
    {label: 'Pulse-II production slot', host: () => scm(app, ['-g', group, '-n', app])},
    {label: `Pulse-II ${slot} slot`, host: () => scm(app, ['-g', group, '-n', app, '--slot', slot])},
  ];
  if (engine) targets.push({label: 'Scan engine server', host: () => {
    const engineGroup = az(['webapp', 'list', '--query', `[?name=='${engine}'].resourceGroup | [0]`, '-o', 'tsv']);
    if (!engineGroup) throw Error('This login cannot see the scan engine app.');
    return scm(engine, ['-g', engineGroup, '-n', engine]);
  }});

  const lines = [remove ? 'Deleting retired files.' : 'Listing retired files only; nothing is deleted.'];
  let failed = 0;
  for (const target of targets) {
    lines.push('', target.label);
    try {
      const host = target.host();
      // The deployment site can answer 502 or 503 while it wakes up; listing and deleting are safe to repeat.
      const request = async (path, options = {}) => {
        for (let attempt = 1; ; attempt++) {
          try {
            const response = await fetch(host + path, {...options, headers: {Authorization: 'Bearer ' + token, ...options.headers}, redirect: 'error', signal: AbortSignal.timeout(60000)});
            if (response.status < 500 || attempt === 4) return response;
          } catch (error) {
            if (attempt === 4) throw error;
          }
          await new Promise(resolve => setTimeout(resolve, attempt * 5000));
        }
      };
      for (const line of describe(await removeRetiredFiles({request, remove}), remove)) lines.push('  ' + line);
    } catch (error) {
      failed++;
      lines.push('  FAILED: ' + error.message);
    }
  }
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + lines.join('\n') + '\n```\n');
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
