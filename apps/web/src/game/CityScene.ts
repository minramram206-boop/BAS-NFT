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
  FOMO,
  STUDIO_DOORWAY_CELL,
  STUDIO_STAGE_CELL,
  canEnter,
  cellAt,
  cellCenter,
  findPath,
  isBehind,
  isStudioInterior,
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

export interface StudioStageView {
  /** True while the selected citizen is inside BAS Studio or walking into it. */
  inside: boolean;
  /** Cutaway reveal progress (0 = exterior roof shown, 1 = interior hall open). */
  open: number;
  /** Screen-space bounding box (in canvas CSS px) of the stage video screen inside the building. */
  screen: { left: number; top: number; width: number; height: number };
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
  /** Copy for the sign over FOMO Office. */
  fomo?: { name: string; hint: string };
  /** FOMO Office or its sign was tapped. */
  onFomo?: () => void;
  /** Reports the in-building studio cutaway state and stage screen rectangle. */
  onStudioView?: (view: StudioStageView) => void;
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
/** Full-screen indoor room layer covering the outdoor map and labels when inside BAS Studio. */
const INDOOR_ROOM_DEPTH = 5200;
const INDOOR_CITIZEN_DEPTH = 5300;
const INDOOR_FRONT_DEPTH = 5250;
/** The mission marker's arrow shows even behind a building. */
const MARKER_DEPTH = 5500;
/** Above every citizen and district label. */
const TAG_DEPTH = 6000;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.5;
const GOLD = 0xf7d23d;
const STUDIO_CAMERA_X = 540;
const STUDIO_CAMERA_Y = 1312;

/** Spacious auditorium floor positions where fellow studio-goer citizens hang out while the player is inside. */
const STUDIO_AUDIENCE_SPOTS: readonly { x: number; y: number; faceX: number }[] = [
  { x: 375, y: 1378, faceX: 0.35 },
  { x: 705, y: 1378, faceX: -0.35 },
  { x: 335, y: 1455, faceX: 0.4 },
  { x: 745, y: 1455, faceX: -0.4 },
  { x: 445, y: 1488, faceX: 0.25 },
  { x: 635, y: 1488, faceX: -0.25 },
];

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
  /** Waypoints the player citizen follows across the indoor BAS Studio floor. */
  studioGoals: { x: number; y: number }[];
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
  private studioBuilding: Phaser.GameObjects.Image | undefined;
  private studioSign: Phaser.GameObjects.Text | undefined;
  private fomoBuilding: Phaser.GameObjects.Image | undefined;
  private fomoSign: Phaser.GameObjects.Text | undefined;
  private studioInterior!: Phaser.GameObjects.Graphics;
  private studioIndoorFront!: Phaser.GameObjects.Graphics;
  private studioDoorwayBg!: Phaser.GameObjects.Graphics;
  private studioDoorLeaves!: Phaser.GameObjects.Graphics;
  /** True while the player has sent the selected citizen into BAS Studio. */
  private studioSession = false;
  /** True while the camera is locked into the full-screen indoor BAS Studio viewport. */
  private indoorCameraActive = false;
  /** Saved outdoor camera zoom restored when leaving BAS Studio. */
  private outdoorZoom = 1;
  /** Fellow citizens currently hanging out inside the studio auditorium. */
  private readonly studioGuests = new Map<number, Cell>();
  /** 0 = exterior city view, 1 = full indoor BAS Studio concert hall view. */
  private studioOpen = 0;
  /** 0 = automatic glass doors closed, 1 = automatic glass doors slid open. */
  private studioDoorOpen = 0;
  private studioDoorHoldUntil = 0;
  private lastStudioSignature = '';

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
    this.setupFomo();
    for (const [district, position] of this.labelPositions()) {
      const text = this.add
        .text(position.x, position.y, '', {
          fontFamily: 'Silkscreen, monospace',
          fontSize: '10px',
          color: '#f2f6fa',
          backgroundColor: 'rgba(10, 18, 28, 0.88)',
          padding: { x: 8, y: 4 },
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
    if (this.indoorCameraActive) return;
    const camera = this.cameras.main;
    camera.zoomTo(Phaser.Math.Clamp(camera.zoom * (step > 0 ? 1.25 : 0.8), this.minZoom(), ZOOM_MAX), 160);
  }

  focusSelected(): void {
    const walker = this.walkers.get(this.options.selectedId);
    if (!walker) return;
    this.following = true;
    const camera = this.cameras.main;
    if (this.indoorCameraActive) {
      camera.centerOn(STUDIO_CAMERA_X, STUDIO_CAMERA_Y);
      return;
    }
    // Snap straight to the citizen; `update` then keeps the camera on them.
    camera.centerOn(walker.root.x, walker.root.y - 30);
  }

  /** Walks the selected citizen through the automatic doors into the BAS Studio indoor auditorium. */
  enterStudio(): void {
    const walker = this.walkers.get(this.options.selectedId);
    this.studioSession = true;
    this.following = true;
    this.populateStudioGuests();
    if (!walker) return;
    if (!isStudioInterior(walker.cell)) {
      const dist = Math.abs(walker.cell[0] - STUDIO.door[0]) + Math.abs(walker.cell[1] - STUDIO.door[1]);
      if (dist > 3) {
        const start = STUDIO_DOORWAY_CELL;
        const pos = cellCenter(start);
        walker.cell = start;
        walker.root.setPosition(pos.x, pos.y);
        walker.from = pos;
        walker.to = pos;
        walker.path = [];
        walker.progress = 1;
      }
      this.routeTo(walker, STUDIO_STAGE_CELL);
    }
  }

  /** Walks the selected citizen out of BAS Studio through the automatic exit doors back to the terrace. */
  exitStudio(): void {
    const walker = this.walkers.get(this.options.selectedId);
    this.studioSession = false;
    this.following = true;
    this.releaseStudioGuests();
    if (!walker) return;
    const doorPos = cellCenter(STUDIO.door);
    walker.cell = STUDIO.door;
    walker.root.setPosition(doorPos.x, doorPos.y);
    walker.from = doorPos;
    walker.to = doorPos;
    walker.path = [];
    walker.studioGoals = [];
    walker.progress = 1;
    const outside: Cell = [STUDIO.door[0], STUDIO.door[1] + 1];
    this.routeTo(walker, outside);
  }

  /** Where the lounge sofas, mixing desk and rack stand; shared by drawing and walking so they always agree. */
  private studioFurniture(): { leftSofaX: number; rightDeskX: number; rackX: number } {
    const { xWallL, xWallR, xBackL, xBackR } = this.studioViewportBounds();
    const leftSofaX = Math.min(240, Math.max(xWallL + 48, xBackL - 28));
    const rightDeskX = Math.max(764, Math.min(xWallR - 124, xBackR - 54));
    return { leftSofaX, rightDeskX, rackX: rightDeskX + 18 };
  }

  /** Ground footprints of the studio furniture that citizens must walk around. */
  private studioObstacles(): { x: number; y: number; w: number; h: number }[] {
    const { leftSofaX, rightDeskX, rackX } = this.studioFurniture();
    return [
      { x: leftSofaX - 4, y: 1372, w: 80, h: 56 },
      { x: leftSofaX - 28, y: 1450, w: 80, h: 56 },
      { x: rightDeskX - 4, y: 1376, w: 90, h: 76 },
      { x: rackX - 4, y: 1466, w: 76, h: 50 },
    ];
  }

  /** True when world point `(x, y)` is open floor, stairs or stage inside the BAS Studio hall. */
  private canStandInStudio(x: number, y: number): boolean {
    const { xBackL, xBackR, xWallL, xWallR, yBackB, yFloorB } = this.studioViewportBounds();
    // Door threshold
    if (y > 1536 && y <= 1552) return Math.abs(x - 540) <= 40;
    // Stage deck
    if (y >= 1310 && y < 1324) return x >= 404 && x <= 676;
    // Center stairs up to the stage
    if (y >= 1324 && y < 1342) return Math.abs(x - 540) <= 34;
    if (y < 1342 || y > 1536) return false;
    const t = (y - yBackB) / (yFloorB - yBackB);
    const minX = Phaser.Math.Linear(xBackL, xWallL, t) + 24;
    const maxX = Phaser.Math.Linear(xBackR, xWallR, t) - 24;
    if (x < minX || x > maxX) return false;
    for (const o of this.studioObstacles()) {
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return false;
    }
    return true;
  }

  /** Finds the closest standable point to `(x, y)` on the studio floor, stairs or stage. */
  private nearestStudioSpot(x: number, y: number): { x: number; y: number } {
    if (this.canStandInStudio(x, y)) return { x, y };
    let best = { x: 540, y: 1420 };
    let bestDist = Infinity;
    for (let radius = 6; radius <= 260; radius += 6) {
      for (let a = 0; a < 24; a += 1) {
        const px = x + Math.cos((a / 24) * Math.PI * 2) * radius;
        const py = y + Math.sin((a / 24) * Math.PI * 2) * radius;
        if (!this.canStandInStudio(px, py)) continue;
        const d = Math.hypot(px - x, py - y);
        if (d < bestDist) {
          bestDist = d;
          best = { x: px, y: py };
        }
      }
      if (bestDist < Infinity) break;
    }
    return best;
  }

  /** Walks `walker` to any point on the indoor BAS Studio floor or stage, taking the stairs up to the stage. */
  private walkInStudioTo(walker: Walker, x: number, y: number): void {
    const target = this.nearestStudioSpot(x, y);
    const goals: { x: number; y: number }[] = [];
    const onStageNow = walker.root.y < 1342;
    const toStage = target.y < 1342;
    if (toStage && !onStageNow) goals.push({ x: 540, y: 1346 }, { x: 540, y: 1318 });
    if (!toStage && onStageNow) goals.push({ x: 540, y: 1318 }, { x: 540, y: 1346 });
    goals.push(target);
    walker.studioGoals = goals;
    walker.path = [];
    walker.progress = 1;
    walker.cell = STUDIO_STAGE_CELL;
  }

  /** Moves the player citizen toward its next studio waypoint, sliding along walls and furniture. */
  private stepStudioGoals(walker: Walker, delta: number): void {
    const goal = walker.studioGoals[0];
    if (!goal) return;
    const x0 = walker.root.x;
    const y0 = walker.root.y;
    const dist = Math.hypot(goal.x - x0, goal.y - y0);
    if (dist < 2) {
      walker.studioGoals.shift();
      walker.body.y = 0;
      return;
    }
    const stepPx = Math.min(dist, delta * WALK_SPEED);
    const ux = (goal.x - x0) / dist;
    const uy = (goal.y - y0) / dist;
    const tries: Array<[number, number]> = [
      [ux * stepPx, uy * stepPx],
      [ux * stepPx, 0],
      [0, uy * stepPx],
    ];
    for (const [tx, ty] of tries) {
      if (Math.abs(tx) + Math.abs(ty) < 1e-6) continue;
      if (!this.canStandInStudio(x0 + tx, y0 + ty)) continue;
      walker.root.setPosition(x0 + tx, y0 + ty);
      walker.from = { x: x0 + tx, y: y0 + ty };
      walker.to = { x: x0 + tx, y: y0 + ty };
      walker.travelled += Math.hypot(tx, ty);
      walker.face = { x: ux, y: uy };
      walker.body.y = -Math.abs(Math.sin(walker.travelled / 11)) * 7;
      return;
    }
    // Boxed in: give up this route instead of pushing against a wall forever.
    walker.studioGoals = [];
    walker.body.y = 0;
  }

  /** Places up to 6 fellow citizens across the wide studio auditorium so the hall feels deep and lively. */
  private populateStudioGuests(): void {
    if (this.studioGuests.size > 0) return;
    const targetId = this.options.target?.citizenId;
    let spotIdx = 0;
    for (const [id, walker] of this.walkers) {
      if (spotIdx >= STUDIO_AUDIENCE_SPOTS.length) break;
      if (id === this.options.selectedId || id === targetId) continue;
      if (isStudioInterior(walker.cell)) continue;
      const spot = STUDIO_AUDIENCE_SPOTS[spotIdx];
      if (!spot) break;
      this.studioGuests.set(id, walker.cell);
      walker.cell = STUDIO_STAGE_CELL;
      const place = this.nearestStudioSpot(spot.x, spot.y);
      walker.root.setPosition(place.x, place.y);
      walker.from = { x: place.x, y: place.y };
      walker.to = { x: place.x, y: place.y };
      walker.path = [];
      walker.progress = 1;
      walker.face = { x: spot.faceX, y: -1 };
      this.applyFrame(walker);
      spotIdx += 1;
    }
  }

  /** Returns fellow studio audience citizens back to their outdoor district spots when leaving the studio. */
  private releaseStudioGuests(): void {
    if (this.studioGuests.size === 0) return;
    for (const [id, previousCell] of this.studioGuests) {
      const walker = this.walkers.get(id);
      if (!walker || id === this.options.selectedId) continue;
      const pos = cellCenter(previousCell);
      walker.cell = previousCell;
      walker.root.setPosition(pos.x, pos.y);
      walker.from = pos;
      walker.to = pos;
      walker.path = [];
      walker.progress = 1;
      walker.restUntil = 0;
    }
    this.studioGuests.clear();
  }

  /**
   * Walks the citizen of the current mission step to its stop and brings the
   * camera along. Works in both city modes, since the player asked for it.
   */
  walkToTarget(): void {
    const target = this.options.target;
    const walker = target ? this.walkers.get(target.citizenId) : undefined;
    if (!target || !walker || !walker.data.owned) return;
    this.studioSession = false;
    this.releaseStudioGuests();
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
    if (!this.isPlayerControlled(walker) && !this.isInStudioSession(walker)) {
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
    walker.studioGoals = [];
    walker.progress = 1;
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

    if (this.studioOpen > 0.5 && isStudioInterior(walker.cell)) {
      if (y0 + dy >= 1538 && Math.abs(x0 + dx - 540) <= 48 && sy > 0) {
        this.exitStudio();
        return;
      }
      let movedStudio = false;
      let nx = x0;
      let ny = y0;
      for (const [tx, ty] of tries) {
        if (tx === 0 && ty === 0) continue;
        if (this.canStandInStudio(x0 + tx, y0 + ty)) {
          movedStudio = true;
          nx = x0 + tx;
          ny = y0 + ty;
          break;
        }
      }
      if (!movedStudio) return;
      walker.root.setPosition(nx, ny);
      walker.cell = STUDIO_STAGE_CELL;
      walker.from = { x: nx, y: ny };
      walker.to = { x: nx, y: ny };
      walker.travelled += Math.hypot(nx - x0, ny - y0);
      walker.keyMoving = true;
      walker.face = { x: sx, y: sy };
      return;
    }

    const scores = walker.data.scores;
    const open = (x: number, y: number) => {
      const cell = cellAt(x, y);
      if (!cell || !isWalkable(cell, scores)) return undefined;
      const zone = zoneOf(cell);
      if (zone && zone !== 'road' && !canEnter(zone, scores)) return undefined;
      return cell;
    };
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
    for (const walker of this.walkers.values()) {
      walker.member.anchored = this.isPlayerControlled(walker) || this.isInStudioSession(walker);
    }
    separate(this.crowd);
    this.ambience?.refreshDepths();
    const selected = this.walkers.get(this.options.selectedId);
    this.updateStudio(time, elapsed, selected);
    for (const walker of this.walkers.values()) {
      // Tags live outside the citizen's container so they always draw above the district labels.
      walker.tag.setPosition(walker.root.x, walker.root.y - walker.size - 6);
      walker.root.setDepth(this.depthOf(walker));
      if (this.studioOpen > 0.5 && !isStudioInterior(walker.cell)) {
        walker.tag.setVisible(false);
      }
    }
    this.fadeCoveredLabels();
    this.checkArrival();
    this.dots.clear().setDepth(this.studioOpen > 0.3 ? INDOOR_CITIZEN_DEPTH - 5 : 1);
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
    if (this.indoorCameraActive) {
      const camera = this.cameras.main;
      camera.centerOn(STUDIO_CAMERA_X, STUDIO_CAMERA_Y);
    } else if (this.following && selected && !this.drag?.moved) {
      const camera = this.cameras.main;
      const tx = selected.root.x;
      const ty = selected.root.y - 30;
      const cx = camera.midPoint.x;
      const cy = camera.midPoint.y;
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
    body.on('pointerover', () => {
      if (this.studioOpen > 0.5 && !isStudioInterior(this.walkers.get(citizen.id)?.cell ?? cell)) return;
      tag.setVisible(true);
    });
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
      studioGoals: [],
    });
  }

  private routineOf(citizen: CityCitizen): DistrictId[] {
    return (ROUTINE[citizen.roleKey] ?? ['plaza']).filter((district) => canEnter(district, citizen.scores));
  }

  private isPlayerControlled(walker: Walker): boolean {
    return this.options.mode === 'control' && walker.data.owned && walker.data.id === this.options.selectedId;
  }

  private isInStudioSession(walker: Walker): boolean {
    if (this.studioGuests.has(walker.data.id) && isStudioInterior(walker.cell)) return true;
    return (
      walker.data.id === this.options.selectedId &&
      (this.studioSession || isStudioInterior(walker.cell))
    );
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

    if (walker.studioGoals.length > 0) {
      this.stepStudioGoals(walker, delta);
      return;
    }

    if (walker.path.length === 0) {
      body.y = walker.keyMoving
        ? -Math.abs(Math.sin(walker.travelled / 11)) * 7
        : Math.sin(time / 380 + walker.data.id) * 1.2;
      if (
        !walker.keyMoving &&
        !this.isPlayerControlled(walker) &&
        !this.isInStudioSession(walker) &&
        time >= walker.restUntil
      ) {
        this.chooseNextStop(walker, time);
      }
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
   * Depth of a citizen against the props around it. When inside the BAS Studio
   * indoor room, citizens standing on the studio floor draw above the indoor floor.
   */
  private depthOf(walker: Walker): number {
    if (this.studioOpen > 0.3 && isStudioInterior(walker.cell)) {
      walker.hidden = false;
      return INDOOR_CITIZEN_DEPTH + walker.root.y / MAP_HEIGHT;
    }
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

  /**
   * BAS Studio: an enterable building on the city map with active automatic
   * sliding glass doors outside and a full-scale RPG indoor concert & screening
   * auditorium inside (`INDOOR_ROOM_DEPTH = 5200`).
   */
  private setupStudio(): void {
    const [gx, gy, w, d] = STUDIO.cells;
    const building = this.props.find(({ prop }) => {
      const [px, py, pw, pd] = prop.cells;
      return px === gx && py === gy && pw === w && pd === d;
    });
    this.studioBuilding = building?.image;
    this.studioDoorwayBg = this.add.graphics().setDepth(340.15);
    this.studioDoorLeaves = this.add.graphics().setDepth(340.5);
    this.studioInterior = this.add.graphics().setDepth(INDOOR_ROOM_DEPTH).setVisible(false);
    this.studioIndoorFront = this.add.graphics().setDepth(INDOOR_FRONT_DEPTH).setVisible(false);
    this.drawStudioDoors(false);

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
    this.studioSign = sign;
    this.tweens.add({ targets: sign, y: STUDIO.label[1] - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const targets = building ? [building.image] : [];
    const onTap = (pointer: Phaser.Input.Pointer) => {
      if (this.drag?.moved) return;
      if (this.studioOpen > 0.5) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (world.x >= 488 && world.x <= 592 && world.y >= 1510 && world.y <= 1590) {
          this.exitStudio();
          return;
        }
        const bounds = this.studioViewportBounds();
        if (world.x >= bounds.xWallL && world.x <= bounds.xWallR && world.y >= 1298 && world.y <= bounds.yFloorB) {
          const walker = this.walkers.get(this.options.selectedId);
          if (walker) this.walkInStudioTo(walker, world.x, world.y);
          return;
        }
        return;
      }
      this.enterStudio();
    };
    for (const target of [sign, ...(building ? [building.image] : [])]) {
      target.setInteractive({ useHandCursor: true, pixelPerfect: target !== sign });
      target.on('pointerup', onTap);
      target.on('pointerover', () => {
        if (this.studioOpen < 0.2) targets.forEach((image) => image.setTint(0xfff0d8));
      });
      target.on('pointerout', () => targets.forEach((image) => image.clearTint()));
    }
  }

  /**
   * FOMO Office: interactive trading & frontier office on the south-east shore
   * with a floating marquee billboard sign, custom lighting, and walk-up interaction.
   */
  private setupFomo(): void {
    const [gx, gy, w, d] = FOMO.cells;
    const building = this.props.find(({ prop }) => {
      const [px, py, pw, pd] = prop.cells;
      return px === gx && py === gy && pw === w && pd === d;
    });
    this.fomoBuilding = building?.image;

    const fomoName = (this.options.fomo?.name ?? 'FOMO OFFICE').toUpperCase();
    const fomoHint = this.options.fomo?.hint ?? 'TAP TO VISIT';
    const sign = this.add
      .text(FOMO.label[0], FOMO.label[1], `${fomoName}\n${fomoHint}`, {
        fontFamily: 'Silkscreen, monospace',
        fontSize: '10px',
        color: '#ff8a30',
        backgroundColor: 'rgba(24, 20, 30, 0.92)',
        padding: { x: 7, y: 4 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(LABEL_DEPTH);
    this.fomoSign = sign;
    this.tweens.add({ targets: sign, y: FOMO.label[1] - 4, duration: 920, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const targets = building ? [building.image] : [];
    const onTap = () => {
      if (this.drag?.moved) return;
      if (this.options.onFomo) this.options.onFomo();
      const walker = this.walkers.get(this.options.selectedId);
      if (walker && (this.isPlayerControlled(walker) || walker.data.owned)) {
        this.routeTo(walker, FOMO.door);
        this.focusSelected();
      }
    };
    for (const target of [sign, ...(building ? [building.image] : [])]) {
      target.setInteractive({ useHandCursor: true, pixelPerfect: target !== sign });
      target.on('pointerup', onTap);
      target.on('pointerover', () => {
        if (this.studioOpen < 0.2) targets.forEach((image) => image.setTint(0xfff0d8));
      });
      target.on('pointerout', () => targets.forEach((image) => image.clearTint()));
    }
  }

  /** Animates the studio's automatic sliding doors, full-screen indoor auditorium transition, and stage screen bounds. */
  private updateStudio(time: number, elapsed: number, selected: Walker | undefined): void {
    const insideNow = selected !== undefined && isStudioInterior(selected.cell);
    if (insideNow && !this.studioSession) {
      const destination = selected.path[selected.path.length - 1];
      if (!destination || isStudioInterior(destination)) {
        this.studioSession = true;
        this.populateStudioGuests();
      }
    } else if (!insideNow && this.studioSession && selected && selected.path.length === 0) {
      this.studioSession = false;
      this.releaseStudioGuests();
    }

    const wantOpen = insideNow ? 1 : 0;
    const openSpeed = wantOpen > this.studioOpen ? elapsed / 220 : elapsed / 240;
    if (Math.abs(wantOpen - this.studioOpen) <= openSpeed) this.studioOpen = wantOpen;
    else this.studioOpen += Math.sign(wantOpen - this.studioOpen) * openSpeed;

    const camera = this.cameras.main;
    if (insideNow && !this.indoorCameraActive) {
      this.indoorCameraActive = true;
      this.outdoorZoom = camera.zoom;
      camera.removeBounds();
      camera.setZoom(this.indoorZoom());
      camera.centerOn(STUDIO_CAMERA_X, STUDIO_CAMERA_Y);
    } else if (!insideNow && this.studioOpen <= 0.01 && this.indoorCameraActive) {
      this.indoorCameraActive = false;
      camera.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
      camera.setZoom(Phaser.Math.Clamp(this.outdoorZoom, this.minZoom(), ZOOM_MAX));
      if (selected) camera.centerOn(selected.root.x, selected.root.y - 30);
    }

    let sensorTriggered = false;
    for (const walker of this.walkers.values()) {
      const wx = walker.root.x;
      const wy = walker.root.y;
      if (Math.abs(wx - 540) <= 42 && wy >= 1485 && wy <= 1592) {
        sensorTriggered = true;
        break;
      }
      const nextStep = walker.path[1] ?? walker.path[0];
      if (
        nextStep &&
        nextStep[0] === STUDIO_DOORWAY_CELL[0] &&
        (nextStep[1] === STUDIO_DOORWAY_CELL[1] || nextStep[1] === STUDIO.door[1]) &&
        Math.hypot(wx - 540, wy - 1530) <= 75
      ) {
        sensorTriggered = true;
        break;
      }
      if (walker.keyMoving && walker.face.y > 0 && Math.abs(wx - 540) <= 46 && wy >= 1450 && wy <= 1560) {
        sensorTriggered = true;
        break;
      }
    }
    if (!sensorTriggered) {
      for (const member of this.crowd) {
        if (Math.abs(member.root.x - 540) <= 36 && member.root.y >= 1520 && member.root.y <= 1588) {
          sensorTriggered = true;
          break;
        }
      }
    }
    if (sensorTriggered) this.studioDoorHoldUntil = time + 420;
    const wantDoor = sensorTriggered || time < this.studioDoorHoldUntil ? 1 : 0;
    const doorSpeed = wantDoor > this.studioDoorOpen ? elapsed / 170 : elapsed / 240;
    if (Math.abs(wantDoor - this.studioDoorOpen) <= doorSpeed) this.studioDoorOpen = wantDoor;
    else this.studioDoorOpen += Math.sign(wantDoor - this.studioDoorOpen) * doorSpeed;

    this.ambience?.setStudioOpen(this.studioOpen > 0.25);
    if (this.studioBuilding && this.studioOpen > 0.1) {
      this.studioBuilding.clearTint();
    }
    if (this.studioSign) {
      this.studioSign.setAlpha(1 - this.studioOpen).setVisible(this.studioOpen < 0.95);
    }
    if (this.fomoSign) {
      this.fomoSign.setAlpha(1 - this.studioOpen).setVisible(this.studioOpen < 0.95);
    }

    const doorActive = sensorTriggered || this.studioDoorOpen > 0.05;
    if (this.studioOpen > 0.01) {
      this.studioInterior.setVisible(true).setAlpha(this.studioOpen);
      this.studioIndoorFront.setVisible(true).setAlpha(this.studioOpen);
      this.drawStudioInterior(time);
      this.drawStudioIndoorExit(doorActive);
    } else {
      this.studioInterior.setVisible(false);
      this.studioIndoorFront.setVisible(false);
    }
    this.drawStudioDoors(doorActive);

    if (this.options.onStudioView) {
      // Recessed 16:9 wall-mounted cinema screen at world (412, 1082, 256, 144)
      const left = Math.round(((412 - camera.midPoint.x) * camera.zoom + camera.width / 2) * 2) / 2;
      const top = Math.round(((1060 - camera.midPoint.y) * camera.zoom + camera.height / 2) * 2) / 2;
      const width = Math.round(256 * camera.zoom * 2) / 2;
      const height = Math.round(144 * camera.zoom * 2) / 2;
      const openRounded = Math.round(this.studioOpen * 100) / 100;
      const inside = this.studioSession || insideNow;
      const sig = `${inside}:${openRounded}:${left}:${top}:${width}:${height}`;
      if (sig !== this.lastStudioSignature) {
        this.lastStudioSignature = sig;
        this.options.onStudioView({
          inside,
          open: openRounded,
          screen: { left, top, width, height },
        });
      }
    }
  }

  /** Computes the dynamic world-space perimeter of the indoor studio hall with deep 3D perspective convergence. */
  private studioViewportBounds(): {
    xOuterL: number;
    xOuterR: number;
    yOuterT: number;
    yOuterB: number;
    xWallL: number;
    xWallR: number;
    yWallT: number;
    yFloorB: number;
    xBackL: number;
    xBackR: number;
    yBackT: number;
    yBackB: number;
  } {
    const cam = this.cameras.main;
    const halfW = Math.max(320, Math.ceil(cam.width / cam.zoom / 2));
    const halfH = Math.max(265, Math.ceil(cam.height / cam.zoom / 2));
    const xOuterL = STUDIO_CAMERA_X - halfW;
    const xOuterR = STUDIO_CAMERA_X + halfW;
    const yOuterT = STUDIO_CAMERA_Y - halfH;
    const yOuterB = STUDIO_CAMERA_Y + halfH;
    const xWallL = xOuterL + 14;
    const xWallR = xOuterR - 14;
    const yWallT = Math.max(yOuterT + 14, 1000);
    const yFloorB = 1546;
    const sideDepth = Math.min(138, Math.max(82, Math.round((xWallR - xWallL) * 0.135)));
    const xBackL = xWallL + sideDepth;
    const xBackR = xWallR - sideDepth;
    const yBackT = yWallT + 38;
    const yBackB = 1296;
    return {
      xOuterL,
      xOuterR,
      yOuterT,
      yOuterB,
      xWallL,
      xWallR,
      yWallT,
      yFloorB,
      xBackL,
      xBackR,
      yBackT,
      yBackB,
    };
  }

  /**
   * Draws the deep, expansive 3D indoor concert & cinema hall for BAS Studio:
   * - 3D receding coffered acoustic ceiling (`yWallT..yBackT`) & deep 3D perspective side walls (`xWallL..xBackL`)
   * - Back stage wall (`yBackT..1296`) with continuous lower mahogany wainscoting (`y=1270..1296`) visible BELOW the screen
   * - 3D recessed masonry wall alcove (`x=398..682, y=1072..1269`) housing the 16:9 cinema screen & attached player bar flush in the back wall
   * - Deep 3D raised mahogany stage (`y=1296..1334`) with 3D speaker towers standing on the stage deck
   * - Vast, wide-open auditorium floor (`y=1296..1546`) with 14 perspective tile rows and sleek perimeter lounge/mixing booths tucked along the outer walls
   */
  private drawStudioInterior(time: number): void {
    const g = this.studioInterior;
    g.clear();

    const {
      xOuterL,
      xOuterR,
      yOuterT,
      yOuterB,
      xWallL,
      xWallR,
      yWallT,
      yFloorB,
      xBackL,
      xBackR,
      yBackT,
      yBackB,
    } = this.studioViewportBounds();

    // 1. Full-map indoor blackout void so 0% of the outdoor map is ever visible
    g.fillStyle(0x06040b, 1).fillRect(-2000, -2000, MAP_WIDTH + 4000, MAP_HEIGHT + 4000);

    // 2. Full-Viewport 3D Cutaway Masonry Structural Wall Perimeter (North, West, East)
    g.fillStyle(0x120d1e, 1).fillRect(xOuterL, yOuterT, xOuterR - xOuterL, yOuterB - yOuterT);
    g.fillStyle(0x3f3359, 1).fillRect(xOuterL + 2, yOuterT + 2, xOuterR - xOuterL - 4, yOuterB - yOuterT - 4);
    g.fillStyle(0x58487a, 1)
      .fillRect(xOuterL + 4, yOuterT + 4, xOuterR - xOuterL - 8, 4)
      .fillRect(xOuterL + 4, yOuterT + 4, 4, yOuterB - yOuterT - 8)
      .fillRect(xOuterR - 8, yOuterT + 4, 4, yOuterB - yOuterT - 8);
    g.fillStyle(0x271f3b, 1);
    for (let bx = xOuterL + 18; bx < xOuterR - 12; bx += 22) {
      g.fillRect(bx, yOuterT + 2, 2, yWallT - yOuterT - 2);
    }
    for (let by = yOuterT + 18; by < yOuterB - 14; by += 22) {
      g.fillRect(xOuterL + 2, by, 12, 2);
      g.fillRect(xOuterR - 14, by, 12, 2);
    }

    // Inner room cavity border
    g.fillStyle(0x0b0814, 1).fillRect(xWallL - 2, yWallT - 2, xWallR - xWallL + 4, yFloorB - yWallT + 4);

    // 3. 3D Receding Coffered Acoustic Ceiling (Trapezoid yWallT..yBackT)
    g.fillStyle(0x110c1f, 1).fillPoints(
      [
        new Phaser.Geom.Point(xWallL, yWallT),
        new Phaser.Geom.Point(xWallR, yWallT),
        new Phaser.Geom.Point(xBackR, yBackT),
        new Phaser.Geom.Point(xBackL, yBackT),
      ],
      true,
    );
    for (let cr = 1; cr <= 3; cr += 1) {
      const ct = cr / 4;
      const cy = Phaser.Math.Linear(yWallT, yBackT, ct);
      const cxl = Phaser.Math.Linear(xWallL, xBackL, ct);
      const cxr = Phaser.Math.Linear(xWallR, xBackR, ct);
      g.lineStyle(1.5, 0x22183a, 0.9).lineBetween(cxl, cy, cxr, cy);
    }
    const ceilBeams = 10;
    for (let cb = -ceilBeams; cb <= ceilBeams; cb += 2) {
      const t = cb / ceilBeams;
      const fx = STUDIO_CAMERA_X + t * ((xWallR - xWallL) * 0.49);
      const bx = STUDIO_CAMERA_X + t * ((xBackR - xBackL) * 0.49);
      g.lineStyle(1.5, 0x251b3d, 0.85).lineBetween(fx, yWallT, bx, yBackT);
      const lx = Phaser.Math.Linear(fx, bx, 0.52);
      const ly = Phaser.Math.Linear(yWallT, yBackT, 0.52);
      g.fillStyle(0x60e2f6, 0.14).fillCircle(lx, ly, 7);
      g.fillStyle(0xd8f8ff, 0.8).fillCircle(lx, ly, 2);
    }

    // 4. Deep Left 3D Perspective Side Wall (Trapezoid xWallL..xBackL, 3 Architectural Bays)
    g.fillStyle(0x261c40, 1).fillPoints(
      [
        new Phaser.Geom.Point(xWallL, yWallT),
        new Phaser.Geom.Point(xBackL, yBackT),
        new Phaser.Geom.Point(xBackL, yBackB),
        new Phaser.Geom.Point(xWallL, yFloorB),
      ],
      true,
    );
    // Left wall dark mahogany wainscoting receding in perspective
    g.fillStyle(0x382428, 1).fillPoints(
      [
        new Phaser.Geom.Point(xWallL, yFloorB - 42),
        new Phaser.Geom.Point(xBackL, yBackB - 24),
        new Phaser.Geom.Point(xBackL, yBackB),
        new Phaser.Geom.Point(xWallL, yFloorB),
      ],
      true,
    );
    g.lineStyle(1.5, GOLD, 0.65).lineBetween(xWallL, yFloorB - 42, xBackL, yBackB - 24);
    for (let bay = 0; bay < 3; bay += 1) {
      const t0 = (bay + 0.12) / 3;
      const t1 = (bay + 0.84) / 3;
      const px0 = Phaser.Math.Linear(xWallL, xBackL, t0);
      const px1 = Phaser.Math.Linear(xWallL, xBackL, t1);
      const top0 = Phaser.Math.Linear(yWallT + 26, yBackT + 18, t0);
      const top1 = Phaser.Math.Linear(yWallT + 26, yBackT + 18, t1);
      const bot0 = Phaser.Math.Linear(yFloorB - 56, yBackB - 34, t0);
      const bot1 = Phaser.Math.Linear(yFloorB - 56, yBackB - 34, t1);
      g.fillStyle(0x18112b, 1).fillPoints(
        [
          new Phaser.Geom.Point(px0, top0),
          new Phaser.Geom.Point(px1, top1),
          new Phaser.Geom.Point(px1, bot1),
          new Phaser.Geom.Point(px0, bot0),
        ],
        true,
      );
      g.lineStyle(1, 0x60e2f6, 0.5).strokePoints(
        [
          new Phaser.Geom.Point(px0, top0),
          new Phaser.Geom.Point(px1, top1),
          new Phaser.Geom.Point(px1, bot1),
          new Phaser.Geom.Point(px0, bot0),
        ],
        true,
      );
      const scX = (px0 + px1) * 0.5;
      const scY = (top0 + bot0 + top1 + bot1) * 0.25;
      const scScale = Phaser.Math.Linear(1, 0.72, (t0 + t1) * 0.5);
      g.fillStyle(0xffd27d, 0.18).fillCircle(scX, scY, 18 * scScale);
      g.fillStyle(0x140e22, 1).fillRect(scX - 3 * scScale, scY - 6 * scScale, 6 * scScale, 12 * scScale);
      g.fillStyle(GOLD, 1).fillRect(scX - 2 * scScale, scY - 4 * scScale, 4 * scScale, 8 * scScale);
      if (bay > 0) {
        const colT = bay / 3;
        const colX = Phaser.Math.Linear(xWallL, xBackL, colT);
        const colTop = Phaser.Math.Linear(yWallT, yBackT, colT);
        const colBot = Phaser.Math.Linear(yFloorB, yBackB, colT);
        g.fillStyle(0x150e26, 0.9).fillRect(colX - 2, colTop, 4, colBot - colTop);
      }
    }

    // 5. Deep Right 3D Perspective Side Wall (Trapezoid xBackR..xWallR, 3 Architectural Bays)
    g.fillStyle(0x211838, 1).fillPoints(
      [
        new Phaser.Geom.Point(xBackR, yBackT),
        new Phaser.Geom.Point(xWallR, yWallT),
        new Phaser.Geom.Point(xWallR, yFloorB),
        new Phaser.Geom.Point(xBackR, yBackB),
      ],
      true,
    );
    // Right wall dark mahogany wainscoting receding in perspective
    g.fillStyle(0x2e1e23, 1).fillPoints(
      [
        new Phaser.Geom.Point(xBackR, yBackB - 24),
        new Phaser.Geom.Point(xWallR, yFloorB - 42),
        new Phaser.Geom.Point(xWallR, yFloorB),
        new Phaser.Geom.Point(xBackR, yBackB),
      ],
      true,
    );
    g.lineStyle(1.5, GOLD, 0.65).lineBetween(xBackR, yBackB - 24, xWallR, yFloorB - 42);
    for (let bay = 0; bay < 3; bay += 1) {
      const t0 = (bay + 0.12) / 3;
      const t1 = (bay + 0.84) / 3;
      const px0 = Phaser.Math.Linear(xWallR, xBackR, t0);
      const px1 = Phaser.Math.Linear(xWallR, xBackR, t1);
      const top0 = Phaser.Math.Linear(yWallT + 26, yBackT + 18, t0);
      const top1 = Phaser.Math.Linear(yWallT + 26, yBackT + 18, t1);
      const bot0 = Phaser.Math.Linear(yFloorB - 56, yBackB - 34, t0);
      const bot1 = Phaser.Math.Linear(yFloorB - 56, yBackB - 34, t1);
      g.fillStyle(0x161028, 1).fillPoints(
        [
          new Phaser.Geom.Point(px1, top1),
          new Phaser.Geom.Point(px0, top0),
          new Phaser.Geom.Point(px0, bot0),
          new Phaser.Geom.Point(px1, bot1),
        ],
        true,
      );
      g.lineStyle(1, 0xf65cce, 0.5).strokePoints(
        [
          new Phaser.Geom.Point(px1, top1),
          new Phaser.Geom.Point(px0, top0),
          new Phaser.Geom.Point(px0, bot0),
          new Phaser.Geom.Point(px1, bot1),
        ],
        true,
      );
      const scX = (px0 + px1) * 0.5;
      const scY = (top0 + bot0 + top1 + bot1) * 0.25;
      const scScale = Phaser.Math.Linear(1, 0.72, (t0 + t1) * 0.5);
      g.fillStyle(0xffd27d, 0.18).fillCircle(scX, scY, 18 * scScale);
      g.fillStyle(0x140e22, 1).fillRect(scX - 3 * scScale, scY - 6 * scScale, 6 * scScale, 12 * scScale);
      g.fillStyle(GOLD, 1).fillRect(scX - 2 * scScale, scY - 4 * scScale, 4 * scScale, 8 * scScale);
      if (bay > 0) {
        const colT = bay / 3;
        const colX = Phaser.Math.Linear(xWallR, xBackR, colT);
        const colTop = Phaser.Math.Linear(yWallT, yBackT, colT);
        const colBot = Phaser.Math.Linear(yFloorB, yBackB, colT);
        g.fillStyle(0x120c21, 0.9).fillRect(colX - 2, colTop, 4, colBot - colTop);
      }
    }

    // 6. Receding Back Stage Wall (xBackL..xBackR, yBackT..yBackB = 1296)
    g.fillStyle(0x161029, 1).fillRect(xBackL, yBackT, xBackR - xBackL, yBackB - yBackT);
    for (let rx = xBackL + 8; rx < xBackR - 6; rx += 12) {
      g.fillStyle(0x211838, 1).fillRect(rx, yBackT, 5, yBackB - yBackT - 24);
      g.fillStyle(0x0f0a1c, 1).fillRect(rx + 5, yBackT, 2, yBackB - yBackT - 24);
    }
    // Continuous back-wall dark mahogany wainscoting & gold rail running UNDERNEATH the wall-mounted screen (y=1272..1296)
    g.fillStyle(0x321f24, 1).fillRect(xBackL, yBackB - 24, xBackR - xBackL, 24);
    g.fillStyle(0x231419, 1).fillRect(xBackL, yBackB - 8, xBackR - xBackL, 8);
    g.lineStyle(1.5, GOLD, 0.75).lineBetween(xBackL, yBackB - 24, xBackR, yBackB - 24);
    for (let wx = xBackL + 20; wx < xBackR - 20; wx += 36) {
      g.lineStyle(1, 0x452b32, 0.8).strokeRect(wx, yBackB - 20, 26, 12);
    }
    // Deep corner ambient-occlusion shadow pillars where side walls meet back wall
    g.fillStyle(0x07040e, 0.78)
      .fillRect(xBackL - 4, yBackT, 9, yBackB - yBackT)
      .fillRect(xBackR - 5, yBackT, 9, yBackB - yBackT);

    // Neon architectural crown & base trim along the ceiling and floor perimeter
    g.lineStyle(2, 0xf65cce, 0.9)
      .lineBetween(xWallL, yWallT, xBackL, yBackT)
      .lineBetween(xBackL, yBackT, xBackR, yBackT)
      .lineBetween(xBackR, yBackT, xWallR, yWallT);
    g.lineStyle(1.5, 0x60e2f6, 0.8)
      .lineBetween(xWallL, yFloorB, xBackL, yBackB)
      .lineBetween(xBackR, yBackB, xWallR, yFloorB);

    // 7. Vast, Deep Perspective Auditorium Floor (trapezoid widening from yBackB=1296 to yFloorB=1546 — 250px deep!)
    g.fillStyle(0x1c1530, 1).fillPoints(
      [
        new Phaser.Geom.Point(xBackL, yBackB),
        new Phaser.Geom.Point(xBackR, yBackB),
        new Phaser.Geom.Point(xWallR, yFloorB),
        new Phaser.Geom.Point(xWallL, yFloorB),
      ],
      true,
    );
    const floorRows = 14;
    for (let r = 0; r < floorRows; r += 1) {
      // Perspective foreshortening: rows near the back wall are tighter, rows near the front are taller
      const t0 = Math.pow(r / floorRows, 1.15);
      const t1 = Math.pow((r + 1) / floorRows, 1.15);
      const y0 = Phaser.Math.Linear(yBackB, yFloorB, t0);
      const y1 = Phaser.Math.Linear(yBackB, yFloorB, t1);
      const xl0 = Phaser.Math.Linear(xBackL, xWallL, t0);
      const xr0 = Phaser.Math.Linear(xBackR, xWallR, t0);
      const xl1 = Phaser.Math.Linear(xBackL, xWallL, t1);
      const xr1 = Phaser.Math.Linear(xBackR, xWallR, t1);
      if (r % 2 === 1) {
        g.fillStyle(0x231a3b, 1).fillPoints(
          [
            new Phaser.Geom.Point(xl0, y0),
            new Phaser.Geom.Point(xr0, y0),
            new Phaser.Geom.Point(xr1, y1),
            new Phaser.Geom.Point(xl1, y1),
          ],
          true,
        );
      }
      g.lineStyle(1, 0x130d22, 0.75).lineBetween(xl1, y1, xr1, y1);
    }
    const numCols = Math.max(8, Math.floor((xBackR - xBackL) / 64));
    g.lineStyle(1, 0x130d22, 0.7);
    for (let c = -numCols; c <= numCols; c += 1) {
      const t = c / numCols;
      const bx = STUDIO_CAMERA_X + t * ((xBackR - xBackL) * 0.49);
      const fx = STUDIO_CAMERA_X + t * ((xWallR - xWallL) * 0.49);
      g.lineBetween(bx, yBackB, fx, yFloorB);
    }

    // Flush-inlaid Grand Crimson & Gold VIP Carpet Runner (widening subtly in perspective from stage stairs to exit door)
    g.fillStyle(0x521132, 1).fillPoints(
      [
        new Phaser.Geom.Point(508, 1328),
        new Phaser.Geom.Point(572, 1328),
        new Phaser.Geom.Point(580, yFloorB),
        new Phaser.Geom.Point(500, yFloorB),
      ],
      true,
    );
    g.fillStyle(0x821c50, 1).fillPoints(
      [
        new Phaser.Geom.Point(511, 1328),
        new Phaser.Geom.Point(569, 1328),
        new Phaser.Geom.Point(576, yFloorB),
        new Phaser.Geom.Point(504, yFloorB),
      ],
      true,
    );
    g.fillStyle(0xa62667, 1).fillPoints(
      [
        new Phaser.Geom.Point(516, 1328),
        new Phaser.Geom.Point(564, 1328),
        new Phaser.Geom.Point(570, yFloorB),
        new Phaser.Geom.Point(510, yFloorB),
      ],
      true,
    );
    g.lineStyle(2, GOLD, 0.9)
      .lineBetween(509, 1328, 502, yFloorB)
      .lineBetween(571, 1328, 578, yFloorB);

    // 8. Deep 3D Raised Mahogany Concert Stage (rear against back wall y=1296, front lip y=1324, fascia y=1324..1334)
    const stTopY = yBackB;
    const stEdgeY = 1324;
    const stBaseY = 1334;
    const stBackL = xBackL + 16;
    const stBackR = xBackR - 16;
    const stFrontL = xBackL - 6;
    const stFrontR = xBackR + 6;
    const stWidth = stFrontR - stFrontL;
    // Stage drop shadow onto the auditorium floor
    g.fillStyle(0x080510, 0.65).fillRect(stFrontL, stBaseY - 1, stWidth, 7);
    // 3D receding hardwood stage deck (`28 world px` deep from back wall to front lip)
    g.fillStyle(0x6e4534, 1).fillPoints(
      [
        new Phaser.Geom.Point(stBackL, stTopY),
        new Phaser.Geom.Point(stBackR, stTopY),
        new Phaser.Geom.Point(stFrontR, stEdgeY),
        new Phaser.Geom.Point(stFrontL, stEdgeY),
      ],
      true,
    );
    // Ambient screen light reflection on the center stage deck
    g.fillStyle(0x60e2f6, 0.1).fillRect(412, stTopY + 3, 256, 20);
    g.lineStyle(1, 0x4f3023, 0.85);
    for (let py = stTopY + 5; py < stEdgeY; py += 5) {
      const t = (py - stTopY) / (stEdgeY - stTopY);
      const lx = Phaser.Math.Linear(stBackL, stFrontL, t);
      const rx = Phaser.Math.Linear(stBackR, stFrontR, t);
      g.lineBetween(lx, py, rx, py);
    }
    // Stage front fascia & recessed warm gold footlights
    g.fillStyle(0x3a2117, 1).fillRect(stFrontL, stEdgeY, stWidth, stBaseY - stEdgeY);
    g.fillStyle(0x60e2f6, 0.9).fillRect(stFrontL, stEdgeY, stWidth, 2);
    g.lineStyle(1, 0x1c0f0a, 1).strokeRect(stFrontL, stEdgeY, stWidth, stBaseY - stEdgeY);
    for (let fx = stFrontL + 28; fx <= stFrontR - 28; fx += 48) {
      if (fx >= 496 && fx <= 584) continue;
      g.fillStyle(0xffd27d, 0.22).fillCircle(fx, stEdgeY + 2, 9);
      g.fillStyle(GOLD, 1).fillRect(fx - 4, stEdgeY + 3, 8, 3);
    }

    // 9. Grand 4-Step Center Stage Staircase (x=504..576, y=1322..1338)
    for (let s = 0; s < 4; s += 1) {
      const sy = 1322 + s * 4;
      const sw = 66 + s * 4;
      const sx = 540 - sw / 2;
      g.fillStyle(0x875843, 1).fillRect(sx, sy, sw, 3);
      g.fillStyle(0x4a2c1f, 1).fillRect(sx, sy + 3, sw, 1);
      g.fillStyle(GOLD, 0.85).fillRect(sx, sy, 2, 4).fillRect(sx + sw - 2, sy, 2, 4);
    }

    // 10. 3D Recessed Masonry Wall Alcove (Niche) Mounting the Screen + Player Bar Flush Into the Back Wall
    // Downward shadow cast by the recessed screen alcove onto the back wall & wainscoting underneath (y=1247..1261)
    g.fillStyle(0x05030a, 0.72).fillRect(398, 1247, 284, 14);
    // Steel wall-mounting brackets bolting the alcove housing to the back wall masonry
    g.fillStyle(0x2d2442, 1);
    for (const by of [1080, 1148, 1216]) {
      g.fillRect(388, by, 10, 8).fillRect(682, by, 10, 8);
      g.fillStyle(GOLD, 0.85).fillRect(390, by + 2, 3, 4).fillRect(687, by + 2, 3, 4);
      g.fillStyle(0x2d2442, 1);
    }
    // Outer stone & steel wall frame flush on the back wall (x=398..682, y=1050..1247)
    g.fillStyle(0x271e3d, 1).fillRect(398, 1050, 284, 197);
    g.lineStyle(2, 0x58487a, 1).strokeRect(398, 1050, 284, 197);
    // 8px-deep 3D angled inner wall bevels proving the screen sits recessed inside the back wall
    // Top inner shadow bevel
    g.fillStyle(0x070510, 1).fillPoints(
      [
        new Phaser.Geom.Point(400, 1052),
        new Phaser.Geom.Point(680, 1052),
        new Phaser.Geom.Point(670, 1059),
        new Phaser.Geom.Point(410, 1059),
      ],
      true,
    );
    // Left inner angled wall reveal
    g.fillStyle(0x120c22, 1).fillPoints(
      [
        new Phaser.Geom.Point(400, 1052),
        new Phaser.Geom.Point(410, 1059),
        new Phaser.Geom.Point(410, 1239),
        new Phaser.Geom.Point(400, 1246),
      ],
      true,
    );
    // Right inner angled wall reveal
    g.fillStyle(0x1a1230, 1).fillPoints(
      [
        new Phaser.Geom.Point(670, 1059),
        new Phaser.Geom.Point(680, 1052),
        new Phaser.Geom.Point(680, 1246),
        new Phaser.Geom.Point(670, 1239),
      ],
      true,
    );
    // Bottom inner illuminated wall shelf ledge (y=1239..1246, clearly visible below the player bar!)
    g.fillStyle(0x413264, 1).fillPoints(
      [
        new Phaser.Geom.Point(410, 1239),
        new Phaser.Geom.Point(670, 1239),
        new Phaser.Geom.Point(680, 1246),
        new Phaser.Geom.Point(400, 1246),
      ],
      true,
    );
    g.lineStyle(1.5, GOLD, 0.95).lineBetween(400, 1246, 680, 1246);
    // Recessed inner screen & player cavity (x=410..670, y=1059..1239)
    g.fillStyle(0x06040c, 1).fillRect(410, 1059, 260, 180);
    g.lineStyle(1.5, 0xf65cce, 0.95).strokeRect(411, 1059, 258, 180);

    // 11. Dual 3D Concert Speaker Stacks Standing on the 3D Stage Deck (x=330..374 and x=706..750, y=1112..1312)
    const pulse = (Math.sin(time / 110) + 1) * 0.5;
    // Speaker floor shadows on the mahogany stage deck
    g.fillStyle(0x080510, 0.55)
      .fillRect(326, 1308, 56, 8)
      .fillRect(698, 1308, 56, 8);
    // 3D inner perspective side faces of the speaker towers
    g.fillStyle(0x1b152b, 1).fillPoints(
      [
        new Phaser.Geom.Point(374, 1112),
        new Phaser.Geom.Point(382, 1106),
        new Phaser.Geom.Point(382, 1304),
        new Phaser.Geom.Point(374, 1312),
      ],
      true,
    );
    g.fillStyle(0x1b152b, 1).fillPoints(
      [
        new Phaser.Geom.Point(698, 1106),
        new Phaser.Geom.Point(706, 1112),
        new Phaser.Geom.Point(706, 1312),
        new Phaser.Geom.Point(698, 1304),
      ],
      true,
    );
    for (const sx of [330, 706]) {
      g.fillStyle(0x0d0a16, 1).fillRect(sx, 1112, 44, 200);
      g.lineStyle(2, 0x60e2f6, 0.9).strokeRect(sx, 1112, 44, 200);
      g.fillStyle(0x261e3a, 1).fillRect(sx + 8, 1122, 28, 12);
      g.fillStyle(0xf65cce, 0.85).fillRect(sx + 13, 1125, 18, 6);
      g.fillStyle(0x211a34, 1).fillCircle(sx + 22, 1164, 13);
      g.fillStyle(0x09070f, 1).fillCircle(sx + 22, 1164, 9);
      g.fillStyle(0x60e2f6, 0.95).fillCircle(sx + 22, 1164, 4 + pulse * 1.5);
      g.fillStyle(0x211a34, 1).fillCircle(sx + 22, 1214, 15);
      g.fillStyle(0x09070f, 1).fillCircle(sx + 22, 1214, 10);
      g.fillStyle(0xf65cce, 0.95).fillCircle(sx + 22, 1214, 5 + pulse * 2.2);
      for (let b = 0; b < 6; b += 1) {
        const barH = 6 + Math.round(((Math.sin(time / 95 + b * 1.1 + sx) + 1) * 0.5) * 24);
        const barColor = b % 2 === 0 ? 0x60e2f6 : 0xf65cce;
        g.fillStyle(barColor, 0.95).fillRect(sx + 5 + b * 5.8, 1304 - barH, 4, barH);
      }
    }

    // Outer Back-Wall Acoustic Gold Record Displays (mounted on the back wall above the wainscoting)
    if (xBackL < 290) {
      const leftWingX = Math.max(xBackL + 22, 232);
      const rightWingX = Math.min(xBackR - 86, 784);
      for (const wx of [leftWingX, rightWingX]) {
        g.fillStyle(0x07040e, 0.55).fillRect(wx + 3, 1115, 64, 146);
        g.fillStyle(0x0f0b1c, 1).fillRect(wx, 1112, 64, 146);
        g.lineStyle(1.5, GOLD, 0.8).strokeRect(wx, 1112, 64, 146);
        g.lineStyle(1, 0xf65cce, 0.55).strokeRect(wx + 4, 1116, 56, 138);
        g.fillStyle(0x1f1635, 1).fillCircle(wx + 32, 1162, 20);
        g.fillStyle(GOLD, 0.9).fillCircle(wx + 32, 1162, 14);
        g.fillStyle(0x0f0b1c, 1).fillCircle(wx + 32, 1162, 4);
        g.fillStyle(0xf65cce, 1).fillCircle(wx + 32, 1162, 2);
        for (let bar = 0; bar < 7; bar += 1) {
          const bh = 6 + Math.round(((Math.sin(time / 130 + bar * 0.9 + wx) + 1) * 0.5) * 24);
          g.fillStyle(bar % 2 === 0 ? 0x60e2f6 : GOLD, 0.85).fillRect(wx + 10 + bar * 6.5, 1244 - bh, 4, bh);
        }
      }
    }

    // Full-Width Overhead Steel Concert Rigging Truss & Stage Wing Spotlights
    g.fillStyle(0x2d2442, 1).fillRect(xBackL + 4, yBackT - 3, xBackR - xBackL - 8, 6);
    g.lineStyle(1, 0x4b3d6e, 1).lineBetween(xBackL + 4, yBackT, xBackR - 4, yBackT);
    const wingSpots = [
      xBackL + 36,
      Math.min(352, (xBackL + 380) * 0.5),
      Math.max(728, (xBackR + 700) * 0.5),
      xBackR - 36,
    ];
    for (let i = 0; i < wingSpots.length; i += 1) {
      const sx = wingSpots[i] as number;
      const sway = Math.sin(time / 620 + i * 1.4) * 10;
      const beamColor = i % 2 === 0 ? 0xf65cce : 0x60e2f6;
      g.fillStyle(beamColor, 0.08).fillTriangle(sx, yBackT + 4, sx - 26 + sway, stEdgeY, sx + 26 + sway, stEdgeY);
      g.fillStyle(0x0e0b16, 1).fillRect(sx - 4, yBackT - 1, 8, 6);
      g.fillStyle(GOLD, 1).fillRect(sx - 2, yBackT + 4, 4, 2);
    }

    // 12. Far-Left Perimeter Lounge Wing (tucked along the left perspective wall so the main floor stays wide open!)
    const leftSofaX = this.studioFurniture().leftSofaX;
    for (const [idx, by] of [
      [0, 1368],
      [1, 1446],
    ] as const) {
      const sx = leftSofaX - idx * 24;
      g.fillStyle(0x080510, 0.55).fillRect(sx - 2, by + 4, 76, 50);
      g.fillStyle(0x42184a, 1).fillRect(sx, by, 60, 10).fillRect(sx, by, 12, 46);
      g.fillStyle(0x752d82, 1).fillRect(sx + 2, by + 2, 56, 7).fillRect(sx + 2, by + 2, 9, 42);
      g.fillStyle(0x5c2266, 1).fillRect(sx + 12, by + 10, 46, 10).fillRect(sx + 12, by + 10, 10, 34);
      g.fillStyle(0x1f1630, 1).fillRect(sx + 28, by + 26, 34, 16);
      g.fillStyle(0x32244d, 1).fillRect(sx + 28, by + 22, 34, 14);
      g.lineStyle(1, 0x60e2f6, 0.85).strokeRect(sx + 28, by + 22, 34, 14);
      g.fillStyle(GOLD, 0.95).fillCircle(sx + 38, by + 29, 2.2);
      g.fillStyle(0xf65cce, 0.95).fillCircle(sx + 52, by + 29, 2.2);
    }

    // 13. Far-Right Perimeter Sound-Engineering Wing (tucked along the right perspective wall so the right floor feels huge!)
    const rightDeskX = this.studioFurniture().rightDeskX;
    g.fillStyle(0x080510, 0.55).fillRect(rightDeskX - 2, 1384, 86, 48);
    g.fillStyle(0x101824, 1).fillRect(rightDeskX, 1398, 82, 28);
    g.fillStyle(0x1e2c40, 1).fillRect(rightDeskX, 1378, 82, 24);
    g.fillStyle(0x0b111a, 1).fillRect(rightDeskX, 1372, 82, 7);
    g.lineStyle(1.5, 0x60e2f6, 0.9).strokeRect(rightDeskX, 1378, 82, 24);
    for (let f = 0; f < 10; f += 1) {
      const fx = rightDeskX + 6 + f * 7.2;
      g.fillStyle(0x33485c, 1).fillRect(fx, 1383, 3, 15);
      const knobY = 1385 + ((f * 3 + Math.floor(time / 220)) % 10);
      g.fillStyle(f % 2 === 0 ? 0x60e2f6 : 0xf65cce, 1).fillRect(fx, knobY, 3, 3);
      g.fillStyle(GOLD, 0.9).fillRect(fx, 1374, 3, 2.5);
    }
    for (const cx of [rightDeskX + 8, rightDeskX + 34, rightDeskX + 60]) {
      g.fillStyle(0x080510, 0.5).fillEllipse(cx + 7, 1448, 16, 6);
      g.fillStyle(0x5c2266, 1).fillRect(cx, 1432, 14, 11);
      g.fillStyle(0x752d82, 1).fillRect(cx + 2, 1439, 10, 6);
      g.lineStyle(1, 0x240c29, 1).strokeRect(cx, 1432, 14, 13);
    }
    // Sleek mastering rack tucked further down the right wall
    const rackX = this.studioFurniture().rackX;
    g.fillStyle(0x080510, 0.55).fillRect(rackX - 2, 1468, 72, 48);
    g.fillStyle(0x121b28, 1).fillRect(rackX, 1464, 68, 46);
    g.lineStyle(1.5, 0x60e2f6, 0.85).strokeRect(rackX, 1464, 68, 46);
    for (const ry of [1470, 1490]) {
      g.fillStyle(0x080d14, 1).fillRect(rackX + 6, ry, 56, 14);
      g.fillStyle(0x3df79c, 0.85).fillRect(rackX + 10, ry + 3, 22, 8);
      g.fillStyle(GOLD, 0.9).fillCircle(rackX + 42, ry + 7, 2.5);
      g.fillStyle(0xf65cce, 0.9).fillCircle(rackX + 54, ry + 7, 2.5);
    }
  }

  /**
   * Draws the full-width foreground south cutaway wall and active automatic sliding glass
   * exit doors inside the indoor BAS Studio room (`INDOOR_FRONT_DEPTH = 5250`).
   */
  private drawStudioIndoorExit(sensorActive: boolean): void {
    const g = this.studioIndoorFront;
    g.clear();

    const { xOuterL, xOuterR, yOuterB, xWallL, xWallR } = this.studioViewportBounds();
    const wallH = Math.max(30, yOuterB - 1540);
    const leftW = 496 - xOuterL;
    const rightW = xOuterR - 584;

    // Thick 3D south cutaway masonry walls spanning the full width on left (xOuterL..496) and right (584..xOuterR)
    g.fillStyle(0x080510, 0.6)
      .fillRect(xWallL, 1536, 496 - xWallL, 5)
      .fillRect(584, 1536, xWallR - 584, 5);
    g.fillStyle(0x120d1e, 1)
      .fillRect(xOuterL, 1540, leftW + 2, wallH)
      .fillRect(582, 1540, rightW + 2, wallH);
    g.fillStyle(0x2a2040, 1)
      .fillRect(xOuterL + 2, 1552, leftW - 2, Math.max(16, wallH - 14))
      .fillRect(584, 1552, rightW - 2, Math.max(16, wallH - 14));
    g.fillStyle(0x3f3359, 1)
      .fillRect(xOuterL + 2, 1542, leftW - 2, 10)
      .fillRect(584, 1542, rightW - 2, 10);
    g.fillStyle(0x58487a, 1)
      .fillRect(xOuterL + 4, 1543, leftW - 6, 3)
      .fillRect(586, 1543, rightW - 6, 3);
    g.fillStyle(0x271f3b, 1);
    for (let bx = xOuterL + 18; bx < 490; bx += 22) g.fillRect(bx, 1542, 2, 10);
    for (let bx = 596; bx < xOuterR - 10; bx += 22) g.fillRect(bx, 1542, 2, 10);
    g.fillStyle(0x60e2f6, 0.85)
      .fillRect(xWallL, 1540, 496 - xWallL, 2)
      .fillRect(584, 1540, xWallR - 584, 2);

    // Center Indoor Exit Portal Frame & Active Automatic Sliding Glass Doors (x=496..584, y=1520..1562)
    g.fillStyle(0x968ea0, 1).fillRect(494, 1558, 92, 5);
    g.fillStyle(0x1e1828, 1)
      .fillRect(496, 1522, 6, 40)
      .fillRect(578, 1522, 6, 40)
      .fillRect(496, 1518, 88, 8);
    g.lineStyle(1.5, GOLD, 0.85).strokeRect(496, 1518, 88, 8);

    const slide = Math.round(this.studioDoorOpen * 27);
    const leafW = 38;
    const leafH = 30;
    const y0 = 1528;
    const leftX = 502 - slide;
    const rightX = 540 + slide;

    for (const [lx, isLeft] of [
      [leftX, true],
      [rightX, false],
    ] as const) {
      g.fillStyle(0x9fe8f5, 0.76).fillRect(lx, y0, leafW, leafH);
      g.fillStyle(0xd8f8ff, 0.42).fillRect(lx + 1, y0 + 1, leafW - 2, 10);
      g.lineStyle(1, 0xffffff, 0.65).lineBetween(lx + 8, y0 + leafH - 4, lx + 18, y0 + 4);
      g.lineStyle(1.5, 0x1e1828, 1).strokeRect(lx, y0, leafW, leafH);
      const hx = isLeft ? lx + leafW - 5 : lx + 3;
      g.fillStyle(GOLD, 1).fillRect(hx, y0 + 11, 2, 9);
    }

    // Overhead automatic exit motion sensor LED
    g.fillStyle(0x14101d, 1).fillRect(522, 1520, 36, 4);
    g.fillStyle(sensorActive ? 0x3df79c : 0x60e2f6, 1).fillRect(535, 1521, 10, 2.5);
  }

  /**
   * Draws the exterior doorway recess and active automatic sliding glass doors
   * on the outdoor BAS Studio building facade (`x = 500..580, y = 1522..1556`).
   */
  private drawStudioDoors(sensorActive: boolean): void {
    const bg = this.studioDoorwayBg;
    bg.clear();
    bg.fillStyle(0x1e1828, 1).fillRect(499, 1522, 82, 34);
    bg.fillStyle(0x1d1530, 1).fillRect(502, 1524, 76, 30);
    bg.fillStyle(0x821c50, 1).fillRect(516, 1524, 48, 30);
    bg.fillStyle(0xa62667, 1).fillRect(520, 1524, 40, 30);
    bg.fillStyle(GOLD, 0.85).fillRect(515, 1524, 2, 30).fillRect(563, 1524, 2, 30);
    bg.fillStyle(0xf65cce, 0.7).fillRect(502, 1524, 76, 2);

    const g = this.studioDoorLeaves;
    g.clear();
    g.fillStyle(0x968ea0, 1).fillRect(494, 1554, 92, 4);
    g.fillStyle(0x1e1828, 1)
      .fillRect(497, 1518, 5, 38)
      .fillRect(578, 1518, 5, 38)
      .fillRect(497, 1516, 86, 6);
    g.lineStyle(1, GOLD, 0.75).strokeRect(497, 1516, 86, 6);

    const slide = Math.round(this.studioDoorOpen * 27);
    const leafW = 38;
    const leafH = 30;
    const y0 = 1524;
    const leftX = 502 - slide;
    const rightX = 540 + slide;

    for (const [lx, isLeft] of [
      [leftX, true],
      [rightX, false],
    ] as const) {
      g.fillStyle(0x9fe8f5, 0.78).fillRect(lx, y0, leafW, leafH);
      g.fillStyle(0xd8f8ff, 0.45).fillRect(lx + 1, y0 + 1, leafW - 2, 10);
      g.lineStyle(1, 0xffffff, 0.65).lineBetween(lx + 8, y0 + leafH - 4, lx + 18, y0 + 4);
      g.lineStyle(1.5, 0x1e1828, 1).strokeRect(lx, y0, leafW, leafH);
      const hx = isLeft ? lx + leafW - 5 : lx + 3;
      g.fillStyle(GOLD, 1).fillRect(hx, y0 + 11, 2, 9);
    }

    g.fillStyle(0x14101d, 1).fillRect(522, 1517, 36, 4);
    g.fillStyle(sensorActive ? 0x3df79c : 0x60e2f6, 1).fillRect(536, 1518, 8, 2.5);

    for (const px of [488, 592]) {
      g.fillStyle(0x96603e, 1).fillRect(px - 6, 1548, 12, 12);
      g.lineStyle(1, 0x1a2734, 1).strokeRect(px - 6, 1548, 12, 12);
      g.fillStyle(0x468c48, 1).fillCircle(px, 1537, 10);
      g.lineStyle(1, 0x1a2734, 1).strokeCircle(px, 1537, 10);
      g.fillStyle(0x68b05a, 1).fillCircle(px - 2, 1535, 5);
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
      const { width } = this.scale.gameSize;
      if (this.indoorCameraActive) {
        camera.setZoom(this.indoorZoom());
        camera.centerOn(STUDIO_CAMERA_X, STUDIO_CAMERA_Y);
        return;
      }
      const walker = this.walkers.get(this.options.selectedId);
      const min = this.minZoom();
      const wanted = first ? (width < PHONE_WIDTH ? 1.05 : 1.22) : camera.zoom;
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

  /** Zoom level at which the deep indoor BAS Studio hall fills 100% of the canvas height. */
  private indoorZoom(): number {
    const { width, height } = this.scale.gameSize;
    return Phaser.Math.Clamp(Math.min(height / 550, width / 920), 1.05, ZOOM_MAX);
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
      if (!this.drag || !pointer.isDown || this.indoorCameraActive) return;
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
    if (!walker) return;
    if (this.studioOpen > 0.5) {
      if (x >= 488 && x <= 592 && y >= 1510 && y <= 1600) {
        this.exitStudio();
        return;
      }
      const bounds = this.studioViewportBounds();
      if (x >= bounds.xWallL && x <= bounds.xWallR && y >= 1298 && y <= bounds.yFloorB) {
        this.walkInStudioTo(walker, x, y);
      }
      return;
    }
    const target = cellAt(x, y);
    if (!target) return;
    const studioClick = this.studioSession || isStudioInterior(walker.cell) || isStudioInterior(target);
    if (!studioClick) {
      if (!walker.data.owned) {
        this.options.onNotOwned();
        return;
      }
      if (this.options.mode !== 'control') return;
    }
    const zone = zoneOf(target);
    if (zone && zone !== 'road' && !canEnter(zone, walker.data.scores)) {
      this.options.onBlocked(zone);
      return;
    }
    const goal = this.nearestWalkable(target, walker.data.scores);
    if (!goal) return;
    this.studioSession = isStudioInterior(goal);
    if (this.studioSession) this.populateStudioGuests();
    this.routeTo(walker, goal);
  }

  /** Sends a walker to `goal`; a step already in progress is finished first. */
  private routeTo(walker: Walker, goal: Cell): void {
    walker.studioGoals = [];
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
