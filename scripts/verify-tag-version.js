const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const manifestVersion = manifest.version;

const githubRef = process.env.GITHUB_REF || '';
const tag = githubRef.startsWith('refs/tags/') ? githubRef.replace('refs/tags/', '') : '';

if (!tag) {
  console.error('No Git tag found in GITHUB_REF.');
  process.exit(1);
}

const expectedVersion = tag.startsWith('v') ? tag.slice(1) : tag;

if (manifestVersion !== expectedVersion) {
  console.error(`Manifest version mismatch: manifest.json=${manifestVersion}, tag=${tag}`);
  process.exit(1);
}

console.log(`Version check passed: ${manifestVersion}`);
