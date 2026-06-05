// File: checkpointManager.js
// Checkpoint system storing snapshots in a hidden .checkpoints folder.

const checkpointManager = {
    _folderName: '.checkpoints',
    _manifestFolderName: 'manifests',
    _objectFolderName: 'objects',
    _manifestVersion: 2,
    _cache: [],
    _statusTimer: null,
    _defaultStatusText: null,
    _uiBound: false,
    _pendingPasteCheckpointTitle: '',
    _openingModal: false,
    _excludedPathPatterns: [
        /(^|\/)\.checkpoints(\/|$)/i,
        /(^|\/)\.git(\/|$)/i,
        /(^|\/)node_modules(\/|$)/i,
        /(^|\/)shipped app files(\/|$)/i,
        /(^|\/)shipped apps(\/|$)/i,
        /\.crswap$/i,
        /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|7z|rar|exe|dll|wasm|pptx?|xlsx?|docx?)$/i
    ],

    async init(rootName) {
        if (!loadFolder.fileHandle) return;

        try {
            await this._getCheckpointDir(true);
            await this._getManifestDir(true);
            await this._getObjectRootDir(true);
        } catch (e) {
            console.error('Failed to init checkpoint directory', e);
        }

        this._cleanupLegacyStorage(rootName);
        await this._load();
        this._bindUiHandlers();
        this.renderModalTable();
    },

    async _getCheckpointDir(create = false) {
        if (!loadFolder.fileHandle) return null;
        return await loadFolder.fileHandle.getDirectoryHandle(this._folderName, { create });
    },

    async _getChildDir(parent, name, create = false) {
        if (!parent) return null;
        return await parent.getDirectoryHandle(name, { create });
    },

    async _getManifestDir(create = false) {
        const dir = await this._getCheckpointDir(create);
        if (!dir) return null;
        return await this._getChildDir(dir, this._manifestFolderName, create);
    },

    async _getObjectRootDir(create = false) {
        const dir = await this._getCheckpointDir(create);
        if (!dir) return null;
        return await this._getChildDir(dir, this._objectFolderName, create);
    },

    async _getObjectDir(hash, create = false) {
        const objectRoot = await this._getObjectRootDir(create);
        if (!objectRoot) return null;
        return await this._getChildDir(objectRoot, String(hash || '').slice(0, 2), create);
    },

    _legacyFilename(cp) {
        return `checkpoint_${cp.created}_${cp.id}.json`;
    },

    _manifestFilename(cp) {
        return `checkpoint_${cp.created}_${cp.id}.json`;
    },

    _objectFileName(hash) {
        return `${hash}.blob`;
    },

    async _writeTextFile(fileHandle, text) {
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
    },

    async _hashContent(content) {
        const text = String(content || '');
        if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
            const bytes = new TextEncoder().encode(text);
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i += 1) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return `fallback-${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
    },

    _contentSize(content) {
        const text = String(content || '');
        if (typeof Blob !== 'undefined') return new Blob([text]).size;
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
        return text.length;
    },

    _shouldIncludeFile(file) {
        if (!file || file.kind !== 'file') return false;
        const path = String(file.relativePath || '').replace(/\\/g, '/');
        if (!path) return false;
        return !this._excludedPathPatterns.some(pattern => pattern.test(path));
    },

    async _normalizeLoadedCheckpoint(data, storage, filename) {
        if (!data || !data.id || !data.created || !Array.isArray(data.files)) return null;
        const files = [];
        for (const file of data.files) {
            if (!file || !file.relativePath) continue;
            const normalized = { ...file, relativePath: String(file.relativePath).replace(/\\/g, '/') };
            if (typeof normalized.content === 'string') {
                normalized.size = Number.isFinite(normalized.size) ? normalized.size : this._contentSize(normalized.content);
                normalized.hash = normalized.hash || await this._hashContent(normalized.content);
            }
            files.push(normalized);
        }
        return {
            ...data,
            storage,
            storageVersion: storage === 'objects' ? this._manifestVersion : 1,
            manifestFileName: storage === 'objects' ? filename : '',
            legacyFileName: storage === 'legacy' ? filename : '',
            description: String(data.description || data.name || '').trim(),
            files,
            changedFiles: Array.isArray(data.changedFiles) ? data.changedFiles : null
        };
    },

    async _readCheckpointFile(entry, storage) {
        const file = await entry.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        return await this._normalizeLoadedCheckpoint(data, storage, entry.name);
    },

    _cleanupLegacyStorage(rootName) {
        const legacyKey = `wc:checkpoints:${rootName}`;
        if (localStorage.getItem(legacyKey)) {
            localStorage.removeItem(legacyKey);
            this._flashStatus('Legacy localStorage checkpoints cleared.');
        }
    },

    _bindUiHandlers() {
        if (this._uiBound) return;
        this._uiBound = true;

        document.addEventListener('click', (event) => {
            const saveBtn = event.target.closest('#checkpoint-save-btn');
            if (saveBtn) {
                event.preventDefault();
                this.createFromModal();
                return;
            }

            const restoreBtn = event.target.closest('[data-action="checkpoint-restore"]');
            if (restoreBtn) {
                event.preventDefault();
                const id = String(restoreBtn.getAttribute('data-id') || '');
                if (id) this.restore(id);
                return;
            }

            const deleteBtn = event.target.closest('[data-action="checkpoint-delete"]');
            if (deleteBtn) {
                event.preventDefault();
                const id = String(deleteBtn.getAttribute('data-id') || '');
                if (id) this.delete(id);
            }
        });

        const modalEl = document.getElementById('checkpoint-manager-modal');
        if (modalEl) {
            modalEl.addEventListener('shown.bs.modal', () => {
                const input = document.getElementById('checkpoint-description-input');
                if (input) input.focus();
            });
        }
    },

    async _load() {
        this._cache = [];
        try {
            const dir = await this._getCheckpointDir();
            if (!dir) return;

            for await (const entry of dir.values()) {
                if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
                try {
                    const data = await this._readCheckpointFile(entry, 'legacy');
                    if (data) this._cache.push(data);
                } catch (readErr) {
                    console.warn('Failed to read checkpoint file', entry.name, readErr);
                }
            }

            try {
                const manifestDir = await this._getManifestDir();
                if (manifestDir) {
                    for await (const entry of manifestDir.values()) {
                        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
                        try {
                            const data = await this._readCheckpointFile(entry, 'objects');
                            if (data) this._cache.push(data);
                        } catch (readErr) {
                            console.warn('Failed to read checkpoint manifest', entry.name, readErr);
                        }
                    }
                }
            } catch (manifestErr) {
                if (manifestErr.name !== 'NotFoundError') {
                    console.warn('Failed to load checkpoint manifests', manifestErr);
                }
            }

            this._cache.sort((a, b) => b.created - a.created);
        } catch (e) {
            if (e.name !== 'NotFoundError') {
                console.warn('Failed to load checkpoints from file system', e);
            }
        }
    },

    async _persist(checkpointData) {
        try {
            const manifestDir = await this._getManifestDir(true);
            await this._getObjectRootDir(true);

            for (const file of checkpointData.files) {
                if (!file || !file.hash || typeof file.content !== 'string') continue;
                const objectDir = await this._getObjectDir(file.hash, true);
                const objectName = this._objectFileName(file.hash);
                let shouldWrite = true;
                try {
                    await objectDir.getFileHandle(objectName);
                    shouldWrite = false;
                } catch (e) {
                    if (e.name !== 'NotFoundError') throw e;
                }
                if (shouldWrite) {
                    const objectHandle = await objectDir.getFileHandle(objectName, { create: true });
                    await this._writeTextFile(objectHandle, file.content);
                }
            }

            const manifest = {
                storageVersion: this._manifestVersion,
                storage: 'objects',
                id: checkpointData.id,
                name: checkpointData.name,
                description: checkpointData.description,
                created: checkpointData.created,
                files: checkpointData.files.map(file => ({
                    relativePath: file.relativePath,
                    hash: file.hash,
                    size: file.size
                })),
                changedFiles: checkpointData.changedFiles
            };
            const fileHandle = await manifestDir.getFileHandle(this._manifestFilename(checkpointData), { create: true });
            await this._writeTextFile(fileHandle, JSON.stringify(manifest, null, 2));
            return true;
        } catch (e) {
            console.error('Failed to save checkpoint file', e);
            alert('Unable to save checkpoint to disk: ' + e.message);
            return false;
        }
    },

    list() {
        return this._cache;
    },

    _computeChangedFiles(currentFiles, previousFiles) {
        const current = Array.isArray(currentFiles) ? currentFiles : [];
        const previous = Array.isArray(previousFiles) ? previousFiles : [];

        const fileToken = file => file && (file.hash || file.content || '');
        const previousByPath = new Map(previous.map(f => [f.relativePath, fileToken(f)]));
        const currentByPath = new Map(current.map(f => [f.relativePath, fileToken(f)]));
        const changed = new Set();

        for (const file of current) {
            if (!file || !file.relativePath) continue;
            if (!previousByPath.has(file.relativePath) || previousByPath.get(file.relativePath) !== fileToken(file)) {
                changed.add(file.relativePath);
            }
        }

        for (const file of previous) {
            if (!file || !file.relativePath) continue;
            if (!currentByPath.has(file.relativePath)) {
                changed.add(file.relativePath);
            }
        }

        return [...changed].sort((a, b) => a.localeCompare(b));
    },

    _getChangedFilesForDisplay(cp, index, list) {
        if (Array.isArray(cp.changedFiles)) return cp.changedFiles;
        const older = list[index + 1];
        const olderFiles = older && Array.isArray(older.files) ? older.files : [];
        return this._computeChangedFiles(cp.files || [], olderFiles);
    },

    _formatChangedSummary(paths) {
        const list = Array.isArray(paths) ? paths : [];
        if (!list.length) return '0';
        const preview = list.slice(0, 3).join(', ');
        if (list.length <= 3) return `${list.length} (${preview})`;
        return `${list.length} (${preview}, +${list.length - 3} more)`;
    },

    _escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _setModalStatus(message, level = '') {
        const el = document.getElementById('checkpoint-modal-status');
        if (!el) return;
        el.textContent = message || '';
        el.classList.remove('text-success', 'text-warning', 'text-danger');
        if (level) el.classList.add(level);
    },

    _setOpenButtonBusy(isBusy) {
        const btn = document.getElementById('checkpointCreateBtn');
        if (!btn) return;

        if (isBusy) {
            if (!btn.dataset.idleHtml) btn.dataset.idleHtml = btn.innerHTML;
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Loading...';
            return;
        }

        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        if (btn.dataset.idleHtml) {
            btn.innerHTML = btn.dataset.idleHtml;
            delete btn.dataset.idleHtml;
        }
    },

    async openModal() {
        if (this._openingModal) return;
        this._openingModal = true;
        this._setOpenButtonBusy(true);
        try {
            this._bindUiHandlers();
            await this._load();
            this.renderModalTable();
            this._setModalStatus('');

            const modalEl = document.getElementById('checkpoint-manager-modal');
            if (!modalEl || !(window.bootstrap && bootstrap.Modal)) return;
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        } finally {
            this._openingModal = false;
            this._setOpenButtonBusy(false);
        }
    },

    async createFromModal() {
        const input = document.getElementById('checkpoint-description-input');
        const saveBtn = document.getElementById('checkpoint-save-btn');
        if (!input || !saveBtn) {
            await this.create('');
            return;
        }

        const description = String(input.value || '').trim();
        saveBtn.disabled = true;
        try {
            const saved = await this.create(description);
            if (saved) input.value = '';
        } finally {
            saveBtn.disabled = false;
        }
    },

    async create(descriptionInput = '') {
        if (!loadFolder.fileHandle) {
            alert('Load a directory first.');
            return false;
        }

        const description = String(descriptionInput || '').trim() || 'No description';
        const ts = new Date();
        const id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

        this._setStatus('Creating checkpoint...');
        this._setModalStatus('Saving checkpoint...', 'text-warning');

        const files = [];
        for (const file of loadFolder.fileStructure) {
            if (!this._shouldIncludeFile(file)) continue;
            try {
                const content = await loadFolder.getFileContent(file);
                files.push({
                    relativePath: String(file.relativePath || '').replace(/\\/g, '/'),
                    content,
                    hash: await this._hashContent(content),
                    size: this._contentSize(content)
                });
            } catch (e) {
                console.warn('Skip file for checkpoint (read error):', file.relativePath, e);
            }
        }

        const previous = this._cache.length ? this._cache[0] : null;
        const changedFiles = this._computeChangedFiles(files, previous ? previous.files : []);
        const checkpointData = {
            id,
            name: description,
            description,
            created: ts.getTime(),
            files,
            changedFiles
        };

        const saved = await this._persist(checkpointData);
        if (!saved) {
            this._setStatus('', { preserveDefault: true });
            this._setModalStatus('Failed to save checkpoint.', 'text-danger');
            return false;
        }

        this._cache.unshift({
            ...checkpointData,
            storage: 'objects',
            storageVersion: this._manifestVersion,
            manifestFileName: this._manifestFilename(checkpointData),
            files: checkpointData.files.map(file => ({
                relativePath: file.relativePath,
                hash: file.hash,
                size: file.size
            }))
        });
        this.renderModalTable(id);
        this._setModalStatus('Checkpoint saved.', 'text-success');
        this._flashStatus(`Checkpoint saved: ${description}`);
        return true;
    },

    _normalizePendingPasteTitle(title) {
        const clean = String(title || '').replace(/\s+/g, ' ').trim();
        if (!clean) return '';
        return clean.slice(0, 120);
    },

    armPendingPasteCheckpoint(title) {
        const normalized = this._normalizePendingPasteTitle(title);
        if (!normalized) {
            this._pendingPasteCheckpointTitle = '';
            return;
        }
        this._pendingPasteCheckpointTitle = normalized;
        this._flashStatus(`Next editor paste will auto-checkpoint: ${normalized}`);
    },

    hasPendingPasteCheckpoint() {
        return !!this._pendingPasteCheckpointTitle;
    },

    getPendingPasteCheckpointTitle() {
        return this._pendingPasteCheckpointTitle || '';
    },

    async runPendingPasteCheckpoint() {
        const title = this._normalizePendingPasteTitle(this._pendingPasteCheckpointTitle);
        if (!title) return false;
        const saved = await this.create(title);
        if (saved) {
            this._pendingPasteCheckpointTitle = '';
            return true;
        }
        return false;
    },

    clearPendingPasteCheckpoint() {
        this._pendingPasteCheckpointTitle = '';
    },

    async _getCheckpointFileContent(cpFile) {
        if (!cpFile) return null;
        if (typeof cpFile.content === 'string') return cpFile.content;
        if (!cpFile.hash) return null;

        const objectDir = await this._getObjectDir(cpFile.hash);
        if (!objectDir) return null;
        const objectHandle = await objectDir.getFileHandle(this._objectFileName(cpFile.hash));
        const objectFile = await objectHandle.getFile();
        return await objectFile.text();
    },

    async restore(id) {
        const cp = this._cache.find(c => c.id === id);
        if (!cp) return;
        if (!loadFolder.fileHandle) {
            alert('Load a directory first.');
            return;
        }

        const cpPaths = new Set(cp.files.map(f => f.relativePath));
        const currentFiles = loadFolder.fileStructure.filter(f => this._shouldIncludeFile(f));
        const currentPaths = new Set(currentFiles.map(f => f.relativePath));

        const toDelete = currentFiles.filter(f => !cpPaths.has(f.relativePath));
        const toCreate = cp.files.filter(f => !currentPaths.has(f.relativePath));
        const toOverwrite = cp.files.filter(f => currentPaths.has(f.relativePath));

        const label = cp.description || cp.name || 'checkpoint';
        const msg = `Restore checkpoint "${label}"?\n\n` +
            `Will overwrite: ${toOverwrite.length} file(s)\n` +
            `Will create:    ${toCreate.length} new file(s)\n` +
            `Will delete:    ${toDelete.length} extra file(s)\n\n` +
            `Proceed? (Irreversible)`;
        if (!confirm(msg)) return;

        this._setStatus('Restoring checkpoint...');
        this._setModalStatus('Restoring checkpoint...', 'text-warning');

        const ensureFile = async (relPath, content) => {
            const parts = relPath.split('/');
            const name = parts.pop();
            let dir = loadFolder.fileHandle;
            for (const part of parts) {
                dir = await dir.getDirectoryHandle(part, { create: true });
            }
            const fileHandle = await dir.getFileHandle(name, { create: true });
            // Ensure unshipped banner for restored HTML files
            let prepared = content;
            if (/\.html?$/i.test(name) && typeof editor !== 'undefined' && editor.ensureUnshippedBanner) {
                prepared = editor.ensureUnshippedBanner(prepared, name, { name, relativePath: relPath });
            }
            const writable = await fileHandle.createWritable();
            await writable.write(prepared);
            await writable.close();
            const fileData = {
                name,
                path: parts,
                type: name.includes('.') ? name.split('.').pop() : '',
                kind: 'file',
                entry: fileHandle,
                uuid: loadFolder.createUuid(),
                relativePath: relPath
            };
            loadFolder.fileStructure.push(fileData);
        };

        for (const f of toDelete) {
            try {
                let parentDir = loadFolder.fileHandle;
                for (const dirPart of f.path) {
                    parentDir = await parentDir.getDirectoryHandle(dirPart);
                }
                await parentDir.removeEntry(f.name);
                if (editor.instance[f.uuid]) {
                    editor.deleteTab(f.uuid, { force: true });
                }
                loadFolder.fileStructure = loadFolder.fileStructure.filter(x => x !== f);
            } catch (e) {
                console.error('Failed deleting file during restore', f.relativePath, e);
            }
        }

        for (const cpFile of toOverwrite) {
            const live = currentFiles.find(x => x.relativePath === cpFile.relativePath);
            if (!live) continue;
            const content = await this._getCheckpointFileContent(cpFile);
            if (content == null) continue;
            try {
                if (editor.instance[live.uuid]) {
                    if (!editor._meta[live.uuid]) await editor.openFile(live.uuid);
                    editor.setValue(live.uuid, content);
                    await editor._writeDirect(live.uuid, content);
                } else {
                    let entry = live.entry;
                    try {
                        await entry.getFile();
                    } catch (_) {
                        let dir = loadFolder.fileHandle;
                        for (const part of live.path) dir = await dir.getDirectoryHandle(part);
                        entry = await dir.getFileHandle(live.name);
                        live.entry = entry;
                    }
                    // Ensure unshipped banner for restored HTML files
                    let prepared = content;
                    if (/\.html?$/i.test(live.name) && typeof editor !== 'undefined' && editor.ensureUnshippedBanner) {
                        prepared = editor.ensureUnshippedBanner(prepared, live.name, live);
                    }
                    const writable = await live.entry.createWritable();
                    await writable.write(prepared);
                    await writable.close();
                }
            } catch (e) {
                console.error('Failed overwriting file', live.relativePath, e);
            }
        }

        for (const nf of toCreate) {
            try {
                const content = await this._getCheckpointFileContent(nf);
                if (content == null) throw new Error(`Missing checkpoint content for ${nf.relativePath}`);
                await ensureFile(nf.relativePath, content);
            } catch (e) {
                console.error('Failed creating file during restore', nf.relativePath, e);
            }
        }

        loadFolder.refreshFileTree();
        this._setModalStatus('Checkpoint restored.', 'text-success');
        this._flashStatus(`Checkpoint restored: ${label}`);
    },

    async _deleteObjectIfUnreferenced(hash, remainingCheckpoints) {
        if (!hash) return;
        const stillReferenced = remainingCheckpoints.some(cp =>
            Array.isArray(cp.files) && cp.files.some(file => file && file.hash === hash)
        );
        if (stillReferenced) return;

        try {
            const objectDir = await this._getObjectDir(hash);
            if (!objectDir) return;
            await objectDir.removeEntry(this._objectFileName(hash));
        } catch (e) {
            if (e.name !== 'NotFoundError') {
                console.warn('Failed to delete unreferenced checkpoint object', hash, e);
            }
        }
    },

    async delete(id) {
        const idx = this._cache.findIndex(c => c.id === id);
        if (idx === -1) return;

        const cp = this._cache[idx];
        const name = cp.description || cp.name || 'checkpoint';
        if (!confirm(`Delete checkpoint "${name}"?`)) return;

        try {
            const dir = await this._getCheckpointDir();
            if (dir && cp.storage === 'legacy') {
                await dir.removeEntry(cp.legacyFileName || this._legacyFilename(cp));
            } else if (cp.storage === 'objects') {
                const manifestDir = await this._getManifestDir();
                if (manifestDir) {
                    await manifestDir.removeEntry(cp.manifestFileName || this._manifestFilename(cp));
                }
            }

            this._cache.splice(idx, 1);
            const hashes = new Set((cp.files || []).map(file => file && file.hash).filter(Boolean));
            for (const hash of hashes) {
                await this._deleteObjectIfUnreferenced(hash, this._cache);
            }
            this.renderModalTable();
            this._setModalStatus('Checkpoint deleted.', 'text-success');
            this._flashStatus('Checkpoint deleted.');
        } catch (e) {
            console.error('Failed to delete checkpoint file', e);
            this._setModalStatus('Failed to delete checkpoint.', 'text-danger');
            alert('Error deleting checkpoint: ' + e.message);
        }
    },

    renderModalTable() {
        const tbody = document.getElementById('checkpoint-table-body');
        if (!tbody) return;

        const list = this.list();
        if (!list.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center text-muted">No checkpoints yet.</td>
                </tr>`;
            return;
        }

        tbody.innerHTML = list.map((cp, idx) => {
            const changedFiles = this._getChangedFilesForDisplay(cp, idx, list);
            const summary = this._formatChangedSummary(changedFiles);
            const tooltip = this._escapeHtml(changedFiles.slice(0, 25).join('\n'));
            const description = this._escapeHtml(cp.description || cp.name || 'No description');
            const created = this._escapeHtml(new Date(cp.created).toLocaleString());
            const id = this._escapeHtml(cp.id);

            return `
                <tr>
                    <td>${created}</td>
                    <td title="${tooltip}">${this._escapeHtml(summary)}</td>
                    <td class="checkpoint-description-cell">${description}</td>
                    <td class="text-end">
                        <button type="button" class="btn btn-sm btn-outline-success me-1"
                            data-action="checkpoint-restore" data-id="${id}">Restore</button>
                        <button type="button" class="btn btn-sm btn-outline-danger"
                            data-action="checkpoint-delete" data-id="${id}">Delete</button>
                    </td>
                </tr>`;
        }).join('');
    },

    renderList() {
        this.renderModalTable();
    },

    _setStatus(msg, { preserveDefault = false } = {}) {
        const el = document.getElementById('global-save-status');
        if (!el) return;
        if (!this._defaultStatusText && !preserveDefault) {
            this._defaultStatusText = el.textContent || '';
        }
        if (this._statusTimer) {
            clearTimeout(this._statusTimer);
            this._statusTimer = null;
        }
        el.textContent = msg;
    },

    _flashStatus(msg, duration = 2500) {
        const el = document.getElementById('global-save-status');
        if (!el) return;
        this._setStatus(msg);
        this._statusTimer = setTimeout(() => {
            this._setStatus(this._defaultStatusText || '', { preserveDefault: true });
        }, duration);
    }
};
