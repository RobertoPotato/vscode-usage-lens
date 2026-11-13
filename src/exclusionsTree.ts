import * as vscode from 'vscode';
import { currentList } from './exclusionCommands';
import { EditorExcludeSection, editorExcludesFor } from './settings';

type Source = 'usageLens' | EditorExcludeSection;

type Node =
  | { type: 'folder'; folder: vscode.WorkspaceFolder }
  | { type: 'group'; folder: vscode.WorkspaceFolder; source: Source; patterns: string[] }
  | { type: 'pattern'; folder: vscode.WorkspaceFolder; source: Source; pattern: string };

const GROUP_LABEL: Record<Source, string> = {
  usageLens: 'Usage Lens patterns',
  'files.exclude': 'From files.exclude',
  'search.exclude': 'From search.exclude',
};

const SETTING: Record<Source, string> = {
  usageLens: 'usageLens.exclude',
  'files.exclude': 'files.exclude',
  'search.exclude': 'search.exclude',
};

/** Sidebar tree of the exclusion patterns that apply to each workspace folder. */
export class ExclusionsTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  refresh(): void {
    this.changeEmitter.fire();
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 1) {
        return this.groups(folders[0]);
      }
      return folders.map((folder) => ({ type: 'folder', folder }));
    }
    if (node.type === 'folder') {
      return this.groups(node.folder);
    }
    if (node.type === 'group') {
      return node.patterns.map((pattern) => ({ type: 'pattern', folder: node.folder, source: node.source, pattern }));
    }
    return [];
  }

  private groups(folder: vscode.WorkspaceFolder): Node[] {
    const out: Node[] = [{ type: 'group', folder, source: 'usageLens', patterns: currentList(folder) }];
    const editor = editorExcludesFor(folder);
    if (editor) {
      for (const source of ['files.exclude', 'search.exclude'] as const) {
        if (editor[source].length) {
          out.push({ type: 'group', folder, source, patterns: editor[source] });
        }
      }
    }
    return out;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'folder') {
      const item = new vscode.TreeItem(node.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = vscode.ThemeIcon.Folder;
      item.resourceUri = node.folder.uri;
      item.contextValue = 'usageLens.exclusionFolder';
      return item;
    }
    if (node.type === 'group') {
      const editable = node.source === 'usageLens';
      const item = new vscode.TreeItem(
        GROUP_LABEL[node.source],
        editable ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = String(node.patterns.length);
      item.tooltip = editable
        ? 'Patterns from usageLens.exclude. Remove them here, or add more from the view toolbar.'
        : `Applied because usageLens.useEditorExcludes is on. Edit them in the ${node.source} setting.`;
      item.contextValue = editable ? 'usageLens.exclusionGroup' : 'usageLens.editorExclusionGroup';
      item.iconPath = new vscode.ThemeIcon(editable ? 'circle-slash' : 'settings');
      return item;
    }
    const editable = node.source === 'usageLens';
    const item = new vscode.TreeItem(node.pattern, vscode.TreeItemCollapsibleState.None);
    item.contextValue = editable ? 'usageLens.pattern' : 'usageLens.editorPattern';
    item.tooltip = editable ? `${node.pattern}\nClick to open the setting` : `${node.pattern} (from ${node.source}, read-only here)`;
    item.command = {
      command: 'workbench.action.openSettings',
      title: 'Open Setting',
      arguments: [SETTING[node.source]],
    };
    return item;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
