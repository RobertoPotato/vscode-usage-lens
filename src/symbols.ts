import * as vscode from 'vscode';
import { bareName, isIdentChar } from './glob';
import { SettingsStore } from './settings';

export interface TargetSymbol {
  /** Bare identifier, e.g. `calculate_consumption`. */
  name: string;
  kind: vscode.SymbolKind;
  /** Range of the identifier (where references are requested). */
  nameRange: vscode.Range;
  /** Full declaration range; the lens is placed on its first line. */
  range: vscode.Range;
  /** Name of the enclosing symbol (e.g. the class of a method), if any. */
  container?: string;
}

type SymbolResult = Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined;

function isDocumentSymbol(s: vscode.DocumentSymbol | vscode.SymbolInformation): s is vscode.DocumentSymbol {
  return (s as vscode.DocumentSymbol).selectionRange !== undefined;
}

/** Locate the identifier `name` inside `range` (used when the provider gives no useful selection range). */
function findNameRange(doc: vscode.TextDocument, range: vscode.Range, name: string): vscode.Range | undefined {
  const text = doc.getText(range);
  let from = 0;
  for (;;) {
    const i = text.indexOf(name, from);
    if (i < 0) {
      return undefined;
    }
    if (!isIdentChar(text[i - 1]) && !isIdentChar(text[i + name.length])) {
      const start = doc.offsetAt(range.start) + i;
      return new vscode.Range(doc.positionAt(start), doc.positionAt(start + name.length));
    }
    from = i + name.length;
  }
}

function toTarget(
  doc: vscode.TextDocument,
  displayName: string,
  kind: vscode.SymbolKind,
  range: vscode.Range,
  selection: vscode.Range | undefined,
): TargetSymbol | undefined {
  let name: string | undefined;
  let nameRange: vscode.Range | undefined;
  if (selection && !selection.isEmpty && selection.isSingleLine) {
    const t = doc.getText(selection);
    if (/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(t)) {
      name = t;
      nameRange = selection;
    }
  }
  if (!name) {
    name = bareName(displayName);
    if (!name) {
      return undefined;
    }
    nameRange = findNameRange(doc, selection && !selection.isEmpty ? selection : range, name) ?? findNameRange(doc, range, name);
  }
  if (!nameRange) {
    return undefined;
  }
  return { name, kind, nameRange, range };
}

export async function fetchSymbols(uri: vscode.Uri): Promise<SymbolResult> {
  return vscode.commands.executeCommand<SymbolResult>('vscode.executeDocumentSymbolProvider', uri);
}

/** Flatten the symbol tree and keep only the kinds/names the user wants lenses for. */
export function collectTargets(doc: vscode.TextDocument, symbols: SymbolResult, settings: SettingsStore): TargetSymbol[] {
  const out: TargetSymbol[] = [];
  if (!symbols) {
    return out;
  }
  const kinds = settings.current.symbolKinds;
  const consider = (t: TargetSymbol | undefined, container: string | undefined) => {
    if (t && kinds.has(t.kind) && !settings.isIgnoredName(t.name)) {
      if (container) {
        t.container = container;
      }
      out.push(t);
    }
  };
  const walk = (list: vscode.DocumentSymbol[], container: string | undefined) => {
    for (const s of list) {
      const t = toTarget(doc, s.name, s.kind, s.range, s.selectionRange);
      consider(t, container);
      if (s.children?.length) {
        walk(s.children, t?.name ?? (bareName(s.name) || container));
      }
    }
  };
  if (symbols.length && isDocumentSymbol(symbols[0])) {
    walk(symbols as vscode.DocumentSymbol[], undefined);
  } else {
    for (const s of symbols as vscode.SymbolInformation[]) {
      if (s.location.uri.toString() === doc.uri.toString()) {
        consider(toTarget(doc, s.name, s.kind, s.location.range, undefined), s.containerName ? bareName(s.containerName) || s.containerName : undefined);
      }
    }
  }
  // One lens pair per identifier position.
  const seen = new Set<string>();
  return out.filter((t) => {
    const k = `${t.nameRange.start.line}:${t.nameRange.start.character}`;
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}
