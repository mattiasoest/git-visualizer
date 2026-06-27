import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

const frontendPath = 'frontend/package.json';
const frontendPkg = JSON.parse(readFileSync(frontendPath, 'utf8'));
frontendPkg.version = version;
writeFileSync(frontendPath, `${JSON.stringify(frontendPkg, null, 2)}\n`);

const pomPath = 'backend/pom.xml';
const pom = readFileSync(pomPath, 'utf8').replace(
  /(<artifactId>gitvisualizer<\/artifactId>\s*\n\s*<version>)[^<]+(<\/version>)/,
  `$1${version}$2`,
);
writeFileSync(pomPath, pom);

execSync('git add frontend/package.json backend/pom.xml', { stdio: 'inherit' });
