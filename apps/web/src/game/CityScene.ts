import * as Phaser from 'phaser';
import type { CitizenRecord } from '@bas/content';
import { LOCKABLE_DISTRICTS } from '@/lib/data/districts';
import type { DistrictId } from '@/lib/data/types';
import type { CityMode } from '@/stores/types';
import { CityAmbience } from './cityAmbience';
import {
  HALF_TILE_H,
  HALF_TILE_W,
  MAP_HEIGHT,
  MAP_WIDTH,
  PROPS,
  STUDIO,
  canEnter,
  cellAt,
  cellCenter,
  findPath,
  isBehind,
  isWalkable,
  labelPosition,
  propOrder,
  spotsOf,
  standable,
  zoneOf,
  type Cell,
  type Prop,
  type Scores,
  type Zone,
} from './cityGrid';
import { liftShoves, separate, type CrowdMember } from './cityCrowd';

/** What the scene needs to know about one citizen. */
export interface CityCitizen {
  id: number;
  name: string;
  sprite: string;
  roleKey: CitizenRecord['roleKey'];
  owned: boolean;
  scores: Scores;
}

export interface CityActivity {
  walking: boolean;
  /** District the citizen is heading to, or standing in. */
  zone: Zone | undefined;
}

export interface CitySceneOptions {
  citizens: readonly CityCitizen[];
  selectedId: number;
  mode: CityMode;
  /** Label copy per district: the name, and the rule shown while locked. */
  labels: Readonly<Record<DistrictId, { name: string; locked: string }>>;
  onSelect: (id: number) => void;
  /** Copy for the sign over BAS Studio. */
  studio: { name: string; hint: string };
  /** BAS Studio or its sign was tapped. */
  onStudio: () => void;
  /** The selected citizen was asked to walk somewhere it may not go. */
  onBlocked: (district: DistrictId) => void;
  /** The map was tapped while the selected citizen belongs to someone else. */
  onNotOwned: () => void;
  onActivity: (id: number, activity: CityActivity) => void;
  /** Where a mission's walking step wants a citizen to go, or `null`. */
  target: MissionTarget | null;
  /** The citizen reached `target`; called once per target key. */
  onArrive: (key: string) => void;
}

export interface MissionTarget {
  citizenId: number;
  cell: Cell;
  /** Changes with every step, so arriving twice at one step counts once. */
  key: string;
}

/** Where each role likes to spend its day; plaza is everyone's meeting point. */
const ROUTINE: Readonly<Record<CitizenRecord['roleKey'], readonly DistrictId[]>> = {
  pioneer: ['forge', 'frontier', 'plaza'],
  steward: ['hearth', 'plaza'],
  artisan: ['forge', 'plaza'],
  sentinel: ['watch', 'plaza'],
  scholar: ['archive', 'frontier', 'plaza'],
  navigator: ['frontier', 'archive', 'plaza'],
  mentor: ['plaza', 'hearth', 'archive'],
};

const WALK_SPEED = 0.07; // world px per ms
const MAX_FRAME_MS = 100;
/** Screen pixels the header bar covers at the top of the canvas. */
const HEADER_SPACE = 84;
const PHONE_WIDTH = 700;
/** Depth units per step of painter's order; citizens fit between two props. */
const DEPTH_STEP = 10;
const LABEL_DEPTH = 5000;
/** The mission marker's arrow shows even behind a building. */
const MARKER_DEPTH = 5500;
/** Above every citizen and district label. */
const TAG_DEPTH = 6000;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.5;
const GOLD = 0xf7d23d;

const sideKey = (id: number) => `citizen-${id}`;


interface Walker {
  data: CityCitizen;
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Text;
  /** Drawn sprite size; the tag floats this far above the feet. */
  size: number;
  /** Standing behind a prop this frame. */
  hidden: boolean;
  cell: Cell;
  path: Cell[];
  from: { x: number; y: number };
  to: { x: number; y: number };
  progress: number;
  travelled: number;
  routineIndex: number;
  restUntil: number;
  heading: Zone | undefined;
  /** Moving under keyboard control this frame. */
  keyMoving: boolean;
  /** Screen direction the citizen faces; picks the sprite and points the facing arrow. */
  face: { x: number; y: number };
  /** Whether `body` is mirrored to face left. */
  flipped: boolean;
  /** How this walker takes part in keeping people from overlapping. */
  member: CrowdMember;
}

