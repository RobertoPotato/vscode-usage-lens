# Running Usage Lens locally

## 1. Prerequisites

- **Node.js 20+** and npm (`node -v`)
- **VS Code 1.85+** (`code --version`)
- Optional: the **Python** extension (Pylance), if you want to try the Python fixture or a Django project

## 2. Install dependencies

```bash
cd usage-lens
npm install
```

## 3. Run it in a development window (the main loop)

1. Open the repo in VS Code: `code .`
2. Press **F5**. You can also open *Run and Debug* and choose **Run Extension**.
   - This builds `dist/extension.js` once and opens a second window titled **[Extension Development Host]**.
   - That window opens `test/fixtures/ts-project`, a small TypeScript project made for trying the extension.
3. In the development window, open `src/math.ts`. Lenses appear above each function and class after a few seconds, while the TypeScript server loads:
   ```text
   1 in file | 4 in project
   export function add(a: number, b: number): number {
   ```
4. Click a count to open the **Usage Lens** sidebar (magnifier icon in the Activity Bar).

### Things to try

| Try | Expected |
|---|---|
| `unusedHelper` in `src/math.ts` | `0 in file \| 0 in project` |
| `add` | `venv/lib.ts` is **not** counted (excluded by default) |
| Command Palette → **Usage Lens: Switch Counting Mode** → Text | `compute` goes from 1 to 2 in project (matches `templates/page.html`) |
| Right-click `src/legacy` in the Explorer → **Exclude from Usage Counts** | `src/legacy/old.ts` loses its lenses; `.vscode/settings.json` gets `/src/legacy` |
| Status bar item `LS` / `Text` (bottom right) | Click it to switch mode |

### Editing code while it runs

1. In the **main** window, start the watcher: `npm run watch` in a terminal, or press **Ctrl+Shift+B** (the default build task).
2. Edit any file in `src/`. esbuild rebuilds in milliseconds.
3. In the **development** window, run **Developer: Reload Window** (Ctrl+R) to load the new build.

Breakpoints you set in `src/*.ts` in the main window work, because the dev build includes source maps. `console.log` output shows in the main window's **Debug Console**.

### Using your own project instead of the fixture

Either open another folder from the development window with **File → Open Folder** (the extension stays loaded), or change the folder path in `.vscode/launch.json`:

```json
"args": ["--extensionDevelopmentPath=${workspaceFolder}", "/path/to/your/django-project"],
```

The development window loads your normally installed extensions, so Pylance works. To check Python, open `test/fixtures/py-project`. Its `README.md` lists the counts you should see.

## 4. Run the tests

```bash
npm run typecheck     # TypeScript type check
npm run lint          # ESLint
npm run test:unit     # pure unit tests, plain Node, about 1 s
npm test              # integration tests in a real VS Code
```

`npm test` downloads VS Code 1.85.2 into `.vscode-test/` the first time it runs, and briefly opens a VS Code window. To run it headless, install Xvfb:

```bash
sudo apt install xvfb
xvfb-run -a npm test
```

## 5. Install it in your everyday VS Code

```bash
npm run vsix                                   # creates usage-lens-0.1.0.vsix
code --install-extension usage-lens-0.1.0.vsix
```

Reload VS Code and it works in every project. To remove it:

```bash
code --uninstall-extension TODO-publisher.usage-lens   # use your real publisher ID once it's set
```

After code changes, run `npm run vsix` and install again. Bump `version` in `package.json` if VS Code keeps the old copy.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No lenses at all | Check that `editor.codeLens` is on in Settings and that the status bar doesn't say `off` (**Usage Lens: Toggle On/Off**). |
| No lenses in one file | The file may be excluded (**Usage Lens: Manage Exclusions**), or its language has no symbol provider. |
| Counts are 0 or low just after opening | The language server is still indexing. Wait, or run **Usage Lens: Refresh Counts**. |
| F5 fails with a build error | Run `npm run compile` in a terminal to see the error. |
| Changes don't show up | Make sure `npm run watch` is running, then press Ctrl+R in the development window. |
| Integration tests fail on the counts | Delete `test/fixtures/ts-project/.vscode/` (left behind if a test run was interrupted) and run them again. |
