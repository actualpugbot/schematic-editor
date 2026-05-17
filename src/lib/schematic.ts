import {
  asByteArray,
  asIntArray,
  asList,
  asLongArray,
  asNumber,
  asString,
  isCompound,
  parseNbt,
  type NbtCompound,
} from './nbt';
import { blockAppearance, isAirBlock, legacyBlockAppearance } from './blockColors';

export interface SchematicDimensions {
  width: number;
  height: number;
  length: number;
}

export interface SchematicOrigin {
  x: number;
  y: number;
  z: number;
}

export interface VoxelBlock {
  x: number;
  y: number;
  z: number;
  name: string;
  stateKey: string;
  color: number;
  material: string;
  playerHeadTexture?: PlayerHeadTexture;
}

export interface PlayerHeadTexture {
  id: string;
  url: string;
}

export interface SchematicModel {
  name: string;
  source: 'Sponge .schem' | 'Legacy .schematic' | 'Litematica .litematic' | 'Sample';
  dimensions: SchematicDimensions;
  origin: SchematicOrigin;
  blocks: VoxelBlock[];
  paletteSize: number;
  layerCounts: number[];
  warnings: string[];
}

interface ParseOptions {
  fileName?: string;
}

export function parseSchematic(buffer: ArrayBuffer, options: ParseOptions = {}): SchematicModel {
  const root = parseNbt(buffer).value;
  const schem = unwrapSchematic(root);

  if (isCompound(schem.Regions)) {
    return parseLitematic(root, options.fileName);
  }

  if (readSpongeBlockStorage(schem)) {
    return parseSpongeSchematic(schem, options.fileName);
  }

  if (asByteArray(schem.Blocks)) {
    return parseLegacySchematic(schem, options.fileName);
  }

  throw new Error('This file is valid NBT, but it does not look like a supported .schem, .schematic, or .litematic file.');
}

export function createSampleModel(): SchematicModel {
  const width = 18;
  const height = 13;
  const length = 18;
  const blocks: VoxelBlock[] = [];

  const add = (x: number, y: number, z: number, name: string) => {
    const appearance = blockAppearance(name);
    blocks.push({ x, y, z, name, stateKey: name, color: appearance.color, material: appearance.label });
  };

  for (let x = 1; x < width - 1; x += 1) {
    for (let z = 1; z < length - 1; z += 1) {
      add(x, 0, z, (x + z) % 5 === 0 ? 'minecraft:moss_block' : 'minecraft:stone_bricks');
    }
  }

  for (let y = 1; y <= 6; y += 1) {
    for (const x of [2, width - 3]) {
      for (let z = 2; z < length - 2; z += 1) {
        if (z === 8 || z === 9) continue;
        add(x, y, z, y % 3 === 0 ? 'minecraft:oak_log' : 'minecraft:oak_planks');
      }
    }

    for (const z of [2, length - 3]) {
      for (let x = 2; x < width - 2; x += 1) {
        add(x, y, z, y % 3 === 0 ? 'minecraft:oak_log' : 'minecraft:oak_planks');
      }
    }
  }

  for (let y = 1; y <= 5; y += 1) {
    add(5, y, 5, 'minecraft:stone_bricks');
    add(12, y, 5, 'minecraft:stone_bricks');
    add(5, y, 12, 'minecraft:stone_bricks');
    add(12, y, 12, 'minecraft:stone_bricks');
  }

  for (let y = 2; y <= 4; y += 1) {
    add(8, y, 2, 'minecraft:glass');
    add(9, y, 2, 'minecraft:glass');
    add(2, y, 8, 'minecraft:glass');
    add(2, y, 9, 'minecraft:glass');
    add(15, y, 8, 'minecraft:glass');
    add(15, y, 9, 'minecraft:glass');
  }

  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < length; z += 1) {
      const edgeDistance = Math.min(x, z, width - 1 - x, length - 1 - z);
      const roofY = 7 + Math.max(0, 4 - edgeDistance);
      if (edgeDistance < 6 && roofY < height) {
        add(x, roofY, z, edgeDistance % 2 ? 'minecraft:dark_oak_stairs' : 'minecraft:dark_oak_planks');
      }
    }
  }

  for (let y = 1; y < height; y += 1) {
    if (y % 2 === 1) add(8, y, 8, 'minecraft:torch');
  }

  return finalizeModel({
    name: 'Sample workshop house',
    source: 'Sample',
    dimensions: { width, height, length },
    origin: { x: 0, y: 0, z: 0 },
    blocks,
    paletteSize: 9,
    warnings: [],
  });
}

