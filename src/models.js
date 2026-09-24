// 갤러리 모델. 모두 실제로 조립 가능한 순서대로 생성되며, 테스트에서 연결/구조를 검증한다.
import { Builder, pick, FILL_SIZES } from './builder.js';

const stoneMix = (r, a = 'dbg', b = 'lbg', pb = 0.28) => () => (r() < pb ? b : a);

// ── 공통: 계단식 박공(네덜란드식) 집 ─────────────────────
function steppedHouse(B, { x0, z0, w, d, y, floors, wall, trim, roof, eave, frame, glass = 'tyellow', door = 'brown', cap = 'blo' }) {
  const st = { joints: { n: new Set(), s: new Set(), e: new Set(), w: new Set() } };
  let k = 0;
  let yy = y;
  for (let f = 0; f < floors; f++) {
    const openings = [];
    if (f === 0) {
      openings.push({ side: 's', a: Math.floor(w / 2) - 1, width: 2, k0: k, k1: k + 2, fill: 'solid', fillColor: door, arch: true, archColor: trim });
      openings.push({ side: 's', a: 1, width: 1, k0: k + 1, k1: k + 2, fill: 'glass', fillColor: glass });
      openings.push({ side: 's', a: w - 2, width: 1, k0: k + 1, k1: k + 2, fill: 'glass', fillColor: glass });
      for (const side of ['e', 'w', 'n']) {
        const L = side === 'n' ? w : d;
        openings.push({ side, a: 2, width: 2, k0: k + 1, k1: k + 2, fill: 'glass', fillColor: glass });
        openings.push({ side, a: L - 4, width: 2, k0: k + 1, k1: k + 2, fill: 'glass', fillColor: glass });
      }
    } else {
      for (const side of ['s', 'n', 'e', 'w']) {
        const L = side === 'n' || side === 's' ? w : d;
        openings.push({ side, a: 1, width: 2, k0: k + 1, k1: k + 3, fill: 'window_1x2x2', fillColor: frame });
        openings.push({ side, a: L - 3, width: 2, k0: k + 1, k1: k + 3, fill: 'window_1x2x2', fillColor: frame });
      }
    }
    B.ringWall(x0, z0, w, d, yy, 3, wall, { k, state: st, openings });
    k += 3;
    yy += 9;
    if (f < floors - 1) {
      B.ringPlates(x0, z0, w, d, yy, trim, { state: st, parity: k });
      yy += 1;
    }
  }
  // 처마
  B.ringPlates(x0, z0, w, d, yy, eave, { outset: 1, thick: 2 });
  yy += 1;
  // 지붕(용마루가 z 방향)과 계단식 박공(앞/뒤)
  const layers = Math.floor((w + 2) / 2);
  const gableJoints = { s: new Set(), n: new Set() };
  for (let j = 0; j < layers; j++) {
    const gy = yy + j * 3;
    const a = x0 - 1 + j;
    const b = x0 + w + 1 - j;
    for (const [side, gz] of [['s', z0 + d - 1], ['n', z0]]) {
      const mid = x0 + Math.floor(w / 2) - 1;
      let joints;
      if (j >= 1 && j <= 2 && b - a >= 6) {
        const hard = new Set();
        const j1 = B.line('brick', 1, 'x', a, mid, gz, gy, wall, gableJoints[side], hard);
        const j2 = B.line('brick', 1, 'x', mid + 2, b, gz, gy, wall, gableJoints[side], hard);
        if (j === 1) B.put('window_1x2x2', mid, gy, gz, 0, frame);
        joints = new Set([...j1, ...j2]);
      } else {
        const hard = j === 3 ? new Set([mid, mid + 1, mid + 2]) : null;
        joints = B.line('brick', 1, 'x', a, b, gz, gy, wall, gableJoints[side], hard);
      }
      gableJoints[side] = joints;
    }
  }
  B.gableRoofZ(x0 - 1, w + 2, z0 + 1, z0 + d - 1, yy, roof);
  // 계단 모서리 장식
  for (let j = 0; j < layers - 1; j++) {
    const gy = yy + (j + 1) * 3;
    for (const gz of [z0 + d - 1, z0]) {
      B.put('plate_1x1', x0 - 1 + j, gy, gz, 0, cap);
      B.put('plate_1x1', x0 + w - j, gy, gz, 0, cap);
    }
  }
  const topY = yy + layers * 3;
  const mid = x0 + Math.floor(w / 2) - 1;
  for (const gz of [z0 + d - 1, z0]) {
    B.put('plate_1x2', mid, topY, gz, 0, cap);
    B.put('cone_1x1', mid, topY + 1, gz, 0, cap);
  }
}

