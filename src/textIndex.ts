import * as vscode from 'vscode';
import { lineStarts, offsetToLineCol, scanWord } from './glob';
import { SettingsStore } from './settings';

interface CachedText {
  text: string;
  starts: number[];
}

const BATCH = 64;
const decoder = new TextDecoder('utf-8');

/**
 * Text-mode index: the file list, a per-file text cache and a per-(name, file) hit cache.
 * After an edit only the changed file is rescanned.
 */
export class TextIndex {
  private fileList: Promise<vscode.Uri[]> | undefined;
  /** uri → text, or null when the file was skipped (too big / binary / unreadable). */
  private texts = new Map<string, CachedText | null>();
  /** name → (uri → offsets of whole-word hits). */
  private hits = new Map<string, Map<string, vscode.Range[]>>();

  constructor(private readonly settings: SettingsStore) {}

  clear(): void {
    this.fileList = undefined;
    this.texts.clear();
    this.hits.clear();
  }

  invalidateFileList(): void {
    this.fileList = undefined;
  }

  invalidateFile(uri: vscode.Uri): void {
    const key = uri.toString();
    this.texts.delete(key);
    for (const perFile of this.hits.values()) {
      perFile.delete(key);
    }
  }

  private listFiles(): Promise<vscode.Uri[]> {
    if (!this.fileList) {
      this.fileList = (async () => {
        const s = this.settings.current;
        const out: vscode.Uri[] = [];
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
          const remaining = s.textMaxFiles - out.length;
          if (remaining <= 0) {
            break;
          }
          const ex = this.settings.excludeGlobFor(folder);
          const found = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, s.textInclude),
            ex ? new vscode.RelativePattern(folder, ex) : undefined,
            remaining,
          );
          for (const uri of found) {
            if (!this.settings.isExcluded(uri)) {
              out.push(uri);
            }
          }
        }
        return out;
      })();
      // Don't cache a failed listing.
      this.fileList.catch(() => (this.fileList = undefined));
    }
    return this.fileList;
  }

  private async loadText(uri: vscode.Uri, openDocs: Map<string, vscode.TextDocument>): Promise<CachedText | null> {
    const key = uri.toString();
    const cached = this.texts.get(key);
    if (cached !== undefined) {
      return cached;
    }
    let result: CachedText | null = null;
    const doc = openDocs.get(key);
    if (doc) {
      const text = doc.getText();
      result = { text, starts: lineStarts(text) };
    } else {
      try {
        const maxBytes = this.settings.current.textMaxFileSizeKB * 1024;
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size <= maxBytes) {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (!bytes.subarray(0, 8192).includes(0)) {
            const text = decoder.decode(bytes);
            result = { text, starts: lineStarts(text) };
          }
        }
      } catch {
        result = null;
      }
    }
    this.texts.set(key, result);
    return result;
  }

  /** All whole-word occurrences of `name` across included files. */
  async find(name: string, token?: vscode.CancellationToken): Promise<vscode.Location[]> {
    const files = await this.listFiles();
    // Open documents (possibly unsaved) are included even if they're not in the file list yet.
    const openDocs = new Map<string, vscode.TextDocument>();
    for (const d of vscode.workspace.textDocuments) {
      if (!d.isClosed && (d.uri.scheme === 'file' || d.uri.scheme === 'vscode-remote' || d.uri.scheme === 'untitled')) {
        openDocs.set(d.uri.toString(), d);
      }
    }
    const all = new Map<string, vscode.Uri>(files.map((u) => [u.toString(), u]));
    for (const d of openDocs.values()) {
      if (!all.has(d.uri.toString()) && !this.settings.isExcluded(d.uri)) {
        all.set(d.uri.toString(), d.uri);
      }
    }

    let perFile = this.hits.get(name);
    if (!perFile) {
      perFile = new Map();
      this.hits.set(name, perFile);
    }
    const uris = [...all.values()];
    const results: vscode.Location[] = [];
    for (let i = 0; i < uris.length; i += BATCH) {
      if (token?.isCancellationRequested) {
        break;
      }
      const batch = uris.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (uri) => {
          const key = uri.toString();
          let ranges = perFile!.get(key);
          if (!ranges) {
            const t = await this.loadText(uri, openDocs);
            ranges = [];
            if (t) {
              for (const off of scanWord(t.text, name)) {
                const a = offsetToLineCol(t.starts, off);
                const b = offsetToLineCol(t.starts, off + name.length);
                ranges.push(new vscode.Range(a.line, a.character, b.line, b.character));
              }
            }
            perFile!.set(key, ranges);
          }
          for (const r of ranges) {
            results.push(new vscode.Location(uri, r));
          }
        }),
      );
    }
    return results;
  }
}