export class CityScene extends Phaser.Scene {
  private options: CitySceneOptions;
  private readonly walkers = new Map<number, Walker>();
  /** Everyone who must not overlap: the citizens and the townsfolk. */
  private readonly crowd: CrowdMember[] = [];
  private readonly locks = new Map<DistrictId, Phaser.GameObjects.Image>();
  private readonly labelTexts = new Map<DistrictId, Phaser.GameObjects.Text>();
  private readonly props: {
    prop: Prop;
    index: number;
    image: Phaser.GameObjects.Image;
    bounds: Phaser.Geom.Rectangle;
  }[] = [];
  private ring!: Phaser.GameObjects.Ellipse;
  private markerTile!: Phaser.GameObjects.Graphics;
  private markerArrow!: Phaser.GameObjects.Triangle;
  private arrivedKey: string | null = null;
  private dots!: Phaser.GameObjects.Graphics;
  /** Arrow at the selected citizen's feet showing the screen direction they face. */
  private facingArrow!: Phaser.GameObjects.Graphics;
  /** The not-owned notice was already shown for the keys held right now. */
  private notOwnedShown = false;
  private drag: { x: number; y: number; scrollX: number; scrollY: number; moved: boolean } | null = null;
  /** While true the camera glides after the selected citizen; dragging the map lets go. */
  private following = false;
  private lastBlockedAt = 0;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private lastActivity = '';
  private ambience: CityAmbience | undefined;
  private resizeHandler: (() => void) | null = null;

  constructor(options: CitySceneOptions) {
    super('city');
    this.options = options;
  }

  preload(): void {
    this.load.image('city-base', '/images/city/city-base.png');
    this.load.image('city-props', '/images/city/city-props.png');
    this.load.image('lock-watch', '/images/city/lock-watch.png');
    this.load.image('lock-frontier', '/images/city/lock-frontier.png');
    this.load.image('lock-summit', '/images/city/lock-summit.png');
    for (const citizen of this.options.citizens) {
      this.load.image(sideKey(citizen.id), citizen.sprite);
    }
  }

  create(): void {
    this.add.image(0, 0, 'city-base').setOrigin(0, 0).setDepth(-2);
    for (const district of LOCKABLE_DISTRICTS) {
      this.locks.set(district, this.add.image(0, 0, `lock-${district}`).setOrigin(0, 0).setDepth(-1));
    }

    const sheet = this.textures.get('city-props');
    PROPS.forEach((prop, index) => {
      const [sx, sy, w, h] = prop.frame;
      sheet.add(`prop-${index}`, 0, sx, sy, w, h);
      if (prop.dimmedFrame) sheet.add(`prop-${index}-dimmed`, 0, ...prop.dimmedFrame);
      const image = this.add
        .image(prop.at[0], prop.at[1], 'city-props', `prop-${index}`)
        .setOrigin(0, 0)
        .setDepth(propOrder(prop) * DEPTH_STEP);
      this.props.push({ prop, index, image, bounds: new Phaser.Geom.Rectangle(prop.at[0], prop.at[1], w, h) });
    });

    this.ring = this.add.ellipse(0, 0, 50, 20).setStrokeStyle(3, GOLD).setDepth(0);
    this.tweens.add({ targets: this.ring, scaleX: 1.15, scaleY: 1.15, duration: 600, yoyo: true, repeat: -1 });
    this.dots = this.add.graphics().setDepth(1);
    this.facingArrow = this.add.graphics().setDepth(1);
    this.markerTile = this.add.graphics().setDepth(-0.5).setVisible(false);
    this.markerArrow = this.add
      .triangle(0, 0, 0, 0, 22, 0, 11, 16, GOLD)
      .setStrokeStyle(3, 0x1a2734)
      .setDepth(MARKER_DEPTH)
      .setVisible(false);

    this.options.citizens.forEach((citizen, index) => this.spawn(citizen, index));
    const strangerScores = Object.fromEntries(
      Object.keys(this.options.citizens[0]?.scores ?? {}).map((stat) => [stat, 0]),
    ) as unknown as Scores;
    this.ambience = new CityAmbience(this, {
      depthAt: (x, y, size, cell) => this.depthAt(x, y, size, cell).depth,
      strangerScores,
    });
    this.ambience.create();
    this.crowd.push(...this.ambience.members());
    this.setupStudio();
    for (const [district, position] of this.labelPositions()) {
      const text = this.add
        .text(position.x, position.y, '', {
          fontFamily: 'Silkscreen, monospace',
          fontSize: '10px',
          color: '#f2f6fa',
          backgroundColor: 'rgba(12, 22, 34, 0.82)',
          padding: { x: 6, y: 3 },
          align: 'center',
        })
        .setOrigin(0.5, 1)
        .setResolution(2)
        .setDepth(LABEL_DEPTH);
      this.labelTexts.set(district, text);
    }

    this.setupCamera();
    this.setupInput();
    this.refresh();
    this.placeMarker();
  }

