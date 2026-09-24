// 부품 카탈로그. 모든 치수는 격자 단위:
//  - 가로(x) w, 세로(z) d : 스터드 개수 (1 스터드 = 8mm)
//  - 높이 h : 플레이트 개수 (1 플레이트 = 3.2mm, 브릭 = 3 플레이트)
// studs   : 윗면 스터드 위치 [x, z]
// sockets : 아랫면에서 스터드를 물 수 있는 위치 [x, z]
// cells   : 차지하는 격자 칸 [x, y, z]
// shape   : 형상 생성기(geometry.js)가 해석하는 설명

export const STUD = 1; // 월드 단위 1 = 8mm
export const PLATE_H = 0.4; // 3.2mm / 8mm

function grid(w, d) {
  const out = [];
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) out.push([x, z]);
  return out;
}

function boxCells(w, d, h) {
  const out = [];
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) out.push([x, y, z]);
  return out;
}

const LIST = [];

function add(p) {
  p.studs = p.studs ?? grid(p.w, p.d);
  p.sockets = p.sockets ?? grid(p.w, p.d);
  p.cells = p.cells ?? boxCells(p.w, p.d, p.h);
  p.mass = p.mass ?? p.cells.length * (p.massFactor ?? 1);
  LIST.push(p);
  return p;
}

const dims = (w, d) => (w === d ? `${w}×${d}` : `${Math.min(w, d)}×${Math.max(w, d)}`);

// ── 브릭 ────────────────────────────────────────────────
for (const [w, d] of [[1, 1], [2, 1], [3, 1], [4, 1], [6, 1], [8, 1], [2, 2], [3, 2], [4, 2], [6, 2], [8, 2]]) {
  add({ id: `brick_${d}x${w}`, name: `브릭 ${dims(w, d)}`, cat: 'brick', w, d, h: 3, shape: { type: 'box' } });
}

// ── 플레이트 ────────────────────────────────────────────
for (const [w, d] of [[1, 1], [2, 1], [3, 1], [4, 1], [6, 1], [8, 1], [2, 2], [3, 2], [4, 2], [6, 2], [8, 2], [4, 4], [6, 4], [8, 4], [6, 6], [8, 6], [8, 8], [16, 8], [16, 16]]) {
  add({ id: `plate_${d}x${w}`, name: `플레이트 ${dims(w, d)}`, cat: 'plate', w, d, h: 1, shape: { type: 'box' } });
}

// ── 타일(스터드 없음) ──────────────────────────────────
for (const [w, d] of [[1, 1], [2, 1], [4, 1], [6, 1], [2, 2], [4, 2]]) {
  add({ id: `tile_${d}x${w}`, name: `타일 ${dims(w, d)}`, cat: 'tile', w, d, h: 1, studs: [], shape: { type: 'box', tile: true } });
}

// ── 경사 ────────────────────────────────────────────────
// frustum levels: [y(월드 단위), x0, z0, x1, z1] — 발자국 좌표(0..w, 0..d)
// 경사면은 +z(앞) 쪽을 향하고, 스터드는 뒷줄(z=0)에 있다.
const LIP = 0.14;
function slope(id, name, w, h, top, studs, extra = {}) {
  const H = h * PLATE_H;
  return add({
    id, name, cat: 'slope', w, d: 2, h, studs,
    shape: { type: 'frustum', levels: [[0, 0, 0, w, 2], [LIP, 0, 0, w, 2], [H, ...top]], matte: 'slope' },
    ...extra,
  });
}
slope('slope45_2x1', '경사 45° 2×1', 1, 3, [0, 0, 1, 1], [[0, 0]]);
slope('slope45_2x2', '경사 45° 2×2', 2, 3, [0, 0, 2, 1], [[0, 0], [1, 0]]);
slope('slope45_2x4', '경사 45° 2×4', 4, 3, [0, 0, 4, 1], [[0, 0], [1, 0], [2, 0], [3, 0]]);
slope('slope65_2x1', '급경사 65° 2×1×2', 1, 6, [0, 0, 1, 1], [[0, 0]]);
slope('slope65_2x2', '급경사 65° 2×2×2', 2, 6, [0, 0, 2, 1], [[0, 0], [1, 0]]);

