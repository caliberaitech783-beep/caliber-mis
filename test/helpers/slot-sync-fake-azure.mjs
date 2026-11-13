// Stands in for Azure when test/slot-data-sync-retry.test.mjs runs the real slot data script. The `az` command answers
// from a stub, the two slots hold one backup file that is already on both, and a retry pause passes at once.
//   SLOT_SYNC_STALLS  how many times the staging slot lets a file check run out of time before it answers
//   SLOT_SYNC_BUSY    how many times a directory listing answers "503 busy" before it answers
import {registerHooks} from 'node:module';

const az = `export const execFileSync = (file, args) => args.includes('get-access-token') ? 'test-token' :
  JSON.stringify([args.includes('--slot') ? 'caliber-mis-783-staging.scm.azurewebsites.net' : 'caliber-mis-783.scm.azurewebsites.net']);`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:child_process') return {url: 'data:text/javascript,' + encodeURIComponent(az), shortCircuit: true};
    return nextResolve(specifier, context);
  },
});

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (run, ms, ...rest) => realSetTimeout(run, ms >= 1000 ? 0 : ms, ...rest);

let stalls = Number(process.env.SLOT_SYNC_STALLS || 0), busy = Number(process.env.SLOT_SYNC_BUSY || 0), stagingChecks = 0, writes = 0;
const json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
globalThis.fetch = async (url, options = {}) => {
  const {hostname, pathname} = new URL(url);
  const method = options.method || 'GET';
  if (pathname === '/api/vfs/data/caliber-mis/integration.key') return new Response('same-key-on-both-slots');
  if (pathname === '/api/command') {
    if (hostname.includes('-staging')) {
      stagingChecks++;
      if (stalls-- > 0) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    return json({Output: 'ab'.repeat(32) + '\n', ExitCode: 0});
  }
  if (method === 'GET' && pathname === '/api/vfs/data/bdms-backups/') {
    if (busy-- > 0) return new Response(null, {status: 503});
    return json([{name: '2026-11', mime: 'inode/directory'}]);
  }
  if (method === 'GET' && pathname === '/api/vfs/data/bdms-backups/2026-11/') return json([{name: 'backup.zip', mime: 'application/zip', size: 5}]);
  if (method === 'HEAD' && pathname === '/api/vfs/data/bdms-backups/2026-11/backup.zip') return new Response(null, {headers: {'Content-Length': '5'}});
  // The folder is already there. Any other write would mean the script changed a file that was the same on both slots.
  if (method === 'PUT' && pathname.endsWith('/')) return new Response(null, {status: 409});
  if (method !== 'GET' && method !== 'HEAD') writes++;
  return new Response(null, {status: 404});
};
process.on('exit', () => console.log(`fake-azure: staging file checks ${stagingChecks}, writes ${writes}`));