function parseSpongeSchematic(schematic: NbtCompound, fileName = 'Uploaded schematic'): SchematicModel {
  const dimensions = readDimensions(schematic);
  const blockStorage = readSpongeBlockStorage(schematic);

  if (!blockStorage) {
    throw new Error('The .schem file is missing its palette or block data.');
  }

  const paletteEntries = buildPaletteEntries(blockStorage.palette);
  const paletteSize = paletteEntries.filter(Boolean).length;
  const blockIds = decodeVarInts(blockStorage.data, dimensions.width * dimensions.height * dimensions.length);
  const blocks: VoxelBlock[] = [];
  const warnings: string[] = [];

  if (blockIds.length < dimensions.width * dimensions.height * dimensions.length) {
    warnings.push('The block data ended before the declared dimensions were filled.');
  }

  for (let index = 0; index < blockIds.length; index += 1) {
    const paletteIndex = blockIds[index];
    const stateKey = paletteEntries[paletteIndex] ?? `unknown_palette_${paletteIndex}`;
    if (isAirBlock(stateKey)) continue;

    const x = index % dimensions.width;
    const z = Math.floor(index / dimensions.width) % dimensions.length;
    const y = Math.floor(index / (dimensions.width * dimensions.length));
    const name = stateKey.split('[')[0];
    const appearance = blockAppearance(name);

    blocks.push({
      x,
      y,
      z,
      name,
      stateKey,
      color: appearance.color,
      material: appearance.label,
    });
  }

  return finalizeModel({
    name: fileName,
    source: 'Sponge .schem',
    dimensions,
    origin: readVector3(schematic.Offset, { x: 0, y: 0, z: 0 }),
    blocks,
    paletteSize,
    warnings,
  });
}

function readSpongeBlockStorage(schematic: NbtCompound): { palette: NbtCompound; data: Uint8Array } | null {
  if (isCompound(schematic.Palette)) {
    const data = asByteArray(schematic.BlockData);
    if (data) {
      return { palette: schematic.Palette, data };
    }
  }

  const blocks = isCompound(schematic.Blocks) ? schematic.Blocks : null;
  if (blocks && isCompound(blocks.Palette)) {
    const data = asByteArray(blocks.Data);
    if (data) {
      return { palette: blocks.Palette, data };
    }
  }

  return null;
}

function parseLegacySchematic(schematic: NbtCompound, fileName = 'Uploaded schematic'): SchematicModel {
  const dimensions = readDimensions(schematic);
  const blocksArray = asByteArray(schematic.Blocks);
  const addBlocksArray = asByteArray(schematic.AddBlocks);
  const dataArray = asByteArray(schematic.Data);
  const blocks: VoxelBlock[] = [];
  const warnings: string[] = [];
  const totalBlocks = dimensions.width * dimensions.height * dimensions.length;

  if (!blocksArray) {
    throw new Error('The .schematic file is missing its Blocks array.');
  }

  if (blocksArray.length < totalBlocks) {
    warnings.push('The Blocks array is shorter than the declared dimensions.');
  }

  for (let index = 0; index < Math.min(blocksArray.length, totalBlocks); index += 1) {
    const low = blocksArray[index];
    const high = addBlocksArray ? readLegacyHighBits(addBlocksArray, index) : 0;
    const id = ((high << 8) | low) >>> 0;
    if (id === 0) continue;

    const metadata = dataArray?.[index] ?? 0;
    const x = index % dimensions.width;
    const z = Math.floor(index / dimensions.width) % dimensions.length;
    const y = Math.floor(index / (dimensions.width * dimensions.length));
    const name = legacyBlockStateName(id, metadata);
    const appearance = name.startsWith('minecraft:legacy_block_') ? legacyBlockAppearance(id) : blockAppearance(name);

    blocks.push({
      x,
      y,
      z,
      name,
      stateKey: name,
      color: appearance.color,
      material: appearance.label,
    });
  }

  normalizeLegacyStairShapes(blocks);

  return finalizeModel({
    name: fileName,
    source: 'Legacy .schematic',
    dimensions,
    origin: { x: 0, y: 0, z: 0 },
    blocks,
    paletteSize: new Set(blocks.map((block) => block.name)).size,
    warnings,
  });
}

