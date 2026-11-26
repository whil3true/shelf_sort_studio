import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from '../src/audio/AudioAssets.json' with { type: 'json' };
import hashes from '../docs/audio.sha256.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = join(root, 'src/audio/AudioAssets.json');
const output = 'public/assets/audio';
const incoming = 'incoming-audio';
const files = [...new Set(Object.values(manifest.files))];

async function readAudio(folder, filename) {
  const label = `${folder}/${filename}`;
  const path = join(root, label);
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error('expected a regular file');
    const bytes = await readFile(path);
    if (!bytes.length) throw new Error('file is empty');
    if (bytes.subarray(0, 4).toString('ascii') !== 'OggS') throw new Error('invalid Ogg header');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== hashes[filename]) throw new Error(`SHA-256 mismatch (expected ${hashes[filename]}, got ${actual})`);
    return bytes;
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'file is missing' : error.message;
    throw new Error(`${label}: ${reason}`);
  }
}

async function main() {
  if (typeof manifest.enabled !== 'boolean' || files.length !== 7 || Object.keys(hashes).length !== files.length
    || files.some(file => !/^[\w-]+\.ogg$/.test(file) || !/^[a-f0-9]{64}$/.test(hashes[file]))) {
    throw new Error('Audio manifest and expected SHA-256 checksums must describe the same seven OGG files.');
  }

  const verifyOnly = process.argv.includes('--verify');
  if (verifyOnly && !manifest.enabled) return;
  const folder = verifyOnly ? output : incoming;
  const source = await Promise.allSettled(files.map(file => readAudio(folder, file)));
  const failures = source.filter(result => result.status === 'rejected');
  if (failures.length) {
    throw new Error(failures.map(result => result.reason.message).join('\n'));
  }
  if (verifyOnly) return;

  // Publish only verified bytes. Enable playback after every file is in place.
  const staging = await mkdtemp(join(root, '.install-audio-'));
  try {
    for (const [index, file] of files.entries()) await writeFile(join(staging, file), source[index].value);
    const stagedManifest = join(staging, 'AudioAssets.json');
    await writeFile(stagedManifest, JSON.stringify({ ...manifest, enabled: true }, null, 2) + '\n');
    await mkdir(join(root, output), { recursive: true });
    for (const file of files) await rename(join(staging, file), join(root, output, file));
    await rename(stagedManifest, manifestPath);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  console.log(`Installed ${files.length} verified OGG files in ${output} and enabled audio.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
