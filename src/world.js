// 격자 기반 조립 세계: 점유 칸, 스터드/소켓 맞물림, 연결 그래프.
// three.js에 의존하지 않으므로 Node에서도 테스트할 수 있다.
import { PIECE_BY_ID, oriented } from './pieces.js';

const OFF = 1024;
export function cellKey(x, y, z) {
  return (y + 64) * 4194304 + (z + OFF) * 2048 + (x + OFF);
}

let nextId = 1;
export function newId() {
  return nextId++;
}
export function bumpId(id) {
  if (id >= nextId) nextId = id + 1;
}

export class World {
  constructor({ w = 32, d = 32, maxH = 300 } = {}) {
    this.w = w;
    this.d = d;
    this.maxH = maxH;
    this.bricks = new Map();
    this.occ = new Map();
    this.studMap = new Map(); // (x, 윗면 y, z) → brick id
    this.sockMap = new Map(); // (x, 아랫면 y, z) → brick id
  }

  resize(w, d) {
    this.w = w;
    this.d = d;
  }

  clear() {
    this.bricks.clear();
    this.occ.clear();
    this.studMap.clear();
    this.sockMap.clear();
  }

  get size() {
    return this.bricks.size;
  }

  inBounds(o, x, y, z) {
    return x >= 0 && z >= 0 && y >= 0 && x + o.w <= this.w && z + o.d <= this.d && y + o.h <= this.maxH;
  }

  collides(o, x, y, z, ignore) {
    for (const [cx, cy, cz] of o.cells) {
      const id = this.occ.get(cellKey(x + cx, y + cy, z + cz));
      if (id !== undefined && !(ignore && ignore.has(id))) return true;
    }
    return false;
  }

  // 가상의 위치에서 생기는 연결 목록. ground: 바닥(y=0) 연결
  connectionsAt(o, x, y, z, ignore) {
    const byId = new Map();
    const push = (other, sx, sz, up) => {
      let c = byId.get(other);
      if (!c) {
        c = { other, studs: [], up };
        byId.set(other, c);
      }
      c.studs.push([sx, sz]);
    };
    for (const [sx, sz] of o.sockets) {
      const gx = x + sx, gz = z + sz;
      if (y === 0) {
        push('ground', gx, gz, false);
      } else {
        const id = this.studMap.get(cellKey(gx, y, gz));
        if (id !== undefined && !(ignore && ignore.has(id))) push(id, gx, gz, false);
      }
    }
    const top = y + o.h;
    for (const [sx, sz] of o.studs) {
      const gx = x + sx, gz = z + sz;
      const id = this.sockMap.get(cellKey(gx, top, gz));
      if (id !== undefined && !(ignore && ignore.has(id))) push(id, gx, gz, true);
    }
    return [...byId.values()];
  }

  check(pieceId, x, y, z, rot) {
    const piece = PIECE_BY_ID[pieceId];
    const o = oriented(piece, rot);
    if (!this.inBounds(o, x, y, z)) return { ok: false, reason: 'bounds', conns: [] };
    if (this.collides(o, x, y, z)) return { ok: false, reason: 'collide', conns: [] };
    const conns = this.connectionsAt(o, x, y, z);
    if (conns.length === 0) return { ok: false, reason: 'float', conns };
    return { ok: true, conns };
  }

  // 충돌하지 않는 가장 낮은 높이(y0 이상)를 찾는다.
  liftToFree(pieceId, x, y0, z, rot, maxLift = 60) {
    const o = oriented(PIECE_BY_ID[pieceId], rot);
    for (let y = Math.max(0, y0); y < y0 + maxLift; y++) {
      if (!this.collides(o, x, y, z)) return y;
    }
    return -1;
  }

  add(b) {
    const piece = PIECE_BY_ID[b.piece];
    const o = oriented(piece, b.rot);
    if (b.id === undefined) b.id = newId();
    else bumpId(b.id);
    this.bricks.set(b.id, b);
    for (const [cx, cy, cz] of o.cells) this.occ.set(cellKey(b.x + cx, b.y + cy, b.z + cz), b.id);
    const top = b.y + o.h;
    for (const [sx, sz] of o.studs) this.studMap.set(cellKey(b.x + sx, top, b.z + sz), b.id);
    for (const [sx, sz] of o.sockets) this.sockMap.set(cellKey(b.x + sx, b.y, b.z + sz), b.id);
    return b;
  }

  place(pieceId, x, y, z, rot, color, { force = false } = {}) {
    const res = this.check(pieceId, x, y, z, rot);
    if (!res.ok && !force) return null;
    return this.add({ piece: pieceId, x, y, z, rot: ((rot % 4) + 4) % 4, color });
  }

