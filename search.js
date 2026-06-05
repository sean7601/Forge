const search = {
    lastQuery: '',
    results: [],
    running: false,
    sidebarMode: 'files',

    init() {
        if (this._initialized) return;
        this._initialized = true;
        this._bindResultClickHandlers();
        this.setSidebarMode('files');
        this._renderIdleState();
    },

    onProjectLoaded() {
        $('#sidebar-mode-switch').css('display', 'flex');
        this.setSidebarMode('files');
        if (!this.lastQuery) {
            this._renderIdleState();
        }
    },

    setSidebarMode(mode, options = {}) {
        if (mode !== 'files' && mode !== 'search') return;

        this.sidebarMode = mode;
        $('[data-sidebar-mode]').each((_, button) => {
            const isActive = button.getAttribute('data-sidebar-mode') === mode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        $('#sidebar-files-panel').toggleClass('active', mode === 'files');
        $('#sidebar-search-panel').toggleClass('active', mode === 'search');

        if (mode === 'search' && options.focus) {
            setTimeout(() => document.getElementById('global-search-input')?.focus(), 0);
        }
    },

    async run() {
        this._clearReplaceStatus();
        if (!loadFolder.fileHandle) { return alert('Load a directory first.'); }

        const q = document.getElementById('global-search-input').value.trim();
        this.setSidebarMode('search');
        if (!q) {
            this.lastQuery = '';
            this.results = [];
            this._renderIdleState();
            return;
        }

        this.lastQuery = q;
        this.running = true;
        this.results = [];
        this._setBusyState(`Searching for "${this.escapeHtml(q)}"`, 'Scanning every file in the loaded project.');

        const needle = this.createRegex(q);
        for (const file of loadFolder.fileStructure) {
            if (file.kind !== 'file') continue;
            try {
                const text = await this._getCurrentFileText(file);
                const lines = text.split(/\r?\n/);
                const fileMatches = [];

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (needle.test(line)) {
                        fileMatches.push({
                            lineNumber: i + 1,
                            excerpt: this.highlight(line, needle, 220)
                        });
                        if (fileMatches.length >= 50) break;
                    }
                    needle.lastIndex = 0;
                }

                if (fileMatches.length) {
                    this.results.push({ file, matches: fileMatches });
                }
            } catch (e) {
                console.warn('Search read error for', file.name, e);
            }
        }

        this.running = false;
        this.render();
    },

    async replaceAll() {
        this._clearReplaceStatus();
        if (!loadFolder.fileHandle) { return alert('Load a directory first.'); }

        const q = document.getElementById('global-search-input').value.trim();
        if (!q) {
            document.getElementById('global-search-input')?.focus();
            return alert('Enter text to find first.');
        }

        const replacement = document.getElementById('global-replace-input')?.value ?? '';
        const needle = this._ensureGlobalRegex(this.createRegex(q));
        let changedFiles = 0;
        let replacedCount = 0;
        let failedFiles = 0;

        this.setSidebarMode('search');
        this.running = true;
        this._setBusyState(`Replacing "${this.escapeHtml(q)}"`, 'Applying replacements across the loaded project.');

        for (const file of loadFolder.fileStructure) {
            if (file.kind !== 'file') continue;
            try {
                const text = await this._getCurrentFileText(file);
                const matches = [...text.matchAll(this._ensureGlobalRegex(needle))];
                if (!matches.length) continue;

                const nextText = text.replace(this._ensureGlobalRegex(needle), replacement);
                if (nextText === text) continue;

                await this._writeFileText(file, nextText);
                changedFiles += 1;
                replacedCount += matches.length;
            } catch (e) {
                failedFiles += 1;
                console.warn('Replace write error for', file.name, e);
            }
        }

        this.running = false;
        await this.run();

        if (!changedFiles) {
            this._setReplaceStatus('No matches replaced.', failedFiles ? 'warning' : 'muted');
            return;
        }

        const replacementLabel = `${replacedCount} replacement${replacedCount !== 1 ? 's' : ''} across ${changedFiles} file${changedFiles !== 1 ? 's' : ''}`;
        const failureLabel = failedFiles ? ` (${failedFiles} file${failedFiles !== 1 ? 's' : ''} failed)` : '';
        this._setReplaceStatus(`Updated ${replacementLabel}${failureLabel}.`, failedFiles ? 'warning' : 'success');
    },

    createRegex(query) {
        const match = query.match(/^\/(.*)\/(.*)?$/);
        if (match) {
            try {
                return new RegExp(match[1], match[2] || 'gi');
            } catch (e) {
                // Fall back to plain-text search below.
            }
        }

        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, value => `\\${value}`);
        return new RegExp(escaped, 'gi');
    },

    highlight(line, regex, maxLen) {
        const matches = [...line.matchAll(this._ensureGlobalRegex(regex))];
        if (!matches.length) return this.escapeHtml(line.slice(0, maxLen));

        const firstMatch = matches[0];
        let snippetStart = 0;
        let snippetEnd = line.length;
        if (line.length > maxLen) {
            const contextBudget = Math.max(maxLen - firstMatch[0].length, 24);
            snippetStart = Math.max(0, firstMatch.index - Math.floor(contextBudget / 2));
            snippetEnd = Math.min(line.length, snippetStart + maxLen);
            if (snippetEnd === line.length) {
                snippetStart = Math.max(0, snippetEnd - maxLen);
            }
        }

        const snippet = line.slice(snippetStart, snippetEnd);
        let highlighted = '';
        let lastIndex = 0;
        const snippetMatches = [...snippet.matchAll(this._ensureGlobalRegex(regex))];
        for (const match of snippetMatches) {
            const start = match.index;
            const end = start + match[0].length;
            highlighted += this.escapeHtml(snippet.substring(lastIndex, start));
            highlighted += `<mark class="sr-hit">${this.escapeHtml(snippet.substring(start, end))}</mark>`;
            lastIndex = end;
        }

        highlighted += this.escapeHtml(snippet.substring(lastIndex));
        if (snippetStart > 0) highlighted = `...${highlighted}`;
        if (snippetEnd < line.length) highlighted += '...';
        return highlighted;
    },

    _ensureGlobalRegex(regex) {
        const source = regex instanceof RegExp ? regex.source : String(regex || '');
        const flags = regex instanceof RegExp ? regex.flags : 'gi';
        return new RegExp(source, flags.includes('g') ? flags : flags + 'g');
    },

    _normalizeRelativePath(relativePath) {
        return String(relativePath || '').replace(/\\/g, '/').toLowerCase();
    },

    _findOpenUuidByRelativePath(relativePath) {
        const target = this._normalizeRelativePath(relativePath);
        if (!target) return null;

        for (const [uuid, meta] of Object.entries(editor._meta || {})) {
            if (!meta || !editor.instance?.[uuid]) continue;
            if (this._normalizeRelativePath(meta.relativePath) === target) {
                return uuid;
            }
        }

        return null;
    },

    async _getCurrentFileText(file) {
        const openUuid = this._findOpenUuidByRelativePath(file.relativePath);
        if (openUuid && editor.isDirty(openUuid) && typeof editor._getValue === 'function') {
            return editor._getValue(openUuid);
        }
        return await loadFolder.getFileContent(file);
    },

    async _writeFileText(file, contents) {
        const openUuid = this._findOpenUuidByRelativePath(file.relativePath);
        if (openUuid) {
            editor.setValue(openUuid, contents);
            await editor._writeDirect(openUuid, contents);
            return;
        }

        const contentsToWrite = typeof editor._prepareContentsForDisk === 'function'
            ? editor._prepareContentsForDisk(file.name, contents)
            : String(contents ?? '');
        const writable = await file.entry.createWritable();
        let writeSucceeded = false;

        try {
            await writable.write(contentsToWrite);
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
    },

    _setBusyState(title, copy) {
        $('#search-summary').text('Working...').show();
        $('#search-clear').show();
        $('#search-results').html(
            `<div class="sr-empty">` +
            `<p class="sr-empty-title">${title}</p>` +
            `<p class="sr-empty-copy">${copy}</p>` +
            `</div>`
        );
    },

    _renderIdleState() {
        $('#search-summary').hide();
        $('#search-clear').hide();
        $('#search-results').html(
            `<div class="sr-empty">` +
            `<p class="sr-empty-title">Search the project</p>` +
            `<p class="sr-empty-copy">Use the search panel to find text across every loaded file. Enter plain text, or use regex with syntax like <code>/fetch\\(/gi</code>.</p>` +
            `</div>`
        );
    },

    _setReplaceStatus(message, tone = 'muted') {
        const color = tone === 'success'
            ? '#9fe6b1'
            : tone === 'warning'
                ? '#ffd166'
                : '#8fbbe6';
        $('#search-replace-status').text(message).css('color', color).show();
    },

    _clearReplaceStatus() {
        $('#search-replace-status').text('').hide();
    },

    _bindResultClickHandlers() {
        if (this._clickBound) return;

        $(document).on('click', '.sr-line', event => {
            const el = event.currentTarget;
            const fileId = el.getAttribute('data-file');
            const line = parseInt(el.getAttribute('data-line'), 10);
            this.openAt(fileId, line);
        });

        $(document).on('click', '.sr-file-name', event => {
            const fileId = event.currentTarget.getAttribute('data-open');
            this.openAt(fileId, 1);
        });

        this._clickBound = true;
    },

    render() {
        const container = $('#search-results').empty();
        $('#search-summary').hide();
        $('#search-clear').hide();

        if (!this.lastQuery) {
            this._renderIdleState();
            return;
        }

        if (!this.results.length) {
            $('#search-summary').text('0 results').show();
            $('#search-clear').show();
            container.html(
                `<div class="sr-empty">` +
                `<p class="sr-empty-title">No matches found</p>` +
                `<p class="sr-empty-copy">Nothing matched <code>${this.escapeHtml(this.lastQuery)}</code> in the current project.</p>` +
                `</div>`
            );
            return;
        }

        let total = 0;
        this.results.forEach(result => total += result.matches.length);
        $('#search-summary').text(`${total} hit${total !== 1 ? 's' : ''} in ${this.results.length} file${this.results.length !== 1 ? 's' : ''}`).show();
        $('#search-clear').show();

        for (const result of this.results) {
            const fileId = result.file.uuid;
            const hitCount = `${result.matches.length} hit${result.matches.length !== 1 ? 's' : ''}`;
            const fileBlock = $('<section class="sr-file"></section>');
            fileBlock.append(
                `<button type="button" class="sr-file-name" data-open="${fileId}">` +
                `<span class="sr-file-path">${this.escapeHtml(result.file.relativePath)}</span>` +
                `<span class="sr-hit-count">${hitCount}</span>` +
                `</button>`
            );

            result.matches.forEach(match => {
                fileBlock.append(
                    `<button type="button" class="sr-line" data-file="${fileId}" data-line="${match.lineNumber}" title="Open line ${match.lineNumber}">` +
                    `<span class="sr-line-number">${match.lineNumber}</span>` +
                    `<span class="sr-line-text">${match.excerpt}</span>` +
                    `</button>`
                );
            });

            container.append(fileBlock);
        }
    },

    async openAt(uuid, lineNumber) {
        await editor.openFile(uuid);
        const view = editor.instance[uuid];
        if (!view || !view.state || !view.dispatch) return;

        const safeLineNumber = Math.max(1, Math.min(Number(lineNumber) || 1, view.state.doc.lines));
        const line = view.state.doc.line(safeLineNumber);
        const from = line.from;
        const to = line.to;

        view.dispatch({
            selection: { anchor: from, head: to },
            scrollIntoView: true
        });
        view.focus();

        setTimeout(() => {
            if (editor.instance[uuid] !== view) return;
            const selection = view.state.selection.main;
            if (selection.from === from && selection.to === to) {
                view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
            }
        }, 1200);
    },

    clear() {
        this.lastQuery = '';
        this.results = [];
        $('#global-search-input').val('');
        $('#global-replace-input').val('');
        $('#search-summary').hide();
        $('#search-clear').hide();
        this._clearReplaceStatus();
        this._renderIdleState();
    },

    escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char]));
    }
};
