import * as vscode from 'vscode';
import { ExclusionMatcher, buildExcludeGlob, normalizeRelPath } from './glob';

export type CountingMode = 'languageServer' | 'text';

const KIND_MAP: Record<string, vscode.SymbolKind> = {
  class: vscode.SymbolKind.Class,
  function: vscode.SymbolKind.Function,
  method: vscode.SymbolKind.Method,
  interface: vscode.SymbolKind.Interface,
  struct: vscode.SymbolKind.Struct,
  constructor: vscode.SymbolKind.Constructor,
  enum: vscode.SymbolKind.Enum,
  property: vscode.SymbolKind.Property,
  variable: vscode.SymbolKind.Variable,
  constant: vscode.SymbolKind.Constant,
  module: vscode.SymbolKind.Module,
};

export interface Settings {
  enabled: boolean;
  mode: CountingMode;
  useEditorExcludes: boolean;
  symbolKinds: Set<vscode.SymbolKind>;
  ignoreNames: RegExp[];
  fileLabel: string;
  projectLabel: string;
  textInclude: string;
  textMaxFiles: number;
  textMaxFileSizeKB: number;
  maxConcurrentRequests: number;
  leaderboardInclude: string;
  leaderboardMaxFiles: number;
}

interface FolderExclusions {
  matcher: ExclusionMatcher;
  excludeGlob: string | undefined;
}

export const DEFAULT_LEADERBOARD_INCLUDE =
  '**/*.{py,pyi,ts,tsx,js,jsx,mjs,cjs,go,java,kt,cs,php,rb,rs,c,h,cpp,hpp,swift,scala}';

const NOCASE = process.platform === 'win32' || process.platform === 'darwin';

/** Reads configuration and builds per-workspace-folder exclusion matchers. Call reload() on config change. */
export class SettingsStore {
  private _settings!: Settings;
  private folderCache = new Map<string, FolderExclusions>();

  constructor() {
    this.reload();
  }

  get current(): Settings {
    return this._settings;
  }

  reload(): void {
    const c = vscode.workspace.getConfiguration('usageLens');
    const kinds = new Set<vscode.SymbolKind>();
    for (const k of c.get<string[]>('symbolKinds', [])) {
      const v = KIND_MAP[k.toLowerCase()];
      if (v !== undefined) {
        kinds.add(v);
      }
    }
    const ignoreNames: RegExp[] = [];
    for (const src of c.get<string[]>('ignoreNames', [])) {
      try {
        ignoreNames.push(new RegExp(src));
      } catch {
        // Invalid regex in user settings: skip it rather than break every lens.
      }
    }
    this._settings = {
      enabled: c.get<boolean>('enabled', true),
      mode: c.get<CountingMode>('mode', 'languageServer') === 'text' ? 'text' : 'languageServer',
      useEditorExcludes: c.get<boolean>('useEditorExcludes', true),
      symbolKinds: kinds,
      ignoreNames,
      fileLabel: c.get<string>('fileLabel', '{count} in file'),
      projectLabel: c.get<string>('projectLabel', '{count} in project'),
      textInclude: c.get<string>('textMode.include', '**/*'),
      textMaxFiles: Math.max(1, c.get<number>('textMode.maxFiles', 10000)),
      textMaxFileSizeKB: Math.max(1, c.get<number>('textMode.maxFileSizeKB', 1024)),
      maxConcurrentRequests: Math.min(32, Math.max(1, c.get<number>('maxConcurrentRequests', 4))),
      leaderboardInclude: c.get<string>('leaderboard.include', DEFAULT_LEADERBOARD_INCLUDE),
      leaderboardMaxFiles: Math.max(1, c.get<number>('leaderboard.maxFiles', 2000)),
    };
    this.folderCache.clear();
  }

  /** All exclusion patterns that apply to a workspace folder. */
  patternsFor(folder: vscode.WorkspaceFolder): string[] {
    const c = vscode.workspace.getConfiguration('usageLens', folder.uri);
    const patterns = [...c.get<string[]>('exclude', [])];
    const editor = editorExcludesFor(folder);
    if (editor) {
      patterns.push(...editor['files.exclude'], ...editor['search.exclude']);
    }
    return patterns;
  }

  private exclusionsFor(folder: vscode.WorkspaceFolder): FolderExclusions {
    const key = folder.uri.toString();
    let ex = this.folderCache.get(key);
    if (!ex) {
      const patterns = this.patternsFor(folder);
      ex = { matcher: new ExclusionMatcher(patterns, { nocase: NOCASE }), excludeGlob: buildExcludeGlob(patterns) };
      this.folderCache.set(key, ex);
    }
    return ex;
  }

  /** Exclude glob for findFiles within one folder. */
  excludeGlobFor(folder: vscode.WorkspaceFolder): string | undefined {
    return this.exclusionsFor(folder).excludeGlob;
  }

  /** True if the URI is outside every workspace folder or matches an exclusion. */
  isExcluded(uri: vscode.Uri): boolean {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return true;
    }
    return this.exclusionsFor(folder).matcher.isExcluded(relativeTo(folder, uri));
  }

  isIgnoredName(name: string): boolean {
    return this._settings.ignoreNames.some((r) => r.test(name));
  }
}

export type EditorExcludeSection = 'files.exclude' | 'search.exclude';

/** Enabled patterns from files.exclude / search.exclude, or undefined when useEditorExcludes is off. */
export function editorExcludesFor(folder: vscode.WorkspaceFolder): Record<EditorExcludeSection, string[]> | undefined {
  if (!vscode.workspace.getConfiguration('usageLens', folder.uri).get<boolean>('useEditorExcludes', true)) {
    return undefined;
  }
  const read = (section: EditorExcludeSection) => {
    const obj = vscode.workspace.getConfiguration(undefined, folder.uri).get<Record<string, unknown>>(section) ?? {};
    return Object.entries(obj)
      .filter(([, on]) => on === true)
      .map(([glob]) => glob);
  };
  return { 'files.exclude': read('files.exclude'), 'search.exclude': read('search.exclude') };
}

export function relativeTo(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  const base = folder.uri.path.endsWith('/') ? folder.uri.path : `${folder.uri.path}/`;
  const p = uri.path.startsWith(base) ? uri.path.slice(base.length) : uri.path;
  return normalizeRelPath(p);
}
