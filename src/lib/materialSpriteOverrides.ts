// Intentionally narrow, additive overrides for materials that should always
// render as flat inventory sprites in material lists.

const exactSpriteStateKeyOverrides: Record<string, string> = {
  'minecraft:tripwire': 'minecraft:string',
};

const exactSpriteStateKeys = new Set([
  'minecraft:bamboo',
  'minecraft:blaze_rod',
  'minecraft:bricks',
  'minecraft:coal',
  'minecraft:chorus_fruit',
  'minecraft:clay_ball',
  'minecraft:iron_nugget',
  'minecraft:painting',
  'minecraft:prismarine_crystals',
  'minecraft:prismarine_shard',
  'minecraft:quartz',
  'minecraft:redstone',
  'minecraft:short_grass',
  'minecraft:skeleton_skull',
  'minecraft:stick',
  'minecraft:tall_grass',
  'minecraft:water_bucket',
  'minecraft:wheat',
]);

const spriteStateKeySuffixes = [
  '_dye',
  '_ingot',
];

export function alwaysMaterialSpriteStateKey(stateKey: string): string | null {
  const normalized = normalizeMaterialStateKey(stateKey);
  const exactOverride = exactSpriteStateKeyOverrides[normalized];
  if (exactOverride) return exactOverride;
  if (exactSpriteStateKeys.has(normalized)) return normalized;
  if (spriteStateKeySuffixes.some((suffix) => normalized.endsWith(suffix))) return normalized;
  return null;
}

function normalizeMaterialStateKey(stateKey: string): string {
  const withoutProperties = stateKey.replace(/\[.*$/, '');
  return withoutProperties.includes(':') ? withoutProperties : `minecraft:${withoutProperties}`;
}
