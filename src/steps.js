// 조립 설명서 단계 나누기: 조립 순서를 유지하면서 같은 높이·가까운 부품끼리 묶는다.
import { PIECE_BY_ID, oriented } from './pieces.js';

export function makeSteps(bricks, { maxPer = 6 } = {}) {
  const steps = [];
  let cur = null;
  bricks.forEach((b, i) => {
    const [pid, x, y, z, rot] = b;
    const o = oriented(PIECE_BY_ID[pid], rot);
    const cx = x + o.w / 2, cz = z + o.d / 2;
    const big = o.w * o.d >= 32; // 큰 판은 단독 단계
    let fresh = !cur || cur.items.length >= maxPer || big || cur.big;
    if (!fresh) {
      if (Math.abs(y - cur.y) > 1) fresh = true;
      else if (Math.hypot(cx - cur.cx, cz - cur.cz) > 9) fresh = true;
    }
    if (fresh) {
      cur = { items: [], y, cx, cz, big };
      steps.push(cur);
    }
    cur.items.push(i);
  });
  return steps.map((s) => s.items);
}

// 단계에 필요한 부품 목록: [{piece, color, n}]
export function stepParts(bricks, idxs) {
  const map = new Map();
  for (const i of idxs) {
    const [pid, , , , , color] = bricks[i];
    const k = pid + '|' + color;
    if (!map.has(k)) map.set(k, { piece: pid, color, n: 0 });
    map.get(k).n++;
  }
  return [...map.values()];
}
