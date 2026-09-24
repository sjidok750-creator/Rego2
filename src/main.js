import * as THREE from 'three';
import { World } from './world.js';
import { PIECES, PIECE_BY_ID, CATEGORIES, oriented, rotationMatters, PLATE_H } from './pieces.js';
import { COLORS, colorOf } from './colors.js';
import { Stage } from './renderer.js';
import { AudioEngine } from './audio.js';
import { analyze, stressColor, ISSUE_LABEL } from './structure.js';
import { castGrid, rayBox } from './raycast.js';
import { MODEL_IDS, getModel } from './models.js';
import { makeSteps, stepParts } from './steps.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const coarse = matchMedia('(pointer: coarse)').matches;

const store = {
  get(k) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* 저장 불가 환경 */
    }
  },
};

function detectQuality() {
  const saved = store.get('rego.quality');
  if (saved) return saved;
  if (coarse) return (navigator.deviceMemory || 4) >= 4 ? 'medium' : 'low';
  return 'high';
}

function haptic(ms) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 진동 미지원 */
  }
}

// ── 준비 ───────────────────────────────────────────────
const world = new World({ w: 32, d: 32 });
const stage = new Stage($('#stage'), world, { quality: detectQuality() });
const audio = new AudioEngine();

const state = {
  mode: 'intro',
  tool: 'place',
  piece: 'brick_2x4',
  color: 'red',
  rot: 0,
  cat: 'brick',
  heat: false,
  analysis: null,
  undo: [],
  redo: [],
  cand: null,
  touchCand: null,
  lastPointer: null,
  hoverBrick: null,
  guide: null,
  base: { size: 32, color: 'white' },
  saved: store.get('rego.build.v1'),
  intro: true,
};

stage.setBaseplate({ color: state.base.color, visible: true });

// ── 스냅샷(실행 취소) ───────────────────────────────────
function snapshot() {
  return [...world.bricks.values()].map((b) => [b.id, b.piece, b.x, b.y, b.z, b.rot, b.color]);
}

function commit(prev) {
  state.undo.push(prev);
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  afterChange();
}

function applySnapshot(target) {
  const want = new Map(target.map((r) => [r[0], r]));
  const removed = [];
  for (const b of [...world.bricks.values()]) {
    const r = want.get(b.id);
    if (!r || r[1] !== b.piece || r[2] !== b.x || r[3] !== b.y || r[4] !== b.z || r[5] !== b.rot) {
      world.remove(b.id);
      stage.removeBrick(b.id);
      removed.push(b);
    } else if (r[6] !== b.color) {
      b.color = r[6];
      stage.refreshBrick(b);
    }
  }
  const added = [];
  for (const r of target) {
    if (world.bricks.has(r[0])) continue;
    added.push(world.add({ id: r[0], piece: r[1], x: r[2], y: r[3], z: r[4], rot: r[5], color: r[6] }));
  }
  removed.slice(0, 40).forEach((b) => animatePop(b, { quiet: true }));
  added.forEach((b, i) => {
    if (i < 40) animateDrop(b, { from: 0.5, dur: 150, sound: i === 0, ring: false });
    else stage.addBrick(b);
  });
  if (removed.length) audio.pluck();
}

function undo() {
  if (state.mode !== 'build' || !state.undo.length) return;
  const cur = snapshot();
  applySnapshot(state.undo.pop());
  state.redo.push(cur);
  afterChange();
}

function redo() {
  if (state.mode !== 'build' || !state.redo.length) return;
  const cur = snapshot();
  applySnapshot(state.redo.pop());
  state.undo.push(cur);
  afterChange();
}

let saveTimer = 0;
let anTimer = 0;
function afterChange() {
  updateCount();
  $('#btn-undo').disabled = state.mode !== 'build' || !state.undo.length;
  $('#btn-redo').disabled = state.mode !== 'build' || !state.redo.length;
  clearTimeout(anTimer);
  anTimer = setTimeout(refreshAnalysis, 140);
  stage.clearMarkers();
  if (state.mode === 'build') {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBuild, 600);
  }
}

function saveBuild() {
  if (state.mode !== 'build' || !state.buildActive) return;
  const data = { w: world.w, d: world.d, base: state.base.color, bricks: snapshot().map((r) => r.slice(1)) };
  store.set('rego.build.v1', data);
  state.saved = data;
}

// ── HUD ────────────────────────────────────────────────
function updateCount() {
  const n = world.size;
  $('#count').textContent = n.toLocaleString('ko-KR');
  if (state.mode === 'guide' && state.guide) $('#count-total').textContent = '/ ' + state.guide.model.bricks.length.toLocaleString('ko-KR');
  else $('#count-total').textContent = '';
}

function refreshAnalysis() {
  const a = analyze(world);
  state.analysis = a;
  const bad = a.weak + a.loose;
  $('#weak-count').textContent = bad;
  const st = $('#btn-analyze');
  const crit = a.issues.some((i) => i.severity === 'crit');
  st.classList.toggle('bad', bad > 0 && crit);
  st.classList.toggle('warn', bad > 0 && !crit);
  $('#st-mark use').setAttribute('href', bad ? '#i-cross' : '#i-check');
  $('#st-label').textContent = bad ? (a.loose ? 'LOOSE PART' : 'WEAK JOINT') : world.size ? 'STABLE' : '구조 분석';
  if (state.heat) applyHeat();
}

function applyHeat() {
  if (!state.heat) {
    stage.setColorOverride(null);
    return;
  }
  const a = state.analysis || analyze(world);
  const c = new THREE.Color();
  stage.setColorOverride((b) => {
    const v = a.stress.get(b.id);
    if (v === undefined) return null;
    const [r, g, bl] = stressColor(v);
    return c.setRGB(r, g, bl, THREE.SRGBColorSpace);
  });
}

// ── 애니메이션 ─────────────────────────────────────────
let lastSnapSound = 0;
function impact(b, { sound = true, ring = true, soft = false } = {}) {
  const piece = PIECE_BY_ID[b.piece];
  const o = oriented(piece, b.rot);
  const p = stage.project(b.x + o.w / 2, b.y, b.z + o.d / 2);
  const pan = ((p.x / window.innerWidth) * 2 - 1) * 0.6;
  const now = performance.now();
  if (sound && now - lastSnapSound > 28) {
    lastSnapSound = now;
    audio.snap({ mass: piece.mass, height: b.y, pan, soft });
  }
  if (ring) stage.snapRing(b);
  if (!soft) haptic(piece.mass > 16 ? 16 : 10);
}

