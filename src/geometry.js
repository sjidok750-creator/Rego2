// 부품 형상 생성. 실제 브릭 치수(8mm 피치, 스터드 Ø4.8×1.7mm, 이웃 부품 사이 0.1mm 간극)를 따른다.
// 로컬 좌표: 발자국 중심이 원점, 바닥 y=0. 스터드는 별도 인스턴스로 그리므로 몸체에는 포함하지 않는다.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLATE_H } from './pieces.js';

export const GAP = 0.0125; // 0.1mm
export const BEVEL = 0.034;
export const STUD_R = 0.3;
export const STUD_H = 0.2125;

// 모든 형상이 같은 속성(position, normal, aRough)을 갖도록 정리
function prep(geo, rough = 0) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const r = new Float32Array(n).fill(rough);
  g.setAttribute('aRough', new THREE.BufferAttribute(r, 1));
  return g;
}

function merge(list) {
  const g = mergeGeometries(list.filter(Boolean), false);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// 둥근 모서리가 있는 선반(lathe) 프로파일: 모서리마다 작은 호와 보조점
function roundedProfile(corners, radius, arcSeg = 3) {
  const out = [];
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i];
    const r = Array.isArray(p[2]) ? 0 : p[2] ?? radius;
    if (i === 0 || i === corners.length - 1 || r <= 0) {
      out.push(new THREE.Vector2(p[0], p[1]));
      continue;
    }
    const a = corners[i - 1], c = corners[i + 1];
    const v1 = new THREE.Vector2(a[0] - p[0], a[1] - p[1]).normalize();
    const v2 = new THREE.Vector2(c[0] - p[0], c[1] - p[1]).normalize();
    const cos = v1.dot(v2);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    const t = r / Math.tan(ang / 2);
    const s = new THREE.Vector2(p[0] + v1.x * t, p[1] + v1.y * t);
    const e = new THREE.Vector2(p[0] + v2.x * t, p[1] + v2.y * t);
    // 보조점: 곧은 면의 노멀이 호 쪽으로 기울지 않게
    out.push(new THREE.Vector2(s.x + v1.x * 0.004, s.y + v1.y * 0.004));
    for (let k = 0; k <= arcSeg; k++) {
      const u = k / arcSeg;
      // 2차 베지어로 근사한 호
      const q = new THREE.Vector2(
        (1 - u) * (1 - u) * s.x + 2 * (1 - u) * u * p[0] + u * u * e.x,
        (1 - u) * (1 - u) * s.y + 2 * (1 - u) * u * p[1] + u * u * e.y,
      );
      out.push(q);
    }
    out.push(new THREE.Vector2(e.x + v2.x * 0.004, e.y + v2.y * 0.004));
  }
  return out;
}

export function studGeometry(seg = 18) {
  const pts = roundedProfile(
    [
      [STUD_R, -0.03],
      [STUD_R, STUD_H, 0.028],
      [0, STUD_H],
    ],
    0.028,
    3,
  );
  return prep(new THREE.LatheGeometry(pts, seg));
}

function box(w, h, d, x = 0, y = 0, z = 0, radius = BEVEL, rough = 0) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  g.translate(x, y + h / 2, z);
  return prep(g, rough);
}

