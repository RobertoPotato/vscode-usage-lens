/**
 * Pure leaderboard logic (no `vscode` import) so it can be unit-tested in plain Node.
 * media/leaderboard.js mirrors filterAndSort() for instant filtering inside the webview.
 */

export type KindGroup = 'class' | 'function' | 'method' | 'object';

export const KIND_GROUPS: readonly KindGroup[] = ['class', 'function', 'method', 'object'];

export interface Entry {
  /** Stable id for this scan: `${uri}#${line}:${character}`. */
  id: string;
  name: string;
  /** Enclosing symbol, e.g. the class of a method. */
  container?: string;
  /** SymbolKind name, e.g. "Method". */
  kind: string;
  group: KindGroup;
  /** Workspace-relative path (prefixed with the folder name in multi-root workspaces). */
  file: string;
  /** 0-based line of the identifier. */
  line: number;
  inFile: number;
  project: number;
}

export interface RankedEntry extends Entry {
  /** 1-based rank; entries with identical counts share a rank. */
  rank: number;
}

export interface LeaderboardFilter {
  /** Empty set means every group. */
  groups: ReadonlySet<KindGroup>;
  query: string;
  direction: 'desc' | 'asc';
}

/** Map a vscode.SymbolKind name to a filter group. Everything type-like falls into "object". */
export function kindGroup(kindName: string): KindGroup {
  switch (kindName) {
    case 'Class':
      return 'class';
    case 'Function':
      return 'function';
    case 'Method':
    case 'Constructor':
      return 'method';
    default:
      return 'object';
  }
}

export function displayName(e: Pick<Entry, 'name' | 'container'>): string {
  return e.container ? `${e.container}.${e.name}` : e.name;
}

export function matchesQuery(e: Entry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return displayName(e).toLowerCase().includes(q) || e.file.toLowerCase().includes(q);
}

/** Rank by project count, then in-file count, then name (direction applies to the counts only). */
export function filterAndSort(entries: readonly Entry[], filter: LeaderboardFilter): RankedEntry[] {
  const sign = filter.direction === 'asc' ? -1 : 1;
  const rows = entries.filter(
    (e) => (filter.groups.size === 0 || filter.groups.has(e.group)) && matchesQuery(e, filter.query),
  );
  rows.sort(
    (a, b) =>
      sign * (b.project - a.project) ||
      sign * (b.inFile - a.inFile) ||
      displayName(a).localeCompare(displayName(b)) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  const out: RankedEntry[] = [];
  rows.forEach((e, i) => {
    const prev = out[i - 1];
    const rank = prev && prev.project === e.project && prev.inFile === e.inFile ? prev.rank : i + 1;
    out.push({ ...e, rank });
  });
  return out;
}
