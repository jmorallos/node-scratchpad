export const VALUE_MARKER = '__SCRATCHPAD_VALUE__';

export interface ScratchpadValue {
  /** 1-based line in the executed (instrumented source) coordinate space */
  line: number;
  text: string;
  kind: 'log' | 'expr';
}

export function parseValueMarkerLine(line: string): ScratchpadValue | undefined {
  if (!line.startsWith(VALUE_MARKER)) {
    return undefined;
  }
  try {
    const payload = JSON.parse(line.slice(VALUE_MARKER.length)) as {
      line?: unknown;
      text?: unknown;
      kind?: unknown;
    };
    if (typeof payload.line !== 'number' || typeof payload.text !== 'string') {
      return undefined;
    }
    const kind = payload.kind === 'expr' ? 'expr' : 'log';
    return { line: payload.line, text: payload.text, kind };
  } catch {
    return undefined;
  }
}

/** Split chunk into complete lines + remainder; identify value markers. */
export function consumeStdout(
  buffer: string,
  chunk: string
): {
  buffer: string;
  output: string;
  values: ScratchpadValue[];
} {
  const combined = buffer + chunk;
  const parts = combined.split('\n');
  const nextBuffer = parts.pop() ?? '';
  const values: ScratchpadValue[] = [];
  let output = '';

  for (const part of parts) {
    const value = parseValueMarkerLine(part);
    if (value) {
      values.push(value);
    } else {
      output += `${part}\n`;
    }
  }

  return { buffer: nextBuffer, output, values };
}
