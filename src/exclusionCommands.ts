import * as vscode from 'vscode';
import { ExclusionMatcher, toAnchoredGlob } from './glob';
import { SettingsStore, relativeTo } from './settings';

const SECTION = 'usageLens';
const KEY = 'exclude';

/** The exclusion list as it currently applies to a folder (folder > workspace > default). */
export function currentList(folder: vscode.WorkspaceFolder): string[] {
  const info = vscode.workspace.getConfiguration(SECTION, folder.uri).inspect<string[]>(KEY);
  return [...(info?.workspaceFolderValue ?? info?.workspaceValue ?? info?.defaultValue ?? [])];
}

export async function writeList(folder: vscode.WorkspaceFolder, list: string[]): Promise<void> {
  await vscode.workspace
    .getConfiguration(SECTION, folder.uri)
    .update(KEY, list, vscode.ConfigurationTarget.WorkspaceFolder);
}

export async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage('Usage Lens: open a folder to manage exclusions.');
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Workspace folder whose exclusions to change' });
}

function groupByFolder(uris: vscode.Uri[]): Map<vscode.WorkspaceFolder, string[]> {
  const out = new Map<vscode.WorkspaceFolder, string[]>();
  for (const uri of uris) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      continue;
    }
    const rel = relativeTo(folder, uri);
    if (!rel) {
      continue; // the folder root itself
    }
    const list = out.get(folder) ?? [];
    list.push(rel);
    out.set(folder, list);
  }
  return out;
}

function targets(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined): vscode.Uri[] {
  if (uris && uris.length) {
    return uris;
  }
  if (uri) {
    return [uri];
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  return active ? [active] : [];
}

export function registerExclusionCommands(settings: SettingsStore): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('usageLens.excludeResource', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      let added = 0;
      for (const [folder, rels] of groupByFolder(targets(uri, uris))) {
        const list = currentList(folder);
        for (const rel of rels) {
          const pattern = `/${rel}`;
          if (!list.includes(pattern)) {
            list.push(pattern);
            added++;
          }
        }
        await writeList(folder, list);
      }
      if (added) {
        void vscode.window.setStatusBarMessage(`Usage Lens: excluded ${added} path${added === 1 ? '' : 's'}`, 3000);
      }
    }),

    vscode.commands.registerCommand('usageLens.includeResource', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const stillExcluded: string[] = [];
      for (const [folder, rels] of groupByFolder(targets(uri, uris))) {
        const list = currentList(folder);
        const remove = new Set(rels.flatMap((r) => [`/${r}`, r, `${r}/`, `/${r}/`]));
        const next = list.filter((p) => !remove.has(p.trim()));
        if (next.length !== list.length) {
          await writeList(folder, next);
        }
        // Anything still matching is excluded by a broader pattern; tell the user which.
        for (const rel of rels) {
          const blockers = next.filter((p) => toAnchoredGlob(p) && new ExclusionMatcher([p]).isExcluded(rel));
          if (blockers.length) {
            stillExcluded.push(`${rel} (by ${blockers.map((b) => `"${b}"`).join(', ')})`);
          }
        }
      }
      settings.reload();
      if (stillExcluded.length) {
        const choice = await vscode.window.showWarningMessage(
          `Usage Lens: still excluded by a broader pattern: ${stillExcluded.join('; ')}`,
          'Manage Exclusions',
        );
        if (choice) {
          await vscode.commands.executeCommand('usageLens.manageExclusions');
        }
      }
    }),

    vscode.commands.registerCommand('usageLens.addExclusion', async (arg?: vscode.WorkspaceFolder | { folder: vscode.WorkspaceFolder }) => {
      // Called with a folder (Manage Exclusions), an Exclusions tree node, or nothing (palette).
      const target = arg && 'folder' in arg ? arg.folder : arg;
      const folder = target && 'uri' in target && 'index' in target ? target : await pickFolder();
      if (!folder) {
        return;
      }
      const value = await vscode.window.showInputBox({
        title: 'Usage Lens: Add Exclusion Pattern',
        prompt: 'Gitignore-style: "venv" matches at any depth, "/scripts/legacy" is anchored to the folder root, globs like **/migrations/** work.',
        placeHolder: '**/migrations/**',
        validateInput: (v) => (toAnchoredGlob(v) ? undefined : 'Enter a non-empty pattern'),
      });
      if (!value) {
        return;
      }
      const list = currentList(folder);
      if (!list.includes(value.trim())) {
        list.push(value.trim());
        await writeList(folder, list);
      }
    }),

    vscode.commands.registerCommand(
      'usageLens.removeExclusion',
      async (node?: { folder: vscode.WorkspaceFolder; pattern: string }) => {
        let folder = node?.folder;
        let pattern = node?.pattern;
        if (!folder || pattern === undefined) {
          folder = await pickFolder();
          if (!folder) {
            return;
          }
          const pick = await vscode.window.showQuickPick(currentList(folder), {
            title: 'Usage Lens: Remove exclusion pattern',
          });
          if (!pick) {
            return;
          }
          pattern = pick;
        }
        const list = currentList(folder);
        const next = list.filter((p) => p !== pattern);
        if (next.length !== list.length) {
          await writeList(folder, next);
        }
      },
    ),

    vscode.commands.registerCommand('usageLens.manageExclusions', async () => {
      const folder = await pickFolder();
      if (!folder) {
        return;
      }
      const list = currentList(folder);
      type Action = vscode.QuickPickItem & { id: string };
      const pick = await vscode.window.showQuickPick<Action>(
        [
          { id: 'add', label: '$(add) Add pattern…' },
          { id: 'remove', label: '$(trash) Remove patterns…', description: `${list.length} defined` },
          { id: 'settings', label: '$(gear) Open settings' },
          { id: 'sep', label: 'Current patterns', kind: vscode.QuickPickItemKind.Separator },
          ...list.map((p) => ({ id: 'none', label: p })),
        ],
        { title: `Usage Lens: Exclusions — ${folder.name}`, placeHolder: 'Choose an action' },
      );
      if (!pick) {
        return;
      }
      if (pick.id === 'add') {
        await vscode.commands.executeCommand('usageLens.addExclusion', folder);
      } else if (pick.id === 'remove') {
        const toRemove = await vscode.window.showQuickPick(
          list.map((p) => ({ label: p })),
          { canPickMany: true, title: 'Usage Lens: Remove exclusion patterns' },
        );
        if (toRemove?.length) {
          const drop = new Set(toRemove.map((r) => r.label));
          await writeList(
            folder,
            list.filter((p) => !drop.has(p)),
          );
        }
      } else if (pick.id === 'settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'usageLens.exclude');
      }
    }),
  ];
}
