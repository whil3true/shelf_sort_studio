import { createCanvas } from '@napi-rs/canvas';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const dir = new URL('../public/assets/art/', import.meta.url);
mkdirSync(dir, { recursive: true });
const licenses = new URL('../public/assets/font-licenses/', import.meta.url);
mkdirSync(licenses, { recursive: true });
for (const [name, directory] of [['lora', '@fontsource/lora'], ['manrope', '@fontsource-variable/manrope']]) {
  copyFileSync(new URL(`../node_modules/${directory}/LICENSE`, import.meta.url), new URL(`${name}-OFL.txt`, licenses));
}
function save(name, canvas) {
  writeFileSync(new URL(name + '.png', dir), canvas.toBuffer('image/png'));
}

let ctx;
function sheet(w, h, draw, scale = 2) {
  const canvas = createCanvas(w * scale, h * scale);
  ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  draw();
  return canvas;
}
function grad(y, h, a, b) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}
function round(x, y, w, h, r, paint, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = paint;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}
function oval(x, y, rx, ry, paint) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = paint;
  ctx.fill();
}
function path(points, paint, stroke) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) {
    if (point.length === 2) ctx.lineTo(...point);
    else ctx.bezierCurveTo(...point);
  }
  ctx.closePath();
  ctx.fillStyle = paint;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}
function line(points, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) {
    if (point.length === 2) ctx.lineTo(...point);
    else ctx.bezierCurveTo(...point);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}
function noise(w, h, count, color) {
  let seed = 6187;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) ctx.fillRect(next() * w, next() * h, 0.4 + next(), 0.6);
}
function leaf(x, y, color, flip = 1) {
  path([[x, y], [x + 4 * flip, y - 11, x + 14 * flip, y - 13, x + 18 * flip, y - 12],
    [x + 16 * flip, y - 3, x + 7 * flip, y + 1, x, y]], color);
  line([[x, y], [x + 11 * flip, y - 8]], '#ffffff55', 0.7);
}
function shine(x, y, size, color = '#ffe7a3') {
  path([[x, y - size], [x + 1, y - 1], [x + size, y], [x + 1, y + 1],
    [x, y + size], [x - 1, y + 1], [x - size, y], [x - 1, y - 1]], color);
}
function seal(x, y, paper, color, design = 'berry') {
  oval(x, y, 8, 8, paper);
  if (design === 'berry') {
    for (const [dx, dy] of [[-2, -1], [2, -1], [0, 2]]) oval(x + dx, y + dy, 2.5, 2.4, color);
    leaf(x + 1, y - 3, '#668459', 0.35);
  } else {
    line([[x - 4, y + 3], [x, y - 3], [x + 4, y + 3]], color, 1.5);
    line([[x - 2, y + 1], [x + 2, y + 1]], color, 1);
  }
}
function jar(a, b, lid, paper, mark) {
  round(13, 23, 38, 34, 8, grad(23, 34, a, b), '#6c422442');
  round(15.5, 28, 3, 21, 1.5, '#ffffff40');
  round(12, 17, 40, 8, 2, grad(17, 8, lid, b));
  for (let x = 16; x < 50; x += 4) line([[x, 19], [x, 23]], '#fff9dc38', 0.8);
  round(19, 32, 26, 17, 4, paper);
  seal(32, 40, paper, mark);
}
function carton(front, side, fold, label, mark) {
  path([[15, 22], [24, 12], [45, 12], [51, 23], [51, 54], [44, 58], [15, 56]], side);
  path([[15, 22], [22, 16], [43, 16], [44, 23], [44, 58], [15, 56]], grad(16, 42, front, fold));
  path([[15, 22], [24, 12], [45, 12], [44, 23]], front);
  line([[17, 22], [43, 23]], '#fff7e6ab');
  round(18, 29, 23, 19, 3, label);
  seal(29.5, 38, label, mark, 'crest');
  line([[21, 52], [38, 53]], '#fff8df66', 1.2);
}
function fruit(top, bottom, a, b, stemColor, shape) {
  path(shape, grad(top, bottom - top, a, b), '#78502d33');
  oval(23, 32, 3.3, 7, '#fff8d45e');
  line([[31, 25], [32, 17], [35, 14]], stemColor, 2.2);
  leaf(33, 20, '#658458', 0.83);
}