function normalizeLegacyStairShapes(blocks: VoxelBlock[]) {
  const blocksByPosition = new Map<string, VoxelBlock>();
  for (const block of blocks) {
    blocksByPosition.set(positionKey(block.x, block.y, block.z), block);
  }

  for (const block of blocks) {
    const stair = parseStairState(block.stateKey);
    if (!stair) continue;

    const shape = legacyStairShape(block, stair, blocksByPosition);
    block.stateKey = setBlockStateProperty(block.stateKey, 'shape', shape);
  }
}

function legacyStairShape(
  block: VoxelBlock,
  stair: StairState,
  blocksByPosition: Map<string, VoxelBlock>,
): 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right' {
  const front = stairNeighbor(block, stair.facing, blocksByPosition);
  if (front && front.half === stair.half && stairAxis(front.facing) !== stairAxis(stair.facing)) {
    if (legacyStairHasDifferentOrientation(block, stair, oppositeFacing(front.facing), blocksByPosition)) {
      return front.facing === rotateFacingCounterclockwise(stair.facing) ? 'outer_left' : 'outer_right';
    }
  }

  const back = stairNeighbor(block, oppositeFacing(stair.facing), blocksByPosition);
  if (back && back.half === stair.half && stairAxis(back.facing) !== stairAxis(stair.facing)) {
    if (legacyStairHasDifferentOrientation(block, stair, back.facing, blocksByPosition)) {
      return back.facing === rotateFacingCounterclockwise(stair.facing) ? 'inner_left' : 'inner_right';
    }
  }

  return 'straight';
}

interface StairState {
  facing: HorizontalFacing;
  half: 'top' | 'bottom';
}

type HorizontalFacing = 'north' | 'south' | 'west' | 'east';

