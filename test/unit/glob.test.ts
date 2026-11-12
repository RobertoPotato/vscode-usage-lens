import { strict as assert } from 'node:assert';
import {
  ExclusionMatcher,
  bareName,
  buildExcludeGlob,
  formatLabel,
  lineStarts,
  normalizeRelPath,
  offsetToLineCol,
  scanWord,
  toAnchoredGlob,
} from '../../src/glob';

describe('toAnchoredGlob', () => {
  it('makes bare names match at any depth', () => assert.equal(toAnchoredGlob('venv'), '**/venv'));
  it('anchors leading-slash patterns', () => assert.equal(toAnchoredGlob('/scripts/legacy'), 'scripts/legacy'));
  it('anchors patterns with an inner slash', () => assert.equal(toAnchoredGlob('src/vendor'), 'src/vendor'));
  it('drops trailing slashes', () => assert.equal(toAnchoredGlob('build/'), '**/build'));
  it('ignores blanks and comments', () => {
    assert.equal(toAnchoredGlob('  '), undefined);
    assert.equal(toAnchoredGlob('# note'), undefined);
  });
});

describe('ExclusionMatcher', () => {
  const m = new ExclusionMatcher(['venv', '/scripts/legacy', 'src/vendor', '*.min.js', '{tmp,cache}', 'gen?', '[ab]x', '**/migrations/**']);

  it('matches bare names at any depth, including descendants', () => {
    assert.ok(m.isExcluded('venv'));
    assert.ok(m.isExcluded('venv/lib/python3.12/site.py'));
    assert.ok(m.isExcluded('apps/api/venv/x.py'));
    assert.ok(!m.isExcluded('venvy/x.py'));
    assert.ok(!m.isExcluded('my_venv/x.py'));
  });
  it('anchors leading-slash and inner-slash patterns to the root', () => {
    assert.ok(m.isExcluded('scripts/legacy/old.py'));
    assert.ok(!m.isExcluded('tools/scripts/legacy/old.py'));
    assert.ok(m.isExcluded('src/vendor/lib.js'));
    assert.ok(!m.isExcluded('pkg/src/vendor/lib.js'));
  });
  it('supports *, ?, braces and character classes', () => {
    assert.ok(m.isExcluded('static/app.min.js'));
    assert.ok(!m.isExcluded('static/app.js'));
    assert.ok(m.isExcluded('a/tmp/x'));
    assert.ok(m.isExcluded('cache/x'));
    assert.ok(m.isExcluded('gen1/x'));
    assert.ok(!m.isExcluded('gen12/x'));
    assert.ok(m.isExcluded('ax/y'));
    assert.ok(!m.isExcluded('cx/y'));
  });
  it('handles ** patterns and Windows separators', () => {
    assert.ok(m.isExcluded('app/migrations/0001_initial.py'));
    assert.ok(m.isExcluded('apps\\api\\venv\\x.py'));
  });
  it('matches dotfolders', () => {
    assert.ok(new ExclusionMatcher(['.venv']).isExcluded('.venv/bin/python'));
  });
  it('supports case-insensitive matching', () => {
    assert.ok(new ExclusionMatcher(['Build'], { nocase: true }).isExcluded('build/x'));
    assert.ok(!new ExclusionMatcher(['Build']).isExcluded('build/x'));
  });
  it('is empty with no patterns', () => {
    const e = new ExclusionMatcher([]);
    assert.ok(e.isEmpty);
    assert.ok(!e.isExcluded('anything'));
  });
});

describe('buildExcludeGlob', () => {
  it('builds a brace list covering path and descendants', () => {
    assert.equal(buildExcludeGlob(['venv', '/out']), '{**/venv,**/venv/**,out,out/**}');
  });
  it('returns undefined for no patterns', () => assert.equal(buildExcludeGlob([]), undefined));
  it('returns a single glob unwrapped', () => assert.equal(buildExcludeGlob(['**/x/**']), '**/x/**'));
});

describe('scanWord', () => {
  const text = 'foo foobar _foo foo_ $foo foo() x.foo\nfoo';
  it('finds whole-word matches only', () => {
    assert.deepEqual(scanWord(text, 'foo'), [0, 26, 34, 38]);
  });
  it('returns nothing for an empty word', () => assert.deepEqual(scanWord(text, ''), []));
  it('treats unicode letters as identifier characters', () => {
    assert.deepEqual(scanWord('éfoo foo', 'foo'), [5]);
  });
});

describe('lineStarts / offsetToLineCol', () => {
  const text = 'ab\ncd\r\nef';
  const starts = lineStarts(text);
  it('computes line starts', () => assert.deepEqual(starts, [0, 3, 7]));
  it('converts offsets', () => {
    assert.deepEqual(offsetToLineCol(starts, 0), { line: 0, character: 0 });
    assert.deepEqual(offsetToLineCol(starts, 4), { line: 1, character: 1 });
    assert.deepEqual(offsetToLineCol(starts, 8), { line: 2, character: 1 });
  });
});

describe('bareName', () => {
  const cases: Array<[string, string]> = [
    ['foo', 'foo'],
    ['foo(String)', 'foo'],
    ['(*T).Foo', 'Foo'],
    ['Map<K,V>', 'Map'],
    ['Outer.inner', 'inner'],
    ['ns::Thing', 'Thing'],
    ['name: str', 'name'],
    ['  calculate_consumption  ', 'calculate_consumption'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => assert.equal(bareName(input), expected));
  }
});

describe('normalizeRelPath / formatLabel', () => {
  it('normalises', () => assert.equal(normalizeRelPath('.\\a\\b\\'), 'a/b'));
  it('formats labels', () => assert.equal(formatLabel('{count} local ({count})', 3), '3 local (3)'));
});
