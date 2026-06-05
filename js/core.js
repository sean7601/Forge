/* ===== Forge v2 — Core: State, Utilities, File System ===== */

// --- Utility Functions ---
function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function validateEntryName(name, kind = 'file') {
    const value = String(name || '').trim();
    const label = kind === 'folder' ? 'Folder' : 'File';
    if (!value) return label + ' name is required.';
    if (value === '.' || value === '..') return label + ' name cannot be "." or "..".';
    if (value.length > 120) return label + ' name is too long (max 120 characters).';
    if (/[\\/:*?"<>|\x00-\x1F]/.test(value)) {
        return label + ' name contains invalid characters: \\ / : * ? " < > |';
    }
    return '';
}

function saveAs(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function bindManagedListener(el, type, key, handler, options) {
    if (!el || !type || !handler) return;
    const listenerKey = key || type;
    const store = el.__forgeManagedListeners || (el.__forgeManagedListeners = {});
    if (store[listenerKey]) {
        el.removeEventListener(type, store[listenerKey]);
    }
    store[listenerKey] = handler;
    el.addEventListener(type, handler, options);
}

// --- Shared File I/O ---
// Eliminates the duplicate read/write patterns across 8+ tool implementations
async function readFileContent(path) {
    const f = openFiles.find(fi => fi.path === path);
    if (f) return f.content;
    const handle = fileHandles[path];
    if (handle) return await (await handle.getFile()).text();
    return '';
}

async function writeFileToHandle(handle, content) {
    const w = await handle.createWritable();
    await w.write(content);
    await w.close();
}

async function writeNewFile(name, content) {
    if (!dirHandle) throw new Error('No directory loaded');
    const fh = await dirHandle.getFileHandle(name, { create: true });
    await writeFileToHandle(fh, content);
    await refreshFileTree();
    return fh;
}

// --- Application State ---
let dirHandle = null;
let fileHandles = {};
let openFiles = [];
let activeFile = null;
let unsavedFiles = new Set();
let cmEditors = {};
let aiChatHistory = [];

const langMap = {
    html: 'HTML', htm: 'HTML', css: 'CSS', js: 'JavaScript', mjs: 'JavaScript',
    py: 'Python', json: 'JSON', md: 'Markdown', txt: 'Plain Text'
};

const iconMap = {
    html: '<span class="codicon codicon-file-code"></span>',
    htm: '<span class="codicon codicon-file-code"></span>',
    css: '<span class="codicon codicon-file-code"></span>',
    js: '<span class="codicon codicon-file-code"></span>',
    mjs: '<span class="codicon codicon-file-code"></span>',
    py: '<span class="codicon codicon-file-code"></span>',
    json: '<span class="codicon codicon-file-code"></span>',
    md: '<span class="codicon codicon-file"></span>',
    txt: '<span class="codicon codicon-file"></span>',
    default: '<span class="codicon codicon-file"></span>',
    folder: '<span class="codicon codicon-folder"></span>'
};

// --- loadFolder Compatibility Layer ---
// Provides a v1-compatible interface for tool code that references loadFolder
const loadFolder = {
    fileHandle: null,
    fileStructure: [],
    async getFileContent(file) {
        const path = file.relativePath || file.name;
        return await readFileContent(path);
    },
    async refreshFileTree() { await refreshFileTree(); }
};

// --- File System Access API ---
async function loadDirectory() {
    try {
        dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        document.getElementById('status-project').textContent = dirHandle.name;
        // Enable project-dependent buttons
        $$('[data-needs-project]').forEach(el => {
            el.disabled = false;
            el.style.display = '';
        });
        loadFolder.fileHandle = dirHandle;
        await refreshFileTree();
        switchPanel('explorer');
        // Show checkpoint bar and init checkpoints
        const cpBar = document.getElementById('checkpoint-bar');
        if (cpBar) cpBar.classList.add('visible');
        await checkpointManager.init(dirHandle.name);
    } catch (e) { if (e.name !== 'AbortError') console.error(e); }
}

async function readDir(handle, path = '') {
    const entries = [];
    for await (const [name, entry] of handle.entries()) {
        const fullPath = path ? path + '/' + name : name;
        if (entry.kind === 'directory') {
            const children = await readDir(entry, fullPath);
            entries.push({ name, path: fullPath, kind: 'directory', handle: entry, children });
        } else {
            fileHandles[fullPath] = entry;
            entries.push({ name, path: fullPath, kind: 'file', handle: entry });
        }
    }
    entries.sort((a, b) => a.kind === 'directory' && b.kind !== 'directory' ? -1 : b.kind === 'directory' && a.kind !== 'directory' ? 1 : a.name.localeCompare(b.name));
    return entries;
}

async function refreshFileTree() {
    if (!dirHandle) return;
    fileHandles = {};
    const tree = await readDir(dirHandle);
    const container = document.getElementById('file-tree');
    container.innerHTML = '';
    renderTree(tree, container, 0);
    // Rebuild loadFolder.fileStructure for v1 tool compatibility
    loadFolder.fileStructure = [];
    for (const [path, handle] of Object.entries(fileHandles)) {
        loadFolder.fileStructure.push({
            kind: 'file', name: path.split('/').pop(), relativePath: path,
            path: path.split('/').slice(0, -1), entry: handle, fileHandle: handle
        });
    }
}

function renderTree(entries, container, depth) {
    entries.forEach(e => {
        const div = document.createElement('div');
        div.className = 'file-tree-item';
        div.dataset.path = e.path;
        div.dataset.kind = e.kind;
        const indent = '<span class="tree-indent"></span>'.repeat(depth);
        const ext = e.name.split('.').pop().toLowerCase();
        if (e.kind === 'directory') {
            const icon = iconMap.folder;
            div.innerHTML = indent + '<span class="folder-toggle open">&#9654;</span> <span class="icon">' + icon + '</span>' + escHtml(e.name);
            div.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const toggle = div.querySelector('.folder-toggle');
                const children = div.nextElementSibling;
                if (toggle && children) {
                    toggle.classList.toggle('open');
                    children.classList.toggle('collapsed');
                }
            });
        } else {
            const icon = iconMap[ext] || iconMap.default;
            div.innerHTML = indent + '<span class="icon">' + icon + '</span>' + escHtml(e.name);
            div.addEventListener('click', (ev) => { ev.stopPropagation(); openFile(e.path); });
        }
        div.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); showContextMenu(ev, e); });
        container.appendChild(div);
        if (e.kind === 'directory' && e.children) {
            const childDiv = document.createElement('div');
            childDiv.className = 'tree-children';
            renderTree(e.children, childDiv, depth + 1);
            container.appendChild(childDiv);
        }
    });
}

