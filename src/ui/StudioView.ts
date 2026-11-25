import Phaser from 'phaser';

export const ink = '#53372c';
export const mutedInk = '#735748';
const serif = '"Studio Serif", Georgia, serif';
const sans = '"Studio Sans", Arial, sans-serif';

export const CONTROL_ICONS = ['undo', 'restart', 'hint'] as const;
type ControlIcon = (typeof CONTROL_ICONS)[number];
export type Icon = 'back' | 'settings' | 'help' | 'lock' | 'check' | 'arrow' | ControlIcon;

const surfaces = {
  honey: { top: '#f6dba4', bottom: '#e9bb7f', radius: 12 },
  completed: { top: '#f5d6be', bottom: '#e6b493', radius: 12 },
  paper: { top: '#fff6e7', bottom: '#f4e2c9', radius: 12 },
  clay: { top: '#f2c8b4', bottom: '#e3ad97', radius: 12 },
  muted: { top: '#eee0d0', bottom: '#e7d5c0', radius: 12 },
  panel: { top: '#fff9ef', bottom: '#faebd8', radius: 18 },
  notice: { top: '#fff4e5', bottom: '#f5e3ca', radius: 10 },
} as const;
type Surface = keyof typeof surfaces;
const surfacePadding = 8;

function isControlIcon(icon: Icon): icon is ControlIcon {
  return icon === 'undo' || icon === 'restart' || icon === 'hint';
}
export interface ButtonOptions {
  kind?: 'honey' | 'completed' | 'paper' | 'clay';
  live?: boolean;
  icon?: Icon;
  size?: number;
  quiet?: boolean;
  caption?: string;
}

export class StudioView {
  private readonly scene: Phaser.Scene;
  private layer: Phaser.GameObjects.Container;
  private readonly onClick: () => void;
  private readonly density = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
  private dimmer: Phaser.GameObjects.Rectangle | null = null;

  constructor(scene: Phaser.Scene, onClick: () => void) {
    this.scene = scene;
    this.onClick = onClick;
    this.layer = scene.add.container();
  }

  clear() {
    this.layer.destroy();
    this.dimmer = null;
    this.layer = this.scene.add.container();
  }

  image(key: string, x: number, y: number, w: number, h: number) {
    const image = this.scene.add.image(x, y, key).setDisplaySize(w, h);
    this.layer.add(image);
    return image;
  }

  surface(kind: Surface, x: number, y: number, width: number, height: number) {
    const padding = surfacePadding;
    const textureWidth = width + 2 * padding;
    const textureHeight = height + 2 * padding;
    const key = `surface-${kind}-${width}x${height}@${this.density}`;
    const textures = this.scene.textures;
    if (!textures.exists(key)) {
      // Cache one raster per logical size. Scaling the camera keeps all four corners circular.
      const texture = textures.createCanvas(key, textureWidth * this.density, textureHeight * this.density)!;
      const ctx = texture.getContext();
      const { top, bottom, radius } = surfaces[kind];
      ctx.scale(this.density, this.density);
      ctx.beginPath();
      ctx.roundRect(padding, padding, width, height, radius);
      ctx.shadowColor = 'rgba(93, 61, 36, 0.18)';
      ctx.shadowBlur = 5 * this.density;
      ctx.shadowOffsetY = 2 * this.density;
      const color = ctx.createLinearGradient(0, padding, 0, padding + height);
      color.addColorStop(0, top);
      color.addColorStop(1, bottom);
      ctx.fillStyle = color;
      ctx.fill();
      texture.refresh();
    }
    return this.image(key, x, y, textureWidth, textureHeight);
  }

  backdrop(alpha: number) {
    this.dimmer = this.scene.add.rectangle(0, 0, 1, 1, 0x35291f, alpha);
    this.layer.add(this.dimmer);
    this.resizeBackdrop();
    this.dimmer.setInteractive();
  }

  resizeBackdrop() {
    if (!this.dimmer) return;
    const { zoom, scrollX, scrollY, width, height } = this.scene.cameras.main;
    this.dimmer.setPosition(scrollX + width / 2, scrollY + height / 2)
      .setSize((width + 2) / zoom, (height + 2) / zoom);
  }

  label(text: string, x: number, y: number, size = 23, options: {
    color?: string; bold?: boolean; serif?: boolean; weight?: 600 | 700;
    tracking?: number; align?: 'left' | 'center'; wrap?: number;
  } = {}) {
    const label = this.scene.add.text(x, y, text, {
      fontFamily: options.serif ? serif : sans, fontSize: size,
      resolution: this.density,
      fontStyle: String(options.weight ?? (options.bold || options.serif ? 700 : 400)),
      color: options.color ?? ink, letterSpacing: options.tracking ?? 0,
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

  icon(name: Exclude<Icon, ControlIcon>, x: number, y: number, color: number, scale: number) {
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
    const background = this.surface(kind, x, y, w, h - 6);
    const color = live ? ink : mutedInk;
    const icon = options.icon;
    const controlIcon = icon !== undefined && isControlIcon(icon);
    const labelY = options.caption ? y - 16 : y;
    const label = this.label(text, x + (text && icon && !options.caption ? (controlIcon ? 13 : 10) : 0), labelY,
      options.size ?? 22, { color, serif: !!options.caption, weight: kind === 'honey' || options.caption ? 700 : 600,
        wrap: w - (text && icon ? 36 : 12) });
    if (options.caption) this.label(options.caption.toUpperCase(), x, y + 21, 14, {
      color: kind === 'completed' ? ink : mutedInk, weight: 600, tracking: 0.8, wrap: w - 24,
    });
    if (controlIcon) {
      let iconX = x - w / 2 + 21;
      if (icon === 'restart') {
        // Center the visible arrow and the measured label with an even gap.
        const visibleIconWidth = 20;
        const gap = 10;
        const textWidth = label.width - (label.padding.left ?? 0) - (label.padding.right ?? 0);
        iconX = x - (textWidth + gap) / 2;
        label.setX(x + (visibleIconWidth + gap) / 2);
      }
      this.image(`control-${icon}`, iconX, y, 27, 27).setAlpha(live ? 1 : 0.74);
    } else if (icon) {
      this.icon(icon, x - (text ? w / 2 - 22 : 0), options.caption ? y - 8 : labelY,
        live ? 0x553c31 : 0x846b55, text ? 0.83 : 1.17);
    }
    if (!live) return;
    const zone = this.hit(x, y, w - 3, h - 6);
    let pressed = false;
    zone.on('pointerover', () => background.setAlpha(0.88));
    zone.on('pointerout', () => { pressed = false; background.setAlpha(1); });
    zone.on('pointerdown', () => { pressed = true; background.setAlpha(0.72); });
    zone.on('pointerup', () => {
      background.setAlpha(1);
      if (!pressed) return;
      pressed = false;
      if (!options.quiet) this.onClick();
      action();
    });
  }
}
