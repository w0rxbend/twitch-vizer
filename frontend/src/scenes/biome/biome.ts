import * as PIXI from 'pixi.js';
import {
  PX, CANVAS_HEIGHT, GROUND_Y, C, seedRng,
  Ant, Butterfly, Bee, Bird, Firefly, Worm,
  Wasp, Dragonfly, Moth,
  Petal, Sparkle, RainDrop, DustMote, Pollen,
  FogBank, Aurora, RainSplash,
} from './entities.js';
import {
  VitalityEngine, DayNightCycle, WeatherSystem, BackgroundRenderer, FogSystem,
} from './systems.js';
import { BiomeFloor } from './floor.js';
import type { Entity, DeadEntity, SceneContext, VisualEventMsg } from './types.js';

class BiomeScene {
  private app: PIXI.Application | null = null;
  private vitalityEngine = new VitalityEngine();
  private dayNight = new DayNightCycle();
  private weather = new WeatherSystem();
  private fogSystem = new FogSystem();
  private bg: BackgroundRenderer | null = null;
  private floor: BiomeFloor | null = null;

  // Fauna pools (long-lived)
  private ants: Ant[] = [];
  private butterflies: Butterfly[] = [];
  private bees: Bee[] = [];
  private worms: Worm[] = [];
  private wasps: Wasp[] = [];
  private dragonflies: Dragonfly[] = [];
  private moths: Moth[] = [];

  // Transient pools (reaped when .dead)
  private birds: DeadEntity[] = [];
  private fireflies: DeadEntity[] = [];
  private petals: DeadEntity[] = [];
  private sparkles: DeadEntity[] = [];
  private rainDrops: DeadEntity[] = [];
  private dustMotes: DeadEntity[] = [];
  private pollenParticles: DeadEntity[] = [];
  private fogBanks: DeadEntity[] = [];
  private auroras: DeadEntity[] = [];
  private rainSplashes: DeadEntity[] = [];

  private ws: WebSocket | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    const app = new PIXI.Application();
    await app.init({
      width: window.innerWidth,
      height: CANVAS_HEIGHT,
      backgroundAlpha: 0,
      antialias: false,
      resolution: 1,
    });

    document.body.appendChild(app.canvas);
    app.canvas.style.position = 'fixed';
    app.canvas.style.bottom = '0';
    app.canvas.style.left = '0';

    this.app = app;
    this.bg    = new BackgroundRenderer(app);
    this.floor = new BiomeFloor(app);

    // Seed initial fauna
    for (let i = 0; i < 3; i++) {
      this.ants.push(new Ant(app, 100 + Math.floor(Math.random() * (app.screen.width - 200))));
    }
    for (let i = 0; i < 3; i++) {
      this.butterflies.push(new Butterfly(app, Math.floor(Math.random() * app.screen.width), i));
    }
    for (let i = 0; i < 2; i++) {
      this.bees.push(new Bee(app, Math.floor(Math.random() * app.screen.width)));
    }