function animateDrop(b, { from = 1.1, dur = 230, sound = true, ring = true, soft = false, onLand } = {}) {
  const loose = stage.makeLoose(b);
  let hit = false;
  const tI = 0.62;
  stage.animate(
    dur,
    (t) => {
      let lift = 0, squash = 1;
      if (t < tI) {
        const u = t / tI;
        lift = from * (1 - u * u);
      } else {
        const u = (t - tI) / (1 - tI);
        lift = -0.035 * Math.sin(u * Math.PI) * (1 - u);
        squash = 1 - 0.045 * Math.sin(u * Math.PI) * (1 - 0.5 * u);
        for (const m of loose.userData.mats) m.emissiveIntensity = 0.22 * (1 - u);
      }
      stage.brickMatrix(b, loose.matrix, lift, squash);
      if (!hit && t >= tI) {
        hit = true;
        impact(b, { sound, ring, soft });
      }
    },
    () => {
      stage.disposeLoose(loose);
      if (world.bricks.get(b.id) === b) stage.addBrick(b);
      onLand?.();
    },
  );
}

function animatePop(b, { quiet = false } = {}) {
  const loose = stage.makeLoose(b, { opacity: 0.999 });
  const spin = (Math.random() - 0.5) * 0.5;
  const m = new THREE.Matrix4();
  stage.animate(
    quiet ? 180 : 300,
    (t) => {
      const e = 1 - Math.pow(1 - t, 2.4);
      stage.brickMatrix(b, m, 0.9 * e, 1);
      const s = 1 - 0.35 * e;
      const c = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      m.decompose(c, q, sc);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin * e));
      loose.matrix.compose(c, q, sc.set(s, s, s));
      for (const mt of loose.userData.mats) mt.opacity = 1 - t;
    },
    () => stage.disposeLoose(loose),
  );
}

function animateFalls(falls) {
  let n = 0;
  for (const f of falls) {
    if (f.drop <= 0) continue;
    const h = f.drop * PLATE_H;
    const dur = 160 + 330 * Math.sqrt(h / 4);
    let first = true;
    for (const id of f.ids) {
      const b = world.bricks.get(id);
      if (!b) continue;
      n++;
      stage.removeBrick(id);
      const loose = stage.makeLoose(b);
      stage.animate(
        dur,
        (t) => stage.brickMatrix(b, loose.matrix, h * (1 - t * t)),
        () => {
          stage.disposeLoose(loose);
          if (world.bricks.get(id) === b) stage.addBrick(b);
          if (first) {
            first = false;
            audio.thud();
            haptic(24);
          }
        },
      );
    }
  }
  if (n) toast(`받침이 빠져 ${n}개 부품이 떨어졌어요`);
}

// ── 놓을 자리 계산 ─────────────────────────────────────
function topY() {
  const b = world.bounds();
  return (b ? b.maxY : 0) + 40;
}

function computeCandidate(hit) {
  const piece = PIECE_BY_ID[state.piece];
  const rot = state.rot;
  const o = oriented(piece, rot);
  const ax = Math.floor((o.w - 1) / 2), az = Math.floor((o.d - 1) / 2);
  const [cx, cy, cz] = hit.cell;
  const [nx, ny, nz] = hit.normal;
  let x, y, z;
  let mode = 'top';
  if (hit.ground || ny === 1) {
    x = cx - ax;
    z = cz - az;
    y = hit.ground ? 0 : cy + 1;
  } else if (ny === -1) {
    x = cx - ax;
    z = cz - az;
    y = cy - o.h;
    mode = 'under';
  } else {
    const hb = world.bricks.get(hit.id);
    y = hb ? hb.y : cy;
    mode = 'side';
    if (nx === 1) (x = cx + 1), (z = cz - az);
    else if (nx === -1) (x = cx - o.w), (z = cz - az);
    else if (nz === 1) (z = cz + 1), (x = cx - ax);
    else (z = cz - o.d), (x = cx - ax);
  }
  x = Math.max(0, Math.min(world.w - o.w, x));
  z = Math.max(0, Math.min(world.d - o.d, z));
  if (mode !== 'under') {
    const free = world.liftToFree(state.piece, x, y, z, rot, 60);
    if (free >= 0) y = free;
  }
  y = Math.max(0, y);
  const res = world.check(state.piece, x, y, z, rot);
  return { piece: state.piece, x, y, z, rot, ok: res.ok, reason: res.reason, color: state.color };
}

const sameCand = (a, b) => a && b && a.piece === b.piece && a.x === b.x && a.y === b.y && a.z === b.z && a.rot === b.rot;

function hitAt(cx, cy) {
  return castGrid(world, stage.rayFrom(cx, cy), topY());
}

function updateHover(cx, cy) {
  state.lastPointer = { x: cx, y: cy };
  if (state.mode !== 'build' || state.intro) return;
  const hit = hitAt(cx, cy);
  if (state.tool === 'place') {
    stage.setHover(null);
    if (!hit) {
      state.cand = null;
      stage.hideGhost();
      return;
    }
    const c = computeCandidate(hit);
    if (!sameCand(c, state.cand)) audio.tick();
    state.cand = c;
    stage.setGhost(state.piece, state.color);
    stage.showGhost(c, c.ok, state.color);
  } else {
    stage.hideGhost();
    const b = hit && !hit.ground ? world.bricks.get(hit.id) : null;
    if (b !== state.hoverBrick) {
      state.hoverBrick = b;
      const col = state.tool === 'erase' ? 0xe0442e : state.tool === 'paint' ? new THREE.Color(colorOf(state.color).hex).getHex() : 0x2c6fd6;
      stage.setHover(b, col);
      if (b) audio.tick();
    }
  }
}

const REASON = {
  float: '스터드가 하나도 맞물리지 않아요',
  collide: '다른 부품과 겹쳐요',
  bounds: '바닥판 밖이에요',
};

