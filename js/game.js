(() => {
'use strict';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const DESIGN_W = 440;
const GW = 100, GH = 100, CELL = 4, SUB = 6;
const BOARD_MAX = 416;
let cell = CELL, BOARD_W = GW * CELL, BOARD_H = GH * CELL, BOARD_X = (DESIGN_W - BOARD_W) / 2;
const DANGER_ROW = Math.round(GH * 0.2), CLEAR_MIN = 600, DROP_STEP = 34;
const SLOT_H = 120, SLOT_W = 120, SLOT_GAP = 16;
const SLOT_X0 = (DESIGN_W - (SLOT_W * 3 + SLOT_GAP * 2)) / 2;
const EDGE_PAD = 12, HEADER_H = 100, FRAME = 6, BOARD_SLOT_GAP = 24, HINT_H = 30;
const MIN_GAP = 12, MAX_GAP = 64;
const MIN_H = EDGE_PAD * 2 + HEADER_H + HINT_H + FRAME * 2 + BOARD_MAX + BOARD_SLOT_GAP + SLOT_H + MIN_GAP * 2.5;

const view = { scale: 1, w: DESIGN_W, h: MIN_H, ox: 0, k: 1, ex: 0 };

function snapX(x) { return (Math.round(x * view.k + view.ex) - view.ex) / view.k; }
function snapY(y) { return Math.round(y * view.k) / view.k; }
let HEADER_Y = 0, BOARD_Y = 0, SLOT_Y = 0, HINT_Y = 0;
const BTN = { x: DESIGN_W / 2 - 95, y: 0, w: 190, h: 58 };
const SPEAKER = { x: DESIGN_W - 36, y: 0, w: 26, h: 26, r: 7 };

function layout(safeTop, safeBottom) {
  const top = safeTop + EDGE_PAD;
  const bottom = view.h - safeBottom - EDGE_PAD;
  HEADER_Y = top;
  HINT_Y = bottom - 10;
  const availTop = top + HEADER_H, availBottom = bottom - HINT_H;
  const free = availBottom - availTop - (FRAME * 2 + BOARD_H + BOARD_SLOT_GAP + SLOT_H);
  const gap = Math.max(MIN_GAP, Math.min(MAX_GAP, free / 2.5));
  const extra = Math.max(0, free - gap * 2.5);
  BOARD_Y = snapY(availTop + extra * 0.3 + gap + FRAME);
  SLOT_Y = BOARD_Y + BOARD_H + FRAME + BOARD_SLOT_GAP + gap * 0.5;
  SPEAKER.y = HEADER_Y + 10;
  BTN.y = BOARD_Y + BOARD_H / 2 + 62;
}

const PALETTE = [null,
  ['#4a90e8', '#2c5cb0'],
  ['#e8c94e', '#c2a02c'],
  ['#e04848', '#b02e2e'],
  ['#4db85c', '#2f8f3e'],
  ['#41c3cd', '#2b98a1']
];

function hexToPx(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((0xff << 24) | ((n & 0xff) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
}
const PALETTE_PX = PALETTE.map(p => p && p.map(hexToPx));
const boardCanvas = document.createElement('canvas');
boardCanvas.width = GW;
boardCanvas.height = GH;
const bctx = boardCanvas.getContext('2d');
const boardImg = bctx.createImageData(GW, GH);
const boardPx = new Uint32Array(boardImg.data.buffer);
const gridOverlay = document.createElement('canvas');
const boardBig = document.createElement('canvas');
const gctx = boardBig.getContext('2d');
let gridOverlayPx = 0;

function buildGridOverlay(px) {
  gridOverlayPx = px;
  gridOverlay.width = boardBig.width = GW * px;
  gridOverlay.height = boardBig.height = GH * px;
  if (px < 4) return;
  const g = gridOverlay.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 1; i < GW; i++) g.fillRect(i * px, 0, 1, GH * px);
  for (let i = 1; i < GH; i++) g.fillRect(0, i * px, GW * px, 1);
}
const safeProbe = document.getElementById('safe');

const RAW_SHAPES = [
  { c: [[0, 0]] },
  { c: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { c: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { c: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { c: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { c: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { c: [[1, 0], [1, 1], [1, 2], [0, 2]] }
];

const SHAPES = RAW_SHAPES.map(s => {
  const cells = [];
  for (const [cx, cy] of s.c) {
    for (let dy = 0; dy < SUB; dy++) {
      for (let dx = 0; dx < SUB; dx++) cells.push([cx * SUB + dx, cy * SUB + dy]);
    }
  }
  return {
    cells,
    w: (Math.max(...s.c.map(p => p[0])) + 1) * SUB,
    h: (Math.max(...s.c.map(p => p[1])) + 1) * SUB
  };
});

let grid = new Uint8Array(GW * GH);
let queue = [];
let selSlot = -1;
let state = 'idle';
let pressed = false, dragging = false;
let aimCol = 0, restCount = 0, parity = 0;
let fallings = [];
let score = 0, best = 0, newBest = false;
let flashes = [];
let soundOn = true;
try {
  const v = localStorage.getItem('sand-sound');
  if (v !== null) soundOn = v !== '0';
  best = parseInt(localStorage.getItem('sand-best'), 10) || 0;
} catch (e) {}

let audioCtx = null;
function getAudio() {
  if (audioCtx) return audioCtx;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  return audioCtx;
}
function playClick() {
  if (!soundOn) return;
  const ac = getAudio(); if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine'; o.frequency.value = 860;
  g.gain.setValueAtTime(0.14, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + 0.09);
}
function playDrop() {
  if (!soundOn) return;
  const ac = getAudio(); if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle'; o.frequency.value = 420;
  g.gain.setValueAtTime(0.13, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g); g.connect(ac.destination);
  o.frequency.exponentialRampToValueAtTime(180, t + 0.14);
  o.start(t); o.stop(t + 0.14);
}
function playClear() {
  if (!soundOn) return;
  const ac = getAudio(); if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  const t = ac.currentTime;
  [0, 0.09, 0.18].forEach((d, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = i === 1 ? 'triangle' : 'sine';
    o.frequency.value = [523, 659, 784][i];
    g.gain.setValueAtTime(0.16, t + d);
    g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.28);
    o.connect(g); g.connect(ac.destination);
    o.start(t + d); o.stop(t + d + 0.28);
  });
  const o2 = ac.createOscillator(), g2 = ac.createGain();
  o2.type = 'sine'; o2.frequency.value = 180;
  g2.gain.setValueAtTime(0.18, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o2.connect(g2); g2.connect(ac.destination);
  o2.start(t); o2.stop(t + 0.22);
}

function genPiece() {
  return {
    shape: SHAPES[(Math.random() * SHAPES.length) | 0],
    color: 1 + ((Math.random() * 5) | 0)
  };
}

function refillQueue() {
  queue[0] = genPiece();
  queue[1] = genPiece();
  queue[2] = genPiece();
}

function saveBest() {
  try {
    localStorage.setItem('sand-best', String(best));
  } catch (e) {}
}

function generateInitialSand() {
  grid.fill(0);
  const target = Math.floor(GW * GH * 0.2);
  let occupied = 0;
  let tries = 0;
  while (occupied < target && tries < 60) {
    const p = genPiece();
    const maxX = GW - p.shape.w;
    const x = maxX > 0 ? (Math.random() * (maxX + 1) | 0) : 0;
    let y = -p.shape.h;
    while (y + 1 < GH && !collides(x, y + 1, p.shape)) y++;
    for (const [cx, cy] of p.shape.cells) {
      const gy = y + cy, gx = x + cx;
      if (gy >= 0 && gy < GH) grid[gy * GW + gx] = p.color;
    }
    for (let s = 0; s < 80; s++) if (sandPass() === 0) break;
    occupied = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i]) occupied++;
    tries++;
  }
  for (let s = 0; s < 200; s++) if (sandPass() === 0) break;
  restCount = 0;
  parity = 0;
}

function restart() {
  generateInitialSand();
  score = 0;
  newBest = false;
  flashes.length = 0;
  queue.length = 0;
  refillQueue();
  selSlot = -1;
  fallings.length = 0;
  restCount = 0;
  parity = 0;
  state = 'idle';
}

function collides(px, py, sh) {
  for (const [cx, cy] of sh.cells) {
    const gx = px + cx, gy = py + cy;
    if (gx < 0 || gx >= GW || gy >= GH) return true;
    if (gy >= 0 && grid[gy * GW + gx]) return true;
  }
  return false;
}

function collidesFallings(px, py, sh, selfIdx) {
  for (let j = 0; j < fallings.length; j++) if (j !== selfIdx) {
    const o = fallings[j];
    for (const [cx, cy] of sh.cells) {
      const gx = px + cx, gy = py + cy;
      for (const [ox, oy] of o.shape.cells) {
        if (gx === o.x + ox && gy === o.y + oy) return true;
      }
    }
  }
  return false;
}

function landOne(f) {
  for (const [cx, cy] of f.shape.cells) {
    const gy = f.y + cy;
    if (gy >= 0) grid[gy * GW + f.x + cx] = f.color;
  }
  restCount = 0;
  parity = 0;
}

function sandPass() {
  let moved = 0;
  parity ^= 1;
  for (let y = GH - 2; y >= 0; y--) {
    for (let k = 0; k < GW; k++) {
      const x = parity ? k : GW - 1 - k;
      const i = y * GW + x;
      const c = grid[i];
      if (!c) continue;
      const b = i + GW;
      if (!grid[b]) {
        grid[b] = c;
        grid[i] = 0;
        moved++;
        continue;
      }
      const first = Math.random() < 0.5 ? 1 : -1;
      for (const d of [first, -first]) {
        const nx = x + d;
        if (nx < 0 || nx >= GW) continue;
        if (!grid[b + d]) {
          grid[b + d] = c;
          grid[i] = 0;
          moved++;
          break;
        }
      }
    }
  }
  return moved;
}

function checkClear() {
  const seen = new Uint8Array(GW * GH);
  const stack = [];
  let any = false;
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i]) continue;
    const col = grid[i];
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    const reg = [];
    let touchL = false, touchR = false;
    while (stack.length) {
      const j = stack.pop();
      reg.push(j);
      const x = j % GW, y = (j / GW) | 0;
      if (x === 0) touchL = true;
      if (x === GW - 1) touchR = true;
      if (x > 0 && !seen[j - 1] && grid[j - 1] === col) { seen[j - 1] = 1; stack.push(j - 1); }
      if (x < GW - 1 && !seen[j + 1] && grid[j + 1] === col) { seen[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && !seen[j - GW] && grid[j - GW] === col) { seen[j - GW] = 1; stack.push(j - GW); }
      if (y < GH - 1 && !seen[j + GW] && grid[j + GW] === col) { seen[j + GW] = 1; stack.push(j + GW); }
    }
    if (touchL && touchR) {
      any = true;
      score += reg.length;
      for (const j of reg) {
        flashes.push({ x: j % GW, y: (j / GW) | 0, t: 0, col: grid[j] });
        grid[j] = 0;
      }
    }
  }
  if (score > best) {
    best = score;
    newBest = true;
    saveBest();
  }
  if (any) {
    restCount = 0;
    playClear();
  } else {
    finalizeTurn();
  }
}

function finalizeTurn() {
  let over = false;
  outer:
  for (let y = 0; y < DANGER_ROW; y++) {
    for (let x = 0; x < GW; x++) {
      if (grid[y * GW + x]) { over = true; break outer; }
    }
  }
  if (over) state = 'over';
  else if (state !== 'aim') state = 'idle';
}

function startAim(i) {
  selSlot = i;
  state = 'aim';
  aimCol = (GW - queue[i].shape.w) >> 1;
  dragging = false;
}

function updateAim(px) {
  const sh = queue[selSlot].shape;
  const col = Math.floor((px - BOARD_X) / cell) - ((sh.w - 1) >> 1);
  aimCol = Math.max(0, Math.min(GW - sh.w, col));
}

function confirmDrop() {
  const p = queue[selSlot];
  queue[selSlot] = null;
  if (queue.every(v => !v)) refillQueue();
  fallings.push({ shape: p.shape, color: p.color, x: aimCol, y: -p.shape.h, prevRow: -p.shape.h, dropAcc: 0 });
  selSlot = -1;
  dragging = false;
  state = 'idle';
  playDrop();
}

function update(dt) {
  for (let i = fallings.length - 1; i >= 0; i--) {
    const f = fallings[i];
    f.dropAcc += dt;
    while (f.dropAcc >= DROP_STEP) {
      f.dropAcc -= DROP_STEP;
      const ny = f.y + 1;
      if (collides(f.x, ny, f.shape)) {
        landOne(f);
        fallings.splice(i, 1);
        break;
      }
      if (collidesFallings(f.x, ny, f.shape, i)) {
        f.dropAcc = 0;
        break;
      }
      f.prevRow = f.y;
      f.y = ny;
    }
  }
  for (let s = 0; s < 2; s++) {
    const moved = sandPass();
    if (fallings.length === 0) {
      restCount = moved > 0 ? 0 : restCount + 1;
    } else {
      restCount = 0;
    }
  }
  if (fallings.length === 0 && restCount >= 4) checkClear();
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].t += dt;
    if (flashes[i].t > 450) flashes.splice(i, 1);
  }
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGrain(x, y, c, size) {
  const pair = PALETTE[c];
  ctx.fillStyle = ((x * 73 + y * 151) & 7) < 3 ? pair[1] : pair[0];
  ctx.fillRect(BOARD_X + x * size, BOARD_Y + y * size, size, size);
}

function grainPx(x, y, c) {
  return PALETTE_PX[c][((x * 73 + y * 151) & 7) < 3 ? 1 : 0];
}

function drawBoardGrains() {
  boardPx.fill(0);
  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    if (c) boardPx[i] = grainPx(i % GW, (i / GW) | 0, c);
  }
  for (const f of fallings) {
    const ry = Math.round(f.prevRow + (f.y - f.prevRow) * Math.min(f.dropAcc / DROP_STEP, 1));
    for (const [cx, cy] of f.shape.cells) {
      const gx = f.x + cx, gy = ry + cy;
      if (gy >= 0 && gy < GH) boardPx[gy * GW + gx] = grainPx(gx, gy, f.color);
    }
  }
  bctx.putImageData(boardImg, 0, 0);
  let src = boardCanvas;
  if (gridOverlayPx >= 4) {
    gctx.globalCompositeOperation = 'copy';
    gctx.imageSmoothingEnabled = false;
    gctx.drawImage(boardCanvas, 0, 0, boardBig.width, boardBig.height);
    gctx.globalCompositeOperation = 'source-atop';
    gctx.drawImage(gridOverlay, 0, 0);
    src = boardBig;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, BOARD_X, BOARD_Y, BOARD_W, BOARD_H);
}

function render(now) {
  ctx.fillStyle = '#141d40';
  ctx.fillRect(-view.ox, 0, view.w, view.h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#dfe6ff';
  ctx.font = '600 17px -apple-system,system-ui,sans-serif';
  ctx.fillText('沙子俄罗斯方块', DESIGN_W / 2, HEADER_Y + 34);
  ctx.textAlign = 'left';

  rr(24, HEADER_Y + 48, 170, 52, 8);
  ctx.fillStyle = '#1a2452';
  ctx.fill();
  ctx.strokeStyle = '#2c3a70';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#93a5dd';
  ctx.font = '12px -apple-system,system-ui,sans-serif';
  ctx.fillText('分数', 36, HEADER_Y + 70);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 22px -apple-system,system-ui,sans-serif';
  ctx.fillText(String(score), 36, HEADER_Y + 93);

  rr(DESIGN_W - 194, HEADER_Y + 48, 170, 52, 8);
  ctx.fillStyle = '#1a2452';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#93a5dd';
  ctx.font = '12px -apple-system,system-ui,sans-serif';
  ctx.fillText('最高分', DESIGN_W - 182, HEADER_Y + 70);
  ctx.fillStyle = '#ffd75e';
  ctx.font = '600 22px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(String(best), DESIGN_W - 38, HEADER_Y + 93);
  ctx.textAlign = 'left';

  rr(BOARD_X - FRAME, BOARD_Y - FRAME, BOARD_W + FRAME * 2, BOARD_H + FRAME * 2, 8);
  ctx.fillStyle = '#0e1430';
  ctx.fill();
  ctx.strokeStyle = '#31407a';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawBoardGrains();

  ctx.save();
  ctx.beginPath();
  ctx.rect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H);
  ctx.clip();

  for (const f of flashes) {
    const p = f.t / 450;
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = '#ffffff';
    const s = cell * (1 + p);
    ctx.fillRect(BOARD_X + f.x * cell + (cell - s) / 2, BOARD_Y + f.y * cell - p * 26, s, s);
    ctx.globalAlpha = 1;
  }

  if (state === 'aim') {
    const q = queue[selSlot];
    const sh = q.shape;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(BOARD_X + aimCol * cell, BOARD_Y, sh.w * cell, BOARD_H);
    ctx.globalAlpha = 0.35;
    for (const [cx, cy] of sh.cells) {
      drawGrain(aimCol + cx, cy, q.color, cell);
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  ctx.fillStyle = '#ff3b30';
  ctx.fillRect(BOARD_X, BOARD_Y + DANGER_ROW * cell - 1.5, BOARD_W, 3);

  const slotScale = Math.min((SLOT_W - 30) / (24 * CELL), (SLOT_H - 30) / (18 * CELL));
  for (let i = 0; i < 3; i++) {
    const sx = SLOT_X0 + i * (SLOT_W + SLOT_GAP);
    rr(sx, SLOT_Y, SLOT_W, SLOT_H, 12);
    ctx.fillStyle = state === 'aim' && selSlot === i ? '#233064' : '#16204a';
    ctx.fill();
    ctx.strokeStyle = state === 'aim' && selSlot === i ? '#ffd75e' : '#26356b';
    ctx.lineWidth = state === 'aim' && selSlot === i ? 2.5 : 1.5;
    ctx.stroke();
    const p = queue[i];
    if (p && !(state === 'aim' && selSlot === i)) {
      const sh = p.shape;
      const dwPx = Math.max(1, Math.floor(CELL * slotScale * view.k));
      const dw = dwPx / view.k;
      const ox = snapX(sx + (SLOT_W - sh.w * dw) / 2);
      const oy = snapY(SLOT_Y + (SLOT_H - sh.h * dw) / 2);
      ctx.beginPath();
      for (const [cx, cy] of sh.cells) ctx.rect(ox + cx * dw, oy + cy * dw, dw, dw);
      ctx.fillStyle = PALETTE[p.color][0];
      ctx.fill();
      if (dwPx >= 4) {
        const line = 1 / view.k;
        ctx.save();
        ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        for (let cx = 1; cx < sh.w; cx++) ctx.fillRect(ox + cx * dw, oy, line, sh.h * dw);
        for (let cy = 1; cy < sh.h; cy++) ctx.fillRect(ox, oy + cy * dw, sh.w * dw, line);
        ctx.restore();
      }
    }
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#55628f';
  ctx.font = '13px -apple-system,system-ui,sans-serif';
  ctx.fillText('点选方块 · 棋盘上滑动选列 · 松手落下', DESIGN_W / 2, HINT_Y);
  ctx.textAlign = 'left';

  if (state === 'over') {
    const ty = BTN.y - 82;
    ctx.fillStyle = 'rgba(6,8,20,0.72)';
    ctx.fillRect(-view.ox, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 34px -apple-system,system-ui,sans-serif';
    ctx.fillText('游戏结束', DESIGN_W / 2, ty);
    ctx.font = '600 26px -apple-system,system-ui,sans-serif';
    ctx.fillStyle = '#ffd75e';
    ctx.fillText(String(score), DESIGN_W / 2, ty + 45);
    if (newBest) {
      ctx.font = '14px -apple-system,system-ui,sans-serif';
      ctx.fillStyle = '#ff9f43';
      ctx.fillText('新纪录!', DESIGN_W / 2, ty + 70);
    }
    rr(BTN.x, BTN.y, BTN.w, BTN.h, 29);
    ctx.fillStyle = '#2f66e0';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 20px -apple-system,system-ui,sans-serif';
    ctx.fillText('重新开始', DESIGN_W / 2, BTN.y + 37);
  }
  rr(SPEAKER.x, SPEAKER.y, SPEAKER.w, SPEAKER.h, SPEAKER.r);
  ctx.fillStyle = soundOn ? '#1a2452' : '#2a1630';
  ctx.fill();
  ctx.strokeStyle = soundOn ? '#2c3a70' : '#6b2a3a';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '15px sans-serif';
  ctx.fillStyle = soundOn ? '#dfe6ff' : '#ff8a9a';
  ctx.fillText(soundOn ? '🔊' : '🔇', SPEAKER.x + SPEAKER.w / 2 + 0.5, SPEAKER.y + SPEAKER.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function toDesign(e) {
  const rect = canvas.getBoundingClientRect();
  return [(e.clientX - rect.left) / view.scale - view.ox, (e.clientY - rect.top) / view.scale];
}

function inBtn(px, py) {
  return px >= BTN.x && px <= BTN.x + BTN.w && py >= BTN.y && py <= BTN.y + BTN.h;
}
function inSpeaker(px, py) {
  return px >= SPEAKER.x && px <= SPEAKER.x + SPEAKER.w && py >= SPEAKER.y && py <= SPEAKER.y + SPEAKER.h;
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  pressed = true;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  const [px, py] = toDesign(e);
  if (inSpeaker(px, py)) {
    soundOn = !soundOn;
    try { localStorage.setItem('sand-sound', soundOn ? '1' : '0'); } catch (err) {}
    if (soundOn) playClick();
    return;
  }
  if (state === 'over') {
    if (inBtn(px, py)) { playClick(); restart(); }
    return;
  }
  if (state === 'idle') {
    const idx = py >= SLOT_Y && py <= SLOT_Y + SLOT_H
      ? Math.floor((px - SLOT_X0) / (SLOT_W + SLOT_GAP))
      : -1;
    if (idx >= 0 && idx < 3 && queue[idx] && px >= SLOT_X0 + idx * (SLOT_W + SLOT_GAP) && px <= SLOT_X0 + idx * (SLOT_W + SLOT_GAP) + SLOT_W) {
      startAim(idx);
      playClick();
    }
  } else if (state === 'aim') {
    dragging = true;
    updateAim(px);
  }
});

canvas.addEventListener('pointermove', e => {
  if (state !== 'aim' || selSlot < 0) return;
  const [px] = toDesign(e);
  if (pressed) dragging = true;
  updateAim(px);
});

canvas.addEventListener('pointerup', e => {
  pressed = false;
  const [px, py] = toDesign(e);
  if (inSpeaker(px, py)) return;
  if (state === 'over') {
    if (inBtn(px, py)) { playClick(); restart(); }
    return;
  }
  if (state === 'aim' && dragging) confirmDrop();
});

canvas.addEventListener('pointercancel', () => {
  pressed = false;
  dragging = false;
});

function resize() {
  const vv = window.visualViewport;
  const vw = Math.round(vv ? vv.width : window.innerWidth);
  const vh = Math.round(vv ? vv.height : window.innerHeight);
  const cs = getComputedStyle(safeProbe);
  const safeTop = parseFloat(cs.paddingTop) || 0, safeBottom = parseFloat(cs.paddingBottom) || 0;
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(vw / DESIGN_W, (vh - safeTop - safeBottom) / MIN_H);
  view.scale = scale;
  view.w = vw / scale;
  view.h = vh / scale;
  view.ox = (view.w - DESIGN_W) / 2;
  canvas.width = Math.floor(vw * dpr);
  canvas.height = Math.floor(vh * dpr);
  canvas.style.width = canvas.width / dpr + 'px';
  canvas.style.height = canvas.height / dpr + 'px';
  const k = dpr * scale;
  view.k = k;
  view.ex = k * view.ox;
  ctx.setTransform(k, 0, 0, k, view.ex, 0);

  let grainPx = Math.max(1, Math.round(CELL * k));
  if (GW * grainPx / k > BOARD_MAX) grainPx = Math.max(1, grainPx - 1);
  cell = grainPx / k;
  BOARD_W = GW * cell;
  BOARD_H = GH * cell;
  BOARD_X = snapX((DESIGN_W - BOARD_W) / 2);
  if (grainPx !== gridOverlayPx) buildGridOverlay(grainPx);
  layout(safeTop / scale, safeBottom / scale);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

refillQueue();
generateInitialSand();
resize();
let last = performance.now();
requestAnimationFrame(function frame(now) {
  const dt = Math.min(now - last, 50);
  last = now;
  update(dt);
  render(now);
  requestAnimationFrame(frame);
});

if (typeof location !== 'undefined' && location.search.indexOf('debug') >= 0) {
  window.__sandDebug = () => ({ state, score, best, grid, queue, fallings });
}
})();
