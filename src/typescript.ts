import * as esbuild from 'esbuild-wasm';
import type { ModuleKind } from './moduleKind';
import { createSourceMapLineMapper, type LineMapper } from './sourcemap';

export interface TranspileResult {
  code: string;
  lineMapper: LineMapper;
}

let initPromise: Promise<void> | undefined;

function ensureEsbuild(): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild.initialize({}).then(() => undefined);
  }
  return initPromise;
}

export async function transpileTypeScript(
  code: string,
  kind: ModuleKind = 'cjs'
): Promise<TranspileResult> {
  await ensureEsbuild();

  const result = await esbuild.transform(code, {
    loader: 'ts',
    format: kind === 'esm' ? 'esm' : 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    sourcefile: 'scratchpad.ts',
  });

  if (!result.map) {
    throw new Error('esbuild did not return a source map');
  }

  return {
    code: result.code,
    lineMapper: createSourceMapLineMapper(result.map),
  };
}

export async function disposeEsbuild(): Promise<void> {
  if (initPromise) {
    await initPromise.catch(() => undefined);
    await esbuild.stop();
    initPromise = undefined;
  }
}
