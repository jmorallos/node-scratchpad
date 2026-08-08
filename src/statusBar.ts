import * as vscode from 'vscode';
import type { ScratchpadRunner, StatusUpdate } from './runner';
import { isRunnableDocument, isScratchpad } from './scratchpad';

export class ScratchpadStatusBar implements vscode.Disposable {
  private readonly runItem: vscode.StatusBarItem;
  private readonly autoItem: vscode.StatusBarItem;
  private readonly inlineItem: vscode.StatusBarItem;
  private readonly attachItem: vscode.StatusBarItem;
  private lastStatus: StatusUpdate | undefined;

  constructor(private readonly getRunner: () => ScratchpadRunner | undefined) {
    // Higher priority = further left when alignment is Left.
    this.runItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      104
    );
    this.autoItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      103
    );
    this.inlineItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      102
    );
    this.attachItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      101
    );

    this.runItem.command = 'nodeScratchpad.statusBarAction';
    this.autoItem.command = 'nodeScratchpad.toggleAutoRun';
    this.inlineItem.command = 'nodeScratchpad.toggleInlineValues';
    this.attachItem.command = 'nodeScratchpad.toggleAttach';

    this.runItem.show();
    this.autoItem.show();
    this.inlineItem.show();
    this.attachItem.show();

    this.refresh();
  }

  setStatus(update: StatusUpdate): void {
    this.lastStatus = update;
    this.refresh();
  }

  refresh(): void {
    const runner = this.getRunner();
    const editor = vscode.window.activeTextEditor;
    const runnable = !!(editor && isRunnableDocument(editor.document));
    const attached = !!(editor && isScratchpad(editor.document));
    const running =
      runner?.isRunning() ||
      this.lastStatus?.isRunning ||
      this.lastStatus?.status === 'running' ||
      false;
    const autoRun = this.lastStatus?.autoRun ?? runner?.isAutoRunEnabled() ?? true;
    const inline =
      this.lastStatus?.inlineValues ?? runner?.isInlineValuesEnabled() ?? true;
    const duration =
      this.lastStatus?.durationMs !== undefined
        ? ` ${this.lastStatus.durationMs}ms`
        : '';
    const statusLabel = this.lastStatus?.status ?? 'idle';

    this.runItem.text = running
      ? '$(debug-stop) Stop'
      : `$(play) ${statusLabel}${duration}`;
    this.runItem.tooltip = running
      ? 'Stop Node Scratchpad'
      : 'Run current JS/TS file / scratchpad';
    this.runItem.command = running
      ? 'nodeScratchpad.stop'
      : 'nodeScratchpad.statusBarAction';

    this.autoItem.text = autoRun ? '$(sync) Auto' : '$(sync-ignored) Manual';
    this.autoItem.tooltip = autoRun
      ? 'Auto-run on edit (click to switch to manual)'
      : 'Manual run only (click to enable auto-run)';
    this.autoItem.backgroundColor = undefined;

    this.inlineItem.text = inline ? '$(eye) Inline' : '$(eye-closed) Inline';
    this.inlineItem.tooltip = inline
      ? 'Inline values on (click to hide)'
      : 'Inline values off (click to show)';

    this.attachItem.text = attached
      ? '$(link) Attached'
      : '$(debug-disconnect) Detached';
    this.attachItem.tooltip = !runnable
      ? 'Open a JS/TS file to attach'
      : attached
        ? 'Attached — click to detach (stops auto-run for this file)'
        : 'Detached — click to attach as scratchpad';
    this.attachItem.color = runnable
      ? undefined
      : new vscode.ThemeColor('disabledForeground');
  }

  dispose(): void {
    this.runItem.dispose();
    this.autoItem.dispose();
    this.inlineItem.dispose();
    this.attachItem.dispose();
  }
}
