import * as vscode from 'vscode';
import { formatLabel } from './glob';
import { SettingsStore } from './settings';
import { TargetSymbol, collectTargets, fetchSymbols } from './symbols';
import { Scope, UsageService } from './usageService';

class UsageLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    readonly doc: vscode.TextDocument,
    readonly symbol: TargetSymbol,
    readonly scope: Scope,
  ) {
    super(range);
  }
}

/** Backoff delays (ms) used while a language server is still starting and returns no symbols. */
const RETRY_DELAYS = [500, 1500, 3000, 6000];

export class UsageCodeLensProvider implements vscode.CodeLensProvider<UsageLens>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;
  private retries = new Map<string, { attempt: number; timer?: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly usages: UsageService,
  ) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  async provideCodeLenses(doc: vscode.TextDocument, token: vscode.CancellationToken): Promise<UsageLens[]> {
    if (!this.settings.current.enabled || this.settings.isExcluded(doc.uri)) {
      return [];
    }
    let symbols;
    try {
      symbols = await fetchSymbols(doc.uri);
    } catch {
      symbols = undefined;
    }
    if (token.isCancellationRequested) {
      return [];
    }
    const key = doc.uri.toString();
    if (!symbols || symbols.length === 0) {
      this.scheduleRetry(key);
      return [];
    }
    this.clearRetry(key);
    const lenses: UsageLens[] = [];
    for (const sym of collectTargets(doc, symbols, this.settings)) {
      // Place the lens on the line of the identifier so decorators (@property, @app.task) stay above it.
      const line = new vscode.Range(sym.nameRange.start.line, 0, sym.nameRange.start.line, 0);
      lenses.push(new UsageLens(line, doc, sym, 'file'), new UsageLens(line, doc, sym, 'project'));
    }
    return lenses;
  }

  async resolveCodeLens(lens: UsageLens): Promise<UsageLens> {
    const s = this.settings.current;
    try {
      const result = await this.usages.get(lens.doc, lens.symbol);
      const list = lens.scope === 'file' ? result.inFile : result.project;
      const template = lens.scope === 'file' ? s.fileLabel : s.projectLabel;
      lens.command = {
        title: formatLabel(template, list.length),
        tooltip: `Show ${lens.scope === 'file' ? 'in-file' : 'project'} usages of ${result.name} (${
          result.mode === 'text' ? 'text' : 'language server'
        } mode)`,
        command: 'usageLens.showUsages',
        arguments: [result, lens.scope],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lens.command =
        lens.scope === 'file'
          ? { title: 'usages: unavailable', tooltip: message, command: '' }
          : { title: 'retry', tooltip: `Recompute usage counts (${message})`, command: 'usageLens.refresh' };
    }
    return lens;
  }

  private scheduleRetry(key: string): void {
    const state = this.retries.get(key) ?? { attempt: 0 };
    if (state.timer || state.attempt >= RETRY_DELAYS.length) {
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = undefined;
      state.attempt++;
      this.changeEmitter.fire();
    }, RETRY_DELAYS[state.attempt]);
    this.retries.set(key, state);
  }

  private clearRetry(key: string): void {
    const state = this.retries.get(key);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.retries.delete(key);
  }

  /** Allow another round of retries (e.g. after Refresh). */
  resetRetries(): void {
    for (const s of this.retries.values()) {
      if (s.timer) {
        clearTimeout(s.timer);
      }
    }
    this.retries.clear();
  }

  dispose(): void {
    this.resetRetries();
    this.changeEmitter.dispose();
  }
}