const drawings = {
  jam: () => jar('#c96871', '#8f3c51', '#f0bb8a', '#f8dfb8', '#a33b55'),
  tea: () => carton('#9db389', '#577d64', '#6f9272', '#eae5bd', '#466952'),
  honey: () => {
    jar('#edbc63', '#b87437', '#f6d286', '#ffedbc', '#b57b24');
    oval(32, 40, 8.4, 7.8, '#fff0bb');
    path([[32, 34], [35, 39], [36, 45, 28, 46, 28, 41], [28, 38, 30, 37, 32, 34]], '#d28c31');
  },
  cocoa: () => carton('#bf8a6a', '#7f5546', '#9e6a56', '#f6debb', '#7a4939'),
  pear: () => fruit(18, 58, '#d8db8b', '#88a35e', '#684b39',
    [[30, 19], [44, 19, 37, 29, 46, 36], [64, 60, 22, 66, 14, 49], [8, 38, 26, 30, 26, 23], [27, 20, 28, 19, 30, 19]]),
  apple: () => fruit(19, 57, '#efa58d', '#b75d58', '#664733',
    [[32, 26], [48, 17, 55, 30, 51, 45], [47, 58, 40, 60, 32, 56], [20, 59, 15, 53, 12, 42], [7, 27, 19, 18, 32, 26]]),
  lemon: () => {
    ctx.save();
    ctx.translate(32, 39); ctx.rotate(-0.36);
    path([[-23, 0], [-17, -4, -14, -16, 0, -16], [14, -16, 18, -4, 23, 0],
      [19, 4, 13, 16, 0, 16], [-14, 16, -18, 5, -23, 0]], grad(-16, 32, '#fadd8e', '#cf963a'));
    oval(-7, -7, 7, 3, '#fff8c66e');
    for (const [x, y] of [[7, 4], [-11, 4], [12, -4], [0, 9], [7, 10]]) oval(x, y, 0.7, 0.8, '#a4743755');
    ctx.restore();
    leaf(45, 29, '#728850', 0.8);
  },
  soda: () => {
    round(20, 17, 24, 40, 5, grad(17, 40, '#85bdbe', '#4b858a'), '#576b6938');
    oval(32, 18, 11, 3, '#d2e1d6'); oval(33, 18, 3.1, 1.1, '#597c76');
    line([[23, 24], [23, 50]], '#effff064', 2);
    path([[20, 37], [29, 28], [44, 35], [44, 43], [36, 39], [24, 48], [20, 46]], '#f4d6a2');
    shine(33, 39, 5, '#f7f6d6');
  },
  soap: () => {
    path([[10, 39], [14, 30], [42, 25], [54, 34], [52, 49], [25, 57], [10, 49]], '#927697');
    path([[10, 39], [14, 30], [42, 25], [54, 34], [25, 46]], grad(26, 20, '#e3c0d7', '#c398bc'));
    path([[24, 28], [34, 26], [46, 37], [43, 52], [32, 55], [34, 42]], '#eee1bd');
    leaf(35, 38, '#7f8b68', 0.35);
    shine(17, 31, 5, '#fff4e1');
  },
  candle: () => {
    round(16, 30, 32, 26, 4, grad(30, 26, '#d9a78b', '#a7766d'));
    oval(32, 31, 16, 5, '#efd5b2');
    oval(32, 31, 6.6, 2.5, '#fff0ca');
    line([[32, 31], [32, 24]], '#6d5144', 1.7);
    path([[29, 25], [25, 19, 33, 17, 33, 12], [39, 20, 38, 28, 31, 28]], '#f2b464');
    oval(33, 24, 2, 3, '#ffe8a1');
    round(23, 41, 18, 10, 3, '#ffdeb9');
    shine(32, 46, 3, '#a67365');
  },
  milk: () => carton('#e9e4cf', '#7b9ca6', '#a8c4c5', '#f4f2dd', '#547f88'),
  flour: () => {
    path([[18, 18], [46, 18], [48, 28], [50, 53], [45, 57], [19, 57], [14, 52]],
      grad(18, 39, '#efd9b5', '#c7a17a'), '#865c3e4d');
    round(16, 16, 32, 5, 1, '#b98d66');
    round(20, 27, 24, 21, 3, '#f5e4b9');
    line([[28, 43], [36, 32]], '#9c783e', 1.5);
    for (let y = 36; y <= 42; y += 3) {
      oval(34, y, 2.8, 1.3, '#b38d49'); oval(29, y - 2, 1.1, 2, '#b38d49');
    }
  },
  mint: () => {
    round(14, 28, 36, 25, 5, grad(28, 25, '#b6d0a3', '#668c74'));
    round(12, 25, 40, 6, 2, '#d1e0bd');
    round(18, 33, 28, 14, 3, '#e9e9bd');
    leaf(31, 42, '#6a9173', 0.6);
    leaf(31, 42, '#82a07a', -0.48);
  },
  cookie: () => {
    path([[12, 37], [16, 23, 27, 18, 34, 20], [46, 17, 54, 31, 52, 41],
      [55, 53, 38, 59, 31, 57], [17, 60, 10, 50, 12, 37]], grad(18, 40, '#edc183', '#bd864d'));
    for (const [x, y, s] of [[22, 31, 2.5], [35, 29, 3], [30, 40, 2.8], [44, 39, 2.4], [23, 48, 2.6], [38, 49, 2]]) {
      oval(x, y, s, s - 0.4, '#845344');
      oval(x - 0.4, y - 0.8, s / 2, 0.65, '#ddb18b');
    }
  },
};

