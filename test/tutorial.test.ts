import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTutorial, TutorialRun } from '../src/client/tutorial.ts';

test('tutorial fantasma: falla, perfecto y salteo, y termina solo', () => {
  const p = planTutorial();
  assert.ok(p, 'no se encontró un plan de tutorial');
  assert.equal(p.steps.length, 3);
  const run = new TutorialRun(p);
  const seen: string[] = [];
  for (let i = 0; i < 4000 && !run.done; i++) {
    run.tick();
    for (const e of run.s.events!) if (e.type === 'miss' || e.type === 'capture') seen.push(e.type === 'miss' ? 'miss' : e.depth > 1 ? 'skip' : e.perfect ? 'perfect' : 'capture');
    run.s.events!.length = 0;
  }
  assert.ok(run.done);
  assert.deepEqual(seen, ['miss', 'perfect', 'skip']);
  assert.ok(p.endTick / 60 < 16, `dura ${p.endTick / 60} s`);
});
