import * as vscode from 'vscode';
import { CountingMode, SettingsStore } from './settings';
import { TargetSymbol } from './symbols';
import { TextIndex } from './textIndex';
import { Throttle } from './throttle';

export type Scope = 'file' | 'project';

export interface UsageResult {
  name: string;
  kind: vscode.SymbolKind;
  mode: CountingMode;
  definition: vscode.Location;
  /** Usages inside the defining file (subset of `project`). */
  inFile: vscode.Location[];
  /** All usages in the workspace, including in-file ones. */
  project: vscode.Location[];
}

const MAX_CACHE = 5000;

/** Computes and caches per-symbol usage results in either counting mode. */
export class UsageService {
  private cache = new Map<string, Promise<UsageResult>>();
  private readonly throttle: Throttle;

  constructor(
    private readonly settings: SettingsStore,
    private readonly textIndex: TextIndex,
  ) {
    this.throttle = new Throttle(settings.current.maxConcurrentRequests);
  }

  onSettingsChanged(): void {
    this.throttle.setLimit(this.settings.current.maxConcurrentRequests);
    this.clear();
  }

  clear(): void {
    this.cache.clear();
  }

  get(doc: vscode.TextDocument, sym: TargetSymbol): Promise<UsageResult> {
    const mode = this.settings.current.mode;
    const pos = sym.nameRange.start;
    const key = `${mode}|${doc.uri.toString()}|${doc.version}|${pos.line}:${pos.character}|${sym.name}`;
    let p = this.cache.get(key);
    if (!p) {
      if (this.cache.size >= MAX_CACHE) {
        this.cache.clear();
      }
      p = this.compute(doc, sym, mode);
      this.cache.set(key, p);
      // Failed computations are not cached, so Refresh or a re-resolve can retry.
      p.catch(() => {
        if (this.cache.get(key) === p) {
          this.cache.delete(key);
        }
      });
    }
    return p;
  }

  /** Recompute a result from scratch (sidebar Refresh). */
  async recompute(result: UsageResult): Promise<UsageResult> {
    const doc = await vscode.workspace.openTextDocument(result.definition.uri);
    const sym: TargetSymbol = {
      name: result.name,
      kind: result.kind,
      nameRange: result.definition.range,
      range: result.definition.range,
    };
    // The definition may have moved; re-locate it near its old line if the name no longer matches.
    const current = doc.getText(sym.nameRange);
    if (current !== result.name) {
      const line = Math.min(sym.nameRange.start.line, doc.lineCount - 1);
      const idx = doc.lineAt(line).text.indexOf(result.name);
      if (idx >= 0) {
        sym.nameRange = new vscode.Range(line, idx, line, idx + result.name.length);
      }
    }
    this.clear();
    return this.get(doc, sym);
  }

  private async compute(doc: vscode.TextDocument, sym: TargetSymbol, mode: CountingMode): Promise<UsageResult> {
    const raw =
      mode === 'text'
        ? await this.textIndex.find(sym.name)
        : await this.throttle.run(() =>
            vscode.commands.executeCommand<vscode.Location[] | undefined>(
              'vscode.executeReferenceProvider',
              doc.uri,
              sym.nameRange.start,
            ),
          );
    return this.buildResult(doc, sym, mode, raw ?? []);
  }

  private buildResult(doc: vscode.TextDocument, sym: TargetSymbol, mode: CountingMode, raw: vscode.Location[]): UsageResult {
    const defUri = doc.uri.toString();
    const seen = new Set<string>();
    const project: vscode.Location[] = [];
    for (const loc of raw) {
      const uri = loc.uri.toString();
      const r = loc.range;
      // The definition itself is not a usage.
      if (uri === defUri && r.contains(sym.nameRange.start) && r.start.line === sym.nameRange.start.line) {
        continue;
      }
      const k = `${uri}#${r.start.line}:${r.start.character}`;
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      // Outside the workspace (e.g. site-packages under /usr/lib) or excluded → dropped.
      if (uri !== defUri && this.settings.isExcluded(loc.uri)) {
        continue;
      }
      project.push(loc);
    }
    project.sort(compareLocations);
    return {
      name: sym.name,
      kind: sym.kind,
      mode,
      definition: new vscode.Location(doc.uri, sym.nameRange),
      inFile: project.filter((l) => l.uri.toString() === defUri),
      project,
    };
  }
}

export function compareLocations(a: vscode.Location, b: vscode.Location): number {
  const ua = a.uri.toString();
  const ub = b.uri.toString();
  if (ua !== ub) {
    return ua < ub ? -1 : 1;
  }
  return a.range.start.compareTo(b.range.start);
}
