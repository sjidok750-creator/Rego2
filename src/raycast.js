// 격자 광선 추적(Amanatides–Woo). 격자 공간: x,z = 스터드, y = 플레이트.
import { cellKey } from './world.js';
import { PLATE_H } from './pieces.js';

// ray: three.js Ray(월드). 반환: { cell:[x,y,z], normal:[nx,ny,nz], id } | { ground:true, cell:[x,-1,z], normal:[0,1,0] } | null
export function castGrid(world, ray, maxY = 400) {
  const W = world.w, D = world.d;
  const o = [ray.origin.x + W / 2, ray.origin.y / PLATE_H, ray.origin.z + D / 2];
  const d = [ray.direction.x, ray.direction.y / PLATE_H, ray.direction.z];
  const lo = [0, 0, 0], hi = [W, maxY, D];
  // AABB 교차
  let t0 = 0, t1 = Infinity, entryAxis = -1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) {
      t0 = ta;
      entryAxis = a;
    }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  const p = [o[0] + d[0] * (t0 + 1e-6), o[1] + d[1] * (t0 + 1e-6), o[2] + d[2] * (t0 + 1e-6)];
  const cell = p.map((v, a) => Math.min(Math.max(Math.floor(v), lo[a]), hi[a] - 1));
  const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
  const tMax = [0, 0, 0], tDelta = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    if (step[a] === 0) {
      tMax[a] = Infinity;
      tDelta[a] = Infinity;
    } else {
      const next = step[a] > 0 ? cell[a] + 1 : cell[a];
      tMax[a] = t0 + (next - p[a]) / d[a];
      tDelta[a] = Math.abs(1 / d[a]);
    }
  }
  let axis = entryAxis;
  for (let i = 0; i < 4000; i++) {
    const id = world.occ.get(cellKey(cell[0], cell[1], cell[2]));
    if (id !== undefined) {
      const normal = [0, 0, 0];
      if (axis >= 0) normal[axis] = -step[axis];
      else normal[1] = 1;
      return { cell: cell.slice(), normal, id };
    }
    // 다음 칸
    axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    cell[axis] += step[axis];
    if (cell[axis] < lo[axis] || cell[axis] >= hi[axis]) {
      if (axis === 1 && cell[1] < 0) return { ground: true, cell: [cell[0], -1, cell[2]], normal: [0, 1, 0] };
      return null;
    }
    tMax[axis] += tDelta[axis];
  }
  return null;
}

// 광선–상자 교차 (월드 좌표 AABB)
export function rayBox(ray, min, max) {
  let t0 = 0, t1 = Infinity;
  const o = ray.origin, d = ray.direction;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
      continue;
    }
    let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}
