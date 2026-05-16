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
  shade: boolean;
  isFallback?: boolean;
  elementRotation?: ModelElementRotation;
  variantRotation: {
    x: number;
    y: number;
  };
  faceTextures: Record<ModelFaceName, string | null>;
  faceTints: Record<ModelFaceName, number | null>;
  faceUvs: Record<ModelFaceName, ModelFaceUv | null>;
  faceRotations: Record<ModelFaceName, number>;
  faceCullfaces: Record<ModelFaceName, ModelFaceName | null>;
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

const assetRoot = '/minecraft-assets/assets/minecraft';
const blockstateCache = new Map<string, Promise<BlockstateJson | null>>();
const modelCache = new Map<string, Promise<ModelJson | null>>();
const resolvedModelCache = new Map<string, Promise<ResolvedModel | null>>();
const resolvedBlockCache = new Map<string, Promise<ResolvedBlockPart[]>>();

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

  return { id: normalizeResourceId(id), properties };
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
    return [fallbackPart(state.id, { x: 0, y: 0 })];
  }

  const variants = selectVariants(blockstate, state.properties);
  if (variants.length === 0) {
    return [fallbackPart(state.id, { x: 0, y: 0 })];
  }

  const parts: ResolvedBlockPart[] = [];

  for (const variant of variants) {
    const model = await resolveModel(variant.model);
    if (!model || model.elements.length === 0) {
      parts.push(fallbackPart(state.id, { x: variant.x ?? 0, y: variant.y ?? 0 }));
      continue;
    }

    for (const [index, element] of model.elements.entries()) {
      parts.push({
        key: `${stateKey}::${partKey(variant, element, model.textures, index)}`,
        blockId: state.id,
        blockProperties: state.properties,
        from: element.from,
        to: element.to,
        shade: element.shade ?? true,
        elementRotation: element.rotation,
        variantRotation: {
          x: variant.x ?? 0,
          y: variant.y ?? 0,
        },
        faceTextures: faceTextures(element, model.textures),
        faceTints: faceTints(element),
        faceUvs: faceUvs(element),
        faceRotations: faceRotations(element),
        faceCullfaces: faceCullfaces(element),
      });
    }
  }

  return parts;
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

  for (const [key, rawValue] of Object.entries(when)) {
    if (key === 'OR') continue;
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
    faceKey,
  ].join('::');
}

function fallbackPart(id: string, variantRotation: { x: number; y: number }): ResolvedBlockPart {
  return {
    key: `fallback::${id}::${variantRotation.x}::${variantRotation.y}`,
    blockId: id,
    blockProperties: {},
    from: [0, 0, 0],
    to: [16, 16, 16],
    shade: true,
    isFallback: true,
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
  const path = rawPath || rawNamespace;
  if (!defaultFolder || path.includes('/')) return `${namespace}:${path}`;
  return `${namespace}:${defaultFolder}/${path}`;
}

function resourcePath(id: string): string {
  const [namespace, path] = id.split(':', 2);
  if (namespace !== 'minecraft') return path;
  return path;
}

export function textureUrl(textureId: string): string {
  return `${assetRoot}/textures/${resourcePath(normalizeResourceId(textureId, 'block'))}.png`;
}
