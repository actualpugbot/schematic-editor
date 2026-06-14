import { textureUrl } from './minecraftModels';
import { foliageTintForTexturePath } from './foliageTint';

let materialSpriteLookup: Record<string, string> = {};
let materialSpriteLookupPromise: Promise<void> | null = null;

export function loadMaterialSpriteLookup(): Promise<void> {
  materialSpriteLookupPromise ??= import('./data/material_sprite_lookup.json').then((module) => {
    materialSpriteLookup = module.default as Record<string, string>;
  });
  return materialSpriteLookupPromise;
}

export function materialSpriteUrlForStateKey(stateKey: string): string | null {
  const id = normalizeMaterialSpriteId(stateKey);
  const textureRef = materialSpriteLookup[id];
  if (!textureRef) return null;
  return textureRefToUrl(textureRef);
}

// Foliage sprites (short grass, tall grass, ferns, ...) ship grayscale and need
// a biome tint to display in color. Only block/* textures are grayscale; item/*
// sprites (e.g. item/seagrass) are already colored, so leave those untinted.
export function materialSpriteTintForStateKey(stateKey: string): number | null {
  const id = normalizeMaterialSpriteId(stateKey);
  const textureRef = materialSpriteLookup[id];
  if (!textureRef) return null;
  const path = textureRef.replace(/^minecraft:/, '');
  if (!path.startsWith('block/')) return null;
  return foliageTintForTexturePath(textureRef);
}

function normalizeMaterialSpriteId(stateKey: string): string {
  const withoutProperties = stateKey.replace(/\[.*$/, '');
  return withoutProperties.includes(':') ? withoutProperties : `minecraft:${withoutProperties}`;
}

function textureRefToUrl(textureRef: string): string {
  return textureUrl(textureRef);
}