function tryPlace(c) {
  if (!c) return;
  if (!c.ok) {
    audio.bonk();
    haptic(30);
    toast(REASON[c.reason] || '여기에는 놓을 수 없어요');
    return;
  }
  const prev = snapshot();
  const b = world.place(c.piece, c.x, c.y, c.z, c.rot, state.color);
  if (!b) return;
  animateDrop(b);
  commit(prev);
  if (state.lastPointer) setTimeout(() => refreshCandidate(), 0);
}

function refreshCandidate() {
  if (!state.lastPointer) return;
  updateHover(state.lastPointer.x, state.lastPointer.y);
  if (coarse && state.tool === 'place' && state.touchCand) {
    state.touchCand = state.cand;
    $('#btn-place').hidden = !state.cand;
  }
}

function removeAction(b) {
  const prev = snapshot();
  world.remove(b.id);
  stage.removeBrick(b.id);
  animatePop(b);
  const o = oriented(PIECE_BY_ID[b.piece], b.rot);
  const p = stage.project(b.x + o.w / 2, b.y, b.z + o.d / 2);
  audio.pluck({ pan: ((p.x / window.innerWidth) * 2 - 1) * 0.6 });
  haptic(8);
  const falls = world.settle();
  animateFalls(falls);
  state.hoverBrick = null;
  stage.setHover(null);
  commit(prev);
}

function paintAction(b) {
  if (b.color === state.color) return;
  const prev = snapshot();
  b.color = state.color;
  stage.refreshBrick(b);
  stage.snapRing(b);
  audio.tap();
  haptic(6);
  commit(prev);
}

function pickAction(b) {
  state.piece = b.piece;
  state.color = b.color;
  state.rot = b.rot;
  const cat = PIECE_BY_ID[b.piece].cat;
  if (cat !== state.cat) state.cat = cat;
  audio.tap();
  setTool('place');
  renderPalette();
  toast(`${PIECE_BY_ID[b.piece].name} · ${colorOf(b.color).name}`);
}

// ── 포인터 ─────────────────────────────────────────────
const canvas = $('#stage');
const pointers = new Map();
let tap = null;
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tap = pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType, button: e.button } : null;
  if (stage.controls.autoRotate && state.mode === 'build') stage.controls.autoRotate = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 7) tap = null;
  if (e.pointerType === 'mouse' && !e.buttons) updateHover(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId);
  if (tap && tap.id === e.pointerId && performance.now() - tap.t < 650 && tap.button === 0) onTap(e.clientX, e.clientY, tap.type);
  tap = null;
  if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', (e) => {
  pointers.delete(e.pointerId);
  tap = null;
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') {
    stage.hideGhost();
    state.cand = null;
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function onTap(x, y, type) {
  if (state.intro) return;
  if (state.mode === 'guide') return guideTap(x, y);
  const touch = type !== 'mouse';
  if (state.tool === 'place') {
    updateHover(x, y);
    const c = state.cand;
    if (!c) return;
    if (!touch) return tryPlace(c);
    if (sameCand(c, state.touchCand)) {
      tryPlace(c);
      return;
    }
    state.touchCand = c;
    $('#btn-place').hidden = false;
    if (!c.ok) toast(REASON[c.reason] || '여기에는 놓을 수 없어요');
    return;
  }
  const hit = hitAt(x, y);
  const b = hit && !hit.ground ? world.bricks.get(hit.id) : null;
  if (touch) {
    state.hoverBrick = b;
    stage.setHover(b, state.tool === 'erase' ? 0xe0442e : 0x2c6fd6);
  }
  if (!b) return;
  if (state.tool === 'erase') removeAction(b);
  else if (state.tool === 'paint') paintAction(b);
  else if (state.tool === 'pick') pickAction(b);
}

$('#btn-place').addEventListener('click', () => {
  audio.unlock();
  if (state.touchCand) tryPlace(state.touchCand);
});

// ── 도구/팔레트 UI ─────────────────────────────────────
function setTool(t) {
  state.tool = t;
  for (const b of $$('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  stage.hideGhost();
  stage.setHover(null);
  state.hoverBrick = null;
  state.touchCand = null;
  $('#btn-place').hidden = true;
  if (state.lastPointer && !coarse) updateHover(state.lastPointer.x, state.lastPointer.y);
}
for (const b of $$('.tool')) b.addEventListener('click', () => {
  audio.unlock();
  audio.tap();
  setTool(b.dataset.tool);
});

function rotate() {
  const piece = PIECE_BY_ID[state.piece];
  if (!rotationMatters(piece)) return;
  state.rot = (state.rot + 1) % 4;
  audio.tap();
  if (coarse && state.touchCand && state.lastPointer) {
    updateHover(state.lastPointer.x, state.lastPointer.y);
    state.touchCand = state.cand;
  } else if (state.lastPointer) updateHover(state.lastPointer.x, state.lastPointer.y);
}
$('#btn-rotate').addEventListener('click', () => {
  audio.unlock();
  rotate();
});

const thumbCache = new Map();
function thumbsFor(reqs, size = 96) {
  const need = reqs.filter((r) => !thumbCache.has(r.pieceId + '|' + r.colorId + '|' + size));
  if (need.length) {
    const urls = stage.pieceThumbs(need, size);
    need.forEach((r, i) => thumbCache.set(r.pieceId + '|' + r.colorId + '|' + size, urls[i]));
  }
  return reqs.map((r) => thumbCache.get(r.pieceId + '|' + r.colorId + '|' + size));
}

function renderCats() {
  const el = $('#cats');
  el.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'cat';
    b.role = 'tab';
    b.textContent = c.name;
    b.setAttribute('aria-selected', String(c.id === state.cat));
    b.addEventListener('click', () => {
      state.cat = c.id;
      audio.tap();
      renderCats();
      renderPieces();
    });
    el.appendChild(b);
  }
}

function pieceColorForThumb(p) {
  // 투명 색은 부품 아이콘에서 알아보기 어려워 살짝 보정
  return state.color;
}

function renderPieces() {
  const el = $('#pieces');
  el.innerHTML = '';
  const list = PIECES.filter((p) => p.cat === state.cat);
  const urls = thumbsFor(list.map((p) => ({ pieceId: p.id, colorId: pieceColorForThumb(p) })));
  list.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'piece';
    b.title = p.name;
    b.setAttribute('aria-pressed', String(p.id === state.piece));
    const img = document.createElement('img');
    img.src = urls[i];
    img.alt = p.name;
    const label = document.createElement('span');
    label.textContent = p.name.replace(/^[^0-9]*/, '') || p.name;
    b.append(img, label);
    b.addEventListener('click', () => {
      state.piece = p.id;
      if (!rotationMatters(p)) state.rot = 0;
      audio.unlock();
      audio.tap();
      if (state.tool !== 'place') setTool('place');
      for (const x of el.children) x.setAttribute('aria-pressed', String(x === b));
      updateCurrent();
      refreshCandidate();
    });
    el.appendChild(b);
  });
  updateCurrent();
}

