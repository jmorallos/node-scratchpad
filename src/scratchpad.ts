import * as path from 'node:path';
import * as vscode from 'vscode';

export const SCRATCHPAD_DIRNAME = '.scratchpad';
export const GLOBAL_PADS_DIRNAME = 'pads';

const PAD_FILE_RE = /\.(cjs|mjs|cts|mts|js|ts)$/i;

/** Untitled pads created before persistence still use this set. */
const trackedPads = new Set<string>();

function docKey(doc: vscode.TextDocument): string {
  return doc.uri.toString();
}

function starterContent(language: 'javascript' | 'typescript'): string {
  return language === 'typescript'
    ? '// Node Scratchpad (TypeScript) — values appear inline\nconst n: number = 1 + 1;\nconsole.log("sum", n);\nn * 10;\n'
    : '// Node Scratchpad (JavaScript) — values appear inline\nconst n = 1 + 1;\nconsole.log("sum", n);\nn * 10;\n';
}

export function isScratchpadUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'file') {
    return false;
  }
  const fsPath = uri.fsPath;
  const parent = path.basename(path.dirname(fsPath));
  const name = path.basename(fsPath);
  if (name.startsWith('.sp-run-')) {
    return false;
  }
  if (!PAD_FILE_RE.test(name)) {
    return false;
  }
  if (parent === SCRATCHPAD_DIRNAME) {
    return true;
  }
  // globalStorage/.../pads/file.js
  if (parent === GLOBAL_PADS_DIRNAME) {
    return true;
  }
  return false;
}

export function isScratchpad(doc: vscode.TextDocument): boolean {
  if (isScratchpadUri(doc.uri)) {
    return true;
  }
  return trackedPads.has(docKey(doc));
}

export function trackScratchpad(doc: vscode.TextDocument): void {
  trackedPads.add(docKey(doc));
}

export function untrackScratchpad(doc: vscode.TextDocument): void {
  trackedPads.delete(docKey(doc));
}

function timestampSlug(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

async function ensureDir(dir: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(dir);
}

async function ensureGitignore(dir: vscode.Uri): Promise<void> {
  const gitignore = vscode.Uri.joinPath(dir, '.gitignore');
  try {
    await vscode.workspace.fs.stat(gitignore);
  } catch {
    const body = Buffer.from(
      '# Node Scratchpad — local prototypes\n*\n!.gitignore\n',
      'utf8'
    );
    await vscode.workspace.fs.writeFile(gitignore, body);
  }
}

export function getScratchpadRoot(
  context: vscode.ExtensionContext
): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    return vscode.Uri.joinPath(folder.uri, SCRATCHPAD_DIRNAME);
  }
  return vscode.Uri.joinPath(context.globalStorageUri, GLOBAL_PADS_DIRNAME);
}

export async function openScratchpad(
  language: 'javascript' | 'typescript',
  context: vscode.ExtensionContext
): Promise<vscode.TextEditor> {
  const root = getScratchpadRoot(context);
  await ensureDir(root);
  if (path.basename(root.fsPath) === SCRATCHPAD_DIRNAME) {
    await ensureGitignore(root);
  }

  const ext = language === 'typescript' ? 'ts' : 'js';
  const fileName = `pad-${timestampSlug()}.${ext}`;
  const fileUri = vscode.Uri.joinPath(root, fileName);
  const content = Buffer.from(starterContent(language), 'utf8');
  await vscode.workspace.fs.writeFile(fileUri, content);

  const doc = await vscode.workspace.openTextDocument(fileUri);
  trackScratchpad(doc);
  return vscode.window.showTextDocument(doc);
}

export async function listScratchpadFiles(
  context: vscode.ExtensionContext
): Promise<vscode.Uri[]> {
  const roots: vscode.Uri[] = [];

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.push(vscode.Uri.joinPath(folder.uri, SCRATCHPAD_DIRNAME));
  }
  roots.push(vscode.Uri.joinPath(context.globalStorageUri, GLOBAL_PADS_DIRNAME));

  const files: vscode.Uri[] = [];
  for (const root of roots) {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(root);
    } catch {
      continue;
    }
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !PAD_FILE_RE.test(name)) {
        continue;
      }
      files.push(vscode.Uri.joinPath(root, name));
    }
  }

  files.sort((a, b) => b.fsPath.localeCompare(a.fsPath));
  return files;
}

export async function openScratchpadPicker(
  context: vscode.ExtensionContext
): Promise<vscode.TextEditor | undefined> {
  const files = await listScratchpadFiles(context);
  if (files.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No saved scratchpads yet. Create one?',
      'New JavaScript',
      'New TypeScript'
    );
    if (choice === 'New JavaScript') {
      return openScratchpad('javascript', context);
    }
    if (choice === 'New TypeScript') {
      return openScratchpad('typescript', context);
    }
    return undefined;
  }

  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  const picked = await vscode.window.showQuickPick(
    files.map((uri) => {
      let description = uri.fsPath;
      if (workspaceRoot && uri.fsPath.startsWith(workspaceRoot)) {
        description = path.relative(workspaceRoot, uri.fsPath);
      }
      return {
        label: path.basename(uri.fsPath),
        description,
        uri,
      };
    }),
    { placeHolder: 'Open a saved Node Scratchpad' }
  );

  if (!picked) {
    return undefined;
  }

  const doc = await vscode.workspace.openTextDocument(picked.uri);
  trackScratchpad(doc);
  return vscode.window.showTextDocument(doc);
}

export async function revealScratchpadFolder(
  context: vscode.ExtensionContext
): Promise<void> {
  const root = getScratchpadRoot(context);
  await ensureDir(root);
  if (path.basename(root.fsPath) === SCRATCHPAD_DIRNAME) {
    await ensureGitignore(root);
  }
  try {
    await vscode.commands.executeCommand('revealInExplorer', root);
  } catch {
    await vscode.commands.executeCommand('revealFileInOS', root);
  }
}

export function getActiveScratchpadEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isScratchpad(editor.document)) {
    return undefined;
  }
  return editor;
}

const RUNNABLE_LANGS = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);

export function isRunnableDocument(doc: vscode.TextDocument): boolean {
  if (!RUNNABLE_LANGS.has(doc.languageId)) {
    return false;
  }
  if (doc.uri.scheme === 'file') {
    const name = path.basename(doc.uri.fsPath);
    if (name.startsWith('.sp-run-')) {
      return false;
    }
  }
  return true;
}

/**
 * Use the active JS/TS editor as a scratchpad for this session
 * (enables Run + auto-run until the tab is closed).
 */
export function attachActiveFileAsScratchpad(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isRunnableDocument(editor.document)) {
    return undefined;
  }
  trackScratchpad(editor.document);
  return editor;
}

/** Prefer an existing pad; otherwise attach the current JS/TS file. */
export function getRunnableEditor(): vscode.TextEditor | undefined {
  return getActiveScratchpadEditor() ?? attachActiveFileAsScratchpad();
}

export function disposeScratchpads(): void {
  trackedPads.clear();
}
