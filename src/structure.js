// 구조 분석: 스터드 맞물림 그래프 위에서 하중 흐름을 추정하고 약한 연결부를 찾는다.
//
// 규칙
//  1) 떠 있음(loose)  : 바닥까지 이어지는 스터드 연결이 없는 브릭
//  2) 회전축(pivot)  : 유일한 연결 경로(브리지)가 스터드 1개뿐인데, 그 위에 매달린 질량이 큰 경우
//                       — 스터드 1개 연결은 돌아가 버린다
//  3) 돌출(overhang) : 하중 중심이 지지 스터드 영역 밖에 있어 생기는 모멘트가 연결 강도를 넘는 경우
//  4) 매달림(hanging): 아래로 매달린 부품의 하중이 스터드 결합력(클러치)을 넘는 경우
//
// 질량 단위: 1×1 플레이트 부피 = 1. 길이 단위: 스터드.
import { PIECE_BY_ID, oriented, PLATE_H } from './pieces.js';

export const K = {
  moment: 16, // 스터드 1개가 버티는 모멘트 (질량·스터드)
  tension: 16, // 스터드 1개가 버티는 매달림 하중
  compress: 150, // 히트맵용 압축 기준
  pivotWarn: 12,
  pivotCrit: 36,
  warn: 1,
  crit: 2.5,
};

function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// 볼록 다각형(반시계)까지 거리와 가장 가까운 점. 내부면 0
function distToHull(poly, p) {
  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -1e-9) {
      inside = false;
      break;
    }
  }
  if (inside) return { d: 0, q: p };
  let best = Infinity, bq = p;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz || 1e-9;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * dx, a[1] + t * dz];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best) {
      best = d;
      bq = q;
    }
  }
  return { d: best, q: bq };
}