  remove(id) {
    const b = this.bricks.get(id);
    if (!b) return null;
    const o = oriented(PIECE_BY_ID[b.piece], b.rot);
    for (const [cx, cy, cz] of o.cells) {
      const k = cellKey(b.x + cx, b.y + cy, b.z + cz);
      if (this.occ.get(k) === id) this.occ.delete(k);
    }
    const top = b.y + o.h;
    for (const [sx, sz] of o.studs) {
      const k = cellKey(b.x + sx, top, b.z + sz);
      if (this.studMap.get(k) === id) this.studMap.delete(k);
    }
    for (const [sx, sz] of o.sockets) {
      const k = cellKey(b.x + sx, b.y, b.z + sz);
      if (this.sockMap.get(k) === id) this.sockMap.delete(k);
    }
    this.bricks.delete(id);
    return b;
  }

  // 원래 위치(격자) 기준으로 이동: 제거 후 재추가
  move(id, dx, dy, dz) {
    const b = this.remove(id);
    if (!b) return null;
    b.x += dx;
    b.y += dy;
    b.z += dz;
    return this.add(b);
  }

  connections(b) {
    const o = oriented(PIECE_BY_ID[b.piece], b.rot);
    return this.connectionsAt(o, b.x, b.y, b.z, new Set([b.id]));
  }

  brickAtCell(x, y, z) {
    const id = this.occ.get(cellKey(x, y, z));
    return id === undefined ? null : this.bricks.get(id);
  }

  // 바닥과 연결된 브릭 집합 (BFS)
  groundedSet() {
    const seen = new Set();
    const queue = [];
    for (const b of this.bricks.values()) {
      if (b.y === 0) {
        seen.add(b.id);
        queue.push(b);
      }
    }
    while (queue.length) {
      const b = queue.pop();
      for (const c of this.connections(b)) {
        if (c.other === 'ground' || seen.has(c.other)) continue;
        seen.add(c.other);
        queue.push(this.bricks.get(c.other));
      }
    }
    return seen;
  }

  // 연결 요소(바닥 제외)로 묶기
  components(ids) {
    const left = new Set(ids);
    const comps = [];
    for (const start of ids) {
      if (!left.has(start)) continue;
      left.delete(start);
      const comp = [start];
      const stack = [start];
      while (stack.length) {
        const b = this.bricks.get(stack.pop());
        for (const c of this.connections(b)) {
          if (c.other !== 'ground' && left.has(c.other)) {
            left.delete(c.other);
            comp.push(c.other);
            stack.push(c.other);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  // 떠 있는 덩어리를 아래로 떨어뜨린다. 반환: [{ids, drop}] (drop: 떨어진 플레이트 수)
  settle() {
    const grounded = this.groundedSet();
    const loose = [...this.bricks.keys()].filter((id) => !grounded.has(id));
    if (!loose.length) return [];
    const comps = this.components(loose);
    // 낮은 덩어리부터 처리
    comps.sort((a, b) => Math.min(...a.map((id) => this.bricks.get(id).y)) - Math.min(...b.map((id) => this.bricks.get(id).y)));
    const falls = [];
    for (const comp of comps) {
      const set = new Set(comp);
      const bricks = comp.map((id) => this.bricks.get(id));
      const minY = Math.min(...bricks.map((b) => b.y));
      let drop = 0;
      // 한 칸씩 내려보며 충돌 직전까지
      for (let k = 1; k <= minY; k++) {
        let hit = false;
        for (const b of bricks) {
          const o = oriented(PIECE_BY_ID[b.piece], b.rot);
          if (this.collides(o, b.x, b.y - k, b.z, set)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
        drop = k;
        // 새 위치에서 스터드가 물리면 멈춘다
        let connected = false;
        for (const b of bricks) {
          const o = oriented(PIECE_BY_ID[b.piece], b.rot);
          const conns = this.connectionsAt(o, b.x, b.y - k, b.z, set);
          if (conns.some((c) => !c.up)) {
            connected = true;
            break;
          }
        }
        if (connected) break;
      }
      if (drop > 0) {
        for (const b of bricks) this.remove(b.id);
        for (const b of bricks) {
          b.y -= drop;
          this.add(b);
        }
      }
      falls.push({ ids: comp, drop });
    }
    return falls;
  }

  bounds() {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of this.bricks.values()) {
      const o = oriented(PIECE_BY_ID[b.piece], b.rot);
      minX = Math.min(minX, b.x);
      minZ = Math.min(minZ, b.z);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + o.w);
      maxZ = Math.max(maxZ, b.z + o.d);
      maxY = Math.max(maxY, b.y + o.h);
    }
    if (minX === Infinity) return null;
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }

  serialize() {
    return {
      v: 1,
      w: this.w,
      d: this.d,
      bricks: [...this.bricks.values()].map((b) => [b.piece, b.x, b.y, b.z, b.rot, b.color]),
    };
  }
}
