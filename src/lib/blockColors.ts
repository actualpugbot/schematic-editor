export interface BlockAppearance {
  color: number;
  label: string;
}

const namedColors: Array<[RegExp, BlockAppearance]> = [
  [/^(air|void_air|cave_air)(?:$|\[)/, { color: 0x000000, label: 'Air' }],
  [/water|kelp|seagrass|bubble_column/, { color: 0x3d6cb9, label: 'Water' }],
  [/lava|magma/, { color: 0xf47b20, label: 'Lava' }],
  [/grass_block|short_grass|tall_grass|moss|azalea|leaves|vine|bamboo|cactus|kelp|seagrass/, { color: 0x5f9f4e, label: 'Foliage' }],
  [/dirt|mud|farmland|podzol|rooted_dirt/, { color: 0x8a6240, label: 'Earth' }],
  [/stone|andesite|diorite|granite|deepslate|tuff|basalt|calcite|dripstone|bedrock/, { color: 0x8d9190, label: 'Stone' }],
  [/cobblestone|bricks|brick|polished|smooth_stone/, { color: 0x777c7a, label: 'Masonry' }],
  [/sandstone|sand|end_stone|terracotta|clay/, { color: 0xd6bd7b, label: 'Sand/Clay' }],
  [/gravel/, { color: 0x85817b, label: 'Gravel' }],
  [/oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|crimson|warped|bamboo_mosaic|planks|log|wood|stem|hyphae/, { color: 0xae7c45, label: 'Wood' }],
  [/glass|ice|amethyst|tinted_glass/, { color: 0xaed8de, label: 'Glass/Ice' }],
  [/wool|carpet|concrete|powder/, { color: 0xd7d1c5, label: 'Fabric/Concrete' }],
  [/redstone|red_wool|red_concrete|red_terracotta/, { color: 0xb33a34, label: 'Redstone/Red' }],
  [/beacon/, { color: 0x6fe3dc, label: 'Beacon' }],
  [/diamond|prismarine/, { color: 0x54c8c4, label: 'Diamond/Prismarine' }],
  [/gold|honey|hay|yellow/, { color: 0xd6ad31, label: 'Gold/Yellow' }],
  [/emerald|green_concrete|lime/, { color: 0x4aa05a, label: 'Emerald/Green' }],
  [/lapis|blue_concrete|blue_wool/, { color: 0x3d58a8, label: 'Blue' }],
  [/obsidian|blackstone|black_concrete|coal|netherite/, { color: 0x282633, label: 'Dark Stone' }],
  [/quartz|white_concrete|white_wool|snow|bone/, { color: 0xe6e1d2, label: 'Pale Block' }],
  [/copper|orange|pumpkin/, { color: 0xb86d3c, label: 'Copper/Orange' }],
  [/netherrack|nether_bricks|nylium|crimson/, { color: 0x7e343d, label: 'Nether' }],
];

const legacyColors = new Map<number, BlockAppearance>([
  [1, { color: 0x8d9190, label: 'Stone' }],
  [2, { color: 0x5f9f4e, label: 'Grass Block' }],
  [3, { color: 0x8a6240, label: 'Dirt' }],
  [4, { color: 0x777c7a, label: 'Cobblestone' }],
  [5, { color: 0xae7c45, label: 'Wood Planks' }],
  [7, { color: 0x282633, label: 'Bedrock' }],
  [8, { color: 0x3d6cb9, label: 'Water' }],
  [9, { color: 0x3d6cb9, label: 'Water' }],
  [10, { color: 0xf47b20, label: 'Lava' }],
  [11, { color: 0xf47b20, label: 'Lava' }],
  [12, { color: 0xd6bd7b, label: 'Sand' }],
  [13, { color: 0x85817b, label: 'Gravel' }],
  [17, { color: 0x8b5f35, label: 'Log' }],
  [18, { color: 0x5f9f4e, label: 'Leaves' }],
  [20, { color: 0xaed8de, label: 'Glass' }],
  [29, { color: 0x80776a, label: 'Sticky Piston' }],
  [33, { color: 0x80776a, label: 'Piston' }],
  [34, { color: 0x80776a, label: 'Piston Head' }],
  [35, { color: 0xd7d1c5, label: 'Wool' }],
  [41, { color: 0xd6ad31, label: 'Gold Block' }],
  [42, { color: 0xb4b8b4, label: 'Iron Block' }],
  [45, { color: 0xa8513f, label: 'Brick' }],
  [49, { color: 0x282633, label: 'Obsidian' }],
  [57, { color: 0x54c8c4, label: 'Diamond Block' }],
  [73, { color: 0xb33a34, label: 'Redstone Ore' }],
  [98, { color: 0x777c7a, label: 'Stone Brick' }],
  [133, { color: 0x4aa05a, label: 'Emerald Block' }],
  [138, { color: 0x6fe3dc, label: 'Beacon' }],
  [155, { color: 0xe6e1d2, label: 'Quartz' }],
  [159, { color: 0xb86d3c, label: 'Terracotta' }],
  [160, { color: 0xaed8de, label: 'Glass Pane' }],
  [172, { color: 0xd6bd7b, label: 'Hardened Clay' }],
  [251, { color: 0xd7d1c5, label: 'Concrete' }],
  [252, { color: 0xd7d1c5, label: 'Concrete Powder' }],
]);

export function blockAppearance(name: string): BlockAppearance {
  const normalized = name.replace(/^minecraft:/, '').toLowerCase();

  for (const [pattern, appearance] of namedColors) {
    if (pattern.test(normalized)) {
      return appearance;
    }
  }

  return {
    color: colorFromString(normalized),
    label: titleCase(normalized.split('[')[0]),
  };
}

export function legacyBlockAppearance(id: number): BlockAppearance {
  return (
    legacyColors.get(id) ?? {
      color: colorFromString(`legacy-${id}`),
      label: `Block ${id}`,
    }
  );
}

export function isAirBlock(name: string): boolean {
  return /(^|:)air($|\[)|void_air|cave_air/.test(name);
}

function colorFromString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const hue = hash % 360;
  return hslToRgb(hue, 42, 54);
}

function hslToRgb(h: number, s: number, l: number): number {
  const hue = h / 360;
  const sat = s / 100;
  const light = l / 100;
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const r = hueToRgb(p, q, hue + 1 / 3);
  const g = hueToRgb(p, q, hue);
  const b = hueToRgb(p, q, hue - 1 / 3);
  return (Math.round(r * 255) << 16) + (Math.round(g * 255) << 8) + Math.round(b * 255);
}

function hueToRgb(p: number, q: number, t: number): number {
  let channel = t;
  if (channel < 0) channel += 1;
  if (channel > 1) channel -= 1;
  if (channel < 1 / 6) return p + (q - p) * 6 * channel;
  if (channel < 1 / 2) return q;
  if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
  return p;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}