// --- Create / Delete / Rename ---
async function createNewFile() {
    if (!dirHandle) return;
    const name = prompt('New file name (e.g. app.js):');
    if (!name) return;
    const validationError = validateEntryName(name, 'file');
    if (validationError) { alert(validationError); return; }
    try {
        const safeName = name.trim();
        const fh = await writeNewFile(safeName, '');
        fileHandles[safeName] = fh;
        openFile(safeName);
    } catch (e) { console.error(e); }
}

async function createNewFolder() {
    if (!dirHandle) return;
    const name = prompt('New folder name:');
    if (!name) return;
    const validationError = validateEntryName(name, 'folder');
    if (validationError) { alert(validationError); return; }
    try {
        await dirHandle.getDirectoryHandle(name.trim(), { create: true });
        await refreshFileTree();
    } catch (e) { console.error(e); }
}

async function deleteEntry(entry) {
    if (!confirm('Delete "' + entry.name + '"?')) return;
    try {
        const parts = entry.path.split('/');
        let parent = dirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
            parent = await parent.getDirectoryHandle(parts[i]);
        }
        await parent.removeEntry(parts[parts.length - 1], { recursive: entry.kind === 'directory' });
        if (entry.kind === 'file') { closeTab(entry.path); delete fileHandles[entry.path]; }
        await refreshFileTree();
    } catch (e) { console.error(e); }
}

