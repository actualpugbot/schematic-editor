export type ModelFaceName = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';

export interface BlockStateInfo {
  id: string;
  properties: Record<string, string>;
}

export interface ResolvedBlockPart {
  key: string;
  blockId: string;
  blockProperties: Record<string, string>;
  from: [number, number, number];
  to: [number, number, number];
  textureSize?: [number, number];
  shade: boolean;
  isFallback?: boolean;
  elementRotation?: ModelElementRotation;
  uvLock: boolean;
  variantRotation: {
    x: number;
    y: number;
  };
  faceTextures: Record<ModelFaceName, string | null>;
  faceTints: Record<ModelFaceName, number | null>;
  faceUvs: Record<ModelFaceName, ModelFaceUv | null>;
  faceRotations: Record<ModelFaceName, number>;
  faceCullfaces: Record<ModelFaceName, ModelFaceName | null>;
  faceTranslucencies: Record<ModelFaceName, boolean>;
  // Per-corner top-surface heights in px [nw, ne, sw, se] for sloped fluids.
  // When set, the renderer lifts the top vertices of the up/side faces to these
  // heights so flowing water/lava tilts down away from its source. Computed from
  // neighbouring fluid by the scene builder, so it lives outside resolveBlockParts.
  fluidCorners?: [number, number, number, number];
}

interface BlockstateJson {
  variants?: Record<string, BlockstateVariant | BlockstateVariant[]>;
  multipart?: MultipartRule[];
}

interface BlockstateVariant {
  model: string;
  x?: number;
  y?: number;
  uvlock?: boolean;
}

interface MultipartRule {
  when?: MultipartWhen;
  apply: BlockstateVariant | BlockstateVariant[];
}

type MultipartWhen =
  | Record<string, string | MultipartWhen[]>
  | {
      OR: MultipartWhen[];
      AND?: never;
    }
  | {
      AND: MultipartWhen[];
      OR?: never;
    };

interface ModelJson {
  parent?: string;
  textures?: Record<string, TextureReference>;
  elements?: ModelElement[];
}

interface ResolvedModel {
  textures: Record<string, string | null>;
  elements: ModelElement[];
}

interface ModelElement {
  from: [number, number, number];
  to: [number, number, number];
  shade?: boolean;
  rotation?: ModelElementRotation;
  faces?: Partial<Record<ModelFaceName, ModelFace>>;
}

export interface ModelElementRotation {
  origin: [number, number, number];
  axis: 'x' | 'y' | 'z';
  angle: number;
  rescale?: boolean;
}

interface ModelFace {
  uv?: ModelFaceUv;
  texture?: TextureReference;
  rotation?: number;
  tintindex?: number;
  cullface?: ModelFaceName;
}

type TextureReference =
  | string
  | {
      sprite?: string;
      force_translucent?: boolean;
    };
export type ModelFaceUv = [number, number, number, number];

const assetRoot = `${import.meta.env.BASE_URL}minecraft-assets/assets/minecraft`;
const playerHeadTexturePrefix = 'SchematicEditor:entity/player/head/';
const endPortalTextureId = 'SchematicEditor:block/end_portal';
const solidTexturePrefix = 'SchematicEditor:block/solid/';
const blockstateCache = new Map<string, Promise<BlockstateJson | null>>();
const modelCache = new Map<string, Promise<ModelJson | null>>();
const resolvedModelCache = new Map<string, Promise<ResolvedModel | null>>();
const resolvedBlockCache = new Map<string, Promise<ResolvedBlockPart[]>>();
const resolvedInventoryCache = new Map<string, Promise<ResolvedBlockPart[]>>();
const defaultPlayerSkinSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="crispEdges">
  <rect width="64" height="64" fill="none"/>
  <rect x="0" y="8" width="8" height="8" fill="#c68655"/>
  <rect x="8" y="8" width="8" height="8" fill="#d69a6a"/>
  <rect x="16" y="8" width="8" height="8" fill="#b97849"/>
  <rect x="24" y="8" width="8" height="8" fill="#8f5433"/>
  <rect x="8" y="0" width="8" height="8" fill="#6a3d25"/>
  <rect x="16" y="0" width="8" height="8" fill="#b97849"/>
  <rect x="8" y="8" width="8" height="2" fill="#5a3420"/>
  <rect x="9" y="11" width="2" height="2" fill="#2b2f35"/>
  <rect x="13" y="11" width="2" height="2" fill="#2b2f35"/>
  <rect x="11" y="14" width="3" height="1" fill="#7c3f35"/>
  <rect x="32" y="8" width="8" height="8" fill="#4d2e1d" opacity=".95"/>
  <rect x="40" y="8" width="8" height="8" fill="#5a3420" opacity=".95"/>
  <rect x="48" y="8" width="8" height="8" fill="#4a2a1a" opacity=".95"/>
  <rect x="56" y="8" width="8" height="8" fill="#3b2115" opacity=".95"/>
  <rect x="40" y="0" width="8" height="8" fill="#4d2e1d" opacity=".95"/>
  <rect x="48" y="0" width="8" height="8" fill="#2f1a10" opacity=".95"/>
  <rect x="40" y="8" width="8" height="3" fill="#2f1a10" opacity=".95"/>
</svg>`.trim();
// The end portal/gateway have no block model; vanilla draws them with a
// star-field shader. We can't reproduce the shader, so approximate it with a
// dark star-field tile that reads as "deep space" rather than a missing block.
const endPortalSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges">
  <rect width="16" height="16" fill="#0a0a18"/>
  <rect x="1" y="2" width="1" height="1" fill="#c9bdff"/>
  <rect x="4" y="0" width="1" height="1" fill="#ffffff" opacity=".8"/>
  <rect x="6" y="3" width="1" height="1" fill="#8fd6ff"/>
  <rect x="9" y="1" width="1" height="1" fill="#ffffff"/>
  <rect x="12" y="2" width="1" height="1" fill="#b7a6ff" opacity=".9"/>
  <rect x="14" y="4" width="1" height="1" fill="#ffffff" opacity=".7"/>
  <rect x="2" y="6" width="1" height="1" fill="#9ad7ff" opacity=".8"/>
  <rect x="7" y="7" width="1" height="1" fill="#ffffff"/>
  <rect x="11" y="6" width="1" height="1" fill="#d3c6ff" opacity=".85"/>
  <rect x="0" y="10" width="1" height="1" fill="#ffffff" opacity=".7"/>
  <rect x="5" y="11" width="1" height="1" fill="#a9c4ff"/>
  <rect x="9" y="10" width="1" height="1" fill="#ffffff" opacity=".85"/>
  <rect x="13" y="9" width="1" height="1" fill="#bca7ff"/>
  <rect x="3" y="14" width="1" height="1" fill="#ffffff" opacity=".75"/>
  <rect x="8" y="13" width="1" height="1" fill="#8fd6ff" opacity=".9"/>
  <rect x="12" y="14" width="1" height="1" fill="#ffffff" opacity=".8"/>
  <rect x="15" y="12" width="1" height="1" fill="#cabfff" opacity=".8"/>
</svg>`.trim();

// Lit candles wear an animated flame particle in-game, which a still schematic
// can't reproduce. Approximate it with a small emissive teardrop flame. The
// `_emissive` suffix makes both render pipelines treat it as a glowing texture.
const candleFlameTextureId = 'SchematicEditor:block/candle_flame_emissive';
const candleFlameSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <path d="M8 1 C 12 5 13 9 12 12 C 11 15.5 5 15.5 4 12 C 3 9.5 4 5.5 8 1 Z" fill="#ff7a16"/>
  <path d="M8 4 C 10.6 6.5 10.9 9.6 10 12 C 9.3 14 6.7 14 6 12 C 5.1 9.8 5.7 7 8 4 Z" fill="#ffce33"/>
  <ellipse cx="8" cy="11.7" rx="1.7" ry="2.3" fill="#fff4b8"/>
