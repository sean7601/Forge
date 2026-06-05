const newProjectWalkthrough = {
    _initialized: false,
    _modalEl: null,
    _modal: null,
    _stepIndex: 0,
    _highlightedEl: null,
    _targetArrowEl: null,
    _lastTargetSelector: '',
    _lastCenterModal: false,
    _lastModalPlacement: '',
    _lastStrictPlacement: false,
    _repositionHandler: null,
    _pasteCueMaxReturns: 3,
    _pasteCueReturnCount: 0,
    _pasteCueActive: false,
    _pasteDetectedInIndexHtml: false,
    _pendingPasteReturnCue: false,
    _windowWasAway: false,
    _lastReturnCueAt: 0,
    _pasteFlashTimer: null,
    _stepThreeCueTimer: null,
    _pasteCueCheckInFlight: false,
    _visibilityHandler: null,
    _focusHandler: null,
    _blurHandler: null,
    _pasteListener: null,
    _starterPrompt: 'Create a single-file, vanilla, offline html file application that ',

    init() {
        if (this._initialized) return;

        this._modalEl = document.getElementById('new-project-walkthrough-modal');
        if (!this._modalEl || !(window.bootstrap && bootstrap.Modal)) {
            return;
        }

        this._modal = bootstrap.Modal.getOrCreateInstance(this._modalEl, {
            backdrop: false,
            focus: false,
            keyboard: true
        });

        const prevBtn = document.getElementById('forge-walkthrough-prev-btn');
        const nextBtn = document.getElementById('forge-walkthrough-next-btn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => this._goPrev());
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this._goNext());
        }

        const stepListEl = document.getElementById('forge-walkthrough-step-list');
        if (stepListEl) {
            stepListEl.addEventListener('click', (event) => {
                const target = event.target && event.target.closest
                    ? event.target.closest('[data-step-index]')
                    : null;
                if (!target) return;
                const nextIndex = Number(target.getAttribute('data-step-index'));
                if (!Number.isInteger(nextIndex)) return;
                const steps = this._steps();
                if (nextIndex < 0 || nextIndex >= steps.length) return;
                this._stepIndex = nextIndex;
                this._render();
            });
        }

        this._repositionHandler = () => {
            if (!(this._modalEl && this._modalEl.classList.contains('show'))) return;
            if (this._lastCenterModal) {
                this._positionModalCenter();
            } else {
                this._positionModalNearTarget(this._lastTargetSelector, this._lastModalPlacement, this._lastStrictPlacement);
            }
            this._positionTargetArrow();
        };
        window.addEventListener('resize', this._repositionHandler);
        window.addEventListener('scroll', this._repositionHandler, true);

        this._visibilityHandler = () => this._handleVisibilityChange();
        this._focusHandler = () => this._handleWindowFocus();
        this._blurHandler = () => this._handleWindowBlur();
        this._pasteListener = (event) => this._handleDocumentPaste(event);
        document.addEventListener('visibilitychange', this._visibilityHandler);
        window.addEventListener('focus', this._focusHandler);
        window.addEventListener('blur', this._blurHandler);
        document.addEventListener('paste', this._pasteListener, true);

        this._modalEl.addEventListener('click', async (event) => {
            const btn = event.target && event.target.closest
                ? event.target.closest('[data-tour-copy-starter]')
                : null;
            if (!btn) return;

            const targetSelector = btn.getAttribute('data-tour-copy-target');
            const source = targetSelector ? this._modalEl.querySelector(targetSelector) : null;
            const text = source && 'value' in source ? source.value : this._starterPrompt;
            const copied = await this._copyTextToClipboard(text);
            const statusEl = document.getElementById('forge-tour-starter-copy-status');

            if (copied) {
                btn.textContent = 'Copied';
                btn.classList.remove('btn-outline-info');
                btn.classList.add('btn-success');
                if (statusEl) statusEl.textContent = 'Copied to clipboard.';
            } else {
                btn.textContent = 'Copy Failed - Try Again';
                btn.classList.remove('btn-success');
                btn.classList.add('btn-outline-warning');
                if (statusEl) statusEl.textContent = 'Clipboard copy failed. Try clicking again.';
            }
        });

        this._modalEl.addEventListener('hidden.bs.modal', () => {
            this._clearHighlight();
            this._lastCenterModal = false;
            this._lastModalPlacement = '';
            this._lastStrictPlacement = false;
            this._resetModalPosition();
            this._clearPasteFlash();
            if (!this._isBeginnerOnboardingActive()) {
                this._resetPasteCueState();
            }
            // Do NOT reset paste cue state here — the user may have closed the modal
            // while going to the AI tool, and we still need to show the return cue
            // when they come back.  State is only fully reset in start() or on Finish.
        });

        this._initialized = true;
    },

    start() {
        if (!this._modal) return;
        this._stepIndex = 0;
        this._resetPasteCueState();
        this._pasteCueActive = this._isBeginnerOnboardingActive();
        this._modal.show();
        this._render();
    },

    _steps() {
        return [
            {
                id: 'launch-ai',
                title: '1) AI Services to Generate the First Version',
                instructions: 'Open AI Services, pick a provider, and paste the starter prompt.',
                purpose: 'Start with a clean first version quickly.',
                tip: 'Ask for a full `index.html`, not snippets.',
                extraHtml: () => `
                    <div class="p-2 rounded mt-2" style="background:#152832; border:1px solid #2f5f78;">
                        <small class="text-info d-block mb-1">Starter Prompt</small>
                        <textarea id="forge-tour-starter-prompt" class="form-control form-control-sm mb-2" readonly rows="2">${this._escapeHtml(this._starterPrompt)}</textarea>
                        <div class="d-flex align-items-center" style="gap:0.5rem;">
                            <button type="button" class="btn btn-sm btn-outline-info" data-tour-copy-starter data-tour-copy-target="#forge-tour-starter-prompt">Copy Prompt</button>
                            <small id="forge-tour-starter-copy-status" class="text-light">Copy, paste into AI, then add your request.</small>
                        </div>
                    </div>
                `,
                targetOptions: ['#open-ai-btn']
            },
            {
                id: 'open-index',
                title: '2) Open index.html in Forge',
                instructions: 'In the file tree, open `index.html`.',
                purpose: 'This is the main app entry file.',
                tip: 'If missing, create it with `+ File`.',
                targetOptions: ['#file-tree']
            },
            {
                id: 'paste-code',
                title: '3) Paste Full HTML from AI',
                instructions: 'Replace `index.html` with the full AI output.',
                purpose: 'Complete files are safer than partial snippets.',
                tip: 'If save fails, re-ask AI for the full file.',
                onEnter: () => { this._preparePasteTarget({ flash: false }); },
                targetOptions: [
                    '#editor .editor[style*="display: block"] .cm-editor',
                    '#editor .editor:not([style*="display: none"]) .cm-editor',
                    '#editor .cm-editor',
                    '#editor .editor[style*="display: block"]',
                    '#editor .editor:not([style*="display: none"])',
                    '#editor'
                ]
            },
            {
                id: 'save',
                title: '4) Save Your Files',
                instructions: 'Press Ctrl+S (or click Save All).',
                purpose: 'Writes your latest code to disk.',
                tip: 'Save before every test run.',
                targetOptions: ['#saveButton']
            },
            {
                id: 'run',
                title: '5) Run the App Outside Forge',
                instructions: 'Open File Explorer, go to your folder, then double-click `index.html`.',
                purpose: 'Runs the app as a real local file.',
                tip: 'Do this in Windows File Explorer, not inside Forge.',
                centerModal: true,
                extraHtml: () => `
                    <div class="p-2 rounded mt-2" style="background:#1f2a18; border:1px solid #4c6a38;">
                        <div class="d-flex align-items-center" style="gap:0.65rem;">
                            <span aria-hidden="true" style="font-size:1.7rem; line-height:1;">🗂️</span>
                            <div>
                                <strong class="d-block" style="color:#e9f6d8;">Open Windows File Explorer</strong>
                                <small style="color:#d6e9c3;">Use the desktop app, not this browser tab.</small>
                            </div>
                        </div>
                        <ol class="mb-0 mt-2 ps-3" style="color:#e9f6d8;">
                            <li>Open <strong>File Explorer</strong> on your computer.</li>
                            <li>Go to the folder you loaded in Forge.</li>
                            <li>Double-click <code>index.html</code>.</li>
                        </ol>
                    </div>
                `,
                targetOptions: []
            },
            {
                id: 'iterate',
                title: '6) Save progress checkpoints',
                instructions: 'Create a checkpoint, then request one small change at a time.',
                purpose: 'Easy rollback if something breaks.',
                tip: 'Small requests are easier to test and fix.',
                targetOptions: ['#checkpointCreateBtn']
            },
            {
                id: 'quick-prompts-ai',
                title: '7) Iterate and debug',
                instructions: 'Use Quick Prompts (Edit/Debug). For new chats, check "New conversation (append codebase)".',
                purpose: 'Fresh chats reduce AI drift.',
                tip: 'If edits get messy, start a new chat with fresh context.',
                extraHtml: () => `
                    <div class="p-2 rounded mt-2" style="background:#2b2214; border:1px solid #7a5a2e;">
                        <small class="text-warning d-block mb-1">Why start fresh?</small>
                        <ul class="mb-2 ps-3" style="color:#f2e5cd;">
                            <li>Old chat history gets noisy.</li>
                            <li>AI may use outdated code.</li>
                            <li>Fresh context usually gives cleaner edits.</li>
                        </ul>
                        <small style="color:#f2e5cd;">Best practice: one change per prompt, full updated files only. Do not output files you are not changing.</small>
                    </div>
                `,
                modalPlacement: 'left',
                strictPlacement: true,
                targetOptions: ['#quick-prompts-btn']
            },
            {
                id: 'ship',
                title: '8) Ship with Security Defaults',
                instructions: 'Use Ship to compile with secure defaults.',
                purpose: 'Applies safer packaging settings.',
                tip: 'Do this before sharing or using CUI+ data.',
                onEnter: () => this._openTab('a#editor-tab'),
                targetOptions: ['#ship-now-btn']
            },
            {
                id: 'troubleshoot',
                title: '9) Troubleshoot with Logs',
                instructions: 'If it breaks, collect logs first (F12 or Forge Dev Console).',
                purpose: 'Logs speed up debugging.',
                tip: 'Send bug summary + logs + current files to AI.',
                onEnter: () => this._openTab('a#devconsole-tab'),
                targetOptions: ['a#devconsole-tab', '#devconsole']
            }
        ];
    },

    _hasLoadedProject() {
        return !!(window.loadFolder && loadFolder.fileHandle);
    },

    _isBeginnerOnboardingActive() {
        const state = (window && window.forgeBeginnerOnboardingState) ? window.forgeBeginnerOnboardingState : null;
        return !!(state && state.beginnerMode);
    },

    _looksPopulatedHtml(text) {
        const t = String(text || '').trim();
        if (!t) return false;
        const tagMatches = t.match(/<\s*\/?\s*[a-z!][^>]*>/gi) || [];
        if (tagMatches.length < 2) return false;
        return /<\s*(!doctype\s+html|html|head|body|main|section|article|div|script|style|p|h1|h2|table|form|ul|ol|li)\b/i.test(t);
    },

    async _readIndexHtmlTextForPasteCue() {
        const isIndexName = (name) => String(name || '').trim().toLowerCase() === 'index.html';
        const metaByUuid = (window.editor && editor._meta) ? editor._meta : {};
        const candidateUuids = [];
        const seen = new Set();
        const addCandidate = (uuid) => {
            const id = String(uuid || '').trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            candidateUuids.push(id);
        };

        const readEditorCandidate = async (uuid) => {
            const meta = metaByUuid && metaByUuid[uuid] ? metaByUuid[uuid] : null;
            if (!meta || !isIndexName(meta.name)) return '';

            if (typeof editor._getValue === 'function') {
                const liveText = String(editor._getValue(uuid) || '');
                if (liveText.trim()) return liveText;
            } else {
                const view = editor.instance ? editor.instance[uuid] : null;
                const viewText = view && view.state && view.state.doc ? String(view.state.doc.toString() || '') : '';
                if (viewText.trim()) return viewText;
            }

            const cachedText = String(meta.text || '');
            if (cachedText.trim()) return cachedText;

            try {
                if (meta.entry && typeof meta.entry.getFile === 'function') {
                    const fh = await meta.entry.getFile();
                    const diskText = String(await fh.text() || '');
                    if (diskText.trim()) return diskText;
                }
            } catch (_) {
                // no-op
            }

            return '';
        };

        if (window.editor) {
            if (typeof editor.getActiveUuid === 'function') {
                const activeUuid = editor.getActiveUuid();
                const activeMeta = activeUuid ? metaByUuid[activeUuid] : null;
                if (activeMeta && isIndexName(activeMeta.name)) {
                    addCandidate(activeUuid);
                }
            }

            Object.keys(metaByUuid).forEach(uuid => {
                const meta = metaByUuid[uuid];
                if (!meta || !isIndexName(meta.name)) return;
                if (Array.isArray(meta.path) && meta.path.length === 0) {
                    addCandidate(uuid);
                }
            });

            Object.keys(metaByUuid).forEach(uuid => {
                const meta = metaByUuid[uuid];
                if (!meta || !isIndexName(meta.name)) return;
                addCandidate(uuid);
            });

            for (const uuid of candidateUuids) {
                const text = await readEditorCandidate(uuid);
                if (text.trim()) return text;
            }
        }

        if (!(window.loadFolder && Array.isArray(loadFolder.fileStructure))) {
            return '';
        }

        const files = loadFolder.fileStructure || [];
        const rootIndex = files.find(file =>
            file &&
            file.kind === 'file' &&
            isIndexName(file.name) &&
            Array.isArray(file.path) &&
            file.path.length === 0
        );
        const anyIndex = rootIndex || files.find(file => file && file.kind === 'file' && isIndexName(file.name));
        if (!anyIndex) return '';

        if (typeof loadFolder.getFileContent === 'function') {
            try {
                return await loadFolder.getFileContent(anyIndex);
            } catch (_) {
                return '';
            }
        }

        return '';
    },

    _getPasteCodeHighlightSelector() {
        const selectors = [
            '#editor .editor[style*="display: block"] .cm-editor',
            '#editor .editor:not([style*="display: none"]) .cm-editor',
            '#editor .cm-editor',
            '#editor .editor[style*="display: block"]',
            '#editor .editor:not([style*="display: none"])',
            '#editor'
        ];
        return selectors.find(sel => {
            const el = document.querySelector(sel);
            return this._isVisible(el);
        }) || '#editor';
    },

    _resetPasteCueState() {
        this._pasteCueReturnCount = 0;
        this._pasteCueActive = false;
        this._pasteDetectedInIndexHtml = false;
        this._pendingPasteReturnCue = false;
        this._windowWasAway = false;
        this._lastReturnCueAt = 0;
        this._pasteCueCheckInFlight = false;
    },

    _isTourVisible() {
        return !!(this._modalEl && this._modalEl.classList.contains('show'));
    },

    _getStepIndexById(stepId) {
        const steps = this._steps();
        return steps.findIndex(step => step && step.id === stepId);
    },

    _shouldQueuePasteReturnCue() {
        if (!this._isBeginnerOnboardingActive()) return false;
        if (!this._pasteCueActive) return false;
        if (this._pasteDetectedInIndexHtml) return false;
        if (this._pasteCueReturnCount >= this._pasteCueMaxReturns) return false;

        const pasteStepIndex = this._getStepIndexById('paste-code');
        const inEarlySteps = pasteStepIndex >= 0 && this._stepIndex <= pasteStepIndex;
        return this._pasteCueActive || inEarlySteps;
    },

    _handleVisibilityChange() {
        if (!this._isBeginnerOnboardingActive()) {
            this._pendingPasteReturnCue = false;
            this._windowWasAway = false;
            return;
        }
        if (document.hidden) {
            this._windowWasAway = true;
            this._queuePasteReturnCueIfEligible();
            return;
        }
        if (this._windowWasAway) {
            this._maybeRunPasteReturnCue();
        }
    },

    _handleWindowFocus() {
        if (!this._isBeginnerOnboardingActive()) {
            this._pendingPasteReturnCue = false;
            this._windowWasAway = false;
            return;
        }
        if (this._windowWasAway || this._pendingPasteReturnCue) {
            this._maybeRunPasteReturnCue();
            return;
        }
        // Fallback for browser flows where blur/visibility is not reliable.
        if (this._pasteCueActive && !this._pasteDetectedInIndexHtml && this._pasteCueReturnCount < this._pasteCueMaxReturns) {
            this._runPasteReturnCue();
        }
    },

    _handleWindowBlur() {
        if (!this._isBeginnerOnboardingActive()) return;
        this._windowWasAway = true;
        this._queuePasteReturnCueIfEligible();
    },

    _queuePasteReturnCueIfEligible() {
        if (this._shouldQueuePasteReturnCue()) {
            this._pendingPasteReturnCue = true;
        }
    },

    _maybeRunPasteReturnCue() {
        if (!this._pendingPasteReturnCue && !this._windowWasAway) return;
        this._pendingPasteReturnCue = false;
        this._windowWasAway = false;
        this._runPasteReturnCue();
    },

    _runPasteReturnCue() {
        if (!this._isBeginnerOnboardingActive()) return;
        if (!this._pasteCueActive) return;
        if (this._pasteDetectedInIndexHtml) return;
        if (this._pasteCueReturnCount >= this._pasteCueMaxReturns) return;
        if (this._pasteCueCheckInFlight) return;
        const now = Date.now();
        if (now - this._lastReturnCueAt < 350) return;
        this._lastReturnCueAt = now;
        this._pasteCueCheckInFlight = true;

        Promise.resolve()
            .then(async () => {
                const htmlText = await this._readIndexHtmlTextForPasteCue();
                if (this._looksPopulatedHtml(htmlText)) {
                    this._pasteDetectedInIndexHtml = true;
                    this._pendingPasteReturnCue = false;
                    this._pasteCueActive = false;
                    this._clearPasteFlash();
                    this._hideAiServicesProviderTip();
                    return;
                }

                this._pasteCueActive = true;
                this._pasteCueReturnCount += 1;

                // Always jump to the paste-code step so the instruction is visible
                // regardless of where the user was in the tour.
                const pasteStepIndex = this._getStepIndexById('paste-code');
                if (pasteStepIndex >= 0) {
                    this._stepIndex = pasteStepIndex;
                }

                const targetSelector = this._getPasteCodeHighlightSelector();
                if (!this._isTourVisible()) {
                    // Re-open the modal so the user sees the paste instruction, then
                    // render and flash once Bootstrap has finished showing it.
                    if (this._modal) {
                        this._modal.show();
                    }
                    // Wait for the modal show animation before rendering/flashing.
                    setTimeout(() => {
                        this._render();
                        setTimeout(() => {
                            this._preparePasteTarget({ flash: true });
                            this._applyStepThreeLikeCue();
                            this._applyHighlight(targetSelector);
                        }, 80);
                    }, 220);
                } else {
                    this._render();
                    setTimeout(() => {
                        this._preparePasteTarget({ flash: true });
                        this._applyStepThreeLikeCue();
                        this._applyHighlight(targetSelector);
                    }, 80);
                }
            })
            .catch(() => {
                // no-op
            })
            .finally(() => {
                this._pasteCueCheckInFlight = false;
            });
    },

    _handleDocumentPaste(event) {
        if (!this._isTourVisible()) return;
        if (this._pasteDetectedInIndexHtml) return;

        const editorHost = document.getElementById('editor');
        if (!editorHost || !editorHost.contains(event.target)) return;
        if (!(window.editor && typeof editor.getActiveUuid === 'function')) return;

        const activeUuid = editor.getActiveUuid();
        if (!activeUuid) return;

        const meta = editor._meta ? editor._meta[activeUuid] : null;
        const activeName = String(meta && meta.name ? meta.name : '').trim().toLowerCase();
        if (activeName !== 'index.html') return;

        const pastedText = (event.clipboardData || window.clipboardData)?.getData?.('text') || '';
        if (!String(pastedText).trim()) return;

        this._pasteDetectedInIndexHtml = true;
        this._pendingPasteReturnCue = false;
        this._clearPasteFlash();
        this._hideAiServicesProviderTip();
    },

    _hideAiServicesProviderTip() {
        if (typeof window.hideForgeBeginnerProviderTip === 'function') {
            window.hideForgeBeginnerProviderTip();
        }
    },

    _clearPasteFlash() {
        if (this._pasteFlashTimer) {
            clearTimeout(this._pasteFlashTimer);
            this._pasteFlashTimer = null;
        }
        this._getPasteFlashTargets().forEach(el => el.classList.remove('forge-tour-paste-flash'));
        if (this._stepThreeCueTimer) {
            clearTimeout(this._stepThreeCueTimer);
            this._stepThreeCueTimer = null;
        }
        if (!(this._highlightedEl && this._highlightedEl.id === 'editor')) {
            this._getStepThreeLikeTargets().forEach(el => el.classList.remove('forge-walkthrough-highlight'));
        }
    },

    _getStepThreeLikeTargets() {
        const targets = [];
        const activePane = document.querySelector('#editor .editor:not([style*="display: none"])');
        if (activePane) targets.push(activePane);

        const cmEditor = document.querySelector('#editor .editor:not([style*="display: none"]) .cm-editor')
            || document.querySelector('#editor .cm-editor');
        if (cmEditor) targets.push(cmEditor);

        if (!targets.length) {
            const editorHost = document.getElementById('editor');
            if (editorHost) targets.push(editorHost);
        }

        return Array.from(new Set(targets.filter(Boolean)));
    },

    _applyStepThreeLikeCue() {
        const targets = this._getStepThreeLikeTargets();
        if (!targets.length) return;

        targets.forEach(el => {
            el.classList.remove('forge-walkthrough-highlight');
            void el.offsetWidth;
            el.classList.add('forge-walkthrough-highlight');
        });

        if (this._stepThreeCueTimer) clearTimeout(this._stepThreeCueTimer);
        this._stepThreeCueTimer = setTimeout(() => {
            if (this._isTourVisible() && this._stepIndex === this._getStepIndexById('paste-code')) {
                this._stepThreeCueTimer = null;
                return;
            }
            targets.forEach(el => {
                if (this._highlightedEl !== el) el.classList.remove('forge-walkthrough-highlight');
            });
            this._stepThreeCueTimer = null;
        }, 2400);
    },

    _getPasteFlashTargets() {
        const targets = [];
        const activeEditorPane = document.querySelector('#editor .editor[style*="display: block"]')
            || document.querySelector('#editor .editor:not([style*="display: none"])');
        if (activeEditorPane) targets.push(activeEditorPane);
        const cmInActivePane = activeEditorPane ? activeEditorPane.querySelector('.cm-editor') : null;
        if (cmInActivePane) targets.push(cmInActivePane);
        const anyCmEditor = document.querySelector('#editor .cm-editor');
        if (anyCmEditor) targets.push(anyCmEditor);

        if (!targets.length) {
            const editorHost = document.getElementById('editor');
            if (editorHost) targets.push(editorHost);
        }

        const activeTab = document.querySelector('#editor-container .nav-link.active');
        if (activeTab) targets.push(activeTab);

        return Array.from(new Set(targets.filter(Boolean)));
    },

    _flashPasteTarget() {
        const targets = this._getPasteFlashTargets();
        if (!targets.length) return;

        this._clearPasteFlash();
        targets.forEach(el => {
            el.classList.remove('forge-tour-paste-flash');
            void el.offsetWidth;
            el.classList.add('forge-tour-paste-flash');
        });

        this._pasteFlashTimer = setTimeout(() => {
            this._getPasteFlashTargets().forEach(el => el.classList.remove('forge-tour-paste-flash'));
            this._pasteFlashTimer = null;
        }, 2100);
    },

    async _focusIndexHtmlEditor() {
        this._openTab('a#editor-tab');
        if (!(window.editor && typeof editor.openFile === 'function')) return false;

        const activeUuid = typeof editor.getActiveUuid === 'function' ? editor.getActiveUuid() : null;
        const activeMeta = activeUuid && editor._meta ? editor._meta[activeUuid] : null;
        if (String(activeMeta && activeMeta.name ? activeMeta.name : '').trim().toLowerCase() === 'index.html') {
            const activeView = activeUuid && editor.instance ? editor.instance[activeUuid] : null;
            if (activeView && typeof activeView.focus === 'function') activeView.focus();
            return true;
        }

        const files = Array.isArray(loadFolder.fileStructure) ? loadFolder.fileStructure : [];
        if (!files.length) {
            const tabIndexLink = Array.from(document.querySelectorAll('#editor-container .nav-link[id^="nav-"]'))
                .find(el => String(el.querySelector('.filename')?.textContent || '').trim().toLowerCase() === 'index.html');
            if (tabIndexLink) {
                const openUuid = String(tabIndexLink.id || '').replace(/^nav-/, '');
                if (openUuid) {
                    try {
                        await editor.openFile(openUuid);
                        const view = editor.instance ? editor.instance[openUuid] : null;
                        if (view && typeof view.focus === 'function') view.focus();
                        return true;
                    } catch (_) {
                        // Continue to other fallbacks.
                    }
                }
            }

            const openIndexUuid = Object.keys(editor._meta || {}).find(uuid =>
                String(editor._meta[uuid]?.name || '').trim().toLowerCase() === 'index.html'
            );
            if (!openIndexUuid) return false;
            try {
                await editor.openFile(openIndexUuid);
                const view = editor.instance ? editor.instance[openIndexUuid] : null;
                if (view && typeof view.focus === 'function') view.focus();
                return true;
            } catch (_) {
                return false;
            }
        }

        const rootIndexFile = files.find(file =>
            String(file && file.name ? file.name : '').trim().toLowerCase() === 'index.html' &&
            Array.isArray(file.path) &&
            file.path.length === 0
        );
        const anyIndexFile = rootIndexFile || files.find(file =>
            String(file && file.name ? file.name : '').trim().toLowerCase() === 'index.html'
        );
        if (!anyIndexFile || !anyIndexFile.uuid) {
            const treeIndexItem = Array.from(document.querySelectorAll('#file-tree li.file[data-uuid]'))
                .find(el => String(el.querySelector('.file-label')?.textContent || '').trim().toLowerCase() === 'index.html');
            if (!treeIndexItem) return false;
            const treeUuid = treeIndexItem.getAttribute('data-uuid');
            if (!treeUuid) return false;
            try {
                treeIndexItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await new Promise(resolve => setTimeout(resolve, 80));
                const clickedActiveUuid = typeof editor.getActiveUuid === 'function' ? editor.getActiveUuid() : null;
                const clickedMeta = clickedActiveUuid && editor._meta ? editor._meta[clickedActiveUuid] : null;
                if (String(clickedMeta && clickedMeta.name ? clickedMeta.name : '').trim().toLowerCase() === 'index.html') {
                    const clickedView = clickedActiveUuid && editor.instance ? editor.instance[clickedActiveUuid] : null;
                    if (clickedView && typeof clickedView.focus === 'function') clickedView.focus();
                    return true;
                }
                await editor.openFile(treeUuid);
                const view = editor.instance ? editor.instance[treeUuid] : null;
                if (view && typeof view.focus === 'function') view.focus();
                return true;
            } catch (_) {
                return false;
            }
        }

        try {
            await editor.openFile(anyIndexFile.uuid);
            const activeUuid = typeof editor.getActiveUuid === 'function' ? editor.getActiveUuid() : null;
            const view = activeUuid && editor.instance ? editor.instance[activeUuid] : null;
            if (view && typeof view.focus === 'function') view.focus();
            return true;
        } catch (_) {
            return false;
        }
    },

    _preparePasteTarget({ flash = false } = {}) {
        this._focusIndexHtmlEditor()
            .catch(() => false)
            .then((selected) => {
                if (flash) {
                    this._flashPasteTarget();
                    this._applyStepThreeLikeCue();
                    this._applyHighlight('#editor');
                }
                if (selected) return;
                // Retry once shortly after render/tree refresh to catch delayed file metadata.
                setTimeout(() => {
                    this._focusIndexHtmlEditor().catch(() => false).finally(() => {
                        if (flash) {
                            this._flashPasteTarget();
                            this._applyStepThreeLikeCue();
                            this._applyHighlight('#editor');
                        }
                    });
                }, 220);
            });
    },

    _escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    async _copyTextToClipboard(text) {
        if (!text) return false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {
            // Continue to fallback.
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

    _isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
    },

    _openTab(selector) {
        const tab = document.querySelector(selector);
        if (!tab || tab.classList.contains('disabled')) {
            return false;
        }
        if (window.bootstrap && bootstrap.Tab) {
            bootstrap.Tab.getOrCreateInstance(tab).show();
            return true;
        }
        tab.click();
        return true;
    },

    _resolveStepText(value) {
        if (typeof value === 'function') {
            try {
                return String(value());
            } catch (_) {
                return '';
            }
        }
        return String(value || '');
    },

    _findTargetSelector(step) {
        const options = Array.isArray(step.targetOptions) ? step.targetOptions : [];
        if (!options.length) return '';

        const visible = options.find(sel => {
            const el = document.querySelector(sel);
            return this._isVisible(el);
        });
        if (visible) return visible;

        const existing = options.find(sel => !!document.querySelector(sel));
        return existing || '';
    },

    _ensureTargetArrow() {
        if (this._targetArrowEl && document.body.contains(this._targetArrowEl)) {
            return this._targetArrowEl;
        }

        const el = document.createElement('div');
        el.id = 'forge-walkthrough-target-arrow';
        el.innerHTML = `
            <span class="forge-walkthrough-target-arrow-label">Click here</span>
            <span class="forge-walkthrough-target-arrow-glyph" aria-hidden="true">↓</span>
        `;
        document.body.appendChild(el);
        this._targetArrowEl = el;
        return el;
    },

    _hideTargetArrow() {
        if (!this._targetArrowEl) return;
        this._targetArrowEl.classList.remove('is-visible', 'is-below');
    },

    _positionTargetArrow(targetEl = this._highlightedEl) {
        const arrow = this._ensureTargetArrow();
        if (!arrow || !targetEl || !this._isVisible(targetEl)) {
            this._hideTargetArrow();
            return;
        }

        let rect;
        try {
            rect = targetEl.getBoundingClientRect();
        } catch (_) {
            this._hideTargetArrow();
            return;
        }
        if (!rect || (!rect.width && !rect.height)) {
            this._hideTargetArrow();
            return;
        }

        const viewportW = window.innerWidth || document.documentElement.clientWidth || 1280;
        const viewportH = window.innerHeight || document.documentElement.clientHeight || 720;
        if (rect.bottom < 0 || rect.top > viewportH || rect.right < 0 || rect.left > viewportW) {
            this._hideTargetArrow();
            return;
        }

        arrow.classList.remove('is-visible', 'is-below');
        arrow.style.left = '-9999px';
        arrow.style.top = '-9999px';

        const arrowW = arrow.offsetWidth || 120;
        const arrowH = arrow.offsetHeight || 38;
        const gap = 10;

        const centerX = rect.left + (rect.width / 2);
        const minLeft = 8;
        const maxLeft = Math.max(8, viewportW - arrowW - 8);
        const left = Math.min(Math.max(centerX - (arrowW / 2), minLeft), maxLeft);

        let top = rect.top - arrowH - gap;
        let placeBelow = false;
        if (top < 8) {
            placeBelow = true;
            top = rect.bottom + gap;
        }

        arrow.style.left = `${Math.round(left)}px`;
        arrow.style.top = `${Math.round(top)}px`;
        arrow.classList.toggle('is-below', placeBelow);
        arrow.classList.add('is-visible');
    },

    _clearHighlight() {
        if (this._highlightedEl) {
            this._highlightedEl.classList.remove('forge-walkthrough-highlight');
            this._highlightedEl = null;
        }
        this._hideTargetArrow();
    },

    _applyHighlight(selector) {
        this._clearHighlight();
        if (!selector) return;

        const el = document.querySelector(selector);
        if (!el || !this._isVisible(el)) return;

        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch (_) {
            // no-op
        }

        el.classList.add('forge-walkthrough-highlight');
        this._highlightedEl = el;
        this._positionTargetArrow(el);
    },

    _resetModalPosition() {
        const dialog = this._modalEl ? this._modalEl.querySelector('.modal-dialog') : null;
        if (!dialog) return;
        dialog.style.position = '';
        dialog.style.margin = '';
        dialog.style.transform = '';
        dialog.style.left = '';
        dialog.style.top = '';
        dialog.style.width = '';
        dialog.style.maxWidth = '';
    },

    _positionModalCenter() {
        const dialog = this._modalEl ? this._modalEl.querySelector('.modal-dialog') : null;
        if (!dialog) return;

        const viewportW = window.innerWidth || document.documentElement.clientWidth || 1280;
        const viewportH = window.innerHeight || document.documentElement.clientHeight || 720;
        const gutter = 12;
        const maxDialogWidth = Math.min(640, Math.max(380, viewportW - (gutter * 2)));

        dialog.style.position = 'fixed';
        dialog.style.margin = '0';
        dialog.style.transform = 'none';
        dialog.style.width = `${maxDialogWidth}px`;
        dialog.style.maxWidth = `calc(100vw - ${gutter * 2}px)`;
        dialog.style.left = `${gutter}px`;
        dialog.style.top = `${gutter}px`;

        const rect = dialog.getBoundingClientRect();
        const dialogW = rect.width || maxDialogWidth;
        const dialogH = rect.height || Math.min(560, viewportH - (gutter * 2));

        const left = Math.max(gutter, Math.round((viewportW - dialogW) / 2));
        const top = Math.max(gutter, Math.round((viewportH - dialogH) / 2));

        dialog.style.left = `${left}px`;
        dialog.style.top = `${top}px`;
    },

    _positionModalNearTarget(selector, preferredPlacement = '', strictPlacement = false) {
        const dialog = this._modalEl ? this._modalEl.querySelector('.modal-dialog') : null;
        if (!dialog) return;

        const viewportW = window.innerWidth || document.documentElement.clientWidth || 1280;
        const viewportH = window.innerHeight || document.documentElement.clientHeight || 720;
        const gutter = 12;
        const maxDialogWidth = Math.min(560, Math.max(360, viewportW - (gutter * 2)));

        dialog.style.position = 'fixed';
        dialog.style.margin = '0';
        dialog.style.transform = 'none';
        dialog.style.width = `${maxDialogWidth}px`;
        dialog.style.maxWidth = `calc(100vw - ${gutter * 2}px)`;
        dialog.style.left = `${gutter}px`;
        dialog.style.top = `${gutter}px`;

        const dialogRect = dialog.getBoundingClientRect();
        const dialogW = dialogRect.width || maxDialogWidth;
        const measuredHeight = dialogRect.height || dialog.scrollHeight || dialog.offsetHeight || 420;
        const maxHeightInViewport = Math.max(220, viewportH - (gutter * 2));
        const dialogH = Math.min(measuredHeight, maxHeightInViewport);

        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
        const topMax = Math.max(gutter, viewportH - dialogH - gutter);
        const leftMax = Math.max(gutter, viewportW - dialogW - gutter);

        const targetEl = selector ? document.querySelector(selector) : null;
        let rect = null;

        if (targetEl) {
            try {
                rect = targetEl.getBoundingClientRect();
            } catch (_) {
                rect = null;
            }
        }

        if (!rect || (!rect.width && !rect.height)) {
            let visibleAnchor = targetEl;
            while (visibleAnchor && visibleAnchor !== document.body && !this._isVisible(visibleAnchor)) {
                visibleAnchor = visibleAnchor.parentElement;
            }
            if (visibleAnchor && visibleAnchor !== document.body) {
                rect = visibleAnchor.getBoundingClientRect();
            }
        }

        if (!rect || (!rect.width && !rect.height)) {
            // No target geometry available yet: avoid hard-right fallback.
            const centeredLeft = clamp(Math.round((viewportW - dialogW) / 2), gutter, leftMax);
            const centeredTop = clamp(Math.round((viewportH - dialogH) / 2), gutter, topMax);
            dialog.style.left = `${centeredLeft}px`;
            dialog.style.top = `${centeredTop}px`;
            return;
        }

        // For critical steps (e.g., Quick Prompts), keep the tour strictly left
        // of the target so the target remains clickable and unobstructed.
        if (strictPlacement && preferredPlacement === 'left') {
            const top = clamp(rect.top, gutter, topMax);
            const availableLeftWidth = Math.floor(rect.left - (gutter * 2));

            if (availableLeftWidth >= 260) {
                const forcedWidth = Math.min(dialogW, availableLeftWidth);
                dialog.style.width = `${Math.round(forcedWidth)}px`;
                dialog.style.maxWidth = `${Math.round(forcedWidth)}px`;
                dialog.style.left = `${Math.round(rect.left - forcedWidth - gutter)}px`;
                dialog.style.top = `${Math.round(top)}px`;
                return;
            }

            // If the viewport is too tight, keep left-side intent and allow partial off-screen
            // rather than covering the target control.
            dialog.style.left = `${Math.round(rect.left - dialogW - gutter)}px`;
            dialog.style.top = `${Math.round(top)}px`;
            return;
        }
        const placements = {
            right: {
                left: rect.right + gutter,
                top: rect.top
            },
            left: {
                left: rect.left - dialogW - gutter,
                top: rect.top
            },
            below: {
                left: rect.left,
                top: rect.bottom + gutter
            },
            above: {
                left: rect.left,
                top: rect.top - dialogH - gutter
            }
        };

        let order = ['right', 'left', 'below', 'above'];
        if (preferredPlacement === 'left') {
            order = ['left', 'above', 'below', 'right'];
        } else if (preferredPlacement === 'right') {
            order = ['right', 'above', 'below', 'left'];
        } else if (preferredPlacement === 'above') {
            order = ['above', 'left', 'right', 'below'];
        } else if (preferredPlacement === 'below') {
            order = ['below', 'left', 'right', 'above'];
        }

        const candidates = order.map(name => placements[name]).filter(Boolean);

        const pick = candidates.find(candidate =>
            candidate.left >= gutter &&
            candidate.top >= gutter &&
            candidate.left + dialogW <= viewportW - gutter &&
            candidate.top + dialogH <= viewportH - gutter
        );

        let chosen = pick;
        if (!chosen) {
            const preferred = order[0] || 'right';
            chosen = placements[preferred] || placements.right;
        }

        const finalLeft = clamp(chosen.left, gutter, leftMax);
        const finalTop = clamp(chosen.top, gutter, topMax);
        dialog.style.left = `${Math.round(finalLeft)}px`;
        dialog.style.top = `${Math.round(finalTop)}px`;
    },

    _renderStepList(steps) {
        const listEl = document.getElementById('forge-walkthrough-step-list');
        if (!listEl) return;

        listEl.innerHTML = steps.map((step, idx) => {
            const isCurrent = idx === this._stepIndex;
            const cls = isCurrent ? 'forge-walkthrough-step-current' : 'forge-walkthrough-step-item';
            const label = step.title.replace(/^\d+\)\s*/, '');
            return `<li><button type="button" class="${cls} forge-walkthrough-step-link" data-step-index="${idx}">${idx + 1}. ${label}</button></li>`;
        }).join('');
    },

    _render() {
        const steps = this._steps();
        const step = steps[this._stepIndex];
        if (!step) return;

        if (typeof step.onEnter === 'function') {
            try {
                step.onEnter();
            } catch (_) {
                // no-op
            }
        }

        const titleEl = document.getElementById('forge-walkthrough-step-title');
        const instructionsEl = document.getElementById('forge-walkthrough-step-instructions');
        const purposeEl = document.getElementById('forge-walkthrough-step-purpose');
        const tipEl = document.getElementById('forge-walkthrough-step-tip');
        const extraEl = document.getElementById('forge-walkthrough-step-extra');
        const progressEl = document.getElementById('forge-walkthrough-progress');
        const prevBtn = document.getElementById('forge-walkthrough-prev-btn');
        const nextBtn = document.getElementById('forge-walkthrough-next-btn');

        if (titleEl) titleEl.textContent = step.title;
        if (instructionsEl) instructionsEl.textContent = this._resolveStepText(step.instructions);
        if (purposeEl) purposeEl.textContent = this._resolveStepText(step.purpose);
        if (tipEl) tipEl.textContent = this._resolveStepText(step.tip);
        if (extraEl) extraEl.innerHTML = step.extraHtml ? this._resolveStepText(step.extraHtml) : '';

        if (progressEl) {
            progressEl.textContent = `Step ${this._stepIndex + 1} of ${steps.length}`;
        }

        if (prevBtn) prevBtn.disabled = this._stepIndex === 0;
        if (nextBtn) {
            const isLast = this._stepIndex === steps.length - 1;
            nextBtn.textContent = isLast ? 'Finish' : 'Next';
        }

        this._renderStepList(steps);

        const selector = this._findTargetSelector(step);
        this._lastCenterModal = !!step.centerModal;
        this._lastModalPlacement = String(step.modalPlacement || '');
        this._lastStrictPlacement = !!step.strictPlacement;
        this._lastTargetSelector = selector || '';
        this._applyHighlight(selector);
        if (this._lastCenterModal) {
            this._positionModalCenter();
        } else {
            this._positionModalNearTarget(selector, this._lastModalPlacement, this._lastStrictPlacement);
        }

        const renderIndex = this._stepIndex;
        setTimeout(() => {
            if (this._stepIndex !== renderIndex) return;
            if (!(this._modalEl && this._modalEl.classList.contains('show'))) return;
            const retrySelector = this._findTargetSelector(step);
            this._lastCenterModal = !!step.centerModal;
            this._lastModalPlacement = String(step.modalPlacement || '');
            this._lastStrictPlacement = !!step.strictPlacement;
            this._lastTargetSelector = retrySelector || '';
            this._applyHighlight(retrySelector);
            if (this._lastCenterModal) {
                this._positionModalCenter();
            } else {
                this._positionModalNearTarget(retrySelector, this._lastModalPlacement, this._lastStrictPlacement);
            }
        }, 260);
    },

    _goPrev() {
        if (this._stepIndex <= 0) return;
        this._stepIndex -= 1;
        this._render();
    },

    _goNext() {
        const steps = this._steps();
        if (this._stepIndex >= steps.length - 1) {
            this._resetPasteCueState();
            this._openTab('a#editor-tab');
            if (this._modal) this._modal.hide();
            return;
        }
        this._stepIndex += 1;
        this._render();
    }
};