// 여러 높이의 사각형을 이어 만든 볼록 다면체(경사/역경사/코너/피라미드)
function frustum(piece, levels, matte) {
  const w = piece.w, d = piece.d;
  const cx = w / 2, cz = d / 2;
  const L = levels.map(([y, x0, z0, x1, z1]) => {
    const fx0 = x0 <= 0 ? GAP : x0, fz0 = z0 <= 0 ? GAP : z0;
    const fx1 = x1 >= w ? w - GAP : x1, fz1 = z1 >= d ? d - GAP : z1;
    return { y, x0: fx0 - cx, z0: fz0 - cz, x1: fx1 - cx, z1: fz1 - cz };
  });
  const pos = [];
  const rough = [];
  const center = new THREE.Vector3(0, L[L.length - 1].y / 2, 0);
  const tri = (a, b, c, r) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(ab, ac);
    if (n.lengthSq() < 1e-10) return;
    // 바깥을 향하도록
    const m = new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3).sub(center);
    if (n.dot(m) < 0) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    rough.push(r, r, r);
  };
  const quad = (a, b, c, e, r) => {
    tri(a, b, c, r);
    tri(a, c, e, r);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const b0 = L[0];
  quad(V(b0.x0, b0.y, b0.z0), V(b0.x1, b0.y, b0.z0), V(b0.x1, b0.y, b0.z1), V(b0.x0, b0.y, b0.z1), 0);
  const t = L[L.length - 1];
  if (t.x1 - t.x0 > 1e-4 && t.z1 - t.z0 > 1e-4) quad(V(t.x0, t.y, t.z0), V(t.x1, t.y, t.z0), V(t.x1, t.y, t.z1), V(t.x0, t.y, t.z1), 0);
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i], b = L[i + 1];
    const sides = [
      [V(a.x0, a.y, a.z1), V(a.x1, a.y, a.z1), V(b.x1, b.y, b.z1), V(b.x0, b.y, b.z1)], // 앞 +z
      [V(a.x1, a.y, a.z0), V(a.x0, a.y, a.z0), V(b.x0, b.y, b.z0), V(b.x1, b.y, b.z0)], // 뒤 -z
      [V(a.x1, a.y, a.z1), V(a.x1, a.y, a.z0), V(b.x1, b.y, b.z0), V(b.x1, b.y, b.z1)], // 오른쪽 +x
      [V(a.x0, a.y, a.z0), V(a.x0, a.y, a.z1), V(b.x0, b.y, b.z1), V(b.x0, b.y, b.z0)], // 왼쪽 -x
    ];
    for (const s of sides) {
      // 기울어진 면(수직이 아닌)은 무광 질감
      const e1 = new THREE.Vector3().subVectors(s[3], s[0]);
      const sloped = Math.abs(e1.x) + Math.abs(e1.z) > 0.05 && e1.y > 0.05;
      quad(s[0], s[1], s[2], s[3], sloped && matte ? 1 : 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute('aRough', new THREE.Float32BufferAttribute(rough, 1));
  return g;
}

function lathe(piece, kind, r) {
  const H = piece.h * PLATE_H;
  let pts, seg = 28;
  if (kind === 'cyl') {
    const R = r;
    seg = R > 0.6 ? 40 : 26;
    const collar = piece.id === 'round_brick_1x1';
    const c = [[0, 0], [R, 0, 0.02], [R, collar ? H - 0.15 : H, collar ? 0.02 : BEVEL]];
    if (collar) c.push([0.41, H - 0.13, 0.015], [0.41, H, 0.02]);
    c.push([0, H]);
    pts = roundedProfile(c, BEVEL);
  } else if (kind === 'cone') {
    seg = 26;
    pts = roundedProfile([[0, 0], [0.48, 0, 0.02], [0.48, 0.2, 0.02], [0.3, H - 0.02, 0.02], [0.3, H, 0.01], [0, H]], 0.02);
  } else if (kind === 'dome') {
    seg = 40;
    const c = [[0, 0], [0.98, 0, 0.02], [0.98, 0.3, 0]];
    for (let i = 1; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2);
      c.push([0.98 * Math.cos(a), 0.3 + (H - 0.3) * Math.sin(a), 0]);
    }
    pts = c.map((p) => new THREE.Vector2(p[0], p[1]));
  } else if (kind === 'antenna') {
    seg = 16;
    pts = roundedProfile(
      [[0, 0], [0.46, 0, 0.02], [0.46, 0.4, 0.03], [0.12, 0.42, 0.01], [0.07, 0.6, 0.01], [0.07, H - 0.12, 0.01], [0.1, H - 0.08, 0.01], [0.08, H, 0.02], [0, H]],
      0.02,
    );
  } else if (kind === 'pine') {
    seg = 22;
    pts = [
      [0, 0], [0.62, 0], [0.62, 0.34], [0.3, 0.4], [0.3, 0.85], [1.9, 1.0], [1.72, 1.2], [0.72, 3.05], [1.6, 3.15], [1.44, 3.35],
      [0.56, 4.95], [1.18, 5.05], [1.04, 5.25], [0.12, 7.05], [0, 7.2],
    ].map((p) => new THREE.Vector2(p[0], p[1]));
  } else if (kind === 'bush') {
    seg = 22;
    pts = [[0, 0], [0.8, 0], [0.94, 0.25], [0.88, 0.62], [0.97, 1.0], [0.86, 1.42], [0.62, 1.78], [0.3, 1.97], [0, 2.0]].map((p) => new THREE.Vector2(p[0], p[1]));
  }
  let g = new THREE.LatheGeometry(pts, seg);
  if (kind === 'pine' || kind === 'bush') {
    // 잎이 난 느낌의 불규칙한 결
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const rr = Math.hypot(x, z);
      if (rr < 0.35) continue;
      const a = Math.atan2(z, x);
      const k = 1 + 0.06 * Math.sin(a * 7 + y * 3.1) + 0.035 * Math.sin(a * 13 - y * 5.3);
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
  }
  return prep(g, kind === 'pine' || kind === 'bush' ? 0.8 : 0);
}

