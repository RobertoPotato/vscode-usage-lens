import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

const folder = () => vscode.workspace.workspaceFolders![0];
const fixture = (rel: string) => vscode.Uri.joinPath(folder().uri, rel);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map symbol line → "N in file | M in project" for every Usage Lens lens in a document. */
async function lensTitles(uri: vscode.Uri): Promise<Map<number, string>> {
  const lenses = (await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri, 1000)) ?? [];
  const byLine = new Map<number, string[]>();
  for (const l of lenses) {
    if (l.command?.command !== 'usageLens.showUsages') {
      continue;
    }
    const list = byLine.get(l.range.start.line) ?? [];
    list.push(l.command.title);
    byLine.set(l.range.start.line, list);
  }
  return new Map([...byLine].map(([k, v]) => [k, v.join(' | ')]));
}

/** The TS server needs time to load the project; poll until the expectation holds or time out. */
async function expectLenses(uri: vscode.Uri, expected: Record<number, string>, timeoutMs = 45000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = new Map<number, string>();
  while (Date.now() < deadline) {
    await vscode.commands.executeCommand('usageLens.refresh');
    last = await lensTitles(uri);
    if (Object.entries(expected).every(([line, title]) => last.get(Number(line)) === title)) {
      return;
    }
    await sleep(1000);
  }
  assert.deepEqual(Object.fromEntries(last), expected);
}

async function setMode(mode: 'languageServer' | 'text') {
  await vscode.workspace.getConfiguration('usageLens').update('mode', mode, vscode.ConfigurationTarget.Workspace);
}

suite('Usage Lens', () => {
  const math = fixture('src/math.ts');

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'usage-lens');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(math));
  });

  suiteTeardown(async () => {
    const c = vscode.workspace.getConfiguration('usageLens', folder().uri);
    await c.update('mode', undefined, vscode.ConfigurationTarget.Workspace);
    await c.update('exclude', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  });

  test('language server mode: counts, zero usages, exclusions', async () => {
    await setMode('languageServer');
    await expectLenses(math, {
      0: '1 in file | 4 in project', // add: double() + import + 2 calls in app.ts; venv/ excluded
      4: '1 in file | 1 in project', // double
      8: '0 in file | 0 in project', // unusedHelper
      10: '0 in file | 2 in project', // Calculator: import + new
      11: '0 in file | 1 in project', // compute
    });
  });

  test('text mode also counts template usage', async () => {
    await setMode('text');
    await expectLenses(math, {
      0: '1 in file | 4 in project',
      8: '0 in file | 0 in project',
      11: '0 in file | 2 in project', // c.compute + {{ calc.compute }}
    });
    await setMode('languageServer');
  });

  test('showUsages command receives a result carrying both scopes', async () => {
    const lenses = (await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', math, 1000)) ?? [];
    const lens = lenses.find((l) => l.command?.command === 'usageLens.showUsages' && l.range.start.line === 0);
    assert.ok(lens?.command?.arguments);
    const [result, scope] = lens.command.arguments as [{ name: string; inFile: unknown[]; project: unknown[] }, string];
    assert.equal(result.name, 'add');
    assert.ok(result.project.length >= result.inFile.length);
    assert.ok(scope === 'file' || scope === 'project');
    await vscode.commands.executeCommand('usageLens.showUsages', result, scope);
  });

  test('leaderboard ranks workspace symbols and skips excluded files', async () => {
    await setMode('languageServer');
    // Make sure the TS server is warm before scanning.
    await expectLenses(math, { 0: '1 in file | 4 in project' });
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'usage-lens')!;
    const api = ext.exports as {
      leaderboard: { scan(): Promise<{ symbols: number }>; current: readonly { name: string; container?: string; file: string; project: number; inFile: number; group: string }[] };
    };
    const summary = await api.leaderboard.scan();
    const rows = api.leaderboard.current;
    assert.equal(summary.symbols, rows.length);
    const byName = new Map(rows.map((r) => [r.name, r]));
    assert.equal(byName.get('add')?.project, 4);
    assert.equal(byName.get('unusedHelper')?.project, 0);
    assert.equal(byName.get('compute')?.container, 'Calculator');
    assert.equal(byName.get('compute')?.group, 'method');
    assert.equal(byName.get('Calculator')?.group, 'class');
    assert.ok(byName.has('legacyThing'), 'src/legacy is not excluded by default');
    assert.ok(!rows.some((r) => r.file.startsWith('venv/')), 'venv/ is excluded');
    const sorted = [...rows].sort((a, b) => b.project - a.project);
    assert.equal(sorted[0].name, 'add');
  });

  test('mode commands set the counting mode', async () => {
    await vscode.commands.executeCommand('usageLens.useTextMode');
    assert.equal(vscode.workspace.getConfiguration('usageLens').get('mode'), 'text');
    await vscode.commands.executeCommand('usageLens.toggleMode');
    assert.equal(vscode.workspace.getConfiguration('usageLens').get('mode'), 'languageServer');
    await vscode.commands.executeCommand('usageLens.useTextMode');
    await vscode.commands.executeCommand('usageLens.useLanguageServerMode');
    assert.equal(vscode.workspace.getConfiguration('usageLens').get('mode'), 'languageServer');
  });

  test('removeExclusion drops one pattern and keeps the rest', async () => {
    await vscode.commands.executeCommand('usageLens.removeExclusion', { folder: folder(), pattern: '*.min.js' });
    const list = vscode.workspace.getConfiguration('usageLens', folder().uri).inspect<string[]>('exclude')?.workspaceFolderValue;
    assert.ok(list && !list.includes('*.min.js'), `expected *.min.js removed from ${JSON.stringify(list)}`);
    assert.ok(list.includes('venv'));
    await vscode.workspace
      .getConfiguration('usageLens', folder().uri)
      .update('exclude', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  });

  test('Explorer exclude/include writes anchored patterns', async () => {
    const legacy = fixture('src/legacy');
    await vscode.commands.executeCommand('usageLens.excludeResource', legacy, [legacy]);
    let list = vscode.workspace.getConfiguration('usageLens', folder().uri).inspect<string[]>('exclude')?.workspaceFolderValue;
    assert.ok(list?.includes('/src/legacy'), `expected /src/legacy in ${JSON.stringify(list)}`);
    assert.ok(list?.includes('venv'), 'defaults should be preserved');

    const oldTs = fixture('src/legacy/old.ts');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(oldTs));
    await sleep(500);
    assert.equal((await lensTitles(oldTs)).size, 0, 'excluded files get no lenses');

    await vscode.commands.executeCommand('usageLens.includeResource', legacy, [legacy]);
    list = vscode.workspace.getConfiguration('usageLens', folder().uri).inspect<string[]>('exclude')?.workspaceFolderValue;
    assert.ok(!list?.includes('/src/legacy'));
  });
});