// ── 1. 구시가지 광장 ─────────────────────────────────────
function oldTown() {
  const B = new Builder(30, 24, 7);
  const r = B.r;
  B.fill('plate', 0, 0, 30, 24, 0, 'dbg');

  // 건물·소품 자리 예약 후 바닥 포석
  B.reserve(2, 2, 6, 6);
  B.reserve(10, 2, 8, 10);
  B.reserve(20, 3, 8, 10);
  B.reserve(13, 15, 4, 4); // 우물
  B.reserve(21, 16, 4, 4); // 노점
  B.reserve(2, 17, 4, 4); // 나무
  B.reserve(26, 14, 2, 2); // 통
  const lamps = [[9, 13], [19, 14], [8, 20], [18, 21]];
  for (const [x, z] of lamps) B.reserve(x, z, 1, 1);
  B.reserve(6, 20, 2, 2); // 덤불
  B.reserve(25, 18, 1, 2);
  const cobble = () => pick(r, [['lbg', 62], ['white', 10], ['dbg', 18], ['darktan', 10]]);
  B.fill('tile', 0, 0, 30, 24, 1, cobble, { random: 0.55, skipReserved: true, sizes: FILL_SIZES.cobble });

  // 종탑
  const tower = { x0: 2, z0: 2, w: 6, d: 6 };
  const stone = stoneMix(r);
  const st = { joints: { n: new Set(), s: new Set(), e: new Set(), w: new Set() } };
  let y = 1;
  B.ringWall(2, 2, 6, 6, y, 3, stone, {
    k: 0,
    state: st,
    openings: [{ side: 's', a: 2, width: 2, k0: 0, k1: 2, fill: 'solid', fillColor: 'brown', arch: true, archColor: 'blo' }],
  });
  y += 9;
  B.ringPlates(2, 2, 6, 6, y, 'gold', { outset: 1, thick: 2 });
  y += 1;
  const win = ['s', 'n', 'e', 'w'].map((side) => ({ side, a: 2, width: 2, k0: 4, k1: 6, fill: 'window_1x2x2', fillColor: 'white' }));
  B.ringWall(2, 2, 6, 6, y, 5, stone, { k: 3, state: st, openings: win });
  y += 15;
  B.ringPlates(2, 2, 6, 6, y, 'gold', { state: st, parity: 8 });
  y += 1;
  const belfry = ['s', 'n', 'e', 'w'].map((side) => ({ side, a: 2, width: 2, k0: 8, k1: 10, fill: 'empty', arch: true, archColor: 'blo' }));
  B.ringWall(2, 2, 6, 6, y, 3, stone, { k: 8, state: st, openings: belfry });
  y += 9;
  B.ringPlates(2, 2, 6, 6, y, 'gold', { outset: 1, thick: 2 });
  y += 1;
  B.ringWall(2, 2, 6, 6, y, 2, stone, { k: 11 });
  y += 6;
  B.put('plate_6x6', 2, y, 2, 0, 'dbg');
  y += 1;
  const top = B.spire(2, 2, 6, y, (yy) => (yy === y ? 'dbg' : 'dbg'));
  B.put('spire_2x2', top.x, top.y, top.z, 0, 'dbg');
  // 종 (종루 안쪽 바닥에 매단 대신 올려둔 금색 원형 브릭)
  void tower;

  // 집 A — 3층, 회색
  steppedHouse(B, { x0: 10, z0: 2, w: 8, d: 10, y: 1, floors: 3, wall: stoneMix(r, 'lbg', 'white', 0.22), trim: 'blo', roof: 'dbg', eave: 'dbg', frame: 'white', cap: 'blo' });
  // 집 B — 2층, 샌드 톤
  steppedHouse(B, { x0: 20, z0: 3, w: 8, d: 10, y: 1, floors: 2, wall: stoneMix(r, 'tan', 'darktan', 0.2), trim: 'white', roof: 'darkred', eave: 'darkred', frame: 'white', cap: 'white' });

  // 우물
  B.ringWall(13, 15, 4, 4, 1, 2, stoneMix(r, 'lbg', 'dbg', 0.3), { k: 0 });
  B.put('tile_2x2', 14, 1, 16, 0, 'tblue');
  B.put('round_brick_1x1', 13, 7, 16, 0, 'brown');
  B.put('round_brick_1x1', 16, 7, 16, 0, 'brown');
  B.put('round_brick_1x1', 13, 10, 16, 0, 'brown');
  B.put('round_brick_1x1', 16, 10, 16, 0, 'brown');
  B.put('plate_2x4', 13, 13, 16, 0, 'brown');
  B.put('slope45_ridge_2x4', 13, 14, 16, 0, 'darkred');

  // 노점 (줄무늬 차양)
  for (const [x, z] of [[21, 16], [24, 16], [21, 19], [24, 19]]) {
    B.put('round_brick_1x1', x, 1, z, 0, 'white');
    B.put('round_brick_1x1', x, 4, z, 0, 'white');
  }
  B.put('brick_1x2', 22, 1, 19, 0, 'nougat');
  B.put('tile_1x2', 22, 4, 19, 0, 'tan');
  B.put('round_brick_1x1', 22, 1, 17, 0, 'orange');
  B.put('round_plate_1x1', 23, 1, 17, 0, 'lime');
  B.put('plate_4x4', 21, 7, 16, 0, 'white');
  B.put('slope45_2x2', 21, 8, 18, 0, 'red');
  B.put('slope45_2x2', 23, 8, 18, 0, 'white');
  B.put('slope45_2x2', 21, 8, 16, 2, 'red');
  B.put('slope45_2x2', 23, 8, 16, 2, 'white');
  B.put('brick_1x1', 25, 1, 18, 0, 'nougat');
  B.put('brick_1x1', 25, 1, 19, 0, 'tan');
  B.put('plate_1x1', 25, 4, 19, 0, 'nougat');

  // 나무·덤불·통·가로등
  B.put('pine_4x4', 2, 1, 17, 0, 'dgreen');
  B.put('bush_2x2', 6, 1, 20, 0, 'green');
  B.put('round_brick_2x2', 26, 1, 14, 0, 'brown');
  B.put('round_plate_2x2', 26, 4, 14, 0, 'nougat');
  for (const [x, z] of lamps) {
    B.put('round_brick_1x1', x, 1, z, 0, 'black');
    B.put('round_brick_1x1', x, 4, z, 0, 'black');
    B.put('round_plate_1x1', x, 7, z, 0, 'gold');
    B.put('cone_1x1', x, 8, z, 0, 'tyellow');
  }

  return B.result({ id: 'oldtown', name: '구시가지 광장', en: 'Old Town Square', desc: '종탑과 계단식 박공 집이 있는 중세 광장', bg: 'dbg' });
}

