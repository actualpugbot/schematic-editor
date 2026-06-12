import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Path to an extracted vanilla data pack's `data/minecraft` directory
// (containing `recipe/` and `tags/item/`), e.g. from the client jar of the
// Minecraft version you want recipes for.
const dataRoot = process.argv[2] ?? process.env.MC_DATA_ROOT;
if (!dataRoot) {
  console.error('Usage: node scripts/build-recipes.mjs <path-to-minecraft-data-root>');
  console.error('       (or set MC_DATA_ROOT)');
  process.exit(1);
}
const recipeRoot = path.join(dataRoot, 'recipe');
const itemTagRoot = path.join(dataRoot, 'tags', 'item');
const outputPath = path.join(process.cwd(), 'src/lib/data/recipes.generated.json');
const allowedTypes = new Set([
  'minecraft:crafting_shaped',
  'minecraft:crafting_shapeless',
  'minecraft:stonecutting',
  'minecraft:smelting',
  'minecraft:blasting',
  'minecraft:smoking',
  'minecraft:campfire_cooking',
]);
const familyPrefixes = [
  'oak',
  'spruce',
  'birch',
  'jungle',
  'acacia',
  'dark_oak',
  'mangrove',
  'cherry',
  'pale_oak',
  'bamboo',
  'crimson',
  'warped',
  'white',
  'light_gray',
  'gray',
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'cyan',
  'light_blue',
  'blue',
  'purple',
  'magenta',
  'pink',
];

const explicitRaw = [
  'air',
  'water',
  'lava',
  'bedrock',
  'barrier',
  'structure_void',
  'light',
  'dirt',
  'grass_block',
  'podzol',
  'mycelium',
  'rooted_dirt',
  'coarse_dirt',
  'sand',
  'red_sand',
  'gravel',
  'clay',
  'clay_ball',
  'mud',
  'packed_ice',
  'ice',
  'blue_ice',
  'snow',
  'snow_block',
  'cobblestone',
  'cobbled_deepslate',
  'stone',
  'granite',
  'diorite',
  'andesite',
  'deepslate',
  'tuff',
  'calcite',
  'dripstone_block',
  'netherrack',
  'soul_sand',
  'soul_soil',
  'basalt',
  'blackstone',
  'end_stone',
  'obsidian',
  'crying_obsidian',
  'glowstone',
  'amethyst_shard',
  'coal',
  'charcoal',
  'iron_ingot',
  'gold_ingot',
  'copper_ingot',
  'diamond',
  'emerald',
  'lapis_lazuli',
  'redstone',
  'quartz',
  'netherite_scrap',
  'netherite_ingot',
  'raw_iron',
  'raw_gold',
  'raw_copper',
  'wheat',
  'wheat_seeds',
  'carrot',
  'potato',
  'beetroot',
  'beetroot_seeds',
  'melon_slice',
  'pumpkin',
  'sugar_cane',
  'cactus',
  'cocoa_beans',
  'bamboo',
  'string',
  'leather',
  'slime_ball',
  'gunpowder',
  'bone',
  'bone_meal',
  'feather',
  'honeycomb',
  'honey_bottle',
  'vine',
  'kelp',
  'moss_block',
  'moss_carpet',
  'short_grass',
  'fern',
  'dead_bush',
  'seagrass',
  'lily_pad',
  'torchflower',
  'pitcher_plant',
  'apple',
  'egg',
  'milk_bucket',
  'ink_sac',
  'glow_ink_sac',
  'prismarine_shard',
  'prismarine_crystals',
  'nautilus_shell',
  'heart_of_the_sea',
  'nether_wart',
  'blaze_rod',
  'blaze_powder',
  'ender_pearl',
  'ghast_tear',
  'magma_cream',
  'phantom_membrane',
  'rabbit_hide',
  'scute',
  'armadillo_scute',
  'flint',
  'flint_and_steel',
  'bucket',
  'white_dye',
  'light_gray_dye',
  'gray_dye',
  'black_dye',
  'brown_dye',
  'red_dye',
  'orange_dye',
  'yellow_dye',
  'lime_dye',
  'green_dye',
  'cyan_dye',
  'light_blue_dye',
  'blue_dye',
  'purple_dye',
  'magenta_dye',
  'pink_dye',
];

const tagCache = new Map();

