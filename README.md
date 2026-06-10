# schematic-editor

A browser-based Minecraft schematic editor. Open on a default featured build, use `New` to start from a blank build platform, or upload a `.litematic`, `.schem`, `.schematic`, or NBT schematic file and inspect or edit it as a 3D Minecraft model with orbit controls, layer-by-layer viewing, and one-click 360 degree rotation.

schematic-editor runs entirely in the browser, so schematic files stay on your machine.

## Run Locally

```bash
pnpm install
pnpm dev
```

The app runs at `http://localhost:5173/` by default.

## Supported Schematic Data

- Sponge `.schem` files with `Palette` and `BlockData` varint arrays.
- Legacy MCEdit `.schematic` files with numeric `Blocks` arrays.
- Litematica `.litematic` files with one or more packed regions.
- Gzip/zlib-compressed or raw NBT payloads.

Files are parsed in the browser; uploads are not sent to a server.

## Export

- Export to `.litematic`, `.schem`, or `.schematic` from the top bar.
- `.litematic` is the default export format.
- Legacy `.schematic` export is limited to block states that exist in the older MCEdit format.

## Deployment

Pushes to `main` publish the app to GitHub Pages with GitHub Actions.
Pushes to `ui_redo` trigger a `main`-based deploy so GitHub Pages environment protection can still pass.
The `main` branch is deployed at the site root, and the `ui_redo` branch is deployed at `/new/`.

## Minecraft Assets

The app serves vanilla blockstates, block models, block textures, item textures, and block-entity textures from `public/minecraft-assets/`. Most of these assets were copied from `~/dev/mc-datahub/workspace/versions/26.1.1/decompiled/client/assets/minecraft`, and the item sprite set was sourced from `~/dev/mc-datahub/workspace/datasets/26w14a/images/item`.
