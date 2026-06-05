# Warfighter Coder

A comprehensive in-browser IDE for developing offline-capable web applications in denied / intermittent / low-bandwidth environments. Optimized for mission systems and secure labs where installing full toolchains or accessing cloud IDEs is impractical.

## Guided Tour (Beginner Friendly)
Open `index.html` and click the `Tour` tab to follow a step‑by‑step walkthrough covering:
- Planning with chatbots via the AI Prompts tab
- Editing files in the Code Editor and using Live Preview
- Compiling a single‑file HTML deliverable
- Preparing minimal LLM context for refactors and reviews
- Basic UI testing, data handling without servers, and security checks

The tour includes quick‑jump buttons that take you directly to each tool inside the app.

## 🚀 Core Feature Overview (Current)

### 1. Code Editor
* Syntax highlighting (HTML, JS, CSS, JSON, Python) with folding & bracket matching
* Multi-tab editing with per-tab save status badges
* Dirty state detection (only writes changed files)
* Global search across all loaded project files
* Context menus (right‑click) on files & folders
* Drag & drop file relocation between folders (with collision warning)
* Create, rename, delete files AND folders (folder delete warns if non-empty)

### 2. Checkpoint Manager
* Create project snapshots ("Checkpoints") on demand
* Restore or delete any prior checkpoint
* Stored logically by project root session (keeps iteration velocity high)

### 3. HTML Compiler
* Builds a single self-contained HTML file from your project
* Inlines scripts, styles, and local assets
* Lets you choose the output filename (defaults to the loaded folder name)
* Emits compilation report (processed, skipped, warnings)
* Produces hash that can be used to validate html file was not changed later

### 4. LLM Formatter
* Parses `index.html` for referenced assets then lets you selectively include additional files
* Produces concatenated, copy‑ready context (size + token estimates)
* Regenerate / refine selection quickly (stateful within a session)

### 5. AI Prompts (JTBD Workflow Helper)
* Guided, stateless prompt panels for: Jobs To Be Done, Solution Exploration, Technical Plan, Implementation Prompt
* Encourages structured thinking when working with external LLM tools

### 6. Test Recorder (Runtime Interaction Harness)
* Integrate `testRecorder.js` into your app build; press `Ctrl/Cmd + Alt + R` inside the running app to launch
* Record clicks, selections, and data entry directly against the live DOM
* Supports manual pauses for file uploads and other human-only steps

### 7. ShareDrive-NoSQL
* Lightweight, file-backed pseudo NoSQL layer for simple key/collection style persistence (ideal for disconnected lab VMs)
* Tab UI for browsing and manipulating stored objects (JSON-centric)

### 8. Security Reviewer
* Static heuristics pass over loaded source files
* Highlights potential risk areas / patterns (eval usage, unsafe DOM insertion, etc.)
* Designed as a quick triage aid—not a substitute for formal review

### 9. SAST Scanner
* Runs static analysis rules against JavaScript files
* Flags risky patterns like `eval`, `new Function`, string-based timeouts, and unsafe DOM sinks

### 10. Live Preview
* On-demand build & sandboxed iframe render
* Manual refresh or optional auto mode
* Pop-out to separate window for full-screen validation
* Isolation via `sandbox` attributes while allowing same-origin script execution

### 11. DevConsole Replacement
* Captures console output & JavaScript errors (stack traces)
* Interactive REPL with history
* Network (fetch) logging for debugging in restricted environments

## 🎯 Usage Scenarios
* Aircraft / shipboard / deployed mission support VMs
* Isolated training networks / classrooms
* Rapid prototyping where packaging + single-file deployment is desired
* Reviewing / triaging code bundles received via removable media

## 🛠️ Getting Started
1. Open `index.html` in a Chromium-based browser (Chrome / Edge). Safari partially supported.
2. Click “Open App Folder” and grant read/write permission (required for saving & moving files).
3. Expand the file tree, open files, edit, and use tools via their tabs (tabs unlock after loading a project).

### Browser Requirements
* File System Access API (Chrome/Edge preferred)
* User must explicitly approve directory read/write
* For fully offline operation, host required CDN assets locally (see Offline Notes)

