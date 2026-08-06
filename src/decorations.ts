import * as vscode from 'vscode';
import type { ScratchpadValue } from './protocol';
import type { LineMapper } from './sourcemap';

export class InlineDecorations implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly byDoc = new Map<string, ScratchpadValue[]>();
  private readonly visibilitySub: vscode.Disposable;
  private enabled = true;

  constructor() {
    // Distinct from Error Lens (diagnostic red/yellow) — cyan runtime values.
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 2.5em',
        color: new vscode.ThemeColor('terminal.ansiCyan'),
        fontStyle: 'normal',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    });
    this.visibilitySub = vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        const values = this.byDoc.get(editor.document.uri.toString());
        if (values) {
          this.render(editor.document, values);
        }
      }
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const editor of vscode.window.visibleTextEditors) {
        editor.setDecorations(this.decorationType, []);
      }
      return;
    }
    // Re-show last known values.
    for (const [uri, values] of this.byDoc) {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === uri
      );
      if (doc) {
        this.render(doc, values);
      }
    }
  }

  toggleEnabled(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  clear(doc: vscode.TextDocument): void {
    this.byDoc.delete(doc.uri.toString());
    this.render(doc, []);
  }

  clearAll(): void {
    for (const key of [...this.byDoc.keys()]) {
      this.byDoc.delete(key);
    }
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
    }
  }

  /**
   * Apply values. `values.line` is 1-based in executed/instrumented space;
   * mapped through `lineMapper` to the editor document.
   */
  apply(
    doc: vscode.TextDocument,
    values: ScratchpadValue[],
    lineMapper: LineMapper
  ): void {
    const merged = new Map<number, ScratchpadValue>();
    for (const value of values) {
      const original = lineMapper.toOriginalLine(value.line);
      if (original === undefined || original < 1) {
        continue;
      }
      // Last value wins per line (friendly for loops).
      merged.set(original, {
        line: original,
        text: value.text,
        kind: value.kind,
      });
    }

    const mapped = [...merged.values()];
    this.byDoc.set(doc.uri.toString(), mapped);
    this.render(doc, mapped);
  }

  private render(doc: vscode.TextDocument, values: ScratchpadValue[]): void {
    if (!this.enabled) {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === doc.uri.toString()) {
          editor.setDecorations(this.decorationType, []);
        }
      }
      return;
    }

    const decorations: vscode.DecorationOptions[] = values
      .filter((v) => v.line >= 1 && v.line <= doc.lineCount)
      .map((v) => {
        const lineIndex = v.line - 1;
        const lineText = doc.lineAt(lineIndex).text;
        const range = new vscode.Range(
          lineIndex,
          lineText.length,
          lineIndex,
          lineText.length
        );
        const display =
          v.text.length > 120 ? `${v.text.slice(0, 117)}...` : v.text;
        const marker = v.kind === 'expr' ? '=' : '›';
        return {
          range,
          renderOptions: {
            after: {
              contentText: `${marker} ${display}`,
            },
          },
          hoverMessage: new vscode.MarkdownString(
            `**Scratchpad ${v.kind === 'expr' ? 'value' : 'log'}**\n\n\`\`\`\n${v.text}\n\`\`\``
          ),
        };
      });

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === doc.uri.toString()) {
        editor.setDecorations(this.decorationType, decorations);
      }
    }
  }

  dispose(): void {
    this.visibilitySub.dispose();
    this.clearAll();
    this.decorationType.dispose();
  }
}
