import * as acorn from 'acorn';
import type { ModuleKind } from './moduleKind';
import { buildRuntimePreamble } from './preamble';

const CONSOLE_METHODS = new Set([
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'dir',
]);

interface Edit {
  start: number;
  end: number;
  text: string;
}

function isConsoleCall(
  node: acorn.Node
): node is acorn.Node & {
  type: 'CallExpression';
  callee: {
    type: 'MemberExpression';
    object: { type: 'Identifier'; name: string };
    property: { type: 'Identifier'; name: string };
    computed: boolean;
  };
  arguments: acorn.Node[];
} {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const call = node as acorn.CallExpression;
  if (call.callee.type !== 'MemberExpression' || call.callee.computed) {
    return false;
  }
  const obj = call.callee.object;
  const prop = call.callee.property;
  if (obj.type !== 'Identifier' || obj.name !== 'console') {
    return false;
  }
  if (prop.type !== 'Identifier' || !CONSOLE_METHODS.has(prop.name)) {
    return false;
  }
  return true;
}

function walk(node: acorn.Node, visit: (n: acorn.Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && 'type' in child) {
          walk(child as acorn.Node, visit);
        }
      }
    } else if (value && typeof value === 'object' && 'type' in value) {
      walk(value as acorn.Node, visit);
    }
  }
}

/**
 * Instrument JS source: rewrite console.* and expression statements,
 * then prepend the runtime preamble. Line numbers baked into calls are
 * 1-based positions in the body (before preamble).
 */
export interface InstrumentResult {
  code: string;
  /** 1-based line where the instrumented body starts in `code` */
  bodyStartLine: number;
}

export function instrumentJavaScript(
  code: string,
  kind: ModuleKind = 'cjs'
): InstrumentResult {
  const sourceType = kind === 'esm' ? 'module' : 'script';
  let ast: acorn.Node | undefined;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType,
      locations: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: kind === 'cjs',
    });
  } catch {
    ast = undefined;
  }

  let instrumented = code;
  if (ast) {
    const edits: Edit[] = [];
    const consoleStatementStarts = new Set<number>();

    walk(ast, (node) => {
      if (node.type !== 'ExpressionStatement') {
        return;
      }
      const stmt = node as acorn.ExpressionStatement;
      if (isConsoleCall(stmt.expression)) {
        consoleStatementStarts.add(stmt.start);
      }
    });

    walk(ast, (node) => {
      if (isConsoleCall(node)) {
        const line = node.loc?.start.line;
        if (line === undefined) {
          return;
        }
        const call = node as acorn.CallExpression;
        const member = call.callee as acorn.MemberExpression;
        const method = (member.property as acorn.Identifier).name;
        const calleeStart = member.start;
        const calleeEnd = member.end;
        const openParen = code.indexOf('(', calleeEnd);
        if (openParen === -1) {
          return;
        }
        edits.push({
          start: calleeStart,
          end: calleeEnd,
          text: `__sp.${method}`,
        });
        const needsComma = call.arguments.length > 0;
        edits.push({
          start: openParen + 1,
          end: openParen + 1,
          text: needsComma ? `${line}, ` : `${line}`,
        });
        return;
      }

      if (node.type !== 'ExpressionStatement') {
        return;
      }
      const stmt = node as acorn.ExpressionStatement;
      if (consoleStatementStarts.has(stmt.start)) {
        return;
      }
      if (
        stmt.expression.type === 'Literal' &&
        typeof (stmt.expression as acorn.Literal).value === 'string'
      ) {
        return;
      }
      const line = stmt.loc?.start.line;
      if (line === undefined) {
        return;
      }
      const expr = stmt.expression;
      edits.push({
        start: expr.start,
        end: expr.start,
        text: `__sp.expr(${line}, (`,
      });
      edits.push({
        start: expr.end,
        end: expr.end,
        text: `))`,
      });
    });

    edits.sort((a, b) => b.start - a.start || b.end - a.end);
    for (const edit of edits) {
      instrumented =
        instrumented.slice(0, edit.start) +
        edit.text +
        instrumented.slice(edit.end);
    }
  }

  const preamble = buildRuntimePreamble(kind).replace(/\n+$/, '');
  const full = `${preamble}\n${instrumented}`;
  const bodyStartLine = preamble.split('\n').length + 1;
  return { code: full, bodyStartLine };
}
