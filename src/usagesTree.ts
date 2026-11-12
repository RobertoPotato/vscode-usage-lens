import * as path from 'path';
import * as vscode from 'vscode';
import { Scope, UsageResult } from './usageService';

type Node = FileNode | LineNode;

interface FileNode {
  type: 'file';
  uri: vscode.Uri;
  locations: vscode.Location[];
}

interface LineNode {
  type: 'line';
  location: vscode.Location;
  preview: string;
  /** Highlight [start, end) within `preview`. */
  highlight?: [number, number];
}

const MAX_PREVIEW = 160;

/** Sidebar tree listing the usages of one symbol, grouped by file. */
export class UsagesTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private result: UsageResult | undefined;
  private scope: Scope = 'project';
  private roots: FileNode[] = [];
  private view: vscode.TreeView<Node> | undefined;

  attach(view: vscode.TreeView<Node>): void {
    this.view = view;
  }

  get current(): { result: UsageResult; scope: Scope } | undefined {
    return this.result ? { result: this.result, scope: this.scope } : undefined;
  }

  show(result: UsageResult, scope: Scope): void {
    this.result = result;
    this.scope = scope;
    void vscode.commands.executeCommand('setContext', 'usageLens.hasResult', true);
    this.rebuild();
  }

  switchScope(): void {
    if (this.result) {
      this.scope = this.scope === 'file' ? 'project' : 'file';
      this.rebuild();
    }
  }

  private rebuild(): void {
    const r = this.result;
    if (!r) {
      return;
    }
    const list = this.scope === 'file' ? r.inFile : r.project;
    const byFile = new Map<string, FileNode>();
    for (const loc of list) {
      const k = loc.uri.toString();
      let node = byFile.get(k);
      if (!node) {
        node = { type: 'file', uri: loc.uri, locations: [] };
        byFile.set(k, node);
      }
      node.locations.push(loc);
    }
    const defKey = r.definition.uri.toString();
    // Defining file first, then by number of usages, then by path.
    this.roots = [...byFile.values()].sort((a, b) => {
      const ad = a.uri.toString() === defKey ? 0 : 1;
      const bd = b.uri.toString() === defKey ? 0 : 1;
      return ad - bd || b.locations.length - a.locations.length || a.uri.path.localeCompare(b.uri.path);
    });

    if (this.view) {
      const where = this.scope === 'file' ? 'in file' : 'in project';
      this.view.title = 'Usages';
      this.view.description = `${r.name} — ${list.length} ${where}`;
      this.view.message =
        list.length === 0 ? `No usages of \`${r.name}\` ${where} (exclusions applied, ${r.mode === 'text' ? 'text' : 'language server'} mode).` : undefined;
    }
    this.changeEmitter.fire();
    void vscode.commands.executeCommand('usageLens.usages.focus');
  }

  getChildren(node?: Node): Node[] | Promise<Node[]> {
    if (!node) {
      return this.roots;
    }
    if (node.type === 'file') {
      return this.lineNodes(node);
    }
    return [];
  }

  private async lineNodes(file: FileNode): Promise<LineNode[]> {
    let doc: vscode.TextDocument | undefined;
    try {
      doc = await vscode.workspace.openTextDocument(file.uri);
    } catch {
      doc = undefined;
    }
    return file.locations.map((location) => {
      if (!doc || location.range.start.line >= doc.lineCount) {
        return { type: 'line', location, preview: '' };
      }
      const raw = doc.lineAt(location.range.start.line).text;
      const indent = raw.length - raw.trimStart().length;
      let preview = raw.trim();
      let hs = location.range.start.character - indent;
      let he = (location.range.isSingleLine ? location.range.end.character : raw.length) - indent;
      if (preview.length > MAX_PREVIEW) {
        // Keep the match visible in long lines.
        const start = Math.max(0, Math.min(hs - 40, preview.length - MAX_PREVIEW));
        preview = (start > 0 ? '…' : '') + preview.slice(start, start + MAX_PREVIEW);
        const shift = start > 0 ? start - 1 : 0;
        hs -= shift;
        he -= shift;
      }
      const highlight: [number, number] | undefined = hs >= 0 && he > hs && he <= preview.length ? [hs, he] : undefined;
      return { type: 'line', location, preview, highlight };
    });
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'file') {
      const item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.Expanded);
      const folder = vscode.workspace.getWorkspaceFolder(node.uri);
      const rel = folder ? path.posix.relative(folder.uri.path, node.uri.path) : node.uri.fsPath;
      const dir = path.posix.dirname(rel);
      const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      const dirLabel = [multiRoot && folder ? folder.name : '', dir === '.' ? '' : dir].filter(Boolean).join(' • ');
      item.description = `${dirLabel ? dirLabel + '  ' : ''}${node.locations.length}`;
      item.tooltip = `${rel} — ${node.locations.length} usage${node.locations.length === 1 ? '' : 's'}`;
      item.contextValue = 'usageLens.file';
      return item;
    }
    const line = node.location.range.start.line + 1;
    const label: vscode.TreeItemLabel = {
      label: node.preview || `line ${line}`,
      highlights: node.highlight ? [node.highlight] : undefined,
    };
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `:${line}`;
    item.tooltip = node.preview;
    item.contextValue = 'usageLens.usage';
    item.command = {
      command: 'vscode.open',
      title: 'Open Usage',
      arguments: [node.location.uri, { selection: node.location.range, preserveFocus: false } as vscode.TextDocumentShowOptions],
    };
    return item;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
