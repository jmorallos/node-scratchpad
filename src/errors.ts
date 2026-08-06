import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LineMapper } from './sourcemap';

export interface ParsedError {
  /** 1-based line in the executed file */
  executedLine: number;
  executedColumn?: number;
  message: string;
}

/**
 * Pull the most relevant frame from Node stderr that references `executedFile`.
 */
export function parseNodeErrors(
  stderr: string,
  executedFile: string
): ParsedError[] {
  const normalizedTarget = path.normalize(executedFile);
  const base = path.basename(executedFile);
  const errors: ParsedError[] = [];
  const seen = new Set<string>();

  const consider = (
    file: string,
    line: number,
    column: number | undefined,
    message: string
  ) => {
    const normalized = path.normalize(file.replace(/^file:\/\//, ''));
    if (
      normalized !== normalizedTarget &&
      path.basename(normalized) !== base &&
      !normalized.endsWith(base)
    ) {
      return;
    }
    if (!Number.isFinite(line) || line < 1) {
      return;
    }
    const key = `${line}:${column ?? 0}:${message}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    errors.push({
      executedLine: line,
      executedColumn: column,
      message,
    });
  };

  // /path/file.mjs:12
  // /path/file.mjs:12:5
  const locationRe = /(?:^|\s|\()((?:[A-Za-z]:)?(?:\/|\\)[^:\s)+]+):(\d+)(?::(\d+))?/g;
  let match: RegExpExecArray | null;
  while ((match = locationRe.exec(stderr)) !== null) {
    const file = match[1];
    const line = Number(match[2]);
    const column = match[3] !== undefined ? Number(match[3]) : undefined;
    consider(file, line, column, firstErrorMessage(stderr));
  }

  return errors;
}

function firstErrorMessage(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/Error(?:\s*:|$)/.test(line) || /error TS/.test(line)) {
      return line.length > 200 ? `${line.slice(0, 197)}...` : line;
    }
  }
  return lines[0]?.slice(0, 200) || 'Runtime error';
}

export class InlineErrors implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private enabled = true;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection(
      'nodeScratchpad'
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearAll();
    }
  }

  clear(doc: vscode.TextDocument): void {
    this.collection.delete(doc.uri);
  }

  clearAll(): void {
    this.collection.clear();
  }

  apply(
    doc: vscode.TextDocument,
    stderr: string,
    executedFile: string,
    bodyStartLine: number,
    lineMapper: LineMapper
  ): void {
    if (!this.enabled) {
      this.clear(doc);
      return;
    }

    const parsed = parseNodeErrors(stderr, executedFile);
    if (parsed.length === 0 && stderr.trim()) {
      // Fallback: show a file-level diagnostic when we can't map a line.
      const range = new vscode.Range(0, 0, 0, 0);
      this.collection.set(doc.uri, [
        new vscode.Diagnostic(
          range,
          truncate(stderr.trim()),
          vscode.DiagnosticSeverity.Error
        ),
      ]);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    for (const err of parsed) {
      const bodyLine = err.executedLine - bodyStartLine + 1;
      if (bodyLine < 1) {
        continue;
      }
      const original = lineMapper.toOriginalLine(bodyLine);
      if (original === undefined || original < 1 || original > doc.lineCount) {
        continue;
      }
      const lineIndex = original - 1;
      const line = doc.lineAt(lineIndex);
      const col = Math.max(0, (err.executedColumn ?? 1) - 1);
      const start = Math.min(col, line.text.length);
      const range = new vscode.Range(
        lineIndex,
        start,
        lineIndex,
        line.text.length
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        err.message,
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.source = 'Node Scratchpad';
      diagnostics.push(diagnostic);
    }

    this.collection.set(doc.uri, diagnostics);
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function truncate(text: string, max = 300): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 3)}...` : oneLine;
}
