import * as THREE from 'three';
import {
  resolveBlockParts,
  textureUrl,
  type ModelFaceName,
  type ModelFaceUv,
  type ResolvedBlockPart,
} from './minecraftModels';

const thumbnailSize = 128;
const faceOrder: ModelFaceName[] = ['east', 'west', 'up', 'down', 'south', 'north'];
const faceOffsets: Record<ModelFaceName, [number, number, number]> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};
const faceCornerOrder = [0, 1, 2, 3];
const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.Material>();
const textureCache = new Map<string, Promise<THREE.Texture>>();
const thumbnailCache = new Map<string, Promise<string | null>>();
const thumbnailResultCache = new Map<string, string | null>();
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

const defaultFoliageTint = 0x48b518;
const birchFoliageTint = 0x80a755;
const spruceFoliageTint = 0x619961;
const waterTint = 0x4f9dff;
const hiddenMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
});

let rendererContext: ThumbnailRendererContext | null = null;
let thumbnailRenderQueue: Promise<void> = Promise.resolve();

interface ThumbnailRendererContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  group: THREE.Group;
}

interface PreparedThumbnailPart {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  rotation: THREE.Euler;
  renderOrder: number;
}

interface BlockThumbnailRequest {
  stateKey: string;
  color: number;
}

export function createBlockThumbnail(stateKey: string, fallbackColor: number): Promise<string | null> {
  const key = thumbnailCacheKey(stateKey, fallbackColor);
  const cached = thumbnailCache.get(key);
  if (cached) return cached;

  const promise = prepareBlockThumbnail(stateKey, fallbackColor).then((url) => {
    thumbnailResultCache.set(key, url);
    return url;
  });
  thumbnailCache.set(key, promise);
  return promise;
}

export function getCachedBlockThumbnail(stateKey: string, fallbackColor: number): string | null | undefined {
  return thumbnailResultCache.get(thumbnailCacheKey(stateKey, fallbackColor));
}

export function preloadBlockThumbnails(
  thumbnails: BlockThumbnailRequest[],
  options: { batchSize?: number; signal?: AbortSignal } = {},
) {
  if (typeof window === 'undefined') return;

  const batchSize = options.batchSize ?? 6;
  const pending = uniquePendingThumbnails(thumbnails);
  let index = 0;

  const scheduleNextBatch = () => {
    if (options.signal?.aborted || index >= pending.length) return;

    const runBatch = () => {
      if (options.signal?.aborted) return;

      const batch = pending.slice(index, index + batchSize);
      index += batchSize;

      void Promise.allSettled(batch.map(({ stateKey, color }) => createBlockThumbnail(stateKey, color)))
        .then(scheduleNextBatch);
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(runBatch, { timeout: 700 });
      return;
    }

    globalThis.setTimeout(runBatch, 90);
  };

  scheduleNextBatch();
}

function thumbnailCacheKey(stateKey: string, fallbackColor: number): string {
  return `${stateKey}::${fallbackColor}`;
}

function uniquePendingThumbnails(thumbnails: BlockThumbnailRequest[]): BlockThumbnailRequest[] {
  const seen = new Set<string>();
  return thumbnails.filter(({ stateKey, color }) => {
    const key = thumbnailCacheKey(stateKey, color);
    if (seen.has(key) || thumbnailResultCache.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function prepareBlockThumbnail(stateKey: string, fallbackColor: number): Promise<string | null> {
  if (typeof document === 'undefined') return null;

  const parts = await resolveBlockParts(stateKey);
  if (parts.length === 0) return null;

  const preparedParts = await Promise.all(parts.map(async (part): Promise<PreparedThumbnailPart> => ({
    geometry: geometryForPart(part),
    materials: await materialsForPart(part, fallbackColor),
    rotation: variantEuler(part),
    renderOrder: partHasTranslucentFaces(part) ? 10 : 0,
  })));

  return enqueueThumbnailRender(() => renderPreparedThumbnail(preparedParts));
}

async function enqueueThumbnailRender(render: () => string): Promise<string> {
  const previous = thumbnailRenderQueue;
  let release!: () => void;
  thumbnailRenderQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return render();
  } finally {
    release();
  }
}

function renderPreparedThumbnail(parts: PreparedThumbnailPart[]): string {
  const context = rendererContext ?? createThumbnailRenderer();
  rendererContext = context;
  clearGroup(context.group);

  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geometry, part.materials);
    mesh.rotation.copy(part.rotation);
    mesh.renderOrder = part.renderOrder;
    context.group.add(mesh);
  }

  fitCameraToGroup(context.group, context.camera);
  context.renderer.render(context.scene, context.camera);
  const dataUrl = context.renderer.domElement.toDataURL('image/png');
  clearGroup(context.group);
  return dataUrl;
}

function createThumbnailRenderer(): ThumbnailRendererContext {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(thumbnailSize, thumbnailSize, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  const group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.HemisphereLight(0xfffbef, 0x536466, 2.8));

  const key = new THREE.DirectionalLight(0xfff2d6, 3.6);
  key.position.set(3, 4, 4);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9eb8c0, 1.2);
  fill.position.set(-3, 2, -4);
  scene.add(fill);

  return { renderer, scene, camera, group };
}

