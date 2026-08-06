import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  affectsScratchpadConfig,
  getScratchpadConfig,
  updateScratchpadSetting,
  type ModuleKindSetting,
  type ScratchpadConfig,
} from './config';
import { InlineDecorations } from './decorations';
import { InlineErrors } from './errors';
import { instrumentJavaScript } from './instrument';
import {
  extensionForKind,
  resolveModuleKind,
} from './moduleKind';
import {
  appendOutput,
  appendOutputLine,
  clearOutput,
  showOutput,
} from './output';
import { consumeStdout, type ScratchpadValue } from './protocol';
import { isScratchpad } from './scratchpad';
import { identityLineMapper, offsetLineMapper, type LineMapper } from './sourcemap';
import { transpileTypeScript } from './typescript';

export type RunnerStatus = 'idle' | 'running' | 'error';

export interface StatusUpdate {
  status: RunnerStatus;
  durationMs?: number;
  autoRun: boolean;
  inlineValues: boolean;
}

type StatusListener = (update: StatusUpdate) => void;

export class ScratchpadRunner implements vscode.Disposable {
  private child: ChildProcessWithoutNullStreams | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private changeDisposable: vscode.Disposable | undefined;
  private runGeneration = 0;
  private statusListeners = new Set<StatusListener>();
  private lastStatus: RunnerStatus = 'idle';
  private readonly decorations = new InlineDecorations();
  private readonly errors = new InlineErrors();

  private autoRun = true;
  private autoRunDelay = 400;
  private showOutputOnRun = true;
  private moduleKindPref: ModuleKindSetting = 'auto';
  private nodePath = 'node';