function renderSwatches() {
  const el = $('#swatches');
  el.innerHTML = '';
  let prevCls = 'solid';
  for (const c of COLORS) {
    if (c.cls !== prevCls) {
      const s = document.createElement('span');
      s.className = 'sw-sep';
      el.appendChild(s);
      prevCls = c.cls;
    }
    const b = document.createElement('button');
    b.className = 'sw ' + c.cls;
    b.style.background = c.hex;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.setAttribute('aria-pressed', String(c.id === state.color));
    b.addEventListener('click', () => {
      state.color = c.id;
      audio.unlock();
      audio.tap();
      for (const x of el.querySelectorAll('.sw')) x.setAttribute('aria-pressed', String(x === b));
      if (state.tool === 'pick' || state.tool === 'erase') setTool('paint');
      renderPieces();
      stage.setGhost(state.piece, state.color);
      refreshCandidate();
    });
    el.appendChild(b);
  }
}

function updateCurrent() {
  const p = PIECE_BY_ID[state.piece];
  $('#current-img').src = thumbsFor([{ pieceId: p.id, colorId: state.color }])[0];
  $('#current-name').textContent = p.name;
  $('#current-color').textContent = colorOf(state.color).name;
  $('#btn-rotate').disabled = !rotationMatters(p);
}

function renderPalette() {
  renderCats();
  renderPieces();
  renderSwatches();
}

// ── 설명서(가이드) 모드 ─────────────────────────────────
function modelBounds(m) {
  let b = null;
  for (const [pid, x, y, z, rot] of m.bricks) {
    const o = oriented(PIECE_BY_ID[pid], rot);
    if (!b) b = { minX: x, minY: y, minZ: z, maxX: x + o.w, maxY: y + o.h, maxZ: z + o.d };
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.minZ = Math.min(b.minZ, z);
    b.maxX = Math.max(b.maxX, x + o.w);
    b.maxY = Math.max(b.maxY, y + o.h);
    b.maxZ = Math.max(b.maxZ, z + o.d);
  }
  return b;
}

function stashBuild() {
  if (state.mode === 'build') {
    saveBuild();
  }
}

function openGuide(id, { autoplay = false, complete = false } = {}) {
  stopPlay();
  stashBuild();
  const m = getModel(id);
  state.mode = 'guide';
  clearScene();
  world.resize(m.w, m.d);
  stage.setBaseplate({ visible: false });
  const g = { model: m, steps: makeSteps(m.bricks), step: 0, idOf: new Map(), hints: [], playing: false, speed: state.speed || 2 };
  state.guide = g;
  $('#hud-model').hidden = false;
  $('#hud-model').innerHTML = `<b>${m.name}</b>${m.bricks.length}개 부품 · ${g.steps.length}단계`;
  setModeUI();
  if (complete) {
    for (let i = 0; i < m.bricks.length; i++) placeModelBrick(i, { instant: true });
    g.step = g.steps.length;
  }
  stage.frameBounds(modelBounds(m), { instant: complete });
  renderStep();
  afterChange();
  if (autoplay) setTimeout(() => startPlay(), 500);
}

function clearScene() {
  world.clear();
  stage.clearBricks();
  stage.clearMarkers();
  clearHints();
  stage.hideGhost();
  stage.setHover(null);
  state.undo = [];
  state.redo = [];
  $('#analysis').hidden = true;
}

function placeModelBrick(i, { instant = false, from = 1.4, dur = 240, soft = false } = {}) {
  const g = state.guide;
  if (g.idOf.has(i)) return null;
  const [piece, x, y, z, rot, color] = g.model.bricks[i];
  const b = world.place(piece, x, y, z, rot, color) || world.place(piece, x, y, z, rot, color, { force: true });
  g.idOf.set(i, b.id);
  if (instant) stage.addBrick(b);
  else animateDrop(b, { from, dur, soft, ring: dur > 150 });
  return b;
}

function unplaceModelBrick(i) {
  const g = state.guide;
  const id = g.idOf.get(i);
  if (id === undefined) return;
  const b = world.remove(id);
  stage.removeBrick(id);
  g.idOf.delete(i);
  if (b) animatePop(b, { quiet: true });
}

function clearHints() {
  const g = state.guide;
  if (!g) return;
  for (const h of g.hints) stage.disposeHint(h.obj);
  g.hints = [];
}

function renderStep() {
  const g = state.guide;
  if (!g) return;
  clearHints();
  const total = g.steps.length;
  const cur = Math.min(g.step, total - 1);
  const done = g.step >= total;
  $('#step-num').textContent = done ? '✓' : g.step + 1;
  $('#step-text').textContent = done ? `완성 · ${total}단계` : `${g.step + 1} / ${total}`;
  $('#progress-bar').style.width = `${(Math.min(g.step, total) / total) * 100}%`;
  $('#step-prev').disabled = g.step === 0 && !g.steps[0].some((i) => g.idOf.has(i));
  $('#step-next').disabled = done;
  const partsEl = $('#step-parts');
  partsEl.innerHTML = '';
  if (!done) {
    const idxs = g.steps[cur].filter((i) => !g.idOf.has(i));
    const parts = stepParts(g.model.bricks, g.steps[cur]);
    const urls = thumbsFor(parts.map((p) => ({ pieceId: p.piece, colorId: p.color })), 72);
    parts.forEach((p, k) => {
      const d = document.createElement('div');
      d.className = 'part';
      d.title = `${PIECE_BY_ID[p.piece].name} · ${colorOf(p.color).name}`;
      d.innerHTML = `<img alt="" src="${urls[k]}"><b>${p.n}×</b>`;
      partsEl.appendChild(d);
    });
    if (!g.playing) {
      for (const i of idxs) {
        const [piece, x, y, z, rot, color] = g.model.bricks[i];
        g.hints.push({ i, obj: stage.makeHint({ piece, x, y, z, rot, color }) });
      }
    }
    $('#guide-hint').textContent = g.playing ? '자동 조립 중 — 화면을 드래그해 둘러볼 수 있어요.' : '반투명한 자리를 눌러 부품을 끼우거나 ▶로 다음 단계를 한 번에 조립하세요.';
  } else {
    partsEl.innerHTML = `<div class="part done"><b>완성!</b></div>`;
    $('#guide-hint').textContent = '모든 단계를 마쳤어요. 구조 분석으로 튼튼한지 확인해 보세요.';
  }
}

