# Usage Lens — VS Code Extension: Project Definition & Build Plan

**Status:** Planning
**Owner:** Bob
**Target:** VS Code 1.85+ (desktop, including Remote-SSH / WSL)

---

## 1. Summary

Usage Lens is a VS Code extension that shows two clickable usage counts above every class, function and method:

```
3 in file | 12 in project
def calculate_consumption(self, readings):
    ...
```

- **In file**: how many times the symbol is used in the file where it is defined.
- **In project**: how many times it is used across the whole workspace. This includes the in-file usages.
- A symbol with no usages shows `0 in file | 0 in project`, which makes dead code easy to spot.
- Clicking either count opens a **sidebar panel** that lists every usage, grouped by file. Click an entry to jump to that line.
- **Exclusions** keep virtual environments, third-party packages, build output and anything else you choose out of the counts.

---

## 2. Goals and non-goals

### Goals
1. Show usage counts on classes, functions and methods in any language that has a symbol provider (Python, TypeScript/JavaScript, Go, Java, C#, PHP, and others).
2. Count accurately by default, using the language server's "Find All References".
3. Offer a fallback **text mode** for languages without a good reference provider, and for dynamic usage such as Django templates (`{{ obj.get_total }}`), `getattr`, or string-based Celery task names.
4. Make exclusions simple to manage: settings, right-click in the Explorer, and a command-palette manager.
5. Stay fast on large codebases (thousands of files) without freezing the editor.
6. Give a sidebar that works like a focused "Find All References" for one symbol, with file and project scopes.

### Non-goals (v1)
- Call graphs or call hierarchies. VS Code already has Call Hierarchy.
- Automatically deleting or refactoring unused code.
- Cross-repository or cross-workspace analysis.
- A custom parser per language. The extension relies on VS Code's symbol and reference providers, plus text matching.

---

## 3. User stories

| # | As a developer I want to… | So that… |
|---|---|---|
| U1 | see usage counts above every class/function/method | I know how much code depends on it before I change it |
| U2 | see `0 in file \| 0 in project` on unused code | I can find and remove dead code |
| U3 | click "in file" and see only usages in the current file | I can review local usage quickly |
| U4 | click "in project" and see all usages grouped by file | I can assess the impact of a change across the project |
| U5 | exclude `venv/`, `node_modules/`, `site-packages/`, migrations, etc. | third-party or generated code doesn't inflate counts or get lenses |
| U6 | right-click a folder or file and choose "Exclude from Usage Counts" | I don't have to hand-edit settings |
| U7 | switch between language-server and text counting | I can handle dynamic code and languages without a reference provider |
| U8 | have counts update after I edit and save | the numbers stay correct |

---

## 4. Functional requirements

### 4.1 Symbol detection
- Use `vscode.executeDocumentSymbolProvider` to get the symbol tree. Handle both `DocumentSymbol` (nested) and `SymbolInformation` (flat) results.
- Default kinds: **Class, Function, Method, Interface, Struct**. These can be changed in settings, and Constructor, Enum, Property, Variable, Constant and Module are also available.
- Get the bare identifier from the symbol's selection range. If that fails, fall back to cleaning the name (`foo(String)` → `foo`, `(*T).Foo` → `Foo`, `Map<K,V>` → `Map`).
- Names matching the ignore patterns get no lens. The default ignore pattern hides Python dunders (`__init__`, `__str__`, …).
- Language servers such as Pylance start slowly. If a file returns no symbols at first, retry a few times with backoff.

### 4.2 Usage counting: two modes

| | **Language Server (default)** | **Text** |
|---|---|---|
| Source | `vscode.executeReferenceProvider` at the identifier position | Whole-word matches of the name across included files |
| Accuracy | Type-aware: separates `A.save` from `B.save` | Name-based: may over-count same-named symbols |
| Dynamic usage (templates, `getattr`) | Missed | Caught |
| Language support | Needs a language extension with references | Any text file |
| Cost | One LS request per visible symbol | First query scans files; later queries use the cache |

Rules for both modes:
- The **definition itself** is not counted.
- Usages in **excluded files** or **outside the workspace** are dropped. For example, a reference into `/usr/lib/python3/site-packages` doesn't count.
- Duplicates at the same location are removed.
- **Project count = all remaining usages. In-file count = the subset in the defining file.**

### 4.3 CodeLens display
- Two lenses on the declaration's first line: `{count} in file` and `{count} in project`. VS Code puts `|` between them.
- The labels are templates in settings, so `{count}` can be restyled, for example `{count} local` / `{count} total`.
- Lenses are **resolved lazily**: VS Code only resolves lenses that are visible, which keeps large files cheap.
- Both lenses for a symbol share one cached computation.
- If counting fails, show a non-clickable `usages: unavailable` with the error in the tooltip.

### 4.4 Sidebar (results panel)
- A **Usage Lens** container in the Activity Bar holding one tree view, **Usages**.
- Opened by clicking a lens. The view title shows the symbol name and the scope, for example `calculate_consumption — 12 in project`.
- Tree layout:
  ```
  ▾ meters/services.py        4
      total = self.calculate_consumption(r)        :88
      ...
  ▾ billing/tasks.py          2
      ...
  ```
  - File nodes show the file icon, the relative directory, and a count badge.
  - Line nodes show the trimmed source line with the symbol highlighted and the line number. Clicking one opens the file at that position.
- Toolbar: **Switch File/Project** (re-filters the current result) and **Refresh** (recomputes). Collapse All is also available.
- Empty state: "No usages of `X` in project (exclusions applied)."
- Welcome view when nothing is selected, with links to Manage Exclusions and Switch Mode.

### 4.5 Exclusions
**Pattern semantics** (gitignore-like, matched relative to the workspace folder):
- `venv` (no slash) matches at any depth, the same as `**/venv`.
- `/scripts/legacy` (leading slash) is anchored to the workspace root.
- `src/vendor` (slash in the middle) is anchored to the root.
- Globs work: `*`, `**`, `?`, `{a,b}`, `[abc]`.
- **Excluding a folder excludes everything inside it.** The matcher tests the path and every ancestor directory.

**Default exclusions:**
`node_modules, bower_components, venv, .venv, env, virtualenv, site-packages, dist-packages, __pycache__, .git, .tox, .nox, .mypy_cache, .pytest_cache, dist, build, out, target, vendor, coverage, *.min.js`

**Ways to manage them:**
1. Setting `usageLens.exclude`, stored per workspace in `.vscode/settings.json` so it can be committed for the team.
2. Explorer right-click → **Exclude from Usage Counts** or **Include in Usage Counts**. Multi-select is supported. This writes `/<relative path>`.
3. Command palette → **Usage Lens: Manage Exclusions**: add a pattern, remove patterns (multi-select pick list), or open settings.
4. Optional: also apply `files.exclude` and `search.exclude` (on by default).

Effects of an exclusion:
- No lenses are shown in excluded files.
- Usages found in excluded files are not counted.
- Text mode doesn't list or read excluded files at all, for speed.

**Suggested extra exclusions for Django projects** (not defaults, but worth considering): `**/migrations/**`, `staticfiles`, `media`.

### 4.6 Commands

| Command | Purpose |
|---|---|
| Usage Lens: Toggle On/Off | Enable or disable lenses |
| Usage Lens: Refresh Counts | Clear caches and recompute |
| Usage Lens: Switch Counting Mode | Language Server ↔ Text |
| Usage Lens: Manage Exclusions | Add, remove or view patterns |
| Usage Lens: Add Exclusion Pattern | Quick input box |
| Exclude / Include in Usage Counts | Explorer context menu |
| Switch File / Project, Refresh Usages | Sidebar toolbar |

### 4.7 Settings

| Setting | Default | Notes |
|---|---|---|
| `usageLens.enabled` | `true` | |
| `usageLens.mode` | `languageServer` | or `text` |
| `usageLens.exclude` | (list above) | glob patterns |
| `usageLens.useEditorExcludes` | `true` | also apply files/search.exclude |
| `usageLens.symbolKinds` | class, function, method, interface, struct | |
| `usageLens.ignoreNames` | `["^__\\w+__$"]` | regexes |
| `usageLens.fileLabel` | `{count} in file` | |
| `usageLens.projectLabel` | `{count} in project` | |
| `usageLens.textMode.include` | common source extensions + html/jinja | glob |
| `usageLens.textMode.maxFiles` | `10000` | safety cap |
| `usageLens.textMode.maxFileSizeKB` | `1024` | skip huge or minified files |
| `usageLens.maxConcurrentRequests` | `4` | LS request throttle |

---

## 5. Architecture

```
extension.ts            activation, command + event wiring
 ├─ settings.ts         SettingsStore: reads config, builds ExclusionMatcher, findFiles exclude glob
 ├─ glob.ts             pure helpers: glob→RegExp, ExclusionMatcher, word scan, offset→line/col
 ├─ symbols.ts          getTargetSymbols(doc): flatten symbol tree → TargetSymbol[]
 ├─ usageService.ts     UsageService: per-symbol cached results; LS mode + throttle; filtering/dedupe
 ├─ textIndex.ts        TextIndex: file list, text cache, per-name hit cache (text mode)
 ├─ codeLensProvider.ts provide (cheap: symbols) / resolve (lazy: counts)
 └─ usagesTree.ts       TreeDataProvider for the sidebar
```

**Data flow**
1. VS Code calls `provideCodeLenses(doc)`. The provider gets the symbols and returns 2 unresolved lenses per symbol.
2. VS Code calls `resolveCodeLens` for visible lenses. This calls `UsageService.get(doc, symbol)`, which is cached by `(mode, uri, doc.version, position, name)`.
3. The result is filtered and deduplicated, and holds `{ inFile[], project[] }`. The lens title is set, and the lens command carries the result and its scope.
4. On click, `usageLens.showUsages(result, scope)` hands the result to the tree provider, which groups by file, loads line previews, and focuses the view.

**Cache invalidation**

| Event | Action |
|---|---|
| Document edited | invalidate that file in TextIndex; clear result cache (debounced ~600 ms); refresh lenses |
| Document saved | same, immediately |
| File created/deleted (FileSystemWatcher) | invalidate the file list |
| Config change (`usageLens.*`, `files.exclude`, `search.exclude`) | reload settings, clear everything, refresh |
| Manual Refresh command | clear everything |

---

## 6. Performance plan
- **Lazy resolution:** only symbols on screen are counted.
- **Throttling:** at most N concurrent reference requests (default 4), so the language server isn't flooded.
- **Shared promise:** the "file" and "project" lenses for a symbol trigger a single computation.
- **Text mode:**
  - The file list comes from `findFiles(include, excludeGlob, maxFiles)`, so excluded trees are never even listed.
  - Text is cached per file, a name is scanned with `indexOf` plus a word-boundary check, and hits are cached per (name, file). After an edit, only the changed file is rescanned.
  - Files that are too large or binary are skipped.
  - Files are read in batches of 64.
- **Targets:** a lens appears within about 1 s of opening a file in a 2,000-file Django project. Text-mode first scan finishes in under 3 s, and later queries in under 100 ms.

---

## 7. Edge cases & known limitations
- **Imports count as usages** in Language Server mode, because Pylance and TS report `from x import foo` as a reference. This is acceptable for v1; a possible v2 option could exclude import lines.
- **Overridden methods / polymorphism:** the LS may or may not include calls through a base class. This depends on the language server.
- **Dynamic Python** (Django templates, `getattr`, signal strings, Celery task names): only text mode catches these.
- **Same-named symbols** over-count in text mode. This is documented as the trade-off.
- **Language server not ready** at startup gives empty or partial results. Retry with backoff, and the user can run Refresh.
- **Multi-root workspaces:** patterns are relative to each folder. Usages in other workspace folders count as "project".
- **Unsaved buffers:** both modes use the live editor text where possible.
- **Remote-SSH / WSL:** the extension runs on the remote host (workspace extension), so file reads are local to the code.

---

## 8. Testing strategy
1. **Unit tests** (plain Node, no VS Code): glob → regex, ExclusionMatcher (ancestor matching, anchoring, braces), `scanWord` boundaries (`foo` vs `foobar` vs `_foo`), offset → line/col, `bareName` cleanup.
2. **Integration tests** (`@vscode/test-electron` + Mocha) against fixture workspaces:
   - A Python fixture: unused function → `0|0`, a method used in-file and cross-file, and a usage inside `venv/` that is excluded.
   - A TypeScript fixture: same scenarios using the built-in TS server.
   - Exclusion commands write the correct patterns to settings.
3. **Manual QA checklist:** Pylance on a real Django project; text mode on templates; toggle, refresh and mode switch; sidebar scope switching; large repo performance; Remote-SSH.

---

## 9. Milestones

| Phase | Deliverable | Est. |
|---|---|---|
| **M0 – Scaffold** | package.json manifest, tsconfig, build/watch scripts, activity-bar icon, F5 debug config | 0.5 day |
| **M1 – Core lenses (LS mode)** | symbols.ts, usageService (LS), codeLensProvider; `0 in file \| 0 in project` working on Python + TS | 1 day |
| **M2 – Exclusions** | glob.ts matcher, settings store, defaults, Explorer exclude/include, Manage Exclusions command | 1 day |
| **M3 – Sidebar** | Tree view, grouping, previews with highlights, scope toggle, refresh, empty/welcome states | 1 day |
| **M4 – Text mode** | TextIndex with caching and invalidation, mode switch command | 1 day |
| **M5 – Robustness** | cache invalidation wiring, throttling, LS-not-ready retry, error lenses, Windows paths | 0.5 day |
| **M6 – Tests & packaging** | unit + integration tests, README, CHANGELOG, `vsce package` → `.vsix` | 1 day |
| **M7 – Optional publish** | Marketplace / Open VSX publisher setup | 0.5 day |

**Total:** about 6–7 working days for a polished v1. A usable prototype covering M0–M3 takes about 3 days.

---

## 10. Possible v2 features
- An option to **exclude import lines** from counts.
- **Status bar** summary: "N unused symbols in this file".
- **Workspace "Unused Code" report:** a tree of every 0-usage symbol in the project.
- Separate **read and write** counts for properties and variables.
- Colour or decoration for zero-usage symbols (CodeLens can't be coloured, but a gutter icon or a faded decoration could).
- A `.usagelensignore` file as an alternative to settings.
- Configurable inclusion of test files (for example, show "used only in tests").

---

## 11. Open decisions for Bob
1. **Default mode:** Language Server (accurate) or Text (catches Django template usage)? *Proposed: Language Server, with an easy switch.*
2. **Project count:** should it **include** in-file usages (total) or **exclude** them (other files only)? *Proposed: include, so project ≥ file.*
3. **Label style:** `3 in file | 12 in project`, or compact `3 · 12`? *Proposed: verbose by default, templated in settings.*
4. **Hide dunder methods** (`__init__`, `__str__`) by default? *Proposed: yes.*
5. **Exclude `migrations/` by default** for Django projects? *Proposed: no (keep generic), but list it in the README.*
6. **Distribution:** private `.vsix` only, or publish to Marketplace / Open VSX?
