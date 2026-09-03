import { cp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(apiRoot, 'dist');
const sourcePackage = JSON.parse(await readFile(resolve(apiRoot, 'package.json'), 'utf8'));

const deploymentPackage = { ...sourcePackage, main: 'index.js' };
delete deploymentPackage.scripts;
delete deploymentPackage.devDependencies;

await cp(resolve(apiRoot, 'host.json'), resolve(distRoot, 'host.json'));
await writeFile(resolve(distRoot, 'package.json'), `${JSON.stringify(deploymentPackage, null, 2)}\n`);
