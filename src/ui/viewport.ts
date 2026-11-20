import Phaser from 'phaser';

export const WIDTH = 480;
export const HEIGHT = 800;

export function mountGame(scene: Phaser.Scene): Phaser.Game {
  // Render at device density while keeping every scene coordinate in the 480 × 800 grid.
  const density = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: WIDTH * density,
    height: HEIGHT * density,
    backgroundColor: '#f8ecd8',
    scene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 1, touch: { capture: true } },
    audio: { noAudio: true },
    disableContextMenu: true,
  });
  scene.sys.events.once(Phaser.Scenes.Events.CREATE, () => {
    scene.cameras.main.setZoom(density).centerOn(WIDTH / 2, HEIGHT / 2);
  });
  return game;
}
