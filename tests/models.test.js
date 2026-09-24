import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_IDS, getModel } from '../src/models.js';
import { World } from '../src/world.js';
import { analyze } from '../src/structure.js';

for (const id of MODEL_IDS) {
  test(`model ${id} assembles in order and holds together`, () => {
    const m = getModel(id);
    assert.equal(m.errors.length, 0, JSON.stringify(m.errors.slice(0, 3)));
    // 저장된 순서대로 하나씩 넣어도 매번 연결되어야 한다(설명서 순서 검증)
    const w = new World({ w: m.w, d: m.d });
    for (const [p, x, y, z, r, c] of m.bricks) assert.ok(w.place(p, x, y, z, r, c), `${p} @ ${x},${y},${z}`);
    const a = analyze(w);
    assert.equal(a.loose, 0);
    if (id === 'wobbly') assert.ok(a.weak > 0);
    else assert.equal(a.weak, 0, JSON.stringify(a.issues.slice(0, 3)));
  });
}