  constructor(private readonly context: vscode.ExtensionContext) {
    this.applyConfig(getScratchpadConfig());

    this.changeDisposable = vscode.Disposable.from(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!isScratchpad(e.document)) {
          return;
        }
        if (!this.autoRun) {
          return;
        }
        this.scheduleRun(e.document);
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (isScratchpad(doc)) {
          this.decorations.clear(doc);
          this.errors.clear(doc);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!affectsScratchpadConfig(e)) {
          return;
        }
        this.applyConfig(getScratchpadConfig());
        this.emitStatus(this.lastStatus);
      })
    );
  }

  private applyConfig(config: ScratchpadConfig): void {
    this.autoRun = config.autoRun;
    this.autoRunDelay = config.autoRunDelay;
    this.showOutputOnRun = config.showOutputOnRun;
    this.moduleKindPref = config.moduleKind;
    this.nodePath = config.nodePath;
    this.decorations.setEnabled(config.inlineValues);
    this.errors.setEnabled(config.inlineErrors);

    if (!this.autoRun && this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  onStatusChange(listener: StatusListener): vscode.Disposable {
    this.statusListeners.add(listener);
    listener({
      status: this.lastStatus,
      autoRun: this.autoRun,
      inlineValues: this.decorations.isEnabled(),
    });
    return {
      dispose: () => this.statusListeners.delete(listener),
    };
  }

  isAutoRunEnabled(): boolean {
    return this.autoRun;
  }

  async toggleAutoRun(): Promise<boolean> {
    const next = !this.autoRun;
    await updateScratchpadSetting('autoRun', next);
    this.applyConfig(getScratchpadConfig());
    this.emitStatus(this.lastStatus);
    return this.autoRun;
  }

  isInlineValuesEnabled(): boolean {
    return this.decorations.isEnabled();
  }

  async toggleInlineValues(): Promise<boolean> {
    const next = !this.decorations.isEnabled();
    await updateScratchpadSetting('inlineValues', next);
    this.applyConfig(getScratchpadConfig());
    this.emitStatus(this.lastStatus);
    return this.decorations.isEnabled();
  }

  scheduleRun(doc: vscode.TextDocument): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.run(doc);
    }, this.autoRunDelay);
  }

  /** Clear decorations/errors and cancel a pending auto-run. */
  clearUi(doc: vscode.TextDocument): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.decorations.clear(doc);
    this.errors.clear(doc);
  }

  async run(
    doc: vscode.TextDocument,
    options?: { sourceOverride?: string; lineOffset?: number }
  ): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage(
        'Node Scratchpad only runs in trusted workspaces.'
      );
      return;
    }

    const generation = ++this.runGeneration;
    this.stopChild();
    this.decorations.clear(doc);
    this.errors.clear(doc);

    if (this.showOutputOnRun) {
      clearOutput();
      showOutput(true);
    } else {
      clearOutput();
    }
    appendOutputLine('— running —');
    this.emitStatus('running');

    const started = Date.now();
    const languageId = doc.languageId;
    const lineOffset = options?.lineOffset ?? 0;
    const source = options?.sourceOverride ?? doc.getText();
    if (!source.trim()) {
      appendOutputLine('Nothing to run (empty selection or file).');
      this.emitStatus('idle', Date.now() - started);
      return;
    }

    const moduleKind = resolveModuleKind(source, this.moduleKindPref);
    let executable = source;
    let lineMapper: LineMapper = identityLineMapper();
    let bodyStartLine = 1;

    try {
      if (languageId === 'typescript' || languageId === 'typescriptreact') {
        const transpiled = await transpileTypeScript(executable, moduleKind);
        executable = transpiled.code;
        lineMapper = transpiled.lineMapper;
      } else if (
        languageId !== 'javascript' &&
        languageId !== 'javascriptreact'
      ) {
        appendOutputLine(`Unsupported language: ${languageId}`);
        this.emitStatus('error', Date.now() - started);
        return;
      }

      const instrumented = instrumentJavaScript(executable, moduleKind);
      executable = instrumented.code;
      bodyStartLine = instrumented.bodyStartLine;
      if (lineOffset > 0) {
        lineMapper = offsetLineMapper(lineMapper, lineOffset);
        appendOutputLine(`— selection @ line ${lineOffset + 1} —`);
      }
      appendOutputLine(`— mode: ${moduleKind} —`);
    } catch (err) {
      if (generation !== this.runGeneration) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      appendOutputLine(`Prepare error:\n${message}`);
      this.errors.apply(
        doc,
        message,
        '',
        1,
        lineOffset > 0
          ? offsetLineMapper(identityLineMapper(), lineOffset)
          : identityLineMapper()
      );
      this.emitStatus('error', Date.now() - started);
      return;
    }

    if (generation !== this.runGeneration) {
      return;
    }

    const ext = extensionForKind(moduleKind);
    const { runPath, cwd } = this.resolveRunLocation(doc, ext, generation);

    try {
      await fs.writeFile(runPath, executable, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendOutputLine(`Failed to write run file:\n${message}`);
      this.emitStatus('error', Date.now() - started);
      return;
    }

    const collected: ScratchpadValue[] = [];
    let stderrText = '';

    await new Promise<void>((resolve) => {
      let settled = false;
      let stdoutBuffer = '';

      const finish = (status: RunnerStatus) => {
        if (settled) {
          return;
        }
        settled = true;
        if (generation === this.runGeneration) {
          this.child = undefined;
          const durationMs = Date.now() - started;
          appendOutputLine(`— exit ${lastExitCode ?? '?'} (${durationMs}ms) —`);
          this.decorations.apply(doc, collected, lineMapper);
          if (status === 'error' && stderrText.trim()) {
            this.errors.apply(
              doc,
              stderrText,
              runPath,
              bodyStartLine,
              lineMapper
            );
          }
          this.emitStatus(status, durationMs);
        }
        void fs.unlink(runPath).catch(() => undefined);
        resolve();
      };

      let lastExitCode: number | null = null;

      try {
        const child = spawn(this.nodePath, [runPath], {
          cwd,
          env: process.env,
        });
        this.child = child;

        child.stdout.on('data', (chunk: Buffer) => {
          if (generation !== this.runGeneration) {
            return;
          }
          const parsed = consumeStdout(stdoutBuffer, chunk.toString('utf8'));
          stdoutBuffer = parsed.buffer;
          collected.push(...parsed.values);
          if (parsed.output) {
            appendOutput(parsed.output);
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          if (generation === this.runGeneration) {
            const text = chunk.toString('utf8');
            stderrText += text;
            appendOutput(text);
          }
        });
        child.on('error', (err) => {
          if (generation === this.runGeneration) {
            appendOutputLine(
              `Failed to start "${this.nodePath}": ${err.message}`
            );
            stderrText += err.message;
          }
          finish('error');
        });
        child.on('close', (code) => {
          if (generation === this.runGeneration && stdoutBuffer) {
            const parsed = consumeStdout(stdoutBuffer, '\n');
            collected.push(...parsed.values);
            if (parsed.output) {
              appendOutput(parsed.output);
            }
          }
          lastExitCode = code;
          finish(code === 0 ? 'idle' : 'error');
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendOutputLine(`Spawn error:\n${message}`);
        stderrText += message;
        finish('error');
      }
    });
  }

  /**
   * Run beside the pad file so relative imports resolve to `.scratchpad/`,
   * while cwd stays the workspace root for tooling / process.cwd().
   * Node still walks up from the run file to find workspace `node_modules`.
   */
  private resolveRunLocation(
    doc: vscode.TextDocument,
    ext: '.cjs' | '.mjs',
    generation: number
  ): { runPath: string; cwd: string } {
    const workspaceCwd =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? undefined;

    if (doc.uri.scheme === 'file') {
      const padDir = path.dirname(doc.uri.fsPath);
      return {
        runPath: path.join(padDir, `.sp-run-${generation}${ext}`),
        cwd: workspaceCwd ?? padDir,
      };
    }

    const tempDir = os.tmpdir();
    const safeId = this.context.extension.id.replace(/[^\w.-]/g, '_');
    return {
      runPath: path.join(tempDir, `node-scratchpad-${safeId}-${generation}${ext}`),
      cwd: workspaceCwd ?? tempDir,
    };
  }

  stop(): void {
    this.runGeneration += 1;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    const killed = this.stopChild();
    if (killed) {
      appendOutputLine('— stopped —');
      this.emitStatus('idle');
    }
  }

  private stopChild(): boolean {
    if (!this.child || this.child.killed) {
      this.child = undefined;
      return false;
    }
    this.child.kill();
    this.child = undefined;
    return true;
  }

  private emitStatus(status: RunnerStatus, durationMs?: number): void {
    this.lastStatus = status;
    const update: StatusUpdate = {
      status,
      durationMs,
      autoRun: this.autoRun,
      inlineValues: this.decorations.isEnabled(),
    };
    for (const listener of this.statusListeners) {
      listener(update);
    }
  }

  dispose(): void {
    this.stop();
    this.changeDisposable?.dispose();
    this.statusListeners.clear();
    this.decorations.dispose();
    this.errors.dispose();
  }
}
