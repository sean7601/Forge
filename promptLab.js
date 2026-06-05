/* ── Prompt Lab ──────────────────────────────────────────────
   Right-panel prompt builder for Forge.
   Types: new-build, edit, debug, feature-add
   Each type has Task + Context + Format sections.
   ─────────────────────────────────────────────────────────── */
const promptLab = (() => {
    'use strict';

    let activeType = 'new-build';
    const activeOutputModes = {
        edit: 'full-file',
        debug: 'full-file'
    };
    const taskValues = {}; // per-type task text storage

    /* ── format strings ── */
    const FORMAT_STANDARD =
        '• Single-file, vanilla HTML/CSS/JS that works from file://\n' +
        '• Offline — Only use libraries that could later be inlined (no tailwind, etc)\n' +
        '• Return the complete file, not snippets';

    const FORMAT_EDIT_FULL_FILE =
        '- Keep existing behavior unless explicitly asked to change it\n' +
        '- Vanilla HTML/CSS/JS that works from file://\n' +
        '- Return the full contents of each file that needs to change, not a diff\n' +
        '- Include unchanged parts of changed files so I can manually copy/paste the whole file into Forge\n' +
        '- Do not return partial snippets or step-by-step edit instructions';

    const FORMAT_EDIT_DIFF =
        '- Keep existing behavior unless explicitly asked to change it\n' +
        '- Vanilla HTML/CSS/JS that works from file://\n' +
        '- Return one copy/pasteable unified diff only, not complete files\n' +
        '- Do not use markdown fences around the diff\n' +
        '- Do not add custom wrapper marker lines\n' +
        '- Include all changed files in that single diff\n' +
        '- Use git-style file headers: diff --git, ---, +++, and @@ hunks\n' +
        '- Prefer small independent hunks; do not group unrelated replacements into one large hunk\n' +
        '- Keep enough unchanged context around each hunk to identify the location uniquely\n' +
        '- Do not output files you are not changing\n' +
        '- Do not include explanation text before or after the diff';

    const FORMAT_DEBUG_FULL_FILE =
        '- Keep unrelated behavior intact\n' +
        '- Return the full contents of each file that needs to change, not a diff\n' +
        '- Include unchanged parts of changed files so I can manually copy/paste the whole file into Forge\n' +
        '- Do not return partial snippets or step-by-step edit instructions\n' +
        '- Do not output files you are not changing';

    const FORMAT_DEBUG_DIFF =
        '- Keep unrelated behavior intact\n' +
        '- Return one copy/pasteable unified diff only, not complete files\n' +
        '- Do not use markdown fences around the diff\n' +
        '- Do not add custom wrapper marker lines\n' +
        '- Include all changed files in that single diff\n' +
        '- Use git-style file headers: diff --git, ---, +++, and @@ hunks\n' +
        '- Prefer small independent hunks; do not group unrelated replacements into one large hunk\n' +
        '- Keep enough unchanged context around each hunk to identify the location uniquely\n' +
        '- Do not output files you are not changing\n' +
        '- Do not include explanation text before or after the diff';

const TASK_DEBUG_FIXED = 'Debug and fix this issue in my offline HTML app that works from file://:';    
    const FIREPIT_SHAREPOINT_DEBUG_CONTEXT =
        'Bug only reproduces inside the SharePoint-hosted Firepit renderer. Firepit renders the app inside a sandboxed iframe loaded from a blob URL. In standard sandbox mode forms are not allowed because the iframe sandbox omits allow-forms; permissive mode adds allow-forms. In Lock Down Mode, Firepit injects a CSP with connect-src \'none\' and form-action \'none\', so form submissions and non-SharePoint/external API calls can be blocked. Firepit also injects SharePoint page context, applies host CSP nonces to script/style tags, and SharePoint/MCAS cleanup can break inline event handlers such as onclick. Treat likely culprits as native form submit behavior, fetch/XMLHttpRequest or third-party API calls, and inline event attributes. Prefer addEventListener-based handlers, preventDefault for forms or replace forms with buttons, and use SharePoint-compatible APIs/context for any network persistence.';
    const LEGACY_INTELSHARE_DEBUG_CONTEXT =
        'Bug only reproduces on legacy IntelShare at intelshare.intelink.sgov.gov or intelshare.intelink.gov. The app is uploaded directly into the site SitePages library as an .aspx file and is not hosted by Firepit/SPFx. Treat likely culprits as classic SharePoint page form/postback behavior, page sanitation that removes or rewrites inline scripts/handlers, site-relative path assumptions, and SharePoint REST site detection. Prefer addEventListener-based handlers, explicit type="button" buttons, preventDefault for forms, and configured or _spPageContextInfo-derived site URLs for SharePoint API calls.';
    const SHIPPED_OFFLINE_DEBUG_CONTEXT =
        'Forge shipping removes the unshipped development banner, packages the app as a compiled single HTML artifact with an embedded manifest, may minify the HTML, and may wrap the app in Forge\'s runtime/security shell. Look for bugs introduced by compile/ship behavior, path or asset packaging changes, minification-sensitive code, manifest/runtime wrapping, or differences from the editable source app.';
    const NEW_BUILD_PREFIX = 'Build a single-file, vanilla, offline HTML file application that ';
    const EDIT_PREFIX = 'Edit my standalone html app so that ';

    // Map type → prefix (only types with a locked prefix)
    const TYPE_PREFIX = {
        'new-build': NEW_BUILD_PREFIX,
        'edit': EDIT_PREFIX,
    };

    /* ── type configs ── */
    const typeConfig = {
        'new-build': {
            taskPlaceholder: 'Describe what you want to build...',
            taskFixed: false,
            showNewChat: false,
            showFeatureMenu: false,
            format: FORMAT_STANDARD,
            pasteDirective: 'Paste into AI — <strong>start a new chat</strong>',
        },
        'edit': {
            taskPlaceholder: 'Describe the change you want to make...',
            taskFixed: false,
            showNewChat: true,
            showFeatureMenu: false,
            format: FORMAT_EDIT_FULL_FILE,
            pasteDirective: 'Paste into AI — <strong>continue the existing chat</strong> or start a new one with your code',
            pasteDirectiveNewChat: 'Paste into AI — <strong>start a new chat</strong> (codebase included)',
        },
        'debug': {
            taskFixed: true,
            taskFixedText: TASK_DEBUG_FIXED,
            showNewChat: true,
            showFeatureMenu: false,
            format: FORMAT_DEBUG_FULL_FILE,
            pasteDirective: 'Paste into AI — <strong>continue the existing chat</strong> or start a new one with your code',
            pasteDirectiveNewChat: 'Paste into AI — <strong>start a new chat</strong> (codebase included)',
        },
        'feature-add': {
            taskFixed: false,
            showNewChat: false,
            showFeatureMenu: true,
            format: null,
            pasteDirective: '',
        },
    };

    /* ── DOM refs (cached on init) ── */
    let els = {};

    function cacheElements() {
        els = {
            typeButtons: document.querySelectorAll('.pl-type-btn'),
            taskInput: document.getElementById('pl-task-input'),
            taskFixed: document.getElementById('pl-task-fixed'),
            taskSection: document.getElementById('pl-task-section'),
            debugContext: document.getElementById('pl-debug-context'),
            debugDescription: document.getElementById('pl-debug-description'),
            debugErrors: document.getElementById('pl-debug-errors'),
            debugReproEnv: document.getElementById('pl-debug-repro-env'),
            contextSection: document.getElementById('pl-context-section'),
            contextInput: document.getElementById('pl-context-input'),
            featureMenu: document.getElementById('pl-feature-menu'),
            newChatSection: document.getElementById('pl-newchat-section'),
            newChatCheckbox: document.getElementById('pl-new-chat'),
            editOutputModeSection: document.getElementById('pl-edit-output-mode-section'),
            editOutputModeButtons: document.querySelectorAll('.pl-mode-btn[data-pl-edit-mode]'),
            formatSection: document.getElementById('pl-format-section'),
            formatDisplay: document.getElementById('pl-format-display'),
            copyBtn: document.getElementById('pl-copy-btn'),
            importBtn: document.getElementById('apply-ai-response-btn'),
            importBtnLabel: document.getElementById('apply-ai-response-label'),
            copyFeedback: document.getElementById('pl-copy-feedback'),
            pasteDirective: document.getElementById('pl-paste-directive'),
            actionArea: document.querySelector('.pl-action-area'),
            devConsoleBtn: document.getElementById('pl-add-devconsole'),
            rpTabs: document.querySelectorAll('.right-panel-tab'),
            promptLabView: document.getElementById('prompt-lab-view'),
            prometheusView: document.getElementById('prometheus-view'),
            rightPanelContent: document.getElementById('right-panel-content'),
        };
    }

    /* ── get loaded folder ref (same helper as index.html) ── */
    function getLoadedFolderRef() {
        if (typeof loadFolder !== 'undefined' && loadFolder) return loadFolder;
        if (typeof window !== 'undefined' && window.loadFolder) return window.loadFolder;
        return null;
    }

    function isProjectLoaded() {
        const folder = getLoadedFolderRef();
        return !!(folder && folder.fileHandle);
    }

    /* ── gather codebase content for new-chat append ── */
    async function gatherCodebaseText() {
        const folder = getLoadedFolderRef();
        if (!folder || !Array.isArray(folder.fileStructure)) return '';

        // Find the entry point (prefer index.html)
        const htmlFiles = folder.fileStructure
            .filter(f => f && f.kind === 'file' && /\.html?$/i.test(String(f.relativePath || f.name || '')))
            .map(f => f);

        if (!htmlFiles.length) return '';

        // Sort: index.html first
        htmlFiles.sort((a, b) => {
            const aName = String(a.relativePath || a.name || '').toLowerCase();
            const bName = String(b.relativePath || b.name || '').toLowerCase();
            if (aName === 'index.html') return -1;
            if (bName === 'index.html') return 1;
            return aName.localeCompare(bName);
        });

        const entryFile = htmlFiles[0];
        const parts = [];

        try {
            // Gather all project files
            for (const file of folder.fileStructure) {
                if (!file || file.kind !== 'file') continue;
                const name = String(file.relativePath || file.name || '');
                const baseName = name.replace(/\\/g, '/').split('/').pop().toLowerCase();
                if (baseName === 'devconsole.js' || baseName === 'testrecorder.js') continue;
                // Skip non-code files
                if (!/\.(html?|css|js|json)$/i.test(name)) continue;
                try {
                    let content;
                    if (typeof folder.getFileContent === 'function') {
                        content = await folder.getFileContent(file);
                    } else if (file.entry && typeof file.entry.getFile === 'function') {
                        const fh = await file.entry.getFile();
                        content = await fh.text();
                    }
                    if (content) {
                        parts.push(`--- ${name} ---`);
                        parts.push(content);
                        parts.push('');
                    }
                } catch (_) {
                    // skip unreadable files
                }
            }
        } catch (_) {
            // fallback: no code appended
        }

        return parts.join('\n');
    }

    /* ── switch prompt type ── */
    function getOutputMode(type = activeType) {
        return activeOutputModes[type] === 'diff' ? 'diff' : 'full-file';
    }

    function getEditFormat() {
        return getOutputMode('edit') === 'diff' ? FORMAT_EDIT_DIFF : FORMAT_EDIT_FULL_FILE;
    }

    function getDebugFormat() {
        return getOutputMode('debug') === 'diff' ? FORMAT_DEBUG_DIFF : FORMAT_DEBUG_FULL_FILE;
    }

    function getActiveFormat() {
        if (activeType === 'edit') return getEditFormat();
        if (activeType === 'debug') return getDebugFormat();
        const cfg = typeConfig[activeType];
        return cfg && cfg.format ? cfg.format : '';
    }

    function refreshFormatDisplay() {
        if (!els.formatDisplay) return;
        const format = getActiveFormat();
        if (format) {
            els.formatDisplay.textContent = format;
        }
    }

    function refreshActionButtons() {
        const supportsImport = (activeType === 'edit' || activeType === 'debug') && getOutputMode(activeType) === 'diff';
        if (els.importBtn) {
            els.importBtn.style.display = supportsImport ? '' : 'none';
            if (activeType === 'edit') {
                const label = 'Apply AI Diff';
                els.importBtn.title = 'Paste one copied AI unified diff back into Forge';
                if (els.importBtnLabel) {
                    els.importBtnLabel.textContent = label;
                }
            } else if (activeType === 'debug') {
                els.importBtn.title = 'Paste one copied AI unified diff back into Forge';
                if (els.importBtnLabel) els.importBtnLabel.textContent = 'Apply AI Diff';
            }
        }
        const actionButtons = document.querySelector('.pl-action-buttons');
        if (actionButtons) {
            actionButtons.classList.toggle('pl-action-buttons-single', !supportsImport);
        }
    }

    function refreshOutputModeButtons() {
        if (!els.editOutputModeButtons) return;
        els.editOutputModeButtons.forEach(btn => {
            const isActive = btn.getAttribute('data-pl-edit-mode') === getOutputMode(activeType);
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });
    }

    function updateCodeOutputMode(mode) {
        if (activeType !== 'edit' && activeType !== 'debug') return;
        activeOutputModes[activeType] = mode === 'diff' ? 'diff' : 'full-file';
        refreshOutputModeButtons();
        refreshFormatDisplay();
        refreshActionButtons();
        hideFeedback();
    }

    function switchType(type) {
        if (!typeConfig[type]) return;
        // Save current task text before switching (skip if switching to same type)
        if (els.taskInput && activeType !== type) {
            taskValues[activeType] = els.taskInput.value;
        }
        activeType = type;
        const cfg = typeConfig[type];

        // Update active button
        els.typeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-pl-type') === type);
        });

        const isDebug = type === 'debug';
        const isFeature = type === 'feature-add';

        // Task section: hide for feature-add and debug; debug keeps its fixed task in copied prompt
        if (isFeature || isDebug) {
            els.taskSection.style.display = 'none';
        } else if (cfg.taskFixed) {
            els.taskSection.style.display = '';
            els.taskInput.style.display = 'none';
            els.taskFixed.style.display = '';
            els.taskFixed.textContent = cfg.taskFixedText;
        } else {
            els.taskSection.style.display = '';
            els.taskInput.style.display = '';
            els.taskFixed.style.display = 'none';
            els.taskInput.placeholder = cfg.taskPlaceholder;
            // Restore per-type task value
            const prefix = TYPE_PREFIX[type] || '';
            if (prefix) {
                els.taskInput.value = taskValues[type] !== undefined ? taskValues[type] : prefix;
            } else {
                els.taskInput.value = taskValues[type] || '';
            }
        }

        // Context section: show debug fields, standard context, or hide for feature
        els.debugContext.style.display = isDebug ? '' : 'none';
        if (isDebug) refreshDevConsoleBtn();
        els.contextSection.style.display = (!isDebug && !isFeature) ? '' : 'none';

        // Feature menu
        els.featureMenu.style.display = isFeature ? '' : 'none';

        // New chat toggle: show for edit/debug (types that work on existing code)
        els.newChatSection.style.display = cfg.showNewChat ? '' : 'none';
        if (els.editOutputModeSection) {
            els.editOutputModeSection.style.display = (type === 'edit' || type === 'debug') ? '' : 'none';
        }
        refreshOutputModeButtons();

        // Format display is still included in copied debug prompts, but hidden from the debug UI
        els.formatSection.style.display = (isFeature || isDebug) ? 'none' : '';
        els.actionArea.style.display = isFeature ? 'none' : '';
        refreshActionButtons();

        // Format display
        refreshFormatDisplay();

        // Hide feedback on type switch
        hideFeedback();
    }

    /* ── build prompt text ── */
    function getDebugReproPromptDetails(environment) {
        if (environment === 'shipped-offline') {
            return {
                label: 'Bug only reproduces in the shipped offline build.',
                contextHeading: 'Shipped offline context:',
                context: SHIPPED_OFFLINE_DEBUG_CONTEXT
            };
        }
        if (environment === 'flankspeed-sharepoint') {
            return {
                label: 'Bug only reproduces in Flank Speed SharePoint / Firepit.',
                contextHeading: 'Flank Speed SharePoint / Firepit context:',
                context: FIREPIT_SHAREPOINT_DEBUG_CONTEXT
            };
        }
        if (environment === 'legacy-intelshare') {
            return {
                label: 'Bug only reproduces in legacy IntelShare.',
                contextHeading: 'Legacy IntelShare context:',
                context: LEGACY_INTELSHARE_DEBUG_CONTEXT
            };
        }
        return {
            label: 'Bug reproduces in the editable development copy before shipping.',
            contextHeading: '',
            context: ''
        };
    }

    function buildPrompt() {
        const cfg = typeConfig[activeType];
        const parts = [];

        // Task
        if (activeType === 'debug') {
            parts.push(TASK_DEBUG_FIXED);
        } else {
            const task = (els.taskInput.value || '').trim();
            if (!task) return null; // nothing to build
            if (activeType === 'new-build') {
                parts.push(task);
            } else if (activeType === 'edit') {
                parts.push(task);
            }
        }

        // Context
        if (activeType === 'debug') {
            const desc = (els.debugDescription.value || '').trim();
            const errs = (els.debugErrors.value || '').trim() || 'No console errors shown.';
            const reproDetails = getDebugReproPromptDetails(els.debugReproEnv ? els.debugReproEnv.value : 'development-copy');
            if (!desc) return null;
            parts.push('');
            parts.push('Bug description:');
            parts.push(desc);
            parts.push('');
            parts.push('Console errors/logs:');
            parts.push(errs);
            parts.push('');
            parts.push('Reproduction environment:');
            parts.push(reproDetails.label);
            if (reproDetails.context) {
                parts.push('');
                parts.push(reproDetails.contextHeading);
                parts.push(reproDetails.context);
            }
        } else {
            const ctx = (els.contextInput.value || '').trim();
            if (ctx) {
                parts.push('');
                parts.push('Additional context:');
                parts.push(ctx);
            }
        }

        // Format requirements
        parts.push('');
        parts.push(getActiveFormat().replace(/^• /gm, '- '));

        return parts.join('\n');
    }

    /* ── clipboard copy with feedback ── */
    async function copyPrompt() {
        const text = buildPrompt();
        if (!text) {
            // Flash the relevant input
            if (activeType === 'debug') {
                els.debugDescription.focus();
                flashBorder(els.debugDescription);
            } else {
                els.taskInput.focus();
                flashBorder(els.taskInput);
            }
            return;
        }

        // If new-chat checked, append codebase
        let finalText = text;
        let appendedCode = false;
        if (els.newChatCheckbox && els.newChatCheckbox.checked && typeConfig[activeType].showNewChat) {
            const codebase = await gatherCodebaseText();
            if (codebase) {
                finalText = text + '\n\n--- CODEBASE ---\n' + codebase;
                appendedCode = true;
            }
        }

        try {
            await navigator.clipboard.writeText(finalText);
            if (activeType === 'edit' && typeof checkpointManager !== 'undefined' && checkpointManager && typeof checkpointManager.armPendingPasteCheckpoint === 'function') {
                checkpointManager.armPendingPasteCheckpoint(getEditCheckpointTitle());
            }
            showFeedback();
            dispatchPromptCopiedEvent({ appendedCode });
        } catch (err) {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = finalText;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (activeType === 'edit' && typeof checkpointManager !== 'undefined' && checkpointManager && typeof checkpointManager.armPendingPasteCheckpoint === 'function') {
                checkpointManager.armPendingPasteCheckpoint(getEditCheckpointTitle());
            }
            showFeedback();
            dispatchPromptCopiedEvent({ appendedCode });
        }
    }

    function dispatchPromptCopiedEvent({ appendedCode = false } = {}) {
        document.dispatchEvent(new CustomEvent('forge:prompt-lab-copied', {
            detail: {
                copied: true,
                source: 'prompt-lab',
                type: activeType,
                outputMode: (activeType === 'edit' || activeType === 'debug') ? getOutputMode(activeType) : null,
                appendedCode: !!appendedCode
            }
        }));
    }

    function showFeedback() {
        const cfg = typeConfig[activeType];
        const isNewChat = els.newChatCheckbox && els.newChatCheckbox.checked && cfg.showNewChat;

        // Animate copy button
        els.copyBtn.classList.add('copied');
        els.copyBtn.innerHTML =
            '<svg class="forge-inline-icon" viewBox="0 0 16 16" aria-hidden="true">' +
            '<path d="M3.5 8.5L6.5 11.5L12.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg> Copied!';

        // Show success banner
        els.copyFeedback.style.display = '';

        // Show paste directive
        els.pasteDirective.style.display = '';
        const directive = isNewChat && cfg.pasteDirectiveNewChat
            ? cfg.pasteDirectiveNewChat
            : cfg.pasteDirective;
        els.pasteDirective.innerHTML = directive;

        // Reset after delay
        setTimeout(() => {
            els.copyBtn.classList.remove('copied');
            els.copyBtn.innerHTML =
                '<svg class="forge-inline-icon" viewBox="0 0 16 16" aria-hidden="true">' +
                '<rect x="5" y="5" width="8" height="8" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
                '<path d="M11 5V3.5A1.3 1.3 0 0 0 9.7 2.2H3.5A1.3 1.3 0 0 0 2.2 3.5V9.7A1.3 1.3 0 0 0 3.5 11H5" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
                '</svg> Copy Prompt';
        }, 2400);

        // Keep feedback + directive visible a bit longer
        setTimeout(() => {
            hideFeedback();
        }, 5000);
    }

    function hideFeedback() {
        if (els.copyFeedback) els.copyFeedback.style.display = 'none';
        if (els.pasteDirective) els.pasteDirective.style.display = 'none';
    }

    function getEditCheckpointTitle() {
        if (!els.taskInput) return '';
        const raw = String(els.taskInput.value || '').trim();
        if (!raw) return '';
        if (raw.startsWith(EDIT_PREFIX)) {
            return raw.slice(EDIT_PREFIX.length).trim() || raw;
        }
        return raw;
    }

    function flashBorder(el) {
        el.style.borderColor = '#ef4444';
        el.style.boxShadow = '0 0 0 2px rgba(239,68,68,.25)';
        setTimeout(() => {
            el.style.borderColor = '';
            el.style.boxShadow = '';
        }, 1200);
    }

    /* ── DevConsole.js add/update button ── */
    function hasDevConsole() {
        if (typeof window.hasDevConsoleInLoadedProject === 'function') return window.hasDevConsoleInLoadedProject();
        const folder = getLoadedFolderRef();
        if (!folder || !Array.isArray(folder.fileStructure)) return false;
        return folder.fileStructure.some(f => f && f.kind === 'file' && String(f.name || '').toLowerCase() === 'devconsole.js');
    }

    function refreshDevConsoleBtn() {
        if (!els.devConsoleBtn) return;
        if (!isProjectLoaded()) {
            els.devConsoleBtn.style.display = 'none';
            return;
        }
        els.devConsoleBtn.style.display = '';
        if (hasDevConsole()) {
            els.devConsoleBtn.textContent = 'Update DevConsole.js';
        } else {
            els.devConsoleBtn.textContent = 'Add DevConsole.js to Project';
        }
    }

    async function handleDevConsoleClick() {
        if (!els.devConsoleBtn) return;
        if (typeof devConsoleTab === 'undefined' || !devConsoleTab || typeof devConsoleTab.addDevConsoleToProject !== 'function') {
            return;
        }
        const wasLabel = els.devConsoleBtn.textContent;
        els.devConsoleBtn.disabled = true;
        els.devConsoleBtn.textContent = hasDevConsole() ? 'Updating...' : 'Adding...';
        try {
            await devConsoleTab.addDevConsoleToProject();
            els.devConsoleBtn.classList.add('pl-devconsole-done');
            els.devConsoleBtn.textContent = hasDevConsole() ? 'Update DevConsole.js' : 'Add DevConsole.js to Project';
            setTimeout(() => els.devConsoleBtn.classList.remove('pl-devconsole-done'), 2000);
        } catch (_) {
            els.devConsoleBtn.textContent = wasLabel;
        } finally {
            els.devConsoleBtn.disabled = false;
            refreshDevConsoleBtn();
        }
    }

    /* ── feature-add: open incorporate modal ── */
    function handleFeatureClick(step) {
        const stepNum = Number(step);
        if (typeof openAdvancedIncorporateModal === 'function') {
            openAdvancedIncorporateModal(stepNum);
        } else if (typeof window.openAdvancedIncorporateModal === 'function') {
            window.openAdvancedIncorporateModal(stepNum);
        }
    }

    /* ── right-panel tab switching ── */
    function switchRpTab(tabName, options = {}) {
        els.rpTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-rp-tab') === tabName));

        if (tabName === 'prompt-lab') {
            els.promptLabView.classList.add('active');
            els.prometheusView.classList.remove('active');
        } else {
            els.promptLabView.classList.remove('active');
            els.prometheusView.classList.add('active');
            // Trigger Prometheus profile loading
            if (typeof aiAgent !== 'undefined' && aiAgent.loadProfiles) {
                aiAgent.loadProfiles({ allowSetupModal: options.allowSetupModal === true });
            }
        }
    }

    /* ── init ── */
    function init() {
        cacheElements();
        if (!els.copyBtn) return; // Prompt Lab HTML not present

        // Type selector buttons
        els.typeButtons.forEach(btn => {
            btn.addEventListener('click', () => switchType(btn.getAttribute('data-pl-type')));
        });

        // Copy button
        els.copyBtn.addEventListener('click', copyPrompt);

        // Edit/debug response mode selector
        if (els.editOutputModeButtons) {
            els.editOutputModeButtons.forEach(btn => {
                btn.addEventListener('click', () => updateCodeOutputMode(btn.getAttribute('data-pl-edit-mode')));
            });
        }

        // Protect prefix in textarea
        els.taskInput.addEventListener('input', () => {
            const prefix = TYPE_PREFIX[activeType];
            if (prefix) {
                const val = els.taskInput.value;
                if (!val.startsWith(prefix)) {
                    const pos = els.taskInput.selectionStart;
                    els.taskInput.value = prefix + val.replace(prefix.trimEnd(), '').trimStart();
                    const newPos = Math.max(prefix.length, pos);
                    els.taskInput.setSelectionRange(newPos, newPos);
                }
            }
        });
        els.taskInput.addEventListener('keydown', (e) => {
            const prefix = TYPE_PREFIX[activeType];
            if (!prefix) return;
            const start = els.taskInput.selectionStart;
            const end = els.taskInput.selectionEnd;
            if (e.key === 'Backspace' && start <= prefix.length && start === end) {
                e.preventDefault();
            }
            if (e.key === 'Delete' && start < prefix.length && start === end) {
                e.preventDefault();
            }
            if (start < prefix.length && end > start && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
                e.preventDefault();
                els.taskInput.setSelectionRange(prefix.length, end);
            }
        });
        els.taskInput.addEventListener('click', () => {
            const prefix = TYPE_PREFIX[activeType];
            if (prefix && els.taskInput.selectionStart < prefix.length) {
                els.taskInput.setSelectionRange(prefix.length, prefix.length);
            }
        });
        els.taskInput.addEventListener('focus', () => {
            const prefix = TYPE_PREFIX[activeType];
            if (prefix && els.taskInput.selectionStart < prefix.length) {
                els.taskInput.setSelectionRange(prefix.length, prefix.length);
            }
        });

        // Feature menu items
        document.querySelectorAll('.pl-feature-item[data-incorporate-step]').forEach(btn => {
            btn.addEventListener('click', () => handleFeatureClick(btn.getAttribute('data-incorporate-step')));
        });

        // DevConsole button
        if (els.devConsoleBtn) {
            els.devConsoleBtn.addEventListener('click', handleDevConsoleClick);
        }

        if (els.debugReproEnv) {
            els.debugReproEnv.addEventListener('change', hideFeedback);
        }

        // Right-panel tab switching
        els.rpTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                switchRpTab(tab.getAttribute('data-rp-tab'), {
                    allowSetupModal: tab.getAttribute('data-rp-tab') === 'prometheus'
                });
            });
        });

        // Set initial state
        switchType('new-build');
    }

    // Auto-init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { switchType, switchRpTab, init, gatherCodebaseText };
})();
