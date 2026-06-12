const assetRoot = `${import.meta.env.BASE_URL}minecraft-assets/assets/minecraft`;

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

function normalizeMaterialSpriteId(stateKey: string): string {
  const withoutProperties = stateKey.replace(/\[.*$/, '');
  return withoutProperties.includes(':') ? withoutProperties : `minecraft:${withoutProperties}`;
}

function textureRefToUrl(textureRef: string): string {
  const normalized = textureRef.replace(/^minecraft:/, '');
  return `${assetRoot}/textures/${normalized}.png`;
}