function arch(piece) {
  const w = piece.w, H = piece.h * PLATE_H;
  const [a, b] = piece.shape.span;
  const rise = piece.shape.rise;
  const inset = 0.018;
  const x0 = -w / 2 + GAP + inset, x1 = w / 2 - GAP - inset;
  const ax = a - w / 2 - inset, bx = b - w / 2 + inset;
  const cx = (ax + bx) / 2, rx = (bx - ax) / 2;
  const s = new THREE.Shape();
  s.moveTo(x0, inset);
  s.lineTo(ax, inset);
  s.absellipse(cx, inset, rx, rise + inset, Math.PI, 0, true);
  s.lineTo(x1, inset);
  s.lineTo(x1, H - inset);
  s.lineTo(x0, H - inset);
  s.lineTo(x0, inset);
  const depth = 1 - 2 * GAP - 2 * inset;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: inset, bevelSize: inset, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, -depth / 2);
  return prep(g);
}

// 창틀/문틀: 가운데가 뚫린 틀 + 유리(또는 문짝)
function framePart(w, H, hole, depth) {
  const inset = 0.016;
  const s = new THREE.Shape();
  const x0 = -w / 2 + GAP + inset, x1 = w / 2 - GAP - inset;
  s.moveTo(x0, inset);
  if (hole.bottom <= 0) {
    // 문틀: 아래가 열린 U자
    s.lineTo(hole.x0 - inset, inset);
    s.lineTo(hole.x0 - inset, hole.top + inset);
    s.lineTo(hole.x1 + inset, hole.top + inset);
    s.lineTo(hole.x1 + inset, inset);
    s.lineTo(x1, inset);
    s.lineTo(x1, H - inset);
    s.lineTo(x0, H - inset);
    s.lineTo(x0, inset);
  } else {
    s.moveTo(x0, inset);
    s.lineTo(x1, inset);
    s.lineTo(x1, H - inset);
    s.lineTo(x0, H - inset);
    s.lineTo(x0, inset);
    const h = new THREE.Path();
    h.moveTo(hole.x0 - inset, hole.bottom - inset);
    h.lineTo(hole.x0 - inset, hole.top + inset);
    h.lineTo(hole.x1 + inset, hole.top + inset);
    h.lineTo(hole.x1 + inset, hole.bottom - inset);
    h.lineTo(hole.x0 - inset, hole.bottom - inset);
    s.holes.push(h);
  }
  const dd = depth - 2 * inset;
  const g = new THREE.ExtrudeGeometry(s, { depth: dd, bevelEnabled: true, bevelThickness: inset, bevelSize: inset, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -dd / 2);
  return prep(g);
}

function flower() {
  const s = new THREE.Shape();
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.36 + 0.1 * Math.cos(a * 5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, z);
    else s.lineTo(x, z);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: PLATE_H - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.02, 0);
  return prep(g);
}