async function renameEntry(entry) {
    const newName = prompt('Rename to:', entry.name);
    if (!newName || newName === entry.name) return;
    const validationError = validateEntryName(newName, entry.kind === 'directory' ? 'folder' : 'file');
    if (validationError) { alert(validationError); return; }
    try {
        if (entry.kind === 'file') {
            const handle = fileHandles[entry.path] || entry.handle;
            const old = await handle.getFile();
            const text = await old.text();
            const parts = entry.path.split('/');
            let parent = dirHandle;
            for (let i = 0; i < parts.length - 1; i++) {
                parent = await parent.getDirectoryHandle(parts[i]);
            }
            const safeName = newName.trim();
            const newH = await parent.getFileHandle(safeName, { create: true });
            await writeFileToHandle(newH, text);
            await parent.removeEntry(entry.name);
            closeTab(entry.path);
            delete fileHandles[entry.path];
            const newPath = parts.slice(0, -1).concat(safeName).join('/');
            fileHandles[newPath] = newH;
            await refreshFileTree();
            openFile(newPath);
        }
    } catch (e) { console.error(e); }
}

// --- Context Menu ---
function showContextMenu(ev, entry) {
    const cm = document.getElementById('context-menu');
    cm.innerHTML = '';
    const items = [];
    if (entry.kind === 'file') {
        items.push({ label: 'Open', action: () => openFile(entry.path) });
    }
    items.push({ label: 'Rename', action: () => renameEntry(entry) });
    items.push({ label: 'Delete', action: () => deleteEntry(entry) });
    items.forEach(it => {
        const d = document.createElement('div');
        d.className = 'ctx-item';
        d.textContent = it.label;
        d.addEventListener('click', () => { cm.style.display = 'none'; it.action(); });
        cm.appendChild(d);
    });
    cm.style.left = ev.clientX + 'px';
    cm.style.top = ev.clientY + 'px';
    cm.style.display = 'block';
}
document.addEventListener('click', () => { document.getElementById('context-menu').style.display = 'none'; });

// --- Status Messages ---
function showStatusMsg(msg) {
    const el = document.getElementById('status-project');
    el.textContent = msg;
    setTimeout(() => { el.textContent = dirHandle ? dirHandle.name : 'No project loaded'; }, 2000);
}

