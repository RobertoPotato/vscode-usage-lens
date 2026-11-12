/**
 * Pure helpers with no dependency on the `vscode` module, so they can be unit-tested in plain Node.
 */
import picomatch from 'picomatch';

/** Normalise a relative path: forward slashes, no leading "./" or "/", no trailing "/". */
export function normalizeRelPath(p: string): string {
  let s = p.replace(/\\/g, '/');
  while (s.startsWith('./')) {
    s = s.slice(2);
  }
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  return s;
}

/**
 * Convert a gitignore-like pattern into a glob anchored at the workspace-folder root.
 * - `venv`            → `** /venv` (any depth)
 * - `/scripts/legacy` → `scripts/legacy` (anchored)
 * - `src/vendor`      → `src/vendor` (anchored because of the inner slash)
 * Returns undefined for blank lines and comments.
 */
export function toAnchoredGlob(pattern: string): string | undefined {
  let p = pattern.trim().replace(/\\/g, '/');
  if (!p || p.startsWith('#')) {
    return undefined;
  }
  p = p.replace(/\/+$/, '');
  if (!p) {
    return undefined;
  }
  if (p.startsWith('/')) {
    return p.replace(/^\/+/, '');
  }
  if (p.startsWith('**/') || p.includes('/')) {
    return p;
  }
  return `**/${p}`;
}

export interface MatcherOptions {
  /** Case-insensitive matching (Windows, macOS default file systems). */
  nocase?: boolean;
}

/**
 * Tests workspace-relative paths against gitignore-like exclusion patterns.
 * A path is excluded if it, or any of its ancestor directories, matches a pattern.
 */
export class ExclusionMatcher {
  private readonly tests: Array<(p: string) => boolean>;
  readonly globs: readonly string[];

  constructor(patterns: readonly string[], options: MatcherOptions = {}) {
    const globs: string[] = [];
    for (const raw of patterns) {
      const g = toAnchoredGlob(raw);
      if (g && !globs.includes(g)) {
        globs.push(g);
      }
    }
    this.globs = globs;
    this.tests = globs.map((g) => picomatch(g, { dot: true, nocase: !!options.nocase }));
  }

  get isEmpty(): boolean {
    return this.tests.length === 0;
  }

  isExcluded(relPath: string): boolean {
    if (this.tests.length === 0) {
      return false;
    }
    const norm = normalizeRelPath(relPath);
    if (!norm) {
      return false;
    }
    const parts = norm.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      for (const t of this.tests) {
        if (t(current)) {
          return true;
        }
      }
    }
    return false;
  }
}

/**
 * Build a single glob suitable for `workspace.findFiles(include, exclude)` so that excluded
 * trees are never listed. Each pattern excludes both the path itself and everything inside it.
 */
export function buildExcludeGlob(patterns: readonly string[]): string | undefined {
  const out: string[] = [];
  for (const raw of patterns) {
    const g = toAnchoredGlob(raw);
    if (!g) {
      continue;
    }
    for (const v of g.endsWith('/**') ? [g] : [g, `${g}/**`]) {
      // Braces inside a brace list are fine for VS Code's glob engine, but commas would split.
      if (!out.includes(v) && !v.includes(',')) {
        out.push(v);
      }
    }
  }
  if (out.length === 0) {
    return undefined;
  }
  return out.length === 1 ? out[0] : `{${out.join(',')}}`;
}

const IDENT_CHAR = /[\p{L}\p{N}_$]/u;

export function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && ch !== '' && IDENT_CHAR.test(ch);
}

/** Offsets of every whole-word occurrence of `word` in `text`. */
export function scanWord(text: string, word: string): number[] {
  const hits: number[] = [];
  if (!word) {
    return hits;
  }
  let from = 0;
  for (;;) {
    const i = text.indexOf(word, from);
    if (i < 0) {
      break;
    }
    const before = i > 0 ? text[i - 1] : undefined;
    const after = text[i + word.length];
    if (!isIdentChar(before) && !isIdentChar(after)) {
      hits.push(i);
    }
    from = i + word.length;
  }
  return hits;
}

/** Start offset of every line in `text`. Handles \n and \r\n. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Convert an offset into a zero-based { line, character } using precomputed line starts. */
export function offsetToLineCol(starts: readonly number[], offset: number): { line: number; character: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: offset - starts[lo] };
}

/**
 * Reduce a symbol display name to its bare identifier.
 * `foo(String)` → `foo`, `(*T).Foo` → `Foo`, `Map<K,V>` → `Map`, `Outer.inner` → `inner`.
 */
export function bareName(name: string): string {
  let s = name.trim();
  const recv = s.lastIndexOf(').');
  if (recv >= 0) {
    s = s.slice(recv + 2);
  }
  // Cut at the first parameter list, generic list, whitespace, '=' or a lone ':' (not '::').
  const cut = s.search(/[(<[\s=]|(?<!:):(?!:)/);
  if (cut > 0) {
    s = s.slice(0, cut);
  }
  const segs = s.split(/::|\./).filter(Boolean);
  s = segs.length ? segs[segs.length - 1] : s;
  const m = /[\p{L}_$][\p{L}\p{N}_$]*/u.exec(s);
  return m ? m[0] : s;
}

/** Fill a label template such as "{count} in file". */
export function formatLabel(template: string, count: number): string {
  return template.replace(/\{count\}/g, String(count));
}
