import * as path from 'path';
import * as vscode from 'vscode';
import { Entry, kindGroup } from './leaderboardModel';
import { CountingMode, SettingsStore, relativeTo } from './settings';
import { collectTargets, fetchSymbols } from './symbols';
import { UsageResult, UsageService } from './usageService';

const BATCH = 25;

export interface ScanSummary {
  mode: CountingMode;
  files: number;
  symbols: number;
  /** Files where the symbol provider returned nothing (language server still loading, or no provider). */
  filesWithoutSymbols: number;
  /** Symbols whose count could not be computed. */
  failed: number;
  /** True when leaderboard.maxFiles cut the file list short. */
  truncated: boolean;
  cancelled: boolean;
}

export interface ScanListener {
  /** Called with every batch of new entries. */
  onEntries(entries: Entry[]): void;
  onProgress(done: number, total: number): void;
}

/** Scans the workspace for symbols and their usage counts; results back the Leaderboard view. */
export class LeaderboardService implements vscode.Disposable {
  private entries: Entry[] = [];
  private results = new Map<string, UsageResult>();
  private _stale = false;
  private _summary: ScanSummary | undefined;
  private running: { cts: vscode.CancellationTokenSource; done: Promise<ScanSummary> } | undefined;
  private readonly staleEmitter = new vscode.EventEmitter<void>();
  /** Fires when results stop matching the code (edit, file change, settings change). */
  readonly onDidBecomeStale = this.staleEmitter.event;

  constructor(
    private readonly settings: SettingsStore,
    private readonly usages: UsageService,
  ) {}

  get current(): readonly Entry[] {
    return this.entries;
  }

  get summary(): ScanSummary | undefined {
    return this._summary;
  }

  get stale(): boolean {
    return this._stale;
  }

  get isScanning(): boolean {
    return !!this.running;
  }

  result(id: string): UsageResult | undefined {
    return this.results.get(id);
  }

  markStale(): void {
    if (this._summary && !this._stale) {
      this._stale = true;
      this.staleEmitter.fire();
    }
  }

  stop(): void {
    this.running?.cts.cancel();
  }

  /** Start a scan, cancelling any scan already running. */
  async scan(listener?: Partial<ScanListener>): Promise<ScanSummary> {
    if (this.running) {
      this.running.cts.cancel();
      await this.running.done.catch(() => undefined);
    }
    const cts = new vscode.CancellationTokenSource();
    const done = this.run(cts.token, listener ?? {});
    this.running = { cts, done };
    try {
      return await done;
    } finally {
      if (this.running?.done === done) {
        this.running = undefined;
      }
      cts.dispose();
    }
  }

  private async listFiles(): Promise<{ files: vscode.Uri[]; truncated: boolean }> {
    const s = this.settings.current;
    const files: vscode.Uri[] = [];
    let truncated = false;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const remaining = s.leaderboardMaxFiles - files.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const ex = this.settings.excludeGlobFor(folder);
      // Ask for one extra file so we can tell whether the cap was hit.
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, s.leaderboardInclude),
        ex ? new vscode.RelativePattern(folder, ex) : undefined,
        remaining + 1,
      );
      if (found.length > remaining) {
        truncated = true;
      }
      for (const uri of found.slice(0, remaining)) {
        if (!this.settings.isExcluded(uri)) {
          files.push(uri);
        }
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, truncated };
  }

  private async run(token: vscode.CancellationToken, listener: Partial<ScanListener>): Promise<ScanSummary> {
    const mode = this.settings.current.mode;
    this.entries = [];
    this.results.clear();
    this._stale = false;
    const { files, truncated } = await this.listFiles();
    const summary: ScanSummary = {
      mode,
      files: files.length,
      symbols: 0,
      filesWithoutSymbols: 0,
      failed: 0,
      truncated,
      cancelled: false,
    };
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    let pending: Entry[] = [];
    const flush = () => {
      if (pending.length) {
        listener.onEntries?.(pending);
        pending = [];
      }
    };

    for (let i = 0; i < files.length; i++) {
      if (token.isCancellationRequested) {
        break;
      }
      listener.onProgress?.(i, files.length);
      const uri = files[i];
      let doc: vscode.TextDocument;
      let symbols;
      try {
        doc = await vscode.workspace.openTextDocument(uri);
        symbols = await fetchSymbols(uri);
      } catch {
        summary.filesWithoutSymbols++;
        continue;
      }
      const targets = collectTargets(doc, symbols, this.settings);
      if (!symbols || symbols.length === 0) {
        summary.filesWithoutSymbols++;
        continue;
      }
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const rel = folder ? relativeTo(folder, uri) : uri.fsPath;
      const file = multiRoot && folder ? path.posix.join(folder.name, rel) : rel;

      // Requests go through UsageService's throttle, so firing them together is safe.
      const settled = await Promise.allSettled(targets.map((sym) => this.usages.get(doc, sym)));
      if (token.isCancellationRequested) {
        break;
      }
      settled.forEach((r, j) => {
        if (r.status === 'rejected') {
          summary.failed++;
          return;
        }
        const sym = targets[j];
        const id = `${uri.toString()}#${sym.nameRange.start.line}:${sym.nameRange.start.character}`;
        const kind = vscode.SymbolKind[sym.kind] ?? 'Object';
        const e: Entry = {
          id,
          name: sym.name,
          container: sym.container,
          kind,
          group: kindGroup(kind),
          file,
          line: sym.nameRange.start.line,
          inFile: r.value.inFile.length,
          project: r.value.project.length,
        };
        this.entries.push(e);
        this.results.set(id, r.value);
        pending.push(e);
        summary.symbols++;
      });
      if (pending.length >= BATCH) {
        flush();
      }
    }
    flush();
    summary.cancelled = token.isCancellationRequested;
    listener.onProgress?.(files.length, files.length);
    this._summary = summary;
    return summary;
  }

  dispose(): void {
    this.stop();
    this.staleEmitter.dispose();
  }
}
