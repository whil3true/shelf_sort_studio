import Phaser from 'phaser';

export const ink = '#452f26';
export const mutedInk = '#715747';
const serif = '"Studio Serif", Georgia, serif';
const sans = '"Studio Sans", Arial, sans-serif';

export type Icon = 'back' | 'settings' | 'help' | 'undo' | 'restart' | 'hint' | 'lock' | 'check' | 'arrow';
export interface ButtonOptions {
  kind?: 'green' | 'paper' | 'red' | 'muted';
  live?: boolean;
  icon?: Icon;
  size?: number;
  quiet?: boolean;
}

export class StudioView {
  private readonly scene: Phaser.Scene;
  private layer: Phaser.GameObjects.Container;
  private readonly onClick: () => void;

  constructor(scene: Phaser.Scene, onClick: () => void) {
    this.scene = scene;
    this.onClick = onClick;
    this.layer = scene.add.container();
  }

  clear() {
    this.layer.destroy();
    this.layer = this.scene.add.container();
  }

  image(key: string, x: number, y: number, w: number, h: number) {
    const image = this.scene.add.image(x, y, key).setDisplaySize(w, h);
    this.layer.add(image);
    return image;
  }

  label(text: string, x: number, y: number, size = 23, options: {
    color?: string; bold?: boolean; serif?: boolean; align?: 'left' | 'center'; wrap?: number;
  } = {}) {
    const label = this.scene.add.text(x, y, text, {
      fontFamily: options.serif ? serif : sans, fontSize: size,
      resolution: Math.min(2, Math.max(1, this.scene.scale.gameSize.width / 480)),
      fontStyle: options.bold || options.serif ? 'bold' : undefined, color: options.color ?? ink,
      align: options.align ?? 'center', wordWrap: { width: options.wrap ?? 436 },
      lineSpacing: 5, padding: { x: 2, y: 3 },
    }).setOrigin(options.align === 'left' ? 0 : 0.5, 0.5);
    this.layer.add(label);
    return label;
  }

  box(x: number, y: number, w: number, h: number, fill: number, alpha = 1, radius = 12, border?: number) {
    const g = this.scene.add.graphics({ x, y });
    g.fillStyle(fill, alpha).fillRoundedRect(-w / 2, -h / 2, w, h, radius);
    if (border !== undefined) g.lineStyle(2, border, 0.65).strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
    this.layer.add(g);
    return g;
  }

  icon(name: Icon, x: number, y: number, color = 0x553c31, scale = 1) {
    const g = this.scene.add.graphics({ x, y }).setScale(scale);
    this.layer.add(g);
    g.lineStyle(2, color, 1).fillStyle(color, 1);
    const lines = (...points: number[]) => {
      g.beginPath().moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
      g.strokePath();
    };
    if (name === 'back') lines(4, -7, -3, 0, 4, 7);
    if (name === 'arrow') lines(-4, -7, 3, 0, -4, 7);
    if (name === 'check') lines(-7, 0, -2, 5, 7, -6);
    if (name === 'lock') {
      g.strokeRoundedRect(-6, -1, 12, 9, 2).strokeRoundedRect(-4, -8, 8, 8, 3).fillCircle(0, 3, 1.3);
    }
    if (name === 'settings') {
      for (const [y, dot] of [[-6, -3], [0, 3], [6, -1]]) {
        lines(-8, y, 8, y);
        g.fillCircle(dot, y, 2.6);
      }
    }
    if (name === 'help') {
      g.strokeCircle(0, 0, 9);
      lines(-3, -3, -2, -5, 2, -5, 3, -2, 0, 1);
      g.fillCircle(0, 5, 1.2);
    }
    if (name === 'restart') {
      g.beginPath().arc(0, 0, 7, -1, Math.PI * 1.17, false).strokePath();
      lines(-8, -8, -8, -3, -3, -4);
    }
    if (name === 'undo') {
      lines(-3, -7, -8, -2, -3, 3);
      g.beginPath().moveTo(-7, -2).lineTo(2, -2).arc(2, 2, 4, -Math.PI / 2, Math.PI * 0.6, false).strokePath();
    }
    if (name === 'hint') {
      lines(0, -9, 2, -2, 8, 0, 2, 2, 0, 9, -2, 2, -8, 0, -2, -2, 0, -9);
    }
    return g;
  }

  hit(x: number, y: number, w: number, h: number, live = true) {
    const hit = this.scene.add.zone(x, y, w, h).setInteractive({ useHandCursor: live });
    this.layer.add(hit);
    return hit;
  }

  button(x: number, y: number, w: number, h: number, text: string, action: () => void, options: ButtonOptions = {}) {
    const live = options.live !== false;
    const kind = live ? options.kind ?? 'paper' : 'muted';
    const dark = kind === 'green' || kind === 'red';
    const background = this.image(`button-${kind}`, x, y + h * 0.03, w, h);
    const color = dark ? '#fff6e1' : live ? ink : '#796350';
    this.label(text, x + (text && options.icon ? 12 : 0), y - 2,
      options.size ?? 22, { color, bold: true, wrap: w - 10 });
    if (options.icon) this.icon(options.icon, x - (text ? w / 2 - 20 : 0), y - 2,
      dark ? 0xfff6e1 : live ? 0x553c31 : 0x846b55, text ? 0.83 : 1.17);
    if (!live) return;
    const zone = this.hit(x, y, w - 3, h - 6);
    let pressed = false;
    zone.on('pointerover', () => background.setTint(0xfff8e7));
    zone.on('pointerout', () => { pressed = false; background.clearTint(); });
    zone.on('pointerdown', () => { pressed = true; background.setTint(0xe5d1b0); });
    zone.on('pointerup', () => {
      background.clearTint();
      if (!pressed) return;
      pressed = false;
      if (!options.quiet) this.onClick();
      action();
    });
  }
}
