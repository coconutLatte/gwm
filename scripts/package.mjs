import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Use a stable major.minor.patch version.');
const directory = path.join(project, 'releases', `v${manifest.version}`);
const filename = `gwm-${manifest.version}.vsix`;
await fs.mkdir(directory, { recursive: true });
const output = path.join(directory, filename);
// VSCE runs vscode:prepublish, which checks types, translations and builds the extension.
execFileSync(process.execPath, [path.join(project, 'node_modules/@vscode/vsce/vsce'),
  'package', '--skip-license', '--out', output], { cwd: project, stdio: 'inherit' });
const checksum = createHash('sha256').update(await fs.readFile(output)).digest('hex');
await fs.writeFile(path.join(directory, 'SHA256SUMS'), `${checksum}  ${filename}\n`);
console.log(`Release package: ${path.relative(project, output)}`);
