import * as Phaser from 'phaser';
import {
  FOUNTAIN,
  LIGHTS,
  MAP_HEIGHT,
  MAP_WIDTH,
  SMOKE_SPOTS,
  cellCenter,
  findPath,
  isWalkable,
  spotsOf,
  standable,
  type Cell,
  type Scores,
  type Zone,
} from './cityGrid';
import { INITIAL_WALK_LOOK, walkLookFor, type WalkLook } from './cityFacing';
import type { CrowdMember } from './cityCrowd';
import { VILLAGER_FRAMES, VILLAGER_H, VILLAGER_LOOKS, VILLAGER_VIEWS, VILLAGER_W, renderVillager } from './villagerSprites';

/**
 * Everything in the city that moves on its own and is not a citizen: the
 * day and night cycle, lit windows, chimney smoke, the fountain, cloud
 * shadows, birds and a few townsfolk. None of it is state; it only makes the
 * mock city feel inhabited and never touches progression.
 */

export interface AmbienceHooks {
  /** Painter's depth for something standing at a world point, so it hides behind buildings. */
  depthAt: (x: number, y: number, size: number, cell: Cell) => number;
  /** Scores that unlock nothing, so townsfolk stay out of locked districts. */
  strangerScores: Scores;
}

/** One full day, in milliseconds. */
const CYCLE_MS = 360_000;
/** Where in the day the city starts: a bright morning. */
const START_PHASE = 0.28;
const DARKNESS_DEPTH = 4000;
const GLOW_DEPTH = 4001;
const CLOUD_DEPTH = 3900;
const BIRD_DEPTH = 3950;
const SMOKE_DEPTH = 3000;
const VILLAGER_COUNT = VILLAGER_LOOKS.length;
const VILLAGER_SPEED = 0.036;
/** Townsfolk stand as tall as the citizens' sprites, so they read as people, not props. */
const VILLAGER_SIZE = VILLAGER_H;
/** Half the width of a person on the ground, for keeping people from overlapping. */
const VILLAGER_RADIUS = 9;
/** Pixels walked per step pose; the stride cycles stand, left, stand, right. */
const STRIDE_PX = 7;
const STRIDE_FRAMES = [1, 0, 2, 0] as const;
const VILLAGER_DISTRICTS = ['plaza', 'archive', 'hearth', 'forge'] as const;

/** Colour the whole map is multiplied by, at a fraction of the day. */
const SKY: readonly (readonly [number, number])[] = [
  [0, 0xffe2c0],
  [0.08, 0xffffff],
  [0.58, 0xffffff],
  [0.68, 0xffc08e],
  [0.78, 0x6674b0],
  [0.92, 0x56649e],
  [1, 0xffe2c0],
];

const GLOW_TINT = { window: 0xffd48a, lantern: 0xffc070, lamp: 0xffe2a0 } as const;