function fitCameraToGroup(group: THREE.Group, camera: THREE.OrthographicCamera) {
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const viewSize = Math.max(size.x, size.y, size.z, 1) * 1.55;
  const direction = new THREE.Vector3(2.35, 1.65, 2.55).normalize();

  camera.left = -viewSize / 2;
  camera.right = viewSize / 2;
  camera.top = viewSize / 2;
  camera.bottom = -viewSize / 2;
  camera.position.copy(center).add(direction.multiplyScalar(5));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

function geometryForPart(part: ResolvedBlockPart): THREE.BufferGeometry {
  const key = [
    part.key,
    part.from.join(','),
    part.to.join(','),
    part.textureSize?.join(',') ?? '16,16',
    part.elementRotation ? `${part.elementRotation.axis}:${part.elementRotation.angle}:${part.elementRotation.origin.join(',')}:${part.elementRotation.rescale}` : 'none',
  ].join('::');
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const geometry = createModelElementGeometry(part);
  if (part.elementRotation) {
    applyElementRotation(geometry, part);
  }
  geometryCache.set(key, geometry);
  return geometry;
}

function createModelElementGeometry(part: ResolvedBlockPart): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  for (const [materialIndex, face] of faceOrder.entries()) {
    if (!part.isFallback && !part.faceTextures[face]) continue;

    const facePositions = modelFacePositions(part, face);
    const baseUvs = part.uvLock
      ? uvLockedCorners(part, face, facePositions)
      : uvToCorners(part.faceUvs[face] ?? defaultFaceUv(part, face), part.textureSize);
    const faceUvs = rotateUvCorners(baseUvs, part.faceRotations[face]);
    const normal = faceOffsets[face];

    faceCornerOrder.forEach((cornerIndex) => {
      const [x, y, z] = facePositions[cornerIndex];
      const [u, v] = faceUvs[cornerIndex];
      positions.push(x, y, z);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(u, v);
    });

    indices.push(vertexCount, vertexCount + 2, vertexCount + 1, vertexCount + 2, vertexCount + 3, vertexCount + 1);
    geometry.addGroup(indices.length - 6, 6, materialIndex);
    vertexCount += 4;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function applyElementRotation(geometry: THREE.BufferGeometry, part: ResolvedBlockPart) {
  if (!part.elementRotation) return;

  const origin = new THREE.Vector3(
    part.elementRotation.origin[0] / 16 - 0.5,
    part.elementRotation.origin[1] / 16 - 0.5,
    part.elementRotation.origin[2] / 16 - 0.5,
  );
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Matrix4();
  const radians = THREE.MathUtils.degToRad(part.elementRotation.angle);
  if (part.elementRotation.axis === 'x') rotation.makeRotationX(radians);
  if (part.elementRotation.axis === 'y') rotation.makeRotationY(radians);
  if (part.elementRotation.axis === 'z') rotation.makeRotationZ(radians);
  if (part.elementRotation.rescale) {
    const factor = 1 / Math.max(0.0001, Math.cos(radians));
    const scale = new THREE.Matrix4().makeScale(
      part.elementRotation.axis === 'x' ? 1 : factor,
      part.elementRotation.axis === 'y' ? 1 : factor,
      part.elementRotation.axis === 'z' ? 1 : factor,
    );
    rotation.multiply(scale);
  }

  matrix.makeTranslation(origin.x, origin.y, origin.z);
  matrix.multiply(rotation);
  matrix.multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
  geometry.applyMatrix4(matrix);
}

function modelFacePositions(part: ResolvedBlockPart, face: ModelFaceName): Array<[number, number, number]> {
  const x1 = part.from[0] / 16 - 0.5;
  const y1 = part.from[1] / 16 - 0.5;
  const z1 = part.from[2] / 16 - 0.5;
  const x2 = part.to[0] / 16 - 0.5;
  const y2 = part.to[1] / 16 - 0.5;
  const z2 = part.to[2] / 16 - 0.5;

  switch (face) {
    case 'east':
      return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z2], [x2, y1, z1]];
    case 'west':
      return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z1], [x1, y1, z2]];
    case 'up':
      return [[x1, y2, z1], [x2, y2, z1], [x1, y2, z2], [x2, y2, z2]];
    case 'down':
      return [[x1, y1, z2], [x2, y1, z2], [x1, y1, z1], [x2, y1, z1]];
    case 'south':
      return [[x1, y2, z2], [x2, y2, z2], [x1, y1, z2], [x2, y1, z2]];
    case 'north':
      return [[x2, y2, z1], [x1, y2, z1], [x2, y1, z1], [x1, y1, z1]];
  }
}