</svg>`.trim();

export function parseBlockStateKey(stateKey: string): BlockStateInfo {
  const match = /^(?<id>[^\[]+)(?:\[(?<properties>.*)\])?$/.exec(stateKey);
  const id = match?.groups?.id || stateKey;
  const properties: Record<string, string> = {};
  const rawProperties = match?.groups?.properties;

  if (rawProperties) {
    for (const pair of rawProperties.split(',')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        properties[key] = value;
      }
    }
  }

  const normalizedId = normalizeResourceId(id);
  return { id: normalizedId, properties: defaultBlockProperties(normalizedId, properties) };
}

function defaultBlockProperties(id: string, properties: Record<string, string>): Record<string, string> {
  if (isCropBlock(id)) {
    return {
      age: defaultCropAge(id),
      ...properties,
    };
  }

  if (isChainBlock(id)) {
    return {
      axis: 'y',
      ...properties,
    };
  }

  if (isAxisBlock(id)) {
    return {
      axis: 'y',
      ...properties,
    };
  }

  if (isStairsBlock(id)) {
    return {
      facing: 'west',
      half: 'bottom',
      shape: 'straight',
      ...properties,
    };
  }

  if (isSlabBlock(id)) {
    return {
      type: 'bottom',
      ...properties,
    };
  }

  if (isDoorBlock(id)) {
    return {
      facing: 'south',
      half: 'lower',
      hinge: 'left',
      open: 'false',
      ...properties,
    };
  }

  if (isTrapdoorBlock(id)) {
    return {
      facing: 'south',
      half: 'bottom',
      open: 'false',
      ...properties,
    };
  }

  if (isFenceGateBlock(id)) {
    return {
      facing: 'east',
      in_wall: 'false',
      open: 'false',
      ...properties,
    };
  }

  if (isButtonBlock(id)) {
    return {
      face: 'floor',
      facing: 'north',
      powered: 'false',
      ...properties,
    };
  }

  if (isWeightedPressurePlateBlock(id)) {
    return {
      power: '0',
      ...properties,
    };
  }

  if (isPressurePlateBlock(id)) {
    return {
      powered: 'false',
      ...properties,
    };
  }

  if (isWallBlock(id)) {
    return {
      east: 'none',
      north: 'none',
      south: 'none',
      up: 'true',
      west: 'none',
      ...properties,
    };
  }

  if (isPaneBlock(id)) {
    return {
      east: 'false',
      north: 'false',
      south: 'false',
      west: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:repeater') {
    return {
      delay: '1',
      facing: 'north',
      locked: 'false',
      powered: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:comparator') {
    return {
      facing: 'north',
      mode: 'compare',
      powered: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:lever') {
    return {
      face: 'floor',
      facing: 'north',
      powered: 'false',
      ...properties,
    };
  }

  if (isRailBlock(id)) {
    return {
      shape: 'east_west',
      ...(isPoweredRailBlock(id) ? { powered: 'false' } : {}),
      ...properties,
    };
  }

  if (id === 'minecraft:redstone_wire') {
    return {
      east: 'none',
      north: 'none',
      power: '0',
      south: 'none',
      west: 'none',
      ...properties,
    };
  }

  if (isPistonBlock(id)) {
    return {
      extended: 'false',
      facing: 'south',
      ...properties,
    };
  }

  if (isCandleBlock(id)) {
    return {
      candles: '1',
      lit: 'false',
      ...properties,
    };
  }

  if (isCandleCakeBlock(id)) {
    return {
      lit: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:farmland') {
    return {
      moisture: '7',
      ...properties,
    };
  }

  if (id === 'minecraft:snow') {
    return {
      layers: '1',
      ...properties,
    };
  }

  if (isLeveledCauldronBlock(id)) {
    return {
      level: '3',
      ...properties,
    };
  }

  if (id === 'minecraft:daylight_detector') {
    return {
      inverted: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:bamboo') {
    return {
      age: '1',
      leaves: 'large',
      ...properties,
    };
  }

  if (isDecorativeLanternBlock(id)) {
    return {
      hanging: 'false',
      ...properties,
    };
  }

  if (isFurnaceLikeBlock(id)) {
    return {
      facing: 'south',
      lit: 'false',
      ...properties,
    };
  }

  if (isChestBlock(id)) {
    return {
      facing: 'east',
      type: 'single',
      waterlogged: 'false',
      ...properties,
    };
  }

  if (isCampfireBlock(id)) {
    return {
      facing: 'south',
      lit: 'true',
      ...properties,
    };
  }

  if (id === 'minecraft:barrel') {
    return {
      facing: 'up',
      open: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:tripwire_hook') {
    return {
      attached: 'false',
      facing: 'north',
      powered: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:scaffolding') {
    return {
      bottom: 'false',
      distance: '0',
      ...properties,
    };
  }

  if (id === 'minecraft:bell') {
    return {
      attachment: 'floor',
      facing: 'north',
      ...properties,
    };
  }

  if (isLightningRodBlock(id)) {
    return {
      facing: 'up',
      powered: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:end_portal_frame') {
    return {
      eye: 'false',
      facing: 'south',
      ...properties,
    };
  }

  if (id === 'minecraft:respawn_anchor') {
    return {
      charges: '4',
      ...properties,
    };
  }

  if (isAnvilBlock(id)) {
    return {
      facing: 'east',
      ...properties,
    };
  }

  if (id === 'minecraft:grindstone') {
    return {
      face: 'floor',
      facing: 'east',
      ...properties,
    };
  }

  if (id === 'minecraft:lectern' || id === 'minecraft:stonecutter' || id === 'minecraft:loom') {
    return {
      facing: 'south',
      ...properties,
    };
  }

  if (id === 'minecraft:sculk_sensor') {
    return {
      sculk_sensor_phase: 'inactive',
      ...properties,
    };
  }

  if (id === 'minecraft:calibrated_sculk_sensor') {
    return {
      facing: 'north',
      sculk_sensor_phase: 'inactive',
      ...properties,
    };
  }

  if (isHiveBlock(id)) {
    return {
      facing: 'south',
      honey_level: '0',
      ...properties,
    };
  }

  if (id === 'minecraft:cake') {
    return {
      bites: '0',
      ...properties,
    };
  }

  if (id === 'minecraft:cocoa') {
    return {
      age: '2',
      facing: 'south',
      ...properties,
    };
  }

  if (isShelfBlock(id)) {
    return {
      facing: 'south',
      powered: 'false',
      ...properties,
    };
  }

  if (isWallSignBlock(id) || isWallHangingSignBlock(id)) {
    return {
      facing: 'east',
      waterlogged: 'false',
      ...properties,
    };
  }

  if (isStandingSignBlock(id) || isHangingSignBlock(id)) {
    return {
      attached: 'false',
      rotation: '4',
      waterlogged: 'false',
      ...properties,
    };
  }

  if (isWallCoralFanBlock(id)) {
    return {
      facing: 'north',
      ...properties,
    };
  }

  if (isWallTorchBlock(id)) {
    return {
      facing: 'north',
      ...(id === 'minecraft:redstone_wall_torch' ? { lit: 'true' } : {}),
      ...properties,
    };
  }

  if (id === 'minecraft:redstone_torch') {
    return {
      lit: 'true',
      ...properties,
    };
  }

  if (isCrystalBudBlock(id)) {
    return {
      facing: 'up',
      ...properties,
    };
  }

  if (id === 'minecraft:end_rod' || id === 'minecraft:ladder') {
    return {
      facing: id === 'minecraft:end_rod' ? 'up' : 'east',
      ...properties,
    };
  }

  if (isFacingBlock(id)) {
    return {
      facing: 'south',
      ...properties,
    };
  }

  if (isObserverBlock(id)) {
    return {
      facing: 'south',
      powered: 'false',
      ...properties,
    };
  }

  if (isCommandBlock(id)) {
    return {
      conditional: 'false',
      facing: 'north',
      ...properties,
    };
  }

  if (isCopperBulbBlock(id)) {
    return {
      lit: 'false',
      powered: 'false',
      ...properties,
    };
  }

  if (isGlazedTerracottaBlock(id)) {
    return {
      facing: 'south',
      ...properties,
    };
  }

  if (isTallPlantBlock(id)) {
    return {
      half: 'lower',
      ...properties,
    };
  }

  if (id === 'minecraft:wildflowers') {
    return {
      facing: 'north',
      flower_amount: '4',
      ...properties,
    };
  }

  if (id === 'minecraft:pink_petals') {
    return {
      facing: 'north',
      flower_amount: '4',
      ...properties,
    };
  }

  if (isStemCropBlock(id)) {
    return {
      age: defaultStemCropAge(id),
      ...properties,
    };
  }

  if (id === 'minecraft:pitcher_crop') {
    return {
      age: '4',
      half: 'lower',
      ...properties,
    };
  }

  if (id === 'minecraft:chorus_flower') {
    return {
      age: '4',
      ...properties,
    };
  }

  if (id === 'minecraft:mycelium' || id === 'minecraft:grass_block') {
    return {
      snowy: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:mushroom_stem' || id === 'minecraft:red_mushroom_block' || id === 'minecraft:brown_mushroom_block') {
    return {
      down: 'true',
      east: 'true',
      north: 'true',
      south: 'true',
      up: 'true',
      west: 'true',
      ...properties,
    };
  }

  if (id === 'minecraft:pale_moss_carpet') {
    return {
      bottom: 'true',
      east: 'none',
      north: 'none',
      south: 'none',
      west: 'none',
      ...properties,
    };
  }

  if (id === 'minecraft:trial_spawner') {
    return {
      ominous: 'false',
      trial_spawner_state: 'active',
      ...properties,
    };
  }

  if (id === 'minecraft:vault') {
    return {
      facing: 'south',
      ominous: 'false',
      vault_state: 'active',
      ...properties,
    };
  }

  if (id === 'minecraft:hopper') {
    return {
      facing: 'east',
      ...properties,
    };
  }

  if (id === 'minecraft:sculk_shrieker') {
    return {
      can_summon: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:sculk_catalyst') {
    return {
      bloom: 'false',
      ...properties,
    };
  }

  if (isAttachedStemBlock(id)) {
    return {
      facing: 'west',
      ...properties,
    };
  }

  if (id === 'minecraft:fire') {
    return {
      east: 'false',
      north: 'false',
      south: 'false',
      up: 'false',
      west: 'false',
      ...properties,
    };
  }

  if (isFlatAttachmentBlock(id)) {
    return {
      down: 'false',
      east: 'false',
      north: 'false',
      south: 'false',
      up: 'false',
      west: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:tripwire') {
    return {
      attached: 'false',
      east: 'false',
      north: 'false',
      south: 'false',
      west: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:big_dripleaf') {
    return {
      facing: 'north',
      tilt: 'none',
      ...properties,
    };
  }

  if (id === 'minecraft:big_dripleaf_stem') {
    return {
      facing: 'north',
      ...properties,
    };
  }

  if (id === 'minecraft:small_dripleaf') {
    return {
      facing: 'north',
      half: 'lower',
      ...properties,
    };
  }

  if (id === 'minecraft:mangrove_propagule') {
    return {
      age: '4',
      hanging: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:sea_pickle') {
    return {
      pickles: '4',
      waterlogged: 'true',
      ...properties,
    };
  }

  if (id === 'minecraft:leaf_litter') {
    return {
      facing: 'north',
      segment_amount: '4',
      ...properties,
    };
  }

  if (id === 'minecraft:pale_hanging_moss') {
    return {
      tip: 'true',
      ...properties,
    };
  }

  if (id === 'minecraft:pointed_dripstone') {
    return {
      thickness: 'tip',
      vertical_direction: 'up',
      ...properties,
    };
  }

  if (id === 'minecraft:sweet_berry_bush') {
    return {
      age: '3',
      ...properties,
    };
  }

  if (id === 'minecraft:torchflower_crop') {
    return {
      age: '1',
      ...properties,
    };
  }

  if (id === 'minecraft:redstone_lamp') {
    return {
      lit: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:turtle_egg') {
    return {
      eggs: '1',
      hatch: '0',
      ...properties,
    };
  }

  if (id === 'minecraft:chiseled_bookshelf') {
    return {
      facing: 'south',
      slot_0_occupied: 'true',
      slot_1_occupied: 'true',
      slot_2_occupied: 'true',
      slot_3_occupied: 'true',
      slot_4_occupied: 'true',
      slot_5_occupied: 'true',
      ...properties,
    };
  }

  return properties;
}

function isStairsBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_stairs');
}

function isCropBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return (
    path === 'wheat' ||
    path === 'carrots' ||
    path === 'potatoes' ||
    path === 'beetroots' ||
    path === 'nether_wart'
  );
}

function defaultCropAge(id: string): string {
  switch (id.replace(/^minecraft:/, '')) {
    case 'beetroots':
    case 'nether_wart':
      return '3';
    default:
      return '7';
  }
}

function isSlabBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_slab');
}

function isAxisBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return (
    path === 'bamboo_block' ||
    path === 'stripped_bamboo_block' ||
    path === 'bone_block' ||
    path === 'basalt' ||
    path === 'deepslate' ||
    path === 'infested_deepslate' ||
    path === 'polished_basalt' ||
    path === 'hay_block' ||
    path === 'purpur_pillar' ||
    path === 'quartz_pillar' ||
    path.endsWith('_froglight') ||
    path.endsWith('_log') ||
    path.endsWith('_wood') ||
    path.endsWith('_stem') ||
    path.endsWith('_hyphae')
  );
}

function isDoorBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path.endsWith('_door') && !path.endsWith('_trapdoor');
}

function isTrapdoorBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_trapdoor');
}

function isFenceGateBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_fence_gate');
}

function isButtonBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_button');
}

function isPressurePlateBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_pressure_plate');
}

function isWeightedPressurePlateBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'light_weighted_pressure_plate' || path === 'heavy_weighted_pressure_plate';
}

function isWallBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_wall');
}

function isPaneBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path.endsWith('_pane') || path.endsWith('_bars');
}

function isRailBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'rail' || path.endsWith('_rail');
}

function isPoweredRailBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'powered_rail' || path === 'detector_rail' || path === 'activator_rail';
}

function isPistonBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'piston' || path === 'sticky_piston';
}

function isAnvilBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'anvil' || path === 'chipped_anvil' || path === 'damaged_anvil';
}

function isCandleBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'candle' || path.endsWith('_candle');
}

function isCandleCakeBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_candle_cake') || id === 'minecraft:candle_cake';
}

function isLeveledCauldronBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'water_cauldron' || path === 'powder_snow_cauldron';
}

function isFurnaceLikeBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'furnace' || path === 'blast_furnace' || path === 'smoker';
}

function isCampfireBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'campfire' || path === 'soul_campfire';
}

function isLightningRodBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('lightning_rod');
}

function isHiveBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'beehive' || path === 'bee_nest';
}

function isShelfBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_shelf');
}

function isWallCoralFanBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_coral_wall_fan');
}

function isWallTorchBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return (
    path === 'wall_torch' ||
    path === 'redstone_wall_torch' ||
    path === 'soul_wall_torch' ||
    path === 'copper_wall_torch'
  );
}

function isGlazedTerracottaBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_glazed_terracotta');
}

function isCrystalBudBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return (
    path === 'amethyst_cluster' ||
    path === 'large_amethyst_bud' ||
    path === 'medium_amethyst_bud' ||
    path === 'small_amethyst_bud'
  );
}

function isTallPlantBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return (
    path === 'lilac' ||
    path === 'peony' ||
    path === 'sunflower' ||
    path === 'rose_bush' ||
    path === 'large_fern' ||
    path === 'tall_grass' ||
    path === 'tall_seagrass'
  );
}

function isStemCropBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'melon_stem' || path === 'pumpkin_stem';
}

function defaultStemCropAge(id: string): string {
  const path = id.replace(/^minecraft:/, '');
  return path === 'torchflower_crop' ? '1' : '7';
}

function isAttachedStemBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'attached_melon_stem' || path === 'attached_pumpkin_stem';
}

function isFlatAttachmentBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return (
    path === 'vine' ||
    path === 'glow_lichen' ||
    path === 'sculk_vein' ||
    path === 'resin_clump'
  );
}

function isFacingBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return (
    path === 'dispenser' ||
    path === 'dropper' ||
    path === 'carved_pumpkin' ||
    path === 'jack_o_lantern'
  );
}

function isObserverBlock(id: string): boolean {
  return id === 'minecraft:observer';
}

function isCommandBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'command_block' || path === 'chain_command_block' || path === 'repeating_command_block';
}

function isCopperBulbBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('copper_bulb');
}

function isLanternBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'lantern' || path.endsWith('_lantern');
}

function isDecorativeLanternBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path !== 'sea_lantern' && path !== 'jack_o_lantern' && isLanternBlock(id);
}

function isChainBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'chain' || path.endsWith('_chain');
}

export async function resolveBlockParts(stateKey: string): Promise<ResolvedBlockPart[]> {
  const cached = resolvedBlockCache.get(stateKey);
  if (cached) return cached;

  const promise = resolveBlockPartsUncached(stateKey);
  resolvedBlockCache.set(stateKey, promise);
  return promise;
}

async function resolveBlockPartsUncached(stateKey: string): Promise<ResolvedBlockPart[]> {
  const state = parseBlockStateKey(stateKey);

  const blockstate = await loadBlockstate(state.id);
  if (!blockstate) {
    if (isRenderlessVanillaModelBlock(state.id)) return [];
    return [fallbackPart(state.id, { x: 0, y: 0 })];
  }

  const variants = selectVariants(blockstate, state.properties);
  if (variants.length === 0) {
    if (isRenderlessVanillaModelBlock(state.id)) return [];
    return [fallbackPart(state.id, { x: 0, y: 0 })];
  }

  const parts: ResolvedBlockPart[] = [];

  for (const variant of variants) {
    const model = await resolveModel(variant.model);
    if (!model || model.elements.length === 0) {
      const blockEntityParts = specialBlockEntityParts(state.id, state.properties, {
        x: variant.x ?? 0,
        y: variant.y ?? 0,
      });
      if (blockEntityParts.length > 0) {
        parts.push(...blockEntityParts);
        continue;
      }

      const syntheticParts = syntheticBlockParts(state.id, state.properties, { x: variant.x ?? 0, y: variant.y ?? 0 });
      if (syntheticParts.length > 0) {
        parts.push(...syntheticParts);
        continue;
      }

      const fluidPart = syntheticFluidPart(state.id, state.properties, { x: variant.x ?? 0, y: variant.y ?? 0 });
      if (fluidPart) {
        parts.push(fluidPart);
        continue;
      }
      if (isRenderlessVanillaModelBlock(state.id)) {
        continue;
      }
      parts.push(fallbackPart(state.id, { x: variant.x ?? 0, y: variant.y ?? 0 }));
      continue;
    }

    parts.push(...modelVariantParts(stateKey, state.id, state.properties, variant, model));
  }

  // The bell's metal body is a block entity, not part of the block-model JSON
  // (which only supplies the bar and posts), so append it to the vanilla parts.
  if (state.id === 'minecraft:bell') {
    parts.push(...syntheticBellBodyParts(state.id, state.properties));
  }

  // The enchanting table's floating book is a block entity drawn on top of the
  // (vanilla-modelled) 3/4-height base.
  if (state.id === 'minecraft:enchanting_table') {
    parts.push(...enchantingTableBookParts(state.id, state.properties));
  }

  // Lit candles/candle cakes carry a flame particle in-game. Swap each model's
  // dark wick quad (the only rotated element) for a small emissive flame.
  if (state.properties.lit === 'true' && (isCandleBlock(state.id) || isCandleCakeBlock(state.id))) {
    const flames = candleFlameParts(state.id, state.properties, parts);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (parts[i].elementRotation) parts.splice(i, 1);
    }
    parts.push(...flames);
  }

  // Waterlogged blocks (stairs, slabs, fences, sea pickles, …) hold a water
  // source in the same cell. Fill the cell with translucent water behind the
  // block's own geometry. The opaque parts draw first (renderOrder 0) and the
  // translucent water after (renderOrder 10), so the block reads as submerged.
  if (state.id !== 'minecraft:water' && state.properties.waterlogged === 'true') {
    const water = syntheticFluidPart('minecraft:water', { level: '0' }, { x: 0, y: 0 });
    if (water) parts.push(water);
  }

  return parts;
}

function modelVariantParts(
  stateKey: string,
  blockId: string,
  properties: Record<string, string>,
  variant: BlockstateVariant,
  model: ResolvedModel,
): ResolvedBlockPart[] {
  return model.elements.map((rawElement, index) => {
    const element = normalizeModelElementForBlock(blockId, rawElement);
    return {
      key: `${stateKey}::${partKey(variant, element, model.textures, index)}`,
      blockId,
      blockProperties: properties,
      from: element.from,
      to: element.to,
      textureSize: [16, 16],
      shade: element.shade ?? true,
      elementRotation: element.rotation,
      uvLock: variant.uvlock ?? false,
      variantRotation: {
        x: variant.x ?? 0,
        y: variant.y ?? 0,
      },
      faceTextures: faceTextures(element, model.textures),
      faceTints: faceTints(element),
      faceUvs: faceUvs(element),
      faceRotations: faceRotations(element),
      faceCullfaces: faceCullfaces(element),
      faceTranslucencies: faceTranslucencies(element, model.textures),
    };
  });
}

// Resolves a model file directly (bypassing the blockstate) so material-list
// thumbnails can show item-style models such as `*_fence_inventory`, which the
// block's placed-state blockstate never references.
export async function resolveInventoryModelParts(stateKey: string, modelId: string): Promise<ResolvedBlockPart[]> {
  const key = `${stateKey}::${modelId}`;
  const cached = resolvedInventoryCache.get(key);
  if (cached) return cached;

  const promise = resolveInventoryModelPartsUncached(key, stateKey, modelId);
  resolvedInventoryCache.set(key, promise);
  return promise;
}

async function resolveInventoryModelPartsUncached(
  key: string,
  stateKey: string,
  modelId: string,
): Promise<ResolvedBlockPart[]> {
  const state = parseBlockStateKey(stateKey);
  const model = await resolveModel(modelId);
  if (!model || model.elements.length === 0) return [];

  return modelVariantParts(key, state.id, state.properties, { model: modelId }, model);
}

// A candle's wax cylinder is a ~2×2 column at least 3px tall with no rotation;
// the wick quad is a tiny rotated cross and the candle-cake base is full-width.
function isCandleWaxPart(part: ResolvedBlockPart): boolean {
  const width = part.to[0] - part.from[0];
  const height = part.to[1] - part.from[1];
  const depth = part.to[2] - part.from[2];
  return !part.elementRotation && width >= 1.5 && width <= 3 && depth >= 1.5 && depth <= 3 && height >= 3;
}

function candleFlameParts(
  id: string,
  properties: Record<string, string>,
  candleParts: ResolvedBlockPart[],
): ResolvedBlockPart[] {
  const flames: ResolvedBlockPart[] = [];
  let index = 0;
  for (const part of candleParts) {
    if (!isCandleWaxPart(part)) continue;
    const centerX = (part.from[0] + part.to[0]) / 2;
    const centerZ = (part.from[2] + part.to[2]) / 2;
    const top = part.to[1];
    // Crossed billboard so the flame reads from every horizontal angle.
    flames.push(
      flameBillboardPart(id, properties, `${index}:xy`, [centerX - 1.6, top - 1.2, centerZ], [centerX + 1.6, top + 3.4, centerZ], ['north', 'south']),
      flameBillboardPart(id, properties, `${index}:zy`, [centerX, top - 1.2, centerZ - 1.6], [centerX, top + 3.4, centerZ + 1.6], ['east', 'west']),
    );
    index += 1;
  }
  return flames;
}

function flameBillboardPart(
  id: string,
  properties: Record<string, string>,
  key: string,
  from: [number, number, number],
  to: [number, number, number],
  faces: ModelFaceName[],
): ResolvedBlockPart {
  const onFace = <T,>(value: T): Record<ModelFaceName, T | null> => ({
    down: faces.includes('down') ? value : null,
    up: faces.includes('up') ? value : null,
    north: faces.includes('north') ? value : null,
    south: faces.includes('south') ? value : null,
    west: faces.includes('west') ? value : null,
    east: faces.includes('east') ? value : null,
  });

  return {
    key: `candle-flame::${id}::${key}`,
    blockId: id,
    blockProperties: properties,
    from,
    to,
    textureSize: [16, 16],
    shade: true,
    uvLock: false,
    variantRotation: { x: 0, y: 0 },
    faceTextures: onFace(candleFlameTextureId),
    faceTints: { down: null, up: null, north: null, south: null, west: null, east: null },
    faceUvs: onFace([0, 0, 16, 16] as ModelFaceUv),
    faceRotations: { down: 0, up: 0, north: 0, south: 0, west: 0, east: 0 },
    faceCullfaces: { down: null, up: null, north: null, south: null, west: null, east: null },
    faceTranslucencies: { down: false, up: false, north: false, south: false, west: false, east: false },
  };
}

function enchantingTableBookParts(id: string, properties: Record<string, string>): ResolvedBlockPart[] {
  const texture = 'minecraft:entity/enchantment/enchanting_table_book';
  const size: [number, number] = [64, 32];
  const rotation = { x: 0, y: 0 };
  // An open book floating above the pedestal: the spine stands vertically at the
  // block centre and the two halves splay open. The covers (leather) open wider
  // than the pages tucked inside them. Authored statically (vanilla spins/bobs
  // the book, but a schematic is a still frame).
  const spineY = 15;
  const cover = (
    key: string,
    from: [number, number, number],
    to: [number, number, number],
    textureOrigin: [number, number],
    uvSize: [number, number, number],
    angle: number,
  ): ResolvedBlockPart =>
    blockEntityCuboidPart(
      id,
      properties,
      key,
      { name: key, from, to, textureOrigin, uvSize, elementRotation: { origin: [8, spineY, 8], axis: 'y', angle } },
      texture,
      rotation,
      size,
    );

  return [
    cover('enchant-book:left-lid', [8, 12, 7.8], [12.2, 18.4, 8.2], [0, 0], [6, 10, 0], 52),
    cover('enchant-book:right-lid', [3.8, 12, 7.8], [8, 18.4, 8.2], [16, 0], [6, 10, 0], -52),
    cover('enchant-book:left-page', [8, 12.6, 7.9], [11.5, 17.6, 8.1], [0, 10], [5, 8, 0], 34),
    cover('enchant-book:right-page', [4.5, 12.6, 7.9], [8, 17.6, 8.1], [12, 10], [5, 8, 0], -34),
  ];
}

function syntheticBellBodyParts(id: string, properties: Record<string, string>): ResolvedBlockPart[] {
  const texture = 'minecraft:entity/bell/bell_body';
  const rotation = { x: 0, y: 0 };
  const size: [number, number] = [32, 32];

  return [
    blockEntityCuboidPart(
      id,
      properties,
      'bell:body',
      { name: 'body', from: [5, 3, 5], to: [11, 10, 11], textureOrigin: [0, 0] },
      texture,
      rotation,
      size,
    ),
    blockEntityCuboidPart(
      id,
      properties,
      'bell:lip',
      { name: 'lip', from: [4, 1, 4], to: [12, 3, 12], textureOrigin: [0, 13] },
      texture,
      rotation,
      size,
    ),
  ];
}

function normalizeModelElementForBlock(id: string, element: ModelElement): ModelElement {
  if (!isDecorativeLanternBlock(id)) return element;

  return thickenZeroDepthElement(element, 0.25);
}

function thickenZeroDepthElement(element: ModelElement, thickness: number): ModelElement {
  const from = [...element.from] as [number, number, number];
  const to = [...element.to] as [number, number, number];
  let changed = false;

  for (let axis = 0; axis < 3; axis += 1) {
    if (from[axis] !== to[axis]) continue;

    from[axis] -= thickness / 2;
    to[axis] += thickness / 2;
    changed = true;
  }

  return changed ? { ...element, from, to } : element;
}

function selectVariants(blockstate: BlockstateJson, properties: Record<string, string>): BlockstateVariant[] {
  if (blockstate.variants) {
    let best: { score: number; variants: BlockstateVariant[] } | null = null;

    for (const [variantKey, rawVariant] of Object.entries(blockstate.variants)) {
      const score = variantMatchScore(variantKey, properties);
      if (score < 0) continue;

      if (!best || score > best.score) {
        best = { score, variants: [firstVariant(rawVariant)] };
      }
    }

    return best?.variants ?? [];
  }

  if (blockstate.multipart) {
    return blockstate.multipart
      .filter((rule) => !rule.when || multipartMatches(rule.when, properties))
      .map((rule) => firstVariant(rule.apply));
  }

  return [];
}

function variantMatchScore(variantKey: string, properties: Record<string, string>): number {
  if (variantKey === '') return 0;

  let score = 0;
  for (const pair of variantKey.split(',')) {
    const [key, rawValue] = pair.split('=');
    if (!key || rawValue === undefined) return -1;
    if (!valueMatches(properties[key], rawValue)) return -1;
    score += 1;
  }

  return score;
}

function multipartMatches(when: MultipartWhen, properties: Record<string, string>): boolean {
  if ('OR' in when && Array.isArray(when.OR)) {
    return when.OR.some((item) => multipartMatches(item, properties));
  }
  if ('AND' in when && Array.isArray(when.AND)) {
    return when.AND.every((item) => multipartMatches(item, properties));
  }

  for (const [key, rawValue] of Object.entries(when)) {
    if (key === 'OR' || key === 'AND') continue;
    if (Array.isArray(rawValue)) {
      if (!rawValue.some((item) => multipartMatches(item, properties))) return false;
      continue;
    }
    if (!valueMatches(properties[key], rawValue)) return false;
  }

  return true;
}

function valueMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  return expected.split('|').includes(actual);
}

function firstVariant(value: BlockstateVariant | BlockstateVariant[]): BlockstateVariant {
  return Array.isArray(value) ? value[0] : value;
}

async function resolveModel(modelId: string): Promise<ResolvedModel | null> {
  const id = normalizeResourceId(modelId, 'block');
  const cached = resolvedModelCache.get(id);
  if (cached) return cached;

  const promise = resolveModelUncached(id, new Set());
  resolvedModelCache.set(id, promise);
  return promise;
}

async function resolveModelUncached(id: string, seen: Set<string>): Promise<ResolvedModel | null> {
  if (seen.has(id)) return null;
  seen.add(id);

  const model = await loadModel(id);
  if (!model) return null;

  const ownTextures = normalizeTextures(model.textures ?? {});

  if (!model.parent) {
    return {
      textures: ownTextures,
      elements: model.elements ?? [],
    };
  }

  const parent = await resolveModelUncached(normalizeResourceId(model.parent, 'block'), seen);
  if (!parent) {
    return {
      textures: ownTextures,
      elements: model.elements ?? [],
    };
  }

  return {
    textures: {
      ...parent.textures,
      ...ownTextures,
    },
    elements: model.elements ?? parent.elements,
  };
}

function normalizeTextures(textures: Record<string, TextureReference>): Record<string, string | null> {
  const normalized: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(textures)) {
    normalized[key] = textureReferenceToId(value);
  }

  return normalized;
}

function faceTextures(element: ModelElement, textures: Record<string, string | null>): Record<ModelFaceName, string | null> {
  const faces = element.faces ?? {};
  const fallback = resolveTextureReference(textures.particle ?? null, textures);

  return {
    down: faces.down ? resolveTextureReference(textureReferenceToId(faces.down.texture) ?? fallback, textures) : null,
    up: faces.up ? resolveTextureReference(textureReferenceToId(faces.up.texture) ?? fallback, textures) : null,
    north: faces.north ? resolveTextureReference(textureReferenceToId(faces.north.texture) ?? fallback, textures) : null,
    south: faces.south ? resolveTextureReference(textureReferenceToId(faces.south.texture) ?? fallback, textures) : null,
    west: faces.west ? resolveTextureReference(textureReferenceToId(faces.west.texture) ?? fallback, textures) : null,
    east: faces.east ? resolveTextureReference(textureReferenceToId(faces.east.texture) ?? fallback, textures) : null,
  };
}

function faceTints(element: ModelElement): Record<ModelFaceName, number | null> {
  const faces = element.faces ?? {};

  return {
    down: faces.down?.tintindex ?? null,
    up: faces.up?.tintindex ?? null,
    north: faces.north?.tintindex ?? null,
    south: faces.south?.tintindex ?? null,
    west: faces.west?.tintindex ?? null,
    east: faces.east?.tintindex ?? null,
  };
}

function faceUvs(element: ModelElement): Record<ModelFaceName, ModelFaceUv | null> {
  const faces = element.faces ?? {};

  return {
    down: faces.down?.uv ?? null,
    up: faces.up?.uv ?? null,
    north: faces.north?.uv ?? null,
    south: faces.south?.uv ?? null,
    west: faces.west?.uv ?? null,
    east: faces.east?.uv ?? null,
  };
}

function faceRotations(element: ModelElement): Record<ModelFaceName, number> {
  const faces = element.faces ?? {};

  return {
    down: faces.down?.rotation ?? 0,
    up: faces.up?.rotation ?? 0,
    north: faces.north?.rotation ?? 0,
    south: faces.south?.rotation ?? 0,
    west: faces.west?.rotation ?? 0,
    east: faces.east?.rotation ?? 0,
  };
}

function faceCullfaces(element: ModelElement): Record<ModelFaceName, ModelFaceName | null> {
  const faces = element.faces ?? {};

  return {
    down: faces.down?.cullface ?? null,
    up: faces.up?.cullface ?? null,
    north: faces.north?.cullface ?? null,
    south: faces.south?.cullface ?? null,
    west: faces.west?.cullface ?? null,
    east: faces.east?.cullface ?? null,
  };
}

function faceTranslucencies(element: ModelElement, textures: Record<string, string | null>): Record<ModelFaceName, boolean> {
  const faces = element.faces ?? {};
  const resolvedTextures = faceTextures(element, textures);

  return {
    down: isTranslucentFaceTexture(faces.down?.texture, resolvedTextures.down),
    up: isTranslucentFaceTexture(faces.up?.texture, resolvedTextures.up),
    north: isTranslucentFaceTexture(faces.north?.texture, resolvedTextures.north),
    south: isTranslucentFaceTexture(faces.south?.texture, resolvedTextures.south),
    west: isTranslucentFaceTexture(faces.west?.texture, resolvedTextures.west),
    east: isTranslucentFaceTexture(faces.east?.texture, resolvedTextures.east),
  };
}

function isTranslucentFaceTexture(texture: TextureReference | undefined, resolvedTextureId: string | null): boolean {
  if (typeof texture === 'object' && texture.force_translucent) return true;
  if (!resolvedTextureId) return false;

  const path = resolvedTextureId.replace(/^minecraft:/, '');
  return /(^|\/)(.+_)?(stained_)?glass(_pane_top)?$/.test(path)
    || /(^|\/)(tinted_glass|ice|water|honey_block|slime_block)$/.test(path);
}

function resolveTextureReference(value: string | null, textures: Record<string, string | null>): string | null {
  if (!value) return null;
  if (!value.startsWith('#')) return normalizeResourceId(value, 'block');

  const key = value.slice(1);
  const next = textures[key] ?? null;
  if (!next || next === value) return null;
  return resolveTextureReference(next, textures);
}

function textureReferenceToId(value: TextureReference | undefined | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.sprite ?? null;
}

function partKey(
  variant: BlockstateVariant,
  element: ModelElement,
  textures: Record<string, string | null>,
  index: number,
): string {
  const faceKey = Object.entries(faceTextures(element, textures))
    .map(([face, texture]) => {
      const tint = element.faces?.[face as ModelFaceName]?.tintindex ?? 'none';
      const uv = element.faces?.[face as ModelFaceName]?.uv?.join(',') ?? 'default';
      const faceRotation = element.faces?.[face as ModelFaceName]?.rotation ?? 0;
      return `${face}:${texture ?? 'fallback'}:${tint}:${uv}:${faceRotation}`;
    })
    .join('|');
  const rotation = element.rotation
    ? `${element.rotation.axis}:${element.rotation.angle}:${element.rotation.origin.join(',')}`
    : 'none';
  return [
    variant.model,
    index,
    element.from.join(','),
    element.to.join(','),
    rotation,
    variant.x ?? 0,
    variant.y ?? 0,
    variant.uvlock ? 'uvlock' : 'freeuv',
    faceKey,
  ].join('::');
}

function syntheticBlockParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  const signParts = syntheticSignParts(id, properties, variantRotation);
  if (signParts.length > 0) return signParts;

  const bannerParts = syntheticBannerParts(id, properties, variantRotation);
  if (bannerParts.length > 0) return bannerParts;

  const conduitParts = syntheticConduitParts(id, properties, variantRotation);
  if (conduitParts.length > 0) return conduitParts;

  const barrierParts = syntheticBarrierParts(id, properties, variantRotation);
  if (barrierParts.length > 0) return barrierParts;

  const endPortalParts = syntheticEndPortalParts(id, properties, variantRotation);
  if (endPortalParts.length > 0) return endPortalParts;

  const piglinHeadParts = syntheticPiglinHeadParts(id, properties, variantRotation);
  if (piglinHeadParts.length > 0) return piglinHeadParts;

  const playerHeadParts = syntheticPlayerHeadParts(id, properties, variantRotation);
  if (playerHeadParts.length > 0) return playerHeadParts;

  const dragonHeadParts = syntheticDragonHeadParts(id, properties, variantRotation);
  if (dragonHeadParts.length > 0) return dragonHeadParts;

  const mobSkullParts = syntheticMobSkullParts(id, properties, variantRotation);
  if (mobSkullParts.length > 0) return mobSkullParts;

  const movingPistonParts = syntheticMovingPistonParts(id, properties, variantRotation);
  if (movingPistonParts.length > 0) return movingPistonParts;

  return [];
}

function syntheticBannerParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (!isBannerBlock(id)) return [];

  const wallMounted = id.replace(/^minecraft:/, '').endsWith('_wall_banner');
  const bannerTexture = solidColorTexture(bannerColor(id));
  const poleTexture = 'minecraft:block/oak_planks';
  const rotation = {
    x: variantRotation.x,
    y: variantRotation.y + (wallMounted ? horizontalFacingRotation(properties.facing) : headRotationFromProperty(properties.rotation)),
  };
  // Vanilla banners stand roughly two blocks tall (the cloth is a 20x40 entity
  // flag scaled 2/3). The standing cloth hangs flush against the front (−Z) face
  // of the pole rather than slicing through its centre, just like the vanilla
  // flag. A wall banner's cloth hangs in front of a short wooden bracket that
  // reaches back to the +Z (south) support wall (authored for facing=north); the
  // cloth covers the bracket from the front and drops down into the block below.
  const cloth = wallMounted
    ? syntheticCuboidPart(id, properties, `banner:wall:${bannerTexture}`, [1.5, -11, 14], [14.5, 14, 15], bannerTexture, rotation)
    : syntheticCuboidPart(id, properties, `banner:standing:${bannerTexture}`, [1.5, 1, 6.7], [14.5, 28.5, 7.25], bannerTexture, rotation);

  if (wallMounted) {
    return [
      cloth,
      syntheticCuboidPart(id, properties, `banner:wall-bracket:${poleTexture}`, [1.5, 12, 15], [14.5, 14, 16], poleTexture, rotation),
    ];
  }

  return [
    cloth,
    syntheticCuboidPart(id, properties, `banner:crossbar:${poleTexture}`, [1.5, 28.5, 7.25], [14.5, 30, 8.75], poleTexture, rotation),
    syntheticCuboidPart(id, properties, `banner:pole:${poleTexture}`, [7.25, 0, 7.25], [8.75, 30, 8.75], poleTexture, rotation),
  ];
}

function syntheticConduitParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (id !== 'minecraft:conduit') return [];

  // The conduit has no block-model geometry; vanilla draws it as a block entity.
  // When inactive it is the small closed "shell" — a 6×6×6 cube floating at the
  // block centre, textured from the 32×16 entity/conduit/base atlas with the
  // standard box unwrap (texOffs 0,0).
  return [
    blockEntityCuboidPart(
      id,
      properties,
      'conduit:shell',
      { name: 'shell', from: [5, 5, 5], to: [11, 11, 11], textureOrigin: [0, 0] },
      'minecraft:entity/conduit/base',
      variantRotation,
      [32, 16],
    ),
  ];
}

function syntheticBarrierParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (id !== 'minecraft:barrier') return [];

  // Barriers are invisible in-game; mirror how Minecraft reveals them while a
  // barrier item is held by stamping the red no-entry icon on a full cube. The
  // icon's transparent background is alpha-cut away (see isAlphaCutoutTexture),
  // so only the centered symbol shows and the block still reads as empty.
  return [
    syntheticCuboidPart(id, properties, 'barrier:icon', [0, 0, 0], [16, 16, 16], 'minecraft:item/barrier', variantRotation),
  ];
}

// The end portal and end gateway have empty block models — vanilla draws them
// with TheEndPortalRenderer (a star-field shader), so without help they fall
// back to the missing-block cube. Approximate the surface with a star-field
// texture. The portal occupies its collision band (y 6-12); the gateway fills
// the whole block.
function syntheticEndPortalParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (id !== 'minecraft:end_portal' && id !== 'minecraft:end_gateway') return [];

  const isGateway = id === 'minecraft:end_gateway';
  const from: [number, number, number] = isGateway ? [0, 0, 0] : [0, 6, 0];
  const to: [number, number, number] = isGateway ? [16, 16, 16] : [16, 12, 16];

  return [
    syntheticCuboidPart(id, properties, 'end-portal:surface', from, to, endPortalTextureId, variantRotation),
  ];
}

function solidColorTexture(color: number): string {
  return `${solidTexturePrefix}${color.toString(16).padStart(6, '0')}`;
}

function bannerColor(id: string): number {
  const color = colorNameFromColoredBlock(id.replace(/^minecraft:/, '').replace(/_wall_banner$/, '_banner').replace(/_banner$/, ''));
  return color ?? 0xbebebe;
}

function colorNameFromColoredBlock(color: string): number | null {
  switch (color) {
    case 'white':
      return 0xf9fffe;
    case 'orange':
      return 0xf9801d;
    case 'magenta':
      return 0xc74ebd;
    case 'light_blue':
      return 0x3ab3da;
    case 'yellow':
      return 0xfed83d;
    case 'lime':
      return 0x80c71f;
    case 'pink':
      return 0xf38baa;
    case 'gray':
      return 0x474f52;
    case 'light_gray':
      return 0x9d9d97;
    case 'cyan':
      return 0x169c9c;
    case 'purple':
      return 0x8932b8;
    case 'blue':
      return 0x3c44aa;
    case 'brown':
      return 0x835432;
    case 'green':
      return 0x5e7c16;
    case 'red':
      return 0xb02e26;
    case 'black':
      return 0x1d1d21;
    default:
      return null;
  }
}

function syntheticSignParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (!isStandingSignBlock(id) && !isWallSignBlock(id) && !isHangingSignBlock(id)) return [];

  if (isHangingSignBlock(id)) {
    return syntheticHangingSignParts(id, properties, variantRotation);
  }

  return syntheticStandingOrWallSignParts(id, properties, variantRotation);
}

function syntheticStandingOrWallSignParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  const wallMounted = isWallSignBlock(id);
  const texture = signTexture(id);
  const rotation = {
    x: variantRotation.x,
    y: variantRotation.y + (wallMounted ? horizontalFacingRotation(properties.facing) : headRotationFromProperty(properties.rotation)),
  };
  const board: [number, number, number][] = wallMounted
    ? [[2, 5, 14], [14, 13, 16]]
    : [[2, 6, 7], [14, 14, 9]];
  const parts = [
    syntheticCuboidPart(id, properties, `sign:${wallMounted ? 'wall' : 'standing'}:board:${texture}`, board[0], board[1], texture, rotation),
  ];

  if (!wallMounted) {
    parts.push(
      syntheticCuboidPart(id, properties, `sign:standing:post:${texture}`, [7, 0, 7], [9, 7, 9], texture, rotation),
    );
  }

  return parts;
}

function syntheticHangingSignParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  const wallMounted = isWallHangingSignBlock(id);
  const texture = hangingSignTexture(id);
  const rotation = {
    x: variantRotation.x,
    y: variantRotation.y + (wallMounted ? horizontalFacingRotation(properties.facing) : headRotationFromProperty(properties.rotation)),
  };
  // The board hangs in the lower portion of the block, centred in Z. Iron chains
  // connect its top corners up to the ceiling (free-hanging) or to a top bar
  // mounted on the wall (wall-hanging).
  const barBottom = 14;
  const chainTop = wallMounted ? barBottom : 16;
  const parts = [
    syntheticCuboidPart(id, properties, `hanging-sign:${wallMounted ? 'wall' : 'ceiling'}:board:${texture}`, [1, 2, 7], [15, 12, 9], texture, rotation),
    ...hangingSignChainParts(id, properties, 'left', 4.5, 12, chainTop, rotation),
    ...hangingSignChainParts(id, properties, 'right', 11.5, 12, chainTop, rotation),
  ];

  if (wallMounted) {
    // Horizontal bracket bar across the top that the sign hangs from, mounted on the wall.
    parts.push(
      syntheticCuboidPart(id, properties, `hanging-sign:wall:bar:${texture}`, [0, barBottom, 6.5], [16, 16, 9.5], texture, rotation),
    );
  }

  return parts;
}

// Hanging signs dangle from iron chains, not wood. Render each connector as two
// crossed planes textured with block/iron_chain (an alpha-cutout texture),
// mirroring the vanilla chain block model (block/template_chain): two 3px-wide
// quads perpendicular to each other, rotated 45deg about the vertical axis
// through the chain's centre. The chain texture is 16px tall = 16 model units,
// so we sample a vertical slice equal to the connector's height to keep the
// links at the chain block's native scale.
function hangingSignChainParts(
  id: string,
  properties: Record<string, string>,
  side: string,
  centerX: number,
  bottomY: number,
  topY: number,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  const texture = 'minecraft:block/iron_chain';
  const z = 8;
  const half = 1.5;
  const elementRotation: ModelElementRotation = { origin: [centerX, 8, z], axis: 'y', angle: 45 };
  // Sample one clean link from the iron_chain texture (rows 2-6 hold a single
  // closed link) so a short connector still reads as a chain. The two crossed
  // planes split the link's left (cols 0-3) and right (cols 3-6) halves, exactly
  // as the vanilla chain block model does.
  const vTop = 2;
  const vBottom = 6;
  return [
    syntheticCuboidPart(
      id,
      properties,
      `hanging-sign:chain-${side}:ns`,
      [centerX - half, bottomY, z],
      [centerX + half, topY, z],
      { down: null, up: null, west: null, east: null, north: texture, south: texture },
      variantRotation,
      undefined,
      { elementRotation, shade: false, faceUvs: { north: [3, vTop, 0, vBottom], south: [0, vTop, 3, vBottom] } },
    ),
    syntheticCuboidPart(
      id,
      properties,
      `hanging-sign:chain-${side}:we`,
      [centerX, bottomY, z - half],
      [centerX, topY, z + half],
      { down: null, up: null, north: null, south: null, west: texture, east: texture },
      variantRotation,
      undefined,
      { elementRotation, shade: false, faceUvs: { west: [6, vTop, 3, vBottom], east: [3, vTop, 6, vBottom] } },
    ),
  ];
}

function signTexture(id: string): string {
  return `minecraft:block/${signWoodType(id)}_planks`;
}

function hangingSignTexture(id: string): string {
  const wood = signWoodType(id);
  if (wood === 'bamboo') return 'minecraft:block/bamboo_planks';
  if (wood === 'crimson' || wood === 'warped') return `minecraft:block/stripped_${wood}_stem`;
  return `minecraft:block/stripped_${wood}_log`;
}

function signWoodType(id: string): string {
  const path = id.replace(/^minecraft:/, '');
  if (path === 'sign' || path === 'wall_sign' || path === 'hanging_sign' || path === 'wall_hanging_sign') return 'oak';

  const match = /^(?<wood>.+?)_(?:wall_)?(?:hanging_)?sign$/.exec(path);
  return match?.groups?.wood ?? 'oak';
}

// Skull/head orientation. The carved face is authored on the model's NORTH
// face (entityCubeUvs maps the front-of-skull texture region to the north
// face). Floor skulls face SOUTH at rotation=0, so add 180deg on top of the
// rotation property. Wall skulls face the direction `facing` points, with the
// body mounted against the opposite (support) wall — authored for facing=north
// on the +Z half and rotated about the block centre for the other facings.
function skullRotation(
  wallMounted: boolean,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: variantRotation.x,
    y: variantRotation.y + (wallMounted
      ? horizontalFacingRotation(properties.facing)
      : 180 + headRotationFromProperty(properties.rotation)),
  };
}

// A cube from a Minecraft entity model: the box's min corner + size in model
// units, its texture offset, and an optional per-cube rotation.
interface EntityModelCube {
  name: string;
  from: [number, number, number];
  size: [number, number, number];
  texOffs: [number, number];
  rotation?: { axis: 'x' | 'y' | 'z'; angle: number; pivot: [number, number, number] };
}

// Convert an entity-model cube into a block-space cuboid. Entity models build
// downward (+Y points down, which the skull renderer flips), so block Y is
// negated; X/Z are translated by the offset to seat the head in the block. The
// offset also selects the mount: floor heads sit on the block bottom, wall
// heads are raised and pushed against the +Z support wall (then rotated to the
// facing by skullRotation). Sizes and texOffs come straight from the model, so
// entityCubeUvs maps each face to the correct region of the entity texture.
function entityModelCuboid(cube: EntityModelCube, offset: [number, number, number]): BlockEntityCuboid {
  const [ox, oy, oz] = offset;
  const [fx, fy, fz] = cube.from;
  const [w, h, d] = cube.size;
  const from: [number, number, number] = [fx + ox, oy - fy - h, fz + oz];
  const to: [number, number, number] = [fx + w + ox, oy - fy, fz + d + oz];

  let elementRotation: ModelElementRotation | undefined;
  if (cube.rotation) {
    const [px, py, pz] = cube.rotation.pivot;
    // The Y flip mirrors the model, reversing the sense of X/Z rotations.
    const angle = cube.rotation.axis === 'y' ? cube.rotation.angle : -cube.rotation.angle;
    elementRotation = { axis: cube.rotation.axis, angle, origin: [px + ox, oy - py, pz + oz] };
  }

  return { name: cube.name, from, to, textureOrigin: cube.texOffs, elementRotation };
}

// Mount offsets shared by the model-based heads (piglin, dragon). Floor heads
// sit on the block bottom; wall heads are raised by 4 and pushed back by 4 so
// they hang on the +Z support wall (matching the skull/player wall geometry).
const floorHeadOffset: [number, number, number] = [8, 0, 8];
const wallHeadOffset: [number, number, number] = [8, 4, 12];

function syntheticPlayerHeadParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (!isPlayerHeadBlock(id)) return [];

  const wallMounted = id === 'minecraft:player_wall_head';
  const headRotation = skullRotation(wallMounted, properties, variantRotation);
  const baseCuboid: BlockEntityCuboid = wallMounted
    ? { name: 'base', from: [4, 4, 8], to: [12, 12, 16], textureOrigin: [0, 0] }
    : { name: 'base', from: [4, 0, 4], to: [12, 8, 12], textureOrigin: [0, 0] };
  // Hat overlay: head box inflated 0.25px on every face (vanilla CubeDeformation
  // 0.25). The geometry grows but the texture region stays the original 8x8x8
  // hat box at (32, 0) — without uvSize the UVs would overreach into the body.
  const hatCuboid: BlockEntityCuboid = wallMounted
    ? { name: 'hat', from: [3.75, 3.75, 7.75], to: [12.25, 12.25, 16.25], textureOrigin: [32, 0], uvSize: [8, 8, 8] }
    : { name: 'hat', from: [3.75, -0.25, 3.75], to: [12.25, 8.25, 12.25], textureOrigin: [32, 0], uvSize: [8, 8, 8] };
  const texture = playerHeadTextureId(properties.SchematicEditor_head);

  return [baseCuboid, hatCuboid].map((cuboid) =>
    blockEntityCuboidPart(id, properties, `player-head:${wallMounted ? 'wall' : 'floor'}:${cuboid.name}`, cuboid, texture, headRotation, [64, 64]),
  );
}

// Skeleton / wither skeleton / zombie / creeper skulls render from the vanilla
// SkullModel (a single 8x8x8 head cube). They resolve to the empty block/skull
// model, so we synthesise the head here instead of falling back to a cube.
function syntheticMobSkullParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  const skull = mobSkullTexture(id);
  if (!skull) return [];

  const wallMounted = isWallSkullBlock(id);
  const headRotation = skullRotation(wallMounted, properties, variantRotation);
  const cuboid: BlockEntityCuboid = wallMounted
    ? { name: 'head', from: [4, 4, 8], to: [12, 12, 16], textureOrigin: [0, 0] }
    : { name: 'head', from: [4, 0, 4], to: [12, 8, 12], textureOrigin: [0, 0] };

  return [
    blockEntityCuboidPart(
      id,
      properties,
      `mob-skull:${wallMounted ? 'wall' : 'floor'}:${skull.texture}`,
      cuboid,
      skull.texture,
      headRotation,
      skull.size,
    ),
  ];
}

function mobSkullTexture(id: string): { texture: string; size: [number, number] } | null {
  switch (id.replace(/^minecraft:/, '')) {
    case 'skeleton_skull':
    case 'skeleton_wall_skull':
      return { texture: 'minecraft:entity/skeleton/skeleton', size: [64, 32] };
    case 'wither_skeleton_skull':
    case 'wither_skeleton_wall_skull':
      return { texture: 'minecraft:entity/skeleton/wither_skeleton', size: [64, 32] };
    case 'zombie_head':
    case 'zombie_wall_head':
      return { texture: 'minecraft:entity/zombie/zombie', size: [64, 64] };
    case 'creeper_head':
    case 'creeper_wall_head':
      return { texture: 'minecraft:entity/creeper/creeper', size: [64, 32] };
    default:
      return null;
  }
}

function isWallSkullBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path.endsWith('_wall_skull') || path.endsWith('_wall_head');
}

// The ender dragon head/jaw, straight from the EnderDragon entity model (head
// faces -Z). The snout and jaw protrude well past the front face, the cranium
// fills the block, and the horns poke above it — matching the vanilla block.
const DRAGON_HEAD_CUBES: EntityModelCube[] = [
  { name: 'cranium', from: [-8, -8, -10], size: [16, 16, 16], texOffs: [112, 30] },
  { name: 'snout', from: [-6, -1, -24], size: [12, 5, 16], texOffs: [176, 44] },
  { name: 'jaw', from: [-6, 4, -24], size: [12, 5, 16], texOffs: [176, 65] },
  { name: 'left-horn', from: [-5, -12, -4], size: [2, 4, 6], texOffs: [0, 0] },
  { name: 'right-horn', from: [3, -12, -4], size: [2, 4, 6], texOffs: [0, 0] },
  { name: 'left-nostril', from: [-5, -3, -22], size: [2, 2, 4], texOffs: [112, 0] },
  { name: 'right-nostril', from: [3, -3, -22], size: [2, 2, 4], texOffs: [112, 0] },
];

function syntheticDragonHeadParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (id !== 'minecraft:dragon_head' && id !== 'minecraft:dragon_wall_head') return [];

  const wallMounted = id === 'minecraft:dragon_wall_head';
  const rotation = skullRotation(wallMounted, properties, variantRotation);
  // The dragon cranium is centred on the model origin (unlike the skull head,
  // which hangs below it), so seat it a half-cube higher than a normal head.
  const offset: [number, number, number] = wallMounted ? [8, 12, 12] : [8, 8, 8];

  return DRAGON_HEAD_CUBES.map((cube) =>
    blockEntityCuboidPart(
      id,
      properties,
      `dragon-head:${wallMounted ? 'wall' : 'floor'}:${cube.name}`,
      entityModelCuboid(cube, offset),
      'minecraft:entity/enderdragon/dragon',
      rotation,
      [256, 256],
    ),
  );
}

// The piglin head, straight from the piglin entity model (64x64 texture, head
// faces -Z): a 10-wide head, the flat snout, two small 1x2x1 tusk nubs seated
// at the snout's lower corners, and two ears tilted out from the sides. No
// synthetic geometry — every part is the real model cube textured from the
// vanilla piglin skin. (The tusk is a 1x2x1 nub; its UV unwrap occupies the
// 4x3 block at texOffs — sizing it any deeper bleeds into neighbouring regions
// and turns the nub into a prong poking out past the snout.)
const PIGLIN_HEAD_CUBES: EntityModelCube[] = [
  { name: 'head', from: [-5, -8, -4], size: [10, 8, 8], texOffs: [0, 0] },
  { name: 'nose', from: [-2, -4, -5], size: [4, 4, 1], texOffs: [31, 1] },
  { name: 'left-tusk', from: [2, -2, -6], size: [1, 2, 1], texOffs: [2, 4] },
  { name: 'right-tusk', from: [-3, -2, -6], size: [1, 2, 1], texOffs: [2, 0] },
  { name: 'left-ear', from: [4.5, -6, -2], size: [1, 5, 4], texOffs: [51, 6], rotation: { axis: 'z', angle: -30, pivot: [4.5, -6, 0] } },
  { name: 'right-ear', from: [-5.5, -6, -2], size: [1, 5, 4], texOffs: [39, 6], rotation: { axis: 'z', angle: 30, pivot: [-4.5, -6, 0] } },
];

function syntheticPiglinHeadParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (id !== 'minecraft:piglin_head' && id !== 'minecraft:piglin_wall_head') return [];

  const wallMounted = id === 'minecraft:piglin_wall_head';
  const headRotation = skullRotation(wallMounted, properties, variantRotation);
  const offset = wallMounted ? wallHeadOffset : floorHeadOffset;

  return PIGLIN_HEAD_CUBES.map((cube) =>
    blockEntityCuboidPart(
      id,
      properties,
      `piglin-head:${wallMounted ? 'wall' : 'floor'}:${cube.name}`,
      entityModelCuboid(cube, offset),
      'minecraft:entity/piglin/piglin',
      headRotation,
      [64, 64],
    ),
  );
}

function isPlayerHeadBlock(id: string): boolean {
  return id === 'minecraft:player_head' || id === 'minecraft:player_wall_head';
}

function playerHeadTextureId(textureHash: string | undefined): string {
  return textureHash ? `${playerHeadTexturePrefix}${textureHash}` : 'minecraft:entity/player/wide/steve';
}

function headRotationFromProperty(rotation: string | undefined): number {
  const steps = Math.max(0, Math.min(15, Number.parseInt(rotation ?? '0', 10) || 0));
  return steps * 22.5;
}

function horizontalFacingRotation(facing: string | undefined): number {
  switch (facing) {
    case 'east':
      return 90;
    case 'south':
      return 180;
    case 'west':
      return 270;
    case 'north':
    default:
      return 0;
  }
}

function isStandingSignBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return (path === 'sign' || path.endsWith('_sign'))
    && !path.endsWith('_wall_sign')
    && !path.endsWith('_hanging_sign')
    && !path.endsWith('_wall_hanging_sign');
}

function isWallSignBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'wall_sign' || path.endsWith('_wall_sign');
}

function isHangingSignBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'hanging_sign'
    || path === 'wall_hanging_sign'
    || path.endsWith('_hanging_sign')
    || path.endsWith('_wall_hanging_sign');
}

function isWallHangingSignBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path === 'wall_hanging_sign' || path.endsWith('_wall_hanging_sign');
}

function isBannerBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path.endsWith('_banner') || path.endsWith('_wall_banner');
}

function isBedBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_bed');
}

function isRenderlessVanillaModelBlock(id: string): boolean {
  return id === 'minecraft:lava'
    || id === 'minecraft:bubble_column'
    || isStandingSignBlock(id)
    || isWallSignBlock(id)
    || isHangingSignBlock(id)
    || isBannerBlock(id);
}

function specialBlockEntityParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  const decoratedPotParts = decoratedPotBlockEntityParts(id, properties, variantRotation);
  if (decoratedPotParts.length > 0) return decoratedPotParts;

  const chestParts = chestBlockEntityParts(id, properties, variantRotation);
  if (chestParts.length > 0) return chestParts;

  const bedParts = bedBlockEntityParts(id, properties, variantRotation);
  if (bedParts.length > 0) return bedParts;

  const shulkerBoxParts = shulkerBoxBlockEntityParts(id, properties, variantRotation);
  if (shulkerBoxParts.length > 0) return shulkerBoxParts;

  return [];
}

function decoratedPotBlockEntityParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (id !== 'minecraft:decorated_pot') return [];

  const baseTexture = 'minecraft:entity/decorated_pot/decorated_pot_base';
  const sideTexture = 'minecraft:entity/decorated_pot/decorated_pot_side';
  const frontTexture = decoratedPotSideTexture(properties.SchematicEditor_pot_front, sideTexture);
  const backTexture = decoratedPotSideTexture(properties.SchematicEditor_pot_back, sideTexture);
  const leftTexture = decoratedPotSideTexture(properties.SchematicEditor_pot_left, sideTexture);
  const rightTexture = decoratedPotSideTexture(properties.SchematicEditor_pot_right, sideTexture);
  const rotation = {
    x: variantRotation.x,
    y: variantRotation.y + decoratedPotFacingRotation(properties.facing),
  };

  return [
    blockEntityPlanePart(
      id,
      properties,
      'decorated-pot:front',
      'south',
      [1, 0, 15],
      [15, 16, 15],
      frontTexture,
      [16, 16],
      [1, 0, 15, 16],
      rotation,
    ),
    blockEntityPlanePart(
      id,
      properties,
      'decorated-pot:back',
      'north',
      [1, 0, 1],
      [15, 16, 1],
      backTexture,
      [16, 16],
      [1, 0, 15, 16],
      rotation,
    ),
    blockEntityPlanePart(
      id,
      properties,
      'decorated-pot:left',
      'west',
      [1, 0, 1],
      [1, 16, 15],
      leftTexture,
      [16, 16],
      [1, 0, 15, 16],
      rotation,
    ),
    blockEntityPlanePart(
      id,
      properties,
      'decorated-pot:right',
      'east',
      [15, 0, 1],
      [15, 16, 15],
      rightTexture,
      [16, 16],
      [1, 0, 15, 16],
      rotation,
    ),
    blockEntityPlanePart(
      id,
      properties,
      'decorated-pot:top',
      'up',
      [1, 16, 1],
      [15, 16, 15],
      baseTexture,
      [32, 32],
      [14, 13, 28, 27],
      rotation,
    ),
    blockEntityPlanePart(
      id,
      properties,
      'decorated-pot:bottom',
      'down',
      [1, 0, 1],
      [15, 0, 15],
      baseTexture,
      [32, 32],
      [0, 13, 14, 27],
      rotation,
    ),
    blockEntityCuboidPart(
      id,
      properties,
      'decorated-pot:neck',
      {
        name: 'neck',
        from: [4.1, 17.1, 4.1],
        to: [11.9, 19.9, 11.9],
        textureOrigin: [0, 0],
        faceUvOffsets: {
          up: { u: 0, v: 0 },
          south: { u: -8, v: 0 },
          west: { u: 9, v: 0 },
        },
      },
      baseTexture,
      rotation,
      [32, 32],
    ),
    blockEntityCuboidPart(
      id,
      properties,
      'decorated-pot:rim',
      {
        name: 'rim',
        from: [4.8, 15.8, 4.8],
        to: [11.2, 17.2, 11.2],
        textureOrigin: [0, 5],
        faceUvOffsets: {
          north: { u: 0, v: -1 },
          south: { u: -2, v: -1 },
          west: { u: 0, v: -1 },
          east: { u: 0, v: -1 },
        },
      },
      baseTexture,
      rotation,
      [32, 32],
    ),
  ];
}

function decoratedPotSideTexture(itemId: string | undefined, fallbackTexture: string): string {
  if (!itemId) return fallbackTexture;

  const path = itemId.replace(/^minecraft:/, '');
  if (!path || path === 'brick') return fallbackTexture;

  const sherd = /^(?<pattern>[a-z0-9_]+)_pottery_sherd$/.exec(path)?.groups?.pattern;
  if (sherd) return `minecraft:entity/decorated_pot/${sherd}_pottery_pattern`;

  if (path.startsWith('entity/decorated_pot/') && path.endsWith('_pottery_pattern')) {
    return `minecraft:${path}`;
  }

  return fallbackTexture;
}

function decoratedPotFacingRotation(facing: string | undefined): number {
  switch (facing) {
    case 'north':
      return 180;
    case 'east':
      return 270;
    case 'west':
      return 90;
    case 'south':
    default:
      return 0;
  }
}

function syntheticMovingPistonParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (id !== 'minecraft:moving_piston') return [];

  const pistonRotation = {
    x: variantRotation.x + pistonFacingXRotation(properties.facing),
    y: variantRotation.y + pistonFacingYRotation(properties.facing),
  };
  const isSticky = properties.type === 'sticky';
  const topTexture = isSticky ? 'minecraft:block/piston_top_sticky' : 'minecraft:block/piston_top';

  return [
    syntheticCuboidPart(
      id,
      properties,
      `moving-piston-base:${isSticky ? 'sticky' : 'normal'}`,
      [0, 0, 4],
      [16, 16, 16],
      {
        down: 'minecraft:block/piston_side',
        up: 'minecraft:block/piston_side',
        north: 'minecraft:block/piston_inner',
        south: 'minecraft:block/piston_bottom',
        west: 'minecraft:block/piston_side',
        east: 'minecraft:block/piston_side',
      },
      pistonRotation,
    ),
    syntheticCuboidPart(
      id,
      properties,
      `moving-piston-head:${isSticky ? 'sticky' : 'normal'}`,
      [0, 0, -16],
      [16, 16, -12],
      {
        down: 'minecraft:block/piston_side',
        up: 'minecraft:block/piston_side',
        north: topTexture,
        south: 'minecraft:block/piston_top',
        west: 'minecraft:block/piston_side',
        east: 'minecraft:block/piston_side',
      },
      pistonRotation,
    ),
    syntheticCuboidPart(
      id,
      properties,
      `moving-piston-arm:${isSticky ? 'sticky' : 'normal'}`,
      [6, 6, -12],
      [10, 10, 4],
      'minecraft:block/piston_side',
      pistonRotation,
    ),
  ];
}

function pistonFacingXRotation(facing: string | undefined): number {
  switch (facing) {
    case 'down':
      return 90;
    case 'up':
      return 270;
    default:
      return 0;
  }
}

function pistonFacingYRotation(facing: string | undefined): number {
  switch (facing) {
    case 'east':
      return 90;
    case 'south':
      return 180;
    case 'west':
      return 270;
    case 'north':
    default:
      return 0;
  }
}

function chestBlockEntityParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (!isChestBlock(id)) return [];

  const chestType = id === 'minecraft:ender_chest' ? 'single' : chestTypeFromProperties(properties);
  const chestRotation = {
    x: variantRotation.x,
    y: variantRotation.y + chestFacingRotation(properties.facing),
  };
  const texture = chestTexture(id, chestType);

  return chestCuboids(chestType).map((cuboid) =>
    blockEntityCuboidPart(id, properties, `chest:${chestType}:${cuboid.name}:${texture}`, cuboid, texture, chestRotation, [64, 64], true),
  );
}

function bedColorTexture(id: string): string {
  const color = id.replace(/^minecraft:/, '').replace(/_bed$/, '');
  return `minecraft:entity/bed/${color}`;
}

function bedFacingRotation(facing: string | undefined): number {
  switch (facing) {
    case 'east':
      return 90;
    case 'south':
      return 180;
    case 'west':
      return 270;
    case 'north':
    default:
      return 0;
  }
}

// Bed geometry replicates the vanilla BedRenderer: each half is a standing
// 16x16x6 mattress box laid flat by a +90deg rotation about X (which maps the
// pillow/blanket "sleeping surface" to the upward face), plus two 3x3x3 legs at
// the half's outer corners. Head and foot are separate blocks; the head half is
// rotated an extra 180deg (see bedBlockEntityParts) so the two halves meet with
// the pillow at the outer head end and legs at the four outer corners.
//
// Texture regions are intentionally paired the opposite way from the part name:
// the +0deg (foot) block carries the pillow region [0,0] and the +180deg (head)
// block carries the plain region [0,22]. Combined with the per-part rotation and
// the head/foot block placement, this lands the pillow at the bed's head end with
// the correct orientation. Pairing them the "obvious" way renders the bed facing
// backwards (a 180deg error).
//
// The bed texture is authored for the ORIGINAL box-unwrap orientation. The shared
// entityCubeUvs was later reoriented (commit 2183b19) so mob/player HEAD faces
// render upright; that V-flip + up/down-region swap is correct for skulls but put
// the bed pillow at the seam instead of the head end. Beds therefore pin their own
// UVs (bedBoxUvs) to the original orientation rather than the head-tuned shared
// helper, so head fixes and bed correctness stay decoupled.
function bedBoxUvs(
  textureOrigin: [number, number],
  size: [number, number, number],
): Partial<Record<ModelFaceName, ModelFaceUv>> {
  const [width, height, depth] = size;
  const [tx, ty] = textureOrigin;
  const u0 = tx;
  const u1 = tx + depth;
  const u2 = tx + depth + width;
  const u22 = tx + depth + width + width;
  const u3 = tx + depth + width + depth;
  const u4 = tx + depth + width + depth + width;
  const v0 = ty;
  const v1 = ty + depth;
  const v2 = ty + depth + height;
  return {
    down: [u1, v0, u2, v1],
    up: [u2, v1, u22, v0],
    west: [u1, v2, u0, v1],
    north: [u2, v2, u1, v1],
    east: [u3, v2, u2, v1],
    south: [u4, v2, u3, v1],
  };
}

function bedCuboids(part: 'head' | 'foot'): BlockEntityCuboid[] {
  const bodyOrigin: [number, number] = part === 'head' ? [0, 22] : [0, 0];
  const legOrigins: [number, number][] =
    part === 'head'
      ? [[50, 0], [50, 12]]
      : [[50, 6], [50, 18]];

  const bodyUvs = bedBoxUvs(bodyOrigin, [16, 16, 6]);
  if (part === 'head') bodyUvs.down = [22, 22, 38, 28];

  return [
    {
      name: 'body',
      from: [0, 3, 0],
      to: [16, 19, 6],
      textureOrigin: bodyOrigin,
      faceUvs: bodyUvs,
      elementRotation: { origin: [8, 6, 3], axis: 'x', angle: 90 },
    },
    { name: 'leg0', from: [0, 0, 0], to: [3, 3, 3], textureOrigin: legOrigins[0], faceUvs: bedBoxUvs(legOrigins[0], [3, 3, 3]) },
    { name: 'leg1', from: [13, 0, 0], to: [16, 3, 3], textureOrigin: legOrigins[1], faceUvs: bedBoxUvs(legOrigins[1], [3, 3, 3]) },
  ];
}

function bedBlockEntityParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (!isBedBlock(id)) return [];

  const part = properties.part === 'head' ? 'foot' : 'head';
  const texture = bedColorTexture(id);
  const bedRotation = {
    x: variantRotation.x,
    y: variantRotation.y + bedFacingRotation(properties.facing) + (part === 'head' ? 180 : 0),
  };

  return bedCuboids(part).map((cuboid) =>
    blockEntityCuboidPart(id, properties, `bed:${part}:${cuboid.name}`, cuboid, texture, bedRotation),
  );
}

function isChestBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return /(^|_)chest$/.test(path);
}

function shulkerBoxBlockEntityParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (!isShulkerBoxBlock(id)) return [];

  const texture = shulkerBoxTexture(id);
  return [
    syntheticCuboidPart(id, properties, `shulker:base:${texture}`, [0, 0, 0], [16, 8, 16], texture, variantRotation),
    syntheticCuboidPart(id, properties, `shulker:lid:${texture}`, [0, 8, 0], [16, 16, 16], texture, variantRotation),
  ];
}

function isShulkerBoxBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '') === 'shulker_box' || id.replace(/^minecraft:/, '').endsWith('_shulker_box');
}

function shulkerBoxTexture(id: string): string {
  const path = id.replace(/^minecraft:/, '');
  return `minecraft:block/${path}`;
}

type ChestType = 'single' | 'left' | 'right';

interface BlockEntityCuboid {
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  textureOrigin: [number, number];
  // Texture box dimensions [w, h, d] in texels for the entity-cube UV unwrap.
  // Defaults to the geometric size. Set this when the geometry is inflated
  // (e.g. a hat/overlay grown by a CubeDeformation) but the texture region is
  // the original, smaller box — otherwise the UVs overreach into neighbours.
  uvSize?: [number, number, number];
  faceUvs?: Partial<Record<ModelFaceName, ModelFaceUv>>;
  faceUvOffsets?: Partial<Record<ModelFaceName, { u: number; v: number }>>;
  hiddenFaces?: ModelFaceName[];
  elementRotation?: ModelElementRotation;
}

function chestTypeFromProperties(properties: Record<string, string>): ChestType {
  return properties.type === 'left' || properties.type === 'right' ? properties.type : 'single';
}

function chestFacingRotation(facing: string | undefined): number {
  switch (facing) {
    case 'east':
      return 270;
    case 'west':
      return 90;
    case 'north':
      return 180;
    case 'south':
    default:
      return 0;
  }
}

function chestTexture(id: string, chestType: ChestType): string {
  const path = id.replace(/^minecraft:/, '');

  if (path === 'ender_chest') return 'minecraft:entity/chest/ender';

  const baseName = (() => {
    if (path === 'trapped_chest') return 'trapped';
    if (path.includes('oxidized_copper_chest')) return 'copper_oxidized';
    if (path.includes('weathered_copper_chest')) return 'copper_weathered';
    if (path.includes('exposed_copper_chest')) return 'copper_exposed';
    if (path.includes('copper_chest')) return 'copper';
    return 'normal';
  })();

  const suffix = chestType === 'single' ? '' : `_${chestType}`;
  return `minecraft:entity/chest/${baseName}${suffix}`;
}

function chestCuboids(chestType: ChestType): BlockEntityCuboid[] {
  if (chestType === 'left') {
    return [
      { name: 'bottom', from: [0, 0, 1], to: [15, 10, 15], textureOrigin: [0, 19], hiddenFaces: ['west'] },
      { name: 'lid', from: [0, 9, 1], to: [15, 14, 15], textureOrigin: [0, 0], hiddenFaces: ['west'] },
      { name: 'lock', from: [0, 7, 15], to: [1, 11, 16], textureOrigin: [0, 0], hiddenFaces: ['west'] },
    ];
  }

  if (chestType === 'right') {
    return [
      { name: 'bottom', from: [1, 0, 1], to: [16, 10, 15], textureOrigin: [0, 19], hiddenFaces: ['east'] },
      { name: 'lid', from: [1, 9, 1], to: [16, 14, 15], textureOrigin: [0, 0], hiddenFaces: ['east'] },
      { name: 'lock', from: [15, 7, 15], to: [16, 11, 16], textureOrigin: [0, 0], hiddenFaces: ['east'] },
    ];
  }

  return [
    { name: 'bottom', from: [1, 0, 1], to: [15, 10, 15], textureOrigin: [0, 19] },
    { name: 'lid', from: [1, 9, 1], to: [15, 14, 15], textureOrigin: [0, 0] },
    { name: 'lock', from: [7, 7, 15], to: [9, 11, 16], textureOrigin: [0, 0] },
  ];
}

function blockEntityCuboidPart(
  id: string,
  properties: Record<string, string>,
  key: string,
  cuboid: BlockEntityCuboid,
  texture: string,
  variantRotation: { x: number; y: number },
  textureSize: [number, number] = [64, 64],
  flipV = false,
): ResolvedBlockPart {
  const width = cuboid.to[0] - cuboid.from[0];
  const height = cuboid.to[1] - cuboid.from[1];
  const depth = cuboid.to[2] - cuboid.from[2];
  const [uvWidth, uvHeight, uvDepth] = cuboid.uvSize ?? [width, height, depth];
  const hiddenFaces = new Set(cuboid.hiddenFaces ?? []);
  const faceTextures = cubeTextures(texture);
  const faceUvs = entityCubeUvs(cuboid.textureOrigin[0], cuboid.textureOrigin[1], uvWidth, uvHeight, uvDepth, hiddenFaces, flipV);

  for (const face of hiddenFaces) {
    faceTextures[face] = null;
  }

  for (
    const [face, offset] of Object.entries(cuboid.faceUvOffsets ?? {}) as Array<
      [ModelFaceName, { u: number; v: number }]
    >
  ) {
    const uv = faceUvs[face];
    if (!hiddenFaces.has(face) && uv) faceUvs[face] = offsetUv(uv, offset.u, offset.v);
  }

  for (const [face, uv] of Object.entries(cuboid.faceUvs ?? {}) as Array<[ModelFaceName, ModelFaceUv]>) {
    if (!hiddenFaces.has(face)) faceUvs[face] = uv;
  }

  return {
    key: `block-entity::${id}::${key}::${texture}::${variantRotation.x}::${variantRotation.y}`,
    blockId: id,
    blockProperties: properties,
    from: cuboid.from,
    to: cuboid.to,
    textureSize,
    shade: true,
    uvLock: false,
    elementRotation: cuboid.elementRotation,
    variantRotation,
    faceTextures,
    faceTints: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceUvs,
    faceRotations: {
      down: 0,
      up: 0,
      north: 0,
      south: 0,
      west: 0,
      east: 0,
    },
    faceCullfaces: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceTranslucencies: {
      down: false,
      up: false,
      north: false,
      south: false,
      west: false,
      east: false,
    },
  };
}

function offsetUv(uv: ModelFaceUv, offsetU: number, offsetV: number): ModelFaceUv {
  return [uv[0] + offsetU, uv[1] + offsetV, uv[2] + offsetU, uv[3] + offsetV];
}

function blockEntityPlanePart(
  id: string,
  properties: Record<string, string>,
  key: string,
  face: ModelFaceName,
  from: [number, number, number],
  to: [number, number, number],
  texture: string,
  textureSize: [number, number],
  uv: ModelFaceUv,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart {
  return {
    key: `block-entity::${id}::${key}::${texture}::${variantRotation.x}::${variantRotation.y}`,
    blockId: id,
    blockProperties: properties,
    from,
    to,
    textureSize,
    shade: true,
    uvLock: false,
    variantRotation,
    faceTextures: faceRecord(face, texture),
    faceTints: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceUvs: faceRecord(face, uv),
    faceRotations: {
      down: 0,
      up: 0,
      north: 0,
      south: 0,
      west: 0,
      east: 0,
    },
    faceCullfaces: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceTranslucencies: {
      down: false,
      up: false,
      north: false,
      south: false,
      west: false,
      east: false,
    },
  };
}

function faceRecord<T>(face: ModelFaceName, value: T): Record<ModelFaceName, T | null> {
  return {
    down: face === 'down' ? value : null,
    up: face === 'up' ? value : null,
    north: face === 'north' ? value : null,
    south: face === 'south' ? value : null,
    west: face === 'west' ? value : null,
    east: face === 'east' ? value : null,
  };
}

function entityCubeUvs(
  textureX: number,
  textureY: number,
  width: number,
  height: number,
  depth: number,
  hiddenFaces: Set<ModelFaceName>,
  flipV = false,
): Record<ModelFaceName, ModelFaceUv | null> {
  const u0 = textureX;
  const u1 = textureX + depth;
  const u2 = textureX + depth + width;
  const u22 = textureX + depth + width + width;
  const u3 = textureX + depth + width + depth;
  const u4 = textureX + depth + width + depth + width;
  const v0 = textureY;
  const v1 = textureY + depth;
  const v2 = textureY + depth + height;

  // Standard Minecraft box unwrap, oriented to match the renderer's vertex
  // convention (uvToCorners + modelFacePositions). The geometric TOP of each
  // side face must take the SMALLER v (v1, the top of the side strip); putting
  // v2 first flips every face upside-down — invisible on vertically symmetric
  // textures (chest planks) but obvious on faces (skulls render inverted).
  // up uses the scalp region (u1..u2); down uses the underside (u2..u22).
  // Swapping those two reads the head's blank underside onto the visible top
  // (e.g. the skeleton skull's white crown).
  //
  // flipV selects the vertically-mirrored unwrap (side faces read bottom-up and
  // up/down swap their regions). Chest entity textures (entity/chest/*.png) are
  // authored with the opposite vertical convention to the skull/head/bed
  // textures, so they need this mirror — without it the lid top samples the
  // darker underside region and every chest reads upside-down. (This is the
  // pre-2183b19 orientation; that commit standardised the helper for heads but
  // didn't account for the chest textures' layout.)
  const uvs: Record<ModelFaceName, ModelFaceUv> = flipV
    ? {
        down: [u1, v0, u2, v1],
        up: [u2, v1, u22, v0],
        west: [u1, v2, u0, v1],
        north: [u2, v2, u1, v1],
        east: [u3, v2, u2, v1],
        south: [u4, v2, u3, v1],
      }
    : {
        down: [u2, v1, u22, v0],
        up: [u1, v0, u2, v1],
        west: [u1, v1, u0, v2],
        north: [u2, v1, u1, v2],
        east: [u3, v1, u2, v2],
        south: [u4, v1, u3, v2],
      };

  return {
    down: hiddenFaces.has('down') ? null : uvs.down,
    up: hiddenFaces.has('up') ? null : uvs.up,
    north: hiddenFaces.has('north') ? null : uvs.north,
    south: hiddenFaces.has('south') ? null : uvs.south,
    west: hiddenFaces.has('west') ? null : uvs.west,
    east: hiddenFaces.has('east') ? null : uvs.east,
  };
}

function cubeTextures(texture: string): Record<ModelFaceName, string | null> {
  return {
    down: texture,
    up: texture,
    north: texture,
    south: texture,
    west: texture,
    east: texture,
  };
}

function syntheticCuboidPart(
  id: string,
  properties: Record<string, string>,
  key: string,
  from: [number, number, number],
  to: [number, number, number],
  textures: string | Record<ModelFaceName, string | null>,
  variantRotation: { x: number; y: number },
  faceTranslucencies?: Record<ModelFaceName, boolean>,
  options?: {
    elementRotation?: ModelElementRotation;
    faceUvs?: Partial<Record<ModelFaceName, ModelFaceUv>>;
    shade?: boolean;
  },
): ResolvedBlockPart {
  const faceTextures = typeof textures === 'string' ? cubeTextures(textures) : textures;

  return {
    key: `synthetic::${id}::${key}::${variantRotation.x}::${variantRotation.y}`,
    blockId: id,
    blockProperties: properties,
    from,
    to,
    textureSize: [16, 16],
    shade: options?.shade ?? true,
    uvLock: false,
    elementRotation: options?.elementRotation,
    variantRotation,
    faceTextures,
    faceTints: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceUvs: {
      down: options?.faceUvs?.down ?? null,
      up: options?.faceUvs?.up ?? null,
      north: options?.faceUvs?.north ?? null,
      south: options?.faceUvs?.south ?? null,
      west: options?.faceUvs?.west ?? null,
      east: options?.faceUvs?.east ?? null,
    },
    faceRotations: {
      down: 0,
      up: 0,
      north: 0,
      south: 0,
      west: 0,
      east: 0,
    },
    faceCullfaces: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceTranslucencies: faceTranslucencies ?? {
      down: false,
      up: false,
      north: false,
      south: false,
      west: false,
      east: false,
    },
  };
}

function syntheticFluidPart(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart | null {
  if (id !== 'minecraft:water' && id !== 'minecraft:lava') return null;

  const level = Math.max(0, Math.min(8, Number.parseInt(properties.level ?? '0', 10) || 0));
  const surfaceHeight = level === 0 ? 16 : Math.max(2, 15 - level * 1.55);
  const stillTexture = id === 'minecraft:lava' ? 'minecraft:block/lava_still' : 'minecraft:block/water_still';
  const sideTexture = id === 'minecraft:lava' ? 'minecraft:block/lava_still' : 'minecraft:block/water_flow';
  const tintIndex = id === 'minecraft:water' ? 0 : null;
  const translucent = id === 'minecraft:water';

  return {
    key: `fluid::${id}::level:${level}::${variantRotation.x}::${variantRotation.y}`,
    blockId: id,
    blockProperties: properties,
    from: [0, 0, 0],
    to: [16, surfaceHeight, 16],
    textureSize: [16, 16],
    shade: true,
    uvLock: false,
    variantRotation,
    faceTextures: {
      down: stillTexture,
      up: stillTexture,
      north: sideTexture,
      south: sideTexture,
      west: sideTexture,
      east: sideTexture,
    },
    faceTints: {
      down: tintIndex,
      up: tintIndex,
      north: tintIndex,
      south: tintIndex,
      west: tintIndex,
      east: tintIndex,
    },
    faceUvs: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceRotations: {
      down: 0,
      up: 0,
      north: 0,
      south: 0,
      west: 0,
      east: 0,
    },
    faceCullfaces: {
      down: 'down',
      up: 'up',
      north: 'north',
      south: 'south',
      west: 'west',
      east: 'east',
    },
    faceTranslucencies: {
      down: translucent,
      up: translucent,
      north: translucent,
      south: translucent,
      west: translucent,
      east: translucent,
    },
  };
}

function fallbackPart(id: string, variantRotation: { x: number; y: number }): ResolvedBlockPart {
  return {
    key: `fallback::${id}::${variantRotation.x}::${variantRotation.y}`,
    blockId: id,
    blockProperties: {},
    from: [0, 0, 0],
    to: [16, 16, 16],
    textureSize: [16, 16],
    shade: true,
    isFallback: true,
    uvLock: false,
    variantRotation,
    faceTextures: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceTints: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceUvs: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceRotations: {
      down: 0,
      up: 0,
      north: 0,
      south: 0,
      west: 0,
      east: 0,
    },
    faceCullfaces: {
      down: null,
      up: null,
      north: null,
      south: null,
      west: null,
      east: null,
    },
    faceTranslucencies: {
      down: false,
      up: false,
      north: false,
      south: false,
      west: false,
      east: false,
    },
  };
}

async function loadBlockstate(id: string): Promise<BlockstateJson | null> {
  const normalized = normalizeResourceId(id);
  const cached = blockstateCache.get(normalized);
  if (cached) return cached;

  const promise = fetchJson<BlockstateJson>(`${assetRoot}/${adSafeAssetPath('blockstates', resourcePath(normalized))}.json`);
  blockstateCache.set(normalized, promise);
  return promise;
}

async function loadModel(id: string): Promise<ModelJson | null> {
  const normalized = normalizeResourceId(id, 'block');
  const cached = modelCache.get(normalized);
  if (cached) return cached;

  const promise = fetchJson<ModelJson>(`${assetRoot}/${adSafeAssetPath('models', resourcePath(normalized))}.json`);
  modelCache.set(normalized, promise);
  return promise;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function normalizeResourceId(id: string, defaultFolder?: 'block'): string {
  const [rawNamespace, rawPath] = id.includes(':') ? id.split(':', 2) : ['minecraft', id];
  const namespace = rawNamespace || 'minecraft';
  const path = legacyResourcePathAlias(namespace, rawPath || rawNamespace);
  if (!defaultFolder || path.includes('/')) return `${namespace}:${path}`;
  return `${namespace}:${defaultFolder}/${path}`;
}

function legacyResourcePathAlias(namespace: string, path: string): string {
  if (namespace === 'minecraft' && path === 'chain') return 'iron_chain';
  if (namespace === 'minecraft' && (path === 'grass' || path === 'tallgrass')) return 'short_grass';
  return path;
}

function resourcePath(id: string): string {
  const [namespace, path] = id.split(':', 2);
  if (namespace !== 'minecraft') return path;
  return path;
}

// Ad-blocker filter lists block URLs whose file name starts with "beacon."
// (EasyPrivacy's "/beacon.js" rule also matches "/beacon.json"), which makes
// the beacon render as a fallback cube for anyone running an ad blocker.
// Fetch those assets through alias copies whose names no filter matches.
const adBlockedAssetAliases = new Map<string, string>([
  ['blockstates/beacon', 'blockstates/beacon_asset'],
  ['models/block/beacon', 'models/block/beacon_asset'],
  ['textures/block/beacon', 'textures/block/beacon_asset'],
]);

function adSafeAssetPath(folder: 'blockstates' | 'models' | 'textures', resource: string): string {
  const path = `${folder}/${resource}`;
  return adBlockedAssetAliases.get(path) ?? path;
}

export function textureUrl(textureId: string): string {
  const normalized = normalizeResourceId(textureId, 'block');
  if (normalized.startsWith(solidTexturePrefix)) {
    const color = normalized.slice(solidTexturePrefix.length);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" shape-rendering="crispEdges"><rect width="16" height="16" fill="#${color}"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  if (normalized === 'SchematicEditor:entity/player/default') {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(defaultPlayerSkinSvg)}`;
  }

  if (normalized === endPortalTextureId) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(endPortalSvg)}`;
  }

  if (normalized === candleFlameTextureId) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(candleFlameSvg)}`;
  }

  if (normalized.startsWith(playerHeadTexturePrefix)) {
    return `https://textures.minecraft.net/texture/${normalized.slice(playerHeadTexturePrefix.length)}`;
  }

  return `${assetRoot}/${adSafeAssetPath('textures', resourcePath(normalized))}.png`;
}
