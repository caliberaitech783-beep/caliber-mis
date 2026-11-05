import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Include source-based UI tests even when their names do not contain "UI".
// Tests themselves are protected changes and always select the full lane.
const tests = readdirSync('test').filter(name => name.endsWith('.test.mjs')).filter(name =>
  /(?:ui|frontend|render|layout|branding|app-version|release)/i.test(name) || /(?:\.\.\/src\/|['"`]src\/)/.test(readFileSync(`test/${name}`,'utf8'))
).map(name => `test/${name}`);
if (!tests.length) throw Error('No frontend release tests found');
console.log(`Running ${tests.length} frontend/release test files.`);
const result = spawnSync(process.execPath, ['--test',...tests], {stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
