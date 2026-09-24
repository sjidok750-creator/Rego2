// 모델 생성 도우미: 러닝 본드(엇갈려 쌓기) 벽, 판 채우기, 경사 지붕 등.
// 모든 부품은 조립 순서대로 World에 검증하며 넣는다(연결되지 않으면 실패로 기록).
import { World } from './world.js';
import { PIECE_BY_ID } from './pieces.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(r, items) {
  // items: [[value, weight], ...]
  let total = 0;
  for (const [, w] of items) total += w;
  let x = r() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1][0];
}

const LINE_LENGTHS = {
  brick: [1, 2, 3, 4, 6, 8],
  plate: [1, 2, 3, 4, 6, 8],
  tile: [1, 2, 4, 6],
};

// 1줄(두께 thick)짜리 부품: axis 'x' 또는 'z'로 길이 L
export function linePiece(kind, L, thick, axis) {
  if (thick === 1) {
    const id = `${kind}_1x${L}`;
    return { id, rot: axis === 'x' || L === 1 ? 0 : 1 };
  }
  if (L === 1) return { id: `${kind}_1x2`, rot: axis === 'x' ? 1 : 0 };
  return { id: `${kind}_2x${L}`, rot: axis === 'x' ? 0 : 1 };
}

// [start, end) 구간을 길이 조합으로 채운다. soft: 피하고 싶은 이음새, hard: 금지 이음새
export function planLine(start, end, lengths, soft, hard, prefer = 4) {
  const n = end - start;
  const cost = new Array(n + 1).fill(Infinity);
  const prev = new Array(n + 1).fill(-1);
  cost[0] = 0;
  for (let i = 0; i < n; i++) {
    if (cost[i] === Infinity) continue;
    for (const L of lengths) {
      const j = i + L;
      if (j > n) continue;
      const p = start + j;
      let c = cost[i] + 1;
      if (L === 1) c += 0.9;
      if (L > prefer) c += 0.15 * (L - prefer);
      if (j < n) {
        if (hard && hard.has(p)) continue;
        if (soft && soft.has(p)) c += 6;
      }
      if (c < cost[j]) {
        cost[j] = c;
        prev[j] = i;
      }
    }
  }
  if (cost[n] === Infinity) return null;
  const out = [];
  for (let j = n; j > 0; j = prev[j]) out.unshift(j - prev[j]);
  return out;
}

export class Builder {
  constructor(w, d, seed = 1) {
    this.world = new World({ w, d });
    this.order = [];
    this.errors = [];
    this.reserved = new Set();
    this.r = rng(seed);
  }

  put(piece, x, y, z, rot, color) {
    if (!PIECE_BY_ID[piece]) {
      this.errors.push({ piece, x, y, z, rot, reason: 'unknown piece' });
      return null;
    }
    const b = this.world.place(piece, x, y, z, rot, color);
    if (!b) {
      this.errors.push({ piece, x, y, z, rot, reason: this.world.check(piece, x, y, z, rot).reason });
      return null;
    }
    this.order.push(b);
    return b;
  }

