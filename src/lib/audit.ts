import { isCompound, type NbtCompound } from './nbt';
import type { SchematicModel, VoxelBlock } from './schematic';

/** A single human-readable metadata field surfaced for a flagged block. */
export interface AuditMetadataEntry {
  label: string;
  value: string;
}

export interface AuditCategory {
  /** Stable id, also used to resolve the section icon and remember UI state. */
  id: string;
  label: string;
  /** Short explanation of why the block is worth calling out. */
  description: string;
  /** Optional extra warning appended after the description. */
  note?: string;
  /** Whether this is one of the originally requested types or a recommended extra. */
  group: 'core' | 'extra';
  /** Returns true when a block belongs to this category. */
  match: (block: VoxelBlock) => boolean;
  /** The recommended replacement state key for a given occurrence. */
  recommendedReplacement: (block: VoxelBlock) => string;
  /** Human label for the recommended replacement, shown in the picker. */
  recommendedLabel: string;
  /** True when the recommendation differs per occurrence (e.g. infested → matching base block). */
  perBlockRecommendation?: boolean;
  /** Normally-hidden metadata for one occurrence (block state + block entity NBT). */
  metadata: (block: VoxelBlock) => AuditMetadataEntry[];
}

export interface AuditFinding {
  category: AuditCategory;
  occurrences: VoxelBlock[];
}

// --- Block-state helpers -----------------------------------------------------

