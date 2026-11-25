import Phaser from 'phaser';

export const WIDTH = 480;
export const HEIGHT = 800;

export function mountGame(scene: Phaser.Scene): Phaser.Game {
  const density = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    transparent: true,
    scene,
    scale: {
      mode: Phaser.Scale.EXPAND,
      expandParent: false,
      width: WIDTH * density,
      height: HEIGHT * density,
    },
    input: { activePointers: 1, touch: { capture: true } },
    audio: { noAudio: true },
    disableContextMenu: true,
  });
}

export function configureCamera(scene: Phaser.Scene, onResize: () => void): void {
  const camera = scene.cameras.main;
  const resize = () => {
    const { width, height } = scene.scale.displaySize;
    const style = getComputedStyle(document.body);
    const inset = (edge: string) => parseFloat(style.getPropertyValue(`--safe-${edge}`)) || 0;
    const left = inset('left');
    const right = inset('right');
    const top = inset('top');
    const bottom = inset('bottom');
    const fit = Math.min(Math.max(1, width - left - right) / WIDTH, Math.max(1, height - top - bottom) / HEIGHT);
    const pixelsPerCssPixel = scene.scale.gameSize.width / width;
    const zoom = fit * pixelsPerCssPixel;

    // Project the fixed portrait composition into the safe region of the full Canvas.
    camera.setZoom(zoom).centerOn(
      WIDTH / 2 - (left - right) / (2 * fit),
      HEIGHT / 2 - (top - bottom) / (2 * fit),
    );
    onResize();
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, resize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, resize));
  resize();
}