function defaultFaceUv(part: ResolvedBlockPart, face: ModelFaceName): ModelFaceUv {
  const [fromX, fromY, fromZ] = part.from;
  const [toX, toY, toZ] = part.to;

  switch (face) {
    case 'down':
    case 'up':
      return [fromX, fromZ, toX, toZ];
    case 'north':
    case 'south':
      return [fromX, 16 - toY, toX, 16 - fromY];
    case 'west':
    case 'east':
      return [fromZ, 16 - toY, toZ, 16 - fromY];
  }
}

function uvToCorners(uv: ModelFaceUv, textureSize: [number, number] = [16, 16]): Array<[number, number]> {
  const [u1, v1, u2, v2] = uv;
  const [width, height] = textureSize;
  return [
    [u1 / width, 1 - v1 / height],
    [u2 / width, 1 - v1 / height],
    [u1 / width, 1 - v2 / height],
    [u2 / width, 1 - v2 / height],
  ];
}

function rotateUvCorners(corners: Array<[number, number]>, degrees: number): Array<[number, number]> {
  const turns = (((degrees % 360) + 360) % 360) / 90;
  let rotated = corners;
  for (let index = 0; index < turns; index += 1) {
    rotated = [rotated[2], rotated[0], rotated[3], rotated[1]];
  }
  return rotated;
}

function uvLockedCorners(
  part: ResolvedBlockPart,
  face: ModelFaceName,
  facePositions: Array<[number, number, number]>,
): Array<[number, number]> {
  const worldFace = rotatedFace(face, part);
  const rotation = variantEuler(part);
  const [textureWidth, textureHeight] = part.textureSize ?? [16, 16];

  return facePositions.map(([x, y, z]) => {
    const position = new THREE.Vector3(x, y, z).applyEuler(rotation);
    const modelX = (position.x + 0.5) * 16;
    const modelY = (position.y + 0.5) * 16;
    const modelZ = (position.z + 0.5) * 16;
    const [u, v] = uvLockedModelCoordinates(worldFace, modelX, modelY, modelZ);
    return [u / textureWidth, 1 - v / textureHeight];
  });
}

function uvLockedModelCoordinates(face: ModelFaceName, x: number, y: number, z: number): [number, number] {
  switch (face) {
    case 'down':
    case 'up':
      return [x, z];
    case 'north':
    case 'south':
      return [x, 16 - y];
    case 'west':
    case 'east':
      return [z, 16 - y];
  }
}

async function materialsForPart(part: ResolvedBlockPart, fallbackColor: number): Promise<THREE.Material[]> {
  return Promise.all(faceOrder.map(async (face) => {
    if (isRailPart(part) && face === 'down') return hiddenMaterial;

    const textureId = part.faceTextures[face];
    if (!textureId) {
      return part.isFallback ? colorMaterial(fallbackColor) : hiddenMaterial;
    }

    return textureMaterial(
      textureId,
      tintColorForPart(textureId, part.faceTints[face], part),
      part.shade,
      part.faceTranslucencies[face],
      textureShouldWriteDepth(textureId, part.faceTranslucencies[face], part),
    );
  }));
}