add({
  id: 'slope45_corner', name: '코너 경사 45° 2×2', cat: 'slope', w: 2, d: 2, h: 3, studs: [[0, 0]],
  shape: { type: 'frustum', levels: [[0, 0, 0, 2, 2], [LIP, 0, 0, 2, 2], [1.2, 0, 0, 1, 1]], matte: 'slope' },
});
add({
  id: 'slope65_corner', name: '코너 급경사 2×2×2', cat: 'slope', w: 2, d: 2, h: 6, studs: [[0, 0]],
  shape: { type: 'frustum', levels: [[0, 0, 0, 2, 2], [LIP, 0, 0, 2, 2], [2.4, 0, 0, 1, 1]], matte: 'slope' },
});
add({
  id: 'slope45_ridge_2x2', name: '지붕 마루 2×2', cat: 'slope', w: 2, d: 2, h: 3, studs: [],
  shape: { type: 'frustum', levels: [[0, 0, 0, 2, 2], [LIP, 0, 0, 2, 2], [1.2, 0, 1, 2, 1]], matte: 'slope' },
});
add({
  id: 'slope45_ridge_2x4', name: '지붕 마루 2×4', cat: 'slope', w: 4, d: 2, h: 3, studs: [],
  shape: { type: 'frustum', levels: [[0, 0, 0, 4, 2], [LIP, 0, 0, 4, 2], [1.2, 0, 1, 4, 1]], matte: 'slope' },
});
add({
  id: 'slope45_peak', name: '피라미드 2×2', cat: 'slope', w: 2, d: 2, h: 3, studs: [],
  shape: { type: 'frustum', levels: [[0, 0, 0, 2, 2], [LIP, 0, 0, 2, 2], [1.2, 1, 1, 1, 1]], matte: 'slope' },
});
add({
  id: 'inv45_2x1', name: '역경사 45° 2×1', cat: 'slope', w: 1, d: 2, h: 3,
  sockets: [[0, 0]],
  shape: { type: 'frustum', levels: [[0, 0, 0, 1, 1], [1.2 - LIP, 0, 0, 1, 2], [1.2, 0, 0, 1, 2]], matte: 'under' },
});
add({
  id: 'inv45_2x2', name: '역경사 45° 2×2', cat: 'slope', w: 2, d: 2, h: 3,
  sockets: [[0, 0], [1, 0]],
  shape: { type: 'frustum', levels: [[0, 0, 0, 2, 1], [1.2 - LIP, 0, 0, 2, 2], [1.2, 0, 0, 2, 2]], matte: 'under' },
});
add({
  id: 'spire_2x2', name: '첨탑 꼭대기 2×2', cat: 'slope', w: 2, d: 2, h: 6, studs: [],
  shape: { type: 'spire' },
});

// ── 원형 ────────────────────────────────────────────────
const ROUND = 0.785; // 원형 부품 질량 보정(π/4)
add({ id: 'round_brick_1x1', name: '원형 브릭 1×1', cat: 'round', w: 1, d: 1, h: 3, massFactor: ROUND, shape: { type: 'lathe', kind: 'cyl', r: 0.48 } });
add({ id: 'round_brick_2x2', name: '원형 브릭 2×2', cat: 'round', w: 2, d: 2, h: 3, massFactor: ROUND, shape: { type: 'lathe', kind: 'cyl', r: 0.98 } });
add({ id: 'round_plate_1x1', name: '원형 플레이트 1×1', cat: 'round', w: 1, d: 1, h: 1, massFactor: ROUND, shape: { type: 'lathe', kind: 'cyl', r: 0.48 } });
add({ id: 'round_plate_2x2', name: '원형 플레이트 2×2', cat: 'round', w: 2, d: 2, h: 1, massFactor: ROUND, shape: { type: 'lathe', kind: 'cyl', r: 0.98 } });
add({ id: 'round_tile_1x1', name: '원형 타일 1×1', cat: 'round', w: 1, d: 1, h: 1, studs: [], massFactor: ROUND, shape: { type: 'lathe', kind: 'cyl', r: 0.48 } });
add({ id: 'round_tile_2x2', name: '원형 타일 2×2', cat: 'round', w: 2, d: 2, h: 1, studs: [], massFactor: ROUND, shape: { type: 'lathe', kind: 'cyl', r: 0.98 } });
add({ id: 'cone_1x1', name: '콘 1×1', cat: 'round', w: 1, d: 1, h: 3, massFactor: 0.5, shape: { type: 'lathe', kind: 'cone' } });
add({ id: 'dome_2x2', name: '돔 2×2', cat: 'round', w: 2, d: 2, h: 3, studs: [], massFactor: 0.6, shape: { type: 'lathe', kind: 'dome' } });