// ── 2. 등대 ─────────────────────────────────────────────
function lighthouse() {
  const B = new Builder(26, 24, 11);
  const r = B.r;
  B.fill('plate', 0, 0, 26, 24, 0, 'azure');
  const cx = 13.5, cz = 12;
  const inEllipse = (x, z, rx, rz) => ((x + 0.5 - cx) / rx) ** 2 + ((z + 0.5 - cz) / rz) ** 2 <= 1;
  const cellsIn = (rx, rz) => (x, z) => inEllipse(x, z, rx, rz);
  const house = (x, z) => x >= 5 && x <= 8 && z >= 10 && z <= 13;
  const top = (x, z) => x >= 10 && x <= 17 && z >= 8 && z <= 15 && !((x === 10 || x === 17) && (z === 8 || z === 15));
  // 섬: 3단 바위
  const rock = () => pick(r, [['dbg', 5], ['lbg', 3], ['darktan', 1]]);
  maskFill(B, 'brick', cellsIn(11, 8.6), 1, rock);
  maskFill(B, 'brick', cellsIn(9, 6.8), 4, rock);
  maskFill(B, 'brick', top, 7, rock);
  // 모래톱과 풀
  maskFill(B, 'plate', (x, z) => inEllipse(x, z, 9, 6.8) && !top(x, z) && !house(x, z), 7, (x, z) => (z > cz + 1 ? 'tan' : 'bgreen'));
  // 물결 (투명 타일)
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * 26), z = Math.floor(r() * 24);
    if (inEllipse(x, z, 12, 9.6)) continue;
    const id = r() < 0.5 ? 'tile_1x2' : 'round_tile_1x1';
    const rot = r() < 0.5 ? 0 : 1;
    if (B.world.check(id, x, 1, z, rot).ok) B.put(id, x, 1, z, rot, r() < 0.7 ? 'tblue' : 'white');
  }

  // 등대 몸통 (빨강/흰 띠)
  const x0 = 11, z0 = 9;
  const stripe = (kg) => (Math.floor(kg / 2) % 2 ? 'white' : 'red');
  const st = { joints: { n: new Set(), s: new Set(), e: new Set(), w: new Set() } };
  const openings = [{ side: 's', a: 2, width: 2, k0: 0, k1: 2, fill: 'solid', fillColor: 'dblue', arch: true, archColor: 'white' }];
  for (const [k, side] of [[4, 'e'], [6, 's'], [8, 'w'], [10, 'n'], [11, 's']]) openings.push({ side, a: 2, width: 1, k0: k, k1: k + 1, fill: 'glass', fillColor: 'tyellow' });
  let y = 10;
  B.ringWall(x0, z0, 6, 6, y, 13, stripe, { k: 0, state: st, openings });
  y += 39;
  B.ringPlates(x0, z0, 6, 6, y, 'dbg', { outset: 1, thick: 2 });
  y += 1;
  B.put('plate_6x6', x0, y, z0, 0, 'dbg');
  // 난간
  for (let x = x0 - 1; x <= x0 + 6; x++) {
    for (let z = z0 - 1; z <= z0 + 6; z++) {
      const edge = x === x0 - 1 || x === x0 + 6 || z === z0 - 1 || z === z0 + 6;
      if (edge && (x + z) % 2 === 0) B.put('round_plate_1x1', x, y, z, 0, 'white');
    }
  }
  y += 1;
  // 등롱
  const lx = x0 + 1, lz = z0 + 1;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < 4; i++) {
      for (const [x, z] of [[lx + i, lz], [lx + 3 - i, lz + 3]]) B.put('round_brick_1x1', x, y + c * 3, z, 0, (x + z) % 2 ? 'tclear' : 'white');
    }
    for (let i = 1; i < 3; i++) {
      for (const [x, z] of [[lx, lz + i], [lx + 3, lz + 3 - i]]) B.put('round_brick_1x1', x, y + c * 3, z, 0, (x + z) % 2 ? 'tclear' : 'white');
    }
  }
  B.put('round_brick_2x2', lx + 1, y, lz + 1, 0, 'tyellow');
  B.put('round_brick_2x2', lx + 1, y + 3, lz + 1, 0, 'tyellow');
  y += 6;
  B.put('plate_4x4', lx, y, lz, 0, 'red');
  y += 1;
  const t = B.spire(lx, lz, 4, y, 'red', { steep: false });
  B.put('dome_2x2', t.x, t.y, t.z, 0, 'red');

  // 관리인 오두막
  B.ringWall(5, 10, 4, 4, 7, 3, 'white', { k: 0, openings: [{ side: 's', a: 1, width: 2, k0: 0, k1: 2, fill: 'solid', fillColor: 'dblue' }, { side: 'w', a: 1, width: 2, k0: 1, k1: 2, fill: 'glass', fillColor: 'tyellow' }] });
  B.ringPlates(5, 10, 4, 4, 16, 'white', { outset: 0 });
  B.gableRoofX(10, 4, 5, 9, 17, 'red', { ridgeColor: 'darkred' });

  return B.result({ id: 'lighthouse', name: '바위섬 등대', en: 'Lighthouse', desc: '줄무늬 등대와 관리인 오두막', bg: 'azure' });
}

