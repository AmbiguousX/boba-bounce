# Boba Bounce

Bounce Flappy Jack across a cup of hopping tapioca pearls for two minutes. Chain bounces without touching the floor for combos, grab the golden boba, and score double in the last 20 seconds of fever.

Made for OpenGame's Game Jam #1.

## Play locally

The game is static files in `game/`, with no build step and nothing loaded from the network.

```bash
cd game && python3 -m http.server 8000
```

Then open http://localhost:8000.

**Controls:** WASD or arrow keys to move, Space to jump (hold for a higher jump), 1–8 for Jack's faces, M to mute. On a phone, drag anywhere to move, and tap JUMP or a second finger to jump.

## Layout

- `game/index.html`, `game/style.css`: the page and its interface
- `game/src/game.js`: the cup, the boba, the player controller and the game rules
- `game/src/jack.js`: Flappy Jack as the player
- `game/src/fx.js`: sky, lighting, shaders, particles and bloom
- `game/src/audio.js`: music and sound effects, all made in the browser
- `game/vendor/three/`: three.js 0.160.0 and the addons the game uses
- `game/assets/flappy-jack.glb`: Flappy Jack, without his arms

## Rebuilding Flappy Jack

Jack comes from his rig in the `test1` repo (`film/rigs/flappy-jack`). With that repo checked out beside this one:

```bash
node tools/export_flappy_jack.mjs
```

It needs Playwright and Chromium. Set `TEST1_REPO` if `test1` lives somewhere else.

## Deploying

`opengame.json` points OpenGame at `game/`, so `tools/` stays out of the upload.

```bash
opengame check . --build --json
opengame deploy . --json
```