function guideTap(x, y) {
  const g = state.guide;
  if (!g || g.playing || !g.hints.length) return;
  const ray = stage.rayFrom(x, y);
  const hits = [];
  for (const h of g.hints) {
    const t = rayBox(ray, h.obj.userData.min, h.obj.userData.max);
    if (t !== null) hits.push([t, h]);
  }
  if (!hits.length) return;
  hits.sort((a, b) => a[0] - b[0]);
  // 겹쳐 보이면 지금 끼울 수 있는 것 중 가장 앞쪽
  const ready = (h) => {
    const [piece, bx, by, bz, rot] = g.model.bricks[h.i];
    return world.check(piece, bx, by, bz, rot).ok;
  };
  const best = hits.map((e) => e[1]).find(ready);
  if (!best) {
    audio.bonk();
    toast('먼저 아래쪽 부품을 끼워 주세요');
    return;
  }
  stage.disposeHint(best.obj);
  g.hints = g.hints.filter((h) => h !== best);
  placeModelBrick(best.i);
  afterChange();
  if (!g.hints.length) {
    setTimeout(() => {
      g.step++;
      audio.bell(84, { gain: 0.06, decay: 0.8 });
      renderStep();
      finishCheck();
    }, 260);
  }
}

function stepNext() {
  const g = state.guide;
  if (!g || g.step >= g.steps.length) return;
  audio.unlock();
  const idxs = g.steps[g.step].filter((i) => !g.idOf.has(i));
  clearHints();
  idxs.forEach((i, k) => setTimeout(() => {
    placeModelBrick(i);
    afterChange();
  }, k * 90));
  g.step++;
  setTimeout(() => {
    renderStep();
    finishCheck();
  }, idxs.length * 90 + 60);
}

function stepPrev() {
  const g = state.guide;
  if (!g) return;
  stopPlay();
  audio.unlock();
  const cur = g.steps[Math.min(g.step, g.steps.length - 1)];
  const partial = g.step < g.steps.length && cur.some((i) => g.idOf.has(i));
  if (!partial) {
    if (g.step === 0) return;
    g.step--;
  }
  const idxs = g.steps[g.step].filter((i) => g.idOf.has(i)).reverse();
  for (const i of idxs) unplaceModelBrick(i);
  if (idxs.length) audio.pluck();
  renderStep();
  afterChange();
}

let playTimer = 0;
function startPlay() {
  const g = state.guide;
  if (!g) return;
  audio.unlock();
  if (g.step >= g.steps.length) {
    // 처음부터 다시
    clearScene();
    g.idOf.clear();
    g.step = 0;
    afterChange();
  }
  g.playing = true;
  clearHints();
  stage.controls.autoRotate = true;
  stage.controls.autoRotateSpeed = 0.55;
  $('#play-icon use').setAttribute('href', '#i-pause');
  $('#play-label').textContent = '일시 정지';
  renderStep();
  let lastRender = 0;
  const tick = () => {
    if (!g.playing) return;
    const idxs = g.steps[g.step]?.filter((i) => !g.idOf.has(i)) || [];
    if (!idxs.length) {
      g.step++;
      if (g.step >= g.steps.length) {
        stopPlay();
        renderStep();
        finishCheck(true);
        return;
      }
      const now = performance.now();
      if (now - lastRender > 120) {
        renderStep();
        lastRender = now;
      }
      playTimer = setTimeout(tick, 60 / g.speed);
      return;
    }
    const fast = g.speed >= 4;
    placeModelBrick(idxs[0], { from: fast ? 2.2 : 1.8, dur: fast ? 170 : 240, soft: fast && Math.random() < 0.5 });
    updateCount();
    playTimer = setTimeout(tick, 170 / g.speed);
  };
  tick();
}

function stopPlay() {
  const g = state.guide;
  clearTimeout(playTimer);
  if (!g || !g.playing) return;
  g.playing = false;
  stage.controls.autoRotate = false;
  $('#play-icon use').setAttribute('href', '#i-play');
  $('#play-label').textContent = '자동 조립';
  renderStep();
  afterChange();
}

function finishCheck(fromPlay = false) {
  const g = state.guide;
  if (!g || g.step < g.steps.length) return;
  setTimeout(() => runScan(), fromPlay ? 500 : 300);
}

$('#step-next').addEventListener('click', () => {
  stopPlay();
  stepNext();
});
$('#step-prev').addEventListener('click', stepPrev);
$('#btn-play').addEventListener('click', () => {
  if (state.guide?.playing) stopPlay();
  else startPlay();
});
function setSpeed(v) {
  state.speed = v;
  for (const x of $$('#speeds button')) x.setAttribute('aria-pressed', String(Number(x.dataset.speed) === v));
  if (state.guide) state.guide.speed = v;
}
for (const b of $$('#speeds button')) {
  b.addEventListener('click', () => {
    setSpeed(Number(b.dataset.speed));
    audio.tap();
  });
}

// ── 모드 전환 ──────────────────────────────────────────
function setModeUI() {
  const guide = state.mode === 'guide';
  $('#mode-build').setAttribute('aria-pressed', String(!guide));
  $('#mode-guide').setAttribute('aria-pressed', String(guide));
  $('#dock-build').hidden = guide;
  $('#dock-guide').hidden = !guide;
  $('#hud-model').hidden = !guide;
  $('#btn-place').hidden = true;
  stage.hideGhost();
  stage.setHover(null);
  requestAnimationFrame(measureDock);
}

