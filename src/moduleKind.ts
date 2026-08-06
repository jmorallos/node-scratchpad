export type ModuleKind = 'cjs' | 'esm';

/**
 * Detect whether scratchpad source should run as ESM or CommonJS.
 * Static import/export and import.meta → ESM. Dynamic import() alone stays CJS.
 */
export function detectModuleKind(code: string): ModuleKind {
  const stripped = stripComments(code);

  if (/\bimport\.meta\b/.test(stripped)) {
    return 'esm';
  }

  // Side-effect import: import 'pkg'
  if (/(?:^|[\n\r;])\s*import\s*['"`]/m.test(stripped)) {
    return 'esm';
  }

  // Static import … (not dynamic import())
  if (/(?:^|[\n\r;])\s*import\s+(?!\()/m.test(stripped)) {
    return 'esm';
  }

  // export …
  if (
    /(?:^|[\n\r;])\s*export\s+(?:\{|\*|default|async|function|class|const|let|var|type|interface|enum)/m.test(
      stripped
    )
  ) {
    return 'esm';
  }

  return 'cjs';
}

export function extensionForKind(kind: ModuleKind): '.cjs' | '.mjs' {
  return kind === 'esm' ? '.mjs' : '.cjs';
}

/** Resolve effective module kind from setting + source heuristics. */
export function resolveModuleKind(
  code: string,
  preference: 'auto' | ModuleKind = 'auto'
): ModuleKind {
  if (preference === 'cjs' || preference === 'esm') {
    return preference;
  }
  return detectModuleKind(code);
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
