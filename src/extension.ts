import * as vscode from 'vscode';
import { getScratchpadConfig } from './config';
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
  toggleAttachCurrentFile,
  trackScratchpad,
} from './scratchpad';
import { ScratchpadStatusBar } from './statusBar';
import { disposeEsbuild } from './typescript';

let runner: ScratchpadRunner | undefined;
let statusBar: ScratchpadStatusBar | undefined;
let suppressRunOnOpen = 0;
const ranOnOpen = new Set<string>();

async function withSuppressedRunOnOpen<T>(
  fn: () => Promise<T>
): Promise<T> {
  suppressRunOnOpen += 1;
  try {
    return await fn();
  } finally {
    suppressRunOnOpen -= 1;
  }
}

function maybeRunOnOpen(doc: vscode.TextDocument): void {
  if (suppressRunOnOpen > 0) {
    return;
  }
  if (!getScratchpadConfig().runOnOpen) {
    return;
  }
  if (!isScratchpad(doc)) {
    return;
  }
  const key = doc.uri.toString();
  if (ranOnOpen.has(key)) {
    return;
  }
  ranOnOpen.add(key);
  void runner?.run(doc);
}

export function activate(context: vscode.ExtensionContext): void {
  runner = new ScratchpadRunner(context);
  statusBar = new ScratchpadStatusBar(() => runner);

  const statusSub = runner.onStatusChange((update) => {
    statusBar?.setStatus(update);
  });

  // Re-attach to pads already open (e.g. after reload).
  for (const doc of vscode.workspace.textDocuments) {
    if (isScratchpad(doc)) {
      trackScratchpad(doc);
    }
  }

  const active = vscode.window.activeTextEditor;
  if (active && isScratchpad(active.document)) {
    maybeRunOnOpen(active.document);
  }
  statusBar.refresh();

  context.subscriptions.push(
    runner,
    statusBar,
    statusSub,
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      statusBar?.refresh();
      if (editor) {
        maybeRunOnOpen(editor.document);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isScratchpad(doc)) {
        trackScratchpad(doc);
        statusBar?.refresh();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearScratchpadSession(doc);
      ranOnOpen.delete(doc.uri.toString());
      statusBar?.refresh();
    }),
    vscode.commands.registerCommand('nodeScratchpad.newJavaScript', async () => {
      await withSuppressedRunOnOpen(async () => {
        const editor = await openScratchpad('javascript', context);
        ranOnOpen.add(editor.document.uri.toString());
        await runner?.run(editor.document);
      });
      statusBar?.refresh();
    }),
    vscode.commands.registerCommand('nodeScratchpad.newTypeScript', async () => {
      await withSuppressedRunOnOpen(async () => {
        const editor = await openScratchpad('typescript', context);
        ranOnOpen.add(editor.document.uri.toString());
        await runner?.run(editor.document);
      });
      statusBar?.refresh();
    }),
    vscode.commands.registerCommand('nodeScratchpad.open', async () => {
      await withSuppressedRunOnOpen(async () => {
        const editor = await openScratchpadPicker(context);
        if (editor) {
          ranOnOpen.add(editor.document.uri.toString());
          await runner?.run(editor.document);
        }
      });
      statusBar?.refresh();
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
      statusBar?.refresh();
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
        statusBar?.refresh();
      }
    ),
    vscode.commands.registerCommand(
      'nodeScratchpad.statusBarAction',
      async () => {
        if (runner?.isRunning()) {
          await runner.stopInteractive();
          statusBar?.refresh();
          return;
        }
        const editor = getRunnableEditor();
        if (!editor) {
          vscode.window.showInformationMessage(
            'Open a JavaScript or TypeScript file to run with Node Scratchpad.'
          );
          return;
        }
        await runner?.run(editor.document);
        statusBar?.refresh();
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
        statusBar?.refresh();
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
        statusBar?.refresh();
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
    vscode.commands.registerCommand('nodeScratchpad.toggleAttach', () => {
      const result = toggleAttachCurrentFile();
      const editor = vscode.window.activeTextEditor;
      if (result === 'detached' && editor) {
        runner?.clearUi(editor.document);
      }
      statusBar?.refresh();
      if (result === undefined) {
        vscode.window.showInformationMessage(
          'Open a JavaScript or TypeScript file to attach.'
        );
      }
    }),
    vscode.commands.registerCommand('nodeScratchpad.stop', async () => {
      await runner?.stopInteractive();
      statusBar?.refresh();
    }),
    vscode.commands.registerCommand('nodeScratchpad.toggleAutoRun', async () => {
      if (!runner) {
        return;
      }
      await runner.toggleAutoRun();
      statusBar?.refresh();
    }),
    vscode.commands.registerCommand(
      'nodeScratchpad.toggleInlineValues',
      async () => {
        if (!runner) {
          return;
        }
        await runner.toggleInlineValues();
        statusBar?.refresh();
      }
    )
  );
}

export async function deactivate(): Promise<void> {
  runner?.dispose();
  runner = undefined;
  statusBar?.dispose();
  statusBar = undefined;
  disposeScratchpads();
  disposeOutput();
  await disposeEsbuild();
}
