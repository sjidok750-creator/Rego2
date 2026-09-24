import test from 'node:test';
import assert from 'node:assert/strict';
import { synthSnap, synthPluck, synthThud } from '../src/audio.js';

const SR = 48000;

// 영점 교차율로 대략적인 밝기(주파수대)를 잰다
function zcr(buf, n) {
  let c = 0;
  for (let i = 1; i < n; i++) if ((buf[i - 1] < 0) !== (buf[i] < 0)) c++;
  return (c / n) * SR / 2;
}

test('snap clicks are finite, normalized and short', () => {
  for (const opts of [{ pitch: 1.25, body: 0.6, weight: 0.15 }, { pitch: 1, body: 1, weight: 0.45 }, { pitch: 0.78, body: 1.3, weight: 0.9 }]) {
    const b = synthSnap(SR, { ...opts, seed: 3 });
    let peak = 0;
    for (const v of b) {
      assert.ok(Number.isFinite(v));
      peak = Math.max(peak, Math.abs(v));
    }
    assert.ok(peak > 0.85 && peak <= 0.93);
    // 에너지 대부분이 앞 60ms 안에 몰려 있어야 딸깍 소리
    let early = 0, total = 0;
    for (let i = 0; i < b.length; i++) {
      total += b[i] * b[i];
      if (i < SR * 0.06) early += b[i] * b[i];
    }
    assert.ok(early / total > 0.9);
  }
});

test('small bricks click brighter than large ones', () => {
  const s = synthSnap(SR, { pitch: 1.25, body: 0.6, weight: 0.15, seed: 1 });
  const l = synthSnap(SR, { pitch: 0.78, body: 1.3, weight: 0.9, seed: 1 });
  assert.ok(zcr(s, SR * 0.03) > zcr(l, SR * 0.03));
});

test('pluck and thud render', () => {
  for (const b of [synthPluck(SR, 1), synthThud(SR, 2)]) {
    assert.ok(b.length > SR * 0.1);
    assert.ok(b.every(Number.isFinite));
  }
});
