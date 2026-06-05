
// File: editor.js (ultra-simple saves; resilient to file tree refresh/new uuids)

const editor = {
    instance: {},            // uuid -> editor instance (CodeMirror 6 view)
    dirtyFiles: new Set(),   // uuids with unsaved edits (UI only)
    _meta: {},               // uuid -> { entry, name, path[], relativePath, text }
    _cm: null,
    _cmReady: null,
    _autoSaveEnabled: true,
    _autoSaveTimer: null,
    _autoSaveDelay: 2000,    // 2 second debounce
    _hasShownIndexReferenceAuditModal: false,
    _lastIndexReferenceAudit: null,
    _openingFiles: new Set(), // lower-cased relative paths currently opening

    isDirty(uuid) { return this.dirtyFiles.has(uuid); },

    setAutoSave(enabled) {
        this._autoSaveEnabled = enabled;
        if (!enabled && this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    },

    getAutoSaveEnabled() { return this._autoSaveEnabled; },

    _scheduleAutoSave() {
        if (!this._autoSaveEnabled) return;
        if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = setTimeout(() => {
            this._autoSaveTimer = null;
            if (this._autoSaveEnabled && this.dirtyFiles.size > 0) {
                this.saveAll({ fromAutoSave: true });
            }
        }, this._autoSaveDelay);
    },

    getActiveUuid() {
        const $active = $("#editor-container .nav-link.active");
        if (!$active.length) return null;
        const id = $active.attr('id');
        if (!id || !id.startsWith('nav-')) return null;
        return id.substring(4);
    },

    async openFile(uuid) {
        // If already open, just focus it (check this FIRST before looking up file)
        if (this.instance.hasOwnProperty(uuid)) {
            $("#editor-container .nav-link.active").removeClass("active");
            $("#nav-" + uuid).addClass("active");
            $(".editor").hide();
            $("#editor-" + uuid).show();
            this.instance[uuid].focus();
            return;
        }

        // Look up current snapshot from loadFolder at the moment of opening
        const file = loadFolder.fileStructure.find(f => f.uuid === uuid);
        if (!file) return;

        const relKey = String(file.relativePath || '').replace(/\\/g, '/').toLowerCase() || `uuid:${uuid}`;
        if (this._openingFiles.has(relKey)) {
            return;
        }
        this._openingFiles.add(relKey);

        try {
            // If a tab for this file is already open under a different uuid (e.g., after refresh), reuse it
            const existingUuid = Object.keys(this._meta).find(u => {
                const m = this._meta[u];
                if (!m || !m.relativePath) return false;
                return String(m.relativePath).replace(/\\/g, '/').toLowerCase() === relKey;
            });
            if (existingUuid && this.instance[existingUuid]) {
                $("#editor-container .nav-link.active").removeClass("active");
                $("#nav-" + existingUuid).addClass("active");
                $(".editor").hide();
                $("#editor-" + existingUuid).show();
                this.instance[existingUuid].focus();
                return;
            }

            const cm = await this._ensureCodeMirror();
            const ext = (file.type || '').toLowerCase();
            const language = this._resolveLanguage(ext);

            // Read file contents fresh
            const fh = await file.entry.getFile();
            const fileContent = await fh.text();
            const editorContent = this._prepareContentsForEditor(file.name, fileContent);

            // If the banner was injected, mark the file dirty so auto-save writes it to disk
            const bannerWasInjected = editorContent !== fileContent;

            // Capture per-tab metadata with a *stable handle* independent of future fileStructure refreshes
            this._meta[uuid] = {
                entry: file.entry,                 // FileSystemFileHandle
                name: file.name,
                path: Array.isArray(file.path) ? file.path.slice() : [],
                relativePath: file.relativePath,
                text: bannerWasInjected ? editorContent : fileContent  // last saved snapshot for quick no-op check
            };

            // Build editor pane + tab UI
            $("#editor-container .nav-link.active").removeClass("active");
            $(".editor").hide();
            $("#editor").append(`<div class='editor' id='editor-${uuid}'></div>`);
            $("#editor-container .nav-tabs").append(
                `<li class="nav-item">
                    <a class="nav-link active" id="nav-${uuid}" href="#" data-uuid="${uuid}">
                        <span class="filename">${file.name}</span>
                        <small id="save-status-${uuid}" class="save-status ml-2">Saved</small>
                        <span class="ml-2 tab-close" role="button" tabindex="0" aria-label="Close tab" data-uuid="${uuid}" style="cursor:pointer;">&times;</span>
                    </a>
                </li>`
            );

            const parent = document.getElementById("editor-" + uuid);

            const extensions = [
                cm.basicSetup,
                cm.EditorView.lineWrapping
            ];

            if (cm.oneDark) extensions.push(cm.oneDark);

            extensions.push(
                cm.materialLikeTheme,
                ...cm.searchKeymapExtensions,
                ...cm.foldKeymapExtensions,
                ...cm.ctrlQFoldKeymap,
                ...this._languageExtensions(language, cm),
                cm.EditorView.updateListener.of(update => {
                    if (!update.docChanged) return;
                    this.dirtyFiles.add(uuid);
                    this._setStatus(uuid, 'Edited', null);
                    $("#saveButton")
                        .removeClass("btn-outline-primary btn-outline-success")
                        .addClass("btn-outline-danger");
                    this._scheduleAutoSave();
                })
            );

            if (ext === 'js') {
                extensions.push(...cm.getJsLinterExtensions());
            }

            const state = cm.EditorState.create({
                doc: editorContent,
                extensions
            });

            const view = new cm.EditorView({
                state,
                parent
            });

            this.instance[uuid] = view;
            this._setStatus(uuid, 'Saved', 'saved');
            view.focus();

            // If the unshipped banner was auto-injected, mark dirty and trigger save to disk
            if (bannerWasInjected) {
                this.dirtyFiles.add(uuid);
                this._setStatus(uuid, 'Edited', null);
                this._scheduleAutoSave();
            }
        } finally {
            this._openingFiles.delete(relKey);
        }
    },

    deleteTab(uuid, options = {}) {
        const opts = {
            force: false,
            ...options
        };
        if (!opts.force && this.isDirty(uuid)) {
            const fileName = this._meta[uuid]?.name || 'this file';
            const shouldDiscard = confirm(`"${fileName}" has unsaved changes.\n\nClose this tab and discard those changes?`);
            if (!shouldDiscard) {
                return false;
            }
        }

        const tab = $(`#nav-${uuid}`).parent();
        const wasActive = tab.find('a').hasClass('active');

        const view = this._getView(uuid);
        if (view && typeof view.destroy === 'function') {
            view.destroy();
        }

        $(`#editor-${uuid}`).remove();
        tab.remove();

        delete this.instance[uuid];
        delete this._meta[uuid];
        this.dirtyFiles.delete(uuid);

        if (wasActive && $("#editor-container .nav-item").length > 0) {
            const lastTabLink = $("#editor-container .nav-item:last").find('a');
            if (lastTabLink.length > 0) {
                const lastTabUuid = lastTabLink.attr('id').replace('nav-', '');
                this.openFile(lastTabUuid);
            }
        }
        return true;
    },

    _setStatus(uuid, text, cls) {
        const el = document.getElementById(`save-status-${uuid}`);
        if (!el) return;
        el.textContent = text;
        el.classList.remove('saving', 'saved', 'error');
        if (cls) el.classList.add(cls);
    },

    _dispatchFileSaved(meta, source) {
        try {
            document.dispatchEvent(new CustomEvent('forge:file-saved', {
                detail: {
                    fileName: meta?.name || '',
                    relativePath: meta?.relativePath || meta?.name || '',
                    source: source || 'save'
                }
            }));
        } catch (_) { }
    },

    _getView(uuid) {
        return this.instance[uuid] || null;
    },

    _isHtmlFileName(name) {
        return /\.(html?|HTML?)$/.test(String(name || ''));
    },

    _isIndexHtmlFileName(name) {
        return String(name || '').trim().toLowerCase() === 'index.html';
    },

    // --- Unshipped banner ---
    // NOTE: marker strings use concatenation so the compiler strip-regex
    // cannot match them when WCT compiles itself (JS inlined into HTML).
    _UNSHIPPED_BANNER_TAG: 'WCT-UNSHIPPED-' + 'BANNER',
    get _UNSHIPPED_BANNER_START() { return '<!-- ' + this._UNSHIPPED_BANNER_TAG + ':START -->'; },
    get _UNSHIPPED_BANNER_END()   { return '<!-- ' + this._UNSHIPPED_BANNER_TAG + ':END -->'; },
    get _UNSHIPPED_BANNER() {
        return '<!-- ' + this._UNSHIPPED_BANNER_TAG + ':START -->\n' +
            '<div id="wct-unshipped-banner" style="background:linear-gradient(90deg,#c0392b,#e74c3c);color:#fff;text-align:center;padding:6px 12px;font-family:system-ui,-apple-system,sans-serif;font-weight:bold;font-size:12px;line-height:1.2;position:fixed;top:0;left:0;right:0;z-index:999999;box-shadow:0 1px 4px rgba(0,0,0,0.25);">\n' +
            '  ⚠️ Not Secured – Ship in Forge before entering CUI/sensitive data\n' +
            '</div>\n' +
            '<style id="wct-unshipped-banner-style">body { padding-top: 30px !important; }</style>\n' +
            '<!-- ' + this._UNSHIPPED_BANNER_TAG + ':END -->';
    },

    _hasUnshippedBanner(contents) {
        return String(contents || '').includes('WCT-UNSHIPPED-' + 'BANNER:START');
    },

    _looksLikeForgeSelfHtml(contents) {
        const str = this.stripUnshippedBanner(String(contents || ''));
        if (!/<title>\s*Forge\s*<\/title>/i.test(str) && /id=["']forge-secure-app-frame["']/i.test(str) && /CHILD_HTML_B64/i.test(str)) {
            const match = str.match(/CHILD_HTML_B64\s*=\s*(["'])([A-Za-z0-9+/=]+)\1/);
            if (match && typeof atob === 'function') {
                try {
                    const decodedChild = atob(match[2]);
                    if (decodedChild && decodedChild !== str) {
                        return this._looksLikeForgeSelfHtml(decodedChild);
                    }
                } catch (_) {
                    return false;
                }
            }
        }
        const hasForgeTitle = /<title>\s*Forge\s*<\/title>/i.test(str);

        const sourceModuleHits = [
            /<script[^>]+src=["']loadFolder\.js["']/i,
            /<script[^>]+src=["']editor\.js["']/i,
            /<script[^>]+src=["']checkpointManager\.js["']/i,
            /<script[^>]+src=["']compiler\.js["']/i,
            /<script[^>]+src=["']athenaAgent\.js["']/i
        ].filter(pattern => pattern.test(str)).length;
        if (sourceModuleHits >= 4 || (hasForgeTitle && sourceModuleHits >= 3)) return true;

        const inlinedModuleHits = [
            /\/\/ File:\s*loadFolder\.js/i,
            /\/\/ File:\s*editor\.js/i,
            /\/\/ File:\s*checkpointManager\.js/i,
            /\/\/ File:\s*compiler\.js/i,
            /\/\/ File:\s*athenaAgent\.js/i
        ].filter(pattern => pattern.test(str)).length;
        if (inlinedModuleHits >= 4 || (hasForgeTitle && inlinedModuleHits >= 3)) return true;

        const runtimeObjectHits = [
            /const\s+loadFolder\s*=/i,
            /const\s+editor\s*=/i,
            /const\s+checkpointManager\s*=/i,
            /const\s+compiler\s*=/i,
            /const\s+athenaAgent\s*=/i
        ].filter(pattern => pattern.test(str)).length;
        return runtimeObjectHits >= 4 || (hasForgeTitle && runtimeObjectHits >= 3);
    },

    shouldSkipUnshippedBanner(fileName, contents, meta = null) {
        const candidateName = fileName || meta?.name || '';
        if (candidateName && !this._isHtmlFileName(candidateName)) return true;
        return this._looksLikeForgeSelfHtml(contents);
    },

    ensureUnshippedBanner(contents, fileName = '', meta = null) {
        const str = String(contents || '');
        if (this.shouldSkipUnshippedBanner(fileName, str, meta)) {
            return this._looksLikeForgeSelfHtml(str) ? this.stripUnshippedBanner(str) : str;
        }
        if (this._hasUnshippedBanner(str)) return str;
        // Find the real HTML <body> tag — skip any <body that appears inside
        // <script> blocks (e.g. minified DOMPurify contains "<body>" as a JS string).
        const bodyRegex = /<body[^>]*>/gi;
        let bodyMatch;
        while ((bodyMatch = bodyRegex.exec(str)) !== null) {
            // Check whether this match sits inside a <script>…</script> block
            const before = str.slice(0, bodyMatch.index);
            const lastScriptOpen = before.lastIndexOf('<script');
            if (lastScriptOpen !== -1) {
                const lastScriptClose = before.lastIndexOf('</script');
                // If a <script was opened more recently than it was closed,
                // this <body> is inside JS — skip it.
                if (lastScriptClose < lastScriptOpen) continue;
            }
            // Also skip if inside a <style> block
            const lastStyleOpen = before.lastIndexOf('<style');
            if (lastStyleOpen !== -1) {
                const lastStyleClose = before.lastIndexOf('</style');
                if (lastStyleClose < lastStyleOpen) continue;
            }
            const idx = bodyMatch.index + bodyMatch[0].length;
            return str.slice(0, idx) + '\n' + this._UNSHIPPED_BANNER + '\n' + str.slice(idx);
        }
        // No real <body> found — prepend
        return this._UNSHIPPED_BANNER + '\n' + str;
    },

    stripUnshippedBanner(contents) {
        const str = String(contents || '');
        // Remove everything between (and including) the start/end comment markers
        // Built via concatenation so the regex doesn't match itself when WCT compiles itself
        const tag = 'WCT-UNSHIPPED-' + 'BANNER';
        return str.replace(new RegExp('\\n?<!-- ' + tag + ':START -->[\\s\\S]*?<!-- ' + tag + ':END -->\\n?', 'g'), '');
    },

    _prepareContentsForEditor(fileName, contents) {
        const str = String(contents || '');
        if (this._isHtmlFileName(fileName)) {
            return this.ensureUnshippedBanner(str, fileName);
        }
        return str;
    },

    _prepareContentsForDisk(fileName, contents) {
        const str = String(contents || '');
        if (this._isHtmlFileName(fileName)) {
            return this.ensureUnshippedBanner(str, fileName);
        }
        return str;
    },

    _validateHtmlBeforeSave(uuid, contents) {
        const meta = this._meta[uuid];
        const fileName = meta?.name || 'file';
        if (!this._isHtmlFileName(fileName)) {
            return { ok: true };
        }

        const openMatch = contents.match(/<html(?:\s|>)/i);
        const closeMatch = contents.match(/<\/html\s*>/i);
        const hasOpeningTag = !!openMatch;
        const hasClosingTag = !!closeMatch;
        const ordered = hasOpeningTag && hasClosingTag && openMatch.index < closeMatch.index;

        if (ordered) {
            return { ok: true };
        }

        this._setStatus(uuid, 'Invalid HTML', 'error');
        let reason = 'missing-html-wrapper';
        let guidance = 'This file must include both <html> and </html> before it can be saved.';
        if (hasOpeningTag && !hasClosingTag) {
            reason = 'opening-only';
            guidance = 'This looks like only the beginning of the file. The response may still be generating. Wait for it to finish, then copy the full file again.';
        } else if (!hasOpeningTag && !hasClosingTag) {
            reason = 'no-html-tags';
            guidance = 'This looks like a code snippet, not a full HTML file. Ask the AI to output the complete file from <html> to </html>.';
        }

        const message = `"${fileName}" is not a complete HTML file yet.`;
        return {
            ok: false,
            fileName,
            message,
            reason,
            guidance,
            hasOpeningTag,
            hasClosingTag
        };
    },

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _cleanupModalArtifacts() {
        const shownCount = document.querySelectorAll('.modal.show').length;
        if (shownCount > 0) return;

        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
    },

    _removeModalById(modalId) {
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return;

        try {
            const modalApi = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal : null;
            if (modalApi) {
                const instance = modalApi.getInstance(modalEl);
                if (instance) instance.dispose();
            }
        } catch (_) { }

        modalEl.remove();
        this._cleanupModalArtifacts();
    },

    _ensureInvalidHtmlModalStyle() {
        if (document.getElementById('forge-invalid-html-modal-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'forge-invalid-html-modal-style';
        style.textContent = `
            #forge-invalid-html-modal .modal-content {
                background: #1f252a;
                color: #e9ecef;
                border: 1px solid #3a434a;
            }
            #forge-invalid-html-modal .modal-header,
            #forge-invalid-html-modal .modal-footer {
                border-color: #3a434a;
            }
            #forge-invalid-html-modal code {
                color: #9ad9ff;
            }
        `;
        document.head.appendChild(style);
    },

    async _showInvalidHtmlModal(validation, options = {}) {
        const opts = {
            extraSkippedCount: 0,
            ...options
        };
        const modalApi = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal : null;

        const rawFileName = String(validation?.fileName || 'HTML file');
        const fileName = this._escapeHtml(rawFileName);
        const guidance = this._escapeHtml(validation?.guidance || 'This file is not a complete HTML document.');
        const snippetPromptText = 'Please output the entire html file, not a snippet';
        const extraText = opts.extraSkippedCount > 0
            ? `<p class="mb-0 mt-2"><small>${opts.extraSkippedCount} additional file(s) were also skipped for the same reason.</small></p>`
            : '';
        const snippetPromptHtml = validation?.reason === 'no-html-tags'
            ? `
                <div class="mt-3 p-2 rounded" style="background:#1a202c; border:1px solid #3a434a;">
                    <small class="d-block mb-1">Copy and paste this to your AI:</small>
                    <code id="forge-snippet-prompt-text">${this._escapeHtml(snippetPromptText)}</code>
                    <div class="mt-2">
                        <button type="button" class="btn btn-sm btn-outline-info" id="forge-copy-snippet-prompt-btn">Copy Prompt</button>
                    </div>
                </div>
            `
            : '';

        if (!modalApi) {
            alert(`"${rawFileName}" is not a full file yet.\n\n${validation?.guidance || ''}`);
            return;
        }

        this._ensureInvalidHtmlModalStyle();

        const modalId = 'forge-invalid-html-modal';
        const existing = document.getElementById(modalId);
        if (existing && existing.classList.contains('show')) {
            return;
        }
        this._removeModalById(modalId);

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Incomplete HTML File</h5>
                        </div>
                        <div class="modal-body">
                            <p class="mb-2"><strong><code>${fileName}</code></strong> is not a full file yet.</p>
                            <p class="mb-0">${guidance}</p>
                            ${snippetPromptHtml}
                            ${extraText}
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return;

        const modal = new modalApi(modalEl, { backdrop: 'static', keyboard: false });
        const copyBtn = modalEl.querySelector('#forge-copy-snippet-prompt-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const copyText = snippetPromptText;
                const setCopiedState = () => {
                    const original = copyBtn.textContent;
                    copyBtn.textContent = 'Copied';
                    copyBtn.classList.remove('btn-outline-info');
                    copyBtn.classList.add('btn-success');
                    setTimeout(() => {
                        copyBtn.textContent = original;
                        copyBtn.classList.remove('btn-success');
                        copyBtn.classList.add('btn-outline-info');
                    }, 1200);
                };

                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(copyText);
                        setCopiedState();
                        return;
                    }
                } catch (_) { }

                try {
                    const ta = document.createElement('textarea');
                    ta.value = copyText;
                    ta.setAttribute('readonly', '');
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    ta.setSelectionRange(0, ta.value.length);
                    const ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                    if (ok) {
                        setCopiedState();
                    }
                } catch (_) { }
            });
        }

        await new Promise(resolve => {
            modalEl.addEventListener('hidden.bs.modal', () => {
                modalEl.remove();
                this._cleanupModalArtifacts();
                resolve();
            }, { once: true });
            modal.show();
        });
    },

    _projectHasFileNamed(targetFileName) {
        const wanted = String(targetFileName || '').trim().toLowerCase();
        if (!wanted || !loadFolder || !Array.isArray(loadFolder.fileStructure)) {
            return false;
        }
        return loadFolder.fileStructure.some(file =>
            file &&
            file.kind === 'file' &&
            String(file.name || '').trim().toLowerCase() === wanted
        );
    },

    _normalizeScriptSrc(value) {
        return String(value || '')
            .trim()
            .split('#')[0]
            .split('?')[0]
            .replace(/\\/g, '/');
    },

    _getScriptFileNameFromSrc(value) {
        const normalized = this._normalizeScriptSrc(value);
        if (!normalized) return '';
        const parts = normalized.split('/').filter(Boolean);
        return (parts.pop() || '').toLowerCase();
    },

    _collectToolScriptRefs(contents) {
        const refs = {
            devconsole: [],
            testrecorder: []
        };
        const addRef = rawSrc => {
            const src = String(rawSrc || '').trim();
            if (!src) return;
            const fileName = this._getScriptFileNameFromSrc(src);
            if (fileName === 'devconsole.js') {
                refs.devconsole.push(src);
            } else if (fileName === 'testrecorder.js') {
                refs.testrecorder.push(src);
            }
        };

        try {
            if (typeof DOMParser === 'function') {
                const doc = new DOMParser().parseFromString(String(contents || ''), 'text/html');
                const scriptNodes = Array.from(doc.querySelectorAll('script[src]'));
                scriptNodes.forEach(node => addRef(node.getAttribute('src')));
            }
        } catch (_) { }

        return refs;
    },

    _buildRecoverableToolScriptRemovals(previousContents, nextContents) {
        const previousRefs = this._collectToolScriptRefs(previousContents);
        const nextRefs = this._collectToolScriptRefs(nextContents);
        const recoverable = [];

        const checks = [
            { key: 'devconsole', fileName: 'devconsole.js', displayName: 'Dev Console', fallbackSrc: 'devconsole.js', placement: 'head' },
            { key: 'testrecorder', fileName: 'testRecorder.js', displayName: 'Test Recorder', fallbackSrc: 'testRecorder.js', placement: 'body-end' }
        ];

        for (const check of checks) {
            const hadBefore = Array.isArray(previousRefs[check.key]) && previousRefs[check.key].length > 0;
            const hasNow = Array.isArray(nextRefs[check.key]) && nextRefs[check.key].length > 0;
            if (!hadBefore || hasNow) continue;
            if (!this._projectHasFileNamed(check.fileName)) continue;

            const recoveredSrc = previousRefs[check.key][0] || check.fallbackSrc;
            recoverable.push({
                key: check.key,
                displayName: check.displayName,
                src: recoveredSrc,
                placement: check.placement
            });
        }

        return recoverable;
    },

    _insertToolScriptsIntoHtml(contents, scriptEntries) {
        if (!Array.isArray(scriptEntries) || scriptEntries.length === 0) {
            return String(contents || '');
        }

        const uniqueBySrc = new Map();
        scriptEntries.forEach(entry => {
            const src = String(entry?.src || '').trim();
            if (!src) return;
            const key = src.toLowerCase();
            if (!uniqueBySrc.has(key)) {
                uniqueBySrc.set(key, {
                    src,
                    placement: String(entry?.placement || '').toLowerCase()
                });
            }
        });

        if (uniqueBySrc.size === 0) {
            return String(contents || '');
        }

        let source = String(contents || '');
        const entries = Array.from(uniqueBySrc.values());

        const headEntries = entries.filter(item => item.placement === 'head');
        const tailEntries = entries.filter(item => item.placement !== 'head');

        if (headEntries.length > 0) {
            const headTags = headEntries.map(item => `    <script src="${item.src}"></script>`);
            const headInsert = `\n${headTags.join('\n')}`;
            if (/(<head[^>]*>)/i.test(source)) {
                source = source.replace(/(<head[^>]*>)/i, `$1${headInsert}`);
            } else {
                tailEntries.push(...headEntries);
            }
        }

        if (tailEntries.length === 0) {
            return source;
        }

        const tailTags = tailEntries.map(item => `    <script src="${item.src}"></script>`);
        const tailInsert = `\n${tailTags.join('\n')}\n`;

        if (/<\/body\s*>/i.test(source)) {
            return source.replace(/<\/body\s*>/i, match => `${tailInsert}${match}`);
        }
        if (/<\/html\s*>/i.test(source)) {
            return source.replace(/<\/html\s*>/i, match => `${tailInsert}${match}`);
        }
        return `${source.replace(/\s*$/, '')}${tailInsert}`;
    },

    _ensureToolScriptRecoveryModalStyle() {
        if (document.getElementById('forge-tool-script-recovery-modal-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'forge-tool-script-recovery-modal-style';
        style.textContent = `
            #forge-tool-script-recovery-modal .modal-content {
                background: #1f252a;
                color: #e9ecef;
                border: 1px solid #3a434a;
            }
            #forge-tool-script-recovery-modal .modal-header,
            #forge-tool-script-recovery-modal .modal-footer {
                border-color: #3a434a;
            }
            #forge-tool-script-recovery-modal code {
                color: #9ad9ff;
            }
        `;
        document.head.appendChild(style);
    },

    async _showToolScriptRecoveryModal(details) {
        const removedScripts = Array.isArray(details?.removedScripts) ? details.removedScripts : [];
        if (removedScripts.length === 0) return false;

        const fileNameRaw = String(details?.fileName || 'index.html');
        const modalApi = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal : null;
        if (!modalApi) {
            const labels = removedScripts.map(item => item.displayName).join(', ');
            return confirm(
                `${fileNameRaw} removed ${labels} script tag(s) from the previous saved version.\n\n` +
                `This often happens when code comes from an older chat that did not include these tools.\n\n` +
                `Re-add these script tag(s) before saving?`
            );
        }

        this._ensureToolScriptRecoveryModalStyle();

        const modalId = 'forge-tool-script-recovery-modal';
        const existing = document.getElementById(modalId);
        if (existing && existing.classList.contains('show')) {
            return false;
        }
        this._removeModalById(modalId);

        const fileName = this._escapeHtml(fileNameRaw);
        const listHtml = removedScripts
            .map(item => `<li><code>&lt;script src="${this._escapeHtml(String(item.src || ''))}"&gt;&lt;/script&gt;</code> (${this._escapeHtml(item.displayName || 'Tool script')})</li>`)
            .join('');

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Restore Tool Scripts?</h5>
                        </div>
                        <div class="modal-body">
                            <p class="mb-2"><code>${fileName}</code> removed these script tag(s) compared to the last saved version:</p>
                            <ul class="mb-3">${listHtml}</ul>
                            <p class="mb-0"><small>This commonly happens when code is generated from a chat started before these tools were added. Re-add them before saving?</small></p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="forge-tool-script-keep-removed-btn">Keep Removed</button>
                            <button type="button" class="btn btn-primary" id="forge-tool-script-restore-btn">Re-add and Save</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return false;

        const modal = new modalApi(modalEl, { backdrop: 'static', keyboard: false });
        const restoreBtn = modalEl.querySelector('#forge-tool-script-restore-btn');
        const keepBtn = modalEl.querySelector('#forge-tool-script-keep-removed-btn');
        let accepted = false;

        if (restoreBtn) {
            restoreBtn.addEventListener('click', () => {
                accepted = true;
                modal.hide();
            });
        }
        if (keepBtn) {
            keepBtn.addEventListener('click', () => {
                accepted = false;
                modal.hide();
            });
        }

        await new Promise(resolve => {
            modalEl.addEventListener('hidden.bs.modal', () => {
                modalEl.remove();
                this._cleanupModalArtifacts();
                resolve();
            }, { once: true });
            modal.show();
        });

        return accepted;
    },

    async _maybeRecoverToolScriptTags(uuid, contents) {
        const meta = this._meta[uuid];
        if (!meta || !this._isHtmlFileName(meta.name)) {
            return String(contents || '');
        }

        const previousContents = String(meta.text || '');
        const currentContents = String(contents || '');
        if (!previousContents || previousContents === currentContents) {
            return currentContents;
        }

        const recoverable = this._buildRecoverableToolScriptRemovals(previousContents, currentContents);
        if (recoverable.length === 0) {
            return currentContents;
        }

        const accepted = await this._showToolScriptRecoveryModal({
            fileName: meta.name || 'index.html',
            removedScripts: recoverable
        });
        if (!accepted) {
            return currentContents;
        }

        return this._insertToolScriptsIntoHtml(currentContents, recoverable);
    },

    _normalizeProjectPath(path) {
        const parts = String(path || '').replace(/\\/g, '/').split('/');
        const out = [];
        for (const raw of parts) {
            const part = raw.trim();
            if (!part || part === '.') continue;
            if (part === '..') {
                if (out.length > 0) out.pop();
                continue;
            }
            out.push(part);
        }
        return out.join('/');
    },

    _isLocalAssetReference(ref) {
        const value = String(ref || '').trim();
        if (!value) return false;
        if (value.startsWith('#')) return false;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return false;
        return true;
    },

    _isJavaScriptPath(path) {
        return /\.(?:js|mjs|cjs)$/i.test(String(path || ''));
    },

    _isSecurityPolicyAbortError(error) {
        const name = String((error && error.name) || '');
        const msg = String((error && error.message) || '').toLowerCase();
        return name === 'AbortError' && msg.includes('security policy');
    },

    _hasTransientUserActivation() {
        try {
            return !!(navigator && navigator.userActivation && navigator.userActivation.isActive);
        } catch (_) {
            return false;
        }
    },

    _isSecurityHeadersRuntime() {
        try {
            const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
            const content = String(meta?.getAttribute('content') || '').toLowerCase();
            return content.includes("default-src 'none'");
        } catch (_) {
            return false;
        }
    },

    async _writeViaExplicitSavePicker(uuid, meta, contents) {
        if (typeof window.showSaveFilePicker !== 'function') return false;
        if (!this._hasTransientUserActivation()) return false;

        const contentsToWrite = this._prepareContentsForDisk(meta?.name, contents);
        const options = {
            suggestedName: String(meta?.name || 'file.js'),
            excludeAcceptAllOption: false
        };
        if (this._isJavaScriptPath(meta?.name)) {
            options.types = [{
                description: 'JavaScript',
                accept: {
                    'text/javascript': ['.js', '.mjs', '.cjs'],
                    'application/javascript': ['.js', '.mjs', '.cjs']
                }
            }];
        }

        try {
            if (loadFolder && loadFolder.fileHandle && loadFolder.fileHandle.kind === 'directory') {
                options.startIn = loadFolder.fileHandle;
            }
        } catch (_) { }

        const pickedHandle = await window.showSaveFilePicker(options);
        if (!pickedHandle || typeof pickedHandle.createWritable !== 'function') return false;

        const writable = await pickedHandle.createWritable();
        let writeSucceeded = false;
        try {
            await writable.write(contentsToWrite);
            writeSucceeded = true;
        } finally {
            if (writeSucceeded) {
                await writable.close();
            } else if (typeof writable.abort === 'function') {
                try { await writable.abort(); } catch (_) { }
            } else {
                try { await writable.close(); } catch (_) { }
            }
        }

        meta.entry = pickedHandle;
        if (pickedHandle.name && pickedHandle.name !== meta.name) {
            meta.name = pickedHandle.name;
            meta.relativePath = [...(meta.path || []), pickedHandle.name].join('/');
            const currentFile = loadFolder && Array.isArray(loadFolder.fileStructure)
                ? loadFolder.fileStructure.find(f => f && f.uuid === uuid)
                : null;
            if (currentFile) {
                currentFile.name = pickedHandle.name;
                currentFile.type = String(pickedHandle.name).includes('.')
                    ? String(pickedHandle.name).split('.').pop()
                    : '';
                currentFile.relativePath = meta.relativePath;
                currentFile.entry = pickedHandle;
                if (typeof loadFolder._updateSignature === 'function') {
                    loadFolder._updateSignature();
                }
                if (typeof loadFolder.refreshFileTree === 'function') {
                    loadFolder.refreshFileTree();
                }
            }
        } else {
            const currentFile = loadFolder && Array.isArray(loadFolder.fileStructure)
                ? loadFolder.fileStructure.find(f => f && f.uuid === uuid)
                : null;
            if (currentFile) currentFile.entry = pickedHandle;
        }

        return true;
    },

    _isCssPath(path) {
        return /\.css$/i.test(String(path || ''));
    },

    _isTrackedTreeStatusFile(path) {
        return this._isHtmlFileName(path)
            || this._isJavaScriptPath(path)
            || this._isCssPath(path);
    },

    _isTreeEmptyContent(contents) {
        return String(contents || '').trim().length === 0;
    },

    _shouldRefreshTreeAfterSave(path, previousContents, nextContents) {
        if (!this._isTrackedTreeStatusFile(path)) {
            return false;
        }
        if (this._isHtmlFileName(path)) {
            return true;
        }
        return this._isTreeEmptyContent(previousContents) !== this._isTreeEmptyContent(nextContents);
    },

    _resolveHtmlReferencePath(ref, baseDirParts = []) {
        if (!this._isLocalAssetReference(ref)) return null;
        const value = String(ref || '').trim().split('#')[0].split('?')[0].trim();
        if (!value) return null;
        if (value.startsWith('/')) {
            return this._normalizeProjectPath(value.replace(/^\/+/, ''));
        }
        return this._normalizeProjectPath([...baseDirParts, value].join('/'));
    },

    _collectHtmlReferenceAudit(uuid, contents) {
        const meta = this._meta[uuid];
        if (!meta) return null;
        const fileName = meta.name || 'HTML file';
        if (!this._isHtmlFileName(fileName)) return null;

        const baseDirParts = Array.isArray(meta.path) ? meta.path.slice() : [];
        const referenced = new Map();
        const addRef = (rawRef, type) => {
            const resolved = this._resolveHtmlReferencePath(rawRef, baseDirParts);
            if (!resolved) return;
            if (type === 'js' && !this._isJavaScriptPath(resolved)) return;
            if (type === 'css' && !this._isCssPath(resolved)) return;
            const key = resolved.toLowerCase();
            if (!referenced.has(key)) {
                referenced.set(key, {
                    type,
                    rawRef: String(rawRef || '').trim(),
                    projectPath: resolved
                });
            }
        };

        try {
            if (typeof DOMParser === 'function') {
                const doc = new DOMParser().parseFromString(contents, 'text/html');
                const scriptNodes = Array.from(doc.querySelectorAll('script[src]'));
                scriptNodes.forEach(node => {
                    const src = node.getAttribute('src');
                    if (src) addRef(src, 'js');
                });

                const linkNodes = Array.from(doc.querySelectorAll('link[href]'));
                linkNodes.forEach(node => {
                    const href = node.getAttribute('href');
                    if (!href) return;
                    const rel = String(node.getAttribute('rel') || '').toLowerCase();
                    const isStylesheet = rel.split(/\s+/).includes('stylesheet') || this._isCssPath(href);
                    if (!isStylesheet) return;
                    addRef(href, 'css');
                });
            }
        } catch (e) {
            console.warn('HTML reference scan parser failed:', e);
        }

        const existing = new Map();
        for (const file of (loadFolder.fileStructure || [])) {
            if (!file || file.kind !== 'file') continue;
            const rel = this._normalizeProjectPath(file.relativePath || '');
            if (!rel) continue;
            let type = '';
            if (this._isJavaScriptPath(rel)) type = 'js';
            else if (this._isCssPath(rel)) type = 'css';
            if (!type) continue;
            existing.set(rel.toLowerCase(), { type, relativePath: rel });
        }

        const missingReferenced = [];
        for (const ref of referenced.values()) {
            if (!existing.has(ref.projectPath.toLowerCase())) {
                missingReferenced.push(ref);
            }
        }

        const unreferencedExisting = [];
        for (const file of existing.values()) {
            if (!referenced.has(file.relativePath.toLowerCase())) {
                unreferencedExisting.push(file);
            }
        }

        if (missingReferenced.length === 0 && unreferencedExisting.length === 0) {
            return null;
        }

        return {
            fileName,
            missingReferenced,
            unreferencedExisting
        };
    },

    _templateForReferencedAsset(type, projectPath) {
        if (type === 'js') {
            return `// Placeholder file created by Forge\n// Referenced by HTML: ${projectPath}\n`;
        }
        if (type === 'css') {
            return `/* Placeholder file created by Forge. Referenced by HTML: ${projectPath} */\n`;
        }
        return '';
    },

    async _createMissingReferencedFiles(missingReferenced) {
        const result = { created: 0, failed: [] };
        if (!loadFolder || !loadFolder.fileHandle || !Array.isArray(missingReferenced)) {
            return result;
        }

        for (const ref of missingReferenced) {
            try {
                const rel = this._normalizeProjectPath(ref.projectPath || '');
                if (!rel) throw new Error('Invalid path');
                const parts = rel.split('/').filter(Boolean);
                const fileName = parts.pop();
                if (!fileName) throw new Error('Invalid file name');

                let dir = loadFolder.fileHandle;
                for (const part of parts) {
                    dir = await dir.getDirectoryHandle(part, { create: true });
                }

                const fileHandle = await dir.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                let writeSucceeded = false;
                try {
                    await writable.write(this._templateForReferencedAsset(ref.type, rel));
                    writeSucceeded = true;
                } finally {
                    if (writeSucceeded) {
                        await writable.close();
                    } else if (typeof writable.abort === 'function') {
                        try { await writable.abort(); } catch { }
                    } else {
                        try { await writable.close(); } catch { }
                    }
                }
                result.created += 1;
            } catch (e) {
                result.failed.push({ ref, error: e });
            }
        }

        if (result.created > 0) {
            if (typeof loadFolder.syncFileStructure === 'function') {
                await loadFolder.syncFileStructure({ reason: 'create-missing-references' });
            } else {
                loadFolder.fileStructure = await loadFolder.recursivelyReadDirectory([], loadFolder.fileHandle);
                if (typeof loadFolder._updateSignature === 'function') {
                    loadFolder._updateSignature();
                }
                loadFolder.refreshFileTree();
            }
        }

        return result;
    },

    _ensureHtmlReferenceAuditModalStyle() {
        if (document.getElementById('forge-html-reference-audit-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'forge-html-reference-audit-style';
        style.textContent = `
            #forge-html-reference-audit-modal .modal-content {
                background: #1f252a;
                color: #e9ecef;
                border: 1px solid #3a434a;
            }
            #forge-html-reference-audit-modal .modal-header,
            #forge-html-reference-audit-modal .modal-footer {
                border-color: #3a434a;
            }
            #forge-html-reference-audit-modal code {
                color: #9ad9ff;
            }
        `;
        document.head.appendChild(style);
    },

    _clearHtmlReferenceTopWarning() {
        const el = document.getElementById('forge-html-reference-top-warning');
        if (el) el.remove();
        this._lastIndexReferenceAudit = null;
    },

    _showHtmlReferenceTopWarning(audit) {
        if (!audit) return;
        const hasMissing = Array.isArray(audit.missingReferenced) && audit.missingReferenced.length > 0;
        const hasUnreferenced = Array.isArray(audit.unreferencedExisting) && audit.unreferencedExisting.length > 0;
        if (!hasMissing && !hasUnreferenced) {
            this._clearHtmlReferenceTopWarning();
            return;
        }

        this._lastIndexReferenceAudit = audit;

        const fileName = this._escapeHtml(audit.fileName || 'index.html');
        const missingCount = hasMissing ? audit.missingReferenced.length : 0;
        const unrefCount = hasUnreferenced ? audit.unreferencedExisting.length : 0;
        const parts = [];
        if (missingCount > 0) parts.push(`${missingCount} missing referenced file(s)`);
        if (unrefCount > 0) parts.push(`${unrefCount} unreferenced JS/CSS file(s)`);
        const summary = parts.join(' | ');

        const warningHtml = `
            <div id="forge-html-reference-top-warning" class="alert alert-warning alert-dismissible fade show mb-0 py-2 px-3 d-flex align-items-center flex-wrap" role="alert" style="font-size: 0.85rem; border-radius: 0;">
                <div>
                    <strong>Reference Warning:</strong> <code>${fileName}</code> has ${summary}.
                </div>
                <button type="button" class="btn btn-sm btn-outline-dark ms-2" id="forge-html-reference-view-details">Details</button>
                <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert" aria-label="Close" style="padding: 0.5rem;"></button>
            </div>
        `;

        const existing = document.getElementById('forge-html-reference-top-warning');
        if (existing) {
            existing.outerHTML = warningHtml;
        } else {
            const container = document.querySelector('.container-fluid');
            if (container) {
                container.insertAdjacentHTML('afterbegin', warningHtml);
            } else {
                document.body.insertAdjacentHTML('afterbegin', warningHtml);
            }
        }

        const detailsBtn = document.getElementById('forge-html-reference-view-details');
        if (detailsBtn) {
            detailsBtn.addEventListener('click', async () => {
                if (!this._lastIndexReferenceAudit) return;
                await this._showHtmlReferenceAuditModal(this._lastIndexReferenceAudit);
            });
        }
    },

    async _handleIndexHtmlReferenceAudit(audit) {
        if (!audit) {
            this._clearHtmlReferenceTopWarning();
            return;
        }

        if (!this._hasShownIndexReferenceAuditModal) {
            this._hasShownIndexReferenceAuditModal = true;
            await this._showHtmlReferenceAuditModal(audit);
            return;
        }

        this._showHtmlReferenceTopWarning(audit);
    },

    async _showHtmlReferenceAuditModal(audit) {
        if (!audit) return;
        const hasMissing = Array.isArray(audit.missingReferenced) && audit.missingReferenced.length > 0;
        const hasUnreferenced = Array.isArray(audit.unreferencedExisting) && audit.unreferencedExisting.length > 0;
        if (!hasMissing && !hasUnreferenced) return;

        const modalApi = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal : null;
        if (!modalApi) {
            const missingCount = hasMissing ? audit.missingReferenced.length : 0;
            const unrefCount = hasUnreferenced ? audit.unreferencedExisting.length : 0;
            alert(`HTML reference check for ${audit.fileName}\nMissing referenced files: ${missingCount}\nUnreferenced JS/CSS files: ${unrefCount}`);
            return;
        }

        this._ensureHtmlReferenceAuditModalStyle();

        const modalId = 'forge-html-reference-audit-modal';
        const existing = document.getElementById(modalId);
        if (existing && existing.classList.contains('show')) {
            return;
        }
        this._removeModalById(modalId);

        const fileName = this._escapeHtml(audit.fileName || 'HTML file');
        const missingList = (audit.missingReferenced || [])
            .map(ref => `<li><code>${this._escapeHtml(ref.projectPath)}</code></li>`)
            .join('');
        const unrefList = (audit.unreferencedExisting || [])
            .map(file => `<li><code>${this._escapeHtml(file.relativePath)}</code></li>`)
            .join('');

        const missingSection = hasMissing ? `
            <div class="mb-3">
                <p class="mb-1">Referenced JS/CSS files not found in your folder:</p>
                <ul class="mb-2">${missingList}</ul>
                <p class="mb-0"><small>Would you like Forge to create these files now?</small></p>
            </div>
        ` : '';

        const unreferencedSection = hasUnreferenced ? `
            <div class="mb-1">
                <p class="mb-1">These JS/CSS files exist in your folder but are not referenced in <code>${fileName}</code>:</p>
                <ul class="mb-2">${unrefList}</ul>
                <p class="mb-0"><small>These might be incorrectly named or no longer needed. Forge will not delete them.</small></p>
            </div>
        ` : '';

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">HTML Reference Check</h5>
                        </div>
                        <div class="modal-body">
                            <p class="mb-2">Saved <code>${fileName}</code>. Here is a quick dependency check:</p>
                            ${missingSection}
                            ${unreferencedSection}
                            <div id="forge-html-reference-audit-status" class="small mt-2"></div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            ${hasMissing ? '<button type="button" class="btn btn-primary" id="forge-create-missing-assets-btn">Create Missing Files</button>' : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return;

        const modal = new modalApi(modalEl, { backdrop: 'static', keyboard: false });
        const createBtn = modalEl.querySelector('#forge-create-missing-assets-btn');
        const statusEl = modalEl.querySelector('#forge-html-reference-audit-status');

        if (createBtn) {
            createBtn.addEventListener('click', async () => {
                createBtn.disabled = true;
                if (statusEl) {
                    statusEl.textContent = 'Creating missing files...';
                    statusEl.className = 'small mt-2 text-info';
                }
                const outcome = await this._createMissingReferencedFiles(audit.missingReferenced || []);
                if (statusEl) {
                    if (outcome.failed.length === 0) {
                        statusEl.textContent = `Created ${outcome.created} file(s).`;
                        statusEl.className = 'small mt-2 text-success';
                    } else {
                        statusEl.textContent = `Created ${outcome.created} file(s). Failed to create ${outcome.failed.length} file(s).`;
                        statusEl.className = 'small mt-2 text-warning';
                    }
                }
            });
        }

        await new Promise(resolve => {
            modalEl.addEventListener('hidden.bs.modal', () => {
                modalEl.remove();
                this._cleanupModalArtifacts();
                resolve();
            }, { once: true });
            modal.show();
        });
    },

    _getValue(uuid) {
        const view = this._getView(uuid);
        return view ? view.state.doc.toString() : '';
    },

    setValue(uuid, content) {
        const view = this._getView(uuid);
        if (!view) return;
        // Ensure unshipped banner is present for HTML files
        const meta = this._meta[uuid];
        const prepared = (meta && this._isHtmlFileName(meta.name))
            ? this.ensureUnshippedBanner(content, meta.name, meta)
            : content;
        const current = view.state.doc.toString();
        if (current === prepared) return;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: prepared }
        });
    },

    /**
     * Destroy and recreate the CM6 view for an open tab by re-reading the
     * file from disk.  This is the reliable way to ensure the editor UI
     * reflects whatever was last written, regardless of hidden-tab rendering
     * quirks in CodeMirror 6.
     */
    async reloadTab(uuid) {
        const meta = this._meta[uuid];
        if (!meta || !meta.entry) return false;

        const oldView = this.instance[uuid];
        if (!oldView) return false;

        const parent = oldView.dom
            ? oldView.dom.parentElement
            : document.getElementById('editor-' + uuid);
        if (!parent) return false;

        try {
            // Re-read from disk (handle may be stale after file-tree refresh)
            let fh;
            try {
                fh = await meta.entry.getFile();
            } catch (_refreshErr) {
                const ok = await this._refreshFileHandleFromMeta(meta);
                if (!ok) return false;
                fh = await meta.entry.getFile();
            }
            const content = await fh.text();
            const editorContent = this._prepareContentsForEditor(meta.name, content);

            // If content already matches the live view, just update bookkeeping
            if (oldView.state.doc.toString() === editorContent) {
                meta.text = content;
                this.dirtyFiles.delete(uuid);
                this._setStatus(uuid, 'Saved', 'saved');
                return true;
            }

            // Tear down old view (removes its DOM from parent)
            if (typeof oldView.destroy === 'function') {
                oldView.destroy();
            }

            // Rebuild with fresh content in the same container
            const cm = await this._ensureCodeMirror();
            const ext = (meta.name.split('.').pop() || '').toLowerCase();
            const language = this._resolveLanguage(ext);

            const extensions = [
                cm.basicSetup,
                cm.EditorView.lineWrapping
            ];
            if (cm.oneDark) extensions.push(cm.oneDark);
            extensions.push(
                cm.materialLikeTheme,
                ...cm.searchKeymapExtensions,
                ...cm.foldKeymapExtensions,
                ...cm.ctrlQFoldKeymap,
                ...this._languageExtensions(language, cm),
                cm.EditorView.updateListener.of(update => {
                    if (!update.docChanged) return;
                    this.dirtyFiles.add(uuid);
                    this._setStatus(uuid, 'Edited', null);
                    $("#saveButton")
                        .removeClass("btn-outline-primary btn-outline-success")
                        .addClass("btn-outline-danger");
                    this._scheduleAutoSave();
                })
            );
            if (ext === 'js') {
                extensions.push(...cm.getJsLinterExtensions());
            }

            const state = cm.EditorState.create({
                doc: editorContent,
                extensions
            });

            const newView = new cm.EditorView({
                state,
                parent
            });

            this.instance[uuid] = newView;
            meta.text = content;
            this.dirtyFiles.delete(uuid);
            this._setStatus(uuid, 'Saved', 'saved');
            return true;
        } catch (e) {
            console.warn('reloadTab failed for', uuid, e);
            return false;
        }
    },

    _resolveLanguage(ext) {
        switch (ext) {
            case 'js':
                return 'javascript';
            case 'json':
                return 'json';
            case 'html':
                return 'html';
            case 'css':
                return 'css';
            case 'py':
                return 'python';
            default:
                return 'plaintext';
        }
    },

    _languageExtensions(language, cm) {
        switch (language) {
            case 'javascript':
                return cm.javascript ? [cm.javascript({ jsx: true })] : [];
            case 'json':
                return cm.javascript ? [cm.javascript({ json: true })] : [];
            case 'html':
                return cm.html ? [cm.html()] : [];
            case 'css':
                return cm.css ? [cm.css()] : [];
            case 'python':
                return cm.python ? [cm.python()] : [];
            default:
                return [];
        }
    },

    async _ensureCodeMirror() {
        if (this._cm) return this._cm;
        if (!this._cmReady) {
            const globalReady = window.cmModulesReady
                ? window.cmModulesReady
                : (window.cmModules ? Promise.resolve(window.cmModules) : null);

            if (!globalReady) {
                this._cmReady = Promise.reject(new Error('CodeMirror modules were not loaded from index.html'));
            } else {
                this._cmReady = globalReady.then(modules => {
                    if (!modules) {
                        throw new Error('CodeMirror modules failed to initialize');
                    }
                    return modules;
                });
            }
        }

        this._cm = await this._cmReady;
        return this._cm;
    },

    async _refreshFileHandleFromMeta(meta) {
        // Re-acquire a fresh handle based on stored path/name (used if original handle gets stale)
        try {
            let dir = loadFolder.fileHandle;
            for (const part of meta.path) {
                dir = await dir.getDirectoryHandle(part);
            }
            const newHandle = await dir.getFileHandle(meta.name);
            meta.entry = newHandle;
            return true;
        } catch (e) {
            console.warn('Failed to refresh file handle for', meta.relativePath, e);
            return false;
        }
    },

    // ---- SIMPLE, DIRECT WRITE USING STABLE TAB META ----
    async _writeDirect(uuid, contents) {
        const meta = this._meta[uuid];
        if (!meta) {
            this._setStatus(uuid, 'Unavailable', 'error');
            return false;
        }

        const contentsToWrite = this._prepareContentsForDisk(meta.name, contents);
        const validation = this._validateHtmlBeforeSave(uuid, contents);
        if (!validation.ok) {
            throw new Error(validation.message || 'Invalid HTML');
        }

        // If unchanged vs our snapshot, skip disk I/O.
        if (contentsToWrite === meta.text) {
            this.dirtyFiles.delete(uuid);
            this._setStatus(uuid, 'Saved', 'saved');
            return false;
        }

        const writeWithOptions = async (createWritableOptions, inPlaceWrite) => {
            const writable = await meta.entry.createWritable(createWritableOptions || {});
            let writeSucceeded = false;
            try {
                if (inPlaceWrite) {
                    await writable.write({ type: 'write', position: 0, data: contentsToWrite });
                    await writable.truncate(contentsToWrite.length);
                } else {
                    await writable.write(contentsToWrite);
                }
                writeSucceeded = true;
            } finally {
                if (writeSucceeded) {
                    await writable.close();
                } else if (typeof writable.abort === 'function') {
                    try { await writable.abort(); } catch { }
                } else {
                    try { await writable.close(); } catch { }
                }
            }
        };

        let attemptedRefresh = false;
        let attemptedSecurityPolicyFallback = false;
        let attemptedExplicitPickerFallback = false;
        let attemptedTxtBounceFallback = false;
        for (; ;) {
            try {
                await writeWithOptions({}, false);
                break;
            } catch (e) {
                if (
                    !attemptedSecurityPolicyFallback &&
                    this._isJavaScriptPath(meta.name) &&
                    this._isSecurityPolicyAbortError(e)
                ) {
                    attemptedSecurityPolicyFallback = true;
                    try {
                        await writeWithOptions({ keepExistingData: true }, true);
                        break;
                    } catch {
                        // Fall through to existing refresh/error handling path.
                    }
                }

                if (
                    !attemptedExplicitPickerFallback &&
                    this._isJavaScriptPath(meta.name) &&
                    this._isSecurityPolicyAbortError(e)
                ) {
                    attemptedExplicitPickerFallback = true;
                    try {
                        const saved = await this._writeViaExplicitSavePicker(uuid, meta, contents);
                        if (saved) break;
                    } catch {
                        // Fall through to existing refresh/error handling path.
                    }
                }

                if (!attemptedTxtBounceFallback && this._isJavaScriptPath(meta.name)) {
                    attemptedTxtBounceFallback = true;
                    try {
                        let dir = loadFolder.fileHandle;
                        for (const part of (meta.path || [])) {
                            dir = await dir.getDirectoryHandle(part);
                        }

                        // 1) delete the current .js file
                        await dir.removeEntry(meta.name);

                        // 2) create a file with the same name but .txt
                        const txtName = meta.name.replace(/\.[^/.]+$/, ".txt");
                        const tempHandle = await dir.getFileHandle(txtName, { create: true });

                        // 3) saves the new content to this .txt file
                        const writable = await tempHandle.createWritable();
                        await writable.write(contents);
                        await writable.close();

                        // 4) changes the extension to .js
                        let finalHandle;
                        if (typeof tempHandle.move === 'function') {
                            await tempHandle.move(meta.name);
                            finalHandle = tempHandle;
                        } else {
                            finalHandle = await dir.getFileHandle(meta.name, { create: true });
                            const jsWritable = await finalHandle.createWritable();
                            await jsWritable.write(contents);
                            await jsWritable.close();
                            await dir.removeEntry(txtName);
                        }

                        meta.entry = finalHandle;
                        if (window.loadFolder && Array.isArray(window.loadFolder.fileStructure)) {
                            const f = window.loadFolder.fileStructure.find(x => x && x.uuid === uuid);
                            if (f) {
                                f.entry = finalHandle;
                            }
                        }
                        break;
                    } catch (bounceErr) {
                        console.warn('TXT bounce fallback failed:', bounceErr);
                        // Fall through to existing error handling
                    }
                }

                const name = (e && e.name) || '';
                const isStale =
                    name === 'InvalidStateError' ||
                    name === 'NotFoundError' ||
                    name === 'NoModificationAllowedError';
                if (!attemptedRefresh && isStale) {
                    attemptedRefresh = true;
                    const ok = await this._refreshFileHandleFromMeta(meta);
                    if (ok) continue;
                }
                throw e;
            }
        }

        // Update snapshot & UI.
        meta.text = contentsToWrite;
        this.dirtyFiles.delete(uuid);
        this._setStatus(uuid, 'Saved', 'saved');
        return true;
    },

    async saveCurrent() {
        const uuid = this.getActiveUuid();
        if (!uuid) return;

        const view = this._getView(uuid);
        if (!view) return;

        // If the tab lost its meta due to some unexpected flow, don't leave "Saving…" stuck
        if (!this._meta[uuid]) {
            this._setStatus(uuid, 'Unavailable', 'error');
            return;
        }

        let contents = view.state.doc.toString();

        const recoveredContents = await this._maybeRecoverToolScriptTags(uuid, contents);
        if (recoveredContents !== contents) {
            this.setValue(uuid, recoveredContents);
            contents = recoveredContents;
        }

        const preparedContents = this._prepareContentsForDisk(this._meta[uuid]?.name, contents);
        const previousSavedContents = this._meta[uuid].text;
        if (preparedContents === this._meta[uuid].text) {
            this.dirtyFiles.delete(uuid);
            this._setStatus(uuid, 'Saved', 'saved');
            return;
        }

        const btn = $("#saveButton");
        const validation = this._validateHtmlBeforeSave(uuid, contents);
        if (!validation.ok) {
            if (btn.length) {
                btn.removeClass("btn-outline-primary btn-outline-success").addClass("btn-outline-danger").text('Save All (Ctrl+S)');
            }
            await this._showInvalidHtmlModal(validation);
            return;
        }

        if (btn.length) btn.prop('disabled', true).text('Saving...');

        this._setStatus(uuid, 'Saving…', 'saving');

        try {
            const didWrite = await this._writeDirect(uuid, contents);
            const savedName = this._meta[uuid]?.name || '';

            if (
                didWrite &&
                this._shouldRefreshTreeAfterSave(savedName, previousSavedContents, preparedContents) &&
                loadFolder &&
                typeof loadFolder.refreshFileTree === 'function'
            ) {
                loadFolder.refreshFileTree();
            }
            if (btn.length) {
                btn.removeClass("btn-outline-primary btn-outline-danger").addClass("btn-outline-success");
                setTimeout(() => btn.removeClass("btn-outline-success").addClass("btn-outline-primary").text('Save All (Ctrl+S)'), 300);
            }
            if (didWrite && this._isIndexHtmlFileName(savedName)) {
                const audit = this._collectHtmlReferenceAudit(uuid, contents);
                await this._handleIndexHtmlReferenceAudit(audit);
                try {
                    document.dispatchEvent(new CustomEvent('forge:index-html-saved', {
                        detail: { fileName: savedName, source: 'saveCurrent' }
                    }));
                } catch (_) { }
            }
            if (didWrite) {
                this._dispatchFileSaved(this._meta[uuid], 'saveCurrent');
            }
        } catch (e) {
            console.error('Save failed:', e);
            this._setStatus(uuid, 'Save error', 'error');
            if (btn.length) {
                btn.removeClass("btn-outline-primary btn-outline-success").addClass("btn-outline-danger").text('Save All (Ctrl+S)');
            }
        } finally {
            if (btn.length) btn.prop('disabled', false);
        }
    },

    async saveAll(options = {}) {
        const opts = {
            fromAutoSave: false,
            ...options
        };
        const invalidHtml = [];
        const saveErrors = [];
        const indexReferenceAudits = [];
        let shouldRefreshFileTree = false;

        for (let uuid in this.instance) {
            const meta = this._meta[uuid];
            const view = this._getView(uuid);
            if (!view) continue;

            if (!meta) {
                this._setStatus(uuid, 'Unavailable', 'error');
                saveErrors.push(`(unknown: ${uuid})`);
                continue;
            }

            let contents = view.state.doc.toString();

            const recoveredContents = await this._maybeRecoverToolScriptTags(uuid, contents);
            if (recoveredContents !== contents) {
                this.setValue(uuid, recoveredContents);
                contents = recoveredContents;
            }
            const validation = this._validateHtmlBeforeSave(uuid, contents);
            if (!validation.ok) {
                invalidHtml.push(validation);
                continue;
            }

            this._setStatus(uuid, 'Saving…', 'saving');
            try {
                const preparedContents = this._prepareContentsForDisk(meta.name, contents);
                const previousSavedContents = meta.text;
                const didWrite = await this._writeDirect(uuid, contents);
                if (didWrite && this._shouldRefreshTreeAfterSave(meta.name, previousSavedContents, preparedContents)) {
                    shouldRefreshFileTree = true;
                }
                if (didWrite) {
                    this._dispatchFileSaved(meta, opts.fromAutoSave ? 'autoSave' : 'saveAll');
                }
                if (!opts.fromAutoSave && didWrite && this._isIndexHtmlFileName(meta.name)) {
                    indexReferenceAudits.push(this._collectHtmlReferenceAudit(uuid, contents));
                    try {
                        document.dispatchEvent(new CustomEvent('forge:index-html-saved', {
                            detail: { fileName: meta.name, source: 'saveAll' }
                        }));
                    } catch (_) { }
                }
            } catch (e) {
                console.error('Save failed:', e);
                this._setStatus(uuid, 'Save error', 'error');
                saveErrors.push(meta.name || uuid);
            }
        }

        // change the #saveButton to success for 5 seconds then back to primary
        $("#saveButton").removeClass("btn-outline-primary")
        $("#saveButton").removeClass("btn-outline-danger")
        if (invalidHtml.length === 0 && saveErrors.length === 0) {
            $("#saveButton").addClass("btn-outline-success")
        } else {
            $("#saveButton").addClass("btn-outline-danger")
        }
        setTimeout(function () {
            $("#saveButton").removeClass("btn-outline-success")
            $("#saveButton").removeClass("btn-outline-danger")
            $("#saveButton").addClass("btn-outline-primary")
        }, 5000)

        if (shouldRefreshFileTree && loadFolder && typeof loadFolder.refreshFileTree === 'function') {
            loadFolder.refreshFileTree();
        }

        if (invalidHtml.length > 0 && !opts.fromAutoSave) {
            await this._showInvalidHtmlModal(invalidHtml[0], {
                extraSkippedCount: Math.max(0, invalidHtml.length - 1)
            });
        }
        if (!opts.fromAutoSave) {
            for (const audit of indexReferenceAudits) {
                await this._handleIndexHtmlReferenceAudit(audit);
            }
        }
        if (saveErrors.length > 0 && !opts.fromAutoSave) {
            const list = saveErrors.map(name => `- ${name}`).join('\n');
            alert(`Some files could not be saved due to write errors:\n\n${list}`);
        }
    }
};

// Make entire editor tab clickable to activate the file
try {
    $(document).on('click', '#editor-container .nav-tabs a.nav-link', function (e) {
        e.preventDefault();
        const id = $(this).attr('id') || '';
        if (!id.startsWith('nav-')) return;
        const uuid = id.substring(4);
        if (uuid) editor.openFile(uuid);
    });
    $(document).on('click', '#editor-container .nav-tabs .tab-close', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const uuid = $(this).data('uuid');
        if (uuid) editor.deleteTab(String(uuid));
    });
    $(document).on('keydown', '#editor-container .nav-tabs .tab-close', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault();
        const uuid = $(this).data('uuid');
        if (uuid) editor.deleteTab(String(uuid));
    });
} catch (_) { }

// Paste detection for auto-select/replace on large content changes
(function setupPasteHandler() {
    const LARGE_PASTE_THRESHOLD = 500; // chars
    const REPLACEMENT_RATIO = 0.5;     // 50% of file

    const insertPastedText = (view, pastedText) => {
        const from = view.state.selection.main.from;
        const to = view.state.selection.main.to;
        view.dispatch({
            changes: { from, to, insert: pastedText }
        });
    };

    const replaceEntireFile = (view, pastedText) => {
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: pastedText }
        });
    };

    document.addEventListener('paste', async function (e) {
        const activeUuid = editor.getActiveUuid();
        if (!activeUuid) return;

        // Ensure the paste is intended for the code editor area
        // (prevents interfering with other inputs like Sidebar search or other Tabs)
        if (!document.getElementById('editor').contains(e.target)) return;

        const view = editor.instance[activeUuid];
        if (!view) return;

        // Get pasted text
        const pastedText = (e.clipboardData || window.clipboardData)?.getData('text');
        if (!pastedText || !String(pastedText).trim()) return;

        const hasPendingAutoCheckpoint = typeof checkpointManager !== 'undefined'
            && checkpointManager
            && typeof checkpointManager.hasPendingPasteCheckpoint === 'function'
            && checkpointManager.hasPendingPasteCheckpoint();

        // Check if it looks like HTML content (full file paste)
        const looksLikeHtml = /^\s*<!DOCTYPE|^\s*<html|^\s*<head|^\s*<body/i.test(pastedText);
        const currentContent = view.state.doc.toString();
        const wouldReplaceSignificant = pastedText.length / Math.max(currentContent.length, 1) > REPLACEMENT_RATIO;
        const isLargePaste = pastedText.length >= LARGE_PASTE_THRESHOLD;

        if (hasPendingAutoCheckpoint) {
            e.preventDefault();
            e.stopPropagation();

            try {
                await checkpointManager.runPendingPasteCheckpoint();
            } catch (checkpointErr) {
                console.error('Auto-checkpoint before paste failed:', checkpointErr);
            }

            if (!isLargePaste || (!looksLikeHtml && !wouldReplaceSignificant)) {
                insertPastedText(view, pastedText);
                return;
            }

            const fileName = editor._meta[activeUuid]?.name || 'file';
            const choice = confirm(
                `You're pasting a large amount of content (${pastedText.length} chars).\n\n` +
                `Do you want to:\n` +
                `- OK = Replace entire ${fileName} with pasted content\n` +
                `- Cancel = Insert at cursor position normally`
            );

            if (choice) {
                replaceEntireFile(view, pastedText);
            } else {
                insertPastedText(view, pastedText);
            }
            return;
        }

        // Only trigger for significant pastes
        if (!isLargePaste || (!looksLikeHtml && !wouldReplaceSignificant)) return;

        // Prevent default paste
        e.preventDefault();
        e.stopPropagation();

        // Ask user what they want to do
        const fileName = editor._meta[activeUuid]?.name || 'file';
        const choice = confirm(
            `You're pasting a large amount of content (${pastedText.length} chars).\n\n` +
            `Do you want to:\n` +
            `- OK = Replace entire ${fileName} with pasted content\n` +
            `- Cancel = Insert at cursor position normally`
        );

        if (choice) {
            // Replace entire file
            replaceEntireFile(view, pastedText);
        } else {
            // Insert at cursor position
            insertPastedText(view, pastedText);
        }
    }, true);
})();

