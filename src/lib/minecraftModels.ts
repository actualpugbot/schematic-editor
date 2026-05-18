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
const playerHeadTexturePrefix = 'ScheMagic:entity/player/head/';
const solidTexturePrefix = 'ScheMagic:block/solid/';
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
  if (isChainBlock(id)) {
    return {
      axis: 'y',
      ...properties,
    };
  }

  if (isStairsBlock(id)) {
    return {
      facing: 'east',
      half: 'bottom',
      shape: 'straight',
      ...properties,
    };
  }

  if (isDecorativeLanternBlock(id)) {
    return {
      hanging: 'false',
      ...properties,
    };
  }

  if (id === 'minecraft:smoker') {
    return {
      facing: 'north',
      lit: 'false',
      ...properties,
    };
  }

  return properties;
}

function isStairsBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_stairs');
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
  const playerHeadParts = syntheticPlayerHeadParts(id, properties, variantRotation);
  if (playerHeadParts.length > 0) return playerHeadParts;

  const movingPistonParts = syntheticMovingPistonParts(id, properties, variantRotation);
  if (movingPistonParts.length > 0) return movingPistonParts;

  return [];
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
  const texture = playerHeadTextureId(properties.ScheMagic_head);

  return [baseCuboid, hatCuboid].map((cuboid) =>
    blockEntityCuboidPart(id, properties, `player-head:${wallMounted ? 'wall' : 'floor'}:${cuboid.name}`, cuboid, texture, headRotation),
  );
}

function isPlayerHeadBlock(id: string): boolean {
  return id === 'minecraft:player_head' || id === 'minecraft:player_wall_head';
}

function playerHeadTextureId(textureHash: string | undefined): string {
  return textureHash ? `${playerHeadTexturePrefix}${textureHash}` : 'ScheMagic:entity/player/default';
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
  return path.endsWith('_sign') && !path.endsWith('_wall_sign') && !path.endsWith('_hanging_sign') && !path.endsWith('_wall_hanging_sign');
}

function isWallSignBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path.endsWith('_wall_sign');
}

function isHangingSignBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return path.endsWith('_hanging_sign') || path.endsWith('_wall_hanging_sign');
}

function isWallHangingSignBlock(id: string): boolean {
  return id.replace(/^minecraft:/, '').endsWith('_wall_hanging_sign');
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
    || isBannerBlock(id)
    || isBedBlock(id);
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
  const frontTexture = decoratedPotSideTexture(properties.ScheMagic_pot_front, sideTexture);
  const backTexture = decoratedPotSideTexture(properties.ScheMagic_pot_back, sideTexture);
  const leftTexture = decoratedPotSideTexture(properties.ScheMagic_pot_left, sideTexture);
  const rightTexture = decoratedPotSideTexture(properties.ScheMagic_pot_right, sideTexture);
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

function isChestBlock(id: string): boolean {
  const path = id.replace(/^minecraft:/, '');
  return /(^|_)chest$/.test(path);
}

type ChestType = 'single' | 'left' | 'right';

interface BlockEntityCuboid {
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  textureOrigin: [number, number];
  hiddenFaces?: ModelFaceName[];
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

  for (const face of hiddenFaces) {
    faceTextures[face] = null;
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
    faceUvs: entityCubeUvs(cuboid.textureOrigin[0], cuboid.textureOrigin[1], width, height, depth, hiddenFaces),
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
  if (id !== 'minecraft:water') return null;

  const level = Math.max(0, Math.min(8, Number.parseInt(properties.level ?? '0', 10) || 0));
  const surfaceHeight = level === 0 ? 16 : Math.max(2, 15 - level * 1.55);

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
      down: 'minecraft:block/water_still',
      up: 'minecraft:block/water_still',
      north: 'minecraft:block/water_flow',
      south: 'minecraft:block/water_flow',
      west: 'minecraft:block/water_flow',
      east: 'minecraft:block/water_flow',
    },
    faceTints: {
      down: 0,
      up: 0,
      north: 0,
      south: 0,
      west: 0,
      east: 0,
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
      down: true,
      up: true,
      north: true,
      south: true,
      west: true,
      east: true,
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

  if (normalized === 'ScheMagic:entity/player/default') {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(defaultPlayerSkinSvg)}`;
  }

  if (normalized.startsWith(playerHeadTexturePrefix)) {
    return `https://textures.minecraft.net/texture/${normalized.slice(playerHeadTexturePrefix.length)}`;
  }

  return `${assetRoot}/textures/${resourcePath(normalized)}.png`;
}
