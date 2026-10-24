// Demo mode: two simulated devices (separate in-memory stores). Fully deterministic.
import { Engine } from './core.js';
import { MemoryStore } from './stores.js';

export function makeDevice(deviceId, clock) {
  let i = 0;
  return new Engine(new MemoryStore(), {
    deviceId,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock.t++)).toISOString(),
    newId: () => `${deviceId}-n${++i}`,
  });
}

const titles = async (e) => (await e.list()).map((n) => n.title).sort().join(' | ');

export async function runDemo() {
  const clock = { t: 0 };
  const A = makeDevice('demo-A', clock);
  const B = makeDevice('demo-B', clock);
  const log = [];
  const check = (step, ok, detail) => log.push({ step, ok: !!ok, detail });

  const n = await A.create('Shopping list', 'milk');
  let s = await B.importJSON(await A.exportJSON());
  check('1. A creates a note, B imports it', s.added === 1 && (await titles(B)) === 'Shopping list', `added=${s.added}`);

  s = await B.importJSON(await A.exportJSON());
  check('2. Importing the same file again changes nothing', s.added === 0 && s.duplicates === 1, `duplicates=${s.duplicates}`);

  await A.update(n.id, 'Shopping list', 'milk, eggs');
  await B.update(n.id, 'Shopping list', 'milk, bread');
  s = await A.importJSON(await B.exportJSON());
  const aNote = (await A.list())[0];
  check('3. Both edit offline -> conflict detected, local text untouched', s.conflicts === 1 && aNote.body === 'milk, eggs', `conflicts=${s.conflicts}`);

  const [c] = await A.getConflicts();
  await A.resolve(c.id, 'both');
  check('4. Resolve "keep both": no text lost', (await A.list()).some((x) => x.body === 'milk, eggs') && (await A.list()).some((x) => x.body === 'milk, bread'), await titles(A));

  s = await B.importJSON(await A.exportJSON());
  check('5. B imports resolved state: no new conflict, devices match', s.conflicts === 0 && (await titles(A)) === (await titles(B)), `B has: ${await titles(B)}`);
  return log;
}