  /** Called by the React side whenever store data the scene shows has changed. */
  sync(options: CitySceneOptions): void {
    const modeChanged = options.mode !== this.options.mode;
    if (options.selectedId !== this.options.selectedId) this.following = true;
    this.options = options;
    for (const citizen of options.citizens) {
      const walker = this.walkers.get(citizen.id);
      if (walker) walker.data = citizen;
    }
    if (modeChanged) {
      const selected = this.walkers.get(options.selectedId);
      if (selected) selected.restUntil = 0;
    }
    if (this.sys.isActive()) {
      this.refresh();
      this.placeMarker();
    }
  }

  zoomBy(step: 1 | -1): void {
    const camera = this.cameras.main;
    camera.zoomTo(Phaser.Math.Clamp(camera.zoom * (step > 0 ? 1.25 : 0.8), this.minZoom(), ZOOM_MAX), 160);
  }

  focusSelected(): void {
    const walker = this.walkers.get(this.options.selectedId);
    if (!walker) return;
    this.following = true;
    const camera = this.cameras.main;
    // Snap straight to the citizen; `update` then keeps the camera on them.
    camera.centerOn(walker.root.x, walker.root.y - 30);
  }

  /**
   * Walks the citizen of the current mission step to its stop and brings the
   * camera along. Works in both city modes, since the player asked for it.
   */
  walkToTarget(): void {
    const target = this.options.target;
    const walker = target ? this.walkers.get(target.citizenId) : undefined;
    if (!target || !walker || !walker.data.owned) return;
    this.routeTo(walker, target.cell);
    this.focusSelected();
  }

  /**
   * Arrow keys / WASD move the selected citizen freely while held, in screen directions,
   * sliding along walls. F or Space brings the camera back to them.
   */
  private handleKeys(elapsed: number): void {
    const walker = this.walkers.get(this.options.selectedId);
    if (!walker) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    const k = this.keys;
    const down = (a: string, b: string) => Boolean(k[a]?.isDown || k[b]?.isDown);
    if (Phaser.Input.Keyboard.JustDown(k.F as Phaser.Input.Keyboard.Key) || Phaser.Input.Keyboard.JustDown(k.SPACE as Phaser.Input.Keyboard.Key)) {
      this.focusSelected();
    }
    let sx = (down('RIGHT', 'D') ? 1 : 0) - (down('LEFT', 'A') ? 1 : 0);
    let sy = (down('DOWN', 'S') ? 1 : 0) - (down('UP', 'W') ? 1 : 0);
    if (sx === 0 && sy === 0) {
      walker.keyMoving = false;
      this.notOwnedShown = false;
      return;
    }
    this.following = true;
    if (!this.isPlayerControlled(walker)) {
      // Holding a key repeats every frame; the notice opens once per key press.
      if (!walker.data.owned && !this.notOwnedShown) {
        this.notOwnedShown = true;
        this.options.onNotOwned();
      }
      return;
    }
    if (sx !== 0 && sy !== 0) {
      sx *= Math.SQRT1_2;
      sy *= Math.SQRT1_2;
    }
    // A pending click route is dropped: the keyboard takes over from where the citizen stands.
    walker.path = [];
    walker.progress = 1;
    const scores = walker.data.scores;
    const open = (x: number, y: number) => {
      const cell = cellAt(x, y);
      if (!cell || !isWalkable(cell, scores)) return undefined;
      const zone = zoneOf(cell);
      if (zone && zone !== 'road' && !canEnter(zone, scores)) return undefined;
      return cell;
    };
    const stepPx = elapsed * WALK_SPEED;
    const x0 = walker.root.x;
    const y0 = walker.root.y;
    const dx = sx * stepPx;
    const dy = sy * stepPx;
    const tries: Array<[number, number]> = [
      [dx, dy],
      [dx, 0],
      [0, dy],
    ];
    let moved: Cell | undefined;
    let nx = x0;
    let ny = y0;
    for (const [tx, ty] of tries) {
      if (tx === 0 && ty === 0) continue;
      const cell = open(x0 + tx, y0 + ty);
      if (cell) {
        moved = cell;
        nx = x0 + tx;
        ny = y0 + ty;
        break;
      }
    }
    if (!moved) {
      let lockedZone: DistrictId | undefined;
      const ahead = cellAt(x0 + dx * 6, y0 + dy * 6);
      const zone = ahead ? zoneOf(ahead) : undefined;
      if (zone && zone !== 'road' && !canEnter(zone, scores)) lockedZone = zone;
      if (lockedZone && this.time.now - this.lastBlockedAt > 1500) {
        this.lastBlockedAt = this.time.now;
        this.options.onBlocked(lockedZone);
      }
      return;
    }
    walker.root.setPosition(nx, ny);
    walker.cell = moved;
    walker.from = { x: nx, y: ny };
    walker.to = { x: nx, y: ny };
    walker.travelled += Math.hypot(nx - x0, ny - y0);
    walker.keyMoving = true;
    walker.face = { x: sx, y: sy };
  }

