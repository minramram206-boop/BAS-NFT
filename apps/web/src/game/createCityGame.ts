import * as Phaser from 'phaser';
import { CityScene, type CitySceneOptions } from './CityScene';

export interface CityGame {
  sync(options: CitySceneOptions): void;
  zoomBy(step: 1 | -1): void;
  focusSelected(): void;
  walkToTarget(): void;
  enterStudio(): void;
  exitStudio(): void;
  destroy(): void;
}

/**
 * Phaser follows the size of its parent. When the parent has no size (hidden, or
 * the window minimised) it would resize the canvas to 0 x 0, and WebGL then
 * fails with "Framebuffer status: Incomplete Attachment" and stays broken. An
 * empty parent is treated as "nothing changed": the canvas keeps its last size
 * until the parent has a real one again.
 */
function ignoreEmptyParent(game: Phaser.Game, parent: HTMLElement): void {
  const scale = game.scale;
  const measure = scale.getParentBounds.bind(scale);
  scale.getParentBounds = () => {
    const box = parent.getBoundingClientRect();
    return box.width < 1 || box.height < 1 ? false : measure();
  };
}

/**
 * Starts the Phaser city inside `parent`. Imported only from the browser,
 * because Phaser touches `window` as soon as it loads.
 */
export async function createCityGame(parent: HTMLElement, options: CitySceneOptions): Promise<CityGame> {
  // Labels and name tags use the pixel font; draw them only once it is ready.
  await Promise.all([document.fonts.load('11px Silkscreen'), document.fonts.load('9px Silkscreen')]).catch(() => []);

  const scene = new CityScene(options);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#17262d',
    pixelArt: true,
    banner: false,
    scale: { mode: Phaser.Scale.RESIZE, width: Math.max(parent.clientWidth, 1), height: Math.max(parent.clientHeight, 1) },
    input: { mouse: { preventDefaultWheel: true } },
    scene: [scene],
  });
  ignoreEmptyParent(game, parent);

  const whenReady = (action: () => void) => {
    if (scene.sys.isActive()) action();
    else scene.events.once(Phaser.Scenes.Events.CREATE, action);
  };

  return {
    sync: (next) => scene.sync(next),
    zoomBy: (step) => whenReady(() => scene.zoomBy(step)),
    focusSelected: () => whenReady(() => scene.focusSelected()),
    walkToTarget: () => whenReady(() => scene.walkToTarget()),
    enterStudio: () => whenReady(() => scene.enterStudio()),
    exitStudio: () => whenReady(() => scene.exitStudio()),
    destroy: () => game.destroy(true),
  };
}
