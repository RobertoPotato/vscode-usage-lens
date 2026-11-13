import * as vscode from 'vscode';
import { LeaderboardService, ScanSummary } from './leaderboard';
import { Entry } from './leaderboardModel';
import { SettingsStore } from './settings';
import { Scope } from './usageService';

type FromWebview =
  | { type: 'ready' }
  | { type: 'scan' }
  | { type: 'stop' }
  | { type: 'open'; id: string }
  | { type: 'usages'; id: string; scope: Scope };

export type ToWebview =
  | { type: 'reset'; mode: string }
  | { type: 'entries'; entries: Entry[] }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; summary: ScanSummary }
  | { type: 'stale'; reason: string };

export const LEADERBOARD_VIEW = 'usageLens.leaderboard';

const modeLabel = (mode: string) => (mode === 'text' ? 'Text' : 'Language Server');

/** Sidebar webview listing every symbol, ranked by usage, with filter chips and search. */
export class LeaderboardViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  /** Incremented per scan so a cancelled scan can't post into the view after its replacement started. */
  private generation = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: LeaderboardService,
    private readonly settings: SettingsStore,
  ) {
    this.disposables.push(service.onDidBecomeStale(() => this.postStale()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    this.disposables.push(
      view.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m)),
      view.onDidDispose(() => (this.view = undefined)),
    );
  }

  /** Run a scan and stream results into the view (also used by the Rescan command). */
  async scan(): Promise<ScanSummary> {
    const gen = ++this.generation;
    const live = () => gen === this.generation;
    this.post({ type: 'reset', mode: modeLabel(this.settings.current.mode) });
    this.updateDescription();
    const summary = await this.service.scan({
      onEntries: (entries) => live() && this.post({ type: 'entries', entries }),
      onProgress: (done, total) => live() && this.post({ type: 'progress', done, total }),
    });
    if (live()) {
      this.post({ type: 'done', summary });
      this.updateDescription();
    }
    return summary;
  }

  private async onMessage(m: FromWebview): Promise<void> {
    switch (m.type) {
      case 'ready':
        // The webview may be (re)created at any time: replay what the service has.
        if (this.service.isScanning) {
          this.post({ type: 'reset', mode: modeLabel(this.settings.current.mode) });
          this.post({ type: 'entries', entries: [...this.service.current] });
        } else if (this.service.summary) {
          this.post({ type: 'reset', mode: modeLabel(this.service.summary.mode) });
          this.post({ type: 'entries', entries: [...this.service.current] });
          this.post({ type: 'done', summary: this.service.summary });
          this.postStale();
        } else {
          void this.scan();
        }
        this.updateDescription();
        break;
      case 'scan':
        void this.scan();
        break;
      case 'stop':
        this.service.stop();
        break;
      case 'open': {
        const r = this.service.result(m.id);
        if (r) {
          await vscode.window.showTextDocument(r.definition.uri, { selection: r.definition.range });
        }
        break;
      }
      case 'usages': {
        const r = this.service.result(m.id);
        if (r) {
          await vscode.commands.executeCommand('usageLens.showUsages', r, m.scope);
        }
        break;
      }
    }
  }

  private postStale(): void {
    const s = this.service.summary;
    if (!this.service.stale || !s) {
      return;
    }
    const reason =
      s.mode !== this.settings.current.mode
        ? `Counting mode changed to ${modeLabel(this.settings.current.mode)}.`
        : 'Code or settings changed since the last scan.';
    this.post({ type: 'stale', reason });
  }

  private updateDescription(): void {
    if (!this.view) {
      return;
    }
    const s = this.service.summary;
    const mode = modeLabel(this.service.isScanning || !s ? this.settings.current.mode : s.mode);
    this.view.description = s && !this.service.isScanning ? `${mode} · ${s.symbols} symbols` : mode;
  }

  private post(msg: ToWebview): void {
    void this.view?.webview.postMessage(msg);
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'leaderboard.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'leaderboard.css'));
    const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Leaderboard</title>
</head>
<body>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search symbols or files" aria-label="Search symbols or files" spellcheck="false">
  <div class="row">
    <div class="chips" role="group" aria-label="Filter by kind">
      <button class="chip" data-group="" aria-pressed="true">All</button>
      <button class="chip" data-group="class" aria-pressed="false" title="Classes">Class</button>
      <button class="chip" data-group="function" aria-pressed="false" title="Functions">Function</button>
      <button class="chip" data-group="method" aria-pressed="false" title="Methods and constructors">Method</button>
      <button class="chip" data-group="object" aria-pressed="false" title="Interfaces, structs, enums and other type-like symbols">Object</button>
    </div>
  </div>
  <div class="row">
    <button id="direction" class="link" title="Reverse the order">↓ Most used</button>
    <span class="spacer"></span>
    <button id="scan" class="link">Rescan</button>
    <button id="stop" class="link" hidden>Stop</button>
  </div>
</div>
<div id="stale" class="banner" hidden><span id="staleText"></span> <button class="link" id="staleScan">Rescan</button></div>
<div id="status" class="status" aria-live="polite"></div>
<div class="head" aria-hidden="true"><span class="rank">#</span><span class="sym">Symbol</span><span class="num" title="Usages in the defining file">file</span><span class="num" title="Usages in the whole project">project</span></div>
<ol id="list" class="list"></ol>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