    app.ticker.add(({ deltaTime }) => this._tick(deltaTime));
  }

  private _buildCtx(): SceneContext {
    const app = this.app!;
    return {
      app,
      vitality:     this.vitalityEngine.value,
      phase:        this.vitalityEngine.phase,
      isNight:      this.dayNight.isNight,
      timeOfDay:    this.dayNight.timeOfDay,
      windStrength: this.weather.currentWind,
      canvasWidth:  app.screen.width,
      canvasHeight: CANVAS_HEIGHT,
    };
  }

  private _tick(delta: number): void {
    const v = this.vitalityEngine.value;

    this.vitalityEngine.tick(delta);
    this.dayNight.tick(delta, v);
    this.weather.tick(delta, v);
    this.fogSystem.tick(delta, v);

    const ctx = this._buildCtx();
    const app = this.app!;
    const w   = app.screen.width;
    const wind = this.weather.currentWind;

    this.bg!.update(delta, ctx);
    this.floor!.update(delta, ctx);

    // Ambient particle spawning
    if (this.weather.shouldSpawnRain) {
      this.rainDrops.push(new RainDrop(app, Math.random() * w, wind));
    }
    if (this.weather.shouldSpawnDust) {
      this.dustMotes.push(new DustMote(app, Math.random() * w, seedRng(Math.floor(Math.random() * 999999))));
    }
    if (this.weather.shouldSpawnPollen) {
      this.pollenParticles.push(new Pollen(app, Math.random() * w, seedRng(Math.floor(Math.random() * 999999))));
    }

    // Butterflies — random positions
    if (Math.random() < 0.003 + (v / 100) * 0.009 && this.butterflies.length < 20) {
      this.butterflies.push(new Butterfly(app, Math.random() * w, Math.floor(Math.random() * 5)));
    }

    // Wasps — more active when alive
    if (v > 20 && Math.random() < 0.002 + (v / 100) * 0.006 && this.wasps.length < 12) {
      this.wasps.push(new Wasp(app, Math.random() * w));
    }

    // Dragonflies — rare, appear anywhere
    if (v > 30 && Math.random() < 0.0015 + (v / 100) * 0.004 && this.dragonflies.length < 8) {
      this.dragonflies.push(new Dragonfly(app, Math.random() * w));
    }

    // Moths — prefer night and low vitality
    if ((ctx.isNight || v < 40) && Math.random() < 0.003 && this.moths.length < 10) {
      this.moths.push(new Moth(app, Math.random() * w));
    }

    // Fireflies at night or when dying
    if ((ctx.isNight || v < 25) && Math.random() < 0.005 && this.fireflies.length < 15) {
      this.fireflies.push(new Firefly(app, Math.random() * w, seedRng(Math.floor(Math.random() * 999999))));
    }

    // Worms emerge when alive
    if (v > 40 && Math.random() < 0.001 && this.worms.length < 4) {
      this.worms.push(new Worm(app, Math.random() * w, seedRng(Math.floor(Math.random() * 999999))));
    }

    // Fog rolls in when dying
    if (this.fogSystem.density > 0.08 && Math.random() < this.fogSystem.density * 0.008 && this.fogBanks.length < 4) {
      this.fogBanks.push(new FogBank(app, Math.random() > 0.5, seedRng(Math.floor(Math.random() * 999999))));
    }

    // Aurora at night, low vitality
    if (ctx.isNight && v < 45 && Math.random() < 0.002 && this.auroras.length < 3) {
      this.auroras.push(new Aurora(app, seedRng(Math.floor(Math.random() * 999999))));
    }

    // Rain splashes
    if (this.weather.shouldSpawnRain && Math.random() < 0.25) {
      this.rainSplashes.push(new RainSplash(app, Math.random() * w, GROUND_Y));
    }

    // Update fauna
    for (const a of this.ants)     a.update(delta, ctx);
    for (const b of this.bees)     b.update(delta, ctx);
    for (const worm of this.worms) worm.update(delta, ctx);

    // Wasps, dragonflies, moths — update and reap dead
    for (let i = this.wasps.length - 1; i >= 0; i--) {
      this.wasps[i].update(delta, ctx);
      if (this.wasps[i].dead) { this.wasps[i].destroy(); this.wasps.splice(i, 1); }
    }
    for (let i = this.dragonflies.length - 1; i >= 0; i--) {
      this.dragonflies[i].update(delta, ctx);
      if (this.dragonflies[i].dead) { this.dragonflies[i].destroy(); this.dragonflies.splice(i, 1); }
    }
    for (let i = this.moths.length - 1; i >= 0; i--) {
      this.moths[i].update(delta, ctx);
      if (this.moths[i].dead) { this.moths[i].destroy(); this.moths.splice(i, 1); }
    }

    // Butterflies fade and die — reap dead ones
    for (let i = this.butterflies.length - 1; i >= 0; i--) {
      this.butterflies[i].update(delta, ctx);
      if ((this.butterflies[i] as unknown as { dead: boolean }).dead) {
        this.butterflies[i].destroy();
        this.butterflies.splice(i, 1);
      }
    }

    // Update and reap transient pools
    this._reapDeadPool(this.birds,           delta, ctx);
    this._reapDeadPool(this.fireflies,       delta, ctx);
    this._reapDeadPool(this.petals,          delta, ctx);
    this._reapDeadPool(this.sparkles,        delta, ctx);
    this._reapDeadPool(this.rainDrops,       delta, ctx);
    this._reapDeadPool(this.dustMotes,       delta, ctx);
    this._reapDeadPool(this.pollenParticles, delta, ctx);
    this._reapDeadPool(this.fogBanks,        delta, ctx);
    this._reapDeadPool(this.auroras,         delta, ctx);
    this._reapDeadPool(this.rainSplashes,    delta, ctx);
  }

  private _reapDeadPool(pool: DeadEntity[], delta: number, ctx: SceneContext): void {
    for (let i = pool.length - 1; i >= 0; i--) {
      pool[i].update(delta, ctx);
      if (pool[i].dead) {
        pool[i].destroy();
        pool.splice(i, 1);
      }
    }
  }

  spawnFromEvent(msg: VisualEventMsg): void {
    if (!this.app || !this.floor) return;
    const app  = this.app;
    const w    = app.screen.width;
    const seed = msg.seed ?? Math.floor(Math.random() * 0xFFFFFF);
    const rng  = seedRng(seed);
    const rx   = (): number => Math.floor(rng() * w);
    const wind = this.weather.currentWind;

    switch (msg.event) {
      case 'chat_message': {
        this.vitalityEngine.boost(8);
        // 3-5 spikes scattered across random positions
        const spikeCount = 3 + Math.floor(rng() * 3);
        for (let i = 0; i < spikeCount; i++) {
          this.floor.boost(rx(), 40 + rng() * 35, 0.35 + rng() * 0.30);
        }
        // Always spawn a butterfly on every message (cap 18)
        if (this.butterflies.length < 18) {
          this.butterflies.push(new Butterfly(app, rx(), Math.floor(rng() * 5)));
        }
        // Second butterfly ~50% of the time
        if (rng() < 0.5 && this.butterflies.length < 18) {
          this.butterflies.push(new Butterfly(app, rx(), Math.floor(rng() * 5)));
        }
        // Occasional pollen burst when thriving
        if (this.vitalityEngine.phase === 'thriving' && rng() < 0.3) {
          this.pollenParticles.push(new Pollen(app, rx(), seedRng(Math.floor(rng() * 999999))));
        }
        // Rare bee spawn
        if (rng() < 0.08 && this.bees.length < 10) {
          this.bees.push(new Bee(app, rx()));
        }
        break;
      }

      case 'follow': {
        this.vitalityEngine.boost(15);
        this.floor.boost(rx(), 110, 0.70);
        // Sparkle burst
        for (let i = 0; i < 3; i++) {
          this.sparkles.push(new Sparkle(app, rx()));
        }
        // New butterfly
        if (this.butterflies.length < 10) {
          this.butterflies.push(new Butterfly(app, rx(), Math.floor(rng() * 5)));
        }
        break;
      }

      case 'sub': {
        this.vitalityEngine.boost(25);
        // Three overlapping boosts — dramatic surge
        this.floor.boost(rx(), 180, 0.90);
        this.floor.boost(rx(), 100, 0.70);
        this.floor.boost(rx(),  60, 0.55);
        // Golden sparkle burst
        const subPalette = [0xFFD700, 0xFFAA00, 0xFF88AA, 0xFFFFFF, 0xAAFFCC];
        for (let i = 0; i < 6; i++) {
          this.sparkles.push(new Sparkle(app, rx(), subPalette));
        }
        // Extra butterflies
        for (let i = 0; i < 3 && this.butterflies.length < 12; i++) {
          this.butterflies.push(new Butterfly(app, rx(), Math.floor(rng() * 5)));
        }
        break;
      }

      case 'gift_sub': {
        const total = msg.data?.total ?? 1;
        this.vitalityEngine.boost(Math.min(15 + total * 3, 45));
        const boostCount = Math.min(2 + Math.floor(total / 2), 6);
        for (let i = 0; i < boostCount; i++) {
          this.floor.boost(rx(), 70 + total * 5, 0.5 + Math.min(total * 0.04, 0.4));
        }
        const petalCount = Math.min(6 + total * 2, 20);
        for (let i = 0; i < petalCount; i++) {
          this.petals.push(new Petal(app, rx(), wind));
        }
        for (let i = 0; i < Math.min(3, total) && this.bees.length < 12; i++) {
          this.bees.push(new Bee(app, rx()));
        }
        break;
      }

      case 'raid': {
        const viewers = msg.data?.viewers ?? 10;
        this.vitalityEngine.boost(Math.min(20 + viewers / 10, 45));
        // Sweep: boost every ~80px across the full width
        const step = Math.floor(80 / PX);
        const boostCols = Math.ceil(w / 80);
        for (let i = 0; i < boostCols; i++) {
          const bx = (i / boostCols) * w + (rng() - 0.5) * 40;
          this.floor.boost(bx, 90, 0.65 + Math.min(viewers / 500, 0.30));
        }
        // Bird flock
        const birdCount = Math.min(3 + Math.floor(viewers / 20), 8);
        const birdY = GROUND_Y - 60 - Math.floor(rng() * 40);
        const dir: 1 | -1 = rng() > 0.5 ? 1 : -1;
        const startX = dir === 1 ? -20 : w + 20;
        for (let i = 0; i < birdCount; i++) {
          this.birds.push(new Bird(app, startX + i * dir * -15, birdY + (i % 3) * 8, dir));
        }
        // Firefly wave
        const raidFlies = Math.min(3 + Math.floor(viewers / 50), 7);
        for (let i = 0; i < raidFlies && this.fireflies.length < 15; i++) {
          this.fireflies.push(new Firefly(app, rx(), seedRng(Math.floor(rng() * 999999))));
        }
        break;
      }

      case 'cheer': {
        const bits = msg.data?.bits ?? 100;
        this.vitalityEngine.boost(Math.min(bits / 10, 30));
        const boostAmt = Math.min(0.3 + bits / 2000, 0.85);
        this.floor.boost(rx(), 80 + bits / 20, boostAmt);
        const petalCount = Math.min(5 + Math.floor(bits / 50), 30);
        for (let i = 0; i < petalCount; i++) {
          this.petals.push(new Petal(app, rx(), wind));
        }
        const fireflyCount = Math.min(2 + Math.floor(bits / 100), 10);
        for (let i = 0; i < fireflyCount && this.fireflies.length < 15; i++) {
          this.fireflies.push(new Firefly(app, rx(), seedRng(Math.floor(rng() * 999999))));
        }
        break;
      }
    }
  }

  connectWebSocket(): void {
    if (this.wsRetryTimer) {
      clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = null;
    }
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => console.log('[Biome] WebSocket connected');
      ws.onmessage = (evt: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(evt.data) as VisualEventMsg;
          console.log('[Biome] event received:', msg.event, msg.username);
          this.spawnFromEvent(msg);
          console.log('[Biome] entities:', this.butterflies.length + this.bees.length, 'vitality:', Math.round(this.vitalityEngine.value));
        } catch (e) {
          console.warn('[Biome] WS parse error:', e);
        }
      };
      ws.onclose = () => {
        this.wsRetryTimer = setTimeout(() => this.connectWebSocket(), 3000);
      };
      ws.onerror = () => ws.close();
    } catch (e) {
      this.wsRetryTimer = setTimeout(() => this.connectWebSocket(), 3000);
    }
  }
}

const scene = new BiomeScene();
scene.init().then(() => {
  scene.connectWebSocket();

  // Dev keyboard shortcuts for testing
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const seed = Math.floor(Math.random() * 0xFFFFFF);
    switch (e.key) {
      case ' ':
        scene.spawnFromEvent({ event: 'chat_message', username: 'test', text: 'hello world test', seed });
        break;
      case 'f':
        scene.spawnFromEvent({ event: 'follow', username: 'test', seed });
        break;
      case 's':
        scene.spawnFromEvent({ event: 'sub', username: 'test', seed });
        break;
      case 'r':
        scene.spawnFromEvent({ event: 'raid', username: 'test', data: { viewers: 100 }, seed });
        break;
      case 'c':
        scene.spawnFromEvent({ event: 'cheer', username: 'test', data: { bits: 500 }, seed });
        break;
      case 'g':
        scene.spawnFromEvent({ event: 'gift_sub', username: 'test', data: { total: 5 }, seed });
        break;
    }
  });
});
