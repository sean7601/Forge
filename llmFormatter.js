const llmFormatter = {
    _entryPointCandidates: [],
    _lastGeneratedOutput: '',
    _instructionSuffix: 'Output the entirety of any files you change, but omit files you do not change',

    estimateTokenCount(text) {
        const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
        return Math.ceil(normalizedText.length / 4);
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    updateStatistics(text) {
        const charCount = text.length;
        const sizeInBytes = new Blob([text]).size;
        const tokenCount = this.estimateTokenCount(text);
        $('#char-count').text(charCount.toLocaleString() + ' characters');
        $('#size-display').text(this.formatFileSize(sizeInBytes));
        $('#token-count').text('~' + tokenCount.toLocaleString() + ' tokens');
    },

    _setStatus(message, level = 'info') {
        const el = document.getElementById('llm-copy-status');
        if (!el) return;
        el.textContent = message || '';
        el.classList.remove('text-info', 'text-success', 'text-warning', 'text-danger');
        if (message) {
            el.classList.add(level === 'success' ? 'text-success' : (level === 'warning' ? 'text-warning' : (level === 'danger' ? 'text-danger' : 'text-info')));
        }
    },

    _normalizeProjectPath(path) {
        const parts = String(path || '').replace(/\\/g, '/').split('/');
        const out = [];
        for (const rawPart of parts) {
            const part = rawPart.trim();
            if (!part || part === '.') continue;
            if (part === '..') {
                if (out.length > 0) out.pop();
                continue;
            }
            out.push(part);
        }
        return out.join('/');
    },

    _isHtmlFile(file) {
        if (!file || file.kind !== 'file' || !/\.html?$/i.test(String(file.name || ''))) return false;
        if (file.relativePath && file.relativePath.includes('shipped app files/')) return false;
        return true;
    },

    _isExcludedRuntimeFile(fileName) {
        const name = String(fileName || '').trim().toLowerCase();
        return (
            name === 'devconsole.js' ||
            name === 'testrecorder.js' ||
            name === 'test-recorder.js'
        );
    },

    _getHtmlEntryCandidates() {
        const files = (loadFolder.fileStructure || []).filter(f => this._isHtmlFile(f));
        files.sort((a, b) => {
            const aRel = this._normalizeProjectPath(a.relativePath || '');
            const bRel = this._normalizeProjectPath(b.relativePath || '');
            const aRootIndex = aRel.toLowerCase() === 'index.html';
            const bRootIndex = bRel.toLowerCase() === 'index.html';
            if (aRootIndex && !bRootIndex) return -1;
            if (!aRootIndex && bRootIndex) return 1;
            const aRoot = (a.path || []).length === 0;
            const bRoot = (b.path || []).length === 0;
            if (aRoot && !bRoot) return -1;
            if (!aRoot && bRoot) return 1;
            return aRel.localeCompare(bRel);
        });
        return files;
    },

    _getSelectedEntryPointRelativePath() {
        const select = document.getElementById('llm-entrypoint-select');
        if (!select || !select.value) return '';
        return this._normalizeProjectPath(select.value);
    },

    _resolveHtmlReferencePath(ref, basePath = []) {
        const raw = String(ref || '').trim();
        if (!raw) return '';
        if (raw.startsWith('#')) return '';
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return '';
        const clean = raw.split('#')[0].split('?')[0].trim();
        if (!clean) return '';
        if (clean.startsWith('/')) {
            return this._normalizeProjectPath(clean.replace(/^\/+/, ''));
        }
        return this._normalizeProjectPath([...basePath, clean].join('/'));
    },

    async _collectReferencedFilePaths(options = {}) {
        const opts = {
            entryPointRelativePath: '',
            includeProjectDocs: true,
            excludeWctRuntimeFiles: false,
            ...options
        };

        if (!loadFolder.fileHandle) throw new Error('Please load a directory first.');

        const normalizedEntry = this._normalizeProjectPath(opts.entryPointRelativePath || '');
        const htmlCandidates = this._getHtmlEntryCandidates();
        if (!htmlCandidates.length) throw new Error('No HTML files were found in the loaded directory.');

        const entryFile = normalizedEntry
            ? htmlCandidates.find(f => this._normalizeProjectPath(f.relativePath || '') === normalizedEntry)
            : htmlCandidates[0];
        if (!entryFile) throw new Error('Selected HTML entry point was not found.');

        const parser = new DOMParser();
        const entryContent = await loadFolder.getFileContent(entryFile);
        const doc = parser.parseFromString(entryContent, 'text/html');

        const entryRelPath = this._normalizeProjectPath(entryFile.relativePath || entryFile.name || '');
        const referencedPaths = new Set([entryRelPath]);
        const basePath = Array.isArray(entryFile.path) ? entryFile.path.slice() : [];

        doc.querySelectorAll('script[src]').forEach(s => {
            const src = this._resolveHtmlReferencePath(s.getAttribute('src'), basePath);
            if (!src) return;
            if (opts.excludeWctRuntimeFiles && this._isExcludedRuntimeFile(src.split('/').pop())) return;
            referencedPaths.add(src);
        });

        doc.querySelectorAll('link[rel="stylesheet"][href]').forEach(l => {
            const href = this._resolveHtmlReferencePath(l.getAttribute('href'), basePath);
            if (!href) return;
            referencedPaths.add(href);
        });

        if (opts.includeProjectDocs) {
            const readme = (loadFolder.fileStructure || []).find(
                f => f && f.kind === 'file' && String(f.name || '').toLowerCase() === 'readme.md'
            );
            if (readme) referencedPaths.add(this._normalizeProjectPath(readme.relativePath || readme.name));

            const architecture = (loadFolder.fileStructure || []).find(
                f => f && f.kind === 'file' && String(f.name || '').toLowerCase() === 'architecture.txt'
            );
            if (architecture) referencedPaths.add(this._normalizeProjectPath(architecture.relativePath || architecture.name));
        }

        return [...referencedPaths];
    },

    async _buildConcatenatedContextText(projectPaths) {
        let output = '';
        for (const rel of projectPaths) {
            const normalizedRel = this._normalizeProjectPath(rel);
            const file = (loadFolder.fileStructure || []).find(
                f => f && f.kind === 'file' && this._normalizeProjectPath(f.relativePath || '') === normalizedRel
            );
            if (!file) continue;
            const content = await loadFolder.getFileContent(file);
            output += `File: ${normalizedRel}\n---------------------------------------\n${content}\n\n`;
        }
        return output;
    },

    async _copyTextToClipboard(text) {
        if (!text) return false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {
            // Fallback below.
        }
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, ta.value.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return !!ok;
        } catch (_) {
            return false;
        }
    },

    async copyTextToClipboard(text) {
        return await this._copyTextToClipboard(text);
    },

    _openLlmContextTab() {
        const link = document.getElementById('llm-formatter-tab');
        if (!link) return;
        if (window.bootstrap && bootstrap.Tab) {
            bootstrap.Tab.getOrCreateInstance(link).show();
            return;
        }
        link.click();
    },

    _renderEntryPointSelector(htmlCandidates) {
        const wrap = document.getElementById('llm-entrypoint-wrap');
        const select = document.getElementById('llm-entrypoint-select');
        if (!wrap || !select) return;

        const current = this._normalizeProjectPath(select.value || '');
        const optionsHtml = htmlCandidates.map(file => {
            const rel = this._normalizeProjectPath(file.relativePath || file.name || '');
            const escaped = rel.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<option value="${escaped}">${escaped}</option>`;
        }).join('');
        select.innerHTML = optionsHtml;

        const preferred = current && htmlCandidates.some(f => this._normalizeProjectPath(f.relativePath || '') === current)
            ? current
            : this._normalizeProjectPath((htmlCandidates[0] && htmlCandidates[0].relativePath) || '');
        if (preferred) select.value = preferred;

        wrap.style.display = htmlCandidates.length > 1 ? '' : 'none';
    },

    getHtmlEntryPointOptions() {
        const htmlCandidates = this._getHtmlEntryCandidates();
        return htmlCandidates.map(file => this._normalizeProjectPath(file.relativePath || file.name || '')).filter(Boolean);
    },

    async _refreshFromSelectedEntryPoint() {
        const selectedEntry = this._getSelectedEntryPointRelativePath();
        const referenced = await this._collectReferencedFilePaths({
            entryPointRelativePath: selectedEntry,
            includeProjectDocs: true,
            excludeWctRuntimeFiles: false
        });
        await this.createCheckboxList(referenced);
        $('#updateButton, #llm-output-controls').show();
        $('#updateButton').text('Generate + Copy');
        this._setStatus('');
    },

    async startProcessing() {
        try {
            if (!loadFolder.fileHandle) throw new Error('Please load a directory first.');
            const htmlCandidates = this._getHtmlEntryCandidates();
            if (!htmlCandidates.length) throw new Error('No HTML files were found in the loaded directory.');
            this._entryPointCandidates = htmlCandidates;
            this._renderEntryPointSelector(htmlCandidates);
            await this._refreshFromSelectedEntryPoint();
        } catch (error) {
            alert(error.message || 'Could not generate LLM context.');
            console.error('LLM Formatter Error:', error);
        }
    },

    async onEntryPointChanged() {
        try {
            await this._refreshFromSelectedEntryPoint();
        } catch (error) {
            alert(error.message || 'Could not refresh files for selected entry point.');
            console.error('LLM Formatter Entry Point Error:', error);
        }
    },

    async createCheckboxList(projectPaths) {
        const container = $('#checkboxContainer').html('');

        const controlsDiv = $('<div class="selection-controls mb-2"></div>');
        const selectAllBtn = $('<button class="btn btn-sm btn-secondary">Select All</button>');
        const deselectAllBtn = $('<button class="btn btn-sm btn-secondary">Deselect All</button>');
        controlsDiv.append(selectAllBtn, deselectAllBtn);
        container.append(controlsDiv);

        selectAllBtn.on('click', () => container.find('input[type="checkbox"]').prop('checked', true));
        deselectAllBtn.on('click', () => container.find('input[type="checkbox"]').prop('checked', false));

        const table = $('<table class="table table-bordered table-sm"></table>').html(
            '<thead><tr><th style="color: #000;">Select</th><th style="color: #000;">File</th><th style="color: #000;">Size</th></tr></thead>'
        );
        const tbody = $('<tbody></tbody>');

        for (const relPath of projectPaths) {
            const normalizedRel = this._normalizeProjectPath(relPath);
            const file = (loadFolder.fileStructure || []).find(
                f => f && f.kind === 'file' && this._normalizeProjectPath(f.relativePath || '') === normalizedRel
            );
            if (!file) continue;

            const fileHandle = await file.entry.getFile();
            const size = fileHandle.size;
            const sizeKB = (size / 1024).toFixed(2) + ' KB';
            const isChecked = size <= 204800;
            const escapedPath = normalizedRel
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');

            const row = $('<tr></tr>').html(`
                <td><input type="checkbox" value="${escapedPath}" ${isChecked ? 'checked' : ''}></td>
                <td>${escapedPath}</td>
                <td>${sizeKB}</td>`);
            tbody.append(row);
        }

        container.append(table.append(tbody));
    },

    async generateOutput() {
        const selectedPaths = $('#checkboxContainer input:checked').map((_, el) => String($(el).val() || '')).get();
        const selectedNormalized = selectedPaths.map(p => this._normalizeProjectPath(p)).filter(Boolean);
        if (!selectedNormalized.length) {
            this._setStatus('Select at least one file first.', 'warning');
            return;
        }

        const contextText = await this._buildConcatenatedContextText(selectedNormalized);
        const finalText = `${contextText}\n${this._instructionSuffix}\n`;
        this._lastGeneratedOutput = finalText;
        this.updateStatistics(finalText);

        const copied = await this._copyTextToClipboard(finalText);
        if (!copied) {
            this._setStatus('Failed to copy to clipboard. Try again.', 'danger');
            return;
        }

        this._setStatus('Generated and copied to clipboard.', 'success');
    },

    async getCodeForAiContextText(options = {}) {
        const opts = {
            includeProjectDocs: false,
            excludeWctRuntimeFiles: true,
            openLlmContextOnMultiHtml: true,
            showAlerts: false,
            entryPointRelativePath: '',
            ...options
        };

        const htmlCandidates = this._getHtmlEntryCandidates();
        const selectedEntry = this._normalizeProjectPath(opts.entryPointRelativePath || '');
        const hasExplicitEntry = !!selectedEntry;

        if (!hasExplicitEntry && htmlCandidates.length > 1) {
            const msg = 'Multiple HTML files were found. Please choose an HTML entry point before generating context.';
            if (opts.showAlerts) alert(msg);
            if (opts.openLlmContextOnMultiHtml) {
                this._openLlmContextTab();
                await this.startProcessing();
            }
            throw new Error(msg);
        }

        const singleEntry = htmlCandidates[0];
        if (!singleEntry) throw new Error('No HTML files were found in the loaded directory.');

        let entryPath = this._normalizeProjectPath(singleEntry.relativePath || singleEntry.name || '');
        if (hasExplicitEntry) {
            const match = htmlCandidates.find(file =>
                this._normalizeProjectPath(file.relativePath || file.name || '') === selectedEntry
            );
            if (!match) throw new Error('Selected HTML entry point was not found.');
            entryPath = selectedEntry;
        }

        const filePaths = await this._collectReferencedFilePaths({
            entryPointRelativePath: entryPath,
            includeProjectDocs: !!opts.includeProjectDocs,
            excludeWctRuntimeFiles: !!opts.excludeWctRuntimeFiles
        });
        const output = await this._buildConcatenatedContextText(filePaths);
        if (!output.trim()) throw new Error('No referenced files were found to copy.');
        return output;
    },

    async copyCodeForAiFromEditor() {
        try {
            const output = await this.getCodeForAiContextText({
                includeProjectDocs: false,
                excludeWctRuntimeFiles: true,
                openLlmContextOnMultiHtml: true,
                showAlerts: true
            });

            const copied = await this._copyTextToClipboard(output);
            if (!copied) throw new Error('Failed to copy code for AI.');

            const btn = document.getElementById('quick-prompts-btn');
            if (btn) {
                const original = btn.textContent;
                const originalClassName = btn.className;
                btn.textContent = 'Copied';
                btn.className = 'btn btn-sm btn-success dropdown-toggle text-white';
                setTimeout(() => {
                    btn.textContent = original;
                    btn.className = originalClassName;
                }, 1200);
            } else {
                alert('Code copied to clipboard.');
            }
        } catch (error) {
            alert(error.message || 'Could not copy code for AI.');
            console.error('Copy Code for AI error:', error);
        }
    },

    copyToClipboard() {
        this._copyTextToClipboard(this._lastGeneratedOutput)
            .then(ok => {
                if (ok) {
                    this._setStatus('Copied again.', 'success');
                } else {
                    this._setStatus('Failed to copy text.', 'danger');
                }
            })
            .catch(err => {
                this._setStatus('Failed to copy text.', 'danger');
                console.error('Copy failed:', err);
            });
    },

    clear() {
        $('#checkboxContainer').empty();
        $('#llm-output').val('');
        $('#updateButton').hide();
        $('#llm-output-controls').hide();
        $('#llm-entrypoint-wrap').hide();
        $('#llm-entrypoint-select').empty();
        this._entryPointCandidates = [];
        this._lastGeneratedOutput = '';
        this.updateStatistics('');
        this._setStatus('');
    }
};