// 마스크 영역을 큰 부품 우선으로 채움
function maskFill(B, kind, mask, y, color) {
  const W = B.world.w, D = B.world.d;
  const sizes = kind === 'brick'
    ? [[4, 2], [2, 4], [3, 2], [2, 3], [2, 2], [4, 1], [1, 4], [3, 1], [1, 3], [2, 1], [1, 2], [1, 1]]
    : [[4, 4], [4, 2], [2, 4], [2, 2], [3, 1], [1, 3], [2, 1], [1, 2], [1, 1]];
  const idOf = (w, d) => {
    const a = Math.min(w, d), b = Math.max(w, d);
    return { id: `${kind}_${a}x${b}`, rot: w >= d ? 0 : 1 };
  };
  const used = new Set();
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      if (!mask(x, z) || used.has(x + ',' + z)) continue;
      for (const [w, d] of sizes) {
        let ok = x + w <= W && z + d <= D;
        for (let i = 0; i < w && ok; i++) for (let j = 0; j < d && ok; j++) if (!mask(x + i, z + j) || used.has(x + i + ',' + (z + j))) ok = false;
        if (!ok) continue;
        const { id, rot } = idOf(w, d);
        if (!B.world.check(id, x, y, z, rot).ok) continue;
        B.put(id, x, y, z, rot, typeof color === 'function' ? color(x, z) : color);
        for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) used.add(x + i + ',' + (z + j));
        break;
      }
    }
  }
}

