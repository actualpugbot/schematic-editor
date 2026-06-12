import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Path to a `blockstates` directory (one JSON file per block), defaulting to
// the vanilla assets committed under public/.
const blockstatesRoot = process.argv[2]
  ?? path.join(process.cwd(), 'public/minecraft-assets/assets/minecraft/blockstates');
const outputPath = path.join(process.cwd(), 'src/lib/data/block_ids.generated.json');

async function main() {
  const files = (await readdir(blockstatesRoot)).filter((file) => file.endsWith('.json')).sort();
  const blockIds = files.map((file) => `minecraft:${file.slice(0, -5)}`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(blockIds)}\n`);
  console.log(`Wrote ${blockIds.length} block ids to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