  reserve(x, z, w, d) {
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) this.reserved.add(`${x + i},${z + j}`);
  }

  // 한 줄 배치. 반환: 이음새 위치 집합
  line(kind, thick, axis, start, end, fixed, y, color, soft, hard) {
    const lens = planLine(start, end, LINE_LENGTHS[kind], soft, hard);
    const joints = new Set([start, end]);
    if (!lens) {
      this.errors.push({ kind, axis, start, end, fixed, y, reason: 'no plan' });
      return joints;
    }
    let p = start;
    for (const L of lens) {
      const { id, rot } = linePiece(kind, L, thick, axis);
      const c = typeof color === 'function' ? color(p, L) : color;
      if (axis === 'x') this.put(id, p, y, fixed, rot, c);
      else this.put(id, fixed, y, p, rot, c);
      p += L;
      joints.add(p);
    }
    return joints;
  }

  // 직사각형 영역을 판/브릭/타일로 채우기(큰 부품 우선, 이미 차 있는 칸은 건너뜀)
  fill(kind, x0, z0, w, d, y, color, { random = 0, skipReserved = false, sizes } = {}) {
    const free = (x, z) => {
      if (skipReserved && this.reserved.has(`${x},${z}`)) return false;
      return !this.world.occ.has(cellKeyLocal(x, y, z));
    };
    const cand = sizes || FILL_SIZES[kind];
    for (let z = z0; z < z0 + d; z++) {
      for (let x = x0; x < x0 + w; x++) {
        if (!free(x, z)) continue;
        const fits = [];
        for (const [pw, pd, id, rot] of cand) {
          if (x + pw > x0 + w || z + pd > z0 + d) continue;
          let ok = true;
          for (let i = 0; i < pw && ok; i++) for (let j = 0; j < pd && ok; j++) if (!free(x + i, z + j)) ok = false;
          if (ok) fits.push([pw, pd, id, rot]);
        }
        if (!fits.length) continue;
        let choice = fits[0];
        if (random && fits.length > 1 && this.r() < random) {
          choice = fits[Math.floor(this.r() * Math.min(fits.length, 4))];
        }
        const [, , id, rot] = choice;
        const c = typeof color === 'function' ? color(x, z) : color;
        this.put(id, x, y, z, rot, c);
      }
    }
  }

  // 링 벽: 외곽 x0..x0+w-1, z0..z0+d-1, 두께 1.
  // opts.openings: [{side:'n'|'s'|'e'|'w', a, width, k0, k1, fill, fillColor, arch}]
  //   a는 해당 면의 시작 모서리(x0 또는 z0)로부터의 거리, k0..k1-1 코스가 비어 있다.
  //   arch:true 이면 k1 코스에 아치를 얹는다(폭 2 → 1×4, 폭 4 → 1×6×2).
  ringWall(x0, z0, w, d, y, courses, color, opts = {}) {
    const openings = opts.openings || [];
    const k0g = opts.k ?? 0; // 전역 코스 번호(모서리 엇갈림 유지)
    const st = opts.state || { joints: { n: new Set(), s: new Set(), e: new Set(), w: new Set() } };
    for (let k = 0; k < courses; k++) {
      const kg = k0g + k;
      const yy = y + k * 3;
      const nsOwn = kg % 2 === 0;
      const sides = {
        n: { axis: 'x', start: nsOwn ? x0 : x0 + 1, end: nsOwn ? x0 + w : x0 + w - 1, fixed: z0, base: x0 },
        s: { axis: 'x', start: nsOwn ? x0 : x0 + 1, end: nsOwn ? x0 + w : x0 + w - 1, fixed: z0 + d - 1, base: x0 },
        w: { axis: 'z', start: nsOwn ? z0 + 1 : z0, end: nsOwn ? z0 + d - 1 : z0 + d, fixed: x0, base: z0 },
        e: { axis: 'z', start: nsOwn ? z0 + 1 : z0, end: nsOwn ? z0 + d - 1 : z0 + d, fixed: x0 + w - 1, base: z0 },
      };
      const newJoints = {};
      for (const key of ['s', 'e', 'n', 'w']) {
        const sd = sides[key];
        const blocked = [];
        const hard = new Set(st.hard?.[key] || []);
        const fillers = [];
        for (const op of openings) {
          if (op.side !== key) continue;
          const a = sd.base + op.a;
          const b = a + op.width;
          const archC = op.arch ? (op.width >= 4 ? 2 : 1) : 0;
          if (kg >= op.k0 && kg < op.k1) blocked.push([a, b]);
          if (op.arch && kg >= op.k1 && kg < op.k1 + archC) {
            blocked.push([a - 1, b + 1]);
            if (kg === op.k1) fillers.push({ type: 'arch', a: a - 1, op });
          }
          if (kg === op.k0 && op.fill) fillers.push({ type: 'fill', a, op });
          if (!op.arch && kg === op.k1) for (let p = a; p <= b; p++) hard.add(p);
        }
        // 막힌 구간을 빼고 남은 구간들
        blocked.sort((p, q) => p[0] - q[0]);
        const runs = [];
        let cur = sd.start;
        for (const [a, b] of blocked) {
          if (b <= cur) continue;
          if (a > cur) runs.push([cur, Math.min(a, sd.end)]);
          cur = Math.max(cur, b);
        }
        if (cur < sd.end) runs.push([cur, sd.end]);
        const joints = new Set();
        const col = (p, L) => (typeof color === 'function' ? color(kg, key, p, L) : color);
        for (const [a, b] of runs) {
          if (b <= a) continue;
          for (const j of this.line('brick', 1, sd.axis, a, b, sd.fixed, yy, col, st.joints[key], hard)) joints.add(j);
        }
        for (const f of fillers) {
          if (f.type === 'fill') this.opening(f.op, sd, f.a, yy);
          else this.archPiece(f.op, sd, f.a, yy);
          joints.add(f.a);
        }
        for (const [a, b] of blocked) {
          joints.add(a);
          joints.add(b);
        }
        newJoints[key] = joints;
      }
      st.joints = newJoints;
      st.hard = null;
    }
    // 다음 층(판 테두리 등)이 개구부 위를 가로지르도록 제약을 넘긴다
    const hardNext = { n: [], s: [], e: [], w: [] };
    for (const op of openings) {
      if (op.k1 === k0g + courses && !op.arch) {
        const base = op.side === 'n' || op.side === 's' ? x0 : z0;
        for (let p = base + op.a; p <= base + op.a + op.width; p++) hardNext[op.side].push(p);
      }
    }
    st.hard = hardNext;
    return st;
  }

  opening(op, sd, a, y) {
    const along = (L) => {
      const id = op.fill;
      if (sd.axis === 'x') this.put(id, a + (L || 0), y, sd.fixed, 0, op.fillColor);
      else this.put(id, sd.fixed, y, a + (L || 0), 1, op.fillColor);
    };
    if (op.fill === 'glass' || op.fill === 'solid') {
      // 개구부를 1×N 브릭으로 채움(유리 블록/문짝)
      for (let k = op.k0; k < op.k1; k++) {
        const yy = y + (k - op.k0) * 3;
        const lens = planLine(0, op.width, [1, 2, 3, 4], null, null);
        let p = a;
        for (const L of lens) {
          const { id, rot } = linePiece('brick', L, 1, sd.axis);
          if (sd.axis === 'x') this.put(id, p, yy, sd.fixed, rot, op.fillColor);
          else this.put(id, sd.fixed, yy, p, rot, op.fillColor);
          p += L;
        }
      }
      return;
    }
    if (op.fill === 'empty') return;
    along(0);
  }

  archPiece(op, sd, a, y) {
    const id = op.width >= 4 ? 'arch_1x6' : 'arch_1x4';
    const c = op.archColor || op.fillColor;
    if (sd.axis === 'x') this.put(id, a, y, sd.fixed, 0, c);
    else this.put(id, sd.fixed, y, a, 1, c);
  }

  // 판 테두리: outset만큼 바깥으로 넓힌 사각형에 두께 thick의 판 고리
  ringPlates(x0, z0, w, d, y, color, { outset = 0, thick = 1, kind = 'plate', state, parity = 0 } = {}) {
    const X0 = x0 - outset, Z0 = z0 - outset, W = w + 2 * outset, D = d + 2 * outset;
    const hard = state?.hard || {};
    const ns = parity % 2 === 0;
    const col = (key) => (p, L) => (typeof color === 'function' ? color(key, p, L) : color);
    // 남/북
    const nsStart = ns ? X0 : X0 + thick, nsEnd = ns ? X0 + W : X0 + W - thick;
    const weStart = ns ? Z0 + thick : Z0, weEnd = ns ? Z0 + D - thick : Z0 + D;
    const joints = {};
    joints.n = this.line(kind, thick, 'x', nsStart, nsEnd, Z0, y, col('n'), state?.joints?.n, new Set(hard.n || []));
    joints.s = this.line(kind, thick, 'x', nsStart, nsEnd, Z0 + D - thick, y, col('s'), state?.joints?.s, new Set(hard.s || []));
    joints.w = this.line(kind, thick, 'z', weStart, weEnd, X0, y, col('w'), state?.joints?.w, new Set(hard.w || []));
    joints.e = this.line(kind, thick, 'z', weStart, weEnd, X0 + W - thick, y, col('e'), state?.joints?.e, new Set(hard.e || []));
    if (state) {
      state.joints = outset === 0 && thick === 1 ? joints : { n: new Set(), s: new Set(), e: new Set(), w: new Set() };
      state.hard = null;
    }
    return joints;
  }

  // 경사 45° 박공지붕(용마루가 z축 방향). x0..x0+w-1 전체를 덮는다(양쪽 처마 포함), z 구간 [z0, z1)
  gableRoofZ(x0, w, z0, z1, y, color, { ridgeColor } = {}) {
    const layers = Math.floor(w / 2);
    for (let j = 0; j < layers; j++) {
      const yy = y + j * 3;
      const west = x0 + j;
      const east = x0 + w - 2 - j;
      if (east - west < 2) {
        // 용마루
        const lens = planLine(z0, z1, [2, 4], null, null) || [];
        let p = z0;
        for (const L of lens) {
          this.put(L === 4 ? 'slope45_ridge_2x4' : 'slope45_ridge_2x2', west, yy, p, 1, ridgeColor || color);
          p += L;
        }
        return yy + 3;
      }
      const lens = planLine(z0, z1, [1, 2, 4], null, null);
      let p = z0;
      for (const L of lens) {
        const id = L === 4 ? 'slope45_2x4' : L === 2 ? 'slope45_2x2' : 'slope45_2x1';
        const c = typeof color === 'function' ? color(j, p) : color;
        this.put(id, west, yy, p, 3, c);
        this.put(id, east, yy, p, 1, c);
        p += L;
      }
    }
    return y + layers * 3;
  }

  // 경사 45° 박공지붕(용마루가 x축 방향): z0..z0+d-1 덮음, x 구간 [x0, x1)
  gableRoofX(z0, d, x0, x1, y, color, { ridgeColor } = {}) {
    const layers = Math.floor(d / 2);
    for (let j = 0; j < layers; j++) {
      const yy = y + j * 3;
      const north = z0 + j;
      const south = z0 + d - 2 - j;
      if (south - north < 2) {
        const lens = planLine(x0, x1, [2, 4], null, null) || [];
        let p = x0;
        for (const L of lens) {
          this.put(L === 4 ? 'slope45_ridge_2x4' : 'slope45_ridge_2x2', p, yy, north, 0, ridgeColor || color);
          p += L;
        }
        return yy + 3;
      }
      const lens = planLine(x0, x1, [1, 2, 4], null, null);
      let p = x0;
      for (const L of lens) {
        const id = L === 4 ? 'slope45_2x4' : L === 2 ? 'slope45_2x2' : 'slope45_2x1';
        const c = typeof color === 'function' ? color(j, p) : color;
        this.put(id, p, yy, north, 2, c);
        this.put(id, p, yy, south, 0, c);
        p += L;
      }
    }
    return y + layers * 3;
  }

  // 사각뿔 첨탑: size(짝수) 정사각형, 급경사 2단 경사 사용
  spire(x0, z0, size, y, color, { steep = true } = {}) {
    const h = steep ? 6 : 3;
    const side = steep ? 'slope65_2x2' : 'slope45_2x2';
    const side1 = steep ? 'slope65_2x1' : 'slope45_2x1';
    const corner = steep ? 'slope65_corner' : 'slope45_corner';
    let s = size, xx = x0, zz = z0, yy = y;
    while (s > 2) {
      const c = typeof color === 'function' ? color(yy) : color;
      // 모서리 4개
      this.put(corner, xx + s - 2, yy, zz + s - 2, 0, c); // 남동
      this.put(corner, xx + s - 2, yy, zz, 1, c); // 북동
      this.put(corner, xx, yy, zz, 2, c); // 북서
      this.put(corner, xx, yy, zz + s - 2, 3, c); // 남서
      // 변
      const mid = s - 4;
      const lens = mid > 0 ? planLine(0, mid, [1, 2], null, null) : [];
      let p = 2;
      for (const L of lens) {
        const id = L === 2 ? side : side1;
        this.put(id, xx + p, yy, zz + s - 2, 0, c); // 남
        this.put(id, xx + p, yy, zz, 2, c); // 북
        this.put(id, xx + s - 2, yy, zz + p, 1, c); // 동
        this.put(id, xx, yy, zz + p, 3, c); // 서
        p += L;
      }
      s -= 2;
      xx += 1;
      zz += 1;
      yy += h;
    }
    return { x: xx, z: zz, y: yy };
  }

  result(meta) {
    return { ...meta, w: this.world.w, d: this.world.d, bricks: this.order.map((b) => [b.piece, b.x, b.y, b.z, b.rot, b.color]), errors: this.errors };
  }
}