// ── 3. 오두막 ───────────────────────────────────────────
function cottage() {
  const B = new Builder(24, 20, 5);
  const r = B.r;
  B.fill('plate', 0, 0, 24, 20, 0, 'bgreen');
  // 길
  for (let z = 12; z < 20; z += 2) B.put('tile_2x2', 11, 1, z, 0, z % 4 ? 'tan' : 'darktan');

  const x0 = 6, z0 = 4, w = 12, d = 8;
  B.ringPlates(x0, z0, w, d, 1, 'dbg');
  const st = { joints: { n: new Set(), s: new Set(), e: new Set(), w: new Set() } };
  const openings = [
    { side: 's', a: 5, width: 2, k0: 0, k1: 4, fill: 'solid', fillColor: 'brown' },
    { side: 's', a: 1, width: 2, k0: 1, k1: 3, fill: 'window_1x2x2', fillColor: 'sandblue' },
    { side: 's', a: 9, width: 2, k0: 1, k1: 3, fill: 'window_1x2x2', fillColor: 'sandblue' },
    { side: 'n', a: 2, width: 2, k0: 1, k1: 3, fill: 'window_1x2x2', fillColor: 'sandblue' },
    { side: 'n', a: 8, width: 2, k0: 1, k1: 3, fill: 'window_1x2x2', fillColor: 'sandblue' },
    { side: 'e', a: 3, width: 2, k0: 1, k1: 3, fill: 'window_1x2x2', fillColor: 'sandblue' },
    { side: 'w', a: 3, width: 2, k0: 1, k1: 3, fill: 'window_1x2x2', fillColor: 'sandblue' },
  ];
  const wallC = (kg, side, p, L) => (kg === 4 ? 'tan' : 'white');
  B.ringWall(x0, z0, w, d, 2, 6, wallC, { k: 0, state: st, openings });
  const y = 2 + 18;
  B.ringPlates(x0, z0, w, d, y, 'brown', { outset: 1, thick: 2 });
  // 박공 벽(동/서) — 지붕 아래 삼각형
  for (let j = 0; j < 3; j++) {
    const a = z0 + 1 + j, b = z0 + d - 1 - j;
    if (b - a <= 0) break;
    B.line('brick', 1, 'z', a, b, x0, y + 1 + j * 3, 'white', null, null);
    B.line('brick', 1, 'z', a, b, x0 + w - 1, y + 1 + j * 3, 'white', null, null);
  }
  const roofC = (j, p) => ((p + j) % 4 < 2 ? 'red' : 'darkred');
  B.gableRoofX(z0 - 1, d + 2, x0 - 1, x0 + w + 1, y + 1, roofC, { ridgeColor: 'darkred' });

  // 정원
  B.put('pine_4x4', 1, 1, 2, 0, 'dgreen');
  B.put('pine_4x4', 19, 1, 11, 0, 'green');
  B.put('bush_2x2', 2, 1, 12, 0, 'green');
  B.put('bush_2x2', 20, 1, 3, 0, 'bgreen');
  B.put('bush_2x2', 20, 1, 6, 0, 'green');
  const flowers = ['red', 'yellow', 'pink', 'white', 'lavender', 'orange'];
  for (let x = x0; x < x0 + w; x++) {
    if (x === 11 || x === 12) continue;
    B.put('plate_1x1', x, 1, 13, 0, 'brown');
    if (r() < 0.75) B.put('flower_1x1', x, 2, 13, 0, flowers[Math.floor(r() * flowers.length)]);
  }
  // 울타리
  for (const x0f of [1, 5, 14, 18]) {
    B.put('round_brick_1x1', x0f, 1, 18, 0, 'white');
    B.put('round_brick_1x1', x0f + 3, 1, 18, 0, 'white');
    B.put('plate_1x4', x0f, 4, 18, 0, 'white');
  }
  // 우체통
  B.put('round_brick_1x1', 14, 1, 16, 0, 'dbg');
  B.put('brick_1x2', 14, 4, 16, 0, 'red');
  // 연못
  B.put('tile_2x2', 1, 1, 7, 0, 'tblue');
  B.put('tile_2x2', 3, 1, 7, 0, 'tblue');
  B.put('tile_1x2', 1, 1, 9, 0, 'tblue');
  B.put('round_tile_1x1', 3, 1, 9, 0, 'tblue');
  B.put('round_tile_1x1', 4, 1, 9, 0, 'lbg');

  return B.result({ id: 'cottage', name: '정원 오두막', en: 'Garden Cottage', desc: '파란 창틀과 붉은 지붕의 시골집', bg: 'bgreen' });
}