function enterBuild(data = state.saved) {
  stopPlay();
  state.mode = 'build';
  state.buildActive = true;
  clearScene();
  state.guide = null;
  const size = data?.w || state.base.size;
  world.resize(data?.w || size, data?.d || size);
  state.base.color = data?.base || state.base.color;
  stage.setBaseplate({ visible: true, color: state.base.color });
  if (data?.bricks) {
    for (const [piece, x, y, z, rot, color] of data.bricks) {
      const b = world.place(piece, x, y, z, rot, color) || world.place(piece, x, y, z, rot, color, { force: true });
      if (b) stage.addBrick(b);
    }
  }
  setModeUI();
  stage.frameBounds(world.bounds() || { minX: 0, minY: 0, minZ: 0, maxX: world.w, maxY: 6, maxZ: world.d }, { polar: 0.92 });
  afterChange();
}

$('#mode-build').addEventListener('click', () => {
  audio.unlock();
  audio.whoosh();
  if (state.mode !== 'build') enterBuild();
});
$('#mode-guide').addEventListener('click', () => {
  audio.unlock();
  audio.whoosh();
  if (state.mode !== 'guide') openGuide(state.lastModel || 'oldtown');
});

// ── 구조 분석 ──────────────────────────────────────────
function runScan() {
  audio.unlock();
  const a = analyze(world);
  state.analysis = a;
  refreshAnalysis();
  if (!world.size) {
    toast('분석할 부품이 없어요');
    return;
  }
  $('#analysis').hidden = true;
  audio.scanSweep(1.5);
  let pings = 0;
  stage.scan(a, {
    onPing: (y, weak) => {
      if (weak || pings++ % 5 === 0) audio.ping(y, weak);
    },
    onDone: () => {
      audio.result(a.issues.length === 0);
      showAnalysis(a);
    },
  });
}

function showAnalysis(a) {
  const el = $('#analysis');
  const bad = a.issues.length;
  $('#an-title').textContent = bad ? `약한 연결 ${bad}곳` : '튼튼해요';
  const joints = a.joints.length;
  const avg = a.joints.reduce((s, j) => s + j.s, 0) / Math.max(1, joints);
  $('#an-stats').innerHTML = `
    <div class="an-stat"><b>${a.count}</b><span>부품</span></div>
    <div class="an-stat"><b>${joints}</b><span>결합부</span></div>
    <div class="an-stat"><b>${avg.toFixed(1)}</b><span>평균 스터드</span></div>`;
  const list = $('#an-list');
  list.innerHTML = '';
  if (!bad) {
    list.innerHTML = `<li class="ok"><svg><use href="#i-check"/></svg>모든 부품이 바닥까지 단단히 연결되어 있어요.</li>`;
  }
  for (const it of a.issues.slice(0, 30)) {
    const li = document.createElement('li');
    li.className = it.severity;
    const names = it.bricks.map((id) => PIECE_BY_ID[world.bricks.get(id)?.piece]?.name).filter(Boolean);
    li.innerHTML = `<button><span class="sev"></span><span><b>${ISSUE_LABEL[it.type]}</b><small>${names[0] || ''} · 높이 ${Math.round(it.at[1] / 3)}단</small></span><span class="ratio">${it.type === 'loose' ? '—' : '×' + it.ratio.toFixed(1)}</span></button>`;
    li.querySelector('button').addEventListener('click', () => {
      const [x, y, z] = it.at;
      stage.frameBounds({ minX: x - 5, minY: Math.max(0, y - 8), minZ: z - 5, maxX: x + 5, maxY: y + 8, maxZ: z + 5 });
      const b = world.bricks.get(it.bricks[0]);
      if (b) stage.setHover(b, it.severity === 'crit' ? 0xcc3f2c : 0xdf7f22);
      audio.tap();
    });
    list.appendChild(li);
  }
  el.hidden = false;
}

$('#btn-analyze').addEventListener('click', runScan);
$('#an-close').addEventListener('click', () => {
  $('#analysis').hidden = true;
  stage.clearMarkers();
  stage.setHover(null);
});

// ── 레일 ───────────────────────────────────────────────
function focusAll() {
  const b = world.bounds() || (state.mode === 'build' ? { minX: 0, minY: 0, minZ: 0, maxX: world.w, maxY: 6, maxZ: world.d } : null);
  stage.frameBounds(b);
  audio.whoosh(false);
}
$('#btn-focus').addEventListener('click', focusAll);
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
function toggleHeat() {
  state.heat = !state.heat;
  $('#btn-heat').setAttribute('aria-pressed', String(state.heat));
  if (state.heat && !state.analysis) state.analysis = analyze(world);
  applyHeat();
  audio.tap();
  toast(state.heat ? '하중 히트맵: 파랑은 여유, 빨강은 한계' : '원래 색으로 돌아왔어요');
}
$('#btn-heat').addEventListener('click', toggleHeat);
$('#btn-shot').addEventListener('click', () => {
  const url = stage.screenshot();
  audio.tap();
  dialog({
    title: '스크린샷',
    body: '이미지를 길게 누르거나 오른쪽 클릭해 저장하세요.',
    img: url,
    ok: '내려받기',
    onOk: () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rego-brick.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
  });
});

// ── 소리 토글 ──────────────────────────────────────────
function syncSoundButtons() {
  $('#btn-music').setAttribute('aria-pressed', String(audio.musicOn));
  $('#btn-sfx').setAttribute('aria-pressed', String(audio.sfxOn));
  $('#menu-music').setAttribute('aria-pressed', String(audio.musicOn));
  $('#menu-sfx').setAttribute('aria-pressed', String(audio.sfxOn));
}
$('#menu-music').addEventListener('click', () => $('#btn-music').click());
$('#menu-sfx').addEventListener('click', () => $('#btn-sfx').click());
$('#btn-music').addEventListener('click', () => {
  audio.unlock();
  audio.setMusic(!audio.musicOn);
  store.set('rego.music', audio.musicOn);
  syncSoundButtons();
  toast(audio.musicOn ? '음악을 켰어요' : '음악을 껐어요');
});
$('#btn-sfx').addEventListener('click', () => {
  audio.unlock();
  audio.setSfx(!audio.sfxOn);
  store.set('rego.sfx', audio.sfxOn);
  syncSoundButtons();
  if (audio.sfxOn) audio.tap();
});
{
  const m = store.get('rego.music');
  const s = store.get('rego.sfx');
  if (m === false) audio.musicOn = false;
  if (s === false) audio.sfxOn = false;
  syncSoundButtons();
}

