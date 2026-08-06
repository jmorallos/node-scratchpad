import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Node Scratchpad');
  }
  return channel;
}

export function clearOutput(): void {
  getOutputChannel().clear();
}

export function appendOutput(text: string): void {
  getOutputChannel().append(text);
}

export function appendOutputLine(text: string): void {
  getOutputChannel().appendLine(text);
}

export function showOutput(preserveFocus = true): void {
  getOutputChannel().show(preserveFocus);
}

export function disposeOutput(): void {
  channel?.dispose();
  channel = undefined;
}
