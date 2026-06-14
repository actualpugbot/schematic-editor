// Minecraft ships foliage and water textures grayscale and recolors them per
// biome at render time. We apply a representative tint so they don't display in
// black and white. Shared by the 3D thumbnail renderer and the flat material
// sprites in material lists.

export const defaultFoliageTint = 0x48b518;
export const birchFoliageTint = 0x80a755;
export const spruceFoliageTint = 0x619961;
export const waterTint = 0x4f9dff;

// Returns the tint to multiply onto a grayscale foliage texture, or null when
// the texture is not tinted foliage.
export function foliageTintForTexturePath(textureId: string): number | null {
  const path = textureId.replace(/^minecraft:/, '');
  if (path.includes('spruce_leaves')) return spruceFoliageTint;
  if (path.includes('birch_leaves')) return birchFoliageTint;
  if (path.includes('leaves') || path.includes('vine') || path.includes('grass') || path.includes('fern')
    || path.includes('bush') || path.includes('lily_pad')) {
    return defaultFoliageTint;
  }
  return null;
}