function normalizeId(id) {
  return String(id ?? '')
    .replace(/^#?minecraft:/, '')
    .replace(/\[.*$/, '');
}

function compactType(type) {
  return type.replace(/^minecraft:/, '');
}

function familyForOutput(outputId) {
  return familyPrefixes.find((family) => outputId === family || outputId.startsWith(`${family}_`) || outputId.includes(`_${family}_`));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function flattenTag(tagId, seen = new Set()) {
  const normalized = normalizeId(tagId);
  if (tagCache.has(normalized)) return tagCache.get(normalized);
  if (seen.has(normalized)) return [];
  seen.add(normalized);

  const tagPath = path.join(itemTagRoot, `${normalized}.json`);
  let json;
  try {
    json = await readJson(tagPath);
  } catch {
    tagCache.set(normalized, []);
    return [];
  }

  const values = [];
  for (const entry of json.values ?? []) {
    const value = typeof entry === 'string' ? entry : entry.id;
    if (!value) continue;
    if (value.startsWith('#')) {
      values.push(...await flattenTag(value.slice(1), seen));
    } else {
      values.push(normalizeId(value));
    }
  }

  const unique = Array.from(new Set(values));
  tagCache.set(normalized, unique);
  return unique;
}

function selectContextualMember(candidates, outputId) {
  if (candidates.length === 0) return null;
  const family = familyForOutput(outputId);
  if (family) {
    const match = candidates.find((candidate) => (
      candidate === family || candidate.startsWith(`${family}_`) || candidate.includes(`_${family}_`)
    ));
    if (match) return match;
  }
  return candidates[0];
}

async function resolveIngredient(value, outputId) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = await resolveIngredient(item, outputId);
      if (resolved) return resolved;
    }
    return null;
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) {
      return selectContextualMember(await flattenTag(value.slice(1)), outputId);
    }
    return normalizeId(value);
  }
  if (typeof value === 'object') {
    if (value.tag) return selectContextualMember(await flattenTag(value.tag), outputId);
    if (value.item) return normalizeId(value.item);
    if (value.id) return normalizeId(value.id);
  }
  return null;
}

function addInput(inputs, id, qty = 1) {
  if (!id || id === 'air') return;
  inputs[id] = (inputs[id] ?? 0) + qty;
}

async function shapedInputs(json, outputId) {
  const inputs = {};
  const key = json.key ?? {};
  const slotCounts = {};
  for (const row of json.pattern ?? []) {
    for (const slot of row) {
      if (slot === ' ') continue;
      slotCounts[slot] = (slotCounts[slot] ?? 0) + 1;
    }
  }
  for (const [slot, qty] of Object.entries(slotCounts)) {
    addInput(inputs, await resolveIngredient(key[slot], outputId), qty);
  }
  return inputs;
}

async function shapelessInputs(json, outputId) {
  const inputs = {};
  for (const ingredient of json.ingredients ?? []) {
    addInput(inputs, await resolveIngredient(ingredient, outputId));
  }
  return inputs;
}

async function singleIngredientInputs(json, outputId) {
  const inputs = {};
  addInput(inputs, await resolveIngredient(json.ingredient, outputId));
  return inputs;
}

async function recipeInputs(json, outputId) {
  switch (json.type) {
    case 'minecraft:crafting_shaped':
      return shapedInputs(json, outputId);
    case 'minecraft:crafting_shapeless':
      return shapelessInputs(json, outputId);
    case 'minecraft:stonecutting':
    case 'minecraft:smelting':
    case 'minecraft:blasting':
    case 'minecraft:smoking':
    case 'minecraft:campfire_cooking':
      return singleIngredientInputs(json, outputId);
    default:
      return {};
  }
}

function rawResourceIds(recipeOutputIds) {
  const raw = new Set(explicitRaw);
  for (const id of recipeOutputIds) {
    if (/(^|_)(ore|log|stem|hyphae|leaves|sapling|coral|flower|tulip|orchid|allium|bluet|daisy|dandelion|poppy|mushroom|fungus|roots|vines|kelp|seagrass|bush)$/.test(id)) {
      raw.add(id);
    }
  }
  return Array.from(raw).sort();
}

async function main() {
  const recipes = {};
  const files = (await readdir(recipeRoot)).filter((file) => file.endsWith('.json')).sort();

  for (const file of files) {
    const json = await readJson(path.join(recipeRoot, file));
    if (!allowedTypes.has(json.type)) continue;
    const result = json.result;
    const outputId = normalizeId(typeof result === 'string' ? result : result?.id);
    if (!outputId) continue;

    const inputs = await recipeInputs(json, outputId);
    if (Object.keys(inputs).length === 0) continue;

    recipes[outputId] ??= [];
    recipes[outputId].push({
      type: compactType(json.type),
      output: typeof result === 'object' && result?.count ? result.count : 1,
      inputs,
    });
  }

  for (const list of Object.values(recipes)) {
    list.sort((a, b) => a.type.localeCompare(b.type) || Object.keys(a.inputs).join(',').localeCompare(Object.keys(b.inputs).join(',')));
  }

  const bundle = {
    version: '26.1.1',
    source: path.relative(process.cwd(), dataRoot),
    recipes,
    raw: rawResourceIds(Object.keys(recipes)),
    stackOverrides: {},
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle)}\n`);
  console.log(`Wrote ${Object.keys(recipes).length} recipe outputs to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
