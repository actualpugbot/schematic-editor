# Future work: in-3D creative building

Status: **deferred** — captured here so the idea isn't lost.

## Context

The "build anything" feature shipped as a **shared manual materials list**: from the
Resource Calculator, Shopping List, or Shulker Box views, a user can open the
**Add materials** picker, choose any block from the full creative palette with a
quantity (items or stacks), and that list feeds the breakdown / shopping / shulker
tools — with or without a loaded schematic. See `src/App.tsx` (`manualMaterials`,
`mergeManualMaterials`, the material picker modal) and `src/styles.css`
(`.material-picker-*`).

The existing **Edit mode** already covers placing any block in 3D, creative-style
(block library grid, build/select tools, undo/redo, find & replace, rotate/move).
The "New" button (`createNewSchematic`) drops you onto a 32×32 stone platform in
Edit mode. We deliberately scoped the recent work to the materials-list pipeline
and left the in-3D building experience as-is.

The items below are enhancements to that in-3D building experience that we chose
**not** to build yet. They are nice-to-haves, not blockers.

## Ideas

- **Hotbar / quick palette.** A persistent 9-slot hotbar (number-key selectable)
  seeded from `defaultHotbarBlocks` and recently/most-used blocks, so common blocks
  are one keypress away instead of a sidebar scroll. (`defaultHotbarBlocks` already
  exists in `src/App.tsx`.)
- **Blank-canvas option.** Offer "empty void" vs. the current stone-platform start
  when creating a new build, plus a configurable platform size/material. Today
  `createStarterModel()` always makes a 32×24×32 stone floor.
- **Volume fill / replace.** Fill a cuboid selection with the active block, hollow
  it, or replace within the selection — building on the existing cuboid selection
  and Find & Replace plumbing rather than placing block-by-block.
- **Line / shape tools.** Draw straight lines, rectangles, and spheres of the
  active block.
- **Symmetry / mirror mode.** Mirror placements across an axis or plane for
  symmetric builds.
- **Drag-to-paint placement.** Click-drag to place a run of blocks on a plane in one
  gesture, with shift-constrain to an axis.
- **Eyedropper.** Pick the block under the cursor as the active build block
  (pairs well with the hotbar).
- **Seed a build from the manual list.** Let a hand-built materials list scaffold a
  starter palette / hotbar when entering Edit mode, closing the loop between the two
  workflows.

## Pointers

- Block palette + grouping: `blockLibraryItems`, `groupBlocksByCreativeCategory`,
  creative inventory data in `src/lib/data/creative_inventory.json`.
- Edit tools and placement: `editTool`, `chooseBuildBlock`, `setBlockAt`,
  cuboid selection + `replaceBlocks` in `src/App.tsx`; rendering in
  `src/components/Viewer3D.tsx`.
