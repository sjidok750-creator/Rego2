import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { analyze } from '../src/structure.js';
import { PIECE_BY_ID, oriented } from '../src/pieces.js';

test('rotation maps footprint consistently', () => {
  const p = PIECE_BY_ID.slope45_2x4; // w=4, d=2
  const o1 = oriented(p, 1);
  assert.equal(o1.w, 2);
  assert.equal(o1.d, 4);
  const o4 = oriented(p, 4);
  assert.deepEqual(o4.studs, p.studs);
  // 모든 칸이 회전 후에도 발자국 안에 있다
  for (let r = 0; r < 4; r++) {
    const o = oriented(p, r);
    for (const [x, , z] of o.cells) {
      assert.ok(x >= 0 && x < o.w && z >= 0 && z < o.d);
    }
  }
});

test('placement needs a stud connection and no collision', () => {
  const w = new World({ w: 16, d: 16 });
  assert.ok(w.place('brick_2x4', 0, 0, 0, 0, 'red'));
  // 겹침
  assert.equal(w.check('brick_2x2', 1, 0, 0, 0).reason, 'collide');
  // 공중
  assert.equal(w.check('brick_2x2', 8, 6, 8, 0).reason, 'float');
  // 위에 올리기 (한 칸만 걸쳐도 됨)
  const r = w.check('brick_2x4', 3, 3, 1, 0);
  assert.ok(r.ok);
  assert.equal(r.conns[0].studs.length, 1);
  // 타일 위에는 연결 불가
  w.place('tile_2x2', 10, 0, 10, 0, 'white');
  assert.equal(w.check('plate_2x2', 10, 1, 10, 0).reason, 'float');
});

test('hanging under a brick counts as a connection', () => {
  const w = new World({ w: 16, d: 16 });
  w.place('brick_1x1', 0, 0, 0, 0, 'red');
  w.place('brick_1x1', 0, 3, 0, 0, 'red');
  w.place('plate_1x4', 0, 6, 0, 0, 'red'); // x 0..3
  // 플레이트 아래 x=3에 매달기
  const r = w.check('brick_1x1', 3, 3, 0, 0);
  assert.ok(r.ok);
  assert.ok(r.conns[0].up);
});

test('removing a support makes the rest fall', () => {
  const w = new World({ w: 16, d: 16 });
  const a = w.place('brick_2x2', 0, 0, 0, 0, 'red');
  w.place('brick_2x2', 0, 3, 0, 0, 'blue');
  w.place('brick_2x2', 0, 6, 0, 0, 'blue');
  w.remove(a.id);
  const falls = w.settle();
  assert.equal(falls.length, 1);
  assert.equal(falls[0].drop, 3);
  assert.equal(w.groundedSet().size, 2);
});

test('solid wall has no weak joints', () => {
  const w = new World({ w: 16, d: 16 });
  for (let c = 0; c < 6; c++) {
    const off = c % 2 ? 2 : 0;
    for (let x = -off; x < 12; x += 4) {
      const x0 = Math.max(0, x);
      const len = Math.min(x + 4, 12) - x0;
      const id = len === 4 ? 'brick_1x4' : len === 2 ? 'brick_1x2' : 'brick_1x1';
      assert.ok(w.place(id, x0, c * 3, 0, 0, 'red'), `course ${c} x ${x0}`);
    }
  }
  const a = analyze(w);
  assert.equal(a.issues.length, 0, JSON.stringify(a.issues));
});

test('long cantilever on one stud is weak, short one is fine', () => {
  const w = new World({ w: 16, d: 16 });
  w.place('brick_2x2', 0, 0, 0, 0, 'red');
  w.place('plate_1x8', 1, 3, 0, 0, 'red'); // x 1..8, 스터드 1개(x=1)
  const a = analyze(w);
  assert.ok(a.issues.some((i) => i.type === 'overhang'), JSON.stringify(a.issues));

  const w2 = new World({ w: 16, d: 16 });
  w2.place('brick_2x2', 0, 0, 0, 0, 'red');
  w2.place('plate_1x4', 1, 3, 0, 0, 'red');
  assert.equal(analyze(w2).issues.length, 0);
});

test('tall 1x1 column is a pivot risk', () => {
  const w = new World({ w: 16, d: 16 });
  w.place('plate_4x4', 0, 0, 0, 0, 'dbg');
  for (let i = 0; i < 6; i++) w.place('round_brick_1x1', 1, 1 + i * 3, 1, 0, 'sandblue');
  const a = analyze(w);
  assert.ok(a.issues.some((i) => i.type === 'pivot'), JSON.stringify(a.issues));
});

test('floating bricks are reported as loose', () => {
  const w = new World({ w: 16, d: 16 });
  w.place('brick_2x2', 0, 0, 0, 0, 'red');
  w.place('brick_2x2', 5, 6, 5, 0, 'red', { force: true });
  const a = analyze(w);
  assert.equal(a.loose, 1);
});
