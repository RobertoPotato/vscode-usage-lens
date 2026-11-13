# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Symbol Leaderboard** sidebar view that ranks every class, function and method by usage, with Class / Function / Method / Object filters, live search, a most-used/least-used toggle, and Rescan / Stop.
- **Exclusions** sidebar view listing the patterns for each folder (Usage Lens patterns, plus read-only `files.exclude` / `search.exclude`), with add and remove actions.
- Sidebar **⋯** options menu with a counting-mode checkmark toggle, Show Lenses, Refresh Counts and Manage Exclusions.
- Commands: Toggle Counting Mode, Rescan Leaderboard, Remove Exclusion Pattern.
- Settings: `usageLens.leaderboard.include`, `usageLens.leaderboard.maxFiles`.

### Changed
- Clicking the status bar item now toggles the counting mode directly instead of opening a picker.

## [0.1.0]

### Added
- `N in file | M in project` CodeLenses above classes, functions, methods, interfaces and structs.
- Language Server counting mode (Find All References) and Text counting mode (whole-word matching).
- Usages sidebar grouped by file, with highlighted previews, a file/project scope switch and refresh.
- Gitignore-style exclusions with sensible defaults, Explorer exclude/include, and a Manage Exclusions command.
- Status bar mode indicator, a toggle command, and automatic retry while language servers start.
