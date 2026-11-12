import { strict as assert } from 'node:assert';
import { Throttle } from '../../src/throttle';

describe('Throttle', () => {
  it('never runs more than the limit concurrently and preserves results', async () => {
    const t = new Throttle(2);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        t.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return n * 2;
        }),
      ),
    );
    assert.deepEqual(results, [2, 4, 6, 8, 10]);
    assert.equal(peak, 2);
  });

  it('propagates errors without blocking the queue', async () => {
    const t = new Throttle(1);
    await assert.rejects(t.run(() => Promise.reject(new Error('boom'))), /boom/);
    assert.equal(await t.run(() => 7), 7);
  });
});
