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
const solidTexturePrefix = 'SchematicEditor:block/solid/';
const blockstateCache = new Map<string, Promise<BlockstateJson | null>>();
const modelCache = new Map<string, Promise<ModelJson | null>>();
const resolvedModelCache = new Map<string, Promise<ResolvedModel | null>>();
const resolvedBlockCache = new Map<string, Promise<ResolvedBlockPart[]>>();
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

    for (const [index, rawElement] of model.elements.entries()) {
      const element = normalizeModelElementForBlock(state.id, rawElement);
      parts.push({
        key: `${stateKey}::${partKey(variant, element, model.textures, index)}`,
        blockId: state.id,
        blockProperties: state.properties,
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
      });
    }
  }

  return parts;
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

  const playerHeadParts = syntheticPlayerHeadParts(id, properties, variantRotation);
  if (playerHeadParts.length > 0) return playerHeadParts;

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
  const banner = wallMounted
    ? syntheticCuboidPart(id, properties, `banner:wall:${bannerTexture}`, [3, 4, 0.75], [13, 15, 1.25], bannerTexture, rotation)
    : syntheticCuboidPart(id, properties, `banner:standing:${bannerTexture}`, [3, 4, 7.75], [13, 15, 8.25], bannerTexture, rotation);

  if (wallMounted) return [banner];

  return [
    banner,
    syntheticCuboidPart(id, properties, `banner:crossbar:${poleTexture}`, [2.5, 14, 7.5], [13.5, 15, 8.5], poleTexture, rotation),
    syntheticCuboidPart(id, properties, `banner:pole:${poleTexture}`, [7.25, 0, 7.25], [8.75, 15, 8.75], poleTexture, rotation),
  ];
}

function syntheticConduitParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (id !== 'minecraft:conduit') return [];

  return [
    syntheticCuboidPart(id, properties, 'conduit:core', [3, 3, 3], [13, 13, 13], 'minecraft:block/conduit', variantRotation),
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
    ? [[2, 5, 0.5], [14, 13, 1.5]]
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
  const parts = [
    syntheticCuboidPart(id, properties, `hanging-sign:${wallMounted ? 'wall' : 'ceiling'}:board:${texture}`, [1, 3, 7], [15, 13, 9], texture, rotation),
  ];

  if (wallMounted) {
    parts.push(
      syntheticCuboidPart(id, properties, `hanging-sign:wall:bracket-left:${texture}`, [2, 13, 3], [4, 15, 8], texture, rotation),
      syntheticCuboidPart(id, properties, `hanging-sign:wall:bracket-right:${texture}`, [12, 13, 3], [14, 15, 8], texture, rotation),
    );
    return parts;
  }

  parts.push(
    syntheticCuboidPart(id, properties, `hanging-sign:ceiling:chain-left:${texture}`, [2, 13, 7], [4, 16, 9], texture, rotation),
    syntheticCuboidPart(id, properties, `hanging-sign:ceiling:chain-right:${texture}`, [12, 13, 7], [14, 16, 9], texture, rotation),
  );
  return parts;
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

function syntheticPlayerHeadParts(
  id: string,
  properties: Record<string, string>,
  variantRotation: { x: number; y: number },
): ResolvedBlockPart[] {
  if (!isPlayerHeadBlock(id)) return [];

  const wallMounted = id === 'minecraft:player_wall_head';
  const headRotation = {
    x: variantRotation.x,
    y: variantRotation.y + (wallMounted ? horizontalFacingRotation(properties.facing) : headRotationFromProperty(properties.rotation)),
  };
  const baseCuboid: BlockEntityCuboid = wallMounted
    ? { name: 'base', from: [4, 4, 0], to: [12, 12, 8], textureOrigin: [0, 0] }
    : { name: 'base', from: [4, 0, 4], to: [12, 8, 12], textureOrigin: [0, 0] };
  const hatCuboid: BlockEntityCuboid = wallMounted
    ? { name: 'hat', from: [3.5, 3.5, -0.5], to: [12.5, 12.5, 8.5], textureOrigin: [32, 0] }
    : { name: 'hat', from: [3.5, -0.5, 3.5], to: [12.5, 8.5, 12.5], textureOrigin: [32, 0] };
  const texture = playerHeadTextureId(properties.SchematicEditor_head);

  return [baseCuboid, hatCuboid].map((cuboid) =>
    blockEntityCuboidPart(id, properties, `player-head:${wallMounted ? 'wall' : 'floor'}:${cuboid.name}`, cuboid, texture, headRotation),
  );
}

function isPlayerHeadBlock(id: string): boolean {
  return id === 'minecraft:player_head' || id === 'minecraft:player_wall_head';
}

function playerHeadTextureId(textureHash: string | undefined): string {
  return textureHash ? `${playerHeadTexturePrefix}${textureHash}` : 'SchematicEditor:entity/player/default';
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
      { name: 'neck', from: [4.1, 17.1, 4.1], to: [11.9, 19.9, 11.9], textureOrigin: [0, 0] },
      baseTexture,
      rotation,
      [32, 32],
    ),
    blockEntityCuboidPart(
      id,
      properties,
      'decorated-pot:rim',
      { name: 'rim', from: [4.8, 15.8, 4.8], to: [11.2, 17.2, 11.2], textureOrigin: [0, 5] },
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
    blockEntityCuboidPart(id, properties, `chest:${chestType}:${cuboid.name}:${texture}`, cuboid, texture, chestRotation),
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
function bedCuboids(part: 'head' | 'foot'): BlockEntityCuboid[] {
  const bodyOrigin: [number, number] = part === 'head' ? [0, 22] : [0, 0];
  const legOrigins: [number, number][] =
    part === 'head'
      ? [[50, 0], [50, 12]]
      : [[50, 6], [50, 18]];

  return [
    {
      name: 'body',
      from: [0, 3, 0],
      to: [16, 19, 6],
      textureOrigin: bodyOrigin,
      faceUvs: part === 'head' ? { down: [22, 22, 38, 28] } : undefined,
      elementRotation: { origin: [8, 6, 3], axis: 'x', angle: 90 },
    },
    { name: 'leg0', from: [0, 0, 0], to: [3, 3, 3], textureOrigin: legOrigins[0] },
    { name: 'leg1', from: [13, 0, 0], to: [16, 3, 3], textureOrigin: legOrigins[1] },
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
    syntheticCuboidPart(id, properties, `shulker:base:${texture}`, [1, 0, 1], [15, 8, 15], texture, variantRotation),
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
  faceUvs?: Partial<Record<ModelFaceName, ModelFaceUv>>;
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
): ResolvedBlockPart {
  const width = cuboid.to[0] - cuboid.from[0];
  const height = cuboid.to[1] - cuboid.from[1];
  const depth = cuboid.to[2] - cuboid.from[2];
  const hiddenFaces = new Set(cuboid.hiddenFaces ?? []);
  const faceTextures = cubeTextures(texture);
  const faceUvs = entityCubeUvs(cuboid.textureOrigin[0], cuboid.textureOrigin[1], width, height, depth, hiddenFaces);

  for (const face of hiddenFaces) {
    faceTextures[face] = null;
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

  const uvs: Record<ModelFaceName, ModelFaceUv> = {
    down: [u1, v0, u2, v1],
    up: [u2, v1, u22, v0],
    west: [u1, v2, u0, v1],
    north: [u2, v2, u1, v1],
    east: [u3, v2, u2, v1],
    south: [u4, v2, u3, v1],
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
): ResolvedBlockPart {
  const faceTextures = typeof textures === 'string' ? cubeTextures(textures) : textures;

  return {
    key: `synthetic::${id}::${key}::${variantRotation.x}::${variantRotation.y}`,
    blockId: id,
    blockProperties: properties,
    from,
    to,
    textureSize: [16, 16],
    shade: true,
    uvLock: false,
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

  const promise = fetchJson<BlockstateJson>(`${assetRoot}/blockstates/${resourcePath(normalized)}.json`);
  blockstateCache.set(normalized, promise);
  return promise;
}

async function loadModel(id: string): Promise<ModelJson | null> {
  const normalized = normalizeResourceId(id, 'block');
  const cached = modelCache.get(normalized);
  if (cached) return cached;

  const promise = fetchJson<ModelJson>(`${assetRoot}/models/${resourcePath(normalized)}.json`);
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
  return path;
}

function resourcePath(id: string): string {
  const [namespace, path] = id.split(':', 2);
  if (namespace !== 'minecraft') return path;
  return path;
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

  if (normalized.startsWith(playerHeadTexturePrefix)) {
    return `https://textures.minecraft.net/texture/${normalized.slice(playerHeadTexturePrefix.length)}`;
  }

  return `${assetRoot}/textures/${resourcePath(normalized)}.png`;
}
