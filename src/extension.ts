import * as vscode from 'vscode';
import { disposeOutput } from './output';
import { ScratchpadRunner } from './runner';
import {
  clearScratchpadSession,
  detachScratchpad,
  disposeScratchpads,
  getRunnableEditor,
  isScratchpad,
  openScratchpad,
  openScratchpadPicker,
  revealScratchpadFolder,
  trackScratchpad,
} from './scratchpad';

let runner: ScratchpadRunner | undefined;
let statusBar: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  runner = new ScratchpadRunner(context);
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.command = 'nodeScratchpad.toggleAutoRun';
  statusBar.tooltip = 'Toggle Node Scratchpad auto-run';
  statusBar.show();

  const statusSub = runner.onStatusChange((update) => {
    if (!statusBar) {
      return;
    }
    const auto = update.autoRun ? 'auto' : 'manual';
    const inline = update.inlineValues ? 'inline' : 'no-inline';
    const duration =
      update.durationMs !== undefined ? ` ${update.durationMs}ms` : '';
    statusBar.text = `$(play) Scratchpad: ${update.status}${duration} [${auto}|${inline}]`;
  });

  // Re-attach to pads already open (e.g. after reload).
  for (const doc of vscode.workspace.textDocuments) {
    if (isScratchpad(doc)) {
      trackScratchpad(doc);
    }
  }

  context.subscriptions.push(
    runner,
    statusBar,
    statusSub,
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isScratchpad(doc)) {
        trackScratchpad(doc);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearScratchpadSession(doc);
    }),
    vscode.commands.registerCommand('nodeScratchpad.newJavaScript', async () => {
      const editor = await openScratchpad('javascript', context);
      await runner?.run(editor.document);
    }),
    vscode.commands.registerCommand('nodeScratchpad.newTypeScript', async () => {
      const editor = await openScratchpad('typescript', context);
      await runner?.run(editor.document);
    }),
    vscode.commands.registerCommand('nodeScratchpad.open', async () => {
      const editor = await openScratchpadPicker(context);
      if (editor) {
        await runner?.run(editor.document);
      }
    }),
    vscode.commands.registerCommand('nodeScratchpad.revealFolder', async () => {
      await revealScratchpadFolder(context);
    }),
    vscode.commands.registerCommand('nodeScratchpad.run', async () => {
      const editor = getRunnableEditor();
      if (!editor) {
        vscode.window.showInformationMessage(
          'Open a JavaScript or TypeScript file, or create a Node Scratchpad.'
        );
        return;
      }
      await runner?.run(editor.document);
    }),
    vscode.commands.registerCommand(
      'nodeScratchpad.runCurrentFile',
      async () => {
        const editor = getRunnableEditor();
        if (!editor) {
          vscode.window.showInformationMessage(
            'Open a JavaScript or TypeScript file to run with Node Scratchpad.'
          );
          return;
        }
        await runner?.run(editor.document);
      }
    ),
    vscode.commands.registerCommand(
      'nodeScratchpad.runSelection',
      async () => {
        const editor = getRunnableEditor();
        if (!editor) {
          vscode.window.showInformationMessage(
            'Open a JavaScript or TypeScript file to run a selection.'
          );
          return;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
          vscode.window.showInformationMessage(
            'Select some code first, then Run Selection.'
          );
          return;
        }
        const text = editor.document.getText(selection);
        await runner?.run(editor.document, {
          sourceOverride: text,
          lineOffset: selection.start.line,
        });
      }
    ),
    vscode.commands.registerCommand(
      'nodeScratchpad.detachCurrentFile',
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        const detached = detachScratchpad(editor.document);
        runner?.clearUi(editor.document);
        if (detached) {
          vscode.window.showInformationMessage(
            'Detached from Node Scratchpad (auto-run off for this file).'
          );
        } else {
          vscode.window.showInformationMessage(
            'This file is not attached to Node Scratchpad.'
          );
        }
      }
    ),
    vscode.commands.registerCommand('nodeScratchpad.stop', () => {
      runner?.stop();
    }),
    vscode.commands.registerCommand('nodeScratchpad.toggleAutoRun', async () => {
      if (!runner) {
        return;
      }
      const enabled = await runner.toggleAutoRun();
      vscode.window.showInformationMessage(
        `Node Scratchpad auto-run ${enabled ? 'enabled' : 'disabled'}.`
      );
    }),
    vscode.commands.registerCommand(
      'nodeScratchpad.toggleInlineValues',
      async () => {
        if (!runner) {
          return;
        }
        const enabled = await runner.toggleInlineValues();
        vscode.window.showInformationMessage(
          `Node Scratchpad inline values ${enabled ? 'enabled' : 'disabled'}.`
        );
      }
    )
  );
}

export function deactivate(): void {
  runner?.dispose();
  runner = undefined;
  statusBar?.dispose();
  statusBar = undefined;
  disposeScratchpads();
  disposeOutput();
}
