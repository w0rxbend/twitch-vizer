---
name: project-biome-design
description: Design decisions and architecture for the biome scene — the living pixel-art bottom bar for the twitch-vizer overlay
metadata:
  type: project
---

The biome is a 240px tall bottom-bar OBS browser source overlay. Its core concept: the scene is ALIVE when chat is active and DIES when silent.

**Vitality System**: 0-100 score. Each chat message boosts by ~8. Decays ~2.5/sec. Drives all visual behavior.
- 0-10: dead (grey, no movement)
- 10-30: dying (desaturated, plants droop, creatures flee)
- 30-55: struggling (muted colors, slow movement)
- 55-80: alive (normal)
- 80-100: thriving (vibrant, rain, pollen, fast creatures)

**Architecture** (module split):
- `types.ts` — shared interfaces (SceneContext, Entity, VisualEventMsg, VitalityPhase)
- `entities.ts` — all entity classes (flora: GrassCluster, Flower, Mushroom, Tree, BacteriaColony, Vine; fauna: Ant, Butterfly, Bee, Bird, Firefly, Worm; particles: Petal, Sparkle, RainDrop, DustMote, Pollen)
- `systems.ts` — VitalityEngine, DayNightCycle, WeatherSystem, BackgroundRenderer
- `biome.ts` — BiomeScene orchestrator + WebSocket + bootstrap

**Event → visual mapping**:
- chat_message: boost vitality, spawn grass/bacteria/pollen, 1/5 flower, 1/10 bee
- follow: tree sapling + sparkles
- sub: golden mushroom ring + butterfly burst + 2 sparkles
- gift_sub: flower carpet + bee swarm + petals
- raid: bird flock migration + weather surge
- cheer: fireflies; 1000+ bits: rainbow arc

**Vite config**: root=src/scenes, base=/static/scenes/, outDir=backend/vizer/static/scenes
Python server serves /scenes/biome/ → HTML, /static/scenes/assets/ → JS bundles

**How to apply**: When working on frontend scenes, reference this architecture. When adding new scenes, follow same module pattern.