function lerpColor(a: number, b: number, t: number): number {
  const channel = (shift: number) => {
    const from = (a >> shift) & 255;
    const to = (b >> shift) & 255;
    return Math.round(from + (to - from) * t);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Sky multiplier and how dark it is, from 0 (day) to 1 (full night). */
function skyAt(phase: number): { color: number; night: number } {
  let color = 0xffffff;
  for (let index = 0; index < SKY.length - 1; index += 1) {
    const [from, fromColor] = SKY[index] as readonly [number, number];
    const [to, toColor] = SKY[index + 1] as readonly [number, number];
    if (phase >= from && phase <= to) {
      color = lerpColor(fromColor, toColor, (phase - from) / (to - from));
      break;
    }
  }
  const green = (color >> 8) & 255;
  return { color, night: Phaser.Math.Clamp((255 - green) / (255 - 116), 0, 1) };
}

interface Glow {
  image: Phaser.GameObjects.Image;
  zone: Zone;
  kind: keyof typeof GLOW_TINT;
  seed: number;
  studioExterior: boolean;
}

interface Villager {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  cell: Cell;
  path: Cell[];
  from: { x: number; y: number };
  to: { x: number; y: number };
  progress: number;
  travelled: number;
  restUntil: number;
  look: WalkLook;
  member: CrowdMember;
}

export class CityAmbience {
  private readonly scene: Phaser.Scene;
  private readonly hooks: AmbienceHooks;
  private readonly glows: Glow[] = [];
  private readonly smoke: { emitter: Phaser.GameObjects.Particles.ParticleEmitter; zone: Zone }[] = [];
  private readonly clouds: { image: Phaser.GameObjects.Image; vx: number; vy: number }[] = [];
  private readonly villagers: Villager[] = [];
  private readonly locked = new Set<Zone>();
  private dark!: Phaser.GameObjects.Rectangle;
  private night = 0;
  private studioOpen = false;

  constructor(scene: Phaser.Scene, hooks: AmbienceHooks) {
    this.scene = scene;
    this.hooks = hooks;
  }

  create(): void {
    this.makeTextures();
    this.makeSmoke();
    this.makeFountain();
    this.makeClouds();
    this.makeGlows();
    this.makeVillagers();
    // The map is multiplied by the sky colour, so night and dusk tint buildings, ground and citizens alike.
    this.dark = this.scene.add
      .rectangle(MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH * 6, MAP_HEIGHT * 6, 0xffffff)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(DARKNESS_DEPTH);
    this.scheduleBirds(4000);
  }

  /** A district was locked or unlocked for the selected citizen: its lights follow the district's dimming. */
  setLocked(zone: Zone, locked: boolean): void {
    if (locked) this.locked.add(zone);
    else this.locked.delete(zone);
    for (const { emitter, zone: smokeZone } of this.smoke) emitter.setVisible(!this.locked.has(smokeZone));
  }

  /** Switches outdoor sky multiply, clouds, and window glows off while inside the BAS Studio indoor room. */
  setStudioOpen(open: boolean): void {
    this.studioOpen = open;
  }

  update(time: number, delta: number): void {
    const { color, night } = skyAt((START_PHASE + time / CYCLE_MS) % 1);
    this.night = night;
    this.dark.setFillStyle(this.studioOpen ? 0xffffff : color, 1);
    this.updateGlows(time, night);
    this.updateClouds(delta);
    for (const villager of this.villagers) this.stepVillager(villager, time, delta);
  }

  // --- textures ---------------------------------------------------------------

  private makeTextures(): void {
    const { scene } = this;
    const radial = (key: string, stops: readonly (readonly [number, string])[]) => {
      if (scene.textures.exists(key)) return;
      const texture = scene.textures.createCanvas(key, 64, 64);
      if (!texture) return;
      const context = texture.getContext();
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      for (const [offset, color] of stops) gradient.addColorStop(offset, color);
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      texture.refresh();
    };
    radial('amb-glow', [
      [0, 'rgba(255,214,140,1)'],
      [0.3, 'rgba(255,190,100,0.55)'],
      [1, 'rgba(255,170,80,0)'],
    ]);
    radial('amb-soft', [
      [0, 'rgba(255,255,255,0.9)'],
      [1, 'rgba(255,255,255,0)'],
    ]);

    const pen = scene.make.graphics({}, false);
    if (!scene.textures.exists('amb-drop')) {
      pen.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2).generateTexture('amb-drop', 2, 2);
      pen.clear();
    }
    if (!scene.textures.exists('amb-bird')) {
      pen.fillStyle(0x1c2630, 1);
      for (const [x, y, w] of [[0, 0, 2], [1, 1, 2], [3, 2, 1], [4, 1, 2], [5, 0, 2]] as const) pen.fillRect(x, y, w, 1);
      pen.generateTexture('amb-bird', 7, 3);
      pen.clear();
    }
    this.makeVillagerSheets();
    pen.destroy();
  }

  /** One texture per person: a grid of poses, one row per view and one column per frame. */
  private makeVillagerSheets(): void {
    const { scene } = this;
    VILLAGER_LOOKS.forEach((look, variant) => {
      const key = `amb-villager-${variant}`;
      if (scene.textures.exists(key)) return;
      const texture = scene.textures.createCanvas(key, VILLAGER_W * VILLAGER_FRAMES.length, VILLAGER_H * VILLAGER_VIEWS.length);
      if (!texture) return;
      const context = texture.getContext();
      VILLAGER_VIEWS.forEach((view, row) => {
        VILLAGER_FRAMES.forEach((frame, column) => {
          const pixels = renderVillager(look, view, frame);
          context.putImageData(new ImageData(pixels, VILLAGER_W, VILLAGER_H), column * VILLAGER_W, row * VILLAGER_H);
          texture.add(`${view}-${frame}`, 0, column * VILLAGER_W, row * VILLAGER_H, VILLAGER_W, VILLAGER_H);
        });
      });
      texture.refresh();
    });
  }

  // --- smoke, water and sky -----------------------------------------------------

  private makeSmoke(): void {
    for (const spot of SMOKE_SPOTS) {
      const emitter = this.scene.add
        .particles(spot.x, spot.y, 'amb-soft', {
          lifespan: { min: 2200, max: 3200 },
          speedY: { min: -22, max: -14 },
          speedX: { min: 5, max: 12 },
          scale: { start: 0.14, end: 0.5 },
          alpha: { start: 0.42, end: 0 },
          tint: [0xe8e8ec, 0xcfcfd6],
          frequency: 520,
        })
        .setDepth(SMOKE_DEPTH);
      this.smoke.push({ emitter, zone: spot.zone });
    }
  }

  private makeFountain(): void {
    const { scene } = this;
    const depth = 260;
    // Water thrown by the top bowl, landing in the basin.
    scene.add
      .particles(FOUNTAIN.x, FOUNTAIN.y - 39, 'amb-drop', {
        lifespan: { min: 620, max: 900 },
        speedY: { min: -78, max: -58 },
        speedX: { min: -24, max: 24 },
        gravityY: 250,
        scale: { start: 1.3, end: 0.8 },
        alpha: { start: 0.95, end: 0 },
        tint: [0xcdeeff, 0xffffff, 0x8fd0f4],
        frequency: 38,
      })
      .setDepth(depth + 1);
    // Rings spreading across the water.
    for (let ring = 0; ring < 2; ring += 1) {
      const ripple = scene.add.ellipse(FOUNTAIN.x, FOUNTAIN.y + 14, 66, 31).setStrokeStyle(2, 0xcfeeff).setDepth(depth + 0.5);
      scene.tweens.add({
        targets: ripple,
        scaleX: { from: 0.45, to: 1.05 },
        scaleY: { from: 0.45, to: 1.05 },
        alpha: { from: 0.7, to: 0 },
        duration: 2400,
        delay: ring * 1200,
        repeat: -1,
      });
    }
  }

  private makeClouds(): void {
    for (let index = 0; index < 5; index += 1) {
      const image = this.scene.add
        .image(Phaser.Math.Between(0, MAP_WIDTH), Phaser.Math.Between(40, MAP_HEIGHT - 80), 'amb-soft')
        .setTint(0x04101c)
        .setAlpha(0.15)
        .setScale(Phaser.Math.FloatBetween(9, 15), Phaser.Math.FloatBetween(4, 7))
        .setDepth(CLOUD_DEPTH);
      this.clouds.push({ image, vx: Phaser.Math.FloatBetween(5, 9) / 1000, vy: Phaser.Math.FloatBetween(2, 4) / 1000 });
    }
  }

  private updateClouds(delta: number): void {
    for (const cloud of this.clouds) {
      cloud.image.x += cloud.vx * delta;
      cloud.image.y += cloud.vy * delta;
      if (cloud.image.x > MAP_WIDTH + 500) {
        cloud.image.setPosition(-500, Phaser.Math.Between(40, MAP_HEIGHT - 80));
      }
      // Clouds shade the day; at night or inside a building they are hidden.
      cloud.image.setAlpha(this.studioOpen ? 0 : 0.15 * (1 - this.night));
    }
  }

  private scheduleBirds(delay: number): void {
    this.scene.time.delayedCall(delay, () => {
      if (this.night < 0.5 && !this.studioOpen) this.flyFlock();
      this.scheduleBirds(Phaser.Math.Between(9000, 18000));
    });
  }

  private flyFlock(): void {
    const { scene } = this;
    const lead = Phaser.Math.Between(60, MAP_HEIGHT / 2);
    const duration = Phaser.Math.Between(15000, 22000);
    const count = Phaser.Math.Between(3, 5);
    for (let index = 0; index < count; index += 1) {
      const bird = scene.add
        .image(-60 - index * 26, lead + (index % 2 === 0 ? 1 : -1) * index * 9, 'amb-bird')
        .setScale(2)
        .setDepth(BIRD_DEPTH);
      scene.tweens.add({ targets: bird, scaleY: { from: 2, to: 0.8 }, duration: 170, yoyo: true, repeat: -1 });
      scene.tweens.add({
        targets: bird,
        x: MAP_WIDTH + 80,
        y: bird.y + Phaser.Math.Between(-40, 40),
        duration,
        onComplete: () => {
          scene.tweens.killTweensOf(bird);
          bird.destroy();
        },
      });
    }
  }

  // --- windows and lamps --------------------------------------------------------

  private makeGlows(): void {
    LIGHTS.forEach((spot, index) => {
      const image = this.scene.add
        .image(spot.x, spot.y, 'amb-glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(GLOW_TINT[spot.kind])
        .setScale((spot.r * 2) / 64)
        .setAlpha(0)
        .setDepth(GLOW_DEPTH);
      const studioExterior = spot.x >= 395 && spot.x <= 685 && spot.y >= 1240 && spot.y <= 1560;
      this.glows.push({ image, zone: spot.zone, kind: spot.kind, seed: index, studioExterior });
    });
  }

  private updateGlows(time: number, night: number): void {
    for (const glow of this.glows) {
      if (this.studioOpen) {
        glow.image.setAlpha(0).setVisible(false);
        continue;
      }
      const lit = this.locked.has(glow.zone) ? 0 : glow.kind === 'lamp' ? Math.min(1, night * 1.7) : night;
      const flicker = glow.kind === 'window' ? 0.9 + 0.1 * Math.sin(time / (500 + glow.seed * 7) + glow.seed) : 1;
      glow.image.setAlpha(lit * flicker * 0.9).setVisible(lit > 0.01);
    }
  }

  // --- townsfolk ----------------------------------------------------------------

  /** Townsfolk as members of the crowd, so the scene can keep them clear of everyone else. */
  members(): CrowdMember[] {
    return this.villagers.map((villager) => villager.member);
  }

  /** Redraws everyone's depth after the crowd pass moved them, so they still hide behind buildings. */
  refreshDepths(): void {
    for (const { root, cell } of this.villagers) root.setDepth(this.hooks.depthAt(root.x, root.y, VILLAGER_SIZE, cell));
  }

  private makeVillagers(): void {
    const { scene, hooks } = this;
    for (let index = 0; index < VILLAGER_COUNT; index += 1) {
      const district = VILLAGER_DISTRICTS[index % VILLAGER_DISTRICTS.length] as (typeof VILLAGER_DISTRICTS)[number];
      const spots = spotsOf(district).filter((cell) => isWalkable(cell, hooks.strangerScores));
      const cell = spots[index % Math.max(spots.length, 1)] ?? ([12, 10] as Cell);
      const { x, y } = cellCenter(cell);
      const shadow = scene.add.ellipse(0, 0, 20, 6, 0x000000, 0.32);
      const body = scene.add.image(0, 0, `amb-villager-${index}`, 'front-0').setOrigin(0.5, 1);
      const root = scene.add.container(x, y, [shadow, body]).setDepth(hooks.depthAt(x, y, VILLAGER_SIZE, cell));
      const member: CrowdMember = {
        root,
        shove: { x: 0, y: 0 },
        radius: VILLAGER_RADIUS,
        anchored: false,
        canStand: (px, py) => standable(px, py, hooks.strangerScores),
      };
      this.villagers.push({
        root,
        body,
        cell,
        path: [],
        from: { x, y },
        to: { x, y },
        progress: 1,
        travelled: 0,
        restUntil: 800 + index * 1100,
        look: INITIAL_WALK_LOOK,
        member,
      });
    }
  }

  private stepVillager(villager: Villager, time: number, delta: number): void {
    const { root, body } = villager;
    if (villager.path.length === 0) {
      body.setFrame(`${villager.look.view}-0`);
      body.y = Math.sin(time / 420 + villager.restUntil) * 0.8;
      if (time >= villager.restUntil) this.chooseRoute(villager, time);
      return;
    }
    if (villager.progress >= 1) {
      const next = villager.path[1];
      if (!next) {
        villager.path = [];
        villager.restUntil = time + 2500 + Math.random() * 5000;
        return;
      }
      villager.from = cellCenter(villager.path[0] as Cell);
      villager.to = cellCenter(next);
      villager.progress = 0;
    }
    const distance = Phaser.Math.Distance.Between(villager.from.x, villager.from.y, villager.to.x, villager.to.y) || 1;
    villager.progress = Math.min(1, villager.progress + (delta * VILLAGER_SPEED) / distance);
    villager.travelled += delta * VILLAGER_SPEED;
    root.x = Phaser.Math.Linear(villager.from.x, villager.to.x, villager.progress);
    root.y = Phaser.Math.Linear(villager.from.y, villager.to.y, villager.progress);
    villager.look = walkLookFor({ x: villager.to.x - villager.from.x, y: villager.to.y - villager.from.y }, villager.look);
    const frame = STRIDE_FRAMES[Math.floor(villager.travelled / STRIDE_PX) % STRIDE_FRAMES.length] as number;
    body.setFrame(`${villager.look.view}-${frame}`).setFlipX(villager.look.flip);
    body.y = frame === 0 ? -1 : 0;
    if (villager.progress >= 1) {
      villager.cell = villager.path[1] as Cell;
      villager.path = villager.path.slice(1);
      if (villager.path.length === 1) {
        villager.path = [];
        villager.restUntil = time + 2500 + Math.random() * 5000;
      }
    }
  }

  private chooseRoute(villager: Villager, time: number): void {
    const district = Phaser.Utils.Array.GetRandom([...VILLAGER_DISTRICTS]) as (typeof VILLAGER_DISTRICTS)[number];
    const spots = spotsOf(district).filter((cell) => isWalkable(cell, this.hooks.strangerScores));
    const target = Phaser.Utils.Array.GetRandom(spots) as Cell | undefined;
    const path = target ? findPath(villager.cell, target, this.hooks.strangerScores) : [];
    if (path.length >= 2) {
      villager.path = path;
      villager.progress = 1;
    } else {
      villager.restUntil = time + 2000;
    }
  }
}