function parseStairState(stateKey: string): StairState | null {
  if (!/^minecraft:[a-z0-9_]+_stairs\[/.test(stateKey)) return null;

  const facing = blockStateProperty(stateKey, 'facing');
  const half = blockStateProperty(stateKey, 'half');
  if (!isHorizontalFacing(facing) || (half !== 'top' && half !== 'bottom')) return null;

  return { facing, half };
}

function stairNeighbor(
  block: VoxelBlock,
  facing: HorizontalFacing,
  blocksByPosition: Map<string, VoxelBlock>,
): StairState | null {
  const offset = horizontalFacingOffset(facing);
  const neighbor = blocksByPosition.get(positionKey(block.x + offset.x, block.y, block.z + offset.z));
  return neighbor ? parseStairState(neighbor.stateKey) : null;
}

function legacyStairHasDifferentOrientation(
  block: VoxelBlock,
  stair: StairState,
  facing: HorizontalFacing,
  blocksByPosition: Map<string, VoxelBlock>,
): boolean {
  const neighbor = stairNeighbor(block, facing, blocksByPosition);
  return !neighbor || neighbor.facing !== stair.facing || neighbor.half !== stair.half;
}

function blockStateProperty(stateKey: string, key: string): string | null {
  const properties = /\[(?<properties>.*)\]$/.exec(stateKey)?.groups?.properties;
  if (!properties) return null;

  for (const pair of properties.split(',')) {
    const [propertyKey, propertyValue] = pair.split('=');
    if (propertyKey === key) return propertyValue ?? null;
  }

  return null;
}

function setBlockStateProperty(stateKey: string, key: string, value: string): string {
  const match = /^(?<id>[^\[]+)\[(?<properties>.*)\]$/.exec(stateKey);
  if (!match?.groups) return stateKey;

  const properties = match.groups.properties
    .split(',')
    .map((pair) => {
      const [propertyKey] = pair.split('=');
      return propertyKey === key ? `${key}=${value}` : pair;
    });

  if (!properties.some((pair) => pair.startsWith(`${key}=`))) {
    properties.push(`${key}=${value}`);
  }

  return `${match.groups.id}[${properties.join(',')}]`;
}

function positionKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function isHorizontalFacing(value: string | null): value is HorizontalFacing {
  return value === 'north' || value === 'south' || value === 'west' || value === 'east';
}

function stairAxis(facing: HorizontalFacing): 'x' | 'z' {
  return facing === 'east' || facing === 'west' ? 'x' : 'z';
}

function oppositeFacing(facing: HorizontalFacing): HorizontalFacing {
  switch (facing) {
    case 'north':
      return 'south';
    case 'south':
      return 'north';
    case 'west':
      return 'east';
    case 'east':
      return 'west';
  }
}

function rotateFacingCounterclockwise(facing: HorizontalFacing): HorizontalFacing {
  switch (facing) {
    case 'north':
      return 'west';
    case 'south':
      return 'east';
    case 'west':
      return 'south';
    case 'east':
      return 'north';
  }
}

function horizontalFacingOffset(facing: HorizontalFacing): { x: number; z: number } {
  switch (facing) {
    case 'north':
      return { x: 0, z: -1 };
    case 'south':
      return { x: 0, z: 1 };
    case 'west':
      return { x: -1, z: 0 };
    case 'east':
      return { x: 1, z: 0 };
  }
}

function parseLitematic(root: NbtCompound, fileName = 'Uploaded litematic'): SchematicModel {
  const regions = isCompound(root.Regions) ? root.Regions : null;
  if (!regions) {
    throw new Error('The .litematic file is missing its Regions compound.');
  }

  const blocksWithWorldCoords: VoxelBlock[] = [];
  const warnings: string[] = [];
  const paletteNames = new Set<string>();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const [regionName, rawRegion] of Object.entries(regions)) {
    if (!isCompound(rawRegion)) {
      warnings.push(`Skipped malformed litematic region "${regionName}".`);
      continue;
    }

    const signedSize = readVector3(rawRegion.Size, { x: 0, y: 0, z: 0 });
    const position = readVector3(rawRegion.Position, { x: 0, y: 0, z: 0 });
    const dimensions = {
      width: Math.abs(signedSize.x),
      height: Math.abs(signedSize.y),
      length: Math.abs(signedSize.z),
    };
    const palette = asList(rawRegion.BlockStatePalette);
    const blockStates = asLongArray(rawRegion.BlockStates);

    if (!dimensions.width || !dimensions.height || !dimensions.length || !palette || !blockStates) {
      warnings.push(`Skipped incomplete litematic region "${regionName}".`);
      continue;
    }

    const bounds = regionBounds(position, signedSize);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    minZ = Math.min(minZ, bounds.minZ);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
    maxZ = Math.max(maxZ, bounds.maxZ);

    const paletteEntries = palette.map(readLitematicPaletteEntry);
    const playerHeadTextures = readLitematicPlayerHeadTextures(rawRegion);
    const totalBlocks = dimensions.width * dimensions.height * dimensions.length;
    const bitsPerEntry = Math.max(2, Math.ceil(Math.log2(Math.max(1, paletteEntries.length))));
    const blockIds = decodePackedLongArray(blockStates, totalBlocks, bitsPerEntry);

    for (let index = 0; index < blockIds.length; index += 1) {
      const paletteIndex = blockIds[index];
      const stateKey = paletteEntries[paletteIndex] ?? `unknown_palette_${paletteIndex}`;
      paletteNames.add(stateKey);
      if (isAirBlock(stateKey)) continue;

      const localX = index % dimensions.width;
      const localZ = Math.floor(index / dimensions.width) % dimensions.length;
      const localY = Math.floor(index / (dimensions.width * dimensions.length));
      const worldX = position.x + litematicStorageToRegionCoordinate(localX, signedSize.x);
      const worldY = position.y + litematicStorageToRegionCoordinate(localY, signedSize.y);
      const worldZ = position.z + litematicStorageToRegionCoordinate(localZ, signedSize.z);
      const name = stateKey.split('[')[0];
      const appearance = blockAppearance(name);

      blocksWithWorldCoords.push({
        x: worldX,
        y: worldY,
        z: worldZ,
        name,
        stateKey,
        color: appearance.color,
        material: appearance.label,
        playerHeadTexture: playerHeadTextures.get(positionKey(worldX, worldY, worldZ)),
      });
    }
  }

  if (blocksWithWorldCoords.length === 0) {
    throw new Error('No visible blocks were found in this .litematic file.');
  }

  const blocks = blocksWithWorldCoords.map((block) => ({
    ...block,
    x: block.x - minX,
    y: block.y - minY,
    z: block.z - minZ,
  }));

  const metadata = isCompound(root.Metadata) ? root.Metadata : null;
  const metadataName = metadata ? asString(metadata.Name) : '';

  return finalizeModel({
    name: metadataName || fileName,
    source: 'Litematica .litematic',
    dimensions: {
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      length: maxZ - minZ + 1,
    },
    origin: { x: minX, y: minY, z: minZ },
    blocks,
    paletteSize: paletteNames.size,
    warnings,
  });
}

function finalizeModel(model: Omit<SchematicModel, 'layerCounts'>): SchematicModel {
  const layerCounts = Array.from({ length: model.dimensions.height }, () => 0);

  for (const block of model.blocks) {
    if (block.y >= 0 && block.y < layerCounts.length) {
      layerCounts[block.y] += 1;
    }
  }

  return {
    ...model,
    layerCounts,
  };
}

function unwrapSchematic(root: NbtCompound): NbtCompound {
  if (isCompound(root.Schematic)) {
    return root.Schematic;
  }

  return root;
}

function readDimensions(schematic: NbtCompound): SchematicDimensions {
  const width = asNumber(schematic.Width);
  const height = asNumber(schematic.Height);
  const length = asNumber(schematic.Length);

  if (width <= 0 || height <= 0 || length <= 0) {
    throw new Error('The schematic has invalid dimensions.');
  }

  return { width, height, length };
}

function buildPaletteEntries(palette: NbtCompound): string[] {
  const entries: string[] = [];

  for (const [blockName, rawIndex] of Object.entries(palette)) {
    const index = asNumber(rawIndex, -1);
    if (index >= 0) {
      entries[index] = asString(blockName, blockName);
    }
  }

  return entries;
}

function decodeVarInts(bytes: Uint8Array, expectedLength: number): number[] {
  const values: number[] = [];
  let offset = 0;

  while (offset < bytes.length && values.length < expectedLength) {
    let value = 0;
    let shift = 0;

    while (true) {
      if (offset >= bytes.length) {
        throw new Error('A palette varint ended unexpectedly.');
      }

      const byte = bytes[offset];
      offset += 1;
      value |= (byte & 0x7f) << shift;

      if ((byte & 0x80) === 0) {
        values.push(value);
        break;
      }

      shift += 7;
      if (shift > 35) {
        throw new Error('A palette varint is too large.');
      }
    }
  }

  return values;
}

function readLegacyHighBits(addBlocks: Uint8Array, index: number): number {
  const packed = addBlocks[Math.floor(index / 2)] ?? 0;
  return index % 2 === 0 ? packed & 0x0f : (packed >> 4) & 0x0f;
}

function readLitematicPaletteEntry(value: unknown): string {
  if (!isCompound(value)) return 'minecraft:air';

  const name = asString(value.Name, 'minecraft:air');
  const properties = isCompound(value.Properties) ? value.Properties : null;
  if (!properties || Object.keys(properties).length === 0) return name;

  const serializedProperties = Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, rawValue]) => `${key}=${asString(rawValue, String(rawValue))}`)
    .join(',');

  return `${name}[${serializedProperties}]`;
}

