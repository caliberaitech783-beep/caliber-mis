import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']});
// src/*.mjs includes modules imported by the server (scan validation, reports,
// permissions). Keep all such shared modules on the full validation path.
const uiFile = name => name === 'index.html' || (!name.split('/').some(part => part.startsWith('.')) && (
  /^src\/[^\n]+\.(?:jsx?|tsx?|css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf)$/i.test(name) ||
  /^public\/[^\n]+\.(?:css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf)$/i.test(name)
));
const documentation = name => name.startsWith('docs/') || /^[^/]+\.md$/i.test(name);

// Compare with what THIS target actually serves, never just the previous push.
// Missing history, rollbacks and unknown file types deliberately use full checks.
export async function classifyRelease({cwd=process.cwd(), baseUrl, forceFull=false, fetchImpl=fetch}={}) {
  const full = reason => ({mode:'full', reason});
  if (forceFull) return full('Full validation requested');
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:') return full('No HTTPS deployment baseline');
    url.pathname = '/api/health'; url.search = ''; url.searchParams.set('release-baseline', String(Date.now()));
    const response = await fetchImpl(url, {cache:'no-store', redirect:'error', signal:AbortSignal.timeout(15000)});
    if (!response.ok) return full('Deployment baseline is unavailable');
    const {commit:base} = await response.json();
    if (!/^[0-9a-f]{40}$/.test(base || '')) return full('Deployment baseline has no commit');
    const head = git(cwd, 'rev-parse', 'HEAD').trim();
    if (base === head) return full('Commit is already deployed; validate redeployment fully');
    git(cwd, 'merge-base', '--is-ancestor', base, head);
    const files = git(cwd, 'diff', '--no-renames', '--name-only', '-z', base, head).split('\0').filter(Boolean);
    if (!files.some(uiFile) || files.some(name => !uiFile(name) && !documentation(name))) return full('Changes include runtime, tests, dependencies or deployment configuration');
    // Never treat symlink/submodule additions as ordinary frontend assets.
    for (const entry of git(cwd, 'ls-tree', '-r', '-z', head, '--', ...files).split('\0').filter(Boolean)) {
      if (!/^100(?:644|755) blob /.test(entry)) return full('Changes contain a non-regular file');
    }
    return {mode:'ui', base, reason:`Only frontend files changed since ${base}`};
  } catch {
    return full('Deployment baseline could not be verified');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await classifyRelease({baseUrl:process.env.RELEASE_BASE_URL, forceFull:process.env.FORCE_FULL === 'true'});
  console.log(`Release validation: ${result.mode}. ${result.reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\n`);
}