  /**
   * Every direction uses the same portrait; it is only mirrored, to face left or right. Walking
   * straight up or down keeps the last mirroring, so the citizen keeps their shape.
   */
  private applyFrame(walker: Walker): void {
    if (Math.abs(walker.face.x) < 1e-3) return;
    const flipped = walker.face.x < 0;
    if (flipped === walker.flipped) return;
    walker.body.setFlipX(flipped);
    walker.flipped = flipped;
  }

  /**
   * A gold arrow on the ground, just outside the ring, pointing the way the citizen walks.
   * Walking away it lies on the ground behind the body, so the sprite covers it, as it would
   * cover anything else standing there; the back sprite shows the direction then.
   */
  private drawFacingArrow(walker: Walker): void {
    const len = Math.hypot(walker.face.x, walker.face.y) || 1;
    const ux = walker.face.x / len;
    const uy = walker.face.y / len;
    const cx = walker.root.x + ux * 36;
    const cy = walker.root.y + uy * 15;
    const px = -uy;
    const py = ux;
    const g = this.facingArrow;
    // Ahead of the citizen it draws over the sprite; behind them it draws under it.
    g.clear().setDepth(walker.root.depth + (uy < -0.3 ? -0.005 : 0.5));
    g.fillStyle(GOLD, 1).lineStyle(2, 0x1a2734, 1);
    g.fillTriangle(cx + ux * 11, cy + uy * 11, cx + px * 8 - ux * 6, cy + py * 8 - uy * 6, cx - px * 8 - ux * 6, cy - py * 8 - uy * 6);
    g.strokeTriangle(cx + ux * 11, cy + uy * 11, cx + px * 8 - ux * 6, cy + py * 8 - uy * 6, cx - px * 8 - ux * 6, cy - py * 8 - uy * 6);
    g.setVisible(true);
  }

  override update(time: number, delta: number): void {
    // Phaser smooths `delta` toward 60 fps, which slows walkers down on a
    // device that renders fewer frames. Move by the real frame time instead,
    // capped so a backgrounded tab does not teleport anyone.
    const elapsed = Math.min(this.game.loop.rawDelta || delta, MAX_FRAME_MS);
    // Routes move everyone from where the route says; the crowd pass then nudges overlapping people apart.
    liftShoves(this.crowd);
    this.handleKeys(elapsed);
    for (const walker of this.walkers.values()) {
      this.step(walker, time, elapsed);
      this.applyFrame(walker);
    }
    this.ambience?.update(time, elapsed);
    for (const walker of this.walkers.values()) walker.member.anchored = this.isPlayerControlled(walker);
    separate(this.crowd);
    this.ambience?.refreshDepths();
    for (const walker of this.walkers.values()) {
      // Tags live outside the citizen's container so they always draw above the district labels.
      walker.tag.setPosition(walker.root.x, walker.root.y - walker.size - 6);
      walker.root.setDepth(this.depthOf(walker));
    }
    this.fadeCoveredLabels();
    this.checkArrival();
    const selected = this.walkers.get(this.options.selectedId);
    this.dots.clear();
    if (selected) {
      this.ring.setPosition(selected.root.x, selected.root.y).setDepth(selected.root.depth - 0.01).setVisible(true);
      this.dots.fillStyle(GOLD, 1);
      selected.path.forEach((cell, index) => {
        if (index === 0 || index % 2 === 1) return;
        const { x, y } = cellCenter(cell);
        this.dots.fillRect(x - 3, y - 3, 6, 6);
      });
      this.reportActivity(selected);
      this.drawFacingArrow(selected);
    } else {
      this.ring.setVisible(false);
      this.facingArrow.clear();
    }
    if (this.following && selected && !this.drag?.moved) {
      const camera = this.cameras.main;
      const tx = selected.root.x;
      const ty = selected.root.y - 30;
      const cx = camera.scrollX + camera.width / 2;
      const cy = camera.scrollY + camera.height / 2;
      const ease = Math.min(1, elapsed / 140);
      camera.centerOn(cx + (tx - cx) * ease, cy + (ty - cy) * ease);
    }
  }

