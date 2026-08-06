import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';

export interface LineMapper {
  /** Map 1-based executed line → 1-based original line (or undefined). */
  toOriginalLine(generatedLine: number): number | undefined;
}

export function identityLineMapper(): LineMapper {
  return {
    toOriginalLine(generatedLine: number) {
      return generatedLine;
    },
  };
}

export function createSourceMapLineMapper(mapJson: string): LineMapper {
  const raw = JSON.parse(mapJson) as RawSourceMap;
  const consumer = new SourceMapConsumer(raw);
  return {
    toOriginalLine(generatedLine: number) {
      const pos = consumer.originalPositionFor({
        line: generatedLine,
        column: 0,
      });
      if (pos.line == null || pos.line < 1) {
        // Try a few columns — esbuild often maps at non-zero columns.
        for (const column of [1, 5, 10, 20]) {
          const retry = consumer.originalPositionFor({
            line: generatedLine,
            column,
          });
          if (retry.line != null && retry.line >= 1) {
            return retry.line;
          }
        }
        return undefined;
      }
      return pos.line;
    },
  };
}
