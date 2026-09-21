# Shelfville asset provenance

## Generated packaging atlas

- File: `product-atlas.png`
- Method: built-in image generation tool (not API/CLI fallback).
- Created for this project. Eight fictional retail labels; not official GS product packaging.
- Applied to actual 3D cans, bottles, bags, boxes and cups using UV texture coordinates.
- The flat atlas is not a replacement for the interactive 3D scene.

### Exact generation prompt

Use case: product-mockup
Asset type: Production-ready texture atlas for 3D products on shelves in a Korean convenience-store simulator. This is a flat PRINTED LABEL TEXTURE, not a photograph of objects and not a scene.
Primary request: One square image split into EXACTLY 2 columns and 4 rows of perfectly equal rectangular panels, edge-to-edge without margins or gutters. Each panel is a detailed photorealistic retail packaging front graphic, flat-on with no perspective, no drop shadow, no 3D package silhouette, every panel completely filled with its own background color.
Panel order LEFT to RIGHT, TOP to BOTTOM:
1. warm dark brown cold-brew coffee label, elegant cream text "COLD BREW", roasted bean illustration, small "250 ml".
2. off-white and dark navy protein drink label, bold "PROTEIN", large "20g", minimal milk swirl.
3. golden yellow potato-chip label, bold "POTATO", realistic appetizing potato chips, small green accent.
4. deep forest green rice-triangle label, crisp "RICE", realistic appetizing seaweed rice triangle in lower half.
5. kraft tan mixed-nuts label, "DAILY NUTS", almonds and walnuts.
6. icy turquoise sparkling drink label, "ZERO", bubbles and lime slice.
7. deep vermilion noodle-cup label, "HOT NOODLE", appetizing cooked noodles, tiny heat symbols.
8. dusty rose chocolate-cookie label, "COCOA COOKIE", rich chocolate cookies.
Style: believable premium Korean convenience-store retail packaging, fine typography, small ingredient-like decorative text, food photography detail, rich restrained colors.
Constraints: equal 2x4 grid with exact aligned boundaries, full bleed panels, front print only, neutral uniform illumination, no cast shadows, no outside frame, no real existing brand names, no watermark. This image will be UV-mapped onto actual 3D geometry.

## Original Blender assets

- `shopper.glb`: 19-bone weighted skin, 8 exported animation clips.
- `coffee-machine.glb`: bevelled housing, brew cavity, hopper, spouts, cup, grille and controls.
- `checkout-terminal.glb`: display, stand, payment terminal and keys.
- Editable `.blend` outputs are kept locally and excluded from the public branch:
  Blender may embed local file-browser paths in them.
- Rebuild scripts: `../blender/build_shopper.py`, `../blender/build_fixtures.py`.
- Created procedurally in the installed Blender 5.0.1. No downloaded character models or motion-capture clips.

To recreate the editable source and runtime GLBs, run from `demo` with Blender 5:

```bash
blender --background --factory-startup --python blender/build_shopper.py
blender --background --factory-startup --python blender/build_fixtures.py
```

These scripts replace the named generated GLBs and `.blend` outputs. Preserve any
manual modeling changes separately before rebuilding. Blender is not needed to run
the web demo. The generated source may again contain machine-local metadata; review
it before publishing. The scripts reproduce geometry and clips, not guaranteed
byte-identical files across Blender versions.

The shopper is a semi-realistic original prototype, not a photogrammetry scan.
Outfits and heights vary at runtime; all customers currently share one base body and hair model.
Hand articulation is baked into the mesh; fingers do not have individual bones.
Shelf-specific reach animations are authored clips, not a full IK/contact or physics system.

## Runtime references

- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [Three.js SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html)

Independent skeleton clones and animation mixers allow each customer's motion state to differ.
