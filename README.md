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
- **Usages sidebar.** Click a count to open the *Usage Lens* view, which lists every usage grouped by file with the matching text highlighted. Click a line to jump to it. Switch between file and project scope, or refresh, from the view toolbar.
- **Two counting modes:**
  | | Language Server (default) | Text |
  |---|---|---|
  | How | "Find All References" from your language extension | Whole-word matches across included files |
  | Accuracy | Type-aware: `A.save` ≠ `B.save` | Name-based: same-named symbols add up |
  | Dynamic usage (Django templates, `getattr`, task names) | Missed | Caught |
  | Needs | A language extension with references | Nothing: works on any text file |
- **Exclusions** keep virtual environments, `node_modules`, build output and anything else out of the counts. Manage them from settings, from the Explorer right-click menu, or with a command.
- **Fast on big repositories.** Only visible lenses are computed, language-server requests are throttled, and text-mode results are cached per file.
- Works over **Remote-SSH, WSL and Dev Containers**: the extension runs on the machine where your code lives.

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

1. Right-click files or folders in the Explorer and choose **Exclude from Usage Counts** or **Include in Usage Counts**.
2. Run **Usage Lens: Manage Exclusions** from the Command Palette to add, remove or review patterns.
3. Edit `usageLens.exclude` in `.vscode/settings.json`. Commit the file to share the list with your team.

> **Django tip:** consider adding `**/migrations/**`, `staticfiles` and `media`, and switch to **Text** mode when you want template usages such as `{{ obj.get_total }}` to count.

## Commands

| Command | What it does |
|---|---|
| Usage Lens: Toggle On/Off | Show or hide all lenses |
| Usage Lens: Refresh Counts | Clear the caches and recompute |
| Usage Lens: Switch Counting Mode | Language Server ↔ Text (or click the status bar item) |
| Usage Lens: Manage Exclusions | Add, remove or view patterns |
| Usage Lens: Add Exclusion Pattern | Quick input box |
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

## Known limitations

- **Imports count as usages** in Language Server mode, because language servers such as Pylance and TypeScript report `from x import foo` as a reference.
- **Overridden methods:** whether calls made through a base class are counted depends on your language server.
- **Dynamic Python** (templates, `getattr`, signal or Celery task names) is only caught in Text mode.
- **Same-named symbols** add up in Text mode. Every `save` counts towards every other `save`.
- **Language servers start slowly.** Right after opening a project, counts may be missing or low. Usage Lens retries automatically, and you can run **Refresh Counts** at any time.
- **Multi-root workspaces:** each folder applies its own exclusions, and usages in other folders count towards "in project".

## FAQ

**Why doesn't a file show any lenses?** The file is excluded, its language has no symbol provider, or the language server is still loading. Check **Manage Exclusions** and try **Refresh Counts**.

**Why does the count differ from "Find All References"?** Usage Lens leaves out the definition itself, excluded files, and anything outside the workspace (such as `site-packages`).

## Contributing

Issues and pull requests are welcome. To work on the extension:

```bash
npm install
npm run watch        # rebuild on change; press F5 in VS Code to launch the Extension Host
npm run test:unit    # fast unit tests in plain Node
npm test             # integration tests in a downloaded VS Code
npm run vsix         # build a .vsix
```

## License

[MIT](LICENSE)
