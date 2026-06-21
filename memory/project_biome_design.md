---
name: project-biome-design
description: Design decisions and architecture for the biome scene — the living pixel-art bottom bar for the twitch-vizer overlay
metadata:
  type: project
---

The biome is a 240px tall bottom-bar OBS browser source overlay. Its core concept: the scene is ALIVE when chat is active and DIES when silent.

## Product Goal

Build a beautiful pixel-art scene that works as a Twitch status bar and a tiny chat-driven ecosystem. It should sit at the bottom of the OBS canvas, leave the main stream content unobstructed, and read clearly at common stream sizes: 1920x1080, 1600x900, 1280x720, and vertical/mobile preview crops.

The scene is not a passive chat list. It is a living miniature world where chat activity, follows, subs, raids, and cheers visibly change the environment. Viewers should be able to understand the state at a glance:

- quiet chat: dim, sleepy biome
- active chat: moving creatures and healthy plants
- hype events: short celebratory bursts
- sustained activity: the whole biome becomes lush and animated

## Visual Direction

- Format: transparent full-window canvas with all meaningful art constrained to the bottom bar.
- Bar height: default 240px, configurable with `?height=180` through `?height=320`.
- Pixel scale: render at a low virtual resolution and scale up with nearest-neighbor/pixelated presentation.
- Composition: layered parallax strip with sky glow, distant silhouettes, terrain, plants, creatures, particles, and compact status HUD.
- Style: saturated but readable pixel art, not neon-only. Use earthy greens, flower accents, golden event highlights, cool night blues, and warm sunrise/sunset shifts.
- Edges: top edge should be organic and uneven, with grasses, vines, and particles breaking the silhouette.
- Text: minimal. Use small pixel labels for event callouts only; the art should carry most state.

## Core Loop

The biome has a single continuous score: `vitality` from 0 to 100. It rises from chat and channel events, decays when chat is silent, and drives color, density, movement, weather, and creature behavior.

Vitality tuning:

- `chat_message`: +6 baseline, +1 per image/emote up to +4, cooldown dampening for spam bursts
- `follow`: +18 and one sapling milestone
- `sub`: +28 and golden growth event
- `gift_sub`: +22 + `total * 4`, capped at +45
- `cheer`: +10 + `bits / 100`, capped at +35
- `raid`: +35 + `viewers / 5`, capped at +60
- decay: `1.2/sec` above 80, `0.75/sec` from 30-80, `0.35/sec` below 30
- floor: 5, so the bar never becomes visually empty

Vitality phases:

- `dead` 0-10: grey palette, almost no motion, cracked soil, only occasional dust
- `dying` 10-30: desaturated, drooping plants, creatures hide or slow down
- `struggling` 30-55: muted colors, slow ambient movement, small sprouts appear
- `alive` 55-80: normal palette, active insects, flowers sway, soft particles
- `thriving` 80-100: vibrant palette, rain/pollen, faster creatures, rare blooms

## Mini-Game Behavior

The mini-game is lightweight and implicit. Viewers influence the biome by participating; the overlay should not require commands to remain useful.

Optional chat commands can be added later by parsing normal `chat_message` text:

- `!plant`: spends a small per-user cooldown to add a sprout near that user's color marker
- `!water`: creates a tiny rain cloud and boosts nearby plants
- `!bug`: spawns a beetle/bee/firefly depending on time of day
- `!status`: no visual spam; can be ignored by overlay unless backend later replies

Per-user contribution:

- Hash each username to a stable color and home x-position.
- Recent chatters leave tiny color-coded seeds, stones, flowers, or fireflies.
- Repeated activity from the same user evolves their marker from seed -> sprout -> flower -> tiny tree.
- Keep this local to the browser scene; no backend persistence is required for v1.

Milestones:

- First follow after page load: plant a visible sapling.
- Every 10 chat messages: grow a flower cluster.
- Every 50 chat messages: unlock a rare creature.
- Raid: bird flock enters from one side and drops seeds.
- Big cheer/sub train: temporary rainbow, fireflies, or meteor shower.

## Event Mapping

- `chat_message`: boost vitality, spawn one user seed pulse, 0-2 pollen motes, optional emote bubble if message has images.
- `follow`: tree sapling, green sparkle burst, brief "new sprout" callout.
- `sub`: golden mushroom ring, butterfly burst, warm light pulse.
- `gift_sub`: flower carpet wave, bee swarm, falling petals. Use `data.total`.
- `raid`: bird flock migration, wind gust, terrain-wide seed rain. Use `data.viewers`.
- `cheer`: fireflies and coin sparks. For 1000+ bits, add a short rainbow arc.

System events should use backend `text` if provided in the future. Until then, derive compact callouts from `event` and `data`.

## Architecture

Scene folder:

- `frontend/src/scenes/biome/index.html`
- `frontend/src/scenes/biome/biome.ts`
- `frontend/src/scenes/biome/types.ts`
- `frontend/src/scenes/biome/palette.ts`
- `frontend/src/scenes/biome/sprites.ts`
- `frontend/src/scenes/biome/entities.ts`
- `frontend/src/scenes/biome/systems.ts`
- `frontend/src/scenes/biome/hud.ts`

Module responsibilities:

- `types.ts`: `SceneContext`, `Entity`, `VisualEventMsg`, `VitalityPhase`, `BiomeConfig`, `UserMarker`.
- `palette.ts`: phase palettes, day/night color interpolation, user accent helpers.
- `sprites.ts`: pixel-art drawing helpers using Pixi `Graphics`, generated textures, and tiny sprite atlases. No external bitmap dependency for v1.
- `entities.ts`: flora, fauna, particles, callouts. Keep update/draw logic object-oriented but small.
- `systems.ts`: `VitalityEngine`, `DayNightCycle`, `WeatherSystem`, `SpawnDirector`, `UserGarden`.
- `hud.ts`: bottom-left compact status meter, event labels, and optional debug mode.
- `biome.ts`: Pixi bootstrap, resize handling, WebSocket connection, main loop, scene orchestration.

Use existing shared frontend utilities from `frontend/src/shared/overlay.ts`:

- `OverlayEventSocket`
- `VisualEventMsg`
- `hashSeed`
- `seedRng`
- `clamp`
- `hslToRgb`
- `mixColor`
- `rgba`
- `formatEventLabel`

## Rendering Rules

- Use PixiJS because the rest of the scenes already use it.
- Prefer generated pixel textures and sprite sheets over many live `Graphics` objects.
- Keep all entities within a fixed bottom-bar world rectangle.
- Use deterministic randomness from event/user seeds so repeated users feel consistent.
- Avoid large dependencies. Do not use `@huggingface/transformers` for this scene.
- Do not use DOM text over the canvas. Render text in Pixi only if needed.
- Keep the scene transparent above the bar.
- Avoid UI cards. This is a world/status bar, not a panel.

Performance budget:

- 60 FPS target on OBS browser source at 1920x1080.
- Maximum normal entities: 180.
- Maximum burst entities: 320 for less than 5 seconds.
- Particle pooling for pollen, sparks, rain, petals, and dust.
- Reuse generated textures.
- Build output for this scene should stay small compared with `emoji-chat`; no model/WASM assets.

## Configuration

Support query params:

- `height`: bar height in pixels, default `240`
- `debug`: `1` shows FPS, entity count, vitality, phase
- `density`: `low | normal | high`, default `normal`
- `reducedMotion`: `1` limits particles and creature speed
- `ws` or `wsUrl`: inherited from shared overlay WebSocket helper

## Vite And Server Integration

Current repository config builds scenes to `frontend/dist` and the Dockerfile copies that directory into `backend/vizer/static/scenes/`. Add `biome` to `frontend/vite.config.ts` Rollup inputs.

Expected dev URL:

- `http://localhost:5173/biome/`

Expected production/Docker URL:

- `http://localhost:8080/scenes/biome/`

## From-Scratch Implementation Plan

1. Create `frontend/src/scenes/biome/index.html` with transparent body/canvas styling and `image-rendering: pixelated`.
2. Add `biome` to `frontend/vite.config.ts` build inputs.
3. Create core TypeScript modules: `types.ts`, `palette.ts`, `sprites.ts`, `systems.ts`, `entities.ts`, `hud.ts`, `biome.ts`.
4. Implement Pixi bootstrap and resize logic. Clamp art to bottom `height` while canvas remains full viewport.
5. Implement `VitalityEngine` with event boosts, decay, phase calculation, and dampening.
6. Build base pixel-art layers: sky glow, distant hills, soil strip, grass edge, rocks, roots.
7. Add generated sprite textures: grass tufts, flowers, mushrooms, sapling/tree, bees, butterflies, birds, fireflies, particles.
8. Implement entity lifecycle: `update(dt, ctx)`, `destroyed`, object pooling for particles.
9. Implement `SpawnDirector` to convert `VisualEventMsg` into vitality boosts, entities, weather, and callouts.
10. Implement `UserGarden` so usernames create stable x-positions and evolving local markers.
11. Add compact HUD: vitality meter, phase icon/color, latest event callout. Keep it integrated into the terrain, not a card.
12. Add query-param configuration and debug overlay.
13. Wire `OverlayEventSocket` and create a local keyboard/test event harness for development.
14. Verify with synthetic events: chat bursts, silence decay, follow/sub/gift/raid/cheer, reconnect behavior.
15. Run `npm run build` and check bundle output. Confirm no unexpected ONNX/model assets are pulled in.
16. Optional after v1: parse `!plant`, `!water`, and `!bug` commands from chat text.

## Acceptance Criteria

- Looks finished at 1920x1080 with a 240px bottom bar.
- Does not obscure the rest of the stream; transparent area above the bar remains clear.
- Vitality changes are obvious within 2 seconds of chat activity.
- Silence visibly calms the biome within 30-60 seconds.
- All supported Twitch events produce distinct visual effects.
- Frontend build succeeds.
- Scene is available at `/biome/` in Vite dev and `/scenes/biome/` in backend static hosting.
- No new backend requirement for v1.
- No heavyweight ML/WASM dependencies in the biome scene bundle.

## Future Backend Improvement

`backend/vizer/events.py` currently defines Ukrainian announcement text, but system events are broadcast with empty `text` and frontend scenes derive generic English labels. A future backend pass should populate `VisualEvent.text` for follow/sub/gift/raid/cheer using that module, then the biome can display localized event callouts directly.

## How To Apply

When implementing the biome scene, follow this document as the source of truth. Keep v1 scoped to a local browser-scene mini-game driven by existing WebSocket events. Do not add persistence, backend commands, or external art pipelines until the first beautiful bottom-bar version is working.
