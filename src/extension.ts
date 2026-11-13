import * as vscode from 'vscode';
import { UsageCodeLensProvider } from './codeLensProvider';
import { registerExclusionCommands } from './exclusionCommands';
import { ExclusionsTreeProvider } from './exclusionsTree';
import { LeaderboardService } from './leaderboard';
import { LEADERBOARD_VIEW, LeaderboardViewProvider } from './leaderboardView';
import { CountingMode, SettingsStore } from './settings';
import { TextIndex } from './textIndex';
import { Scope, UsageResult, UsageService } from './usageService';
import { UsagesTreeProvider } from './usagesTree';

const EDIT_DEBOUNCE_MS = 600;

export interface UsageLensApi {
  /** Exposed for integration tests. */
  usages: UsageService;
  settings: SettingsStore;
  leaderboard: LeaderboardService;
}

export function activate(context: vscode.ExtensionContext): UsageLensApi {
  const settings = new SettingsStore();
  const textIndex = new TextIndex(settings);
  const usages = new UsageService(settings, textIndex);
  const lenses = new UsageCodeLensProvider(settings, usages);
  const tree = new UsagesTreeProvider();
  const view = vscode.window.createTreeView('usageLens.usages', { treeDataProvider: tree, showCollapseAll: true });
  tree.attach(view);
  const leaderboard = new LeaderboardService(settings, usages);
  const leaderboardView = new LeaderboardViewProvider(context.extensionUri, leaderboard, settings);
  const exclusionsTree = new ExclusionsTreeProvider();
  const exclusionsView = vscode.window.createTreeView('usageLens.exclusions', { treeDataProvider: exclusionsTree });

  const status = vscode.window.createStatusBarItem('usageLens.mode', vscode.StatusBarAlignment.Right, 100);
  status.name = 'Usage Lens Mode';
  status.command = 'usageLens.toggleMode';
  const updateStatus = () => {
    const s = settings.current;
    status.text = s.enabled ? `$(references) ${s.mode === 'text' ? 'Text' : 'LS'}` : '$(references) off';
    status.tooltip = `Usage Lens: ${s.enabled ? (s.mode === 'text' ? 'text' : 'language server') + ' mode' : 'disabled'} — click to toggle the counting mode`;
    status.show();
  };
  updateStatus();

  const refreshAll = () => {
    textIndex.clear();
    usages.clear();
    lenses.resetRetries();
    lenses.refresh();
  };

  let editTimer: ReturnType<typeof setTimeout> | undefined;
  const onEdited = (doc: vscode.TextDocument, immediate: boolean) => {
    if (!isWorkspaceDoc(doc)) {
      return;
    }
    textIndex.invalidateFile(doc.uri);
    if (editTimer) {
      clearTimeout(editTimer);
    }
    const fire = () => {
      editTimer = undefined;
      usages.clear();
      lenses.refresh();
      leaderboard.markStale();
    };
    if (immediate) {
      fire();
    } else {
      editTimer = setTimeout(fire, EDIT_DEBOUNCE_MS);
    }
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const onFsChange = (uri: vscode.Uri) => {
    textIndex.invalidateFileList();
    textIndex.invalidateFile(uri);
    usages.clear();
    leaderboard.markStale();
  };

  const config = vscode.workspace.getConfiguration('usageLens');
  const setConfig = (key: string, value: unknown) => {
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    return config.update(key, value, target);
  };

  const setMode = (mode: CountingMode) => (settings.current.mode === mode ? undefined : setConfig('mode', mode));

  context.subscriptions.push(
    view,
    tree,
    leaderboard,
    leaderboardView,
    exclusionsTree,
    exclusionsView,
    vscode.window.registerWebviewViewProvider(LEADERBOARD_VIEW, leaderboardView),
    lenses,
    status,
    watcher,
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lenses),
    vscode.languages.registerCodeLensProvider({ scheme: 'vscode-remote' }, lenses),
    vscode.languages.registerCodeLensProvider({ scheme: 'untitled' }, lenses),

    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length) {
        onEdited(e.document, false);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((d) => onEdited(d, true)),
    watcher.onDidCreate(onFsChange),
    watcher.onDidDelete(onFsChange),
    watcher.onDidChange((uri) => textIndex.invalidateFile(uri)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      settings.reload();
      refreshAll();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('usageLens') ||
        e.affectsConfiguration('files.exclude') ||
        e.affectsConfiguration('search.exclude')
      ) {
        settings.reload();
        usages.onSettingsChanged();
        updateStatus();
        refreshAll();
        exclusionsTree.refresh();
        leaderboard.markStale();
      }
    }),

    vscode.commands.registerCommand('usageLens.toggle', () => setConfig('enabled', !settings.current.enabled)),
    vscode.commands.registerCommand('usageLens.showLenses', () => setConfig('enabled', !settings.current.enabled)),
    vscode.commands.registerCommand('usageLens.refresh', () => {
      settings.reload();
      refreshAll();
    }),
    vscode.commands.registerCommand('usageLens.switchMode', async () => {
      const current = settings.current.mode;
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: 'Language Server',
            id: 'languageServer',
            description: current === 'languageServer' ? '(current)' : '',
            detail: 'Accurate, type-aware counts via Find All References.',
          },
          {
            label: 'Text',
            id: 'text',
            description: current === 'text' ? '(current)' : '',
            detail: 'Whole-word matches. Catches templates, getattr and string usage; may over-count same-named symbols.',
          },
        ],
        { title: 'Usage Lens: Counting Mode' },
      );
      if (pick && pick.id !== current) {
        await setConfig('mode', pick.id);
      }
    }),
    vscode.commands.registerCommand('usageLens.useTextMode', () => setMode('text')),
    vscode.commands.registerCommand('usageLens.useLanguageServerMode', () => setMode('languageServer')),
    vscode.commands.registerCommand('usageLens.toggleMode', () =>
      setMode(settings.current.mode === 'text' ? 'languageServer' : 'text'),
    ),
    vscode.commands.registerCommand('usageLens.leaderboard.scan', async () => {
      await vscode.commands.executeCommand(`${LEADERBOARD_VIEW}.focus`);
      return leaderboardView.scan();
    }),
    vscode.commands.registerCommand('usageLens.leaderboard.stop', () => leaderboard.stop()),
    vscode.commands.registerCommand('usageLens.openExclusionSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'usageLens.exclude'),
    ),
    vscode.commands.registerCommand('usageLens.showUsages', (result: UsageResult, scope: Scope) => {
      if (result) {
        tree.show(result, scope ?? 'project');
      }
    }),
    vscode.commands.registerCommand('usageLens.switchScope', () => tree.switchScope()),
    vscode.commands.registerCommand('usageLens.refreshUsages', async () => {
      const cur = tree.current;
      if (!cur) {
        return;
      }
      textIndex.clear();
      try {
        const fresh = await vscode.window.withProgress(
          { location: { viewId: 'usageLens.usages' } },
          () => usages.recompute(cur.result),
        );
        tree.show(fresh, cur.scope);
      } catch (err) {
        void vscode.window.showErrorMessage(`Usage Lens: could not refresh usages: ${err instanceof Error ? err.message : err}`);
      }
      lenses.refresh();
    }),
    ...registerExclusionCommands(settings),
  );

  return { usages, settings, leaderboard };
}

function isWorkspaceDoc(doc: vscode.TextDocument): boolean {
  return doc.uri.scheme === 'untitled' || !!vscode.workspace.getWorkspaceFolder(doc.uri);
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