// ── 4. 성문과 해자 ──────────────────────────────────────
function castle() {
  const B = new Builder(28, 24, 3);
  const r = B.r;
  B.fill('plate', 0, 0, 28, 24, 0, 'bgreen');
  // 해자와 도개교
  for (let x = 0; x < 28; x += 2) {
    const bridge = x >= 12 && x < 16;
    for (let z = 16; z < 20; z += 2) B.put('tile_2x2', x, 1, z, 0, bridge ? 'brown' : 'tblue');
  }
  // 길
  B.put('tile_2x4', 12, 1, 12, 1, 'darktan');
  B.put('tile_2x4', 14, 1, 12, 1, 'tan');
  B.put('tile_2x4', 12, 1, 20, 1, 'tan');
  B.put('tile_2x4', 14, 1, 20, 1, 'darktan');

  const stone = stoneMix(r, 'lbg', 'dbg', 0.25);
  // 성문
  const gx = 10, gz = 6;
  const gates = ['s', 'n'].map((side) => ({ side, a: 2, width: 4, k0: 0, k1: 2, fill: 'empty', arch: true, archColor: 'dbg' }));
  const gst = B.ringWall(gx, gz, 8, 6, 1, 7, stone, { k: 0, openings: gates });
  B.ringPlates(gx, gz, 8, 6, 22, 'dbg', { state: gst, parity: 7 });
  crenellate(B, gx, gz, 8, 6, 23, stone);

  // 왼쪽 탑 (총안)
  const slits = (sides, ks) => sides.flatMap((side) => ks.map((k) => ({ side, a: 2, width: 1, k0: k, k1: k + 2, fill: 'glass', fillColor: 'black' })));
  const lst = B.ringWall(4, 5, 6, 8, 1, 10, stone, { k: 0, openings: slits(['s', 'w'], [3, 7]) });
  void lst;
  B.ringPlates(4, 5, 6, 8, 31, 'dbg', { outset: 1, thick: 2 });
  B.ringPlates(4, 5, 6, 8, 32, 'lbg', { parity: 1 });
  crenellate(B, 3, 4, 8, 10, 32, stone, true);

  // 오른쪽 망루 (첨탑)
  const rst = { joints: { n: new Set(), s: new Set(), e: new Set(), w: new Set() } };
  B.ringWall(18, 6, 6, 6, 1, 13, stone, { k: 0, state: rst, openings: slits(['s', 'e'], [3, 7, 10]) });
  B.ringPlates(18, 6, 6, 6, 40, 'dbg', { outset: 1, thick: 2 });
  B.ringWall(18, 6, 6, 6, 41, 2, stone, { k: 14, openings: ['s', 'e', 'n', 'w'].map((side) => ({ side, a: 2, width: 2, k0: 14, k1: 15, fill: 'glass', fillColor: 'tyellow' })) });
  B.put('plate_6x6', 18, 47, 6, 0, 'dbg');
  const t = B.spire(18, 6, 6, 48, 'sandblue');
  B.put('spire_2x2', t.x, t.y, t.z, 0, 'sandblue');

  // 나무
  B.put('pine_4x4', 0, 1, 0, 0, 'dgreen');
  B.put('pine_4x4', 24, 1, 0, 0, 'dgreen');
  B.put('pine_4x4', 0, 1, 10, 0, 'green');
  B.put('bush_2x2', 25, 1, 12, 0, 'green');
  B.put('bush_2x2', 1, 1, 21, 0, 'green');
  B.put('bush_2x2', 24, 1, 21, 0, 'bgreen');

  return B.result({ id: 'castle', name: '성문과 해자', en: 'Castle Gate', desc: '망루·도개교·해자가 있는 성문', bg: 'bgreen' });
}

