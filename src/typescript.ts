import * as esbuild from 'esbuild';
import type { ModuleKind } from './moduleKind';
import { createSourceMapLineMapper, type LineMapper } from './sourcemap';

export interface TranspileResult {
  code: string;
  lineMapper: LineMapper;
}

export async function transpileTypeScript(
  code: string,
  kind: ModuleKind = 'cjs'
): Promise<TranspileResult> {
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
