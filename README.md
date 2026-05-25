# schematic-editor

A browser-based Minecraft schematic viewer. Upload or drag in a `.litematic`, `.schem`, `.schematic`, or NBT schematic file and inspect it as a 3D Minecraft model with orbit controls, layer-by-layer viewing, and one-click 360 degree rotation.

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

## Deployment

Pushes to `main` publish the built Vite app to GitHub Pages with GitHub Actions.

## Minecraft Assets

The app serves vanilla blockstates, block models, block textures, and block-entity textures from `public/minecraft-assets/`. These assets were copied from `~/dev/mc-datahub/workspace/versions/26.1.1/decompiled/client/assets/minecraft`.

Rendering display bugs should be fixed through the vanilla model, item display, or special-renderer path. See [docs/rendering-fixes.md](docs/rendering-fixes.md) for the expected workflow.