// ── 특수 ────────────────────────────────────────────────
function archCells(w, h, legs, solidFrom) {
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (y >= solidFrom || legs.includes(x)) out.push([x, y, 0]);
  }
  return out;
}
add({
  id: 'arch_1x4', name: '아치 1×4', cat: 'special', w: 4, d: 1, h: 3,
  sockets: [[0, 0], [3, 0]], cells: archCells(4, 3, [0, 3], 2),
  shape: { type: 'arch', span: [1, 3], rise: 0.8 },
});
add({
  id: 'arch_1x6', name: '아치 1×6×2', cat: 'special', w: 6, d: 1, h: 6,
  sockets: [[0, 0], [5, 0]], cells: archCells(6, 6, [0, 5], 4),
  shape: { type: 'arch', span: [1, 5], rise: 1.75 },
});
add({ id: 'window_1x2x2', name: '창문 1×2×2', cat: 'special', w: 2, d: 1, h: 6, shape: { type: 'window' } });
add({ id: 'window_1x2x3', name: '창문 1×2×3', cat: 'special', w: 2, d: 1, h: 9, shape: { type: 'window' } });
add({ id: 'door_1x4x6', name: '문 1×4×6', cat: 'special', w: 4, d: 1, h: 18, shape: { type: 'door' } });
add({ id: 'flower_1x1', name: '꽃 플레이트 1×1', cat: 'special', w: 1, d: 1, h: 1, massFactor: 0.7, shape: { type: 'flower' } });
add({
  id: 'antenna_1x1', name: '안테나 1×1×4', cat: 'special', w: 1, d: 1, h: 12, studs: [], massFactor: 0.15,
  shape: { type: 'lathe', kind: 'antenna' },
});
add({
  id: 'pine_4x4', name: '소나무 4×4', cat: 'special', w: 4, d: 4, h: 18, studs: [], massFactor: 0.2,
  sockets: [[1, 1], [2, 1], [1, 2], [2, 2]],
  shape: { type: 'lathe', kind: 'pine' },
});
add({
  id: 'bush_2x2', name: '덤불 2×2', cat: 'special', w: 2, d: 2, h: 5, studs: [], massFactor: 0.4,
  shape: { type: 'lathe', kind: 'bush' },
});

export const PIECES = LIST;
export const PIECE_BY_ID = Object.fromEntries(LIST.map((p) => [p.id, p]));

export const CATEGORIES = [
  { id: 'brick', name: '브릭' },
  { id: 'plate', name: '플레이트' },
  { id: 'tile', name: '타일' },
  { id: 'slope', name: '경사' },
  { id: 'round', name: '원형' },
  { id: 'special', name: '특수' },
];

// 회전 r(0..3, 위에서 볼 때 +Y축 기준 90°씩)을 적용한 격자 데이터. three.js의 rotation.y = r·π/2 와 일치한다.
const rotCache = new Map();
export function oriented(piece, rot) {
  const r = ((rot % 4) + 4) % 4;
  const key = piece.id + '|' + r;
  let o = rotCache.get(key);
  if (o) return o;
  let w = piece.w, d = piece.d;
  let studs = piece.studs.map((p) => p.slice());
  let sockets = piece.sockets.map((p) => p.slice());
  let cells = piece.cells.map((c) => c.slice());
  for (let i = 0; i < r; i++) {
    // (x, z) → (z, w-1-x), 새 발자국 w' = d, d' = w
    studs = studs.map(([x, z]) => [z, w - 1 - x]);
    sockets = sockets.map(([x, z]) => [z, w - 1 - x]);
    cells = cells.map(([x, y, z]) => [z, y, w - 1 - x]);
    [w, d] = [d, w];
  }
  o = { piece, rot: r, w, d, h: piece.h, studs, sockets, cells };
  rotCache.set(key, o);
  return o;
}

// 회전으로 모양이 달라지지 않는 부품인지(회전 버튼 비활성화 판단용)
export function rotationMatters(piece) {
  if (piece.w !== piece.d) return true;
  return piece.shape.type === 'frustum' || piece.shape.type === 'arch' || piece.shape.type === 'window' || piece.shape.type === 'door';
}
