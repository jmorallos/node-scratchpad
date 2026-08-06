import * as vscode from 'vscode';
import type { ModuleKind } from './moduleKind';

export type ModuleKindSetting = 'auto' | ModuleKind;

export interface ScratchpadConfig {
  autoRun: boolean;
  autoRunDelay: number;
  inlineValues: boolean;
  inlineErrors: boolean;
  showOutputOnRun: boolean;
  moduleKind: ModuleKindSetting;
  nodePath: string;
  runOnOpen: boolean;
  confirmStopAfterMs: number;
}

const SECTION = 'nodeScratchpad';

export function getScratchpadConfig(): ScratchpadConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const delay = cfg.get<number>('autoRunDelay', 400);
  const moduleKind = cfg.get<ModuleKindSetting>('moduleKind', 'auto');
  const nodePath = cfg.get<string>('nodePath', 'node').trim() || 'node';
  const confirmStopAfterMs = cfg.get<number>('confirmStopAfterMs', 3000);

  return {
    autoRun: cfg.get<boolean>('autoRun', true),
    autoRunDelay: Number.isFinite(delay) ? Math.max(0, Math.floor(delay)) : 400,
    inlineValues: cfg.get<boolean>('inlineValues', true),
    inlineErrors: cfg.get<boolean>('inlineErrors', true),
    showOutputOnRun: cfg.get<boolean>('showOutputOnRun', true),
    moduleKind:
      moduleKind === 'cjs' || moduleKind === 'esm' || moduleKind === 'auto'
        ? moduleKind
        : 'auto',
    nodePath,
    runOnOpen: cfg.get<boolean>('runOnOpen', true),
    confirmStopAfterMs: Number.isFinite(confirmStopAfterMs)
      ? Math.max(0, Math.floor(confirmStopAfterMs))
      : 3000,
  };
}

export async function updateScratchpadSetting<K extends keyof ScratchpadConfig>(
  key: K,
  value: ScratchpadConfig[K]
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  await cfg.update(key, value, vscode.ConfigurationTarget.Global);
}

export function affectsScratchpadConfig(
  e: vscode.ConfigurationChangeEvent
): boolean {
  return e.affectsConfiguration(SECTION);
}