import { cellKey } from './world.js';
function cellKeyLocal(x, y, z) {
  return cellKey(x, y, z);
}

function sizesFor(prefix, dims) {
  const out = [];
  for (const [a, b] of dims) {
    // 부품 id는 짧은변x긴변, 기본 방향은 w=긴변(x), d=짧은변(z)
    const id = `${prefix}_${a}x${b}`;
    const p = PIECE_BY_ID[id];
    if (!p) continue;
    out.push([p.w, p.d, id, 0]);
    if (p.w !== p.d) out.push([p.d, p.w, id, 1]);
  }
  out.sort((p, q) => q[0] * q[1] - p[0] * p[1] || q[0] - p[0]);
  return out;
}

export const FILL_SIZES = {
  plate: sizesFor('plate', [[16, 16], [8, 16], [8, 8], [6, 8], [6, 6], [4, 8], [4, 6], [4, 4], [2, 8], [2, 6], [2, 4], [2, 3], [2, 2], [1, 8], [1, 6], [1, 4], [1, 3], [1, 2], [1, 1]]),
  brick: sizesFor('brick', [[2, 8], [2, 6], [2, 4], [2, 3], [2, 2], [1, 8], [1, 6], [1, 4], [1, 3], [1, 2], [1, 1]]),
  tile: sizesFor('tile', [[2, 4], [2, 2], [1, 6], [1, 4], [1, 2], [1, 1]]),
  cobble: sizesFor('tile', [[2, 2], [1, 2], [1, 1]]),
};
