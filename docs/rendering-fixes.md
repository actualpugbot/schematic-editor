# Rendering Fixes

This app should render Minecraft materials from the same source of truth Minecraft uses: vanilla blockstates, models, textures, item display transforms, and special block-entity renderers. Display bugs should be fixed in that pipeline, not with CSS-only scaling or one-off fallback art.

## Correct Fix Path

1. Identify whether the block has a normal block model.
   - Check `public/minecraft-assets/assets/minecraft/blockstates/<block>.json`.
   - Follow its model under `models/block/`.
   - If the model has real elements, fix model resolution, texture resolution, tinting, transparency, or camera framing.

2. If the model is empty or only has `particle`, it is a special-rendered block.
   - Examples include beds, chests, signs, banners, and decorated pots.
   - Recreate the vanilla special-renderer geometry in `src/lib/minecraftModels.ts` under `specialBlockEntityParts`.
   - Use the vanilla entity/block-entity texture layout. Do not guess UVs from the laid-out thumbnail shape.

3. For material and block-library thumbnails, frame the rendered object in projected GUI space.
   - Do not fit the camera from the largest world-space dimension.
   - Low or long shapes, such as beds, carpets, panes, signs, and lanterns, look tiny when framed by raw world extents.
   - `src/lib/blockThumbnails.ts` uses projected camera bounds so the icon fills the square based on what the camera actually sees.

4. Use vanilla item model display data when the block has special item presentation.
   - Check `models/item/<block>.json` and its parent templates.
   - Beds use `item/template_bed`, whose `gui` display transform differs from the placed block's physical footprint.
   - Chests use `item/template_chest`.
   - Item display data should guide rotation, scale, and composition for inventory-like previews.

5. Verify visually, not only with TypeScript.
   - Generate thumbnails for the failing block and at least one normal cube, one flat block, and one transparent/cutout block.
   - Inspect the PNG output or a Playwright screenshot of the material list.
   - Run `pnpm build` after the visual check.

## Bed-Specific Notes

Vanilla beds are not ordinary block models. The block model is effectively empty and the client renders two special pieces: head and foot. The bed body texture is authored for a `16 x 16 x 6` entity-model cuboid, then transformed into the placed horizontal bed. If the thumbnail geometry is already laid out as `16 x 6 x 16`, UVs still need to come from the original entity-model dimensions and be remapped onto the laid-down faces.

The material list should show the complete bed item, not a single half and not a physically scaled two-block footprint. Rendering both halves is correct, but thumbnail framing must use projected GUI bounds so the long, shallow model does not collapse into a tiny strip.

Bed thumbnails intentionally normalize to `facing=north` instead of preserving schematic placement direction. This matches the recognizable vanilla inventory-style composition: foot toward the lower-left, pillow toward the upper-right.
