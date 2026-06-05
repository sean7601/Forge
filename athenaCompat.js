// Athena compatibility layer for the legacy Forge app.
// Exposes the v2 Athena agent's expected globals using existing loadFolder/editor APIs.

var dirHandle = null;
var fileHandles = {};
var openFiles = [];
var activeFile = null;
var cmEditors = {};
var aiChatHistory = Array.isArray(window.aiChatHistory) ? window.aiChatHistory : [];

(function (root) {
    function getLoadFolderApi() {
        if (root.loadFolder && typeof root.loadFolder === 'object') return root.loadFolder;
        try {
            if (typeof loadFolder !== 'undefined' && loadFolder) return loadFolder;
        } catch (_) { }
        return null;
    }

    function getEditorApi() {
        if (root.editor && typeof root.editor === 'object' && typeof root.editor.openFile === 'function') return root.editor;
        try {
            if (typeof editor !== 'undefined' && editor && typeof editor.openFile === 'function') return editor;
        } catch (_) { }
        return null;
    }

    function getCheckpointApi() {
        if (root.checkpointManager && typeof root.checkpointManager === 'object') return root.checkpointManager;
        try {
            if (typeof checkpointManager !== 'undefined' && checkpointManager) return checkpointManager;
        } catch (_) { }
        return null;
    }

    function escHtmlLocal(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    if (typeof root.escHtml !== 'function') {
        root.escHtml = escHtmlLocal;
    }

    function normalizePath(path) {
        var parts = String(path || '').replace(/\\/g, '/').split('/');
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var part = String(parts[i] || '').trim();
            if (!part || part === '.') continue;
            if (part === '..') {
                if (out.length) out.pop();
                continue;
            }
            out.push(part);
        }
        return out.join('/');
    }

    function getFileEntries() {
        var lf = getLoadFolderApi();
        if (!lf || !Array.isArray(lf.fileStructure)) return [];
        return lf.fileStructure.filter(function (entry) {
            return entry && entry.kind === 'file';
        });
    }

    function findEntryByPath(path) {
        var want = normalizePath(path).toLowerCase();
        if (!want) return null;
        var entries = getFileEntries();
        for (var i = 0; i < entries.length; i++) {
            var rel = normalizePath(entries[i].relativePath || '').toLowerCase();
            if (rel === want) return entries[i];
        }
        return null;
    }

    function getOpenUuidByPath(path) {
        var ed = getEditorApi();
        if (!ed || !ed._meta || !ed.instance) return null;
        var want = normalizePath(path).toLowerCase();
        var uuids = Object.keys(ed.instance);
        for (var i = 0; i < uuids.length; i++) {
            var uuid = uuids[i];
            var meta = ed._meta[uuid];
            var rel = normalizePath(meta && meta.relativePath ? meta.relativePath : '').toLowerCase();
            if (rel && rel === want) return uuid;
        }
        return null;
    }

    function syncState() {
        var lf = getLoadFolderApi();
        var ed = getEditorApi();
        dirHandle = lf && lf.fileHandle ? lf.fileHandle : null;

        var nextHandles = {};
        var entries = getFileEntries();
        for (var i = 0; i < entries.length; i++) {
            var rel = normalizePath(entries[i].relativePath || '');
            if (!rel) continue;
            nextHandles[rel] = entries[i].entry;
        }
        fileHandles = nextHandles;

        openFiles = [];
        cmEditors = {};
        activeFile = null;

        if (ed && ed.instance && ed._meta) {
            var openUuids = Object.keys(ed.instance);
            for (var j = 0; j < openUuids.length; j++) {
                var uuid = openUuids[j];
                var meta = ed._meta[uuid];
                var relPath = normalizePath(meta && meta.relativePath ? meta.relativePath : '');
                if (!relPath) continue;

                var content = '';
                try {
                    if (typeof ed._getValue === 'function') {
                        content = ed._getValue(uuid);
                    } else if (ed.instance[uuid] && ed.instance[uuid].state) {
                        content = ed.instance[uuid].state.doc.toString();
                    }
                } catch (_) {
                    content = '';
                }

                openFiles.push({
                    path: relPath,
                    name: String(meta && meta.name ? meta.name : relPath.split('/').pop()),
                    content: content,
                    original: String(meta && meta.text ? meta.text : content),
                    ext: String((meta && meta.name ? meta.name : relPath).split('.').pop() || '').toLowerCase()
                });

                cmEditors[relPath] = ed.instance[uuid];
            }

            try {
                if (typeof ed.getActiveUuid === 'function') {
                    var activeUuid = ed.getActiveUuid();
                    var activeMeta = activeUuid ? ed._meta[activeUuid] : null;
                    activeFile = activeMeta ? normalizePath(activeMeta.relativePath || '') : null;
                }
            } catch (_) {
                activeFile = null;
            }
        }

        root.aiChatHistory = aiChatHistory;
        root.dirHandle = dirHandle;
        root.fileHandles = fileHandles;
        root.openFiles = openFiles;
        root.activeFile = activeFile;
        root.cmEditors = cmEditors;
    }

    async function readPathContent(path) {
        syncState();
        var normalized = normalizePath(path);
        if (!normalized) return '';

        var openUuid = getOpenUuidByPath(normalized);
        var ed = getEditorApi();
        if (openUuid && ed) {
            try {
                if (typeof ed._getValue === 'function') {
                    return ed._getValue(openUuid);
                }
            } catch (_) {
                // fallback to disk read
            }
        }

        var entry = findEntryByPath(normalized);
        if (!entry || !entry.entry || typeof entry.entry.getFile !== 'function') {
            throw new Error('File not found: ' + normalized);
        }
        var file = await entry.entry.getFile();
        return await file.text();
    }

    async function writeHandle(handle, content, optPath) {
        if (!handle || typeof handle.createWritable !== 'function') {
            throw new Error('Invalid file handle.');
        }
        var text = String(content == null ? '' : content);
        // Ensure the unshipped banner is present when writing HTML files
        if (optPath && /\.html?$/i.test(String(optPath))) {
            var ed = getEditorApi();
            if (ed && typeof ed.ensureUnshippedBanner === 'function') {
                text = ed.ensureUnshippedBanner(text);
            }
        }
        var writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async function writePath(path, content) {
        syncState();
        var normalized = normalizePath(path);
        if (!normalized) {
            throw new Error('Invalid file path.');
        }
        if (!dirHandle) {
            throw new Error('No project loaded.');
        }

        var parts = normalized.split('/');
        var filename = parts.pop();
        if (!filename) throw new Error('Invalid file path.');

        var parent = dirHandle;
        for (var i = 0; i < parts.length; i++) {
            parent = await parent.getDirectoryHandle(parts[i], { create: true });
        }

        var handle = await parent.getFileHandle(filename, { create: true });
        await writeHandle(handle, content, normalized);

        var lf = getLoadFolderApi();
        if (lf && typeof lf.recursivelyReadDirectory === 'function') {
            lf.fileStructure = await lf.recursivelyReadDirectory([], lf.fileHandle);
            if (typeof lf._updateSignature === 'function') {
                lf._updateSignature();
            }
            if (typeof lf.refreshFileTree === 'function') {
                lf.refreshFileTree();
            }
        }

        syncState();
        return handle;
    }

    async function refreshTree() {
        var lf = getLoadFolderApi();
        if (!lf || !lf.fileHandle || typeof lf.recursivelyReadDirectory !== 'function') {
            syncState();
            return;
        }

        lf.fileStructure = await lf.recursivelyReadDirectory([], lf.fileHandle);
        if (typeof lf._updateSignature === 'function') {
            lf._updateSignature();
        }
        if (typeof lf.refreshFileTree === 'function') {
            lf.refreshFileTree();
        }

        syncState();
    }

    async function openPath(path) {
        syncState();
        var entry = findEntryByPath(path);
        if (!entry) throw new Error('File not found: ' + path);
        var ed = getEditorApi();
        if (!ed || typeof ed.openFile !== 'function') {
            throw new Error('Editor API unavailable.');
        }
        await ed.openFile(entry.uuid);
        syncState();
        return entry.uuid;
    }

    function closePath(path) {
        var ed = getEditorApi();
        if (!ed || typeof ed.deleteTab !== 'function') return;
        var uuid = getOpenUuidByPath(path);
        if (!uuid) return;
        ed.deleteTab(uuid);
        syncState();
    }

    async function syncEditorPath(path) {
        var normalized = normalizePath(path);
        if (!normalized) return;
        var entry = findEntryByPath(normalized);
        if (!entry) {
            syncState();
            return;
        }

        var ed = getEditorApi();
        if (!ed || typeof ed.openFile !== 'function') {
            syncState();
            return;
        }

        var openUuid = getOpenUuidByPath(normalized);
        if (openUuid && typeof ed.deleteTab === 'function') {
            ed.deleteTab(openUuid);
        }

        await ed.openFile(entry.uuid);
        syncState();
    }

    function markUnsavedCompat(path) {
        // Legacy Athena marks files unsaved after direct writes.
        // In this app, Athena writes directly to disk, so no-op is intentional.
        void path;
    }

    function patchEvents() {
        if (root.__athenaCompatPatched) return;
        root.__athenaCompatPatched = true;

        var lf = getLoadFolderApi();
        if (lf && typeof lf.getFile === 'function') {
            var originalGetFile = lf.getFile.bind(lf);
            lf.getFile = async function () {
                var result = await originalGetFile();
                syncState();
                return result;
            };
        }

        lf = getLoadFolderApi();
        if (lf && typeof lf.refreshFileTree === 'function') {
            var originalRefresh = lf.refreshFileTree.bind(lf);
            lf.refreshFileTree = function () {
                var result = originalRefresh.apply(lf, arguments);
                syncState();
                return result;
            };
        }

        var ed = getEditorApi();
        if (ed && typeof ed.openFile === 'function') {
            var originalOpenFile = ed.openFile.bind(ed);
            ed.openFile = async function () {
                var result = await originalOpenFile.apply(ed, arguments);
                syncState();
                return result;
            };
        }

        ed = getEditorApi();
        if (ed && typeof ed.deleteTab === 'function') {
            var originalDeleteTab = ed.deleteTab.bind(ed);
            ed.deleteTab = function () {
                var result = originalDeleteTab.apply(ed, arguments);
                syncState();
                return result;
            };
        }

        var cp = getCheckpointApi();
        if (cp && typeof cp.createAutoCheckpoint !== 'function') {
            cp.createAutoCheckpoint = async function (description) {
                return await cp.create(description || 'Athena auto-checkpoint');
            };
        }

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) syncState();
        });
    }

    root.athenaCompat = {
        syncState: syncState,
        normalizePath: normalizePath,
        findEntryByPath: findEntryByPath,
        readFileContent: readPathContent,
        writeFileToHandle: writeHandle,
        writeNewFile: writePath,
        refreshFileTree: refreshTree,
        openFile: openPath,
        closeTab: closePath,
        markUnsaved: markUnsavedCompat,
        syncEditorPath: syncEditorPath,
        getOpenFilePaths: function () {
            syncState();
            return openFiles.map(function (f) { return f.path; });
        },
        getActiveFilePath: function () {
            syncState();
            return activeFile || '';
        }
    };

    // Global functions expected by Athena's v2 agent.
    root.readFileContent = readPathContent;
    root.writeFileToHandle = writeHandle;
    root.writeNewFile = writePath;
    root.refreshFileTree = refreshTree;
    root.openFile = openPath;
    root.closeTab = closePath;
    root.markUnsaved = markUnsavedCompat;

    patchEvents();
    syncState();

    // Lightweight background sync for tab switches and non-standard state updates.
    setInterval(syncState, 2000);
})(window);