function readLitematicPlayerHeadTextures(region: NbtCompound): Map<string, PlayerHeadTexture> {
  const texturesByPosition = new Map<string, PlayerHeadTexture>();
  const tileEntities = asList(region.TileEntities);
  if (!tileEntities) return texturesByPosition;

  for (const rawTileEntity of tileEntities) {
    if (!isCompound(rawTileEntity) || asString(rawTileEntity.id) !== 'minecraft:skull') continue;

    const x = asNumber(rawTileEntity.x, Number.NaN);
    const y = asNumber(rawTileEntity.y, Number.NaN);
    const z = asNumber(rawTileEntity.z, Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    const texture = readPlayerHeadTexture(rawTileEntity);
    if (!texture) continue;

    texturesByPosition.set(positionKey(x, y, z), texture);
  }

  return texturesByPosition;
}

function readPlayerHeadTexture(tileEntity: NbtCompound): PlayerHeadTexture | null {
  const rawValue = readProfileTextureValue(tileEntity.profile) ?? readLegacyProfileTextureValue(tileEntity.SkullOwner);
  if (!rawValue) return null;

  try {
    const decoded = JSON.parse(atob(rawValue)) as { textures?: { SKIN?: { url?: string } } };
    const rawUrl = decoded.textures?.SKIN?.url;
    if (!rawUrl) return null;

    const id = rawUrl.split('/').filter(Boolean).at(-1);
    if (!id) return null;

    return {
      id,
      url: `https://textures.minecraft.net/texture/${id}`,
    };
  } catch {
    return null;
  }
}

function readProfileTextureValue(profile: unknown): string | null {
  if (!isCompound(profile)) return null;

  const properties = asList(profile.properties);
  const textureProperty = properties?.find((property) => isCompound(property) && asString(property.name) === 'textures');
  return isCompound(textureProperty) ? asString(textureProperty.value) : null;
}

function readLegacyProfileTextureValue(skullOwner: unknown): string | null {
  if (!isCompound(skullOwner) || !isCompound(skullOwner.Properties)) return null;

  const textures = asList(skullOwner.Properties.textures);
  const textureProperty = textures?.find(isCompound);
  return isCompound(textureProperty) ? asString(textureProperty.Value ?? textureProperty.value) : null;
}

function readVector3(value: unknown, fallback: { x: number; y: number; z: number }) {
  const intArray = asIntArray(value);
  if (intArray && intArray.length >= 3) {
    return { x: intArray[0], y: intArray[1], z: intArray[2] };
  }

  if (Array.isArray(value) && value.length >= 3) {
    return {
      x: asNumber(value[0], fallback.x),
      y: asNumber(value[1], fallback.y),
      z: asNumber(value[2], fallback.z),
    };
  }

  if (isCompound(value)) {
    return {
      x: asNumber(value.x ?? value.X, fallback.x),
      y: asNumber(value.y ?? value.Y, fallback.y),
      z: asNumber(value.z ?? value.Z, fallback.z),
    };
  }

  return fallback;
}

function regionBounds(position: SchematicOrigin, signedSize: SchematicOrigin) {
  const endX = position.x + signedSize.x - Math.sign(signedSize.x || 1);
  const endY = position.y + signedSize.y - Math.sign(signedSize.y || 1);
  const endZ = position.z + signedSize.z - Math.sign(signedSize.z || 1);

  return {
    minX: Math.min(position.x, endX),
    minY: Math.min(position.y, endY),
    minZ: Math.min(position.z, endZ),
    maxX: Math.max(position.x, endX),
    maxY: Math.max(position.y, endY),
    maxZ: Math.max(position.z, endZ),
  };
}

function litematicStorageToRegionCoordinate(storageCoordinate: number, signedSize: number): number {
  return signedSize < 0 ? storageCoordinate + signedSize + 1 : storageCoordinate;
}

function decodePackedLongArray(longs: BigInt64Array, expectedLength: number, bitsPerEntry: number): number[] {
  const values: number[] = [];
  const mask = (1n << BigInt(bitsPerEntry)) - 1n;

  for (let index = 0; index < expectedLength; index += 1) {
    const bitIndex = index * bitsPerEntry;
    const longIndex = Math.floor(bitIndex / 64);
    const startBit = bitIndex % 64;

    if (longIndex >= longs.length) break;

    let packed = BigInt.asUintN(64, longs[longIndex]) >> BigInt(startBit);
    const bitsRead = 64 - startBit;

    if (bitsRead < bitsPerEntry && longIndex + 1 < longs.length) {
      packed |= BigInt.asUintN(64, longs[longIndex + 1]) << BigInt(bitsRead);
    }

    values.push(Number(packed & mask));
  }

  return values;
}

function legacyBlockStateName(id: number, metadata = 0): string {
  const legacyStairs = legacyStairsName(id);
  if (legacyStairs) {
    return `minecraft:${legacyStairs}[facing=${legacyStairsFacing(metadata)},half=${legacyStairsHalf(metadata)},shape=straight]`;
  }

  if (id === 29 || id === 33) {
    const facing = legacyPistonFacing(metadata);
    const extended = (metadata & 0x8) !== 0;
    const block = id === 29 ? 'sticky_piston' : 'piston';
    return `minecraft:${block}[extended=${extended},facing=${facing}]`;
  }

  if (id === 34) {
    const facing = legacyPistonFacing(metadata);
    const type = (metadata & 0x8) !== 0 ? 'sticky' : 'normal';
    return `minecraft:piston_head[facing=${facing},short=false,type=${type}]`;
  }

  const names = new Map<number, string>([
    [1, 'minecraft:stone'],
    [2, 'minecraft:grass_block'],
    [3, 'minecraft:dirt'],
    [4, 'minecraft:cobblestone'],
    [5, 'minecraft:oak_planks'],
    [7, 'minecraft:bedrock'],
    [8, 'minecraft:water'],
    [9, 'minecraft:water'],
    [10, 'minecraft:lava'],
    [11, 'minecraft:lava'],
    [12, 'minecraft:sand'],
    [13, 'minecraft:gravel'],
    [17, 'minecraft:oak_log'],
    [18, 'minecraft:oak_leaves'],
    [20, 'minecraft:glass'],
    [35, 'minecraft:white_wool'],
    [41, 'minecraft:gold_block'],
    [42, 'minecraft:iron_block'],
    [45, 'minecraft:bricks'],
    [49, 'minecraft:obsidian'],
    [57, 'minecraft:diamond_block'],
    [73, 'minecraft:redstone_ore'],
    [98, 'minecraft:stone_bricks'],
    [133, 'minecraft:emerald_block'],
    [138, 'minecraft:beacon'],
    [155, 'minecraft:quartz_block'],
    [159, 'minecraft:terracotta'],
    [160, 'minecraft:glass_pane'],
    [172, 'minecraft:terracotta'],
    [251, 'minecraft:white_concrete'],
    [252, 'minecraft:white_concrete_powder'],
  ]);

  return names.get(id) ?? `minecraft:legacy_block_${id}`;
}

function legacyStairsName(id: number): string | null {
  const names = new Map<number, string>([
    [53, 'oak_stairs'],
    [67, 'cobblestone_stairs'],
    [108, 'brick_stairs'],
    [109, 'stone_brick_stairs'],
    [114, 'nether_brick_stairs'],
    [128, 'sandstone_stairs'],
    [134, 'spruce_stairs'],
    [135, 'birch_stairs'],
    [136, 'jungle_stairs'],
    [156, 'quartz_stairs'],
    [163, 'acacia_stairs'],
    [164, 'dark_oak_stairs'],
    [180, 'red_sandstone_stairs'],
    [203, 'purpur_stairs'],
  ]);

  return names.get(id) ?? null;
}

function legacyStairsFacing(metadata: number): string {
  switch (metadata & 0x3) {
    case 0:
      return 'east';
    case 1:
      return 'west';
    case 2:
      return 'south';
    case 3:
      return 'north';
    default:
      return 'east';
  }
}

function legacyStairsHalf(metadata: number): string {
  return (metadata & 0x4) !== 0 ? 'top' : 'bottom';
}

function legacyPistonFacing(metadata: number): string {
  switch (metadata & 0x7) {
    case 0:
      return 'down';
    case 1:
      return 'up';
    case 2:
      return 'north';
    case 3:
      return 'south';
    case 4:
      return 'west';
    case 5:
      return 'east';
    default:
      return 'north';
  }
}