const sprites = Object.fromEntries(Object.entries(drawings).map(([name, draw]) => {
  const canvas = sheet(64, 64, () => {
    oval(32, 58, 22, 4.2, '#41271d22');
    oval(32, 59, 16, 2.6, '#41271d14');
    draw();
  }, 3);
  save(name, canvas);
  return [name, canvas];
}));

save('wallpaper', sheet(480, 800, () => {
  round(0, 0, 480, 800, 0, grad(0, 800, '#fff4df', '#ecd4af'));
  for (let x = 10; x < 480; x += 23) {
    round(x, 0, 1, 800, 0, '#a3633212');
    round(x + 2, 0, 3, 800, 0, '#fffaf347');
  }
  const glow = ctx.createRadialGradient(238, 360, 105, 238, 360, 444);
  glow.addColorStop(0, '#fff6e92b');
  glow.addColorStop(1, '#ac6a3621');
  round(0, 0, 480, 800, 0, glow);
  line([[0, 785], [480, 785]], '#af805661', 2);
  noise(480, 800, 46000, '#55301c0c');
}));

save('shelf', sheet(216, 136, () => {
  round(2, 8, 212, 126, 14, '#71412328');
  round(1, 3, 214, 127, 14, grad(3, 127, '#e3b485', '#9a6045'), '#9b6445');
  round(7, 10, 202, 107, 10, grad(10, 106, '#996547', '#d0a477'), '#80533c');
  round(12, 13, 192, 100, 8, grad(13, 100, '#ba8b62', '#e6bc8e'));
  round(7, 97, 202, 22, 5, grad(97, 22, '#e9be90', '#bd855d'));
  round(4, 113, 208, 15, 5, grad(113, 15, '#c89266', '#a76d50'));
  line([[14, 114], [200, 114]], '#f8d5a789');
  line([[16, 121], [200, 121]], '#8b52375b');
  for (const x of [18, 198]) { oval(x, 122, 2, 2, '#744b3c73'); oval(x - 0.4, 121.5, 0.6, 0.6, '#efd0a9'); }
  noise(216, 136, 3000, '#67381912');
}));

for (const [name, a, b, edge] of [
  ['button-green', '#52765f', '#315744', '#2f513f'],
  ['button-paper', '#fff8e8', '#efddbd', '#ba9771'],
  ['button-red', '#ad6652', '#8f4e3c', '#814836'],
  ['button-muted', '#ead9ba', '#ddc6a4', '#c7ab80'],
]) {
  save(name, sheet(360, 72, () => {
    round(3, 8, 354, 63, 19, '#64472d27');
    round(2, 2, 356, 62, 18, grad(2, 62, a, b), edge);
    round(6, 5, 348, 54, 15, '#ffffff07', '#fff9de34');
  }));
}

save('paper', sheet(440, 440, () => {
  round(3, 7, 434, 431, 25, '#432b253c');
  round(1, 1, 438, 430, 24, grad(1, 430, '#fff9eb', '#f7e9cb'), '#b79570');
  round(8, 8, 424, 416, 18, '#fff9eb0c', '#c4a77f55');
  noise(440, 440, 14000, '#744e2b09');
}));