// ── 갤러리 ─────────────────────────────────────────────
const modelInfo = new Map();
function modelMeta(id) {
  if (modelInfo.has(id)) return modelInfo.get(id);
  const m = getModel(id);
  const w = new World({ w: m.w, d: m.d });
  for (const [p, x, y, z, r, c] of m.bricks) w.place(p, x, y, z, r, c, { force: true });
  const a = analyze(w);
  const info = { m, weak: a.issues.length, thumb: null };
  modelInfo.set(id, info);
  return info;
}

function openGallery() {
  audio.unlock();
  audio.whoosh();
  stopPlay();
  const el = $('#cards');
  el.innerHTML = '';
  const newCard = document.createElement('article');
  newCard.className = 'card new';
  newCard.innerHTML = `<div class="card-img"><svg><use href="#i-brick"/></svg></div><div class="card-body"><h3>빈 바닥판</h3><p>처음부터 자유롭게 만들어요.</p><div class="card-actions"><button class="btn small primary" data-act="new">새로 시작</button>${state.saved?.bricks?.length ? '<button class="btn small" data-act="continue">이어서 만들기</button>' : ''}</div></div>`;
  newCard.querySelector('[data-act="new"]').addEventListener('click', () => {
    closeModal('#gallery');
    enterBuild({ w: state.base.size, d: state.base.size, base: state.base.color, bricks: [] });
  });
  newCard.querySelector('[data-act="continue"]')?.addEventListener('click', () => {
    closeModal('#gallery');
    enterBuild(state.saved);
  });
  el.appendChild(newCard);
  const pending = [];
  for (const id of MODEL_IDS) {
    const info = modelMeta(id);
    const { m } = info;
    const card = document.createElement('article');
    card.className = 'card';
    const ok = info.weak === 0;
    card.innerHTML = `
      <div class="card-img"><img alt="${m.name} 미리보기"><span class="badge"><svg><use href="#i-warn"/></svg>${info.weak}<svg class="${ok ? 'ok' : 'bad'}"><use href="${ok ? '#i-check' : '#i-cross'}"/></svg></span></div>
      <div class="card-body">
        <span class="card-meta">${m.en.toUpperCase()} · ${m.bricks.length} PCS</span>
        <h3>${m.name}</h3>
        <p>${m.desc}</p>
        <div class="card-actions">
          <button class="btn small primary" data-act="play"><svg><use href="#i-play"/></svg>자동 조립</button>
          <button class="btn small" data-act="guide">설명서</button>
          <button class="btn small" data-act="edit">편집</button>
        </div>
      </div>`;
    const img = card.querySelector('img');
    if (info.thumb) img.src = info.thumb;
    else pending.push([info, img]);
    card.querySelector('[data-act="play"]').addEventListener('click', () => {
      closeModal('#gallery');
      state.lastModel = id;
      openGuide(id, { autoplay: true });
    });
    card.querySelector('[data-act="guide"]').addEventListener('click', () => {
      closeModal('#gallery');
      state.lastModel = id;
      openGuide(id);
    });
    card.querySelector('[data-act="edit"]').addEventListener('click', () => {
      closeModal('#gallery');
      enterBuild({ w: m.w, d: m.d, base: 'white', bricks: m.bricks });
      toast(`${m.name}을(를) 자유 조립으로 불러왔어요`);
    });
    el.appendChild(card);
  }
  $('#gallery').hidden = false;
  // 썸네일은 하나씩 천천히
  const next = () => {
    const job = pending.shift();
    if (!job) return;
    const [info, img] = job;
    info.thumb = stage.modelThumb(info.m);
    img.src = info.thumb;
    setTimeout(next, 30);
  };
  setTimeout(next, 60);
}
$('#open-gallery').addEventListener('click', openGallery);
$('#gallery-close').addEventListener('click', () => closeModal('#gallery'));

function closeModal(sel) {
  $(sel).hidden = true;
}
for (const m of $$('.modal')) {
  m.addEventListener('click', (e) => {
    if (e.target === m) m.hidden = true;
  });
}

