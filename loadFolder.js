const HTML_ESCAPE_MAP = Object.freeze({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
    '=': '&#61;',
    '/': '&#47;'
});

const loadFolder = {
    fileHandle: null,
    fileStructure: [],   // Contains both files and (now) explicit directory entries so empty folders show
    _treeHandlerRefs: null,
    _syncTimer: null,
    _focusHandler: null,
    _visibilityHandler: null,
    _syncInFlight: false,
    _syncPending: false,
    _snapshotSignature: '',
    _referenceHighlights: null,
    _referenceRefreshToken: 0,
    _beginnerPromptFollowupHandler: null,
    _renameInFlight: new Set(),

    async getFile() {
        try {
            // Clean up existing state before loading new folder
            this._cleanupBeforeNewFolder();

            // In embedded contexts, the picker can be unavailable on the iframe window but
            // available on the top window. Try current window first, then top (if accessible).
            let pickerFn = null;
            if (typeof window.showDirectoryPicker === 'function') {
                pickerFn = window.showDirectoryPicker.bind(window);
            } else {
                try {
                    if (window.top && typeof window.top.showDirectoryPicker === 'function') {
                        pickerFn = window.top.showDirectoryPicker.bind(window.top);
                    }
                } catch (_) {
                    // Cross-origin top window, ignore and fall through.
                }
            }
            if (!pickerFn) {
                throw new Error('Directory picker is not available in this browser/context.');
            }

            try {
                this.fileHandle = await pickerFn({ mode: 'readwrite' });
            } catch (pickerErr) {
                // Fallback for environments that don't support the options object.
                if (pickerErr && pickerErr.name === 'TypeError') {
                    this.fileHandle = await pickerFn();
                } else {
                    throw pickerErr;
                }
            }

            // Some browsers/contexts reject immediate requestPermission after picker selection
            // if user activation has ended. Continue loading and let save actions re-prompt.
            let permissionStatus = 'prompt';
            try {
                if (typeof this.fileHandle.queryPermission === 'function') {
                    permissionStatus = await this.fileHandle.queryPermission({ mode: 'readwrite' });
                }
                if (permissionStatus !== 'granted' && typeof this.fileHandle.requestPermission === 'function') {
                    permissionStatus = await this.fileHandle.requestPermission({ mode: 'readwrite' });
                }
            } catch (permErr) {
                console.warn('Could not request write permission during load; continuing in limited mode.', permErr);
            }
            if (permissionStatus !== 'granted') {
                console.warn('Write permission not granted during load. Save operations may prompt again.');
            }

            this.fileStructure = await this.recursivelyReadDirectory([], this.fileHandle);
            this._updateSignature();

            // Stamp the unshipped banner onto all HTML files on disk immediately
            this._ensureBannersOnDisk().catch(err =>
                console.warn('Banner injection pass failed:', err)
            );

            await this._refreshReferenceHighlights();
            this._renderFileTree();
            this._startAutoSync();

            // Recreate save controls (only if they don't already exist)
            if (!$('#saveControls').length) {
                const controls = `
                            <div id="saveControls" class="d-flex align-items-center flex-wrap w-100" style="gap: 0.5rem;">
                                <button id="saveButton" class="btn btn-sm btn-outline-primary">💾 Save All</button>
                                <div class="form-check form-switch ms-2">
                                    <input class="form-check-input" type="checkbox" id="autoSaveToggle">
                                    <label class="form-check-label text-light small" for="autoSaveToggle">Auto-save</label>
                                </div>
                                <div class="d-flex align-items-center ms-2" style="gap: 0.25rem;">
                                    <button id="checkpointCreateBtn" class="btn btn-sm btn-outline-secondary" title="Open checkpoint manager">📌 Checkpoints</button>
                                </div>
                                <span id="global-save-status" class="save-status ms-2"></span>
                            </div>`;
                $('#editor-header').html(controls).show();
                $("#checkpointCreateBtn").removeClass('btn-outline-secondary').addClass('btn-success');
                $("#saveButton").click(() => editor.saveAll());
                $("#saveCurrentButton").click(() => editor.saveCurrent());
                $("#checkpointCreateBtn").click(() => checkpointManager.openModal());
                // Auto-save toggle
                $("#autoSaveToggle").on('change', function () {
                    const enabled = this.checked;
                    editor.setAutoSave(enabled);
                    try {
                        localStorage.setItem('wc:autoSave', enabled ? '1' : '0');
                    } catch (storageErr) {
                        console.warn('Could not persist auto-save preference:', storageErr);
                    }
                    $('#global-save-status').text(enabled ? 'Auto-save on' : '');
                });
                // Restore auto-save preference (default to true)
                let savedVal = null;
                try {
                    savedVal = localStorage.getItem('wc:autoSave');
                } catch (storageErr) {
                    console.warn('Could not read auto-save preference; using default.', storageErr);
                }
                const isEnabled = savedVal === null ? true : (savedVal === '1');

                $('#autoSaveToggle').prop('checked', isEnabled);
                editor.setAutoSave(isEnabled);
                if (isEnabled) $('#global-save-status').text('Auto-save on');
            }

            $('#file-operations').show();
            $('#compiler-tab, #split-bookmarklet-tab, #llm-formatter-tab, #test-recorder-tab, #math-logic-tester-tab, #sharedrive-nosql-tab, #ai-helper-tab, #devconsole-tab').removeClass('disabled');

            // Initialize checkpoint manager with directory root name
            if (typeof checkpointManager !== 'undefined') {
                checkpointManager.init(this.fileHandle.name);
            }
            if (typeof aiHelper !== 'undefined' && aiHelper && typeof aiHelper.init === 'function') {
                aiHelper.init();
            }

            // Prefill compiler filename with folder name if empty
            try {
                const fn = document.getElementById('compile-filename');
                if (fn && !fn.value) {
                    fn.value = this.fileHandle.name;
                }
            } catch (_) { }

            // Check for HTML file issues and show warnings
            this._checkHtmlFileWarnings();
            await this._autoOpenPreferredFileOnLoad();

            if (this._isProjectEmpty()) {
                // Keep the new-project onboarding for truly empty folders,
                // but do not run it for existing folders that merely lack index.html.
                Promise.resolve()
                    .then(() => this._handleEmptyDirectoryOnLoad())
                    .catch(err => {
                        console.error('Empty-directory onboarding failed:', err);
                    });
            }
            return true;
        } catch (err) {
            if (this._isPermissionDeniedError(err)) {
                console.warn('Directory load blocked due to denied permissions:', err);
                await this._showPermissionDeniedModal();
                return false;
            }
            console.error("Error loading directory:", err);
            alert("Could not open app folder. Please grant 'Save Changes' (read/write) permission and try again.");
            return false;
        }
    },

    _isPermissionDeniedError(err) {
        if (!err) return false;
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError' || err.name === 'AbortError') {
            return true;
        }

        const msg = String(err.message || '').toLowerCase();
        return msg.includes('permission')
            || msg.includes('denied')
            || msg.includes('not allowed')
            || msg.includes('read/write permission');
    },

    async _showPermissionDeniedModal() {
        const bodyHtml = `
            <p class="mb-2"><strong>Directory permissions were not granted.</strong></p>
            <p class="mb-1"><small>When you click <strong>Open App Folder</strong> again:</small></p>
            <ol class="mb-0 ps-3">
                <li>Click <strong>Allow</strong> on the browser permission prompt.</li>
                <li>Click <strong>Save changes</strong> when asked for write access.</li>
            </ol>
        `;

        await this._showDecisionModal({
            modalId: 'forge-permission-denied-modal',
            title: 'Permissions Required',
            bodyHtml,
            primaryText: 'I understand',
            secondaryText: '',
            singleAction: true
        });
    },

    _isProjectEmpty() {
        return !Array.isArray(this.fileStructure) || this.fileStructure.length === 0;
    },

    _isBeginnerOnboardingActive() {
        const state = window && window.forgeBeginnerOnboardingState ? window.forgeBeginnerOnboardingState : null;
        return !!(state && state.beginnerMode);
    },

    _getRootHtmlFiles() {
        return (this.fileStructure || []).filter(f =>
            f &&
            f.kind === 'file' &&
            Array.isArray(f.path) &&
            f.path.length === 0 &&
            /\.html?$/i.test(String(f.name || ''))
        );
    },

    _findRootIndexHtml() {
        return this._getRootHtmlFiles().find(f => String(f.name || '').toLowerCase() === 'index.html') || null;
    },

    _findPreferredAutoOpenFile() {
        const rootIndex = this._findRootIndexHtml();
        if (rootIndex) return rootIndex;

        const nestedIndex = (this.fileStructure || []).find(f =>
            f &&
            f.kind === 'file' &&
            String(f.name || '').toLowerCase() === 'index.html'
        );
        if (nestedIndex) return nestedIndex;

        const rootHtml = this._getRootHtmlFiles()[0];
        if (rootHtml) return rootHtml;

        return (this.fileStructure || []).find(f =>
            f &&
            f.kind === 'file' &&
            /\.html?$/i.test(String(f.name || ''))
        ) || null;
    },

    async _autoOpenPreferredFileOnLoad() {
        const preferred = this._findPreferredAutoOpenFile();
        if (!preferred || !preferred.uuid) return false;
        if (!(window.editor && typeof editor.openFile === 'function')) return false;

        try {
            await editor.openFile(preferred.uuid);
            return true;
        } catch (err) {
            console.warn('Could not auto-open preferred file on load:', err);
            return false;
        }
    },

    _getStarterNewBuildPrefix() {
        return 'Create a single-file, vanilla, offline html file application that ';
    },

    _getStarterNewBuildSuffix() {
        return '\n\nReturn complete file output, not snippets.';
    },

    _extractStarterRequestFromComposer(composerText, options = {}) {
        const trim = options.trim !== false;
        const prefix = this._getStarterNewBuildPrefix();
        const suffixText = 'Return complete file output, not snippets.';
        const raw = String(composerText || '').replace(/\r\n/g, '\n');
        let request = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
        const suffixIndex = request.indexOf(suffixText);
        if (suffixIndex >= 0) {
            request = request.slice(0, suffixIndex);
        }
        const normalized = String(request || '');
        return trim ? normalized.trim() : normalized;
    },

    _buildStarterNewBuildPrompt(requestText) {
        const clean = String(requestText || '').trim();
        const request = clean || '[describe what you want the app to do]';
        return `${this._getStarterNewBuildPrefix()}${request}${this._getStarterNewBuildSuffix()}`;
    },

    async _handleEmptyDirectoryOnLoad() {
        if (!this._isProjectEmpty()) {
            if (!this._isBeginnerOnboardingActive()) {
                return;
            }

            const rootHtmlFiles = this._getRootHtmlFiles();
            const hasRootIndexHtml = !!this._findRootIndexHtml();

            if (hasRootIndexHtml) {
                await this._showExistingIndexCopyStepModal();
                this._flashQuickPromptsButton(6000);
                this._registerBeginnerPromptFollowup();
                return;
            }
            if (!rootHtmlFiles.length) {
                const shouldCreate = await this._showMissingIndexHtmlPromptModal();
                if (!shouldCreate) {
                    return;
                }

                const created = await this.createNewFile('index.html', []);
                if (!created) {
                    return;
                }

                await this._showMissingIndexHtmlCreatedModal();
                this._registerBeginnerPromptLabFollowup();
                this._focusPromptLabForNewProject();
                return;
            }

            await this._showExistingDirectoryResultModal({
                rootHtmlFiles
            });
            await this._showLaunchAiNextStepModal({
                hasIndexHtml: false,
                existingIndexUpgradeFlow: false
            });
            this._flashAiLauncherButton(5000);
            return;
        }

        const shouldCreate = await this._showEmptyDirectoryPromptModal();
        if (!shouldCreate) {
            return;
        }

        const created = await this.createNewFile('index.html', []);
        if (!created) {
            return;
        }

        await this._showEmptyDirectoryCreatedModal();
        this._registerBeginnerPromptLabFollowup();
        this._focusPromptLabForNewProject();
    },

    async _showEmptyDirectoryPromptModal() {
        const bodyHtml = `
            <p class="mb-2">Create <code>index.html</code> now?</p>
            <p class="mb-0"><small>Recommended for new Forge projects since your application code will go here.</small></p>
        `;
        return await this._showDecisionModal({
            modalId: 'forge-empty-project-modal',
            title: 'Initialize Project',
            bodyHtml,
            primaryText: 'Create index.html',
            secondaryText: 'Not now'
        });
    },

    async _showMissingIndexHtmlPromptModal() {
        const bodyHtml = `
            <p class="mb-2"><strong>Your folder has files, but no root <code>index.html</code>.</strong></p>
            <p class="mb-2">Create <code>index.html</code> now and keep the rest of the folder as-is?</p>
            <p class="mb-0"><small>Forge will not modify your existing files. It will only add a new root <code>index.html</code>.</small></p>
        `;
        return await this._showDecisionModal({
            modalId: 'forge-missing-index-project-modal',
            title: 'Create index.html',
            bodyHtml,
            primaryText: 'Create index.html',
            secondaryText: 'Not now'
        });
    },

    async _showEmptyDirectoryResultModal() {
        const bodyHtml = `
            <p class="mb-2"><strong>index.html</strong> created.</p>
        `;
        await this._showDecisionModal({
            modalId: 'forge-empty-project-result-modal',
            title: 'Project Starter Ready',
            bodyHtml,
            primaryText: 'Got it',
            secondaryText: '',
            singleAction: true
        });
    },

    async _showEmptyDirectoryCreatedModal() {
        const bodyHtml = `
            <p class="mb-2"><strong>index.html</strong> created.</p>
            <p class="mb-0">Use the <strong>Prompt Lab</strong> panel on the right to describe what you want to build, then copy the prompt to your AI.</p>
        `;
        await this._showDecisionModal({
            modalId: 'forge-empty-project-created-modal',
            title: 'Project Ready',
            bodyHtml,
            primaryText: 'Got it',
            secondaryText: '',
            singleAction: true
        });
    },

    async _showMissingIndexHtmlCreatedModal() {
        const bodyHtml = `
            <p class="mb-2"><strong>index.html</strong> created.</p>
            <p class="mb-0">Your existing files were kept. Use the <strong>Prompt Lab</strong> panel on the right to describe what you want to build, then copy the prompt to your AI.</p>
        `;
        await this._showDecisionModal({
            modalId: 'forge-missing-index-created-modal',
            title: 'Project Ready',
            bodyHtml,
            primaryText: 'Got it',
            secondaryText: '',
            singleAction: true
        });
    },

    async _showExistingIndexCopyStepModal() {
        if (this._showBeginnerInlineHint({
            html: '<strong>Step 1:</strong> click <strong>Quick Prompts</strong>, choose <strong>Edit Code</strong> or <strong>Debug Code</strong>, then click <strong>Generate + Copy Prompt</strong>.',
            targetSelector: '#quick-prompts-btn',
            highlightSelectors: ['#quick-prompts-btn'],
            flashSelector: '#quick-prompts-btn'
        })) {
            return;
        }

        const bodyHtml = `
            <p class="mb-2"><strong>Your folder already has <code>index.html</code>.</strong></p>
            <ol class="mb-2 ps-3">
                <li>Click <strong>Quick Prompts</strong> in the top editor bar.</li>
                <li>Choose <strong>Edit Code</strong> or <strong>Debug Code</strong>.</li>
                <li>If it is a new chat, check <strong>New conversation</strong>.</li>
                <li>Click <strong>Generate + Copy Prompt</strong>.</li>
            </ol>
            <p class="mt-2 mb-0">Then continue to AI Services.</p>
        `;

        await this._showDecisionModal({
            modalId: 'forge-existing-index-copy-step-modal',
            title: 'Step 1: Build Quick Prompt',
            bodyHtml,
            primaryText: 'Got it',
            secondaryText: '',
            singleAction: true
        });
    },

    async _showExistingIndexLaunchAiModal() {
        if (this._showBeginnerInlineHint({
            html: '<strong>Step 2:</strong> click <strong>AI Services</strong>, pick a provider, and paste your copied prompt.',
            targetSelector: '#open-ai-btn',
            highlightSelectors: ['#open-ai-btn'],
            flashSelector: '#open-ai-btn'
        })) {
            return;
        }

        const bodyHtml = `
            <p class="mb-2"><strong>Step 2:</strong> open <strong>AI Services</strong> and paste your copied prompt.</p>
            <ol class="mb-2 ps-3">
                <li>Click <strong>AI Services</strong>.</li>
                <li>Pick a provider.</li>
                <li>Paste the prompt.</li>
            </ol>
            <div class="p-2 rounded" style="background:#1a202c; border:1px solid #3a434a;">
                <small class="d-block mb-1 text-light">Example format:</small>
                <pre class="mb-0" style="white-space:pre-wrap; color:#e9ecef; font-size:0.86rem;">I want to upgrade this app by: [describe your change].
Keep existing working behavior unless I explicitly ask to change it.

Here is my current code:
[paste code copied from Forge]</pre>
            </div>
            <p class="mt-2 mb-0"><small>When you return, keep following Forge prompts.</small></p>
        `;

        await this._showDecisionModal({
            modalId: 'forge-existing-index-launch-ai-modal',
            title: 'Step 2: AI Services',
            bodyHtml,
            primaryText: 'Got it',
            secondaryText: '',
            singleAction: true
        });
    },

    async _showExistingDirectoryResultModal(options = {}) {
        const rootHtmlFiles = Array.isArray(options.rootHtmlFiles) ? options.rootHtmlFiles : [];
        const requestPlaceholder = 'upgrades my current app while preserving existing working features.';
        const starterPrefix = this._getStarterNewBuildPrefix();

        let deltaStepsHtml = '';
        if (rootHtmlFiles.length > 0) {
            const names = rootHtmlFiles.map(f => this.escapeHtml(f.name)).join(', ');
            deltaStepsHtml = `
                <li>Your root HTML file(s): <code>${names}</code>.</li>
                <li>Preferred entry file name: <code>index.html</code>.</li>
                <li>Rename one to <code>index.html</code> (or create it).</li>
            `;
        } else {
            deltaStepsHtml = `
                <li>No root HTML file found.</li>
                <li>Create <code>index.html</code> in the root with <strong>+ File</strong>.</li>
            `;
        }

        const bodyHtml = `
            <p class="mb-2"><strong>Your folder already has files.</strong> Forge kept your existing files and did not auto-create anything.</p>
            <p class="mb-2"><strong>Type your request, then click Generate + Copy Prompt.</strong></p>
            <div class="p-2 rounded forge-starter-prompt-box" style="background:#1a202c; border:1px solid #3a434a;">
                <small class="d-block mb-1">Prompt composer:</small>
                <div class="forge-starter-prompt-composer-wrap mb-2">
                    <textarea id="forge-existing-starter-prompt-request"
                        class="form-control form-control-sm forge-starter-prompt-request forge-starter-prompt-composer"
                        rows="5"
                        data-starter-placeholder="${this.escapeHtml(requestPlaceholder)}"
                        data-starter-ghost-id="forge-existing-starter-prompt-ghost"
                        autofocus>${this.escapeHtml(starterPrefix)}</textarea>
                    <div id="forge-existing-starter-prompt-ghost" class="forge-starter-prompt-ghost">
                        <span class="forge-starter-prompt-caret" aria-hidden="true"></span>
                        <span class="forge-starter-prompt-placeholder" data-starter-placeholder-text></span>
                    </div>
                </div>
                <small class="d-block mb-2 text-light">The first line is fixed boilerplate. Type directly after it.</small>
                <div class="d-flex align-items-center" style="gap:0.5rem;">
                    <button type="button" id="forge-existing-starter-prompt-copy-btn" class="btn btn-outline-info"
                        data-copy-target="#forge-existing-starter-prompt-request"
                        data-copy-template="new-build-composer"
                        data-copy-empty-fallback="[describe what you want the app to do]"
                        data-copy-success-status="Prompt copied to your clipboard. Paste it into AI Services."
                        data-copy-warning-target="#forge-existing-starter-prompt-warning"
                        data-copy-default-status="Forge will generate a full new-build prompt and copy it to your clipboard.">Generate + Copy Prompt</button>
                    <small class="text-light" data-copy-status-for="forge-existing-starter-prompt-copy-btn">Forge will generate a full new-build prompt and copy it to your clipboard.</small>
                </div>
                <small id="forge-existing-starter-prompt-warning" class="text-warning d-block mt-2"></small>
            </div>
            <p class="mt-2 mb-1"><strong>Quick check:</strong></p>
            <ol class="mb-0 ps-3">${deltaStepsHtml}</ol>
        `;

        await this._showDecisionModal({
            modalId: 'forge-existing-project-result-modal',
            title: 'Project Folder Loaded',
            bodyHtml,
            primaryText: 'Continue',
            secondaryText: '',
            singleAction: true,
            beforePrimary: ({ modalEl }) => {
                const reqEl = modalEl.querySelector('#forge-existing-starter-prompt-request');
                const copyBtn = modalEl.querySelector('#forge-existing-starter-prompt-copy-btn');
                const warningEl = modalEl.querySelector('#forge-existing-starter-prompt-warning');
                const hasRequest = !!this._extractStarterRequestFromComposer(reqEl && reqEl.value ? reqEl.value : '');
                const copied = !!(copyBtn && copyBtn.dataset && copyBtn.dataset.copyCompleted === '1');

                if (hasRequest && copied) {
                    if (warningEl) warningEl.textContent = '';
                    return true;
                }

                const warnings = [];
                if (!hasRequest) warnings.push('Type what you want this app to do.');
                if (!copied) warnings.push('Click Generate + Copy Prompt before continuing.');
                if (warningEl) warningEl.textContent = warnings.join(' ');
                return false;
            }
        });
    },

    async _showLaunchAiNextStepModal(options = {}) {
        const existingIndexUpgradeFlow = !!options.existingIndexUpgradeFlow;
        const stepThreeText = existingIndexUpgradeFlow
            ? 'Paste your upgrade request, then add "Here is my current code:" and paste the copied code from Forge.'
            : 'Paste the generated prompt from your clipboard.';

        if (this._showBeginnerInlineHint({
            html: `<strong>Next:</strong> click <strong>AI Services</strong>, pick a provider, then ${this.escapeHtml(stepThreeText)}`,
            targetSelector: '#open-ai-btn',
            highlightSelectors: ['#open-ai-btn'],
            flashSelector: '#open-ai-btn'
        })) {
            return;
        }

        const bodyHtml = `
            <p class="mb-2"><strong>Next:</strong> open <strong>AI Services</strong>.</p>
            <ol class="mb-2 ps-3">
                <li>Click <strong>AI Services</strong>.</li>
                <li>Pick a provider.</li>
                <li>${stepThreeText}</li>
            </ol>
        `;

        await this._showDecisionModal({
            modalId: 'forge-launch-ai-next-step-modal',
            title: 'Use AI Services Next',
            bodyHtml,
            primaryText: 'Got it',
            secondaryText: '',
            singleAction: true
        });
    },

    _showBeginnerInlineHint({
        html = '',
        targetSelector = '',
        highlightSelectors = [],
        flashSelector = '',
        hideAfterMs = 0
    } = {}) {
        if (!this._isBeginnerOnboardingActive()) {
            return false;
        }
        const api = window && window.forgeBeginnerInlineHint ? window.forgeBeginnerInlineHint : null;
        if (!api || typeof api.show !== 'function') {
            return false;
        }
        api.show({
            html,
            targetSelector,
            highlightSelectors,
            flashSelector,
            hideAfterMs
        });
        return true;
    },

    _flashQuickPromptsButton(durationMs = 5000) {
        this._ensureAiLauncherFlashStyle();
        this._flashButtonWithFallback({
            primaryId: 'quick-prompts-btn',
            fallbackId: 'open-ai-btn',
            durationMs
        });
    },

    _focusPromptLabForNewProject(durationMs = 6000) {
        if (typeof window !== 'undefined' && typeof window.toggleRightPanel === 'function') {
            window.toggleRightPanel(true);
        }
        if (typeof promptLab !== 'undefined' && promptLab) {
            if (typeof promptLab.switchRpTab === 'function') {
                promptLab.switchRpTab('prompt-lab');
            }
            if (typeof promptLab.switchType === 'function') {
                promptLab.switchType('new-build');
            }
        }

        const classNames = ['forge-walkthrough-highlight', 'forge-product-tour-flash'];
        const selectors = [
            '#pl-task-section',
            '#pl-task-input'
        ];
        const deadline = Date.now() + 2000;

        const applyHighlight = () => {
            const elements = selectors
                .map(selector => document.querySelector(selector))
                .filter(el => el && el.nodeType === 1);

            if (!elements.length && Date.now() < deadline) {
                setTimeout(applyHighlight, 100);
                return;
            }

            if (!elements.length) {
                return;
            }

            const taskInput = document.querySelector('#pl-task-input');
            if (taskInput && typeof taskInput.focus === 'function') {
                try {
                    taskInput.focus();
                    const value = String(taskInput.value || '');
                    const caretPos = value.length;
                    if (typeof taskInput.setSelectionRange === 'function') {
                        taskInput.setSelectionRange(caretPos, caretPos);
                    }
                } catch (_) {
                    // Ignore focus errors from transient DOM state.
                }
            }

            elements.forEach(el => {
                classNames.forEach(className => el.classList.add(className));
            });

            setTimeout(() => {
                elements.forEach(el => {
                    classNames.forEach(className => el.classList.remove(className));
                });
            }, durationMs);
        };

        setTimeout(applyHighlight, 80);
    },

    _flashAiLauncherButton(durationMs = 5000) {
        this._ensureAiLauncherFlashStyle();
        this._flashButtonWithFallback({
            primaryId: 'open-ai-btn',
            fallbackId: 'ai-help-btn',
            durationMs
        });
    },

    _flashButtonWithFallback({ primaryId, fallbackId, durationMs = 5000 }) {
        const className = 'forge-ai-launcher-flash';
        const deadline = Date.now() + 2000;
        const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            const rendered = el.getClientRects().length > 0;
            return rendered && style.display !== 'none' && style.visibility !== 'hidden';
        };

        const tryStart = () => {
            const primary = primaryId ? document.getElementById(primaryId) : null;
            if (isVisible(primary)) {
                primary.classList.add(className);
                setTimeout(() => {
                    primary.classList.remove(className);
                }, durationMs);
                return;
            }

            if (Date.now() < deadline) {
                setTimeout(tryStart, 100);
                return;
            }

            const fallback = fallbackId ? document.getElementById(fallbackId) : null;
            if (!fallback) return;
            fallback.classList.add(className);
            setTimeout(() => {
                fallback.classList.remove(className);
            }, durationMs);
        };

        tryStart();
    },

    _registerBeginnerPromptFollowup() {
        if (this._beginnerPromptFollowupHandler) {
            document.removeEventListener('forge:quick-prompt-generated', this._beginnerPromptFollowupHandler);
            this._beginnerPromptFollowupHandler = null;
        }

        const handler = event => {
            const detail = event && event.detail ? event.detail : {};
            if (!detail || !detail.copied) return;
            document.removeEventListener('forge:quick-prompt-generated', handler);
            this._beginnerPromptFollowupHandler = null;

            Promise.resolve()
                .then(() => this._showExistingIndexLaunchAiModal())
                .then(() => this._flashAiLauncherButton(6000))
                .catch(err => {
                    console.warn('Could not show existing-index AI Services follow-up modal:', err);
                });
        };

        this._beginnerPromptFollowupHandler = handler;
        document.addEventListener('forge:quick-prompt-generated', handler);
    },

    _registerBeginnerPromptLabFollowup() {
        if (this._beginnerPromptLabFollowupHandler) {
            document.removeEventListener('forge:prompt-lab-copied', this._beginnerPromptLabFollowupHandler);
            this._beginnerPromptLabFollowupHandler = null;
        }

        const handler = event => {
            const detail = event && event.detail ? event.detail : {};
            if (!this._isBeginnerOnboardingActive()) return;
            if (!detail || !detail.copied || detail.source !== 'prompt-lab' || detail.type !== 'new-build') return;

            document.removeEventListener('forge:prompt-lab-copied', handler);
            this._beginnerPromptLabFollowupHandler = null;

            Promise.resolve()
                .then(() => this._showLaunchAiNextStepModal({ existingIndexUpgradeFlow: false }))
                .then(() => this._flashAiLauncherButton(6000))
                .catch(err => {
                    console.warn('Could not show Prompt Lab AI Services follow-up cue:', err);
                });
        };

        this._beginnerPromptLabFollowupHandler = handler;
        document.addEventListener('forge:prompt-lab-copied', handler);
    },

    async _showDecisionModal({
        modalId,
        title,
        bodyHtml,
        primaryText,
        secondaryText,
        singleAction = false,
        beforePrimary = null
    }) {
        const modalApi = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal : null;
        if (!modalApi) {
            return singleAction
                ? true
                : confirm('This folder is empty. Do you want Forge to auto-create index.html?');
        }

        this._ensureOnboardingModalStyle();

        let modalEl = document.getElementById(modalId);
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.className = 'modal fade forge-onboarding-modal';
            modalEl.id = modalId;
            modalEl.tabIndex = -1;
            modalEl.setAttribute('aria-hidden', 'true');
            modalEl.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"></h5>
                        </div>
                        <div class="modal-body"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-role="secondary"></button>
                            <button type="button" class="btn btn-primary" data-role="primary"></button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modalEl);
        }

        const titleEl = modalEl.querySelector('.modal-title');
        const bodyEl = modalEl.querySelector('.modal-body');
        const primaryBtn = modalEl.querySelector('[data-role="primary"]');
        const secondaryBtn = modalEl.querySelector('[data-role="secondary"]');

        titleEl.textContent = title || '';
        bodyEl.innerHTML = bodyHtml || '';
        this._wireStarterPromptComposers(bodyEl);
        this._wireInlineCopyButtons(bodyEl);
        primaryBtn.textContent = primaryText || 'Continue';
        secondaryBtn.textContent = secondaryText || 'Cancel';
        secondaryBtn.style.display = singleAction ? 'none' : '';

        return await new Promise(resolve => {
            const instance = modalApi.getOrCreateInstance(modalEl, {
                backdrop: 'static',
                keyboard: false
            });

            let settled = false;
            let pendingValue = singleAction ? true : false;
            const done = value => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };
            const releaseModalFocus = () => {
                try {
                    const focused = document.activeElement;
                    if (focused && modalEl.contains(focused) && typeof focused.blur === 'function') {
                        focused.blur();
                    }
                } catch (_) {
                    // no-op
                }
            };

            const onPrimary = async () => {
                if (typeof beforePrimary === 'function') {
                    let ok = false;
                    try {
                        ok = !!(await beforePrimary({
                            modalEl,
                            bodyEl,
                            primaryBtn,
                            secondaryBtn
                        }));
                    } catch (err) {
                        console.warn('Onboarding modal primary validation failed:', err);
                        ok = false;
                    }
                    if (!ok) {
                        return;
                    }
                }
                pendingValue = true;
                releaseModalFocus();
                instance.hide();
            };
            const onSecondary = () => {
                pendingValue = false;
                releaseModalFocus();
                instance.hide();
            };
            const onHide = () => {
                releaseModalFocus();
            };
            const onHidden = () => {
                releaseModalFocus();
                if (!settled) {
                    done(pendingValue);
                }
            };
            const onShown = () => {
                this._refreshStarterPromptComposers(bodyEl);
                const starterComposer = bodyEl.querySelector('textarea.forge-starter-prompt-composer');
                if (starterComposer && typeof starterComposer.focus === 'function') {
                    starterComposer.focus();
                    if (typeof starterComposer._forgeStarterComposerSetCaretStart === 'function') {
                        starterComposer._forgeStarterComposerSetCaretStart();
                    }
                }
            };
            const cleanup = () => {
                primaryBtn.removeEventListener('click', onPrimary);
                secondaryBtn.removeEventListener('click', onSecondary);
                modalEl.removeEventListener('hide.bs.modal', onHide);
                modalEl.removeEventListener('hidden.bs.modal', onHidden);
                modalEl.removeEventListener('shown.bs.modal', onShown);
            };

            primaryBtn.addEventListener('click', onPrimary);
            secondaryBtn.addEventListener('click', onSecondary);
            modalEl.addEventListener('hide.bs.modal', onHide);
            modalEl.addEventListener('hidden.bs.modal', onHidden);
            modalEl.addEventListener('shown.bs.modal', onShown);

            instance.show();
        });
    },

    _ensureOnboardingModalStyle() {
        if (document.getElementById('forge-onboarding-modal-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'forge-onboarding-modal-style';
        style.textContent = `
            .forge-onboarding-modal .modal-content {
                background: #1f252a;
                color: #e9ecef;
                border: 1px solid #3a434a;
            }
            .forge-onboarding-modal .modal-header,
            .forge-onboarding-modal .modal-footer {
                border-color: #3a434a;
            }
            .forge-onboarding-modal .modal-title,
            .forge-onboarding-modal p,
            .forge-onboarding-modal li,
            .forge-onboarding-modal strong,
            .forge-onboarding-modal small {
                color: #e9ecef;
            }
            .forge-onboarding-modal code {
                color: #9ad9ff;
            }
            .forge-onboarding-modal .forge-starter-prompt-box .btn.active {
                cursor: pointer;
            }
            .forge-onboarding-modal .forge-starter-prompt-request {
                background: #111821;
                color: #7fc0ff;
                border: 1px solid #3a434a;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            }
            .forge-onboarding-modal .forge-starter-prompt-composer-wrap {
                position: relative;
            }
            .forge-onboarding-modal .forge-starter-prompt-composer {
                background: #0f1721;
                color: #d7ecff;
                border-color: #3f4d5a;
                line-height: 1.35;
                min-height: 7.2rem;
                padding: 0.6rem 0.7rem;
                resize: vertical;
            }
            .forge-onboarding-modal .forge-starter-prompt-ghost {
                position: absolute;
                left: 0.7rem;
                top: 0.7rem;
                display: block;
                pointer-events: none;
                user-select: none;
            }
            .forge-onboarding-modal .forge-starter-prompt-caret {
                position: absolute;
                top: 0.14rem;
                left: 0;
                width: 2px;
                height: 1.06rem;
                background: #9fdbff;
                border-radius: 1px;
                animation: forge-starter-caret-blink 0.95s steps(1, end) infinite;
            }
            .forge-onboarding-modal .forge-starter-prompt-composer:focus + .forge-starter-prompt-ghost .forge-starter-prompt-caret {
                display: none;
            }
            .forge-onboarding-modal .forge-starter-prompt-placeholder {
                display: block;
                white-space: pre-wrap;
                word-break: break-word;
                overflow-wrap: anywhere;
                color: rgba(130, 172, 206, 0.58);
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 0.87rem;
            }
            @keyframes forge-starter-caret-blink {
                0%, 48% { opacity: 1; }
                49%, 100% { opacity: 0; }
            }
            .forge-onboarding-modal .forge-starter-prompt-prefix-measure {
                position: absolute;
                visibility: hidden;
                pointer-events: none;
                white-space: pre-wrap;
                word-break: break-word;
                overflow-wrap: anywhere;
            }
            .forge-onboarding-modal .forge-starter-prompt-request::placeholder {
                color: #7fc0ff;
                opacity: 0.95;
            }
        `;
        document.head.appendChild(style);
    },

    _wireStarterPromptComposers(containerEl) {
        if (!containerEl) return;
        const composers = containerEl.querySelectorAll('textarea.forge-starter-prompt-composer');
        composers.forEach(inputEl => {
            if (inputEl.dataset.starterComposerBound === '1') {
                if (typeof inputEl._forgeStarterComposerRefresh === 'function') {
                    inputEl._forgeStarterComposerRefresh();
                }
                return;
            }
            inputEl.dataset.starterComposerBound = '1';

            const prefix = this._getStarterNewBuildPrefix();
            const prefixLen = prefix.length;
            const ghostId = inputEl.getAttribute('data-starter-ghost-id');
            const ghostEl = ghostId
                ? (containerEl.querySelector(`#${ghostId}`) || document.getElementById(ghostId))
                : null;
            const placeholderText = String(inputEl.getAttribute('data-starter-placeholder') || '').trim();
            const placeholderEl = ghostEl ? ghostEl.querySelector('[data-starter-placeholder-text]') : null;
            const caretEl = ghostEl ? ghostEl.querySelector('.forge-starter-prompt-caret') : null;
            if (placeholderEl) {
                placeholderEl.textContent = placeholderText;
            }

            const setCaret = (pos) => {
                const nextPos = Math.max(prefixLen, Number(pos || prefixLen));
                try {
                    inputEl.setSelectionRange(nextPos, nextPos);
                } catch (_) {
                    // no-op
                }
            };
            inputEl._forgeStarterComposerSetCaretStart = () => setCaret(prefixLen);

            const syncComposerValue = () => {
                const rawValue = String(inputEl.value || '').replace(/\r\n/g, '\n');
                const request = this._extractStarterRequestFromComposer(rawValue, { trim: false });
                inputEl.value = `${prefix}${request}`;
            };

            const refreshGhost = () => {
                if (!ghostEl) return;
                const request = this._extractStarterRequestFromComposer(inputEl.value);
                ghostEl.style.display = request ? 'none' : 'block';
            };

            const positionGhostAtInsertPoint = () => {
                if (!ghostEl) return;

                const wrapEl = ghostEl.parentElement;
                if (!wrapEl) return;

                let measureEl = wrapEl.querySelector('.forge-starter-prompt-prefix-measure');
                if (!measureEl) {
                    measureEl = document.createElement('div');
                    measureEl.className = 'forge-starter-prompt-prefix-measure';
                    wrapEl.appendChild(measureEl);
                }

                const computed = window.getComputedStyle(inputEl);
                const paddingLeft = parseFloat(computed.paddingLeft || '0') || 0;
                const paddingTop = parseFloat(computed.paddingTop || '0') || 0;
                const paddingRight = parseFloat(computed.paddingRight || '0') || 0;
                const contentWidth = Math.max(0, inputEl.clientWidth - paddingLeft - paddingRight);

                measureEl.style.left = `${paddingLeft}px`;
                measureEl.style.top = `${paddingTop}px`;
                measureEl.style.width = `${contentWidth}px`;
                measureEl.style.fontFamily = computed.fontFamily;
                measureEl.style.fontSize = computed.fontSize;
                measureEl.style.fontWeight = computed.fontWeight;
                measureEl.style.lineHeight = computed.lineHeight;
                measureEl.style.letterSpacing = computed.letterSpacing;
                measureEl.style.textTransform = computed.textTransform;

                measureEl.textContent = '';
                const textNode = document.createTextNode(prefix);
                const marker = document.createElement('span');
                marker.textContent = '\u200b';
                measureEl.appendChild(textNode);
                measureEl.appendChild(marker);

                const measureRect = measureEl.getBoundingClientRect();
                const markerRect = marker.getBoundingClientRect();
                const markerX = markerRect.left - measureRect.left;
                const markerY = markerRect.top - measureRect.top;
                const scrollLeft = Number(inputEl.scrollLeft || 0);
                const scrollTop = Number(inputEl.scrollTop || 0);
                const caretGapPx = 6;
                const firstLineIndent = Math.max(0, markerX + caretGapPx + 2);

                ghostEl.style.left = `${Math.round(paddingLeft - scrollLeft)}px`;
                ghostEl.style.top = `${Math.round(paddingTop + markerY - scrollTop)}px`;
                ghostEl.style.width = `${Math.round(contentWidth)}px`;
                if (caretEl) {
                    caretEl.style.left = `${Math.round(markerX)}px`;
                }
                if (placeholderEl) {
                    placeholderEl.style.textIndent = `${Math.round(firstLineIndent)}px`;
                }
            };

            const clampCaretToEditableRegion = () => {
                const start = Number(inputEl.selectionStart || 0);
                const end = Number(inputEl.selectionEnd || 0);
                if (start < prefixLen || end < prefixLen) {
                    setCaret(prefixLen);
                }
            };

            if (!String(inputEl.value || '').startsWith(prefix)) {
                inputEl.value = prefix;
            }
            refreshGhost();
            positionGhostAtInsertPoint();

            const onFocus = () => {
                clampCaretToEditableRegion();
                refreshGhost();
                positionGhostAtInsertPoint();
            };

            inputEl._forgeStarterComposerRefresh = () => {
                refreshGhost();
                positionGhostAtInsertPoint();
            };

            inputEl.addEventListener('focus', onFocus);
            inputEl.addEventListener('click', clampCaretToEditableRegion);
            inputEl.addEventListener('mouseup', clampCaretToEditableRegion);
            inputEl.addEventListener('keyup', clampCaretToEditableRegion);
            inputEl.addEventListener('scroll', positionGhostAtInsertPoint);

            inputEl.addEventListener('keydown', (event) => {
                if (event.ctrlKey || event.metaKey || event.altKey) return;
                const start = Number(inputEl.selectionStart || 0);
                const end = Number(inputEl.selectionEnd || 0);

                if ((event.key === 'Backspace' || event.key === 'ArrowLeft' || event.key === 'Home') && start <= prefixLen && end <= prefixLen) {
                    event.preventDefault();
                    setCaret(prefixLen);
                    return;
                }
                if (event.key === 'Delete' && start < prefixLen && end <= prefixLen) {
                    event.preventDefault();
                    setCaret(prefixLen);
                    return;
                }
            });

            inputEl.addEventListener('beforeinput', (event) => {
                const start = Number(inputEl.selectionStart || 0);
                const end = Number(inputEl.selectionEnd || 0);
                if (start < prefixLen || end < prefixLen) {
                    event.preventDefault();
                    setCaret(prefixLen);
                }
            });

            inputEl.addEventListener('paste', (event) => {
                const start = Number(inputEl.selectionStart || 0);
                const end = Number(inputEl.selectionEnd || 0);
                if (start >= prefixLen && end >= prefixLen) return;
                event.preventDefault();

                const pasted = (event.clipboardData || window.clipboardData)?.getData?.('text') || '';
                const existingRequest = this._extractStarterRequestFromComposer(inputEl.value, { trim: false });
                inputEl.value = `${prefix}${pasted}${existingRequest}`;
                setCaret(prefixLen + String(pasted).length);
                refreshGhost();
            });

            inputEl.addEventListener('input', () => {
                syncComposerValue();
                clampCaretToEditableRegion();
                refreshGhost();
                positionGhostAtInsertPoint();
            });

            setTimeout(() => {
                if (!inputEl.isConnected) return;
                if (inputEl.hasAttribute('autofocus')) {
                    inputEl.focus();
                }
                if (document.activeElement !== inputEl) return;
                setCaret(prefixLen);
                positionGhostAtInsertPoint();
            }, 0);
        });
    },

    _refreshStarterPromptComposers(containerEl) {
        if (!containerEl) return;
        const composers = containerEl.querySelectorAll('textarea.forge-starter-prompt-composer');
        composers.forEach(inputEl => {
            if (typeof inputEl._forgeStarterComposerRefresh === 'function') {
                inputEl._forgeStarterComposerRefresh();
            }
        });
    },

    _wireInlineCopyButtons(containerEl) {
        if (!containerEl) return;
        const buttons = containerEl.querySelectorAll('button[data-copy-text], button[data-copy-target]');
        buttons.forEach(btn => {
            if (btn.dataset.copyBound === '1') return;
            btn.dataset.copyBound = '1';
            btn.dataset.copyCompleted = '0';
            btn.dataset.copyNeedsInput = '0';
            const defaultBtnText = btn.textContent || 'Copy';
            const targetSelector = btn.getAttribute('data-copy-target');
            const warningSelector = btn.getAttribute('data-copy-warning-target');
            const defaultStatusText = btn.getAttribute('data-copy-default-status') || '';
            const statusEl = btn.id ? containerEl.querySelector(`[data-copy-status-for="${btn.id}"]`) : null;
            const warningEl = warningSelector
                ? (containerEl.querySelector(warningSelector) || document.querySelector(warningSelector))
                : null;
            if (statusEl && defaultStatusText) {
                statusEl.textContent = defaultStatusText;
            }

            const resetCopiedState = () => {
                btn.dataset.copyCompleted = '0';
                btn.dataset.copyNeedsInput = '0';
                btn.classList.remove('btn-success', 'active', 'btn-outline-warning', 'btn-secondary', 'btn-primary');
                btn.classList.add('btn-outline-info');
                btn.textContent = defaultBtnText;
                if (statusEl && defaultStatusText) {
                    statusEl.textContent = defaultStatusText;
                }
                if (warningEl) {
                    warningEl.textContent = '';
                }
            };

            if (targetSelector) {
                const sourceEl = containerEl.querySelector(targetSelector) || document.querySelector(targetSelector);
                if (sourceEl && btn.dataset.copySourceBound !== '1') {
                    sourceEl.addEventListener('input', () => {
                        if (btn.dataset.copyCompleted === '1' || btn.dataset.copyNeedsInput === '1') {
                            resetCopiedState();
                        } else if (warningEl) {
                            warningEl.textContent = '';
                        }
                    });
                    btn.dataset.copySourceBound = '1';
                }
            }

            btn.addEventListener('click', async () => {
                const prefixSelector = btn.getAttribute('data-copy-prefix-target');
                const copyTemplate = String(btn.getAttribute('data-copy-template') || '').toLowerCase();
                let copyText = btn.getAttribute('data-copy-text') || '';
                if (!copyText && targetSelector) {
                    const source = containerEl.querySelector(targetSelector) || document.querySelector(targetSelector);
                    if (source) {
                        copyText = 'value' in source ? source.value : (source.textContent || '');
                    }
                }

                if (copyTemplate === 'new-build-composer') {
                    const requestFromComposer = this._extractStarterRequestFromComposer(copyText);
                    if (!requestFromComposer) {
                        btn.dataset.copyCompleted = '0';
                        btn.dataset.copyNeedsInput = '1';
                        btn.classList.remove('btn-success', 'active', 'btn-primary', 'btn-secondary');
                        btn.classList.add('btn-outline-warning');
                        btn.textContent = 'Type Request First';
                        if (statusEl) {
                            statusEl.textContent = 'Type what you want first, then click Generate + Copy Prompt.';
                        }
                        if (warningEl) {
                            warningEl.textContent = 'Type what you want this app to do before copying the prompt.';
                        }
                        return;
                    }
                    copyText = this._buildStarterNewBuildPrompt(requestFromComposer);
                }

                const emptyFallback = btn.getAttribute('data-copy-empty-fallback') || '';
                if (!copyText && emptyFallback) {
                    copyText = emptyFallback;
                }

                let copyPrefix = '';
                if (copyTemplate === 'new-build') {
                    copyText = this._buildStarterNewBuildPrompt(copyText);
                } else if (prefixSelector) {
                    const prefixSource = containerEl.querySelector(prefixSelector) || document.querySelector(prefixSelector);
                    if (prefixSource) {
                        copyPrefix = 'value' in prefixSource ? prefixSource.value : (prefixSource.textContent || '');
                    }
                }

                if (copyPrefix) {
                    copyText = `${copyPrefix}${copyText}`;
                }
                if (!copyText) return;

                const copied = await this._copyTextToClipboard(copyText);
                if (copied) {
                    btn.dataset.copyCompleted = '1';
                    btn.classList.remove('btn-outline-info', 'btn-outline-warning', 'btn-secondary', 'btn-primary');
                    btn.classList.add('btn-success', 'active');
                    btn.textContent = 'Copied to Clipboard (Ready to Paste)';
                    if (statusEl) {
                        const successStatus = btn.getAttribute('data-copy-success-status')
                            || (prefixSelector ? 'Copied full prompt to your clipboard.' : 'Copied to your clipboard.');
                        statusEl.textContent = successStatus;
                    }
                    if (warningEl) {
                        warningEl.textContent = '';
                    }
                } else {
                    btn.dataset.copyCompleted = '0';
                    btn.classList.remove('btn-success', 'active');
                    btn.classList.add('btn-outline-warning');
                    btn.textContent = 'Copy Failed - Try Again';
                    if (statusEl) {
                        const failStatus = btn.getAttribute('data-copy-fail-status') || 'Copy failed. Click to try again.';
                        statusEl.textContent = failStatus;
                    }
                }
            });
        });
    },

    async _copyTextToClipboard(text) {
        if (!text) {
            return false;
        }

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {
            // Fallback below for contexts where Clipboard API is blocked.
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

    _ensureAiLauncherFlashStyle() {
        if (document.getElementById('forge-ai-launcher-flash-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'forge-ai-launcher-flash-style';
        style.textContent = `
            @keyframes forge-ai-launcher-pulse {
                0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 193, 7, 0); }
                50% { transform: scale(1.06); box-shadow: 0 0 0 0.4rem rgba(255, 193, 7, 0.55); }
            }
            .forge-ai-launcher-flash {
                animation: forge-ai-launcher-pulse 0.6s ease-in-out infinite;
            }
        `;
        document.head.appendChild(style);
    },

    _checkHtmlFileWarnings() {
        // Find all HTML files in root directory only
        const htmlFiles = this.fileStructure.filter(f =>
            f.kind === 'file' &&
            f.path.length === 0 &&
            f.name.toLowerCase().endsWith('.html')
        );

        const hasIndexHtml = htmlFiles.some(f => f.name.toLowerCase() === 'index.html');
        const nonIndexHtmlFiles = htmlFiles.filter(f => f.name.toLowerCase() !== 'index.html');

        // Show or hide warning banner
        let warningEl = document.getElementById('html-file-warning');

        // If we have index.html AND no other html files, no warning needed
        if (hasIndexHtml && htmlFiles.length === 1) {
            if (warningEl) warningEl.remove();
            return;
        }

        // Build warning content based on situation
        let warningContent = '';
        let actionButtons = '';

        if (htmlFiles.length === 0) {
            warningContent = '⚠️ No HTML files found in project root.';
        } else if (htmlFiles.length === 1) {
            // Single HTML file, not named index.html - offer to rename
            const file = htmlFiles[0];
            warningContent = `⚠️ Found "<strong>${file.name}</strong>" but no index.html.`;
            actionButtons = `
                <button class="btn btn-sm btn-warning ms-2" id="rename-to-index-btn" data-uuid="${file.uuid}">
                    Rename to index.html
                </button>`;
        } else if (hasIndexHtml && htmlFiles.length > 1) {
            // Index.html exists but there are others
            warningContent = `⚠️ Multiple HTML files found. Forge relies on <strong>index.html</strong> as the single entry point.`;
            // No action button needed, just the warning
            actionButtons = '';
        } else {
            // Multiple HTML files, none is index.html - offer selection
            warningContent = `⚠️ Multiple HTML files found (${htmlFiles.map(f => f.name).join(', ')}) but no index.html.`;
            const options = nonIndexHtmlFiles.map(f =>
                `<option value="${f.uuid}">${f.name}</option>`
            ).join('');
            actionButtons = `
                <div class="d-inline-flex align-items-center ms-2">
                    <select id="rename-select" class="form-select form-select-sm" style="max-width: 150px; font-size: 0.8rem;">
                        ${options}
                    </select>
                    <button class="btn btn-sm btn-warning ms-1" id="rename-selected-btn">
                        Rename to index.html
                    </button>
                </div>`;
        }

        const warningHtml = `
            <div id="html-file-warning" class="alert alert-warning alert-dismissible fade show mb-0 py-2 px-3 d-flex align-items-center flex-wrap" role="alert" style="font-size: 0.85rem; border-radius: 0;">
                <div>
                    <strong>Project Warning:</strong> ${warningContent}
                    <br><small>The Compiler looks for <code>index.html</code> as the starting point.</small>
                </div>
                ${actionButtons}
                <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert" aria-label="Close" style="padding: 0.5rem;"></button>
            </div>`;

        if (!warningEl) {
            $('#editor-header').after(warningHtml);
        } else {
            $(warningEl).replaceWith(warningHtml);
        }

        // Bind rename button handlers
        $('#rename-to-index-btn').off('click').on('click', async function () {
            const button = this;
            if (button.disabled) return;
            const uuid = $(this).data('uuid');
            if (uuid) {
                button.disabled = true;
                const previousText = button.textContent;
                button.textContent = 'Renaming...';
                try {
                    const renamed = await loadFolder.renameFile(uuid, 'index.html');
                    if (renamed !== false) loadFolder._checkHtmlFileWarnings();
                } finally {
                    if (document.body.contains(button)) {
                        button.disabled = false;
                        button.textContent = previousText;
                    }
                }
            }
        });

        $('#rename-selected-btn').off('click').on('click', async function () {
            const button = this;
            if (button.disabled) return;
            const uuid = $('#rename-select').val();
            if (uuid) {
                button.disabled = true;
                const previousText = button.textContent;
                button.textContent = 'Renaming...';
                try {
                    const renamed = await loadFolder.renameFile(uuid, 'index.html');
                    if (renamed !== false) loadFolder._checkHtmlFileWarnings();
                } finally {
                    if (document.body.contains(button)) {
                        button.disabled = false;
                        button.textContent = previousText;
                    }
                }
            }
        });
    },

    _cleanupBeforeNewFolder() {
        if (this._beginnerPromptFollowupHandler) {
            document.removeEventListener('forge:quick-prompt-generated', this._beginnerPromptFollowupHandler);
            this._beginnerPromptFollowupHandler = null;
        }
        if (this._beginnerPromptLabFollowupHandler) {
            document.removeEventListener('forge:prompt-lab-copied', this._beginnerPromptLabFollowupHandler);
            this._beginnerPromptLabFollowupHandler = null;
        }
        if (this._renameInFlight && typeof this._renameInFlight.clear === 'function') {
            this._renameInFlight.clear();
        }

        const hintApi = window && window.forgeBeginnerInlineHint ? window.forgeBeginnerInlineHint : null;
        if (hintApi && typeof hintApi.hide === 'function') {
            hintApi.hide();
        }

        this._stopAutoSync();
        // Close all open editor tabs
        if (editor && editor.instance) {
            const openUuids = Object.keys(editor.instance);
            openUuids.forEach(uuid => {
                try {
                    editor.deleteTab(uuid, { force: true });
                } catch (e) {
                    console.warn('Error closing tab:', uuid, e);
                }
            });
        }

        // Clear editor state
        if (editor) {
            editor.instance = {};
            editor.dirtyFiles.clear();
            editor._meta = {};
        }

        // Clear file tree
        $('#file-tree').empty();

        // Reset file structure
        this.fileStructure = [];
        this._updateSignature();
        this._referenceHighlights = null;
        this._referenceRefreshToken = 0;

        // Clear any context menus
        document.querySelectorAll('.context-menu').forEach(menu => menu.remove());
    },

    escapeHtml(value) {
        const str = value == null ? '' : String(value);
        return str.replace(/[&<>"'`=\/]/g, char => HTML_ESCAPE_MAP[char] || char);
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

    _isJsPath(path) {
        return /\.(?:js|mjs|cjs)$/i.test(String(path || ''));
    },

    _isCssPath(path) {
        return /\.css$/i.test(String(path || ''));
    },

    _isHtmlPath(path) {
        return /\.html?$/i.test(String(path || ''));
    },

    _isTreeHiddenFile(file) {
        if (!file || file.kind !== 'file') return false;
        return String(file.name || '').trim().toLowerCase() === 'compiled-hashes.csv';
    },

    _isPrimaryEditorTypePath(path) {
        return this._isJsPath(path) || this._isCssPath(path) || this._isHtmlPath(path);
    },

    _resolveHtmlRefToProjectPath(ref, basePath = []) {
        const raw = String(ref || '').trim();
        if (!raw) return null;
        if (raw.startsWith('#')) return null;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return null;

        const clean = raw.split('#')[0].split('?')[0].trim();
        if (!clean) return null;

        if (clean.startsWith('/')) {
            return this._normalizeProjectPath(clean.replace(/^\/+/, ''));
        }
        return this._normalizeProjectPath([...basePath, clean].join('/'));
    },

    _pickPrimaryHtmlForReferences() {
        const htmlFiles = (this.fileStructure || []).filter(f =>
            f &&
            f.kind === 'file' &&
            this._isHtmlPath(f.name || '')
        );
        if (!htmlFiles.length) return null;

        const rootIndex = htmlFiles.find(f => (f.path || []).length === 0 && String(f.name || '').toLowerCase() === 'index.html');
        if (rootIndex) return rootIndex;

        const rootAny = htmlFiles.find(f => (f.path || []).length === 0);
        if (rootAny) return rootAny;

        return htmlFiles[0];
    },

    async _refreshReferenceHighlights() {
        const token = ++this._referenceRefreshToken;
        const defaultState = {
            sourceHtmlRelativePath: '',
            indexHtmlRelativePath: '',
            referenced: new Set(),
            missing: [],
            populated: new Map()
        };
        if (!this.fileHandle) {
            this._referenceHighlights = defaultState;
            return;
        }

        try {
            const htmlFiles = (this.fileStructure || []).filter(f =>
                f &&
                f.kind === 'file' &&
                this._isHtmlPath(f.name || '')
            );
            const preferredIndexHtml =
                htmlFiles.find(f => (f.path || []).length === 0 && String(f.name || '').toLowerCase() === 'index.html') ||
                htmlFiles.find(f => String(f.name || '').toLowerCase() === 'index.html') ||
                null;

            const htmlFile = this._pickPrimaryHtmlForReferences();
            if (!htmlFile) {
                this._referenceHighlights = {
                    ...defaultState,
                    indexHtmlRelativePath: preferredIndexHtml ? this._normalizeProjectPath(preferredIndexHtml.relativePath) : ''
                };
                return;
            }

            const htmlContent = await this.getFileContent(htmlFile);
            if (token !== this._referenceRefreshToken) return;

            const basePath = Array.isArray(htmlFile.path) ? htmlFile.path.slice() : [];
            const referencedMap = new Map(); // key -> { type, projectPath }

            const addReference = (refValue, type) => {
                const projectPath = this._resolveHtmlRefToProjectPath(refValue, basePath);
                if (!projectPath) return;
                if (type === 'js' && !this._isJsPath(projectPath)) return;
                if (type === 'css' && !this._isCssPath(projectPath)) return;
                const key = projectPath.toLowerCase();
                if (!referencedMap.has(key)) {
                    referencedMap.set(key, { type, projectPath });
                }
            };

            try {
                if (typeof DOMParser === 'function') {
                    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
                    const scriptNodes = Array.from(doc.querySelectorAll('script[src]'));
                    scriptNodes.forEach(node => {
                        const src = node.getAttribute('src');
                        if (src) addReference(src, 'js');
                    });

                    const linkNodes = Array.from(doc.querySelectorAll('link[href]'));
                    linkNodes.forEach(node => {
                        const href = node.getAttribute('href');
                        if (!href) return;
                        const rel = String(node.getAttribute('rel') || '').toLowerCase();
                        const isStylesheet = rel.split(/\s+/).includes('stylesheet') || this._isCssPath(href);
                        if (!isStylesheet) return;
                        addReference(href, 'css');
                    });
                }
            } catch (parseErr) {
                console.warn('Could not parse HTML for reference highlighting:', parseErr);
            }

            const existingPaths = new Set(
                (this.fileStructure || [])
                    .filter(f => f && f.kind === 'file' && (this._isJsPath(f.relativePath) || this._isCssPath(f.relativePath)))
                    .map(f => this._normalizeProjectPath(f.relativePath).toLowerCase())
            );

            const missing = [];
            for (const ref of referencedMap.values()) {
                const key = ref.projectPath.toLowerCase();
                if (!existingPaths.has(key)) {
                    const parts = ref.projectPath.split('/').filter(Boolean);
                    const name = parts.length ? parts[parts.length - 1] : ref.projectPath;
                    const path = parts.slice(0, -1);
                    missing.push({
                        type: ref.type,
                        relativePath: ref.projectPath,
                        name,
                        path
                    });
                }
            }

            const textFiles = (this.fileStructure || []).filter(f =>
                f &&
                f.kind === 'file' &&
                (this._isJsPath(f.relativePath) || this._isCssPath(f.relativePath) || this._isHtmlPath(f.relativePath))
            );
            const populated = new Map();
            await Promise.all(textFiles.map(async f => {
                try {
                    const content = await this.getFileContent(f);
                    const key = this._normalizeProjectPath(f.relativePath).toLowerCase();
                    populated.set(key, String(content || '').trim().length > 0);
                } catch (_) {
                    const key = this._normalizeProjectPath(f.relativePath).toLowerCase();
                    // If unreadable for some reason, treat as populated to avoid false "empty" warnings.
                    populated.set(key, true);
                }
            }));
            if (token !== this._referenceRefreshToken) return;

            this._referenceHighlights = {
                sourceHtmlRelativePath: this._normalizeProjectPath(htmlFile.relativePath),
                indexHtmlRelativePath: preferredIndexHtml ? this._normalizeProjectPath(preferredIndexHtml.relativePath) : '',
                referenced: new Set(Array.from(referencedMap.keys())),
                missing,
                populated
            };
        } catch (err) {
            console.warn('Reference highlight refresh failed:', err);
            this._referenceHighlights = defaultState;
        }
    },

    _getFileVisualStatus(file) {
        const state = this._referenceHighlights || {
            referenced: new Set(),
            sourceHtmlRelativePath: '',
            indexHtmlRelativePath: '',
            populated: new Map()
        };
        const rel = this._normalizeProjectPath(file?.relativePath || '').toLowerCase();
        if (!rel) return '';

        if (file && file._missingReference) {
            return 'missing-referenced';
        }

        if (this._isHtmlPath(file?.relativePath)) {
            const indexKey = String(state.indexHtmlRelativePath || '').toLowerCase();
            if (indexKey && rel === indexKey) return 'index-html';
            return 'extra-html';
        }

        if (this._isJsPath(file?.relativePath) || this._isCssPath(file?.relativePath)) {
            const hasContent = state.populated instanceof Map ? state.populated.get(rel) : undefined;
            if (hasContent === false) return 'empty';
            return state.referenced.has(rel) ? 'referenced-populated' : 'unreferenced-populated';
        }

        if (state.populated instanceof Map && state.populated.get(rel) === false) {
            return 'empty';
        }
        return '';
    },

    _withMissingReferenceEntries(files) {
        const list = Array.isArray(files) ? files.slice() : [];
        const state = this._referenceHighlights || { missing: [] };
        const existing = new Set(list.filter(f => f && f.kind === 'file').map(f => this._normalizeProjectPath(f.relativePath).toLowerCase()));
        for (const m of (state.missing || [])) {
            const key = this._normalizeProjectPath(m.relativePath).toLowerCase();
            if (!key || existing.has(key)) continue;
            list.push({
                name: m.name,
                path: Array.isArray(m.path) ? m.path.slice() : [],
                type: m.type === 'css' ? 'css' : 'js',
                kind: 'file',
                entry: null,
                uuid: `missing:${key}`,
                relativePath: this._normalizeProjectPath(m.relativePath),
                _missingReference: true
            });
        }
        return list;
    },

    _injectFileTreeReferenceStyles() {
        if (document.getElementById('forge-file-ref-style')) return;
        const style = document.createElement('style');
        style.id = 'forge-file-ref-style';
        style.textContent = `
            #file-tree .directory-label {
                display: inline-flex;
                align-items: center;
                gap: 0.35rem;
            }
            #file-tree .forge-create-file-btn {
                border: 1px solid #3a434a;
                background: #2b3238;
                color: #e9ecef;
                font-size: 0.68rem;
                line-height: 1;
                border-radius: 4px;
                padding: 0.12rem 0.32rem;
                cursor: pointer;
            }
            #file-tree .forge-create-file-btn:hover {
                background: #3a434a;
            }
            #file-tree .forge-create-folder-btn {
                border: 1px solid #3a434a;
                background: #2b3238;
                color: #e9ecef;
                font-size: 0.68rem;
                line-height: 1;
                border-radius: 4px;
                padding: 0.12rem 0.32rem;
                cursor: pointer;
            }
            #file-tree .forge-create-folder-btn:hover {
                background: #3a434a;
            }
            #file-tree .forge-file-referenced-populated > .file-label,
            #file-tree .forge-file-index-html > .file-label {
                color: #72d572;
            }
            #file-tree .forge-file-unreferenced-populated > .file-label {
                color: #ffd666;
            }
            #file-tree .forge-file-missing-referenced > .file-label {
                color: #a7adb4;
            }
            #file-tree .forge-file-missing-referenced > .file-label .forge-missing-icon {
                color: #c6b36a;
                margin-right: 0.2rem;
            }
            #file-tree .forge-file-extra-html > .file-label {
                color: #ff7b7b;
            }
            #file-tree .forge-file-empty > .file-label {
                color: #ffffff;
            }
            #file-tree .forge-file-other > .file-label {
                color: #a7adb4;
            }
        `;
        document.head.appendChild(style);
    },

    _renderFileTree() {
        if (!this.fileHandle) return;
        const fileTreeHtml = this.buildFileTreeHtml(this.fileHandle.name, this.fileStructure || []);
        $('#file-tree').html(fileTreeHtml);
        this.ensureTreeEventBindings();
    },

    async _createMissingReferencedFile(relativePath) {
        const normalized = this._normalizeProjectPath(relativePath);
        if (!normalized) return;

        const existing = (this.fileStructure || []).find(f =>
            f &&
            f.kind === 'file' &&
            this._normalizeProjectPath(f.relativePath).toLowerCase() === normalized.toLowerCase()
        );
        if (existing) {
            editor.openFile(existing.uuid);
            return;
        }

        const parts = normalized.split('/').filter(Boolean);
        const name = parts.pop();
        if (!name) return;
        await this.createNewFile(name, parts);
    },

    buildFileTreeHtml(rootName, files) {
        // Inject (once) minimal styles for drag & drop highlighting
        if (!document.getElementById('dragdrop-style')) {
            const style = document.createElement('style');
            style.id = 'dragdrop-style';
            style.textContent = `
                        .drop-target { background: rgba(255,255,255,0.08); }
            `;
            document.head.appendChild(style);
        }
        this._injectFileTreeReferenceStyles();

        const augmentedFiles = this._withMissingReferenceEntries(files);
        const visibleFiles = augmentedFiles.filter(file => !this._isTreeHiddenFile(file));
        const tree = {};
        visibleFiles.forEach(file => {
            let path = file.relativePath.split('/');
            let currentLevel = tree;
            path.forEach((part, index) => {
                if (index === path.length - 1 && file.kind === 'file') {
                    if (!currentLevel._files) currentLevel._files = [];
                    currentLevel._files.push(file);
                } else {
                    if (!currentLevel[part]) currentLevel[part] = {};
                    currentLevel = currentLevel[part];
                }
            });
        });

        const createHtml = (node, currentPath = []) => {
            let html = "<ul style='color:white; padding-left: 15px;'>";

            (node._files || []).sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
                const escapedName = this.escapeHtml(file.name);
                const status = this._getFileVisualStatus(file);
                const classes = ['file'];
                if (status) classes.push(`forge-file-${status}`);
                if (!this._isPrimaryEditorTypePath(file?.relativePath || file?.name || '')) {
                    classes.push('forge-file-other');
                }
                const classAttr = classes.join(' ');
                const canOpen = !file._missingReference && !!file.uuid;
                const title = status === 'missing-referenced'
                    ? 'Referenced in HTML but missing. Click to create.'
                    : (status === 'referenced-populated'
                        ? 'Populated and referenced in HTML'
                        : (status === 'unreferenced-populated'
                            ? 'Populated but not referenced in HTML'
                            : (status === 'empty'
                                ? 'File exists but has no content'
                                : (status === 'index-html'
                                    ? 'Primary index.html entry point'
                                    : (status === 'extra-html'
                                        ? 'Extra HTML file (not primary index.html)'
                                        : 'Right-click for options')))));
                const openAttrs = canOpen ? `draggable="true" data-uuid="${file.uuid}"` : `data-missing-path="${this.escapeHtml(file.relativePath)}"`;
                const caution = status === 'missing-referenced'
                    ? '<span class="forge-missing-icon" aria-hidden="true">⚠</span>'
                    : '';
                html += `<li class="${classAttr}" ${openAttrs} data-type="file" title="${this.escapeHtml(title)}">
                                    <span class="file-label" data-role="file-label">${caution}${escapedName}</span>
                                 </li>`;
            });

            const sortedKeys = Object.keys(node).filter(k => k !== '_files').sort();
            sortedKeys.forEach(key => {
                const uuid = this.createUuid();
                const newPath = key === rootName ? [] : [...currentPath, key];
                const pathString = newPath.join('/');
                const escapedKey = this.escapeHtml(key);
                const addFileBtn = `<button type="button" class="forge-create-file-btn" data-role="create-file-btn" data-path="${this.escapeHtml(pathString)}" title="Create file in this folder">+ File</button>`;
                const addFolderBtn = `<button type="button" class="forge-create-folder-btn" data-role="create-folder-btn" data-path="${this.escapeHtml(pathString)}" title="Create folder in this folder">+ Folder</button>`;
                html += `<li class="directoryOpen" data-path="${pathString}" data-type="directory" id="${uuid}" title="Right-click for options">
                                    <div class="directory-label" data-role="directory-label"><span>${escapedKey}</span>${addFileBtn}${addFolderBtn}</div>
                                    ${createHtml(node[key], newPath)}
                                 </li>`;
            });

            return html + "</ul>";
        };

        let rootWrapper = {};
        rootWrapper[rootName] = tree;
        return createHtml(rootWrapper, []);
    },

    ensureTreeEventBindings() {
        const tree = document.getElementById('file-tree');
        if (!tree) {
            return;
        }

        if (!this._treeHandlerRefs) {
            this._treeHandlerRefs = {
                click: event => this._handleTreeClick(event),
                contextmenu: event => this._handleTreeContextMenu(event),
                dragstart: event => this._handleTreeDragStart(event),
                dragover: event => this._handleTreeDragOver(event),
                dragleave: event => this._handleTreeDragLeave(event),
                drop: event => this._handleTreeDrop(event)
            };
        }

        if (tree.dataset.treeEventsBound === '1') {
            return;
        }

        Object.entries(this._treeHandlerRefs).forEach(([type, handler]) => {
            tree.addEventListener(type, handler);
        });
        tree.dataset.treeEventsBound = '1';
    },

    async _handleTreeClick(event) {
        const tree = document.getElementById('file-tree');
        if (!tree || !tree.contains(event.target)) return;

        const createBtn = event.target.closest('button[data-role="create-file-btn"]');
        if (createBtn && tree.contains(createBtn)) {
            event.preventDefault();
            event.stopPropagation();
            const path = createBtn.getAttribute('data-path') || '';
            this.showCreateFileDialog(path);
            return;
        }

        const createFolderBtn = event.target.closest('button[data-role="create-folder-btn"]');
        if (createFolderBtn && tree.contains(createFolderBtn)) {
            event.preventDefault();
            event.stopPropagation();
            const path = createFolderBtn.getAttribute('data-path') || '';
            this.showCreateFolderDialog(path);
            return;
        }

        const missingItem = event.target.closest('li.file[data-missing-path]');
        if (missingItem && tree.contains(missingItem)) {
            event.preventDefault();
            event.stopPropagation();
            const relativePath = missingItem.getAttribute('data-missing-path') || '';
            if (relativePath) {
                await this._createMissingReferencedFile(relativePath);
            }
            return;
        }

        const fileItem = event.target.closest('li.file[data-uuid]');
        if (fileItem && tree.contains(fileItem)) {
            event.preventDefault();
            event.stopPropagation();
            const uuid = fileItem.getAttribute('data-uuid');
            if (uuid) {
                editor.openFile(uuid);
            }
            return;
        }

        const dirLabel = event.target.closest('[data-role="directory-label"]');
        if (dirLabel && tree.contains(dirLabel)) {
            event.preventDefault();
            event.stopPropagation();
            const dirEl = dirLabel.closest('li[data-type="directory"]');
            if (dirEl && dirEl.id) {
                this.toggleAccordion(dirEl.id);
            }
            return;
        }

        // Allow toggling when clicking the directory row marker area (li pseudo-arrow),
        // not only the text label.
        const dirItem = event.target.closest('li[data-type="directory"]');
        if (dirItem && tree.contains(dirItem) && event.target === dirItem) {
            event.preventDefault();
            event.stopPropagation();
            if (dirItem.id) {
                this.toggleAccordion(dirItem.id);
            }
        }
    },

    _handleTreeContextMenu(event) {
        const tree = document.getElementById('file-tree');
        if (!tree || !tree.contains(event.target)) return;

        const fileItem = event.target.closest('li.file[data-uuid]');
        if (fileItem && tree.contains(fileItem)) {
            event.preventDefault();
            event.stopPropagation();
            const uuid = fileItem.getAttribute('data-uuid');
            if (uuid) {
                this.showFileContextMenu(event, uuid);
            }
            return;
        }

        const dirLabel = event.target.closest('[data-role="directory-label"]');
        if (dirLabel && tree.contains(dirLabel)) {
            event.preventDefault();
            event.stopPropagation();
            const dirEl = dirLabel.closest('li[data-type="directory"]');
            if (dirEl) {
                const path = dirEl.getAttribute('data-path') || '';
                this.showDirectoryContextMenu(event, path);
            }
        }
    },

    _handleTreeDragStart(event) {
        const tree = document.getElementById('file-tree');
        if (!tree || !tree.contains(event.target)) return;

        const fileItem = event.target.closest('li.file[data-uuid]');
        if (fileItem && tree.contains(fileItem)) {
            const uuid = fileItem.getAttribute('data-uuid');
            if (uuid) {
                this.onDragStartFile(event, uuid);
            }
        }
    },

    _handleTreeDragOver(event) {
        const tree = document.getElementById('file-tree');
        if (!tree || !tree.contains(event.target)) return;

        const dirEl = event.target.closest('li[data-type="directory"]');
        if (dirEl && tree.contains(dirEl)) {
            this.onDragOverDir(event, dirEl);
        }
    },

    _handleTreeDragLeave(event) {
        const tree = document.getElementById('file-tree');
        if (!tree || !tree.contains(event.target)) return;

        const dirEl = event.target.closest('li[data-type="directory"]');
        if (!dirEl || !tree.contains(dirEl)) return;

        const related = event.relatedTarget;
        if (related && dirEl.contains(related)) {
            return;
        }

        this.onDragLeaveDir(event, dirEl);
    },

    _handleTreeDrop(event) {
        const tree = document.getElementById('file-tree');
        if (!tree || !tree.contains(event.target)) return;

        const dirEl = event.target.closest('li[data-type="directory"]');
        if (!dirEl || !tree.contains(dirEl)) return;

        const path = dirEl.getAttribute('data-path') || '';
        this.onDropOnDir(event, path, dirEl);
    },

    toggleAccordion(id) {
        let element = document.getElementById(id);
        let children = $(element).children('ul');
        if (children.length === 0) return;

        if (children.is(':visible')) {
            children.hide();
            $(`#${id}`).removeClass("directoryOpen").addClass("directoryClose");
        } else {
            children.show();
            $(`#${id}`).removeClass("directoryClose").addClass("directoryOpen");
        }
    },

    async recursivelyReadDirectory(path, directoryHandle) {
        const ignore = new Set(['.git', '.vscode', 'node_modules', '.checkpoints', 'shipped app files', 'shipped apps']);
        let fileStruc = [];
        for await (const entry of directoryHandle.values()) {
            if (ignore.has(String(entry.name || '').trim().toLowerCase())) continue;

            let fileData = {
                name: entry.name,
                path: path,
                type: entry.name.split('.').pop(),
                kind: entry.kind,
                entry: entry,
                uuid: this.createUuid(),
                relativePath: [...path, entry.name].join('/')
            };

            if (entry.kind === 'file') {
                fileStruc.push(fileData);
            } else if (entry.kind === 'directory') {
                // Push directory so empty folders show up
                fileStruc.push(fileData);
                const subFiles = await this.recursivelyReadDirectory([...path, entry.name], entry);
                fileStruc = fileStruc.concat(subFiles);
            }
        }
        return fileStruc;
    },

    createUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    }),

    async getFileContent(file) {
        if (editor.instance[file.uuid] && editor.isDirty(file.uuid)) {
            if (typeof editor._getValue === 'function') {
                return editor._getValue(file.uuid);
            }
            const view = editor.instance[file.uuid];
            if (view && view.state && view.state.doc) {
                return view.state.doc.toString();
            }
        }
        const fileHandle = await file.entry.getFile();
        return await fileHandle.text();
    },

    async createNewFile(fileName, directoryPath = []) {
        if (!this.fileHandle) {
            alert('Please open an app folder first');
            return;
        }

        try {
            const relPath = this._normalizeProjectPath([...directoryPath, fileName].join('/'));
            const relKey = relPath.toLowerCase();
            const alreadyTracked = (this.fileStructure || []).some(f =>
                f &&
                f.kind === 'file' &&
                this._normalizeProjectPath(f.relativePath).toLowerCase() === relKey
            );
            if (alreadyTracked) {
                alert(`A file named "${fileName}" already exists in this folder. Choose a different name.`);
                return null;
            }

            let targetDir = this.fileHandle;

            for (const dir of directoryPath) {
                targetDir = await targetDir.getDirectoryHandle(dir, { create: true });
            }

            try {
                await targetDir.getFileHandle(fileName, { create: false });
                alert(`A file named "${fileName}" already exists in this folder. Choose a different name.`);
                return null;
            } catch (checkErr) {
                if (checkErr && checkErr.name !== 'NotFoundError') {
                    throw checkErr;
                }
            }

            const fileHandle = await targetDir.getFileHandle(fileName, { create: true });

            // Write unshipped banner as initial content for new HTML files
            if (/\.html?$/i.test(fileName)) {
                try {
                    const writable = await fileHandle.createWritable();
                    await writable.write(editor._UNSHIPPED_BANNER + '\n');
                    await writable.close();
                } catch (bannerErr) {
                    console.warn('Could not write unshipped banner to new HTML file:', bannerErr);
                }
            }

            this.fileStructure = await this.recursivelyReadDirectory([], this.fileHandle);
            this._updateSignature();
            this.refreshFileTree();

            const created = this.fileStructure.find(f => f.relativePath === relPath);
            if (created) {
                editor.openFile(created.uuid);
                return created;
            }
            return null;
        } catch (err) {
            console.error('Error creating file:', err);
            alert('Could not create file: ' + err.message);
        }
    },

    async renameFile(uuid, newName) {
        const file = this.fileStructure.find(f => f.uuid === uuid);
        if (!file) {
            alert('File not found');
            return false;
        }
        if (this._renameInFlight.has(uuid)) {
            return false;
        }

        this._renameInFlight.add(uuid);
        try {
            const normalizedName = String(newName || '').trim();
            if (!normalizedName) {
                alert('File name cannot be empty.');
                return false;
            }
            const originalName = String(file.name || '');
            const originalPath = Array.isArray(file.path) ? file.path.slice() : [];
            if (originalName === normalizedName) {
                return true;
            }

            const targetRelativePath = this._normalizeProjectPath([...originalPath, normalizedName].join('/'));
            const collision = this.fileStructure.find(f =>
                f &&
                f.kind === 'file' &&
                f.uuid !== uuid &&
                this._normalizeProjectPath(f.relativePath).toLowerCase() === targetRelativePath.toLowerCase()
            );
            if (collision) {
                alert(`A file named "${normalizedName}" already exists in this folder. Choose a different name.`);
                return false;
            }

            let parentDir = this.fileHandle;
            for (const dir of originalPath) {
                parentDir = await parentDir.getDirectoryHandle(dir);
            }

            const oldFileContent = await this.getFileContent(file);
            const contentToWrite = (editor && typeof editor._prepareContentsForDisk === 'function')
                ? editor._prepareContentsForDisk(normalizedName, oldFileContent)
                : oldFileContent;
            const isCaseOnlyRename = originalName.toLowerCase() === normalizedName.toLowerCase();

            let newFileHandle;
            if (isCaseOnlyRename) {
                const dot = normalizedName.lastIndexOf('.');
                const stem = dot > 0 ? normalizedName.slice(0, dot) : normalizedName;
                const ext = dot > 0 ? normalizedName.slice(dot) : '';
                let tempName = '';
                for (let i = 0; i < 100; i++) {
                    const candidate = `${stem}.__forge_case_rename_${i}${ext}`;
                    try {
                        await parentDir.getFileHandle(candidate, { create: false });
                    } catch (checkErr) {
                        if (checkErr && checkErr.name === 'NotFoundError') {
                            tempName = candidate;
                            break;
                        }
                        throw checkErr;
                    }
                }
                if (!tempName) {
                    throw new Error('Could not allocate a temporary filename for case-only rename.');
                }

                const tempHandle = await parentDir.getFileHandle(tempName, { create: true });
                let writable = await tempHandle.createWritable();
                await writable.write(contentToWrite);
                await writable.close();

                await parentDir.removeEntry(originalName);

                newFileHandle = await parentDir.getFileHandle(normalizedName, { create: true });
                writable = await newFileHandle.createWritable();
                await writable.write(contentToWrite);
                await writable.close();

                await parentDir.removeEntry(tempName);
            } else {
                newFileHandle = await parentDir.getFileHandle(normalizedName, { create: true });
                const writable = await newFileHandle.createWritable();
                await writable.write(contentToWrite);
                await writable.close();

                await parentDir.removeEntry(originalName);
            }

            file.name = normalizedName;
            file.type = normalizedName.includes('.') ? normalizedName.split('.').pop() : '';
            file.entry = newFileHandle;
            file.relativePath = targetRelativePath;

            if (editor.instance[uuid]) {
                $(`#nav-${uuid} .filename`).text(normalizedName);
            }

            if (editor && editor._meta && editor._meta[uuid]) {
                editor._meta[uuid].name = normalizedName;
                editor._meta[uuid].path = originalPath.slice();
                editor._meta[uuid].relativePath = targetRelativePath;
                editor._meta[uuid].entry = newFileHandle;
                editor._meta[uuid].text = contentToWrite;
                const editorContent = (editor && typeof editor._prepareContentsForEditor === 'function')
                    ? editor._prepareContentsForEditor(normalizedName, oldFileContent)
                    : oldFileContent;
                if (editor.instance[uuid] && typeof editor.setValue === 'function' && editorContent !== oldFileContent) {
                    editor.setValue(uuid, editorContent);
                }
            }
            if (editor && editor.dirtyFiles) {
                editor.dirtyFiles.delete(uuid);
            }
            if (editor && typeof editor._setStatus === 'function') {
                editor._setStatus(uuid, 'Saved', 'saved');
            }

            this._updateSignature();
            this.refreshFileTree();
            return true;

        } catch (err) {
            console.error('Error renaming file:', err);
            alert('Could not rename file: ' + err.message);
            return false;
        } finally {
            this._renameInFlight.delete(uuid);
        }
    },

    refreshFileTree() {
        if (!this.fileHandle) return;
        this._renderFileTree();
        this._refreshReferenceHighlights()
            .then(() => {
                if (!this.fileHandle) return;
                this._renderFileTree();
            })
            .catch(err => {
                console.warn('Failed to refresh file reference highlights:', err);
            });
        this._checkHtmlFileWarnings();
    },

    showCreateFileDialog(directoryPath = []) {
        let pathArray;
        if (typeof directoryPath === 'string') {
            pathArray = directoryPath === '' ? [] : directoryPath.split('/');
        } else {
            pathArray = directoryPath;
        }

        // Check if there are any HTML files in the target directory
        const targetPathStr = pathArray.join('/');
        const hasHtmlFile = this.fileStructure.some(f =>
            f.kind === 'file' &&
            f.name.toLowerCase().endsWith('.html') &&
            (f.path || []).join('/') === targetPathStr
        );

        const defaultName = hasHtmlFile ? '' : 'index.html';
        const fileName = prompt('Enter file name:', defaultName);

        if (fileName && fileName.trim()) {
            const trimmedName = fileName.trim();
            // Check for warnings *before* creating
            if (trimmedName.toLowerCase().endsWith('.html')) {
                // Check if any HTML file already exists in the ENTIRE project (not just current folder)
                // (Using root fileStructure scan)
                const anyHtmlExists = this.fileStructure.some(f => f.kind === 'file' && f.name.toLowerCase().endsWith('.html'));

                if (anyHtmlExists) {
                    if (!confirm("Forge relies on 'index.html' being the single HTML file. Creating a second HTML file is not recommended and may cause issues. Continue?")) {
                        return;
                    }
                } else {
                    // No HTML exists yet
                    if (trimmedName.toLowerCase() !== 'index.html') {
                        if (!confirm("The main HTML file should be named 'index.html' for Forge to function correctly. Continue?")) {
                            return;
                        }
                    }
                }
            }

            this.createNewFile(trimmedName, pathArray);
        }
    },

    showRenameDialog(uuid) {
        const file = this.fileStructure.find(f => f.uuid === uuid);
        if (!file) return;

        const newName = prompt('Enter new file name:', file.name);
        if (newName && newName.trim() && newName.trim() !== file.name) {
            const trimmedName = newName.trim();
            if (trimmedName.toLowerCase().endsWith('.html')) {
                const otherHtmlExists = this.fileStructure.some(f => f.kind === 'file' && f.uuid !== uuid && f.name.toLowerCase().endsWith('.html'));

                if (otherHtmlExists) {
                    if (!confirm("Forge relies on 'index.html' being the single HTML file. Creating a second HTML file is not recommended. Continue?")) {
                        return;
                    }
                } else {
                    // This is the only HTML file (or will be)
                    if (trimmedName.toLowerCase() !== 'index.html') {
                        if (!confirm("The main HTML file should be named 'index.html' for Forge to function correctly. Continue?")) {
                            return;
                        }
                    }
                }
            }
            this.renameFile(uuid, trimmedName);
        }
    },

    showFileContextMenu(event, uuid) {
        this.hideContextMenus();
        const menu = this.createFileContextMenu(uuid);
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
        document.body.appendChild(menu);
    },

    showDirectoryContextMenu(event, directoryPath) {
        this.hideContextMenus();
        const pathArray = directoryPath === '' ? [] : directoryPath.split('/');
        const menu = this.createDirectoryContextMenu(pathArray);
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
        document.body.appendChild(menu);
    },

    createFileContextMenu(uuid) {
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        const rename = document.createElement('div');
        rename.className = 'context-menu-item';
        rename.textContent = 'Rename';
        rename.addEventListener('click', () => { loadFolder.showRenameDialog(uuid); loadFolder.hideContextMenus(); });
        const del = document.createElement('div');
        del.className = 'context-menu-item';
        del.textContent = 'Delete';
        del.addEventListener('click', () => { loadFolder.deleteFile(uuid); loadFolder.hideContextMenus(); });
        menu.appendChild(rename);
        menu.appendChild(del);
        return menu;
    },

    createDirectoryContextMenu(directoryPath) {
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        const pathString = directoryPath.join('/');
        const newFile = document.createElement('div');
        newFile.className = 'context-menu-item';
        newFile.textContent = 'New File';
        newFile.addEventListener('click', () => { loadFolder.showCreateFileDialog(pathString); loadFolder.hideContextMenus(); });
        const newFolder = document.createElement('div');
        newFolder.className = 'context-menu-item';
        newFolder.textContent = 'New Folder';
        newFolder.addEventListener('click', () => { loadFolder.showCreateFolderDialog(pathString); loadFolder.hideContextMenus(); });
        menu.appendChild(newFile);
        menu.appendChild(newFolder);
        if (directoryPath.length > 0) {
            const delFolder = document.createElement('div');
            delFolder.className = 'context-menu-item';
            delFolder.textContent = 'Delete Folder';
            delFolder.addEventListener('click', () => { loadFolder.deleteFolder(pathString); loadFolder.hideContextMenus(); });
            menu.appendChild(delFolder);
        }
        return menu;
    },

    hideContextMenus() {
        document.querySelectorAll('.context-menu').forEach(menu => menu.remove());
    },

    async deleteFile(uuid) {
        const file = this.fileStructure.find(f => f.uuid === uuid);
        if (!file) {
            alert('File not found');
            return;
        }

        if (!confirm(`Are you sure you want to delete "${file.name}"?`)) {
            return;
        }

        try {
            let parentDir = this.fileHandle;
            for (const dir of file.path) {
                parentDir = await parentDir.getDirectoryHandle(dir);
            }

            await parentDir.removeEntry(file.name);

            this.fileStructure = this.fileStructure.filter(f => f.uuid !== uuid);
            this._updateSignature();

            if (editor.instance[uuid]) {
                editor.deleteTab(uuid, { force: true });
            }

            this.refreshFileTree();

        } catch (err) {
            console.error('Error deleting file:', err);
            alert('Could not delete file: ' + err.message);
        }
    },

    // ---- Folder Creation ----
    async createNewFolder(folderName, directoryPath = []) {
        if (!this.fileHandle) {
            alert('Please open an app folder first');
            return;
        }
        try {
            const normalizedFolderName = String(folderName || '').trim();
            if (!normalizedFolderName) {
                alert('Folder name cannot be empty.');
                return;
            }

            const relPath = this._normalizeProjectPath([...directoryPath, normalizedFolderName].join('/'));
            const relKey = relPath.toLowerCase();
            const alreadyTracked = (this.fileStructure || []).some(f =>
                f &&
                f.kind === 'directory' &&
                this._normalizeProjectPath(f.relativePath).toLowerCase() === relKey
            );
            if (alreadyTracked) {
                alert(`A folder named "${normalizedFolderName}" already exists in this location.`);
                return;
            }

            let targetDir = this.fileHandle;
            for (const dir of directoryPath) {
                targetDir = await targetDir.getDirectoryHandle(dir, { create: true });
            }

            try {
                await targetDir.getDirectoryHandle(normalizedFolderName, { create: false });
                this.fileStructure = await this.recursivelyReadDirectory([], this.fileHandle);
                this._updateSignature();
                this.refreshFileTree();
                alert(`A folder named "${normalizedFolderName}" already exists in this location.`);
                return;
            } catch (checkErr) {
                if (checkErr && checkErr.name !== 'NotFoundError') {
                    throw checkErr;
                }
            }

            await targetDir.getDirectoryHandle(normalizedFolderName, { create: true });

            // Add directory entry so it appears immediately (empty)
            this.fileStructure.push({
                name: normalizedFolderName,
                path: directoryPath.slice(),
                type: '',
                kind: 'directory',
                entry: null, // Not needed for directories currently
                uuid: this.createUuid(),
                relativePath: relPath
            });
            this._updateSignature();
            this.refreshFileTree();
        } catch (err) {
            console.error('Error creating folder:', err);
            alert('Could not create folder: ' + err.message);
        }
    },

    showCreateFolderDialog(directoryPath = []) {
        let pathArray;
        if (typeof directoryPath === 'string') {
            pathArray = directoryPath === '' ? [] : directoryPath.split('/');
        } else {
            pathArray = directoryPath;
        }
        const folderName = prompt('Enter folder name:');
        if (folderName && folderName.trim()) {
            this.createNewFolder(folderName.trim(), pathArray);
        }
    },

    // ---- Drag & Drop Support ----
    onDragStartFile(event, uuid) {
        if (event.dataTransfer) {
            event.dataTransfer.setData('text/plain', uuid);
            event.dataTransfer.effectAllowed = 'move';
        }
    },
    onDragOverDir(event, element) {
        event.preventDefault();
        const li = element || event.currentTarget;
        if (!li) return;
        li.classList.add('drop-target');
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    },
    onDragLeaveDir(event, element) {
        const li = element || event.currentTarget;
        if (!li) return;
        li.classList.remove('drop-target');
    },
    async onDropOnDir(event, pathString, element) {
        event.preventDefault();
        const li = element || event.currentTarget;
        if (li) {
            li.classList.remove('drop-target');
        }
        if (!event.dataTransfer) return;
        const uuid = event.dataTransfer.getData('text/plain');
        if (!uuid) return;
        const destPath = pathString ? pathString.split('/') : [];
        await this.moveFile(uuid, destPath);
    },
    async moveFile(uuid, destPathArray) {
        const file = this.fileStructure.find(f => f.uuid === uuid && f.kind === 'file');
        if (!file) return;
        const currentPath = file.path || [];
        if (JSON.stringify(currentPath) === JSON.stringify(destPathArray)) return; // no-op

        // Prevent moving into a sub-path that includes file's own path logic not needed (files only)

        try {
            // Acquire destination directory handle
            let destDir = this.fileHandle;
            for (const part of destPathArray) {
                destDir = await destDir.getDirectoryHandle(part, { create: true });
            }

            // Collision check
            const destRelative = this._normalizeProjectPath([...destPathArray, file.name].join('/'));
            const existing = this.fileStructure.find(f =>
                f &&
                f.uuid !== uuid &&
                this._normalizeProjectPath(f.relativePath).toLowerCase() === destRelative.toLowerCase()
            );
            if (existing) {
                const existingDirty = !!(editor && typeof editor.isDirty === 'function' && editor.isDirty(existing.uuid));
                const collisionMsg = existingDirty
                    ? `A file named "${file.name}" already exists in the target folder and has unsaved edits in an open tab. Replacing it will discard that version. Continue?`
                    : `A file named "${file.name}" already exists in the target folder. Replace it?`;
                if (!confirm(collisionMsg)) {
                    return;
                }
            }

            // Read latest content (respect unsaved editor state)
            const contents = await this.getFileContent(file);
            const contentToWrite = (editor && typeof editor._prepareContentsForDisk === 'function')
                ? editor._prepareContentsForDisk(file.name, contents)
                : contents;

            // Write new file in destination
            const newFileHandle = await destDir.getFileHandle(file.name, { create: true });
            const writable = await newFileHandle.createWritable();
            await writable.write(contentToWrite);
            await writable.close();

            // Delete old file
            let parentDir = this.fileHandle;
            for (const part of currentPath) {
                parentDir = await parentDir.getDirectoryHandle(part);
            }
            await parentDir.removeEntry(file.name);

            if (existing) {
                if (editor.instance[existing.uuid]) {
                    editor.deleteTab(existing.uuid, { force: true });
                } else if (editor && editor._meta) {
                    delete editor._meta[existing.uuid];
                    if (editor.dirtyFiles) {
                        editor.dirtyFiles.delete(existing.uuid);
                    }
                }
                this.fileStructure = this.fileStructure.filter(f => f.uuid !== existing.uuid);
            }

            // Update in-memory metadata
            file.path = destPathArray.slice();
            file.relativePath = destRelative;
            file.entry = newFileHandle;

            // Update open editor meta if open
            if (editor && editor._meta && editor._meta[uuid]) {
                editor._meta[uuid].path = destPathArray.slice();
                editor._meta[uuid].relativePath = destRelative;
                editor._meta[uuid].entry = newFileHandle;
                // We just persisted current contents during move, so update snapshot
                editor._meta[uuid].text = contentToWrite;
                const editorContent = (editor && typeof editor._prepareContentsForEditor === 'function')
                    ? editor._prepareContentsForEditor(file.name, contents)
                    : contents;
                if (editor.instance[uuid] && typeof editor.setValue === 'function' && editorContent !== contents) {
                    editor.setValue(uuid, editorContent);
                }
            }
            if (editor && editor.dirtyFiles) {
                editor.dirtyFiles.delete(uuid);
            }
            if (editor && typeof editor._setStatus === 'function') {
                editor._setStatus(uuid, 'Saved', 'saved');
            }

            this._updateSignature();
            this.refreshFileTree();
        } catch (err) {
            console.error('Move failed:', err);
            alert('Could not move file: ' + err.message);
        }
    },

    // ---- Delete Folder (recursive) ----
    async deleteFolder(pathString) {
        if (!this.fileHandle) return;
        const pathArray = pathString === '' ? [] : pathString.split('/').filter(Boolean);
        if (pathArray.length === 0) {
            alert('Cannot delete the project root.');
            return;
        }

        // Compute contents under folder
        const folderRel = pathArray.join('/');
        const descendants = this.fileStructure.filter(f => f.relativePath === folderRel || f.relativePath.startsWith(folderRel + '/'));
        const fileCount = descendants.filter(d => d.kind === 'file').length;
        const dirCount = descendants.filter(d => d.kind === 'directory').length - 1; // exclude the folder itself

        let msg;
        if (descendants.length === 1 && fileCount === 0 && dirCount === 0) {
            msg = `Delete empty folder "${pathArray[pathArray.length - 1]}"?`;
        } else {
            msg = `Folder "${pathArray[pathArray.length - 1]}" contains ${fileCount} file(s) and ${dirCount} subfolder(s).\nThis will permanently delete all contents. Continue?`;
        }
        if (!confirm(msg)) return;

        try {
            // Traverse to parent directory
            let parentDir = this.fileHandle;
            for (let i = 0; i < pathArray.length - 1; i++) {
                parentDir = await parentDir.getDirectoryHandle(pathArray[i]);
            }
            await parentDir.removeEntry(pathArray[pathArray.length - 1], { recursive: true });

            // Close any open editors for removed files
            const removedUuids = new Set(descendants.map(d => d.uuid));
            Object.keys(editor.instance || {}).forEach(uuid => {
                if (removedUuids.has(uuid)) {
                    editor.deleteTab(uuid, { force: true });
                }
            });

            // Prune from fileStructure
            this.fileStructure = this.fileStructure.filter(f => !removedUuids.has(f.uuid));
            this._updateSignature();

            this.refreshFileTree();
        } catch (err) {
            console.error('Error deleting folder:', err);
            alert('Could not delete folder: ' + (err.message || err));
        }
    },

    async syncFileStructure(options = {}) {
        if (!this.fileHandle) {
            return;
        }
        if (this._syncInFlight) {
            this._syncPending = true;
            return;
        }

        this._syncInFlight = true;
        try {
            const activeHandle = this.fileHandle;
            if (!activeHandle) {
                return;
            }

            const snapshot = await this.recursivelyReadDirectory([], activeHandle);
            if (activeHandle !== this.fileHandle) {
                return;
            }
            const signature = this._calculateSignature(snapshot);
            const signatureChanged = signature !== this._snapshotSignature;

            const previousStructure = Array.isArray(this.fileStructure)
                ? this.fileStructure.slice()
                : [];
            const merged = this._mergeSnapshotOntoCurrent(snapshot);

            const newKeys = new Set(merged.map(entry => this._snapshotKey(entry)));
            const removedEntries = [];
            if (signatureChanged && previousStructure.length) {
                previousStructure.forEach(entry => {
                    const key = this._snapshotKey(entry);
                    if (!newKeys.has(key)) {
                        removedEntries.push(entry);
                    }
                });
            }

            this.fileStructure = merged;
            this._snapshotSignature = signature;

            if (signatureChanged) {
                this.refreshFileTree();

                // Identify newly added files and ensure banners on any new HTML files
                const previousKeys = new Set(previousStructure.map(e => this._snapshotKey(e)));
                const addedHtmlFiles = merged.filter(e =>
                    !previousKeys.has(this._snapshotKey(e)) &&
                    e.kind === 'file' && /\.html?$/i.test(e.name || '')
                );
                if (addedHtmlFiles.length) {
                    this._ensureBannersOnDisk(addedHtmlFiles).catch(err =>
                        console.warn('Banner injection on sync failed:', err)
                    );
                }
            }

            this._reconcileOpenEditors(merged, removedEntries);
        } catch (err) {
            console.warn('Directory sync failed:', err);
        } finally {
            this._syncInFlight = false;
            if (this._syncPending) {
                this._syncPending = false;
                this.syncFileStructure(options);
            }
        }
    },

    _mergeSnapshotOntoCurrent(snapshot) {
        const current = Array.isArray(this.fileStructure) ? this.fileStructure : [];
        const currentByKey = new Map(current.map(entry => [this._snapshotKey(entry), entry]));
        return snapshot.map(entry => {
            const key = this._snapshotKey(entry);
            const existing = currentByKey.get(key);
            if (existing) {
                const merged = { ...entry };
                merged.uuid = existing.uuid;
                if (existing.text !== undefined) {
                    merged.text = existing.text;
                }
                return merged;
            }
            return { ...entry };
        });
    },

    _reconcileOpenEditors(latestEntries, removedEntries = []) {
        const latestByPath = new Map();
        latestEntries.forEach(entry => {
            if (entry.kind === 'file') {
                latestByPath.set(entry.relativePath, entry);
            }
        });

        Object.keys(editor._meta || {}).forEach(uuid => {
            const meta = editor._meta[uuid];
            if (!meta) return;
            const latest = latestByPath.get(meta.relativePath);
            if (latest && latest.entry) {
                meta.entry = latest.entry;
                meta.name = latest.name;
                if (editor.instance[uuid]) {
                    $(`#nav-${uuid} .filename`).text(latest.name);
                }
            } else {
                meta.entry = null;
                editor._setStatus(uuid, 'Missing', 'error');
            }
        });

        if (Array.isArray(removedEntries) && removedEntries.length) {
            removedEntries.forEach(entry => {
                if (entry.kind === 'file' && editor.instance[entry.uuid]) {
                    editor._setStatus(entry.uuid, 'Missing', 'error');
                }
            });
        }
    },

    _snapshotKey(entry) {
        const path = entry && entry.relativePath ? entry.relativePath : '';
        const kind = entry && entry.kind ? entry.kind : 'file';
        return `${kind}:${path}`;
    },

    _calculateSignature(entries) {
        if (!Array.isArray(entries) || !entries.length) {
            return '';
        }
        return entries
            .map(entry => this._snapshotKey(entry))
            .sort()
            .join('|');
    },

    _updateSignature() {
        this._snapshotSignature = this._calculateSignature(this.fileStructure || []);
    },

    /**
     * Scan all HTML files on disk and inject the unshipped banner into any
     * that don't already have it.  Runs in the background (fire-and-forget)
     * so it doesn't block folder loading.
     */
    async _ensureBannersOnDisk(fileList) {
        if (typeof editor === 'undefined' || !editor.ensureUnshippedBanner) return;
        const htmlFiles = (fileList || this.fileStructure || []).filter(f =>
            f.kind === 'file' && /\.html?$/i.test(f.name || '')
        );
        for (const file of htmlFiles) {
            try {
                const fh = await file.entry.getFile();
                const content = await fh.text();
                if (editor.shouldSkipUnshippedBanner && editor.shouldSkipUnshippedBanner(file.name, content, file)) {
                    const stripped = editor.stripUnshippedBanner ? editor.stripUnshippedBanner(content) : content;
                    if (stripped !== content && editor._looksLikeForgeSelfHtml && editor._looksLikeForgeSelfHtml(content)) {
                        const writable = await file.entry.createWritable();
                        await writable.write(stripped);
                        await writable.close();
                    }
                    continue;
                }
                if (editor._hasUnshippedBanner(content)) continue;
                const patched = editor.ensureUnshippedBanner(content, file.name, file);
                const writable = await file.entry.createWritable();
                await writable.write(patched);
                await writable.close();
                // If this file is already open in the editor, update the editor content too
                if (editor._meta) {
                    const openUuid = Object.keys(editor._meta).find(u => {
                        const m = editor._meta[u];
                        return m && m.relativePath === file.relativePath;
                    });
                    if (openUuid && editor.instance[openUuid]) {
                        const view = editor.instance[openUuid];
                        const doc = view.state.doc.toString();
                        if (editor.shouldSkipUnshippedBanner && editor.shouldSkipUnshippedBanner(file.name, doc, file)) continue;
                        if (!editor._hasUnshippedBanner(doc)) {
                            const patchedEditor = editor.ensureUnshippedBanner(doc, file.name, file);
                            view.dispatch({
                                changes: { from: 0, to: doc.length, insert: patchedEditor }
                            });
                        }
                    }
                }
            } catch (err) {
                console.warn('Could not inject unshipped banner into', file.relativePath, err);
            }
        }
    },

    _startAutoSync() {
        if (!this.fileHandle) {
            return;
        }

        if (this._syncTimer) {
            clearInterval(this._syncTimer);
        }

        // Poll the directory periodically in case external tools add/rename files.
        this._syncTimer = setInterval(() => {
            this.syncFileStructure({ reason: 'interval' });
        }, 5000);

        if (!this._focusHandler) {
            this._focusHandler = () => this.syncFileStructure({ reason: 'focus' });
            window.addEventListener('focus', this._focusHandler);
        }

        if (!this._visibilityHandler) {
            this._visibilityHandler = () => {
                if (document.visibilityState === 'visible') {
                    this.syncFileStructure({ reason: 'visibility' });
                }
            };
            document.addEventListener('visibilitychange', this._visibilityHandler);
        }
    },

    _stopAutoSync() {
        if (this._syncTimer) {
            clearInterval(this._syncTimer);
            this._syncTimer = null;
        }

        if (this._focusHandler) {
            window.removeEventListener('focus', this._focusHandler);
            this._focusHandler = null;
        }

        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }

        this._syncPending = false;
        this._syncInFlight = false;
    }
};
