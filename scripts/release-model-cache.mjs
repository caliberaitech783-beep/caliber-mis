import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile, lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const manifestName = '.release-verified.json';
export async function modelCacheManifest(root=process.cwd()) {
  const inputs = createHash('sha256');
  for (const name of ['package-lock.json','handwritten-card-ocr.mjs','scripts/prepare-handwriting-model.mjs']) inputs.update(await readFile(path.join(root,name)));
  const files = {};
  async function visit(relative='') {
    for (const name of (await readdir(path.join(root,'ocr-model-cache',relative))).sort()) {
      if (!relative && name === manifestName) continue;
      const file = path.posix.join(relative,name), absolute = path.join(root,'ocr-model-cache',file);
      const info = await lstat(absolute);
      if (info.isDirectory()) await visit(file);
      else if (info.isFile()) files[file] = createHash('sha256').update(await readFile(absolute)).digest('hex');
      else throw Error('Model cache contains a non-regular file');
    }
  }
  await visit();
  if (!Object.keys(files).length) throw Error('Model cache is empty');
  return {inputs:inputs.digest('hex'),files};
}
export async function verifyModelCache(root=process.cwd()) {
  try {
    return JSON.stringify(await modelCacheManifest(root)) === JSON.stringify(JSON.parse(await readFile(path.join(root,'ocr-model-cache',manifestName),'utf8')));
  } catch { return false; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--seal')) {
    await writeFile(path.join('ocr-model-cache',manifestName), JSON.stringify(await modelCacheManifest()));
    console.log('Recorded the offline-verified model cache.');
  } else if (!await verifyModelCache()) {
    console.error('Verified model cache unavailable; full validation required.'); process.exitCode=1;
  } else console.log('Model cache integrity verified without loading the model.');
}