  // --- citizens ---------------------------------------------------------------

  private spawn(citizen: CityCitizen, index: number): void {
    const routine = this.routineOf(citizen);
    const district = routine[index % routine.length] ?? 'plaza';
    const spots = spotsOf(district).filter((cell) => isWalkable(cell, citizen.scores));
    const cell = spots[index % Math.max(spots.length, 1)] ?? ([12, 10] as Cell);
    const { x, y } = cellCenter(cell);
    const size = citizen.owned ? 46 : 38;

    const shadow = this.add.ellipse(0, 0, size * 0.62, size * 0.18, 0x000000, 0.35);
    const body = this.add.image(0, 0, sideKey(citizen.id)).setOrigin(0.5, 1).setDisplaySize(size, size);
    body.setInteractive({ useHandCursor: true });
    body.on('pointerup', () => {
      if (!this.drag?.moved) this.options.onSelect(citizen.id);
    });
    const tag = this.add
      .text(x, y - size - 6, citizen.name.toUpperCase(), {
        fontFamily: 'Silkscreen, monospace',
        fontSize: '9px',
        color: '#1a2734',
        backgroundColor: '#e3ecf4',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(TAG_DEPTH)
      .setVisible(false);
    // Tags of every citizen at once crowd the plaza; show the selected one and the one under the pointer.
    body.on('pointerover', () => tag.setVisible(true));
    body.on('pointerout', () => tag.setVisible(citizen.id === this.options.selectedId));
    const parts: Phaser.GameObjects.GameObject[] = [shadow, body];
    const root = this.add.container(x, y, parts).setDepth(y);
    const member: CrowdMember = {
      root,
      shove: { x: 0, y: 0 },
      radius: size * 0.33,
      anchored: false,
      canStand: (px, py) => standable(px, py, this.walkers.get(citizen.id)?.data.scores ?? citizen.scores),
    };
    this.crowd.push(member);
    this.walkers.set(citizen.id, {
      data: citizen,
      root,
      body,
      tag,
      size,
      hidden: false,
      cell,
      path: [],
      from: { x, y },
      to: { x, y },
      progress: 1,
      travelled: 0,
      routineIndex: index,
      restUntil: 600 + index * 450,
      heading: zoneOf(cell),
      keyMoving: false,
      face: { x: 0, y: 1 },
      flipped: false,
      member,
    });
  }

  private routineOf(citizen: CityCitizen): DistrictId[] {
    return (ROUTINE[citizen.roleKey] ?? ['plaza']).filter((district) => canEnter(district, citizen.scores));
  }

  private isPlayerControlled(walker: Walker): boolean {
    return this.options.mode === 'control' && walker.data.owned && walker.data.id === this.options.selectedId;
  }

  private walk(walker: Walker, path: Cell[]): void {
    if (path.length < 2) return;
    walker.path = path;
    walker.progress = 1;
    const last = path[path.length - 1] as Cell;
    walker.heading = zoneOf(last);
  }

  private step(walker: Walker, time: number, delta: number): void {
    const { root, body } = walker;

    if (walker.path.length === 0) {
      body.y = walker.keyMoving
        ? -Math.abs(Math.sin(walker.travelled / 11)) * 7
        : Math.sin(time / 380 + walker.data.id) * 1.2;
      if (!walker.keyMoving && !this.isPlayerControlled(walker) && time >= walker.restUntil) this.chooseNextStop(walker, time);
      return;
    }

    if (walker.progress >= 1) {
      const next = walker.path[1];
      if (!next) {
        walker.path = [];
        walker.restUntil = time + 2500 + ((walker.data.id * 977) % 3500);
        return;
      }
      walker.from = cellCenter(walker.path[0] as Cell);
      walker.to = cellCenter(next);
      walker.progress = 0;
    }

    const distance = Phaser.Math.Distance.Between(walker.from.x, walker.from.y, walker.to.x, walker.to.y) || 1;
    walker.progress = Math.min(1, walker.progress + (delta * WALK_SPEED) / distance);
    walker.travelled += delta * WALK_SPEED;
    root.x = Phaser.Math.Linear(walker.from.x, walker.to.x, walker.progress);
    root.y = Phaser.Math.Linear(walker.from.y, walker.to.y, walker.progress);
    const hop = Math.abs(Math.sin(walker.travelled / 11));
    body.y = -hop * 7;
    walker.face = { x: walker.to.x - walker.from.x, y: walker.to.y - walker.from.y };

    if (walker.progress >= 1) {
      walker.cell = walker.path[1] as Cell;
      walker.path = walker.path.slice(1);
      if (walker.path.length === 1) walker.path = [];
      if (walker.path.length === 0) walker.restUntil = time + 2500 + ((walker.data.id * 977) % 3500);
    }
  }

  private chooseNextStop(walker: Walker, time: number): void {
    const routine = this.routineOf(walker.data);
    walker.routineIndex = (walker.routineIndex + 1) % Math.max(routine.length, 1);
    const district = routine[walker.routineIndex] ?? 'plaza';
    const spots = spotsOf(district).filter((cell) => isWalkable(cell, walker.data.scores));
    const target = spots[Math.floor(Math.random() * spots.length)];
    const path = target ? findPath(walker.cell, target, walker.data.scores) : [];
    if (path.length >= 2) this.walk(walker, path);
    else walker.restUntil = time + 2000;
  }

  // --- state shown on the map -------------------------------------------------

  /** Draws the marker of the current walking step, or hides it. */
  private placeMarker(): void {
    const target = this.options.target;
    this.markerTile.clear();
    if (!target) {
      this.markerTile.setVisible(false);
      this.markerArrow.setVisible(false);
      return;
    }
    const { x, y } = cellCenter(target.cell);
    const w = HALF_TILE_W;
    const h = HALF_TILE_H;
    this.markerTile
      .fillStyle(GOLD, 0.45)
      .fillRect(x - w, y - h, w * 2, h * 2)
      .lineStyle(2, 0x1a2734, 1)
      .strokeRect(x - w, y - h, w * 2, h * 2)
      .setVisible(true);
    this.tweens.killTweensOf(this.markerArrow);
    this.markerArrow.setPosition(x, y - 74).setVisible(true);
    this.tweens.add({ targets: this.markerArrow, y: y - 84, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private checkArrival(): void {
    const target = this.options.target;
    if (!target || this.arrivedKey === target.key) return;
    const walker = this.walkers.get(target.citizenId);
    if (!walker || walker.path.length > 0) return;
    if (walker.cell[0] !== target.cell[0] || walker.cell[1] !== target.cell[1]) return;
    this.arrivedKey = target.key;
    this.options.onArrive(target.key);
  }

  /**
   * Depth of a citizen against the props around it. Hidden by every prop it
   * stands behind, drawn over every other prop its sprite touches.
   */
  private depthOf(walker: Walker): number {
    const { depth, hidden } = this.depthAt(walker.root.x, walker.root.y, walker.size, walker.cell);
    walker.hidden = hidden;
    return depth;
  }

  /** Painter's depth of something `size` pixels tall standing at a world point. */
  private depthAt(x: number, y: number, size: number, fallback: Cell): { depth: number; hidden: boolean } {
    const cell = cellAt(x, y - 1) ?? fallback;
    const area = new Phaser.Geom.Rectangle(x - size / 2, y - size, size, size);
    let behind = Infinity;
    let front = -Infinity;
    for (const { prop, bounds } of this.props) {
      if (!Phaser.Geom.Intersects.RectangleToRectangle(area, bounds)) continue;
      const order = propOrder(prop);
      if (isBehind(cell, prop)) behind = Math.min(behind, order);
      else front = Math.max(front, order);
    }
    // Ties between citizens go to the one lower on screen.
    const tie = y / MAP_HEIGHT;
    if (behind !== Infinity) return { depth: behind * DEPTH_STEP - 2 + tie, hidden: true };
    if (front !== -Infinity) return { depth: front * DEPTH_STEP + 1 + tie, hidden: false };
    return { depth: (cell[1] + 1) * DEPTH_STEP + 1 + tie, hidden: false };
  }

  /** A district label over a citizen fades out, so the citizen and its name stay readable. */
  private fadeCoveredLabels(): void {
    const shown: Phaser.Geom.Rectangle[] = [];
    for (const walker of this.walkers.values()) {
      // Someone tucked behind a house does not need the label out of the way, unless its name shows.
      if (walker.hidden && !walker.tag.visible) continue;
      const top = walker.tag.visible ? walker.tag.y - walker.tag.height : walker.root.y - walker.size;
      const width = Math.max(walker.size, walker.tag.visible ? walker.tag.width : 0);
      shown.push(new Phaser.Geom.Rectangle(walker.root.x - width / 2, top, width, walker.root.y - top));
    }
    for (const label of this.labelTexts.values()) {
      const bounds = label.getBounds();
      const covered = shown.some((rect) => Phaser.Geom.Intersects.RectangleToRectangle(rect, bounds));
      const target = covered ? 0.2 : 1;
      label.setAlpha(label.alpha + (target - label.alpha) * 0.2);
    }
  }

  private refresh(): void {
    const selected = this.options.citizens.find((citizen) => citizen.id === this.options.selectedId);
    for (const [district, image] of this.locks) {
      image.setVisible(!selected || !canEnter(district, selected.scores));
      this.ambience?.setLocked(district, image.visible);
    }
    for (const { prop, index, image } of this.props) {
      const locked = prop.dimmedFrame !== undefined && (this.locks.get(prop.zone as DistrictId)?.visible ?? false);
      image.setFrame(locked ? `prop-${index}-dimmed` : `prop-${index}`);
    }
    for (const [district, text] of this.labelTexts) {
      const copy = this.options.labels[district];
      const locked = this.locks.get(district)?.visible ?? false;
      text.setText(locked ? `${copy.name.toUpperCase()}\n${copy.locked}` : copy.name.toUpperCase());
      text.setColor(locked ? '#9aa9b8' : '#f2f6fa');
    }
    for (const walker of this.walkers.values()) {
      const isSelected = walker.data.id === this.options.selectedId;
      walker.tag
        .setVisible(isSelected)
        .setColor(isSelected ? '#f7d23d' : '#1a2734')
        .setBackgroundColor(isSelected ? '#1a2734' : '#e3ecf4');
    }
  }

  /** BAS Studio answers a tap, on the building or on its sign, and glows a little under the pointer. */
  private setupStudio(): void {
    const [gx, gy, w, d] = STUDIO.cells;
    const building = this.props.find(({ prop }) => {
      const [px, py, pw, pd] = prop.cells;
      return px === gx && py === gy && pw === w && pd === d;
    });
    const sign = this.add
      .text(STUDIO.label[0], STUDIO.label[1], `${this.options.studio.name.toUpperCase()}\n${this.options.studio.hint}`, {
        fontFamily: 'Silkscreen, monospace',
        fontSize: '10px',
        color: '#f7d23d',
        backgroundColor: 'rgba(40, 20, 52, 0.88)',
        padding: { x: 7, y: 4 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(LABEL_DEPTH);
    this.tweens.add({ targets: sign, y: STUDIO.label[1] - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const targets = building ? [building.image] : [];
    const open = () => {
      if (!this.drag?.moved) this.options.onStudio();
    };
    for (const target of [sign, ...(building ? [building.image] : [])]) {
      target.setInteractive({ useHandCursor: true, pixelPerfect: target !== sign });
      target.on('pointerup', open);
      target.on('pointerover', () => targets.forEach((image) => image.setTint(0xfff0d8)));
      target.on('pointerout', () => targets.forEach((image) => image.clearTint()));
    }
  }

  private labelPositions(): [DistrictId, { x: number; y: number }][] {
    return (Object.keys(this.options.labels) as DistrictId[]).map((district) => [district, labelPosition(district)]);
  }

  private reportActivity(walker: Walker): void {
    const walking = walker.path.length > 0;
    const zone = walking ? walker.heading : zoneOf(walker.cell);
    const signature = `${walker.data.id}:${walking}:${zone}`;
    if (signature === this.lastActivity) return;
    this.lastActivity = signature;
    this.options.onActivity(walker.data.id, { walking, zone });
  }

  // --- camera and input -------------------------------------------------------

  private setupCamera(): void {
    const camera = this.cameras.main;
    // Full screen: the map always covers the whole view, and the player scrolls around it.
    camera.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    let first = true;
    const fit = () => {
      const { width, height } = this.scale.gameSize;
      const walker = this.walkers.get(this.options.selectedId);
      const min = this.minZoom();
      const wanted = first ? (width < PHONE_WIDTH ? 0.9 : 1) : camera.zoom;
      camera.setZoom(Phaser.Math.Clamp(wanted, min, ZOOM_MAX));
      if (first && walker) camera.centerOn(walker.root.x, walker.root.y);
      first = false;
    };
    fit();
    if (this.resizeHandler) this.scale.off('resize', this.resizeHandler);
    this.resizeHandler = fit;
    this.scale.on('resize', fit);
    this.events.once('shutdown', () => {
      if (this.resizeHandler) this.scale.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    });
  }

  /** The smallest zoom at which the map still fills the whole screen. */
  private minZoom(): number {
    const { width, height } = this.scale.gameSize;
    return Math.max(width / MAP_WIDTH, height / MAP_HEIGHT, ZOOM_MIN);
  }

  private setupInput(): void {
    const camera = this.cameras.main;
    const keyboard = this.input.keyboard;
    if (keyboard) {
      // Do not swallow keys globally, so text fields elsewhere on the page keep working.
      keyboard.disableGlobalCapture();
      this.keys = keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,F,SPACE', false) as Record<string, Phaser.Input.Keyboard.Key>;
      this.game.canvas.tabIndex = 0;
      this.game.canvas.focus({ preventScroll: true });
    }
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.drag = { x: pointer.x, y: pointer.y, scrollX: camera.scrollX, scrollY: camera.scrollY, moved: false };
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.drag || !pointer.isDown) return;
      const dx = pointer.x - this.drag.x;
      const dy = pointer.y - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        this.drag.moved = true;
        this.following = false;
      }
      if (this.drag.moved) camera.setScroll(this.drag.scrollX - dx / camera.zoom, this.drag.scrollY - dy / camera.zoom);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const moved = this.drag?.moved ?? false;
      this.time.delayedCall(0, () => {
        this.drag = null;
      });
      if (moved || over.length > 0) return;
      const world = camera.getWorldPoint(pointer.x, pointer.y);
      this.walkSelectedTo(world.x, world.y);
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      this.zoomBy(dy > 0 ? -1 : 1);
    });
  }

  private walkSelectedTo(x: number, y: number): void {
    const walker = this.walkers.get(this.options.selectedId);
    const target = cellAt(x, y);
    if (!walker || !target) return;
    if (!walker.data.owned) {
      this.options.onNotOwned();
      return;
    }
    if (this.options.mode !== 'control') return;
    const zone = zoneOf(target);
    if (zone && zone !== 'road' && !canEnter(zone, walker.data.scores)) {
      this.options.onBlocked(zone);
      return;
    }
    const goal = this.nearestWalkable(target, walker.data.scores);
    if (!goal) return;
    this.routeTo(walker, goal);
  }

  /** Sends a walker to `goal`; a step already in progress is finished first. */
  private routeTo(walker: Walker, goal: Cell): void {
    const midStep = walker.path.length >= 2 && walker.progress < 1;
    const start = midStep ? (walker.path[1] as Cell) : walker.cell;
    const route = findPath(start, goal, walker.data.scores);
    if (route.length === 0) return;
    if (midStep) {
      walker.path = [walker.path[0] as Cell, ...route];
      walker.heading = zoneOf(goal);
    } else {
      this.walk(walker, route);
    }
  }

  private nearestWalkable(cell: Cell, scores: Scores): Cell | undefined {
    for (let radius = 0; radius <= 3; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const candidate: Cell = [cell[0] + dx, cell[1] + dy];
          if (isWalkable(candidate, scores)) return candidate;
        }
      }
    }
    return undefined;
  }
}
