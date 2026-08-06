import { VALUE_MARKER } from './protocol';
import type { ModuleKind } from './moduleKind';

function buildSpSetup(utilBinding: string): string {
  return `{
  const util = ${utilBinding};
  const MARK = ${JSON.stringify(VALUE_MARKER)};
  const format = (args) => args.map((a) => {
    try {
      return util.inspect(a, { depth: 2, colors: false, breakLength: 100, compact: true });
    } catch {
      try { return String(a); } catch { return '[unprintable]'; }
    }
  }).join(' ');
  const emit = (kind, line, args) => {
    process.stdout.write(MARK + JSON.stringify({ kind, line, text: format(args) }) + '\\n');
  };
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
    dir: console.dir.bind(console),
  };
  globalThis.__sp = {
    log(line, ...args) {
      emit('log', line, args);
      orig.log(...args);
    },
    info(line, ...args) {
      emit('log', line, args);
      orig.info(...args);
    },
    warn(line, ...args) {
      emit('log', line, args);
      orig.warn(...args);
    },
    error(line, ...args) {
      emit('log', line, args);
      orig.error(...args);
    },
    debug(line, ...args) {
      emit('log', line, args);
      orig.debug(...args);
    },
    dir(line, ...args) {
      emit('log', line, args);
      orig.dir(...args);
    },
    expr(line, value) {
      emit('expr', line, [value]);
      return value;
    },
  };
}
`;
}

/** Injected before user code. Exposes globalThis.__sp for instrumented calls. */
export function buildRuntimePreamble(kind: ModuleKind = 'cjs'): string {
  if (kind === 'esm') {
    return `import __spUtil from 'node:util';\n${buildSpSetup('__spUtil')}`;
  }
  return buildSpSetup("require('node:util')");
}