// ── 설정 메뉴 ──────────────────────────────────────────
function renderMenu() {
  for (const b of $$('#quality button')) b.setAttribute('aria-pressed', String(b.dataset.q === stage.qualityName));
  for (const b of $$('#base-size button')) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === world.w && world.w === world.d));
  const bc = $('#base-colors');
  bc.innerHTML = '';
  for (const id of ['white', 'lbg', 'dbg', 'tan', 'bgreen', 'sandblue', 'azure', 'black']) {
    const c = colorOf(id);
    const b = document.createElement('button');
    b.className = 'sw';
    b.style.background = c.hex;
    b.title = c.name;
    b.setAttribute('aria-pressed', String(id === state.base.color));
    b.addEventListener('click', () => {
      state.base.color = id;
      stage.setBaseplate({ color: id });
      renderMenu();
      saveBuild();
    });
    bc.appendChild(b);
  }
  $('#music-vol').value = Math.round(audio.musicVol * 100);
}
$('#btn-menu').addEventListener('click', () => {
  audio.unlock();
  audio.tap();
  renderMenu();
  $('#menu').hidden = false;
});
$('#menu-close').addEventListener('click', () => closeModal('#menu'));
$('#music-vol').addEventListener('input', (e) => audio.setMusicVolume(Number(e.target.value) / 100));
for (const b of $$('#quality button')) {
  b.addEventListener('click', () => {
    stage.setQuality(b.dataset.q);
    store.set('rego.quality', b.dataset.q);
    renderMenu();
    thumbCache.clear();
    renderPieces();
  });
}
for (const b of $$('#base-size button')) {
  b.addEventListener('click', () => {
    if (state.mode !== 'build') enterBuild();
    const n = Number(b.dataset.size);
    const bb = world.bounds();
    if (bb && (bb.maxX > n || bb.maxZ > n)) {
      toast('부품이 바닥판 밖으로 나가서 줄일 수 없어요');
      return;
    }
    state.base.size = n;
    const prev = snapshot();
    world.resize(n, n);
    stage.setBaseplate({});
    // 좌표계 중심이 바뀌므로 다시 그림
    stage.clearBricks();
    for (const b2 of world.bricks.values()) stage.addBrick(b2);
    commit(prev);
    focusAll();
    renderMenu();
  });
}
$('#act-new').addEventListener('click', () => {
  closeModal('#menu');
  dialog({
    title: '새로 만들까요?',
    body: '지금 바닥판의 부품을 모두 치웁니다. 실행 취소로 되돌릴 수 있어요.',
    ok: '모두 치우기',
    onOk: () => {
      if (state.mode !== 'build') return enterBuild({ w: state.base.size, d: state.base.size, base: state.base.color, bricks: [] });
      const prev = snapshot();
      const all = [...world.bricks.values()];
      for (const b of all) {
        world.remove(b.id);
        stage.removeBrick(b.id);
      }
      all.slice(0, 60).forEach((b) => animatePop(b, { quiet: true }));
      audio.whoosh(false);
      commit(prev);
    },
  });
});
$('#act-export').addEventListener('click', async () => {
  const code = JSON.stringify({ v: 1, w: world.w, d: world.d, base: state.base.color, b: snapshot().map((r) => r.slice(1)) });
  try {
    await navigator.clipboard.writeText(code);
    toast('작품 코드를 복사했어요');
  } catch {
    closeModal('#menu');
    dialog({ title: '작품 코드', body: '아래 코드를 복사해 두세요.', text: code, ok: '닫기' });
  }
});
$('#act-import').addEventListener('click', () => {
  closeModal('#menu');
  dialog({
    title: '작품 코드 붙여넣기',
    body: '복사해 둔 작품 코드를 붙여넣으세요.',
    text: '',
    editable: true,
    ok: '불러오기',
    onOk: (txt) => {
      try {
        const d = JSON.parse(txt);
        const bricks = (d.b || d.bricks || []).filter((r) => PIECE_BY_ID[r[0]]);
        enterBuild({ w: d.w || 32, d: d.d || 32, base: d.base || 'white', bricks });
        toast(`${bricks.length}개 부품을 불러왔어요`);
      } catch {
        toast('코드를 읽을 수 없어요. 전체를 복사했는지 확인해 주세요.');
      }
    },
  });
});

// ── 대화상자/토스트 ────────────────────────────────────
function dialog({ title, body, text, editable = false, img, ok = '확인', cancel = '취소', onOk }) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').textContent = body || '';
  const ta = $('#dialog-text');
  ta.hidden = text === undefined;
  ta.value = text || '';
  ta.readOnly = !editable;
  const im = $('#dialog-img');
  im.hidden = !img;
  if (img) im.src = img;
  $('#dialog-ok').textContent = ok;
  $('#dialog-cancel').textContent = cancel;
  $('#dialog').hidden = false;
  const done = (accept) => {
    $('#dialog').hidden = true;
    $('#dialog-ok').onclick = null;
    $('#dialog-cancel').onclick = null;
    if (accept) onOk?.(ta.value);
  };
  $('#dialog-ok').onclick = () => done(true);
  $('#dialog-cancel').onclick = () => done(false);
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── 키보드 ─────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'escape') {
    for (const m of $$('.modal')) m.hidden = true;
    $('#analysis').hidden = true;
    stage.clearMarkers();
  }
  if (state.intro) return;
  if (state.mode === 'build') {
    if (k === 'r') rotate();
    else if (k === 'b') setTool('place');
    else if (k === 'e') setTool('erase');
    else if (k === 'p') setTool('paint');
    else if (k === 'i') setTool('pick');
  } else {
    if (e.key === 'ArrowRight') {
      stopPlay();
      stepNext();
    } else if (e.key === 'ArrowLeft') stepPrev();
    else if (k === ' ') {
      e.preventDefault();
      if (state.guide?.playing) stopPlay();
      else startPlay();
    }
  }
  if (k === 'f') focusAll();
  else if (k === 'h') toggleHeat();
  else if (k === 'a') runScan();
});

// ── 레이아웃 보정 ──────────────────────────────────────
function measureDock() {
  const d = state.mode === 'guide' ? $('#dock-guide') : $('#dock-build');
  const h = d.hidden ? 0 : d.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--dock-h', h + 'px');
  // 도크에 가려지지 않도록 카메라 시점을 살짝 위로
  stage.viewOffsetY = h;
}
new ResizeObserver(measureDock).observe($('#dock-build'));
new ResizeObserver(measureDock).observe($('#dock-guide'));

// ── 시작 화면 ──────────────────────────────────────────
function leaveIntro() {
  state.intro = false;
  document.body.classList.remove('intro-on');
  const el = $('#intro');
  el.classList.add('out');
  setTimeout(() => (el.hidden = true), 520);
  stage.controls.autoRotate = false;
}

$('#start-watch').addEventListener('click', () => {
  audio.unlock();
  leaveIntro();
  state.lastModel = 'oldtown';
  setSpeed(4);
  openGuide('oldtown', { autoplay: true });
});
$('#start-build').addEventListener('click', () => {
  audio.unlock();
  leaveIntro();
  enterBuild({ w: 32, d: 32, base: state.base.color, bricks: [] });
});
if (state.saved?.bricks?.length) {
  $('#start-continue').hidden = false;
  $('#start-continue').addEventListener('click', () => {
    audio.unlock();
    leaveIntro();
    enterBuild(state.saved);
  });
}

// 초기 화면: 완성된 구시가지가 천천히 돈다
renderPalette();
openGuide('oldtown', { complete: true });
stage.controls.autoRotate = true;
stage.controls.autoRotateSpeed = 0.5;
refreshAnalysis();

// 디버그/테스트용
window.__rego = { world, stage, state, audio, openGuide, enterBuild, runScan, startPlay, stopPlay, leaveIntro };