save('shop', sheet(416, 257, () => {
  round(2, 6, 412, 248, 25, '#65422b2e');
  round(1, 0, 414, 251, 24, grad(0, 249, '#4a6954', '#263d34'), '#29463b');
  ctx.save();
  ctx.beginPath(); ctx.roundRect(2, 2, 412, 248, 23); ctx.clip();
  for (let x = 12; x < 415; x += 20) line([[x, 0], [x, 244]], '#e8d4a71a');
  path([[0, 215], [416, 215], [416, 252], [0, 252]], grad(215, 37, '#273e34', '#314538'));
  oval(208, 233, 144, 13, '#1a2d2770');
  round(78, 37, 260, 199, 29, grad(37, 199, '#c1976a', '#96664e'), '#704b3d', 2);
  round(87, 46, 242, 185, 21, grad(46, 179, '#674e38', '#967354'), '#f0c89777', 1.5);
  round(98, 51, 220, 177, 17, grad(51, 177, '#6c5440', '#b2855e'));
  for (const [row, keys] of [['tea', 'jam', 'honey', 'milk', 'cocoa'], ['pear', 'soap', 'candle', 'soda', 'cookie']].entries()) {
    const y = 82 + row * 57;
    for (const [index, key] of keys.entries()) ctx.drawImage(sprites[key], 102 + index * 42, y, 47, 47);
    round(93, y + 43, 230, 10, 3, grad(y + 43, 10, '#d6a979', '#a87350'));
    line([[99, y + 45], [317, y + 45]], '#f4cc9977');
  }
  round(91, 195, 234, 32, 4, grad(195, 32, '#bc8d66', '#98634b'));
  for (const x of [99, 173, 247]) {
    round(x, 199, 69, 23, 3, '#d9a87b33', '#81583f99');
    oval(x + 34, 210, 3, 1.7, '#f1c991');
  }
  for (let col = 0; col < 12; col++) {
    const x = 69 + col * 23;
    const light = col % 2 === 0;
    path([[x + 5, 44], [x + 26, 44], [x + 24, 75], [x + 24, 89, x, 89, x, 76]],
      grad(44, 45, light ? '#fae0ae' : '#bd7b6c', light ? '#e0ba87' : '#9e5f54'));
  }
  round(72, 40, 271, 6, 3, '#ecd2a2');
  for (const side of [1, -1]) {
    const x = side === 1 ? 44 : 372;
    line([[x, 205], [x + 4 * side, 170], [x - 11 * side, 147]], '#98a878', 2);
    leaf(x, 182, '#80956e', side);
    leaf(x - 2 * side, 173, '#a1aa7d', -side);
    leaf(x - 4 * side, 161, '#8e9e72', side * 0.8);
    path([[x - 14, 199], [x + 14, 199], [x + 10, 227], [x - 10, 227]], grad(199, 28, '#e5b183', '#ad775d'));
    round(x - 15, 197, 30, 6, 3, '#cb9674');
    shine(x + 6 * side, 105, 6, '#f9df9f');
    shine(x - 10 * side, 122, 3, '#f5d693');
  }
  noise(416, 251, 15000, '#ffffda16');
  ctx.restore();
}));

save('victory', sheet(212, 206, () => {
  oval(106, 101, 86, 86, '#e4c08455');
  oval(106, 101, 76, 76, '#f9e0a477');
  oval(107, 175, 75, 8, '#6b463522');
  for (const [i, key] of ['tea', 'jam', 'honey'].entries()) {
    ctx.drawImage(sprites[key], 40 + i * 43, 53 + (i === 1 ? -14 : 2), 53, 66);
  }
  path([[30, 110], [181, 110], [168, 168], [162, 173], [49, 173], [43, 167]], grad(110, 63, '#d6aa73', '#a77553'), '#8a5b42');
  round(28, 103, 156, 14, 5, grad(103, 14, '#f3cc95', '#cb9b67'), '#a87a54');
  line([[41, 131], [172, 131]], '#926140', 1.5);
  line([[45, 156], [167, 156]], '#f2ce936b', 2);
  oval(105, 143, 15, 15, '#f7dfab');
  line([[98, 143], [103, 148], [112, 137]], '#5f805e', 2.6);
  shine(32, 61, 8, '#d5a053'); shine(169, 45, 10, '#d5a053');
  shine(185, 79, 5, '#d5a053'); shine(62, 27, 5, '#d5a053');
}));