// 흉벽: 판 고리 위에 1칸 걸러 1×1 브릭
function crenellate(B, x0, z0, w, d, y, color, onOuterRing = false) {
  const cells = [];
  for (let x = x0; x < x0 + w; x++) cells.push([x, z0], [x, z0 + d - 1]);
  for (let z = z0 + 1; z < z0 + d - 1; z++) cells.push([x0, z], [x0 + w - 1, z]);
  for (const [x, z] of cells) {
    if ((x + z) % 2 === 0) continue;
    const c = typeof color === 'function' ? color() : color;
    if (B.world.check('brick_1x1', x, y, z, 0).ok) B.put('brick_1x1', x, y, z, 0, c);
  }
  void onOuterRing;
}

// ── 5. 흔들리는 크레인 (약한 연결 시연) ──────────────────
function wobbly() {
  const B = new Builder(16, 16, 2);
  B.put('plate_6x6', 3, 0, 5, 0, 'dbg');
  // 튼튼한 기둥
  for (let i = 0; i < 5; i++) B.put('brick_2x2', 4, 1 + i * 3, 6, 0, i % 2 ? 'yellow' : 'orange');
  B.put('plate_2x4', 4, 16, 6, 0, 'yellow');
  // 1×1 원형 기둥 (회전축 위험)
  for (let i = 0; i < 6; i++) B.put('round_brick_1x1', 7, 1 + i * 3, 9, 0, 'sandblue');
  // 긴 팔: 스터드 1개에 매달린 1×8 플레이트 + 끝의 추
  B.put('plate_1x8', 7, 19, 9, 0, 'orange');
  B.put('brick_2x2', 13, 20, 9, 0, 'red');
  return B.result({ id: 'wobbly', name: '흔들리는 크레인', en: 'Wobbly Crane', desc: '약한 연결부 탐지를 보여주는 시연 모델', bg: 'dbg' });
}

// ── 6. 작은 시작 탑 ─────────────────────────────────────
function starter() {
  const B = new Builder(12, 12, 9);
  B.put('plate_4x4', 4, 0, 4, 0, 'dbg');
  for (let i = 0; i < 4; i++) B.put('round_brick_2x2', 5, 1 + i * 3, 5, 0, 'sandblue');
  B.put('round_plate_2x2', 5, 13, 5, 0, 'blo');
  B.put('cone_1x1', 5, 14, 5, 0, 'blo');
  return B.result({ id: 'starter', name: '원형 기둥', en: 'Round Column', desc: '원형 브릭 4개와 4×4 플레이트', bg: 'dbg' });
}

const FACTORIES = { oldtown: oldTown, castle, lighthouse, cottage, starter, wobbly };
export const MODEL_IDS = Object.keys(FACTORIES);

const cache = new Map();
export function getModel(id) {
  if (!cache.has(id)) cache.set(id, FACTORIES[id]());
  return cache.get(id);
}