// 부품별 파트 목록: [{ geo, fixed?: 색상 id }]
const partCache = new Map();
export function pieceParts(piece) {
  if (partCache.has(piece.id)) return partCache.get(piece.id);
  const H = piece.h * PLATE_H;
  const w = piece.w, d = piece.d;
  const sh = piece.shape;
  let parts;
  switch (sh.type) {
    case 'box':
      parts = [{ geo: box(w - 2 * GAP, H - 0.002, d - 2 * GAP) }];
      break;
    case 'frustum':
      parts = [{ geo: frustum(piece, sh.levels, sh.matte) }];
      break;
    case 'lathe':
      parts = [{ geo: lathe(piece, sh.kind, sh.r) }];
      break;
    case 'arch':
      parts = [{ geo: arch(piece) }];
      break;
    case 'window': {
      const hole = { x0: -w / 2 + 0.2, x1: w / 2 - 0.2, bottom: 0.26, top: H - 0.2 };
      parts = [
        { geo: framePart(w, H, hole, 1 - 2 * GAP) },
        { geo: box(hole.x1 - hole.x0 + 0.06, hole.top - hole.bottom + 0.06, 0.05, 0, hole.bottom - 0.03, 0, 0.012), fixed: 'tclear' },
      ];
      if (piece.h >= 9) parts.push({ geo: box(0.07, hole.top - hole.bottom, 0.12, 0, hole.bottom, 0, 0.02) });
      break;
    }
    case 'door': {
      const hole = { x0: -w / 2 + 0.34, x1: w / 2 - 0.34, bottom: 0, top: H - 0.3 };
      const dw = hole.x1 - hole.x0 - 0.03;
      const panel = box(dw, hole.top - 0.02, 0.2, 0, 0.01, 0, 0.02);
      const knob = prep(new THREE.SphereGeometry(0.07, 12, 8).translate(dw / 2 - 0.22, 2.3, 0.14));
      const knob2 = prep(new THREE.SphereGeometry(0.07, 12, 8).translate(dw / 2 - 0.22, 2.3, -0.14));
      const panels = [];
      for (const [py, ph] of [[0.35, 1.9], [2.6, 2.6]]) {
        panels.push(box(dw - 0.5, ph, 0.24, 0, py, 0, 0.02));
      }
      parts = [
        { geo: framePart(w, H, hole, 1 - 2 * GAP) },
        { geo: merge([panel, ...panels]), fixed: 'brown' },
        { geo: merge([knob, knob2]), fixed: 'gold' },
      ];
      break;
    }
    case 'flower':
      parts = [{ geo: flower() }];
      break;
    case 'spire': {
      const f = frustum(piece, [[0, 0, 0, 2, 2], [0.14, 0, 0, 2, 2], [2.25, 0.93, 0.93, 1.07, 1.07]], true);
      const fin = prep(
        new THREE.LatheGeometry(
          roundedProfile([[0, 2.1], [0.08, 2.1, 0.01], [0.05, 2.6, 0.01], [0.11, 2.68, 0.02], [0.04, 2.78, 0.01], [0.035, 3.5, 0.01], [0, 3.52]], 0.01),
          12,
        ),
      );
      parts = [{ geo: merge([f, fin]) }];
      break;
    }
    default:
      parts = [{ geo: box(w - 2 * GAP, H, d - 2 * GAP) }];
  }
  partCache.set(piece.id, parts);
  return parts;
}

// 로컬 좌표의 스터드 위치(몸체 윗면)
export function studLocal(piece, x, z) {
  return new THREE.Vector3(x + 0.5 - piece.w / 2, piece.h * PLATE_H, z + 0.5 - piece.d / 2);
}

// 고스트/애니메이션/썸네일용: 몸체 + 스터드를 하나로 (고정 색 파트는 별도)
const fullCache = new Map();
let studGeoCache = null;
export function fullParts(piece) {
  if (fullCache.has(piece.id)) return fullCache.get(piece.id);
  if (!studGeoCache) studGeoCache = studGeometry(16);
  const parts = pieceParts(piece).map((p, i) => {
    if (i > 0 || !piece.studs.length) return p;
    const studs = piece.studs.map(([x, z]) => {
      const s = studGeoCache.clone();
      const v = studLocal(piece, x, z);
      s.translate(v.x, v.y, v.z);
      return s;
    });
    return { ...p, geo: merge([p.geo, ...studs]) };
  });
  fullCache.set(piece.id, parts);
  return parts;
}
