import { readFile, writeFile } from 'node:fs/promises';

const artifactPath = new URL('../contracts/out/RewardDistributor.sol/RewardDistributor.json', import.meta.url);
const endpointPath = new URL('../api/deploy-distributor.js', import.meta.url);
const checkOnly = process.argv.includes('--check');
const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
const bytecode = artifact?.bytecode?.object;
if (typeof bytecode !== 'string' || !/^0x[0-9a-f]+$/i.test(bytecode)) {
  throw new Error('RewardDistributor artifact does not contain valid creation bytecode.');
}
const endpoint = await readFile(endpointPath, 'utf8');
const pattern = /const BYTECODE = '0x[0-9a-f]+';/i;
const match = endpoint.match(pattern);
if (!match) throw new Error('Embedded RewardDistributor BYTECODE constant was not found.');
const replacement = `const BYTECODE = '${bytecode}';`;
if (match[0] === replacement) console.log('RewardDistributor deployment bytecode is current.');
else if (checkOnly) throw new Error('Embedded RewardDistributor bytecode is stale. Run npm run sync:bytecode after forge build.');
else {
  await writeFile(endpointPath, endpoint.replace(pattern, replacement));
  console.log('Updated embedded RewardDistributor deployment bytecode.');
}