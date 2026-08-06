# Node Scratchpad

VS Code / Cursor extension for rapid JS/TS prototyping: open a scratchpad, type code, and see Node.js output instantly — plus Quokka-style inline values.

## Features

- **Persistent pads** under `.scratchpad/` (or extension storage if no folder is open)
- **Workspace imports** — run file lives beside the pad so `./sibling` works; Node walks up to workspace `node_modules`
- Auto-run on edit (400ms debounce) in Node.js
- CommonJS (`require`) and ESM (`import` / `export` / `import.meta`) — auto-detected
- TypeScript via esbuild (source-mapped back to your buffer)
- Inline decorations for logs (`›`) and expressions (`=`) — distinct from Error Lens
- **Inline errors** — syntax/runtime failures mapped onto the pad line
- Output channel still streams stdout/stderr
- **Settings** under “Node Scratchpad” (auto-run, delay, inline values/errors, output, module kind, node path)

## Settings

| Setting | Default | Description |
|---|---|---|
| `nodeScratchpad.autoRun` | `true` | Run after edits |
| `nodeScratchpad.autoRunDelay` | `400` | Debounce ms |
| `nodeScratchpad.inlineValues` | `true` | Cyan `›` / `=` decorations |
| `nodeScratchpad.inlineErrors` | `true` | Diagnostics on failing lines |
| `nodeScratchpad.showOutputOnRun` | `true` | Reveal Output on run |
| `nodeScratchpad.moduleKind` | `auto` | `auto` / `cjs` / `esm` |
| `nodeScratchpad.nodePath` | `node` | Node executable |

Toggle Auto-Run / Toggle Inline Values update the matching settings.

## Commands

- **Node Scratchpad: New JavaScript** — create `.scratchpad/pad-….js` and run it
- **Node Scratchpad: New TypeScript** — create `.scratchpad/pad-….ts` and run it
- **Node Scratchpad: Open Saved…** — pick an existing pad
- **Node Scratchpad: Reveal Folder** — show the scratchpad directory
- **Node Scratchpad: Run** — run the active pad or current JS/TS file
- **Node Scratchpad: Run Current File** — attach any open JS/TS file and run it (also in editor title / right-click)
- **Node Scratchpad: Stop** — kill the current Node process
- **Node Scratchpad: Toggle Auto-Run** — enable/disable run-on-edit
- **Node Scratchpad: Toggle Inline Values** — show/hide cyan runtime decorations

Pads are gitignored by default via `.scratchpad/.gitignore`.

## Install from VSIX

```bash
cd node-scratchpad
npm install
npm run vsix
```

Then in Cursor/VS Code: **Extensions: Install from VSIX…** and pick the generated `.vsix`.

## Develop

```bash
cd node-scratchpad
npm install
npm run compile
```

Launch **Run Extension** from the Debug view (F5).
