# Dino Egg Bros

A Snow Bros-style 2.5D arcade game in three.js. A little dino traps alien invaders in eggs, then kicks the eggs to bowl through the rest.

## Run

Install dependencies once (`index.html` loads three.js from `node_modules/`):

```bash
npm install
```

ES modules and the GLB need an HTTP server (not `file://`):

```bash
python -m http.server 8765
```

Open http://localhost:8765.

`npm run build` bundles a minified, self-contained copy into `dist/` for static hosting.

## Controls

| Action | Keys |
| --- | --- |
| Move | ← → / A D |
| Jump | Z / Space / ↑ (↓ + jump drops through a platform) |
| Throw egg | X / J (hold for auto-fire) |
| Kick a full egg | Throw while standing next to it |
| Pause / Mute | P or Esc / M |

Gamepads are supported.

**Phones and tablets** (landscape): drag anywhere on the left half of the screen to move (hold down + JUMP to drop through a platform); JUMP and THROW buttons sit bottom-right, and holding THROW keeps throwing. Phones render at a lower resolution with a smaller shadow map and sparser grass. The game pauses when the phone is turned upright or the app is backgrounded.

## Layout

- `assets/models.glb`: every 3D model, built procedurally in Blender.
- `tools/blender/`: the Blender scripts that generate the models (`lib.py`, `characters.py`, `environment.py`) and `assets.blend`.
  Rebuild every model (headless, never inside an open Blender session) with
  `blender -b --factory-startup -P tools/blender/build_all.py`; add `-- --preview out.png` for a contact sheet.
  Re-bake a texture set with `blender -b --factory-startup -P tools/blender/bake_run.py -- rock`.
  The environment kit is faceted (flat-shaded, chamfered, chiselled) after the concept art, with several
  variants per piece; `src/world/level.js` randomises depth, tilt and offset of every placed piece.
- `src/engine/`: input, synthesized WebAudio SFX and music, particles and shake, post-processing.
- `src/world/`: stage maps with one-way platforms, and the parallax background.
- `src/entities/`: player, alien (capture, egg, and roll state machine), shots, items, boss, and hunter UFO.
- `src/game.js`: game flow, Smash-style camera director, hitstop, slow-mo, scoring.

`window.__game.debugStep(frames, dt, keys)` advances the game deterministically for testing.

## Credits

- Sky and lighting: [Spiaggia di Mondello](https://polyhaven.com/a/spiaggia_di_mondello) HDRI by Andreas Mischok,
  Poly Haven, CC0. The game ships downscaled copies in `assets/sky/` (`sky_2k.exr`, `sky_1k.exr`).
  The 4K master is not included; to regenerate the sky files, download the 4K EXR from that page and save it
  as `tools/hdri/mondello_4k_master.exr`.
- [three.js](https://threejs.org) (MIT).