/** Parses the `[key=value,...]` portion of a block state key into a map. */
export function blockStateProperties(stateKey: string): Record<string, string> {
  const open = stateKey.indexOf('[');
  if (open === -1 || !stateKey.endsWith(']')) return {};
  const body = stateKey.slice(open + 1, -1);
  const properties: Record<string, string> = {};
  for (const pair of body.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    properties[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return properties;
}

function prop(block: VoxelBlock, key: string): string | undefined {
  return blockStateProperties(block.stateKey)[key];
}

// --- Block-entity (NBT) helpers ---------------------------------------------

function scalarToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function beField(entity: NbtCompound | undefined, ...keys: string[]): unknown {
  if (!entity) return undefined;
  for (const key of keys) {
    const value = entity[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function beString(entity: NbtCompound | undefined, ...keys: string[]): string | undefined {
  const value = beField(entity, ...keys);
  if (value === undefined) return undefined;
  const text = scalarToString(value).trim();
  return text === '' ? undefined : text;
}

function be3(entity: NbtCompound | undefined, kx: string, ky: string, kz: string, sep = ' × '): string | undefined {
  const x = beString(entity, kx);
  const y = beString(entity, ky);
  const z = beString(entity, kz);
  if (x === undefined && y === undefined && z === undefined) return undefined;
  return `${x ?? '?'}${sep}${y ?? '?'}${sep}${z ?? '?'}`;
}

/** Turns a namespaced id into a readable label, e.g. `minecraft:stone_bricks` -> `Stone Bricks`. */
function prettyId(id: string): string {
  const short = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  return short
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function entries(pairs: Array<[string, string | undefined]>): AuditMetadataEntry[] {
  const out: AuditMetadataEntry[] = [];
  for (const [label, value] of pairs) {
    if (value !== undefined && value !== '') out.push({ label, value });
  }
  return out;
}

// --- Category-specific extractors -------------------------------------------

function infestedBaseBlock(name: string): string {
  return name.replace('minecraft:infested_', 'minecraft:');
}

function commandBlockType(name: string): string {
  if (name === 'minecraft:chain_command_block') return 'Chain';
  if (name === 'minecraft:repeating_command_block') return 'Repeating';
  return 'Impulse';
}

function commandTrigger(block: VoxelBlock): string {
  const auto = beField(block.blockEntity, 'auto');
  const isAuto = auto === 1 || auto === true || auto === 1n || scalarToString(auto) === '1';
  return isAuto ? 'Always active' : 'Needs redstone';
}

const BEACON_EFFECTS: Record<string, string> = {
  '1': 'Speed',
  '3': 'Haste',
  '5': 'Strength',
  '8': 'Jump Boost',
  '10': 'Regeneration',
  '11': 'Resistance',
};

function effectLabel(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    return raw.trim() === '' ? undefined : prettyId(raw);
  }
  const key = scalarToString(raw);
  if (key === '' || key === '0' || key === '-1') return undefined;
  return BEACON_EFFECTS[key] ?? `Effect #${key}`;
}

function customName(entity: NbtCompound | undefined): string | undefined {
  return beString(entity, 'CustomName', 'custom_name');
}

function spawnerEntity(entity: NbtCompound | undefined): string | undefined {
  if (!entity) return undefined;
  const spawnData = beField(entity, 'SpawnData', 'spawn_data');
  if (isCompound(spawnData)) {
    const inner = beField(spawnData, 'entity', 'Entity');
    if (isCompound(inner)) {
      const id = beString(inner, 'id', 'Id');
      if (id) return prettyId(id);
    }
    const id = beString(spawnData, 'id', 'Id');
    if (id) return prettyId(id);
  }
  return undefined;
}

function exitCoords(entity: NbtCompound | undefined): string | undefined {
  if (!entity) return undefined;
  const exit = beField(entity, 'ExitPortal', 'exit_portal');
  if (isCompound(exit)) {
    const x = beString(exit, 'X', 'x');
    const y = beString(exit, 'Y', 'y');
    const z = beString(exit, 'Z', 'z');
    if (x !== undefined || y !== undefined || z !== undefined) {
      return `${x ?? '?'}, ${y ?? '?'}, ${z ?? '?'}`;
    }
  }
  return undefined;
}

// --- Registry ----------------------------------------------------------------

export const AUDIT_CATEGORIES: AuditCategory[] = [
  {
    id: 'command_block',
    label: 'Command blocks',
    description: 'Run console commands. Often left in shared builds and can fire automatically.',
    group: 'core',
    match: (b) =>
      b.name === 'minecraft:command_block'
      || b.name === 'minecraft:chain_command_block'
      || b.name === 'minecraft:repeating_command_block',
    recommendedReplacement: () => 'minecraft:stone',
    recommendedLabel: 'Stone',
    metadata: (b) => entries([
      ['Type', commandBlockType(b.name)],
      ['Command', beString(b.blockEntity, 'Command', 'command')],
      ['Trigger', commandTrigger(b)],
      ['Conditional', prop(b, 'conditional') === 'true' ? 'Yes' : undefined],
      ['Custom name', customName(b.blockEntity)],
    ]),
  },
  {
    id: 'structure_block',
    label: 'Structure blocks',
    description: 'Save and load named structures. Carry a structure name, size and offset.',
    group: 'core',
    match: (b) => b.name === 'minecraft:structure_block',
    recommendedReplacement: () => 'minecraft:stone',
    recommendedLabel: 'Stone',
    metadata: (b) => entries([
      ['Mode', beString(b.blockEntity, 'mode') ?? prop(b, 'mode')],
      ['Structure name', beString(b.blockEntity, 'name')],
      ['Size', be3(b.blockEntity, 'sizeX', 'sizeY', 'sizeZ')],
      ['Offset', be3(b.blockEntity, 'posX', 'posY', 'posZ', ', ')],
      ['Integrity', beString(b.blockEntity, 'integrity')],
      ['Rotation', beString(b.blockEntity, 'rotation')],
      ['Mirror', beString(b.blockEntity, 'mirror')],
    ]),
  },
  {
    id: 'spawner',
    label: 'Spawners',
    description: 'Monster spawners and trial spawners. They spawn mobs near players.',
    group: 'extra',
    match: (b) => b.name === 'minecraft:spawner' || b.name === 'minecraft:trial_spawner',
    recommendedReplacement: () => 'minecraft:air',
    recommendedLabel: 'Air',
    metadata: (b) => entries([
      ['Type', b.name === 'minecraft:trial_spawner' ? 'Trial spawner' : 'Monster spawner'],
      ['Spawns', spawnerEntity(b.blockEntity)],
      ['Spawn count', beString(b.blockEntity, 'SpawnCount')],
      ['Player range', beString(b.blockEntity, 'RequiredPlayerRange')],
    ]),
  },
  {
    id: 'beacon',
    label: 'Beacons',
    description: 'Grant area effects and project a light beam to the sky over a mineral pyramid.',
    group: 'core',
    match: (b) => b.name === 'minecraft:beacon',
    recommendedReplacement: () => 'minecraft:air',
    recommendedLabel: 'Air',
    metadata: (b) => entries([
      ['Primary effect', effectLabel(beField(b.blockEntity, 'primary_effect', 'Primary'))],
      ['Secondary effect', effectLabel(beField(b.blockEntity, 'secondary_effect', 'Secondary'))],
      ['Pyramid levels', beString(b.blockEntity, 'Levels', 'levels')],
      ['Custom name', customName(b.blockEntity)],
    ]),
  },
  {
    id: 'light',
    label: 'Light blocks',
    description: 'Invisible light sources. They emit light but render as nothing in-game.',
    group: 'core',
    match: (b) => b.name === 'minecraft:light',
    recommendedReplacement: () => 'minecraft:air',
    recommendedLabel: 'Air',
    metadata: (b) => entries([['Light level', prop(b, 'level') ?? '15']]),
  },
  {
    id: 'barrier',
    label: 'Barriers',
    description: "Invisible, indestructible walls players can't see or break in survival.",
    group: 'core',
    match: (b) => b.name === 'minecraft:barrier',
    recommendedReplacement: () => 'minecraft:glass',
    recommendedLabel: 'Glass',
    metadata: () => [{ label: 'Type', value: 'Invisible solid barrier' }],
  },
  {
    id: 'infested',
    label: 'Infested blocks',
    description: 'Look identical to normal blocks but release silverfish when broken.',
    group: 'core',
    match: (b) => b.name.startsWith('minecraft:infested_'),
    recommendedReplacement: (b) => infestedBaseBlock(b.name),
    recommendedLabel: 'Matching base block',
    perBlockRecommendation: true,
    metadata: (b) => entries([['Disguised as', prettyId(infestedBaseBlock(b.name))]]),
  },
  {
    id: 'bubble_column',
    label: 'Bubble columns',
    description: 'Water currents from magma or soul sand, often left behind by deleted blocks.',
    group: 'core',
    match: (b) => b.name === 'minecraft:bubble_column',
    recommendedReplacement: () => 'minecraft:water',
    recommendedLabel: 'Water',
    metadata: (b) => entries([
      ['Current', prop(b, 'drag') === 'true' ? 'Downward (magma block)' : 'Upward (soul sand)'],
    ]),
  },
  {
    id: 'nether_portal',
    label: 'Nether portals',
    description: 'Active portal blocks that teleport entities standing in them.',
    group: 'core',
    match: (b) => b.name === 'minecraft:nether_portal',
    recommendedReplacement: () => 'minecraft:air',
    recommendedLabel: 'Air',
    metadata: (b) => entries([['Axis', prop(b, 'axis')]]),
  },
  {
    id: 'end_portal',
    label: 'End portals & gateways',
    description: 'Teleport blocks. End gateways also store an exit destination.',
    group: 'extra',
    match: (b) => b.name === 'minecraft:end_portal' || b.name === 'minecraft:end_gateway',
    recommendedReplacement: () => 'minecraft:air',
    recommendedLabel: 'Air',
    metadata: (b) => entries([
      ['Type', b.name === 'minecraft:end_gateway' ? 'End gateway' : 'End portal'],
      ['Age (ticks)', beString(b.blockEntity, 'Age', 'age')],
      ['Exit', exitCoords(b.blockEntity)],
    ]),
  },
  {
    id: 'jigsaw',
    label: 'Jigsaw blocks',
    description: 'Worldgen connectors that assemble structures from template pools.',
    group: 'extra',
    match: (b) => b.name === 'minecraft:jigsaw',
    recommendedReplacement: () => 'minecraft:stone',
    recommendedLabel: 'Stone',
    metadata: (b) => entries([
      ['Name', beString(b.blockEntity, 'name')],
      ['Target', beString(b.blockEntity, 'target')],
      ['Pool', beString(b.blockEntity, 'pool')],
      ['Final state', beString(b.blockEntity, 'final_state')],
      ['Joint', beString(b.blockEntity, 'joint')],
    ]),
  },
  {
    id: 'sculk_shrieker',
    label: 'Sculk shriekers',
    description: 'Trigger darkness and can summon the Warden when set to natural.',
    group: 'extra',
    match: (b) => b.name === 'minecraft:sculk_shrieker',
    recommendedReplacement: () => 'minecraft:sculk',
    recommendedLabel: 'Sculk',
    metadata: (b) => entries([
      ['Can summon Warden', prop(b, 'can_summon') === 'true' ? 'Yes' : 'No'],
      ['Shrieking', prop(b, 'shrieking') === 'true' ? 'Yes' : undefined],
    ]),
  },
  {
    id: 'piston',
    label: 'Piston heads & moving pistons',
    description: "Technical blocks created mid-extension that shouldn't exist on their own.",
    group: 'core',
    match: (b) => b.name === 'minecraft:piston_head' || b.name === 'minecraft:moving_piston',
    recommendedReplacement: () => 'minecraft:air',
    recommendedLabel: 'Air',
    metadata: (b) => entries([
      ['Block', b.name === 'minecraft:moving_piston' ? 'Moving piston' : 'Piston head'],
      ['Facing', prop(b, 'facing')],
      ['Type', prop(b, 'type')],
      ['Short', prop(b, 'short')],
    ]),
  },
  {
    id: 'structure_void',
    label: 'Structure void',
    description: 'Invisible markers used by structure blocks to skip positions.',
    group: 'extra',
    match: (b) => b.name === 'minecraft:structure_void',
    recommendedReplacement: () => 'minecraft:air',
    recommendedLabel: 'Air',
    metadata: () => [{ label: 'Type', value: 'Invisible structure marker' }],
  },
];

/** Scans the model once and returns one finding per non-empty category, in registry order. */
export function runAudit(model: SchematicModel): AuditFinding[] {
  const findings: AuditFinding[] = AUDIT_CATEGORIES.map((category) => ({ category, occurrences: [] }));
  for (const block of model.blocks) {
    for (const finding of findings) {
      if (finding.category.match(block)) {
        finding.occurrences.push(block);
        break;
      }
    }
  }
  return findings.filter((finding) => finding.occurrences.length > 0);
}

// --- Raw NBT display ---------------------------------------------------------

export interface NbtDisplayNode {
  key: string;
  type: string;
  value?: string;
  children?: NbtDisplayNode[];
}

function nbtNode(key: string, value: unknown): NbtDisplayNode {
  if (typeof value === 'string') return { key, type: 'string', value };
  if (typeof value === 'bigint') return { key, type: 'long', value: value.toString() };
  if (typeof value === 'number') {
    return { key, type: Number.isInteger(value) ? 'int' : 'double', value: String(value) };
  }
  if (typeof value === 'boolean') return { key, type: 'byte', value: value ? '1' : '0' };
  if (value instanceof Int8Array || value instanceof Uint8Array) {
    return { key, type: `byte[${value.length}]`, value: `[${value.length} bytes]` };
  }
  if (value instanceof Int32Array) {
    return { key, type: `int[${value.length}]`, value: `[${Array.from(value).join(', ')}]` };
  }
  if (value instanceof BigInt64Array) {
    return { key, type: `long[${value.length}]`, value: `[${value.length} longs]` };
  }
  if (Array.isArray(value)) {
    return { key, type: `list(${value.length})`, children: value.map((item, i) => nbtNode(String(i), item)) };
  }
  if (isCompound(value)) {
    return { key, type: 'compound', children: Object.entries(value).map(([k, v]) => nbtNode(k, v)) };
  }
  return { key, type: 'unknown', value: String(value) };
}

/** Builds a renderable tree of every field in a block-entity compound. */
export function describeNbt(compound: NbtCompound): NbtDisplayNode[] {
  return Object.entries(compound).map(([key, value]) => nbtNode(key, value));
}