// --- Checkpoint Manager ---
const checkpointManager = {
    _folderName: '.checkpoints',
    _cache: [],
    _statusTimer: null,
    _maxAutoCheckpoints: 20,
    _maxManualCheckpoints: 40,
    _excludedCheckpointPatterns: [
        /^\.checkpoints\//i,
        /^compiled-hashes\.csv$/i,
        /(^|\/)\.env(\.|$)/i,
        /\.(pem|key|p12|pfx)$/i
    ],

    async init(rootName) {
        if (!dirHandle) return;
        try { await this._getCheckpointDir(true); } catch (e) { console.error('Failed to init checkpoint directory', e); }
        this._cleanupLegacyStorage(rootName);
        await this._load();
        this.renderList();
    },

    async _getCheckpointDir(create = false) {
        if (!dirHandle) return null;
        return await dirHandle.getDirectoryHandle(this._folderName, { create });
    },

    _cleanupLegacyStorage(rootName) {
        const legacyKey = `wc:checkpoints:${rootName}`;
        if (localStorage.getItem(legacyKey)) {
            localStorage.removeItem(legacyKey);
            this._flashStatus('Legacy localStorage checkpoints cleared.');
        }
    },

    async _load() {
        this._cache = [];
        try {
            const dir = await this._getCheckpointDir();
            if (!dir) return;
            for await (const entry of dir.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    try {
                        const file = await entry.getFile();
                        const text = await file.text();
                        const data = JSON.parse(text);
                        if (data.id && data.created && data.files) this._cache.push(data);
                    } catch (e) { console.warn('Failed to read checkpoint file', entry.name, e); }
                }
            }
            this._cache.sort((a, b) => b.created - a.created);
            await this._enforceRetention();
        } catch (e) {
            if (e.name !== 'NotFoundError') console.warn('Failed to load checkpoints', e);
        }
    },

    _shouldIncludeInCheckpoint(path) {
        if (!path) return false;
        return !this._excludedCheckpointPatterns.some(pattern => pattern.test(path));
    },

    async _removeCheckpointFile(cp) {
        if (!cp) return;
        const dir = await this._getCheckpointDir();
        if (!dir) return;
        const filename = `checkpoint_${cp.created}_${cp.id}.json`;
        try { await dir.removeEntry(filename); } catch { }
    },

    async _enforceRetention() {
        const auto = this._cache.filter(c => c.auto).sort((a, b) => b.created - a.created);
        const manual = this._cache.filter(c => !c.auto).sort((a, b) => b.created - a.created);
        const toDrop = auto.slice(this._maxAutoCheckpoints).concat(manual.slice(this._maxManualCheckpoints));
        if (!toDrop.length) return;

        const dropIds = new Set(toDrop.map(c => c.id));
        for (const cp of toDrop) {
            await this._removeCheckpointFile(cp);
        }
        this._cache = this._cache.filter(c => !dropIds.has(c.id));
    },

    async _persist(checkpointData) {
        try {
            const dir = await this._getCheckpointDir(true);
            const filename = `checkpoint_${checkpointData.created}_${checkpointData.id}.json`;
            const fh = await dir.getFileHandle(filename, { create: true });
            await writeFileToHandle(fh, JSON.stringify(checkpointData, null, 2));
            return true;
        } catch (e) {
            console.error('Failed to save checkpoint file', e);
            alert('Unable to save checkpoint to disk: ' + e.message);
            return false;
        }
    },

    list() { return this._cache; },

    async create() {
        if (!dirHandle) { alert('Load a directory first.'); return; }
        const nameInput = prompt('Checkpoint name (optional):');
        const ts = new Date();
        const name = (nameInput && nameInput.trim()) || ts.toLocaleString();
        const id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

        this._flashStatus('Creating checkpoint...');
        const files = [];
        for (const path of Object.keys(fileHandles)) {
            if (!this._shouldIncludeInCheckpoint(path)) continue;
            try {
                const content = await readFileContent(path);
                files.push({ relativePath: path, content });
            } catch (e) { console.warn('Skip file for checkpoint:', path, e); }
        }

        const checkpointData = { id, name, created: ts.getTime(), files };
        const saved = await this._persist(checkpointData);
        if (saved) {
            this._cache.unshift(checkpointData);
            await this._enforceRetention();
            this.renderList(id);
            this._flashStatus(`Checkpoint "${name}" saved.`);
        }
    },

    async createAutoCheckpoint(description = 'Auto-save before paste') {
        if (!dirHandle) return false;
        let maxVersion = 0;
        const versionRegex = /^\[Auto v(\d+)\]/i;
        this._cache.forEach(cp => {
            const match = cp.name.match(versionRegex);
            if (match) { const v = parseInt(match[1], 10); if (v > maxVersion) maxVersion = v; }
        });
        const ts = new Date();
        const name = `[Auto v${maxVersion + 1}] ${description} - ${ts.toLocaleString()}`;
        const id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

        const files = [];
        for (const path of Object.keys(fileHandles)) {
            if (!this._shouldIncludeInCheckpoint(path)) continue;
            try {
                const content = await readFileContent(path);
                files.push({ relativePath: path, content });
            } catch (e) { console.warn('Skip file for auto-checkpoint:', path, e); }
        }

        const checkpointData = { id, name, created: ts.getTime(), files, auto: true };
        const saved = await this._persist(checkpointData);
        if (saved) {
            this._cache.unshift(checkpointData);
            await this._enforceRetention();
            this.renderList(id);
            this._flashStatus('Auto-checkpoint created.');
            return true;
        }
        return false;
    },

    async restore(id) {
        const cp = this._cache.find(c => c.id === id);
        if (!cp || !dirHandle) return;

        const cpPaths = new Set(cp.files.map(f => f.relativePath));
        const currentPaths = new Set(Object.keys(fileHandles));

        const toDelete = [...currentPaths].filter(p => !cpPaths.has(p));
        const toCreate = cp.files.filter(f => !currentPaths.has(f.relativePath));
        const toOverwrite = cp.files.filter(f => currentPaths.has(f.relativePath));

        const msg = `Restore checkpoint "${cp.name}"?\n\n` +
            `Will overwrite: ${toOverwrite.length} file(s)\n` +
            `Will create:    ${toCreate.length} new file(s)\n` +
            `Will delete:    ${toDelete.length} extra file(s)\n\n` +
            `Proceed? (Irreversible)`;
        if (!confirm(msg)) return;

        this._flashStatus('Restoring checkpoint...');

        // Helper: ensure directory path exists & write file
        const ensureFile = async (relPath, content) => {
            const parts = relPath.split('/');
            const name = parts.pop();
            let dir = dirHandle;
            for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
            const fh = await dir.getFileHandle(name, { create: true });
            await writeFileToHandle(fh, content);
        };

        // Delete extra files
        for (const path of toDelete) {
            try {
                const parts = path.split('/');
                let parent = dirHandle;
                for (let i = 0; i < parts.length - 1; i++) parent = await parent.getDirectoryHandle(parts[i]);
                await parent.removeEntry(parts[parts.length - 1]);
                closeTab(path);
            } catch (e) { console.error('Failed deleting file during restore', path, e); }
        }

        // Overwrite existing files
        for (const f of toOverwrite) {
            try {
                const handle = fileHandles[f.relativePath];
                if (handle) await writeFileToHandle(handle, f.content);
                // Update open editor if present
                const openFile = openFiles.find(of => of.path === f.relativePath);
                if (openFile) {
                    openFile.content = f.content;
                    openFile.original = f.content;
                    if (cmEditors[f.relativePath]) {
                        const view = cmEditors[f.relativePath];
                        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: f.content } });
                    }
                }
            } catch (e) { console.error('Failed overwriting file', f.relativePath, e); }
        }

        // Create missing files
        for (const nf of toCreate) {
            try { await ensureFile(nf.relativePath, nf.content); } catch (e) { console.error('Failed creating file during restore', nf.relativePath, e); }
        }

        // Refresh file tree and unsaved state
        unsavedFiles.clear();
        await refreshFileTree();
        renderTabs();
        this._flashStatus(`Checkpoint "${cp.name}" restored.`);
    },

    restoreSelected() {
        const sel = document.getElementById('checkpointSelect');
        if (sel && sel.value) this.restore(sel.value);
    },

    async delete(id) {
        const idx = this._cache.findIndex(c => c.id === id);
        if (idx === -1) return;
        const cp = this._cache[idx];
        if (!confirm(`Delete checkpoint "${cp.name}"?`)) return;
        try {
            const dir = await this._getCheckpointDir();
            if (dir) {
                const filename = `checkpoint_${cp.created}_${cp.id}.json`;
                await dir.removeEntry(filename);
            }
            this._cache.splice(idx, 1);
            this.renderList();
            this._flashStatus('Deleted checkpoint.');
        } catch (e) {
            console.error('Failed to delete checkpoint file', e);
            alert('Error deleting file: ' + e.message);
        }
    },

    deleteSelected() {
        const sel = document.getElementById('checkpointSelect');
        if (sel && sel.value) this.delete(sel.value);
    },

    renderList(selectId) {
        const sel = document.getElementById('checkpointSelect');
        if (!sel) return;
        sel.textContent = '';
        const def = document.createElement('option');
        def.text = 'Select Checkpoint...';
        def.disabled = true;
        def.selected = !selectId;
        sel.appendChild(def);

        const list = this.list();
        list.forEach(cp => {
            const opt = document.createElement('option');
            opt.value = cp.id;
            opt.textContent = `${cp.name} (${new Date(cp.created).toLocaleString()})`;
            if (selectId && cp.id === selectId) opt.selected = true;
            sel.appendChild(opt);
        });
        const restoreBtn = document.getElementById('checkpointRestoreBtn');
        const deleteBtn = document.getElementById('checkpointDeleteBtn');
        if (restoreBtn) restoreBtn.toggleAttribute('disabled', list.length === 0 || !sel.value);
        if (deleteBtn) deleteBtn.toggleAttribute('disabled', list.length === 0 || !sel.value);

        bindManagedListener(sel, 'change', 'checkpoint-select', () => {
            if (restoreBtn) restoreBtn.removeAttribute('disabled');
            if (deleteBtn) deleteBtn.removeAttribute('disabled');
        });
    },

    _flashStatus(msg, duration = 2500) {
        const el = document.getElementById('checkpoint-status');
        if (!el) return;
        el.textContent = msg;
        if (this._statusTimer) clearTimeout(this._statusTimer);
        this._statusTimer = setTimeout(() => { el.textContent = ''; }, duration);
    }
};

// Expose on window so CSP bindings can resolve onclick="checkpointManager.X()"
window.checkpointManager = checkpointManager;
