import * as vscode from 'vscode';
import { getScratchpadConfig } from './config';
import { disposeOutput } from './output';
import { ScratchpadRunner, type StatusUpdate } from './runner';
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
import { disposeEsbuild } from './typescript';

let runner: ScratchpadRunner | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let lastStatus: StatusUpdate | undefined;
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

function refreshStatusBar(): void {
  if (!statusBar || !lastStatus) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const attached = !!(editor && isScratchpad(editor.document));
  const running = lastStatus.isRunning || lastStatus.status === 'running';
  const auto = lastStatus.autoRun ? 'auto' : 'manual';
  const inline = lastStatus.inlineValues ? 'inline' : 'no-inline';
  const attach = attached ? 'attached' : 'detached';
  const duration =
    lastStatus.durationMs !== undefined ? ` ${lastStatus.durationMs}ms` : '';

  statusBar.text = `$(${running ? 'debug-stop' : 'play'}) Scratchpad: ${lastStatus.status}${duration} [${auto}|${inline}|${attach}]`;
  statusBar.command = running
    ? 'nodeScratchpad.stop'
    : 'nodeScratchpad.statusBarAction';
  statusBar.tooltip = running
    ? 'Stop Node Scratchpad'
    : attached
      ? 'Run current scratchpad (click)'
      : 'Run current JS/TS file (click)';
}

export function activate(context: vscode.ExtensionContext): void {
  runner = new ScratchpadRunner(context);
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.show();

  const statusSub = runner.onStatusChange((update) => {
    lastStatus = update;
    refreshStatusBar();
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

  context.subscriptions.push(
    runner,
    statusBar,
    statusSub,
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      refreshStatusBar();
      if (editor) {
        maybeRunOnOpen(editor.document);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isScratchpad(doc)) {
        trackScratchpad(doc);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearScratchpadSession(doc);
      ranOnOpen.delete(doc.uri.toString());
      refreshStatusBar();
    }),
    vscode.commands.registerCommand('nodeScratchpad.newJavaScript', async () => {
      await withSuppressedRunOnOpen(async () => {
        const editor = await openScratchpad('javascript', context);
        ranOnOpen.add(editor.document.uri.toString());
        await runner?.run(editor.document);
      });
      refreshStatusBar();
    }),
    vscode.commands.registerCommand('nodeScratchpad.newTypeScript', async () => {
      await withSuppressedRunOnOpen(async () => {
        const editor = await openScratchpad('typescript', context);
        ranOnOpen.add(editor.document.uri.toString());
        await runner?.run(editor.document);
      });
      refreshStatusBar();
    }),
    vscode.commands.registerCommand('nodeScratchpad.open', async () => {
      await withSuppressedRunOnOpen(async () => {
        const editor = await openScratchpadPicker(context);
        if (editor) {
          ranOnOpen.add(editor.document.uri.toString());
          await runner?.run(editor.document);
        }
      });
      refreshStatusBar();
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
      refreshStatusBar();
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
        refreshStatusBar();
      }
    ),
    vscode.commands.registerCommand(
      'nodeScratchpad.statusBarAction',
      async () => {
        if (runner?.isRunning()) {
          await runner.stopInteractive();
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
        refreshStatusBar();
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
        refreshStatusBar();
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
        refreshStatusBar();
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
    vscode.commands.registerCommand('nodeScratchpad.stop', async () => {
      await runner?.stopInteractive();
      refreshStatusBar();
    }),
    vscode.commands.registerCommand('nodeScratchpad.toggleAutoRun', async () => {
      if (!runner) {
        return;
      }
      const enabled = await runner.toggleAutoRun();
      vscode.window.showInformationMessage(
        `Node Scratchpad auto-run ${enabled ? 'enabled' : 'disabled'}.`
      );
      refreshStatusBar();
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
        refreshStatusBar();
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
