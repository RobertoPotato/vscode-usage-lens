# Usage Lens

**See how much code depends on every class, function and method, right where it's defined.**

```text
3 in file | 12 in project
def calculate_consumption(self, readings):
    ...
```

Usage Lens adds two clickable counts above each symbol:

- **in file**: usages in the file where the symbol is defined.
- **in project**: usages across the whole workspace (including the in-file ones).

A symbol nobody uses shows **`0 in file | 0 in project`**, which makes dead code easy to find.

<!-- Replace with a real recording before publishing; images must be absolute https URLs. -->
<!-- ![Usage Lens demo](https://raw.githubusercontent.com/TODO-owner/usage-lens/main/media/demo.gif) -->

## Features

- **Usage counts on classes, functions, methods, interfaces and structs** in any language with a symbol provider: Python, TypeScript/JavaScript, Go, Java, C#, PHP, Rust and more.
- **Symbol Leaderboard.** Rank every class, function and method in the workspace from most used to least used. Filter by kind, search by name or path, and flip the order to put dead code at the top.
- **Usages sidebar.** Click a count to open the *Usage Lens* view, which lists every usage grouped by file with the matching text highlighted. Click a line to jump to it. Switch between file and project scope, or refresh, from the view toolbar.
- **Two counting modes:**
  | | Language Server (default) | Text |
  |---|---|---|
  | How | "Find All References" from your language extension | Whole-word matches across included files |
  | Accuracy | Type-aware: `A.save` ≠ `B.save` | Name-based: same-named symbols add up |
  | Dynamic usage (Django templates, `getattr`, task names) | Missed | Caught |
  | Needs | A language extension with references | Nothing: works on any text file |
- **Exclusions** keep virtual environments, `node_modules`, build output and anything else out of the counts. Manage them from the **Exclusions** view in the sidebar, from settings, from the Explorer right-click menu, or with a command.
- **Counting mode toggle** in the sidebar's **⋯** menu, plus a status bar item that switches with one click.
- **Fast on big repositories.** Only visible lenses are computed, language-server requests are throttled, and text-mode results are cached per file.
- Works over **Remote-SSH, WSL and Dev Containers**: the extension runs on the machine where your code lives.

## The sidebar

The **Usage Lens** icon in the Activity Bar opens three views:

| View | What it shows |
|---|---|
| **Leaderboard** | Every symbol in the workspace, ranked by usage |
| **Usages** | The usages of one symbol, grouped by file. It fills in when you click a count on a lens or in the Leaderboard. |
| **Exclusions** | The patterns that keep files out of the counts, for each workspace folder |

### Options menu (⋯)

Every view's **⋯** menu has the same options:

- **Count with Language Server** / **Count by Text Match**: the active counting mode has a checkmark. Click the other one to switch.
- **Show Lenses**: turns the lenses above symbols on or off.
- **Refresh Counts** and **Manage Exclusions**.

The `LS` / `Text` item in the status bar also switches mode when you click it.

## Symbol Leaderboard

```text
[ Search symbols or files     ]
(All) (Class) (Function) (Method) (Object)
↓ Most used                      Rescan
 #  SYMBOL                     FILE  PROJECT
 1  ƒ add          src/math.ts    1        4
 2  C Calculator   src/math.ts    0        2
 3  m Calculator.compute          0        1
 …
 6  ƒ unusedHelper src/math.ts    0        0
```

- **Ranking:** by project usages, then in-file usages, then name. Symbols with the same counts share a rank.
- **Filters:** **Class**, **Function**, **Method** (constructors included) and **Object** (interfaces, structs, enums and other type-like symbols). Chips combine, so Class + Method shows both. **All** clears the filter.
- **Search** matches the symbol name, `Class.method`, or the file path, as you type.
- **↓ Most used / ↑ Least used** reverses the order. Least used first lists every `0 | 0` symbol at the top, which works as a dead-code list.
- **Click a row** to open the definition. **Click a count** to list those usages in the Usages view.

**When it scans.** The first time you open the view, it scans the workspace. After that it scans only when you press **Rescan**, or run **Usage Lens: Rescan Leaderboard**. If you edit code, change files, change settings or switch counting mode, a banner tells you the results are out of date. You can **Stop** a scan partway through and keep the results it has so far.

**What it scans.** Files matching `usageLens.leaderboard.include` (source files only, by default), minus your exclusions, up to `usageLens.leaderboard.maxFiles`. It uses the same symbol kinds, ignored names and counting mode as the lenses, and shares their cache, so a scan also speeds up the lenses, and the other way round.

## Exclusions

Patterns use gitignore rules, matched relative to each workspace folder:

| Pattern | Meaning |
|---|---|
| `venv` | any file or folder named `venv`, at any depth |
| `/scripts/legacy` | anchored to the workspace root |
| `src/vendor` | a slash in the middle also anchors to the root |
| `*.min.js`, `**/migrations/**`, `{tmp,cache}`, `gen?`, `[ab]x` | globs |

Excluding a folder excludes everything inside it. Excluded files get no lenses, usages inside them aren't counted, and text mode never reads them.

**Defaults:** `node_modules`, `bower_components`, `venv`, `.venv`, `env`, `virtualenv`, `site-packages`, `dist-packages`, `__pycache__`, `.git`, `.tox`, `.nox`, `.mypy_cache`, `.pytest_cache`, `dist`, `build`, `out`, `target`, `vendor`, `coverage`, `*.min.js`. Your `files.exclude` and `search.exclude` settings also apply (turn this off with `usageLens.useEditorExcludes`).

**Ways to manage them:**

1. Use the **Exclusions** view in the sidebar. **+** adds a pattern, **×** on a row removes it, and **⚙** opens the setting. Patterns that come from `files.exclude` and `search.exclude` are listed separately, as read-only.
2. Right-click files or folders in the Explorer and choose **Exclude from Usage Counts** or **Include in Usage Counts**.
3. Run **Usage Lens: Manage Exclusions** from the Command Palette to add, remove or review patterns.
4. Edit `usageLens.exclude` in `.vscode/settings.json`. Commit the file to share the list with your team.

> **Django tip:** consider adding `**/migrations/**`, `staticfiles` and `media`, and switch to **Text** mode when you want template usages such as `{{ obj.get_total }}` to count.

## Commands

| Command | What it does |
|---|---|
| Usage Lens: Toggle On/Off | Show or hide all lenses |
| Usage Lens: Refresh Counts | Clear the caches and recompute |
| Usage Lens: Switch Counting Mode | Pick Language Server or Text. The sidebar ⋯ menu and the status bar item toggle it too. |
| Usage Lens: Toggle Counting Mode | Flip between the two modes |
| Usage Lens: Rescan Leaderboard | Open the Leaderboard and recount every symbol |
| Usage Lens: Manage Exclusions | Add, remove or view patterns |
| Usage Lens: Add Exclusion Pattern | Quick input box |
| Usage Lens: Remove Exclusion Pattern | Pick a pattern to remove (or press × in the Exclusions view) |
| Exclude / Include in Usage Counts | Explorer context menu (multi-select works) |

## Settings

| Setting | Default | Description |
|---|---|---|
| `usageLens.enabled` | `true` | Show lenses |
| `usageLens.mode` | `languageServer` | `languageServer` or `text` |
| `usageLens.exclude` | see above | Gitignore-style patterns |
| `usageLens.useEditorExcludes` | `true` | Also apply `files.exclude` / `search.exclude` |
| `usageLens.symbolKinds` | class, function, method, interface, struct | Also available: constructor, enum, property, variable, constant, module |
| `usageLens.ignoreNames` | `["^__\\w+__$"]` | Regexes for names that get no lens (hides Python dunders) |
| `usageLens.fileLabel` | `{count} in file` | Label template |
| `usageLens.projectLabel` | `{count} in project` | Label template, e.g. `{count} total` |
| `usageLens.textMode.include` | common source + template extensions | Files scanned in text mode |
| `usageLens.textMode.maxFiles` | `10000` | Safety cap |
| `usageLens.textMode.maxFileSizeKB` | `1024` | Skip huge or minified files |
| `usageLens.maxConcurrentRequests` | `4` | Limit on concurrent language-server requests |
| `usageLens.leaderboard.include` | common source extensions | Files the Leaderboard scans |
| `usageLens.leaderboard.maxFiles` | `2000` | Safety cap for Leaderboard scans |

## Known limitations

- **Imports count as usages** in Language Server mode, because language servers such as Pylance and TypeScript report `from x import foo` as a reference.
- **Overridden methods:** whether calls made through a base class are counted depends on your language server.
- **Dynamic Python** (templates, `getattr`, signal or Celery task names) is only caught in Text mode.
- **Same-named symbols** add up in Text mode. Every `save` counts towards every other `save`.
- **Language servers start slowly.** Right after opening a project, counts may be missing or low. Usage Lens retries automatically, and you can run **Refresh Counts** at any time.
- **Leaderboard scans of large repositories are slow in Language Server mode,** because each symbol needs its own references request. Narrow `usageLens.leaderboard.include`, add exclusions, or press **Stop** when you have enough. Text mode is usually faster.
- **Multi-root workspaces:** each folder applies its own exclusions, and usages in other folders count towards "in project".

## FAQ

**Why doesn't a file show any lenses?** The file is excluded, its language has no symbol provider, or the language server is still loading. Check **Manage Exclusions** and try **Refresh Counts**.

**Why does the count differ from "Find All References"?** Usage Lens leaves out the definition itself, excluded files, and anything outside the workspace (such as `site-packages`).

## Contributing

Issues and pull requests are welcome. See [DEVELOPMENT.md](DEVELOPMENT.md) for the full local setup. In short:

```bash
npm install
npm run watch        # rebuild on change; press F5 in VS Code to launch the Extension Host
npm run test:unit    # fast unit tests in plain Node
npm test             # integration tests in a downloaded VS Code
npm run vsix         # build a .vsix
```

## License

[MIT](LICENSE)
