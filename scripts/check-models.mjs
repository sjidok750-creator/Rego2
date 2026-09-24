import { MODEL_IDS, getModel } from '../src/models.js';
import { World } from '../src/world.js';
import { analyze, ISSUE_LABEL } from '../src/structure.js';

for (const id of MODEL_IDS) {
  const m = getModel(id);
  const w = new World({ w: m.w, d: m.d });
  for (const [p, x, y, z, r, c] of m.bricks) w.place(p, x, y, z, r, c, { force: true });
  const a = analyze(w);
  const b = w.bounds();
  console.log(`${id.padEnd(11)} bricks=${String(m.bricks.length).padStart(4)} errors=${m.errors.length} weak=${a.weak} loose=${a.loose} height=${b.maxY}`);
  for (const e of m.errors.slice(0, 12)) console.log('   ERR', JSON.stringify(e));
  for (const i of a.issues.slice(0, 8)) console.log('   ISSUE', ISSUE_LABEL[i.type], i.severity, i.ratio.toFixed(2), i.at.map((v) => +v.toFixed(1)).join(','), i.bricks.map((id) => w.bricks.get(id)?.piece).join(' '));
}
