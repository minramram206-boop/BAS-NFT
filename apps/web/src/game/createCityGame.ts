import * as Phaser from 'phaser';
import { CityScene, type CitySceneOptions } from './CityScene';

export interface CityGame {
  sync(options: CitySceneOptions): void;
  zoomBy(step: 1 | -1): void;
  focusSelected(): void;
  destroy(): void;
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
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    input: { mouse: { preventDefaultWheel: true } },
    scene: [scene],
  });

  const whenReady = (action: () => void) => {
    if (scene.sys.isActive()) action();
    else scene.events.once(Phaser.Scenes.Events.CREATE, action);
  };

  return {
    sync: (next) => scene.sync(next),
    zoomBy: (step) => whenReady(() => scene.zoomBy(step)),
    focusSelected: () => whenReady(() => scene.focusSelected()),
    destroy: () => game.destroy(true),
  };
}