async function textureMaterial(
  textureId: string,
  tintColor: number | null,
  shade: boolean,
  translucent: boolean,
  depthWrite: boolean,
): Promise<THREE.Material> {
  const key = `texture::${textureId}::${tintColor ?? 'none'}::shade:${shade}::translucent:${translucent}::depth:${depthWrite}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const texture = await loadTexture(textureId);
  const cutout = isAlphaCutoutTexture(textureId);
  const glowing = isBeaconInnerTexture(textureId) || isGlowingTexture(textureId);
  const transparent = textureRendersTransparent(textureId, translucent);
  const opacity = transparent ? translucentTextureOpacity(textureId) : 1;
  const material = shade
    ? new THREE.MeshStandardMaterial({
        map: texture,
        color: tintColor ?? 0xffffff,
        emissive: glowing ? emissiveColor(textureId) : 0x000000,
        emissiveMap: glowing ? texture : null,
        emissiveIntensity: glowing ? 0.72 : 0,
        roughness: isWaterTexture(textureId) ? 0.36 : 0.92,
        metalness: isWaterTexture(textureId) ? 0.08 : 0.02,
        transparent,
        opacity,
        alphaTest: cutout ? 0.5 : isWaterTexture(textureId) ? 0.02 : 0.08,
        depthWrite,
        side: THREE.FrontSide,
      })
    : new THREE.MeshBasicMaterial({
        map: texture,
        color: tintColor ?? 0xffffff,
        transparent,
        opacity,
        alphaTest: cutout ? 0.5 : 0.08,
        depthWrite,
        side: THREE.FrontSide,
        toneMapped: false,
      });

  materialCache.set(key, material);
  return material;
}

function textureShouldWriteDepth(textureId: string, translucent: boolean, part: ResolvedBlockPart): boolean {
  if (!textureRendersTransparent(textureId, translucent)) return true;
  if (part.blockId === 'minecraft:beacon' && isGlassTexture(textureId)) return false;
  return isGlassTexture(textureId);
}

async function loadTexture(textureId: string): Promise<THREE.Texture> {
  const cached = textureCache.get(textureId);
  if (cached) return cached;

  const promise = textureLoader.loadAsync(textureUrl(textureId)).then((texture) => {
    configureMinecraftTexture(texture, textureId);
    cropAnimatedTextureToFirstFrame(texture);
    return texture;
  });
  textureCache.set(textureId, promise);
  return promise;
}

function configureMinecraftTexture(texture: THREE.Texture, textureId: string) {
  const cutout = isAlphaCutoutTexture(textureId);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = cutout ? THREE.NearestFilter : THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = !cutout;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
}

function cropAnimatedTextureToFirstFrame(texture: THREE.Texture) {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (width <= 0 || height <= width || height % width !== 0) return;

  const frameRatio = width / height;
  texture.repeat.set(1, frameRatio);
  texture.offset.set(0, 1 - frameRatio);
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

function colorMaterial(color: number): THREE.Material {
  const key = `color::${color}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.86,
    metalness: 0.02,
  });
  materialCache.set(key, material);
  return material;
}

function partHasTranslucentFaces(part: ResolvedBlockPart): boolean {
  return faceOrder.some((face) => {
    const textureId = part.faceTextures[face];
    return textureId !== null && textureRendersTransparent(textureId, part.faceTranslucencies[face]);
  });
}

function isRailPart(part: ResolvedBlockPart): boolean {
  const path = part.blockId.replace(/^minecraft:/, '');
  return path === 'rail' || path.endsWith('_rail');
}

function isAlphaCutoutTexture(textureId: string): boolean {
  const path = textureId.replace(/^minecraft:/, '');
  return (
    /(^|\/)(wheat|carrots|potatoes|beetroots|nether_wart)_stage\d+$/.test(path)
    || path.includes('crop')
    || path.includes('leaves')
    || path.includes('sapling')
    || path.includes('grass')
    || path.includes('fern')
    || path.includes('bush')
    || path.includes('roots')
    || path.includes('vines')
    || path.includes('flower')
    || isCrossPlaneFlowerTexture(path)
    || path.includes('coral')
    || path.includes('mushroom')
    || path.includes('amethyst_bud')
    || path.includes('dripstone')
    || path.startsWith('entity/decorated_pot/')
    || path === 'block/cobweb'
  );
}

function isCrossPlaneFlowerTexture(path: string): boolean {
  return /^block\/(allium|azure_bluet|blue_orchid|dandelion|golden_dandelion|lily_of_the_valley|oxeye_daisy|poppy|.*_tulip)$/.test(path);
}

function isWaterTexture(textureId: string): boolean {
  return textureId.replace(/^minecraft:/, '').startsWith('block/water_');
}