export function analyze(world) {
  const bricks = [...world.bricks.values()];
  const info = new Map();
  for (const b of bricks) {
    const piece = PIECE_BY_ID[b.piece];
    const o = oriented(piece, b.rot);
    info.set(b.id, {
      b,
      o,
      m: piece.mass,
      cx: b.x + o.w / 2,
      cz: b.z + o.d / 2,
      cy: b.y + o.h / 2,
      edges: [],
      depth: -1,
      load: 0,
      mx: 0,
      mz: 0,
      stress: 0,
    });
  }

  // 연결 간선: 각 브릭의 아랫면(소켓) 기준으로 한 번씩만 만든다
  const edges = [];
  const groundEdges = [];
  for (const b of bricks) {
    const bi = info.get(b.id);
    for (const c of world.connections(b)) {
      if (c.up) continue;
      const e = { upper: b.id, lower: c.other, studs: c.studs, y: b.y, s: c.studs.length, ratio: 0, bridge: false, dep: 0 };
      edges.push(e);
      bi.edges.push(e);
      if (c.other === 'ground') groundEdges.push(e);
      else info.get(c.other).edges.push(e);
    }
  }
  const otherEnd = (e, id) => (e.upper === id ? e.lower : e.upper);

  // 바닥에서의 거리(BFS)
  const queue = [];
  for (const e of groundEdges) {
    const bi = info.get(e.upper);
    if (bi.depth === -1) {
      bi.depth = 1;
      queue.push(bi);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const bi = queue[qi];
    for (const e of bi.edges) {
      const oid = otherEnd(e, bi.b.id);
      if (oid === 'ground') continue;
      const oi = info.get(oid);
      if (oi.depth === -1) {
        oi.depth = bi.depth + 1;
        queue.push(oi);
      }
    }
  }

  const issues = [];
  const loose = new Set();
  for (const bi of info.values()) if (bi.depth === -1) loose.add(bi.b.id);
  if (loose.size) {
    for (const id of loose) {
      const bi = info.get(id);
      bi.stress = 3;
      issues.push({ type: 'loose', severity: 'crit', bricks: [id], at: [bi.cx, bi.b.y, bi.cz], ratio: 3 });
    }
  }

  // 하중 흐름: 깊은 브릭부터 한 단계 얕은 이웃으로 스터드 수 비례 분배
  const order = queue.slice().sort((a, b) => b.depth - a.depth);
  for (const bi of order) {
    const L = bi.m + bi.load;
    const comx = (bi.m * bi.cx + bi.mx) / L;
    const comz = (bi.m * bi.cz + bi.mz) / L;
    bi.total = L;
    const supports = bi.edges.filter((e) => {
      const oid = otherEnd(e, bi.b.id);
      return oid === 'ground' ? bi.depth === 1 : info.get(oid).depth === bi.depth - 1;
    });
    let S = 0;
    for (const e of supports) S += e.s;

    // 모멘트(돌출) 검사
    const corners = [];
    const centers = [];
    for (const e of supports) {
      for (const [x, z] of e.studs) {
        corners.push([x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]);
        centers.push([x + 0.5, z + 0.5]);
      }
    }
    const poly = hull(corners);
    const { d: over, q } = distToHull(poly, [comx, comz]);
    let momentRatio = 0;
    // 지지 영역 밖으로 벗어난 편심은 아래 브릭으로 그대로 전달된다
    const ox = over > 1e-6 ? comx - q[0] : 0;
    const oz = over > 1e-6 ? comz - q[1] : 0;
    if (over > 1e-6) {
      const ux = (comx - q[0]) / over, uz = (comz - q[1]) / over;
      let lo = Infinity, hi = -Infinity;
      for (const [x, z] of centers) {
        const t = x * ux + z * uz;
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
      momentRatio = (L * over) / (K.moment * S * (1 + (hi - lo)));
    }
    bi.momentRatio = momentRatio;
    let st = Math.max(momentRatio, (L / (S * K.compress)) * 0.6);

    for (const e of supports) {
      const share = (L * e.s) / S;
      const hanging = e.lower === bi.b.id; // 지지하는 쪽이 위에 있음 → 매달림
      let r = momentRatio;
      if (hanging) {
        const t = share / (K.tension * e.s);
        r = Math.max(r, t);
        if (t > st) st = t;
        e.tension = t;
      }
      e.ratio = Math.max(e.ratio, r);
      const oid = otherEnd(e, bi.b.id);
      if (oid !== 'ground') {
        // 하중은 연결 스터드 위치(+전달 편심)에 작용한다
        let px = 0, pz = 0;
        for (const [x, z] of e.studs) {
          px += x + 0.5;
          pz += z + 0.5;
        }
        px = px / e.s + ox;
        pz = pz / e.s + oz;
        const oi = info.get(oid);
        oi.load += share;
        oi.mx += share * px;
        oi.mz += share * pz;
      }
    }
    bi.stress = st;
    bi.supports = supports;

    if (momentRatio >= K.warn) {
      const at = jointCenter(supports);
      issues.push({
        type: 'overhang',
        severity: momentRatio >= K.crit ? 'crit' : 'warn',
        bricks: [bi.b.id],
        at,
        ratio: momentRatio,
      });
    }
    for (const e of supports) {
      if (e.tension >= K.warn) {
        issues.push({
          type: 'hanging',
          severity: e.tension >= K.crit ? 'crit' : 'warn',
          bricks: [bi.b.id],
          at: jointCenter([e]),
          ratio: e.tension,
        });
      }
    }
  }

  // 브리지(유일 경로) 찾기 — 바닥에서 시작하는 반복형 Tarjan
  findBridges(info, groundEdges, otherEnd);
  for (const e of edges) {
    if (!e.bridge || e.s !== 1) continue;
    if (e.dep > K.pivotWarn) {
      const r = e.dep / K.pivotWarn;
      e.ratio = Math.max(e.ratio, r);
      const child = e.childId;
      const ci = info.get(child);
      if (ci) ci.stress = Math.max(ci.stress, r);
      issues.push({
        type: 'pivot',
        severity: e.dep > K.pivotCrit ? 'crit' : 'warn',
        bricks: [e.upper, e.lower].filter((x) => x !== 'ground'),
        at: jointCenter([e]),
        ratio: r,
      });
    }
  }

  // 같은 위치의 중복 경고 정리
  const seen = new Set();
  const uniq = [];
  issues.sort((a, b) => b.ratio - a.ratio);
  for (const it of issues) {
    const k = it.at.map((v) => Math.round(v * 2)).join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(it);
  }

  const stress = new Map();
  for (const bi of info.values()) stress.set(bi.b.id, bi.stress);

  const joints = edges.map((e) => ({ at: jointCenter([e]), ratio: e.ratio, s: e.s, ground: e.lower === 'ground' }));

  let mass = 0;
  for (const bi of info.values()) mass += bi.m;

  return {
    count: bricks.length,
    mass,
    issues: uniq,
    weak: uniq.filter((i) => i.type !== 'loose').length,
    loose: loose.size,
    stress,
    joints,
    ok: uniq.length === 0,
  };
}

function jointCenter(edgeList) {
  let x = 0, z = 0, n = 0, y = 0;
  for (const e of edgeList) {
    for (const [sx, sz] of e.studs) {
      x += sx + 0.5;
      z += sz + 0.5;
      y += e.y;
      n++;
    }
  }
  return n ? [x / n, y / n, z / n] : [0, 0, 0];
}

function findBridges(info, groundEdges, otherEnd) {
  // 노드: 'ground' + 브릭 id. 간선 객체로 방문 표시(다중 간선 없음: 브릭 쌍당 하나)
  const disc = new Map();
  const low = new Map();
  const sub = new Map(); // 부분트리 질량
  let t = 0;
  const adj = (id) => (id === 'ground' ? groundEdges : info.get(id).edges);
  const mass = (id) => (id === 'ground' ? 0 : info.get(id).m);

  const stack = [{ id: 'ground', parentEdge: null, i: 0 }];
  disc.set('ground', t);
  low.set('ground', t);
  sub.set('ground', 0);
  t++;
  while (stack.length) {
    const fr = stack[stack.length - 1];
    const list = adj(fr.id);
    if (fr.i < list.length) {
      const e = list[fr.i++];
      if (e === fr.parentEdge) continue;
      const nb = otherEnd(e, fr.id);
      if (!disc.has(nb)) {
        disc.set(nb, t);
        low.set(nb, t);
        sub.set(nb, mass(nb));
        t++;
        stack.push({ id: nb, parentEdge: e, i: 0 });
      } else {
        low.set(fr.id, Math.min(low.get(fr.id), disc.get(nb)));
      }
    } else {
      stack.pop();
      if (stack.length) {
        const parent = stack[stack.length - 1];
        low.set(parent.id, Math.min(low.get(parent.id), low.get(fr.id)));
        sub.set(parent.id, sub.get(parent.id) + sub.get(fr.id));
        if (low.get(fr.id) > disc.get(parent.id)) {
          fr.parentEdge.bridge = true;
          fr.parentEdge.dep = sub.get(fr.id);
          fr.parentEdge.childId = fr.id;
        }
      }
    }
  }
}

export function stressColor(v) {
  // 0 → 차가운 청록, 0.5 → 초록/노랑, 1+ → 주황/빨강
  const stops = [
    [0, [0.23, 0.5, 0.78]],
    [0.25, [0.27, 0.69, 0.62]],
    [0.5, [0.55, 0.78, 0.35]],
    [0.75, [0.96, 0.78, 0.25]],
    [1.0, [0.95, 0.5, 0.18]],
    [2.0, [0.84, 0.18, 0.13]],
  ];
  if (v <= 0) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      return ca.map((c, k) => c + (cb[k] - c) * t);
    }
  }
  return stops[stops.length - 1][1];
}

export const ISSUE_LABEL = {
  loose: '떠 있는 부품',
  pivot: '스터드 1개 회전축',
  overhang: '과도한 돌출',
  hanging: '매달림 하중 초과',
};

export { PLATE_H };