## 📁 Updated Project Structure
```
warfighter-coder/
├─ index.html                 # Main application shell & tab panel layout
├─ loadFolder.js              # Directory picker, tree building, CRUD, drag & drop
├─ editor.js                  # CodeMirror setup, save logic, per-tab meta
├─ checkpointManager.js       # Snapshot management
├─ compiler.js                # Single-file HTML compiler
├─ llmFormatter.js            # LLM context generator
├─ aiHelper.js                # JTBD / AI prompt workflow
├─ testRecorderTab.js         # Test Recorder tab wiring
├─ testRecorder.js            # In-app test recorder (embed in target app)
├─ sharedriveNoSqlTab.js      # ShareDrive-NoSQL UI
├─ sharedrive-nosql.js        # Persistence implementation
├─ sastTab.js                 # JavaScript SAST scanner
├─ securityReviewer.js        # Static security analysis
├─ livePreview.js             # Live build + iframe preview logic
├─ search.js                  # Global project search
├─ devconsoleTab.js           # DevConsole integration UI
└─ devconsole.js (if present) # Underlying console logic (optional split)
```

## 🔑 Key Shortcuts
| Action | Shortcut |
|--------|----------|
| Save all | Ctrl+S |
| Save current | Ctrl+Shift+S |
| Find in file | Ctrl+F |
| Toggle DevConsole | Ctrl+~ |
| Test Recorder launcher (inside compiled app) | Ctrl/Cmd + Alt + R |
| Navigate REPL history | ↑ / ↓ |

## 🔄 Checkpoints Workflow
1. Make changes across files.
2. Click “Checkpoint” to capture snapshot state.
3. Select a previous checkpoint and Restore to roll back (non-destructive to directory until you save again).
4. Delete old checkpoints to declutter.

## 🧪 Live Preview Flow
1. Open Live Preview tab.
2. Click Build & Run (or enable Auto if available).
3. Inspect app in iframe (sandboxed). Use Pop Out for a full window.
4. Continue editing; re-run to reflect changes (or auto-refresh if toggled).

## 🤖 LLM Prompting Best Practice
Use the LLM Formatter to target only the minimal relevant subset of files. Large monolithic dumps reduce clarity. Pair with AI Helper panels to iteratively refine requirements → architecture → implementation prompt.

## 🔧 Advanced File Operations
* Drag a file onto any folder to move it (prompts on name collision)
* Right-click folder: New File, New Folder, Delete Folder (warns with counts if not empty)
* Right-click file: Rename, Delete
* Empty folders are preserved & visible

## 🔐 Security Reviewer Notes
The reviewer surfaces heuristic issues only (e.g., use of `eval`, raw `innerHTML`, broad wildcard patterns). Treat results as a starting point, not an authoritative scan.

## 📦 Offline / Air-Gapped Operation
CDN dependencies (Bootstrap, CodeMirror modules, jQuery, FileSaver) should be mirrored locally:
1. Download the referenced CSS/JS assets and the esm.sh-delivered CodeMirror module graph.
2. Place everything under a `vendor/` directory.
3. Update `<link>`, `<script>`, and dynamic `import()` URLs in `index.html` / `editor.js` to point to the local copies (or inline via the compiler).
4. (Optional) Run the compiler to produce a single-file deliverable for transfer.

## 🧰 Technology Stack
* CodeMirror 6 (editor, dynamically imported)
* Bootstrap 5 (layout / components)
* Native File System Access API (persistent edits)
* Minimal custom modules (no build step required)

## 🚨 Security & Privacy Considerations
* No network calls after initial load (excluding any remote asset URLs you have not localized)
* Requires explicit user permission for filesystem access each session
* Sandbox isolation for preview frame reduces accidental privileged script execution scope
* Avoid loading untrusted code before reviewing with the Security Reviewer

## 📝 Roadmap Ideas (Optional Enhancements)
* Multi-select drag for batch file moves
* Folder rename
* Diff viewer between checkpoints
* Search result filtering (glob / extension)
* Pluggable analyzer rules for Security Reviewer

## 📖 License
Designed for military, governmental, educational, and constrained-network environments. Adapt as required for mission or instructional needs.

---

**Warfighter Coder** – Enabling resilient offline-first development for mission-critical workflows.