function isBeaconInnerTexture(textureId: string): boolean {
  return textureId.replace(/^minecraft:/, '') === 'block/beacon';
}

function textureRendersTransparent(textureId: string, translucent: boolean): boolean {
  return translucent;
}

function isGlassTexture(textureId: string): boolean {
  const path = textureId.replace(/^minecraft:/, '');
  return path === 'block/glass' || /(^|\/).+_stained_glass(_pane_top)?$/.test(path) || path === 'block/tinted_glass';
}

function translucentTextureOpacity(textureId: string): number {
  const path = textureId.replace(/^minecraft:/, '');
  if (path.startsWith('block/water_')) return 0.54;
  if (isGlassTexture(textureId)) return 0.58;
  return 0.72;
}

function isGlowingTexture(textureId: string): boolean {
  const path = textureId.replace(/^minecraft:/, '');
  return (
    path === 'block/sea_lantern'
    || path === 'block/lantern'
    || path === 'block/soul_lantern'
    || path === 'block/copper_lantern'
    || path.endsWith('_copper_lantern')
    || path === 'block/smoker_front_on'
    || path.endsWith('_emissive')
    || path.startsWith('block/lava_')
    || path.includes('campfire_fire')
  );
}

function emissiveColor(textureId: string): number {
  const path = textureId.replace(/^minecraft:/, '');
  if (path === 'block/sea_lantern') return 0xcff8e9;
  if (path === 'block/soul_lantern') return 0x64d6ff;
  if (isCopperLanternTexturePath(path)) return 0xffffff;
  if (path === 'block/smoker_front_on') return 0xff8a24;
  if (path.endsWith('_emissive')) return 0xffffb8;
  if (path.startsWith('block/lava_') || path.includes('campfire_fire')) return 0xff8a24;
  if (path === 'block/lantern') return 0xffc552;
  return 0x65fff5;
}

function isCopperLanternTexturePath(path: string): boolean {
  return path === 'block/copper_lantern' || path.endsWith('_copper_lantern');
}

function tintColorForPart(textureId: string, tintIndex: number | null, part: ResolvedBlockPart): number | null {
  if (tintIndex === null) return null;
  const path = textureId.replace(/^minecraft:/, '');

  if (part.blockId === 'minecraft:redstone_wire' && tintIndex === 0) {
    return redstoneWireColor(part.blockProperties.power);
  }

  if (path.startsWith('block/water_')) return waterTint;
  if (path.includes('spruce_leaves')) return spruceFoliageTint;
  if (path.includes('birch_leaves')) return birchFoliageTint;
  if (path.includes('leaves') || path.includes('vine') || path.includes('grass') || path.includes('fern')) {
    return defaultFoliageTint;
  }

  return null;
}

function redstoneWireColor(powerValue: string | undefined): number {
  const power = Math.max(0, Math.min(15, Number.parseInt(powerValue ?? '0', 10) || 0));
  const strength = power / 15;
  const red = power === 0 ? 0.3 : strength * 0.6 + 0.4;
  const green = Math.max(0, strength * strength * 0.7 - 0.5);
  const blue = Math.max(0, strength * strength * 0.6 - 0.7);

  return (
    (Math.round(red * 255) << 16)
    | (Math.round(green * 255) << 8)
    | Math.round(blue * 255)
  );
}

function rotatedFace(face: ModelFaceName, part: ResolvedBlockPart): ModelFaceName {
  const rotation = new THREE.Euler(
    THREE.MathUtils.degToRad(part.variantRotation.x),
    THREE.MathUtils.degToRad(part.variantRotation.y),
    0,
    'YXZ',
  );
  const normal = new THREE.Vector3(...faceOffsets[face]).applyEuler(rotation);
  let bestFace = face;
  let bestDot = -Infinity;

  for (const candidate of faceOrder) {
    const dot = normal.dot(new THREE.Vector3(...faceOffsets[candidate]));
    if (dot > bestDot) {
      bestDot = dot;
      bestFace = candidate;
    }
  }

  return bestFace;
}

function variantEuler(part: ResolvedBlockPart): THREE.Euler {
  return new THREE.Euler(
    THREE.MathUtils.degToRad(-part.variantRotation.x),
    THREE.MathUtils.degToRad(-part.variantRotation.y),
    0,
    'YXZ',
  );
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children.pop();
    if (child) child.removeFromParent();
  }
}
