(() => {
'use strict';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const DESIGN_W = 440, DESIGN_H = 880;
const GW = 48, GH = 96, CELL = 7;
const BOARD_X = 52, BOARD_Y = 78, BOARD_W = GW * CELL, BOARD_H = GH * CELL;
const DANGER_ROW = 18, CLEAR_MIN = 90, DROP_STEP = 34;
const SLOT_Y = 764, SLOT_H = 100, SLOT_W = 120, SLOT_GAP = 16;
const SLOT_X0 = (DESIGN_W - (SLOT_W * 3 + SLOT_GAP * 2)) / 2;
const BTN = { x: DESIGN_W / 2 - 95, y: 552, w: 190, h: 58 };

const PALETTE = [null,
  ['#4a90e8', '#2c5cb0'],
  ['#e8c94e', '#c2a02c'],
  ['#e04848', '#b02e2e'],
  ['#4db85c', '#2f8f3e'],
  ['#41c3cd', '#2b98a1']
];

const SHAPES = [
  { c: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { c: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { c: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { c: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { c: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { c: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { c: [[1, 0], [1, 1], [1, 2], [0, 2]] }
].map(s => ({
  cells: s.c,
  w: Math.max(...s.c.map(p => p[0])) + 1,
  h: Math.max(...s.c.map(p => p[1])) + 1
}));

let grid = new Uint8Array(GW * GH);
let queue = [];
let selSlot = -1;
let state = 'idle';
let pressed = false, dragging = false;
let active = null, aimCol = 0, prevRow = 0, dropAcc = 0, restCount = 0, parity = 0;
let score = 0, best = 0, newBest = false;
let flashes = [];

try {
  best = parseInt(localStorage.getItem('sand-best'), 10) || 0;
} catch (e) {}

function genPiece() {
  return {
    shape: SHAPES[(Math.random() * SHAPES.length) | 0],
    color: 1 + ((Math.random() * 5) | 0)
  };
}

function refillQueue() {
  while (queue.length < 3) queue.push(genPiece());
}

function saveBest() {
  try {
    localStorage.setItem('sand-best', String(best));
  } catch (e) {}
}

function restart() {
  grid.fill(0);
  score = 0;
  newBest = false;
  flashes.length = 0;
  queue.length = 0;
  refillQueue();
  selSlot = -1;
  active = null;
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

function land() {
  for (const [cx, cy] of active.shape.cells) {
    const gy = active.y + cy;
    if (gy >= 0) grid[gy * GW + active.x + cx] = active.color;
  }
  active = null;
  restCount = 0;
  parity = 0;
  state = 'settle';
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
    while (stack.length) {
      const j = stack.pop();
      reg.push(j);
      const x = j % GW, y = (j / GW) | 0;
      if (x > 0 && !seen[j - 1] && grid[j - 1] === col) { seen[j - 1] = 1; stack.push(j - 1); }
      if (x < GW - 1 && !seen[j + 1] && grid[j + 1] === col) { seen[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && !seen[j - GW] && grid[j - GW] === col) { seen[j - GW] = 1; stack.push(j - GW); }
      if (y < GH - 1 && !seen[j + GW] && grid[j + GW] === col) { seen[j + GW] = 1; stack.push(j + GW); }
    }
    if (reg.length >= CLEAR_MIN) {
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
  state = over ? 'over' : 'idle';
}

function startAim(i) {
  selSlot = i;
  state = 'aim';
  aimCol = (GW - queue[i].shape.w) >> 1;
  dragging = false;
}

function updateAim(px) {
  const sh = queue[selSlot].shape;
  const col = Math.floor((px - BOARD_X) / CELL) - ((sh.w - 1) >> 1);
  aimCol = Math.max(0, Math.min(GW - sh.w, col));
}

function confirmDrop() {
  active = queue[selSlot];
  queue[selSlot] = genPiece();
  active.x = aimCol;
  active.y = -active.shape.h;
  prevRow = active.y;
  dropAcc = 0;
  selSlot = -1;
  dragging = false;
  state = 'drop';
}

function update(dt) {
  if (state === 'drop') {
    dropAcc += dt;
    while (state === 'drop' && dropAcc >= DROP_STEP) {
      dropAcc -= DROP_STEP;
      const ny = active.y + 1;
      if (collides(active.x, ny, active.shape)) {
        land();
        break;
      }
      prevRow = active.y;
      active.y = ny;
    }
  } else if (state === 'settle') {
    for (let s = 0; s < 2; s++) {
      restCount = sandPass() > 0 ? 0 : restCount + 1;
    }
    if (restCount >= 4) checkClear();
  }
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

function render(now) {
  ctx.fillStyle = '#141d40';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  rr(24, 10, 170, 50, 8);
  ctx.fillStyle = '#1a2452';
  ctx.fill();
  ctx.strokeStyle = '#2c3a70';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#93a5dd';
  ctx.font = '12px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('分数', 36, 28);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 22px -apple-system,system-ui,sans-serif';
  ctx.fillText(String(score), 36, 52);

  rr(DESIGN_W - 194, 10, 170, 50, 8);
  ctx.fillStyle = '#1a2452';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#93a5dd';
  ctx.font = '12px -apple-system,system-ui,sans-serif';
  ctx.fillText('最高分', DESIGN_W - 182, 28);
  ctx.fillStyle = '#ffd75e';
  ctx.font = '600 22px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(String(best), DESIGN_W - 38, 52);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#dfe6ff';
  ctx.font = '600 17px -apple-system,system-ui,sans-serif';
  ctx.fillText('沙子俄罗斯方块', DESIGN_W / 2, 42);

  rr(BOARD_X - 6, BOARD_Y - 6, BOARD_W + 12, BOARD_H + 12, 8);
  ctx.fillStyle = '#0e1430';
  ctx.fill();
  ctx.strokeStyle = '#31407a';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H);
  ctx.clip();

  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const c = grid[y * GW + x];
      if (c) drawGrain(x, y, c, CELL);
    }
  }

  for (const f of flashes) {
    const p = f.t / 450;
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = '#ffffff';
    const s = CELL * (1 + p);
    ctx.fillRect(BOARD_X + f.x * CELL + (CELL - s) / 2, BOARD_Y + f.y * CELL - p * 26, s, s);
    ctx.globalAlpha = 1;
  }

  if (state === 'aim') {
    const q = queue[selSlot];
    const sh = q.shape;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(BOARD_X + aimCol * CELL, BOARD_Y, sh.w * CELL, BOARD_H);
    ctx.globalAlpha = 0.35;
    for (const [cx, cy] of sh.cells) {
      drawGrain(aimCol + cx, cy, q.color, CELL);
    }
    ctx.globalAlpha = 1;
  } else if (state === 'drop' && active) {
    const ry = prevRow + (active.y - prevRow) * Math.min(dropAcc / DROP_STEP, 1);
    for (const [cx, cy] of active.shape.cells) {
      drawGrain(active.x + cx, Math.round(ry) + cy, active.color, CELL);
    }
  }

  ctx.restore();

  ctx.fillStyle = '#ff3b30';
  ctx.fillRect(BOARD_X, BOARD_Y + DANGER_ROW * CELL - 1.5, BOARD_W, 3);

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
      const scale = Math.min((SLOT_W - 30) / (sh.w * CELL), (SLOT_H - 30) / (sh.h * CELL));
      const dw = CELL * scale;
      const ox = sx + (SLOT_W - sh.w * dw) / 2;
      const oy = SLOT_Y + (SLOT_H - sh.h * dw) / 2;
      for (const [cx, cy] of sh.cells) {
        ctx.fillStyle = PALETTE[p.color][0];
        ctx.fillRect(ox + cx * dw, oy + cy * dw, dw, dw);
      }
    }
  }

  if (state === 'over') {
    ctx.fillStyle = 'rgba(6,8,20,0.72)';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 34px -apple-system,system-ui,sans-serif';
    ctx.fillText('游戏结束', DESIGN_W / 2, 470);
    ctx.font = '600 26px -apple-system,system-ui,sans-serif';
    ctx.fillStyle = '#ffd75e';
    ctx.fillText(String(score), DESIGN_W / 2, 515);
    if (newBest) {
      ctx.font = '14px -apple-system,system-ui,sans-serif';
      ctx.fillStyle = '#ff9f43';
      ctx.fillText('新纪录!', DESIGN_W / 2, 540);
    }
    rr(BTN.x, BTN.y, BTN.w, BTN.h, 29);
    ctx.fillStyle = '#2f66e0';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 20px -apple-system,system-ui,sans-serif';
    ctx.fillText('重新开始', DESIGN_W / 2, BTN.y + 37);
  }
}

function toDesign(e) {
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / DESIGN_W;
  return [(e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale];
}

function inBtn(px, py) {
  return px >= BTN.x && px <= BTN.x + BTN.w && py >= BTN.y && py <= BTN.y + BTN.h;
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  pressed = true;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  const [px, py] = toDesign(e);
  if (state === 'over') {
    if (inBtn(px, py)) restart();
    return;
  }
  if (state === 'idle') {
    const idx = py >= SLOT_Y
      ? Math.floor((px - SLOT_X0) / (SLOT_W + SLOT_GAP))
      : -1;
    if (idx >= 0 && idx < 3 && px >= SLOT_X0 + idx * (SLOT_W + SLOT_GAP) && px <= SLOT_X0 + idx * (SLOT_W + SLOT_GAP) + SLOT_W) {
      startAim(idx);
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
  if (state === 'over') {
    if (inBtn(px, py)) restart();
    return;
  }
  if (state === 'aim' && dragging) confirmDrop();
});

canvas.addEventListener('pointercancel', () => {
  pressed = false;
  dragging = false;
});

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
  canvas.style.width = DESIGN_W * scale + 'px';
  canvas.style.height = DESIGN_H * scale + 'px';
  canvas.width = Math.round(DESIGN_W * scale * dpr);
  canvas.height = Math.round(DESIGN_H * scale * dpr);
  ctx.setTransform(canvas.width / DESIGN_W, 0, 0, canvas.height / DESIGN_H, 0, 0);
}

window.addEventListener('resize', resize);

refillQueue();
resize();
let last = performance.now();
requestAnimationFrame(function frame(now) {
  const dt = Math.min(now - last, 50);
  last = now;
  update(dt);
  render(now);
  requestAnimationFrame(frame);
});
})();
