import { strict as assert } from 'node:assert';
import { Entry, KindGroup, filterAndSort, kindGroup } from '../../src/leaderboardModel';

let n = 0;
function entry(name: string, kind: string, project: number, inFile: number, extra: Partial<Entry> = {}): Entry {
  return { id: `e${n++}`, name, kind, group: kindGroup(kind), file: 'src/a.ts', line: n, inFile, project, ...extra };
}

const all = (groups: KindGroup[] = [], query = '', direction: 'asc' | 'desc' = 'desc') => ({
  groups: new Set(groups),
  query,
  direction,
});

describe('leaderboardModel', () => {
  const entries = [
    entry('add', 'Function', 4, 1),
    entry('Meter', 'Class', 3, 0, { file: 'app/models.py' }),
    entry('read', 'Method', 2, 2, { container: 'Meter', file: 'app/models.py' }),
    entry('Shape', 'Interface', 2, 2),
    entry('unusedHelper', 'Function', 0, 0),
  ];

  it('groups kinds, with type-like kinds as "object"', () => {
    assert.equal(kindGroup('Class'), 'class');
    assert.equal(kindGroup('Function'), 'function');
    assert.equal(kindGroup('Method'), 'method');
    assert.equal(kindGroup('Constructor'), 'method');
    for (const k of ['Interface', 'Struct', 'Enum', 'Object', 'Variable']) {
      assert.equal(kindGroup(k), 'object');
    }
  });

  it('ranks most used first and shares ranks on ties', () => {
    const rows = filterAndSort(entries, all());
    assert.deepEqual(
      rows.map((r) => [r.name, r.rank]),
      [
        ['add', 1],
        ['Meter', 2],
        ['read', 3],
        ['Shape', 3],
        ['unusedHelper', 5],
      ],
    );
  });

  it('reverses the order for least used first', () => {
    const rows = filterAndSort(entries, all([], '', 'asc'));
    assert.equal(rows[0].name, 'unusedHelper');
    assert.equal(rows[rows.length - 1].name, 'add');
  });

  it('filters by group', () => {
    assert.deepEqual(
      filterAndSort(entries, all(['function'])).map((r) => r.name),
      ['add', 'unusedHelper'],
    );
    assert.deepEqual(
      filterAndSort(entries, all(['method', 'object'])).map((r) => r.name),
      ['read', 'Shape'],
    );
  });

  it('searches name, container and file, case-insensitively', () => {
    assert.deepEqual(filterAndSort(entries, all([], 'meter.R')).map((r) => r.name), ['read']);
    assert.deepEqual(filterAndSort(entries, all([], 'MODELS')).map((r) => r.name), ['Meter', 'read']);
    assert.equal(filterAndSort(entries, all([], '   ')).length, entries.length);
    assert.equal(filterAndSort(entries, all([], 'nothing-matches')).length, 0);
  });
});
