/* ===== Forge v2 �" Prometheus: Full Agentic Coding Assistant (v2 Rewrite) ===== */
/* Zero external dependencies. Vanilla JS only. */

const aiAgent = {
    // �"�"�" State �"�"�"
    _profiles: [],
    _profileApiKeys: {},
    _activeProfileId: null,
    _abortController: null,
    _abortRequested: false,
    _busy: false,
    _pendingRedirect: null,    // queued user message to inject at next tool boundary
    _sessionCheckpointed: false,
    _apiFormat: null,          // 'openai' | 'anthropic' | 'google'
    _workingMessages: [],       // Full-fidelity messages for the API (reset per task)
    _workingMemory: null,       // Structured session memory to reduce context drift
    _readFiles: new Set(),      // Track which files the agent has read this session

    _streamingDiv: null,        // Current streaming message element
    _planMode: false,            // Plan mode: describe changes without applying
    _online: null,               // null = unknown, true = online, false = offline
    _onlineCheckInterval: null,  // Periodic online check timer
    _pendingApproval: null,      // Active file-change approval state
    _autoApproveRemaining: false,// If true, auto-accept remaining file approvals in this run
    _autoAcceptToggle: false,    // Persistent toggle � when on, all changes auto-accepted
    _activeToolBatchEl: null,    // Active grouped tool-call bubble for current assistant turn
    _fileContentCache: {},       // path -> latest known text content
    _readFileResultMeta: {},      // path -> last readFile result metadata for repeated-read suppression
    _searchCache: {},            // query key -> { rev, result }
    _projectFileSig: '',         // signature of current file tree
    _cacheRev: 1,                // increments whenever files change
    _contextCompactionSeq: 0,     // increments when tool/file content may have been summarized away
    _smallProjectSnapshotRev: 0, // cache rev for last small-project assessment
    _isSmallProjectSnapshot: false,
    _askSageModelsCache: null,   // { keyHash: string, models: string[] }
    _askSageDebugEnabled: false, // When true, emit CAPRA debug logs into chat (always logs to console)
    _capraTraceEnabled: true,    // When true, capture structured CAPRA run traces in memory
    _capraTraceHistory: [],      // Recent CAPRA traces for export/review
    _activeCapraTrace: null,     // Active CAPRA trace run
    _capraTraceSeq: 0,           // Monotonic event sequence across traces
    _capraTraceStep: 0,          // Current logical AskSage step for trace events
    _capraTraceMaxRuns: 12,
    _capraTraceMaxEventsPerRun: 400,
    _capraDevToolsVisible: false,
    _capraProbeRunning: false,
    _lastCapraProbeResults: null,
    _providerSelectionCert: {},  // transient certification approvals before profile save
    _askSageModelRefreshTimer: null,
    _askSageModelReqSeq: 0,
    _editingKeyProfileId: null,  // profile currently editing/replacing API key
    _nudgeCount: 0,              // Escalating nudge counter for stall recovery
    _totalStallCount: 0,         // Non-resettable stall counter across nudge cycles
    _truncContCount: 0,          // Consecutive truncation continuations without tool calls
    _forceToolChoice: false,     // Force model to call a tool on next API request
    _completionVerified: false,  // One-shot completion verification flag
    _lastDiffDebugPackage: null, // Last replaceInFile unified-diff attempt for debug export
    _diffDebugSeq: 0,            // Monotonic id for diff debug packages

    _runApiCalls: 0,             // Logical model calls in current run
    _runApiAttempts: 0,          // Underlying HTTP attempts in current run
    _lastTokenEstimate: 0,       // Last estimated token count for usage badge
    _runMaxRetries: null,        // Per-run override for retry count
    _runRequestTimeoutMs: null,  // Per-run override for non-Google timeout
    _runGoogleTimeoutMs: null,   // Per-run override for Google timeout
    _lastAutoReadPath: null,     // Last auto-read path after search-only tool turns
    _lastSafetyLimitReason: '',  // Last safety stop reason eligible for one-click resume
    _currentPlan: null,          // Structured task plan from updatePlan tool
    _planUiExpanded: false,      // Expanded state for top plan dropdown
    _pendingPlanGate: null,      // { isPlan: boolean } when waiting on execute/continue
    _allowPlanApproval: false,   // True only when plan mode is on or user explicitly requests a plan gate
    _activeSkillId: null,        // Explicitly selected skill from picker UI
    _profilesLoaded: false,      // True after first loadProfiles() call
    _htmlAppMode: true,          // Default workflow assumes static HTML apps unless disabled
    _prometheusSetupModal: null,
    _prometheusSetupShownThisSession: false,

    // �"�"�" Constants �"�"�"
    MAX_TIME_MS: 300000,        // 5 minutes
    MAX_API_CALLS_PER_RUN: 25,
    MAX_RETRIES: 2,
    REQUEST_TIMEOUT_MS: 300000,
    ASKSAGE_REQUEST_TIMEOUT_MS: 300000,
    GOOGLE_REQUEST_TIMEOUT_MS: 300000,
    AGENT_MAX_OUTPUT_TOKENS: 16384,
    APPROVAL_TIMEOUT_MS: 300000, // 5 minutes
    TOKEN_BUDGET: 100000,
    SMALL_PROJECT_MAX_FILES: 12,
    SMALL_PROJECT_MAX_TOTAL_LINES: 24000,
    SMALL_PROJECT_MAX_FILE_LINES: 3000,
    FEATURE_FLAGS: {
        hidePublicApiProviders: true
    },

    PROVIDERS: {
        anthropic: {
            name: 'Anthropic',
            icon: 'A',
            endpoint: 'https://api.anthropic.com/v1/messages',
            format: 'anthropic',
            compliance: { level: 'public', label: 'Public Info Only' },
            keyPlaceholder: 'sk-ant-...',
            rateLimit: '50 RPM (Tier 1)',
            models: [
                { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', context: 200000, maxOutput: 128000 },
                { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', context: 200000, maxOutput: 64000 },
                { value: 'claude-opus-4-5', label: 'Claude Opus 4.5', context: 200000, maxOutput: 128000 },
                { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', context: 200000, maxOutput: 64000 },
                { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', context: 200000, maxOutput: 64000 }
            ]
        },
        openai: {
            name: 'OpenAI',
            icon: 'O',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            format: 'openai',
            compliance: { level: 'public', label: 'Public Info Only' },
            keyPlaceholder: 'sk-...',
            rateLimit: '500 RPM (Tier 1)',
            models: [
                { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', context: 400000, maxOutput: 128000 },
                { value: 'gpt-5.2', label: 'GPT-5.2', context: 400000, maxOutput: 128000 },
                { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', context: 400000, maxOutput: 128000 },
                { value: 'o3', label: 'o3', context: 200000, maxOutput: 100000, flags: { reasoning: true } },
                { value: 'o3-pro', label: 'o3 Pro', context: 200000, maxOutput: 100000, flags: { reasoning: true } },
                { value: 'o4-mini', label: 'o4-mini', context: 200000, maxOutput: 100000, flags: { reasoning: true } },
                { value: 'gpt-4.1', label: 'GPT-4.1', context: 1047576, maxOutput: 32768 },
                { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', context: 1047576, maxOutput: 32768 },
                { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', context: 1047576, maxOutput: 32768 }
            ]
        },
        google: {
            name: 'Google',
            icon: 'G',
            endpoint: 'https://generativelanguage.googleapis.com',
            format: 'google',
            compliance: { level: 'public', label: 'Public Info Only' },
            keyPlaceholder: 'AIza...',
            rateLimit: '5 RPM (free) / 300 RPM (paid)',
            models: [
                { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)', context: 1048576, maxOutput: 65536 },
                { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Preview)', context: 1048576, maxOutput: 65536 },
                { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)', context: 1048576, maxOutput: 65536 },
                { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', context: 1048576, maxOutput: 65536 },
                { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', context: 1048576, maxOutput: 65536 },
                { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', context: 1048576, maxOutput: 65536 }
            ]
        },
        xai: {
            name: 'xAI',
            icon: 'X',
            endpoint: 'https://api.x.ai/v1/chat/completions',
            format: 'openai',
            compliance: { level: 'public', label: 'Public Info Only' },
            keyPlaceholder: 'xai-...',
            rateLimit: 'Varies by plan',
            models: [
                { value: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Reasoning', context: 2000000, maxOutput: 131072, flags: { reasoning: true } },
                { value: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Non-Reasoning', context: 2000000, maxOutput: 131072 },
                { value: 'grok-code-fast-1', label: 'Grok Code', context: 256000, maxOutput: 131072 },
                { value: 'grok-4', label: 'Grok 4', context: 256000, maxOutput: 131072 },
                { value: 'grok-3', label: 'Grok 3', context: 131072, maxOutput: 131072 }
            ]
        },
        asksage: {
            name: 'Ask Sage (CAPRA - NAVAIR)',
            icon: 'S',
            endpoint: 'https://api.capra.flankspeed.us.navy.mil/server/query',
            serverBaseUrl: 'https://api.capra.flankspeed.us.navy.mil/server',
            userBaseUrl: 'https://api.capra.flankspeed.us.navy.mil/user',
            queryEndpoint: 'https://api.capra.flankspeed.us.navy.mil/server/query',
            format: 'asksage',
            compliance: { level: 'cui', label: 'CUI Compliant' },
            keyPlaceholder: 'Ask Sage API key',
            rateLimit: 'Per Ask Sage tenant policy',
            models: [
                { value: 'gpt-4.1', label: 'gpt-4.1', context: 128000, maxOutput: 8192 }
            ]
        },
        asksagearmy: {
            name: 'Ask Sage (Army)',
            icon: 'S',
            endpoint: 'https://api.genai.army.mil/server/query',
            serverBaseUrl: 'https://api.genai.army.mil/server',
            userBaseUrl: 'https://api.genai.army.mil/user',
            queryEndpoint: 'https://api.genai.army.mil/server/query',
            format: 'asksage',
            compliance: { level: 'cui', label: 'CUI Compliant' },
            keyPlaceholder: 'Ask Sage API key',
            rateLimit: 'Per Ask Sage tenant policy',
            models: [
                { value: 'gpt-4.1', label: 'gpt-4.1', context: 128000, maxOutput: 8192 }
            ]
        },
        asksagesipr: {
            name: 'Ask Sage (Army SIPR)',
            icon: 'S',
            endpoint: 'https://api.genai.army.smil.mil/server/query',
            serverBaseUrl: 'https://api.genai.army.smil.mil/server',
            userBaseUrl: 'https://api.genai.army.smil.mil/user',
            queryEndpoint: 'https://api.genai.army.smil.mil/server/query',
            format: 'asksage',
            compliance: { level: 'cui', label: 'SIPR — CUI Compliant' },
            keyPlaceholder: 'Ask Sage API key',
            rateLimit: 'Per Ask Sage tenant policy',
            models: [
                { value: 'gpt-4.1', label: 'gpt-4.1', context: 128000, maxOutput: 8192 }
            ]
        },
        genaimil: {
            name: 'GenAI.mil',
            icon: 'N',
            endpoint: 'https://api.genai.mil/v1/chat/completions',
            format: 'openai',
            compliance: { level: 'cui', label: 'CUI Compliant' },
            keyPlaceholder: 'STARK_...',
            rateLimit: 'Per GenAI.mil tenant policy',
            models: [
                { value: 'gpt-4.1', label: 'GPT-4.1', context: 128000, maxOutput: 8192 }
            ]
        }
    },

    // ══════════════════════════════════════════════════════════════════
    //  PROFILE MANAGEMENT �" Save/switch between API configurations
    // ══════════════════════════════════════════════════════════════════

    loadProfiles(options) {
        options = options || {};
        const allowSetupModal = options.allowSetupModal === true;

        // If profiles are already loaded in this session, just re-render the UI
        // and optionally show the setup modal. Do NOT reload from storage because
        // legacy storage was already purged on first load — reloading would wipe
        // the in-memory API keys.
        if (this._profilesLoaded) {
            this._renderProfileBar();
            this._populateConfigEditor();
            this._setConfigOpen(this._shouldOpenConfigPanel());
            if (allowSetupModal) {
                this._maybeShowPrometheusSetupModal();
            }
            return;
        }

        const legacy = this._loadLegacyProfilesFromStorage();
        this._profiles = legacy.profiles;
        this._profileApiKeys = legacy.keysByProfileId;
        this._activeProfileId = legacy.activeProfileId || (this._profiles[0]?.id || null);
        this._ensureAllowedActiveProfile();
        this._purgeLegacyProfileStorage();
        this._renderProfileBar();
        this._populateConfigEditor();
        this._setConfigOpen(this._shouldOpenConfigPanel());
        if (legacy.migrated) {
            this._showConfigStatus('Loaded legacy settings for this session only. Export JSON to keep them.', 'dim');
        }

        // Restore plan mode setting
        var savedPlanMode = localStorage.getItem('forge:ai-plan-mode') === '1';
        var planCheckbox = document.getElementById('ai-plan-mode');
        if (planCheckbox) planCheckbox.checked = savedPlanMode;
        this.togglePlanMode(savedPlanMode);

        // Restore "HTML App Mode" toggle
        var htmlAppCheckbox = document.getElementById('ai-html-app-mode');
        if (htmlAppCheckbox) {
            var savedHtmlAppMode = localStorage.getItem('forge:ai-html-app-mode') !== '0';
            htmlAppCheckbox.checked = savedHtmlAppMode;
            this.toggleHtmlAppMode(savedHtmlAppMode);
        }

        // Restore "Show Diff in Chat" toggle
        var chatDiffCheckbox = document.getElementById('ai-show-chat-diff');
        if (chatDiffCheckbox) {
            chatDiffCheckbox.checked = localStorage.getItem('forge:ai-show-chat-diff') !== '0';
            this.toggleChatDiff(chatDiffCheckbox.checked);
        }

        // Restore "Auto Accept" toggle (default to ON when no saved preference)
        var autoAcceptCheckbox = document.getElementById('ai-auto-accept');
        if (autoAcceptCheckbox) {
            var savedAutoAccept = localStorage.getItem('forge:ai-auto-accept');
            var autoAcceptOn = savedAutoAccept === null ? true : savedAutoAccept === '1';
            autoAcceptCheckbox.checked = autoAcceptOn;
            this.toggleAutoAccept(autoAcceptOn);
        }

        var maxStepsInput = document.getElementById('ai-max-steps');
        if (maxStepsInput) {
            var savedMaxSteps = parseInt(localStorage.getItem('forge:ai-max-steps') || '', 10);
            if (Number.isFinite(savedMaxSteps) && savedMaxSteps > 0) {
                maxStepsInput.value = String(savedMaxSteps);
            }
        }

        var maxTimeInput = document.getElementById('ai-max-time');
        if (maxTimeInput) {
            var savedMaxTime = parseInt(localStorage.getItem('forge:ai-max-time') || '', 10);
            if (Number.isFinite(savedMaxTime) && savedMaxTime > 0) {
                maxTimeInput.value = String(savedMaxTime);
            }
        }
        this._applyLimits();

        var capraTraceCheckbox = document.getElementById('ai-capra-trace-enabled');
        var savedCapraTrace = localStorage.getItem('forge:capra-trace-enabled');
        var capraTraceEnabled = savedCapraTrace !== '0';
        if (capraTraceCheckbox) capraTraceCheckbox.checked = capraTraceEnabled;
        this.toggleCapraTrace(capraTraceEnabled);

        var capraDebugCheckbox = document.getElementById('ai-capra-debug-chat');
        var savedCapraDebug = localStorage.getItem('forge:capra-debug-chat') === '1';
        if (capraDebugCheckbox) capraDebugCheckbox.checked = savedCapraDebug;
        this.toggleAskSageDebug(savedCapraDebug);
        this._refreshCapraDevToolsUi();

        // Start online connectivity checks
        this.startOnlineCheck();

        // Restore chat history from previous session
        this._restoreChatHistory();

        // Drop stale interrupted message marker on load.
        this.checkPendingMessage();

        this._profilesLoaded = true;
        if (allowSetupModal) {
            this._maybeShowPrometheusSetupModal();
        }
    },

    _prometheusSetupDismissKey() {
        return 'forge:prometheus-setup-dismissed-v1';
    },

    _hasValidatedPrometheusConfig() {
        return Array.isArray(this._profiles) && this._profiles.some(profile => {
            if (!profile || !this._isProfileAllowed(profile)) return false;
            const providerId = profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint);
            const key = profile.id ? this._profileApiKeys[profile.id] : '';
            return !!(providerId && profile.model && profile.apiKeyValidated && String(key || '').trim());
        });
    },

    _initPrometheusSetupModal() {
        if (this._prometheusSetupModal) return this._prometheusSetupModal;
        const modalEl = document.getElementById('prometheus-setup-modal');
        if (!modalEl || !(window.bootstrap && bootstrap.Modal)) return null;
        this._prometheusSetupModal = bootstrap.Modal.getOrCreateInstance(modalEl, {
            backdrop: true,
            keyboard: true,
            focus: true
        });
        modalEl.addEventListener('hidden.bs.modal', () => {
            this._renderPrometheusSetupModalView('choice');
        });
        return this._prometheusSetupModal;
    },

    _renderPrometheusSetupModalView(view) {
        const mode = view === 'guide' ? 'guide' : 'choice';
        const choiceEl = document.getElementById('prometheus-setup-choice');
        const guideEl = document.getElementById('prometheus-setup-guide');
        if (choiceEl) choiceEl.style.display = mode === 'choice' ? '' : 'none';
        if (guideEl) guideEl.style.display = mode === 'guide' ? '' : 'none';
    },

    showPrometheusSetupModal(view) {
        const modal = this._initPrometheusSetupModal();
        if (!modal) return;
        this._prometheusSetupShownThisSession = true;
        this._renderPrometheusSetupModalView(view);
        const modalEl = document.getElementById('prometheus-setup-modal');
        if (modalEl && modalEl.classList.contains('show')) return;
        modal.show();
    },

    dismissPrometheusSetupModal(persist) {
        if (persist !== false) {
            try { localStorage.setItem(this._prometheusSetupDismissKey(), '1'); } catch (_) { }
        }
        const modal = this._initPrometheusSetupModal();
        if (modal) modal.hide();
    },

    _maybeShowPrometheusSetupModal() {
        if (this._prometheusSetupShownThisSession) return;
        let dismissed = false;
        try {
            dismissed = localStorage.getItem(this._prometheusSetupDismissKey()) === '1';
        } catch (_) { }
        if (dismissed || this._hasValidatedPrometheusConfig()) return;
        this._prometheusSetupShownThisSession = true;
        setTimeout(() => {
            this.showPrometheusSetupModal('choice');
        }, 0);
    },

    async openCapraGuidedSetup() {
        this._setConfigOpen(true, { focus: false });
        const providerEl = document.getElementById('ai-provider-select');
        if (providerEl && this._isProviderAllowed('asksage')) {
            providerEl.value = 'asksage';
            await this.selectProvider(true);
        }
        const activeProfile = this.getActiveProfile();
        if (activeProfile) {
            this._editingKeyProfileId = activeProfile.id;
            this._updateApiKeyUiVisibility();
        }
        const keyEl = document.getElementById('ai-api-key');
        if (keyEl) {
            keyEl.focus();
            if (typeof keyEl.select === 'function') keyEl.select();
        }
        this._showConfigStatus('Paste your Ask Sage key here, choose a model, then click Save Configuration.', 'dim');
        this.dismissPrometheusSetupModal(false);
    },

    _saveProfiles() {
        // Profiles/API keys are intentionally not persisted to browser storage.
    },

    _uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    _createWorkingMemory() {
        return {
            sessionId: 'wm_' + this._uid(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            taskStatus: 'idle',
            currentUserRequest: '',
            attachmentName: '',
            focusFile: '',
            editorActiveFile: '',
            editorOpenFiles: [],
            recentReadFiles: [],
            recentModifiedFiles: [],
            recentCreatedFiles: [],
            recentDeletedFiles: [],
            recentSearches: [],
            recentCheckpoints: [],
            lastToolCall: null,
            lastToolResult: null,
            lastError: '',
            blocker: '',
            currentPlanSummary: ''
        };
    },

    _ensureWorkingMemory() {
        if (!this._workingMemory || typeof this._workingMemory !== 'object') {
            this._workingMemory = this._createWorkingMemory();
        }
        return this._workingMemory;
    },

    _pushRecentUnique(list, value, maxItems) {
        if (!Array.isArray(list)) return [];
        const raw = String(value || '').trim();
        if (!raw) return list;
        const next = list.filter(item => String(item || '').trim() !== raw);
        next.unshift(raw);
        const limit = Math.max(1, Number(maxItems) || 6);
        if (next.length > limit) next.length = limit;
        return next;
    },

    _refreshWorkingMemoryEditorContext() {
        const memory = this._ensureWorkingMemory();
        const openList = (window.athenaCompat && typeof window.athenaCompat.getOpenFilePaths === 'function')
            ? window.athenaCompat.getOpenFilePaths()
            : openFiles.map(f => f.path);
        const active = (window.athenaCompat && typeof window.athenaCompat.getActiveFilePath === 'function')
            ? (window.athenaCompat.getActiveFilePath() || '')
            : (activeFile || '');
        memory.editorOpenFiles = Array.isArray(openList) ? openList.slice(0, 12) : [];
        memory.editorActiveFile = active;
        if (!memory.focusFile && active) memory.focusFile = active;
        if (this._currentPlan && this._currentPlan.length) {
            memory.currentPlanSummary = this._currentPlan
                .map(item => item.status + ':' + item.task)
                .slice(0, 8)
                .join(' | ');
        } else {
            memory.currentPlanSummary = '';
        }
        memory.updatedAt = new Date().toISOString();
        return memory;
    },

    _recordWorkingMemoryUserRequest(userMsg, attachment) {
        const memory = this._refreshWorkingMemoryEditorContext();
        memory.currentUserRequest = String(userMsg || '').trim();
        memory.attachmentName = attachment && attachment.name ? String(attachment.name) : '';
        memory.taskStatus = 'active';
        memory.lastError = '';
        memory.blocker = '';
        memory.updatedAt = new Date().toISOString();
    },

    _recordWorkingMemoryToolCall(name, args) {
        const memory = this._refreshWorkingMemoryEditorContext();
        const safeArgs = (args && typeof args === 'object') ? args : {};
        memory.lastToolCall = {
            name: String(name || ''),
            path: safeArgs.path ? String(safeArgs.path) : '',
            argsSummary: this._formatDebugValue(safeArgs, 600)
        };
        if (safeArgs.path && ['readFile', 'replaceInFile', 'writeFile', 'createFile', 'deleteFile'].includes(name)) {
            memory.focusFile = String(safeArgs.path);
        }
        if (name === 'searchFiles') {
            const patterns = [];
            if (safeArgs.pattern) patterns.push(String(safeArgs.pattern));
            if (safeArgs.patterns) patterns.push(String(safeArgs.patterns));
            if (patterns.length) {
                memory.recentSearches = this._pushRecentUnique(memory.recentSearches, patterns.join(' | '), 6);
            }
        }
        memory.updatedAt = new Date().toISOString();
    },

    _recordWorkingMemoryToolResult(name, args, result) {
        const memory = this._refreshWorkingMemoryEditorContext();
        const contract = this._buildToolResultContract(name, args, result);
        memory.lastToolResult = {
            tool: contract.tool,
            status: contract.status,
            path: contract.path || '',
            summary: contract.summary || ''
        };
        if (contract.path && contract.tool === 'readFile' && contract.status === 'ok') {
            memory.recentReadFiles = this._pushRecentUnique(memory.recentReadFiles, contract.path, 8);
            memory.focusFile = contract.path;
        }
        if (contract.path && contract.mutation) {
            memory.recentModifiedFiles = this._pushRecentUnique(memory.recentModifiedFiles, contract.path, 8);
            memory.focusFile = contract.path;
        }
        if (contract.path && contract.tool === 'createFile' && contract.status === 'ok') {
            memory.recentCreatedFiles = this._pushRecentUnique(memory.recentCreatedFiles, contract.path, 6);
        }
        if (contract.path && contract.tool === 'deleteFile' && contract.status === 'ok') {
            memory.recentDeletedFiles = this._pushRecentUnique(memory.recentDeletedFiles, contract.path, 6);
        }
        if (contract.tool === 'createCheckpoint' && contract.status === 'ok') {
            const checkpointName = contract.data?.checkpointName || contract.summary;
            if (checkpointName) memory.recentCheckpoints = this._pushRecentUnique(memory.recentCheckpoints, checkpointName, 6);
        }
        if (contract.status === 'error') {
            memory.lastError = contract.summary || this._toolResultToDisplayString(result).slice(0, 500);
            memory.blocker = memory.lastError;
        } else if (contract.status === 'rejected') {
            memory.blocker = contract.summary || this._toolResultToDisplayString(result).slice(0, 300);
        } else if (contract.status === 'ok' && contract.mutation) {
            memory.lastError = '';
            memory.blocker = '';
        }
        memory.updatedAt = new Date().toISOString();
        return contract;
    },

    _renderWorkingMemorySystemMessage() {
        const memory = this._refreshWorkingMemoryEditorContext();
        const lines = [
            '<working-memory>',
            'Treat this block as canonical session state. Prefer it over re-inferring state from older chat turns.',
            'Task status: ' + (memory.taskStatus || 'idle'),
            'Current user request: ' + (memory.currentUserRequest || 'none'),
            'Focus file: ' + (memory.focusFile || 'none'),
            'Editor active file: ' + (memory.editorActiveFile || 'none'),
            'Editor open files: ' + (memory.editorOpenFiles.length ? memory.editorOpenFiles.join(', ') : 'none'),
            'Recently read files: ' + (memory.recentReadFiles.length ? memory.recentReadFiles.join(', ') : 'none'),
            'Recently modified files: ' + (memory.recentModifiedFiles.length ? memory.recentModifiedFiles.join(', ') : 'none'),
            'Recently created files: ' + (memory.recentCreatedFiles.length ? memory.recentCreatedFiles.join(', ') : 'none'),
            'Recently deleted files: ' + (memory.recentDeletedFiles.length ? memory.recentDeletedFiles.join(', ') : 'none'),
            'Recent searches: ' + (memory.recentSearches.length ? memory.recentSearches.join(' || ') : 'none'),
            'Recent checkpoints: ' + (memory.recentCheckpoints.length ? memory.recentCheckpoints.join(', ') : 'none'),
            'Last tool call: ' + (memory.lastToolCall ? (memory.lastToolCall.name + (memory.lastToolCall.path ? ' [' + memory.lastToolCall.path + ']' : '')) : 'none'),
            'Last tool result: ' + (memory.lastToolResult ? (memory.lastToolResult.status + ' - ' + (memory.lastToolResult.summary || memory.lastToolResult.tool)) : 'none'),
            'Last error: ' + (memory.lastError || 'none'),
            'Current blocker: ' + (memory.blocker || 'none')
        ];
        if (memory.currentPlanSummary) {
            lines.push('Current plan summary: ' + memory.currentPlanSummary);
        }
        lines.push('</working-memory>');
        return lines.join('\n');
    },

    getActiveProfile() {
        this._ensureAllowedActiveProfile();
        return this._profiles.find(p => p.id === this._activeProfileId) || null;
    },

    getActiveApiKey() {
        if (!this._activeProfileId) return '';
        return this._profileApiKeys[this._activeProfileId] || '';
    },

    switchProfile(profileId) {
        const next = this._profiles.find(p => p.id === profileId) || null;
        if (!next) return;
        if (!this._isProfileAllowed(next)) return;
        this._activeProfileId = profileId;
        this._apiFormat = null;
        this._renderProfileBar();
        this._populateConfigEditor();
        this._setConfigOpen(this._shouldOpenConfigPanel());
    },

    _setApiKeyForProfile(profileId, apiKey) {
        if (!profileId) return;
        const normalized = String(apiKey || '').trim();
        if (!normalized) {
            delete this._profileApiKeys[profileId];
            return;
        }
        this._profileApiKeys[profileId] = normalized;
    },

    _makeUniqueProfileId(rawId, usedIds) {
        const candidate = String(rawId || '').trim();
        if (candidate && !usedIds.has(candidate)) {
            usedIds.add(candidate);
            return candidate;
        }
        let id = this._uid();
        while (usedIds.has(id)) id = this._uid();
        usedIds.add(id);
        return id;
    },

    _normalizeImportedProfiles(rawProfiles) {
        const profiles = [];
        const keysByProfileId = {};
        if (!Array.isArray(rawProfiles)) return { profiles, keysByProfileId };

        const usedIds = new Set();
        for (let i = 0; i < rawProfiles.length; i++) {
            const raw = rawProfiles[i];
            if (!raw || typeof raw !== 'object') continue;

            const providerHint = String(raw.provider || '').trim();
            const providerId = providerHint && this.PROVIDERS[providerHint]
                ? providerHint
                : this._detectProviderIdFromEndpoint(raw.endpoint || '');
            if (!providerId || !this.PROVIDERS[providerId]) continue;

            const providerCfg = this.PROVIDERS[providerId];
            const model = String(raw.model || raw.customModel || '').trim();
            if (!model || !this._isValidModelId(model)) continue;
            const apiKey = String(raw.apiKey || '').trim();
            const keyValidated = !!apiKey && !!raw.apiKeyValidated;
            const keyValidatedAt = keyValidated
                ? (raw.apiKeyValidatedAt ? Number(raw.apiKeyValidatedAt) || Date.now() : Date.now())
                : null;

            const id = this._makeUniqueProfileId(raw.id, usedIds);
            const providerModels = Array.isArray(providerCfg.models) ? providerCfg.models : [];
            const isKnownModel = providerModels.some(m => m && m.value === model);
            const profile = {
                id,
                name: String(raw.name || providerCfg.name || ('Configuration ' + (profiles.length + 1))).trim() || providerCfg.name || ('Configuration ' + (profiles.length + 1)),
                provider: providerId,
                endpoint: providerCfg.endpoint || '',
                serverBaseUrl: providerCfg.serverBaseUrl || '',
                userBaseUrl: providerCfg.userBaseUrl || '',
                queryEndpoint: providerCfg.queryEndpoint || '',
                model,
                customModel: isKnownModel ? '' : model,
                format: providerCfg.format || '',
                complianceLevel: providerCfg.compliance?.level || '',
                publicDataCertified: this._isPublicProvider(providerId) ? !!raw.publicDataCertified : false,
                publicDataCertifiedAt: this._isPublicProvider(providerId)
                    ? (raw.publicDataCertifiedAt ? Number(raw.publicDataCertifiedAt) || Date.now() : null)
                    : null,
                publicDataCertName: this._isPublicProvider(providerId) ? String(raw.publicDataCertName || '').trim() : '',
                apiKeyValidated: keyValidated,
                apiKeyValidatedAt: keyValidatedAt
            };
            profiles.push(profile);

            if (apiKey) {
                keysByProfileId[id] = apiKey.slice(0, 4096);
            }
        }

        return { profiles, keysByProfileId };
    },

    _loadLegacyProfilesFromStorage() {
        let profilesRaw = [];
        let migrated = false;
        let activeProfileId = null;
        const legacySessionKeys = [];

        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (!key || !key.startsWith('forge:ai-key-')) continue;
                legacySessionKeys.push({ key: key, value: sessionStorage.getItem(key) || '' });
            }
            activeProfileId = sessionStorage.getItem('forge:ai-active-profile') || null;
        } catch { }

        try {
            const saved = localStorage.getItem('forge:ai-profiles');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    profilesRaw = parsed.map(p => ({ ...p }));
                    migrated = profilesRaw.length > 0;
                }
            }
        } catch { }

        if (!profilesRaw.length) {
            try {
                const old = localStorage.getItem('forge:ai-agent-config');
                if (old) {
                    const parsed = JSON.parse(old);
                    if (parsed && parsed.endpoint) {
                        const providerId = this._detectProviderIdFromEndpoint(parsed.endpoint);
                        const providerCfg = this.PROVIDERS[providerId];
                        if (providerCfg) {
                            profilesRaw = [{
                                id: this._uid(),
                                name: providerCfg.name || 'Default',
                                provider: providerId,
                                endpoint: parsed.endpoint || '',
                                model: parsed.model || parsed.customModel || '',
                                customModel: parsed.customModel || '',
                                format: providerCfg.format || '',
                                complianceLevel: providerCfg.compliance?.level || ''
                            }];
                            migrated = true;
                        }
                    }
                }
            } catch { }
        }

        for (const p of profilesRaw) {
            const id = String(p?.id || '').trim();
            if (!id) continue;
            try {
                const key = sessionStorage.getItem('forge:ai-key-' + id) || '';
                if (key) p.apiKey = key;
            } catch { }
        }
        if (profilesRaw.length === 1 && !profilesRaw[0].apiKey && legacySessionKeys.length === 1) {
            profilesRaw[0].apiKey = legacySessionKeys[0].value || '';
        }

        const normalized = this._normalizeImportedProfiles(profilesRaw);
        if (activeProfileId && normalized.profiles.some(p => p.id === activeProfileId)) {
            return {
                profiles: normalized.profiles,
                keysByProfileId: normalized.keysByProfileId,
                activeProfileId,
                migrated
            };
        }
        return {
            profiles: normalized.profiles,
            keysByProfileId: normalized.keysByProfileId,
            activeProfileId: normalized.profiles[0]?.id || null,
            migrated
        };
    },

    _purgeLegacyProfileStorage() {
        try { localStorage.removeItem('forge:ai-profiles'); } catch { }
        try { localStorage.removeItem('forge:ai-agent-config'); } catch { }
        try { sessionStorage.removeItem('forge:ai-active-profile'); } catch { }
        try {
            const keys = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && key.startsWith('forge:ai-key-')) keys.push(key);
            }
            for (const key of keys) sessionStorage.removeItem(key);
        } catch { }
    },

    async selectProvider(userInitiated) {
        const providerEl = document.getElementById('ai-provider-select');
        const keyEl = document.getElementById('ai-api-key');
        const selectEl = document.getElementById('ai-model-select');
        if (!providerEl) return;
        this._syncProviderOptions();
        let providerId = providerEl.value;
        if (providerId && !this._isProviderAllowed(providerId)) {
            providerEl.value = '';
            providerId = '';
            if (userInitiated) {
                this._showConfigStatus('Public providers are disabled by configuration.', 'error');
            }
        }
        const providerCfg = this.PROVIDERS[providerId];
        const activeProfile = this.getActiveProfile();
        const selectedModel = (activeProfile && activeProfile.provider === providerId) ? (activeProfile.model || '') : '';
        const transientCert = this._providerSelectionCert[providerId];
        const certified = !!(
            (activeProfile && activeProfile.provider === providerId && activeProfile.publicDataCertified) ||
            transientCert
        );
        let certName = '';
        if (activeProfile && activeProfile.provider === providerId && activeProfile.publicDataCertified) {
            certName = String(activeProfile.publicDataCertName || '').trim();
        } else if (transientCert && transientCert.name) {
            certName = String(transientCert.name || '').trim();
        }
        if (userInitiated && this._isPublicProvider(providerId) && !certified) {
            const cert = await this._confirmPublicProviderCertification(providerId);
            if (!cert) {
                const prev = activeProfile?.provider || '';
                providerEl.value = prev;
                await this.selectProvider(false);
                return;
            }
            this._providerSelectionCert[providerId] = cert;
            certName = cert.name;
        }

        // Update key placeholder
        if (keyEl) keyEl.placeholder = providerCfg ? providerCfg.keyPlaceholder : 'Paste your API key...';
        const isCertifiedNow = !!(certified || this._providerSelectionCert[providerId]);
        this._updateProviderComplianceNote(providerId, isCertifiedNow, certName);
        this._updateProviderSafetyMarker(providerId, isCertifiedNow, certName);

        // Populate model dropdown
        if (selectEl) {
            this._populateProviderModels(selectEl, providerCfg, selectedModel);
            if (!providerCfg) {
                this._setModelFetchStatus('', '');
                return;
            }
            if (this._isAskSageProvider(providerId)) {
                await this._refreshAskSageModelsFromUi(selectedModel);
            } else {
                this._setModelFetchStatus('', '');
            }
        }
        this._syncCustomField();
        this._updateModelInfo();
    },

    _populateProviderModels(selectEl, providerCfg, preferredModel) {
        if (!selectEl) return;
        selectEl.innerHTML = '';
        if (!providerCfg) {
            selectEl.innerHTML = '<option value="" disabled selected>Select a provider first</option>';
            return;
        }
        for (const m of (providerCfg.models || [])) {
            const opt = document.createElement('option');
            opt.value = m.value;
            opt.textContent = m.label;
            selectEl.appendChild(opt);
        }
        const customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = 'Custom model ID...';
        selectEl.appendChild(customOpt);

        if (!preferredModel) return;
        const exists = [...selectEl.options].some(o => o.value === preferredModel);
        if (exists) selectEl.value = preferredModel;
    },

    _isPublicProvider(providerId) {
        return this.PROVIDERS[providerId]?.compliance?.level === 'public';
    },

    _isCuiProvider(providerId) {
        return this.PROVIDERS[providerId]?.compliance?.level === 'cui';
    },

    _isAskSageProvider(providerId) {
        return this.PROVIDERS[providerId]?.format === 'asksage';
    },

    _getAskSageProviderConfig(providerId) {
        if (this._isAskSageProvider(providerId)) return this.PROVIDERS[providerId];
        return this.PROVIDERS.asksage || null;
    },

    _getFeatureFlag(name) {
        const defaults = this.FEATURE_FLAGS || {};
        const runtimeFlags = (typeof window !== 'undefined' && window.Forge_FLAGS && typeof window.Forge_FLAGS === 'object')
            ? window.Forge_FLAGS
            : {};
        if (Object.prototype.hasOwnProperty.call(runtimeFlags, name)) return !!runtimeFlags[name];

        if (name === 'hidePublicApiProviders' && typeof window !== 'undefined') {
            if (window.HIDE_PUBLIC_API_PROVIDERS === true) return true;
            try {
                if (localStorage.getItem('forge:hide-public-api-providers') === '1') return true;
            } catch (_) { }
        }

        return !!defaults[name];
    },

    _hidePublicApiProvidersEnabled() {
        return this._getFeatureFlag('hidePublicApiProviders');
    },

    _isProviderAllowed(providerId) {
        if (!providerId || !this.PROVIDERS[providerId]) return false;
        if (this._hidePublicApiProvidersEnabled() && this._isPublicProvider(providerId)) return false;
        return true;
    },

    _isProfileAllowed(profile) {
        if (!profile) return false;
        const providerId = profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint);
        if (!providerId) return true;
        return this._isProviderAllowed(providerId);
    },

    _ensureAllowedActiveProfile() {
        const active = this._profiles.find(p => p.id === this._activeProfileId) || null;
        if (this._isProfileAllowed(active)) return;
        const fallback = this._profiles.find(p => this._isProfileAllowed(p)) || null;
        this._activeProfileId = fallback ? fallback.id : null;
    },

    _providerOptionLabel(providerId) {
        const cfg = this.PROVIDERS[providerId];
        if (!cfg) return providerId;
        const complianceLabel = String(cfg.compliance?.label || '').trim();
        if (!complianceLabel) return cfg.name;
        return cfg.name + ' - ' + complianceLabel;
    },

    _syncProviderOptions() {
        const providerEl = document.getElementById('ai-provider-select');
        if (!providerEl) return;
        const priorValue = String(providerEl.value || '').trim();
        providerEl.innerHTML = '<option value="">Select...</option>';
        for (const providerId of Object.keys(this.PROVIDERS)) {
            if (!this._isProviderAllowed(providerId)) continue;
            const option = document.createElement('option');
            option.value = providerId;
            option.textContent = this._providerOptionLabel(providerId);
            providerEl.appendChild(option);
        }
        if (priorValue && this._isProviderAllowed(priorValue)) {
            providerEl.value = priorValue;
        }
    },
    _getProjectFilePathsForCertification() {
        const handles = (typeof fileHandles === 'object' && fileHandles) ? fileHandles : {};
        return Object.keys(handles)
            .filter(path => typeof path === 'string' && path.trim().length > 0)
            .sort((a, b) => a.localeCompare(b));
    },

    _updateProviderComplianceNote(providerId, certified, certName) {
        const note = document.getElementById('ai-provider-compliance-note');
        if (!note) return;
        const provider = this.PROVIDERS[providerId];
        if (!provider) {
            note.style.display = 'none';
            note.className = 'ai-provider-note';
            note.textContent = '';
            return;
        }

        if (this._isCuiProvider(providerId)) {
            note.style.display = '';
            note.className = 'ai-provider-note cui';
            note.textContent = 'CUI Compliant provider selected (' + (provider.name || providerId) + ').';
            return;
        }

        if (this._isPublicProvider(providerId)) {
            note.style.display = '';
            note.className = 'ai-provider-note warning';
            const signer = String(certName || '').trim();
            const certText = certified
                ? (' Certification on file' + (signer ? ' (Signed by ' + signer + ').' : '.'))
                : ' Certification required before save.';
            note.textContent = 'PUBLIC INFO ONLY: Do not use official/CUI data with this provider.' + certText;
            return;
        }

        note.style.display = 'none';
        note.className = 'ai-provider-note';
        note.textContent = '';
    },

    _updateProviderSafetyMarker(providerId, certified, certName) {
        const chip = document.getElementById('ai-provider-safety-chip');
        const banner = document.getElementById('ai-provider-safety-banner');
        const active = this.getActiveProfile();
        const effectiveProviderId = providerId || active?.provider || this._detectProviderIdFromEndpoint(active?.endpoint) || '';
        const isPublic = this._isPublicProvider(effectiveProviderId);

        if (!isPublic) {
            if (chip) {
                chip.style.display = 'none';
                chip.textContent = '';
                chip.className = 'ai-provider-safety-chip';
            }
            if (banner) {
                banner.style.display = 'none';
                banner.textContent = '';
                banner.className = 'ai-provider-safety-banner';
            }
            return;
        }

        const signer = String(certName || '').trim() || String(active?.publicDataCertName || '').trim();
        const hasCert = !!(certified || (active && active.publicDataCertified));
        if (chip) {
            chip.style.display = '';
            chip.className = 'ai-provider-safety-chip public';
            chip.textContent = 'PUBLIC DATA ONLY';
            chip.title = 'Public information only. Official/CUI data is prohibited with this provider.';
        }
        if (banner) {
            banner.style.display = '';
            banner.className = 'ai-provider-safety-banner';
            const signerHtml = signer ? '<div class="cert-signer">Signed by ' + escHtml(signer) + '</div>' : '';
            const statusText = hasCert
                ? '<strong>Public Info Only Provider Active.</strong> Official/CUI data is prohibited.'
                : '<strong>Public Info Only Selected.</strong> Certification required before save/use.';
            banner.innerHTML = statusText + signerHtml;
        }
    },

    _showPublicCertificationModal(providerId) {
        const modal = document.getElementById('ai-public-cert-modal');
        const title = document.getElementById('ai-public-cert-title');
        const desc = document.getElementById('ai-public-cert-desc');
        const fileCountEl = document.getElementById('ai-public-cert-file-count');
        const fileListEl = document.getElementById('ai-public-cert-file-list');
        const ackTextEl = document.getElementById('ai-public-cert-ack-text');
        const nameEl = document.getElementById('ai-public-cert-name');
        const ackEl = document.getElementById('ai-public-cert-ack');
        const errEl = document.getElementById('ai-public-cert-error');
        const confirmBtn = document.getElementById('ai-public-cert-confirm-btn');
        const cancelBtn = document.getElementById('ai-public-cert-cancel-btn');
        const closeBtn = document.getElementById('ai-public-cert-close-btn');
        if (!modal || !nameEl || !ackEl || !confirmBtn || !cancelBtn || !closeBtn || !desc || !title) {
            return Promise.resolve(null);
        }

        const providerName = this.PROVIDERS[providerId]?.name || providerId;
        title.textContent = 'Public Info Only Certification';
        desc.textContent = 'You selected "' + providerName + '". This provider is authorized for public information only. Every file in this folder must be public-only before you continue.';
        const files = this._getProjectFilePathsForCertification();
        if (fileCountEl) {
            fileCountEl.textContent = files.length + ' file' + (files.length === 1 ? '' : 's');
        }
        if (ackTextEl) {
            if (files.length > 0) {
                ackTextEl.textContent = 'I reviewed all ' + files.length + ' file(s) listed above and certify none contain official data, CUI, or sensitive operational information.';
            } else {
                ackTextEl.textContent = 'I certify this folder has no official data, no CUI, and no sensitive operational information.';
            }
        }
        if (fileListEl) {
            fileListEl.innerHTML = '';
            if (!files.length) {
                const empty = document.createElement('li');
                empty.className = 'ai-public-cert-file-empty';
                empty.textContent = '(No files detected in the loaded project folder.)';
                fileListEl.appendChild(empty);
            } else {
                for (const path of files) {
                    const li = document.createElement('li');
                    li.textContent = path;
                    fileListEl.appendChild(li);
                }
            }
        }
        nameEl.value = '';
        ackEl.checked = false;
        errEl.style.display = 'none';
        errEl.textContent = '';
        confirmBtn.disabled = true;

        return new Promise((resolve) => {
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                cleanup();
                modal.classList.remove('show');
                resolve(value);
            };
            const updateState = () => {
                const hasName = String(nameEl.value || '').trim().length >= 2;
                errEl.style.display = 'none';
                errEl.textContent = '';
                confirmBtn.disabled = !(hasName && ackEl.checked);
            };
            const onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    finish(null);
                    return;
                }
                if (e.key === 'Enter' && e.target === nameEl && !confirmBtn.disabled) {
                    e.preventDefault();
                    finish({ name: String(nameEl.value || '').trim(), at: Date.now() });
                }
            };
            const onBackdrop = (e) => {
                if (e.target === modal) finish(null);
            };
            const onCancel = () => finish(null);
            const onConfirm = () => {
                const name = String(nameEl.value || '').trim();
                if (name.length < 2 || !ackEl.checked) {
                    errEl.textContent = 'Enter your name and check the certification box to continue.';
                    errEl.style.display = '';
                    return;
                }
                finish({ name: name, at: Date.now() });
            };
            const cleanup = () => {
                document.removeEventListener('keydown', onKeyDown);
                modal.removeEventListener('click', onBackdrop);
                nameEl.removeEventListener('input', updateState);
                ackEl.removeEventListener('change', updateState);
                cancelBtn.removeEventListener('click', onCancel);
                closeBtn.removeEventListener('click', onCancel);
                confirmBtn.removeEventListener('click', onConfirm);
            };

            document.addEventListener('keydown', onKeyDown);
            modal.addEventListener('click', onBackdrop);
            nameEl.addEventListener('input', updateState);
            ackEl.addEventListener('change', updateState);
            cancelBtn.addEventListener('click', onCancel);
            closeBtn.addEventListener('click', onCancel);
            confirmBtn.addEventListener('click', onConfirm);

            modal.classList.add('show');
            setTimeout(() => nameEl.focus(), 0);
        });
    },

    async _confirmPublicProviderCertification(providerId) {
        return await this._showPublicCertificationModal(providerId);
    },

    _setModelFetchStatus(msg, type) {
        const el = document.getElementById('ai-model-fetch-status');
        if (!el) return;
        const text = String(msg || '').trim();
        if (!text) {
            el.style.display = 'none';
            el.textContent = '';
            el.className = 'ai-model-fetch-status';
            return;
        }
        const kind = String(type || '').trim().toLowerCase();
        el.style.display = '';
        el.textContent = text;
        el.className = 'ai-model-fetch-status' + (kind ? (' ' + kind) : '');
    },

    async _refreshAskSageModelsFromUi(preferredModel) {
        const providerId = document.getElementById('ai-provider-select')?.value || '';
        const selectEl = document.getElementById('ai-model-select');
        if (!selectEl) return false;
        if (!this._isAskSageProvider(providerId)) {
            this._setModelFetchStatus('', '');
            return false;
        }
        const providerCfg = this._getAskSageProviderConfig(providerId);
        if (!providerCfg) return false;
        this._populateProviderModels(selectEl, providerCfg, preferredModel || selectEl.value || '');

        const key = (document.getElementById('ai-api-key')?.value || this.getActiveApiKey() || '').trim();
        if (!key) {
            this._setModelFetchStatus('Enter API key to load Ask Sage models.', 'loading');
            return false;
        }
        if (key.length < 8) {
            this._setModelFetchStatus('Enter full API key to load Ask Sage models.', 'loading');
            return false;
        }

        const reqId = ++this._askSageModelReqSeq;
        this._setModelFetchStatus('Fetching models from Ask Sage...', 'loading');
        const ok = await this._refreshAskSageModels(selectEl, key, preferredModel || selectEl.value || '', providerId);
        if (reqId !== this._askSageModelReqSeq) return ok;
        if (ok) {
            this._setModelFetchStatus('Models loaded from Ask Sage.', 'success');
        } else {
            this._setModelFetchStatus('Failed to load models. Check API key and network.', 'error');
        }
        return ok;
    },

    async _refreshAskSageModels(selectEl, apiKey, preferredModel, providerId) {
        const askSageProviderId = this._isAskSageProvider(providerId)
            ? providerId
            : (this.getActiveProfile()?.provider || '');
        const providerCfg = this._getAskSageProviderConfig(askSageProviderId);
        if (!selectEl || !providerCfg) return false;
        const key = String(apiKey || '').trim();
        if (!key) return false;
        const keyHash = String(askSageProviderId || providerCfg.endpoint || 'asksage') + '|k' + key.length + ':' + key.slice(0, 4);
        let models = null;
        if (this._askSageModelsCache && this._askSageModelsCache.keyHash === keyHash && Array.isArray(this._askSageModelsCache.models)) {
            models = this._askSageModelsCache.models;
        } else {
            try {
                models = await this.fetchAskSageModels(key, askSageProviderId);
                this._askSageModelsCache = { keyHash: keyHash, models: models };
            } catch {
                return false;
            }
        }
        if (!Array.isArray(models) || !models.length) return false;

        const mergedModels = [...(providerCfg.models || [])];
        const staticSeen = new Set(mergedModels.map(m => m.value));
        for (const modelName of models) {
            if (staticSeen.has(modelName)) continue;
            mergedModels.push({ value: modelName, label: modelName, context: 128000, maxOutput: 8192 });
            staticSeen.add(modelName);
        }
        this._populateProviderModels(selectEl, { ...providerCfg, models: mergedModels }, preferredModel);
        return true;
    },

    onApiKeyInput() {
        const providerId = document.getElementById('ai-provider-select')?.value || '';
        if (!this._isAskSageProvider(providerId)) {
            this._setModelFetchStatus('', '');
            return;
        }

        if (this._askSageModelRefreshTimer) {
            clearTimeout(this._askSageModelRefreshTimer);
        }
        this._askSageModelRefreshTimer = setTimeout(async () => {
            await this._refreshAskSageModelsFromUi();
        }, 450);
    },

    async saveProfile() {
        const providerEl = document.getElementById('ai-provider-select');
        const keyEl = document.getElementById('ai-api-key');
        const selectEl = document.getElementById('ai-model-select');
        const customEl = document.getElementById('ai-model-custom');
        this._syncProviderOptions();
        const providerId = (providerEl?.value || '').trim();
        const typedApiKey = (keyEl?.value || '').trim();
        const model = selectEl?.value === 'custom'
            ? (customEl?.value || '').trim()
            : (selectEl?.value || '').trim();
        const activeProfileBeforeSave = this.getActiveProfile();
        const loadedApiKey = activeProfileBeforeSave?.id ? (this._profileApiKeys[activeProfileBeforeSave.id] || '') : '';
        const useLoadedValidatedKey = !typedApiKey && !!loadedApiKey && !!activeProfileBeforeSave?.apiKeyValidated;
        const apiKey = typedApiKey || (useLoadedValidatedKey ? loadedApiKey : '');

        if (!providerId || !this.PROVIDERS[providerId]) {
            this._showConfigStatus('Select a provider.', 'error');
            return;
        }
        if (!this._isProviderAllowed(providerId)) {
            this._showConfigStatus('Public providers are disabled by configuration.', 'error');
            return;
        }
        if (!apiKey) {
            this._showConfigStatus('Enter an API key, or use a previously verified loaded key.', 'error');
            return;
        }
        if (!model) {
            this._showConfigStatus('Select a model.', 'error');
            return;
        }
        if (!this._isValidModelId(model)) {
            this._showConfigStatus('Invalid model ID format.', 'error');
            return;
        }
        if (apiKey.length > 4096) {
            this._showConfigStatus('API key is too long.', 'error');
            return;
        }

        const providerCfg = this.PROVIDERS[providerId];
        const name = providerCfg.name;
        const endpoint = providerCfg.endpoint;
        const isPublicProvider = this._isPublicProvider(providerId);
        const transientCert = this._providerSelectionCert[providerId] || null;
        const sameKeyAsLoaded = !!loadedApiKey && apiKey === loadedApiKey;
        const existingKeyStillValidated = sameKeyAsLoaded && !!activeProfileBeforeSave?.apiKeyValidated;
        const sameProviderAsLoaded = (activeProfileBeforeSave?.provider || '') === providerId;
        // If the loaded key is already validated for this provider, do not force re-verification on model-only changes.
        const canReuseValidatedLoadedKey = existingKeyStillValidated && sameProviderAsLoaded;
        const existingKeyValidatedAt = existingKeyStillValidated
            ? (activeProfileBeforeSave?.apiKeyValidatedAt || Date.now())
            : null;

        const alreadyCertified = !!(
            (activeProfileBeforeSave && activeProfileBeforeSave.provider === providerId && activeProfileBeforeSave.publicDataCertified) ||
            transientCert
        );
        if (isPublicProvider && !alreadyCertified) {
            const cert = await this._confirmPublicProviderCertification(providerId);
            if (!cert) {
                this._showConfigStatus('Certification required for public-info-only providers.', 'error');
                this._updateProviderComplianceNote(providerId, false, '');
                this._updateProviderSafetyMarker(providerId, false, '');
                return;
            }
            this._providerSelectionCert[providerId] = cert;
        }
        const certInfo = isPublicProvider
            ? (this._providerSelectionCert[providerId] || {
                name: String(activeProfileBeforeSave?.publicDataCertName || '').trim(),
                at: activeProfileBeforeSave?.publicDataCertifiedAt || Date.now()
            })
            : null;

        // Strict accept/decline: only save config after successful verification.
        // Keep save flow quiet unless there is an actual failure.
        this._showConfigStatus('', 'dim');
        if (!canReuseValidatedLoadedKey) {
            const result = await this._verifyApiKey(providerId, apiKey, model);
            if (!result.ok) {
                const reason = String(result.reason || '').trim();
                const invalidKey =
                    /^invalid api key/i.test(reason) ||
                    /api key not valid/i.test(reason) ||
                    /api_key_invalid/i.test(reason);
                if (invalidKey) {
                    this._showConfigStatus('Key declined: ' + reason, 'error');
                } else {
                    this._showConfigStatus('Verification failed: ' + reason + '. Key not accepted.', 'error');
                }
                this._updateOnlineIndicator(false);
                this._editingKeyProfileId = activeProfileBeforeSave?.id || this._editingKeyProfileId;
                this._updateApiKeyUiVisibility();
                return;
            }
        }

        let profile = activeProfileBeforeSave;
        if (profile) {
            profile.name = name;
            profile.provider = providerId;
            profile.endpoint = endpoint;
            profile.serverBaseUrl = providerCfg.serverBaseUrl || '';
            profile.userBaseUrl = providerCfg.userBaseUrl || '';
            profile.queryEndpoint = providerCfg.queryEndpoint || '';
            profile.model = model;
            profile.customModel = selectEl?.value === 'custom' ? model : '';
            profile.format = providerCfg.format;
            profile.complianceLevel = providerCfg.compliance?.level || '';
            profile.publicDataCertified = isPublicProvider ? true : false;
            profile.publicDataCertifiedAt = isPublicProvider ? (certInfo?.at || profile.publicDataCertifiedAt || Date.now()) : null;
            profile.publicDataCertName = isPublicProvider ? String(certInfo?.name || profile.publicDataCertName || '').trim() : '';
            profile.apiKeyValidated = true;
            profile.apiKeyValidatedAt = canReuseValidatedLoadedKey
                ? (existingKeyValidatedAt || Date.now())
                : Date.now();
        } else {
            profile = {
                id: this._uid(),
                name,
                provider: providerId,
                endpoint,
                serverBaseUrl: providerCfg.serverBaseUrl || '',
                userBaseUrl: providerCfg.userBaseUrl || '',
                queryEndpoint: providerCfg.queryEndpoint || '',
                model,
                customModel: selectEl?.value === 'custom' ? model : '',
                format: providerCfg.format,
                complianceLevel: providerCfg.compliance?.level || '',
                publicDataCertified: isPublicProvider ? true : false,
                publicDataCertifiedAt: isPublicProvider ? (certInfo?.at || Date.now()) : null,
                publicDataCertName: isPublicProvider ? String(certInfo?.name || '').trim() : '',
                apiKeyValidated: true,
                apiKeyValidatedAt: Date.now()
            };
            this._profiles.push(profile);
            this._activeProfileId = profile.id;
        }

        this._setApiKeyForProfile(profile.id, apiKey);
        this._apiFormat = null;
        this._saveProfiles();
        this._renderProfileBar();
        if (this._providerSelectionCert[providerId]) {
            delete this._providerSelectionCert[providerId];
        }
        this._updateProviderComplianceNote(providerId, !!profile.publicDataCertified, profile.publicDataCertName || '');
        this._updateProviderSafetyMarker(providerId, !!profile.publicDataCertified, profile.publicDataCertName || '');
        this._editingKeyProfileId = null;
        this._updateApiKeyUiVisibility();
        this._showConfigStatus('', 'dim');
        this._updateOnlineIndicator(true);
        this._setConfigOpen(false);
    },

    deleteProfile() {
        const profile = this.getActiveProfile();
        if (!profile) return;
        if (!confirm('Delete "' + profile.name + '"?')) return;
        delete this._profileApiKeys[profile.id];
        this._profiles = this._profiles.filter(p => p.id !== profile.id);
        this._activeProfileId = this._profiles[0]?.id || null;
        this._apiFormat = null;
        this._saveProfiles();
        this._renderProfileBar();
        this._populateConfigEditor();
        this._setConfigOpen(this._shouldOpenConfigPanel());
        this._showConfigStatus('Deleted.', 'dim');
    },

    addNewProfile() {
        const profile = {
            id: this._uid(),
            name: 'New Configuration',
            provider: '',
            endpoint: '',
            serverBaseUrl: '',
            userBaseUrl: '',
            queryEndpoint: '',
            model: '',
            customModel: '',
            format: null,
            complianceLevel: '',
            publicDataCertified: false,
            publicDataCertifiedAt: null,
            publicDataCertName: '',
            apiKeyValidated: false,
            apiKeyValidatedAt: null
        };
        this._profiles.push(profile);
        this._activeProfileId = profile.id;
        this._apiFormat = null;
        this._saveProfiles();
        this._renderProfileBar();
        this._populateConfigEditor();
        this._setConfigOpen(true, { focus: true });
        const provEl = document.getElementById('ai-provider-select');
        if (provEl) provEl.focus();
    },

    useLoadedValidatedKey() {
        const profile = this.getActiveProfile();
        const keyEl = document.getElementById('ai-api-key');
        if (!profile || !keyEl) return;

        const loadedKey = this.getActiveApiKey();
        if (!loadedKey) {
            this._showConfigStatus('No API key loaded.', 'error');
            return;
        }
        if (!profile.apiKeyValidated) {
            this._showConfigStatus('Loaded key exists but is not marked as verified yet.', 'error');
            return;
        }

        keyEl.value = loadedKey;
        this._editingKeyProfileId = profile.id;
        this._updateApiKeyUiVisibility();
        this._showConfigStatus('Loaded verified key into API key field.', 'success');
        if (this._isAskSageProvider(profile.provider)) {
            this._refreshAskSageModelsFromUi(profile.model || '');
        }
    },

    editApiKey() {
        const profile = this.getActiveProfile();
        const keyEl = document.getElementById('ai-api-key');
        if (!profile || !keyEl) return;
        this._editingKeyProfileId = profile.id;
        this._updateApiKeyUiVisibility();
        keyEl.value = '';
        keyEl.focus();
        this._showConfigStatus('Enter a replacement key and click Save Configuration.', 'dim');
    },

    _updateApiKeyUiVisibility() {
        const profile = this.getActiveProfile();
        const inputRow = document.getElementById('ai-api-key-row');
        const verifiedRow = document.getElementById('ai-key-verified-row');
        const keyEl = document.getElementById('ai-api-key');
        const hasVerifiedLoadedKey = !!(profile?.apiKeyValidated && this.getActiveApiKey());
        const isEditing = !!(profile?.id && this._editingKeyProfileId === profile.id);
        const showInput = !hasVerifiedLoadedKey || isEditing;

        if (inputRow) inputRow.style.display = showInput ? '' : 'none';
        if (verifiedRow) verifiedRow.style.display = showInput ? 'none' : '';

        if (keyEl && !showInput) {
            keyEl.value = '';
        }
    },

    exportProfilesJson() {
        if (!this._profiles.length) {
            this._showConfigStatus('Nothing to export.', 'error');
            return;
        }

        const payload = {
            schema: 'forge-ai-profiles-v1',
            exportedAt: new Date().toISOString(),
            activeProfileId: this._activeProfileId || null,
            profiles: this._profiles.map(p => ({
                id: p.id,
                name: p.name || '',
                provider: p.provider || '',
                endpoint: p.endpoint || '',
                serverBaseUrl: p.serverBaseUrl || '',
                userBaseUrl: p.userBaseUrl || '',
                queryEndpoint: p.queryEndpoint || '',
                model: p.model || '',
                customModel: p.customModel || '',
                format: p.format || '',
                complianceLevel: p.complianceLevel || '',
                publicDataCertified: !!p.publicDataCertified,
                publicDataCertifiedAt: p.publicDataCertifiedAt || null,
                publicDataCertName: p.publicDataCertName || '',
                apiKeyValidated: !!p.apiKeyValidated,
                apiKeyValidatedAt: p.apiKeyValidatedAt || null,
                apiKey: this._profileApiKeys[p.id] || ''
            }))
        };

        let href = null;
        try {
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            a.href = href;
            a.download = 'athena-settings-' + stamp + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            this._showConfigStatus('Exported settings.', 'success');
        } catch {
            this._showConfigStatus('Failed to export settings.', 'error');
        } finally {
            if (href) URL.revokeObjectURL(href);
        }
    },

    openProfilesImportPicker() {
        const input = document.getElementById('ai-profiles-import-input');
        if (!input) return;
        input.value = '';
        input.click();
    },

    async importProfilesFromFile(inputEl) {
        const file = inputEl && inputEl.files && inputEl.files[0] ? inputEl.files[0] : null;
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const rawProfiles = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.profiles) ? parsed.profiles : null);
            if (!rawProfiles) {
                this._showConfigStatus('Import failed: expected JSON array or { profiles: [] }.', 'error');
                return;
            }

            const normalized = this._normalizeImportedProfiles(rawProfiles);
            if (!normalized.profiles.length) {
                this._showConfigStatus('Import failed: no valid configurations in file.', 'error');
                return;
            }

            if (this._profiles.length && !confirm('Import will replace current API configurations and keys. Continue?')) {
                return;
            }

            this._profiles = normalized.profiles;
            this._profileApiKeys = normalized.keysByProfileId;
            const requestedActive = String(Array.isArray(parsed) ? '' : (parsed?.activeProfileId || '')).trim();
            this._activeProfileId = requestedActive && this._profiles.some(p => p.id === requestedActive)
                ? requestedActive
                : this._profiles[0].id;
            this._apiFormat = null;
            this._renderProfileBar();
            this._populateConfigEditor();
            this._setConfigOpen(this._shouldOpenConfigPanel());
            this._showConfigStatus('Imported ' + this._profiles.length + ' configuration(s).', 'success');
        } catch {
            this._showConfigStatus('Import failed: invalid JSON file.', 'error');
        } finally {
            if (inputEl) inputEl.value = '';
        }
    },

    _showConfigStatus(msg, type) {
        const el = document.getElementById('agent-config-status');
        if (!el) return;
        el.textContent = msg;
        el.style.color = type === 'error' ? 'var(--error)' : type === 'success' ? 'var(--success)' : 'var(--text-dim)';
        if (type !== 'error') setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
    },

    // �"�"�" Profile Bar Rendering �"�"�"

    _renderProfileBar() {
        const bar = document.getElementById('ai-profile-bar');
        if (!bar) return;
        this._ensureAllowedActiveProfile();
        const profile = this.getActiveProfile();
        const hasKey = !!this.getActiveApiKey();

        if (!profile) {
            bar.innerHTML = '<span class="profile-indicator no-profile" onclick="aiAgent.addNewProfile()" title="Add API configuration">+ Add API</span>';
            this._updateProviderSafetyMarker('', false, '');
            return;
        }

        const providerId = profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint);
        const providerIcon = this._getProviderIcon(providerId);
        const modelShort = this._shortenModel(profile.model);
        const hasVerifiedKey = !!(hasKey && profile.apiKeyValidated);
        const statusDot = hasKey ? '' : '<span class="profile-dot disconnected" title="No API key"></span>';
        const verifiedCheck = hasVerifiedKey
            ? '<span class="profile-verified-check" title="API key verified"><svg class="ai-inline-icon" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5l-7 7-3-3"></path></svg></span>'
            : '';

        const providerCfg = this.PROVIDERS[providerId] || null;
        const modelItems = [];
        const seenModels = new Set();
        if (providerCfg && Array.isArray(providerCfg.models)) {
            for (const m of providerCfg.models) {
                const value = String(m?.value || '').trim();
                if (!value || seenModels.has(value)) continue;
                seenModels.add(value);
                modelItems.push({ value: value, label: String(m?.label || value) });
            }
        }
        if (this._isAskSageProvider(providerId) && this._askSageModelsCache && Array.isArray(this._askSageModelsCache.models)) {
            for (const m of this._askSageModelsCache.models) {
                const value = String(m || '').trim();
                if (!value || seenModels.has(value)) continue;
                seenModels.add(value);
                modelItems.push({ value: value, label: value });
            }
        }
        if (profile.model && !seenModels.has(profile.model)) {
            modelItems.push({ value: profile.model, label: 'Custom: ' + profile.model });
        }

        let dropdownHtml = '<div class="profile-dropdown" id="ai-profile-dropdown">';
        if (modelItems.length) {
            dropdownHtml += '<div class="profile-dropdown-header">Switch model</div>';
            for (const item of modelItems) {
                const activeModel = item.value === profile.model ? ' active' : '';
                const safeModel = item.value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
                dropdownHtml += '<div class="profile-dropdown-item model' + activeModel + '" onclick="aiAgent.switchActiveModel(\'' + safeModel + '\')">' +
                    '<span class="profile-dropdown-icon">' + providerIcon + '</span>' +
                    '<span class="profile-dropdown-name">' + escHtml(item.label) + '</span>' +
                    '</div>';
            }
            dropdownHtml += '<div class="profile-dropdown-sep"></div>';
        }
        dropdownHtml +=
            '<div class="profile-dropdown-item action" onclick="aiAgent.openConfigForField(\'model\')">' +
            '<span class="profile-dropdown-icon action"><svg class="ai-inline-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M8 2.2V4M8 12V13.8M2.2 8H4M12 8H13.8M3.8 3.8L5 5M11 11L12.2 12.2M12.2 3.8L11 5M5 11L3.8 12.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg></span>' +
            '<span class="profile-dropdown-name">Open API settings</span>' +
            '</div>';

        const visibleProfiles = this._profiles.filter(p => this._isProfileAllowed(p));
        if (visibleProfiles.length > 1) {
            dropdownHtml += '<div class="profile-dropdown-sep"></div>';
            for (const p of visibleProfiles) {
                const active = p.id === this._activeProfileId ? ' active' : '';
                const prov = p.provider || this._detectProviderIdFromEndpoint(p.endpoint);
                dropdownHtml += '<div class="profile-dropdown-item' + active + '" onclick="aiAgent.switchProfile(\'' + p.id + '\')">' +
                    '<span class="profile-dropdown-icon">' + this._getProviderIcon(prov) + '</span>' +
                    '<span class="profile-dropdown-name">' + escHtml(p.name) + '</span>' +
                    '<span class="profile-dropdown-model">' + escHtml(this._shortenModel(p.model)) + '</span>' +
                    '</div>';
            }
        }
        dropdownHtml += '</div>';

        bar.innerHTML =
            '<div class="profile-active" onclick="aiAgent._toggleProfileDropdown()" title="' + escHtml(profile.name) + '">' +
            statusDot +
            '<span class="profile-provider-icon">' + providerIcon + '</span>' +
            '<span class="profile-model-name">' + escHtml(modelShort) + '</span>' +
            verifiedCheck +
            '<span class="profile-chevron">&#9662;</span>' +
            '</div>' +
            '<button class="profile-gear-btn" onclick="event.stopPropagation();aiAgent._toggleConfig()" title="Edit provider and API key"><svg class="ai-inline-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M8 2.2V4M8 12V13.8M2.2 8H4M12 8H13.8M3.8 3.8L5 5M11 11L12.2 12.2M12.2 3.8L11 5M5 11L3.8 12.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg></button>' +
            '<button class="profile-add-btn" onclick="event.stopPropagation();aiAgent.deleteProfile()" title="Delete">&times;</button>' +
            dropdownHtml;
        this._updateProviderSafetyMarker(providerId, !!profile.publicDataCertified, profile.publicDataCertName || '');
    },

    _toggleProfileDropdown() {
        const dd = document.getElementById('ai-profile-dropdown');
        if (dd) dd.classList.toggle('open');
    },

    openConfigForField(field) {
        const dd = document.getElementById('ai-profile-dropdown');
        if (dd) dd.classList.remove('open');

        this._setConfigOpen(true, { focus: false });

        if (field === 'key') {
            this.editApiKey();
            return;
        }
        if (field === 'provider') {
            const providerEl = document.getElementById('ai-provider-select');
            if (providerEl) providerEl.focus();
            return;
        }
        const modelEl = document.getElementById('ai-model-select');
        if (modelEl) modelEl.focus();
    },

    switchActiveModel(modelId) {
        const dd = document.getElementById('ai-profile-dropdown');
        if (dd) dd.classList.remove('open');

        const profile = this.getActiveProfile();
        if (!profile) return;
        const nextModel = String(modelId || '').trim();
        if (!nextModel) return;
        if (!this._isValidModelId(nextModel)) {
            this._showConfigStatus('Invalid model ID format.', 'error');
            return;
        }
        if (profile.model === nextModel) return;

        const providerId = profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint);
        const providerCfg = this.PROVIDERS[providerId] || null;
        const isKnown = !!(providerCfg && Array.isArray(providerCfg.models) && providerCfg.models.some(m => m && m.value === nextModel));

        profile.model = nextModel;
        profile.customModel = isKnown ? '' : nextModel;
        this._apiFormat = null;
        this._saveProfiles();
        this._renderProfileBar();

        const panel = document.getElementById('ai-config-panel');
        if (panel && panel.classList.contains('open')) {
            this._populateConfigEditor();
        }
        this._showConfigStatus('Model switched to ' + this._shortenModel(nextModel) + '.', 'success');
    },

    _toggleConfig() {
        const panel = document.getElementById('ai-config-panel');
        const isOpen = !!(panel && panel.classList.contains('open'));
        this._setConfigOpen(!isOpen, { focus: !isOpen });
    },

    _setConfigOpen(open, options) {
        const panel = document.getElementById('ai-config-panel');
        const toggleBtn = document.getElementById('athena-config-toggle');
        if (!panel) return;

        const shouldOpen = !!open;
        panel.classList.toggle('open', shouldOpen);
        if (toggleBtn) {
            toggleBtn.classList.toggle('active', shouldOpen);
            toggleBtn.setAttribute('aria-pressed', shouldOpen ? 'true' : 'false');
        }

        if (shouldOpen) {
            this._populateConfigEditor();
            if (options && options.focus) this._focusConfigField();
        }
    },

    _focusConfigField() {
        const providerEl = document.getElementById('ai-provider-select');
        const keyEl = document.getElementById('ai-api-key');
        const modelEl = document.getElementById('ai-model-select');
        if (providerEl && !providerEl.value) {
            providerEl.focus();
            return;
        }
        if (keyEl && !keyEl.value) {
            keyEl.focus();
            return;
        }
        if (modelEl) modelEl.focus();
    },

    _shouldOpenConfigPanel() {
        const profile = this.getActiveProfile();
        if (!profile) return true;
        const providerId = profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint);
        if (!providerId) return true;
        if (!this._isProviderAllowed(providerId)) return true;
        if (!profile.model) return true;
        if (!this.getActiveApiKey()) return true;
        if (!profile.apiKeyValidated) return true;
        return false;
    },

    _populateConfigEditor() {
        const profile = this.getActiveProfile();
        const providerEl = document.getElementById('ai-provider-select');
        const keyEl = document.getElementById('ai-api-key');
        const selectEl = document.getElementById('ai-model-select');
        const customEl = document.getElementById('ai-model-custom');
        this._editingKeyProfileId = null;
        this._syncProviderOptions();

        // Set provider dropdown
        const providerId = profile?.provider || this._detectProviderIdFromEndpoint(profile?.endpoint);
        if (providerEl) providerEl.value = (providerId && this._isProviderAllowed(providerId)) ? providerId : '';

        // Populate models for the provider
        this.selectProvider();

        // Do not prefill verified keys into the input field.
        if (keyEl) keyEl.value = '';

        // Set model
        if (selectEl && profile?.model) {
            const optExists = [...selectEl.options].some(o => o.value === profile.model);
            if (optExists) {
                selectEl.value = profile.model;
            } else if (profile.model) {
                selectEl.value = 'custom';
                if (customEl) { customEl.value = profile.model; customEl.style.display = ''; }
            }
        }
        this._syncCustomField();
        this._updateModelInfo();
        this._updateApiKeyUiVisibility();
        const capraTraceCheckbox = document.getElementById('ai-capra-trace-enabled');
        if (capraTraceCheckbox) capraTraceCheckbox.checked = !!this._capraTraceEnabled;
        const capraDebugCheckbox = document.getElementById('ai-capra-debug-chat');
        if (capraDebugCheckbox) capraDebugCheckbox.checked = !!this._askSageDebugEnabled;
        this._refreshCapraDevToolsUi();
        this._refreshCapraTraceUi();
        this._refreshCapraProbeUi();
    },

    _detectProviderIdFromEndpoint(endpoint) {
        if (!endpoint) return '';
        const ep = endpoint.toLowerCase();
        if (ep.includes('anthropic')) return 'anthropic';
        if (ep.includes('openai.com')) return 'openai';
        if (ep.includes('googleapis.com')) return 'google';
        if (ep.includes('x.ai')) return 'xai';
        if (ep.includes('api.genai.army.smil.mil')) return 'asksagesipr';
        if (ep.includes('api.genai.army.mil')) return 'asksagearmy';
        if (ep.includes('api.capra.flankspeed.us.navy.mil')) return 'asksage';
        if (ep.includes('genai.mil')) return 'genaimil';
        return '';
    },

    _getProviderIcon(providerIdOrName) {
        // Support both provider IDs (new) and display names (legacy)
        const p = String(providerIdOrName || '').toLowerCase();
        if (p === 'anthropic') return 'A';
        if (p === 'openai') return 'O';
        if (p === 'google') return 'G';
        if (p === 'xai') return 'X';
        if (p === 'genaimil' || p === 'genai.mil') return 'N';
        if (p === 'asksage' || p === 'asksagearmy' || p === 'ask sage' || p === 'ask sage (army)' || p === 'capra') return 'S';
        if (p === 'mistral') return 'M';
        if (p === 'deepseek') return 'D';
        if (p === 'meta') return 'L';
        return '?';
    },

    _shortenModel(model) {
        const m = String(model || '');
        // Common shortenings
        const shorts = [
            [/^claude-sonnet-4-6$/i, 'Sonnet 4.6'],
            [/^claude-opus-4-6$/i, 'Opus 4.6'],
            [/^claude-haiku-4-5$/i, 'Haiku 4.5'],
            [/^gpt-5\.2$/i, 'GPT-5.2'],
            [/^gpt-5\.2-codex$/i, 'GPT-5.2 Codex'],
            [/^o3$/i, 'o3'],
            [/^o4-mini$/i, 'o4-mini'],
            [/^gpt-4\.1$/i, 'GPT-4.1'],
            [/^gemini-3\.1-pro/i, 'Gem 3.1 Pro'],
            [/^gemini-3-pro/i, 'Gem 3 Pro'],
            [/^gemini-3-flash/i, 'Gem 3 Flash'],
            [/^gemini-2\.5-pro/i, 'Gem 2.5 Pro'],
            [/^gemini-2\.5-flash/i, 'Gem 2.5 Flash'],
            [/^mistral-large/i, 'Mistral Lg'],
            [/^codestral/i, 'Codestral'],
            [/^devstral/i, 'Devstral'],
            [/^deepseek-chat$/i, 'DS V3'],
            [/^deepseek-reasoner$/i, 'DS Reason'],
            [/^grok-4/i, 'Grok 4'],
            [/^grok-code/i, 'Grok Code'],
            [/llama-4-maverick/i, 'Llama Mav'],
            [/llama-4-scout/i, 'Llama Scout'],
        ];
        for (const [re, short] of shorts) {
            if (re.test(m)) return short;
        }
        return m.length > 16 ? m.slice(0, 14) + '..' : m;
    },

    // ══════════════════════════════════════════════════════════════════
    //  VALIDATION
    // ══════════════════════════════════════════════════════════════════

    _isValidEndpoint(endpoint) {
        if (!endpoint || endpoint.length > 2048) return false;
        try {
            const url = new URL(endpoint);
            return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname;
        } catch {
            return false;
        }
    },

    _isValidModelId(model) {
        return /^[A-Za-z0-9._:/@-]{1,128}$/.test(String(model || '').trim());
    },

    _normalizeToolPath(pathValue) {
        if (typeof pathValue !== 'string') return null;
        let path = pathValue.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
        if (!path) return null;
        if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
        if (/(^|\/)\.\.(\/|$)/.test(path)) return null;
        if (/[\x00-\x1F<>:"|?*]/.test(path)) return null;
        return path;
    },

    _computeProjectFileSig() {
        return Object.keys(fileHandles || {}).sort().join('|');
    },

    _refreshProjectCacheState() {
        const nextSig = this._computeProjectFileSig();
        if (nextSig === this._projectFileSig) return;
        this._projectFileSig = nextSig;
        this._cacheRev++;
        this._fileContentCache = {};
        this._readFileResultMeta = {};
        this._searchCache = {};
        this._smallProjectSnapshotRev = 0;
        this._isSmallProjectSnapshot = false;
        this._readFiles = new Set([...this._readFiles].filter(path => !!fileHandles[path]));
    },

    _clearDiscoveryCache(clearReadTracking) {
        this._fileContentCache = {};
        this._readFileResultMeta = {};
        this._searchCache = {};
        this._smallProjectSnapshotRev = 0;
        this._isSmallProjectSnapshot = false;
        if (clearReadTracking) this._readFiles.clear();
    },

    async _readFileWithCache(path) {
        if (Object.prototype.hasOwnProperty.call(this._fileContentCache, path)) {
            return this._fileContentCache[path];
        }
        const content = await readFileContent(path);
        this._fileContentCache[path] = content;
        return content;
    },

    async _readFileFromHandle(path) {
        const handle = fileHandles[path];
        if (!handle) throw new Error('No handle for ' + path);
        const file = await handle.getFile();
        return await file.text();
    },

    _setCachedFile(path, content) {
        this._fileContentCache[path] = String(content ?? '');
    },

    _markProjectMutated(changedPath) {
        this._cacheRev++;
        this._searchCache = {};
        this._smallProjectSnapshotRev = 0;
        this._isSmallProjectSnapshot = false;
        if (changedPath) {
            delete this._fileContentCache[changedPath];
            delete this._readFileResultMeta[changedPath];
            this._readFiles.delete(changedPath);
        }
        this._projectFileSig = this._computeProjectFileSig();
    },

    _isTextCodeLikePath(path) {
        const lower = String(path || '').toLowerCase();
        const exts = [
            '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.htm', '.css',
            '.json', '.md', '.txt', '.py', '.java', '.go', '.rs', '.sh', '.yml', '.yaml'
        ];
        return exts.some(ext => lower.endsWith(ext));
    },

    async _ensureSmallProjectSnapshot() {
        if (this._smallProjectSnapshotRev === this._cacheRev) return this._isSmallProjectSnapshot;

        this._smallProjectSnapshotRev = this._cacheRev;
        this._isSmallProjectSnapshot = false;

        const paths = Object.keys(fileHandles || {});
        if (!paths.length || paths.length > this.SMALL_PROJECT_MAX_FILES) return false;
        if (!paths.every(path => this._isTextCodeLikePath(path))) return false;

        let totalLines = 0;
        for (const path of paths) {
            const content = await this._readFileWithCache(path);
            const lines = String(content).split('\n').length;
            totalLines += lines;
            if (lines > this.SMALL_PROJECT_MAX_FILE_LINES || totalLines > this.SMALL_PROJECT_MAX_TOTAL_LINES) {
                return false;
            }
        }

        this._isSmallProjectSnapshot = true;
        return true;
    },

    _parseSearchPatterns(args) {
        const patterns = [];
        const addFromString = (raw) => {
            const text = String(raw || '').trim();
            if (!text) return;
            if (text.startsWith('[') && text.endsWith(']')) {
                try {
                    const arr = JSON.parse(text);
                    if (Array.isArray(arr)) {
                        for (const item of arr) {
                            const s = String(item || '').trim();
                            if (s) patterns.push(s);
                        }
                        return;
                    }
                } catch (_) { }
            }
            text.split(/\r?\n/).forEach(part => {
                const s = part.trim();
                if (s) patterns.push(s);
            });
        };

        if (Array.isArray(args?.pattern)) {
            for (const item of args.pattern) addFromString(item);
        } else {
            addFromString(args?.pattern);
        }
        if (Array.isArray(args?.patterns)) {
            for (const item of args.patterns) addFromString(item);
        } else {
            addFromString(args?.patterns);
        }

        const deduped = [];
        const seen = new Set();
        for (const p of patterns) {
            if (seen.has(p)) continue;
            seen.add(p);
            deduped.push(p);
        }
        return deduped;
    },

    _detectProvider(endpoint) {
        const ep = (endpoint || '').toLowerCase();
        if (ep.includes('anthropic')) return 'Anthropic';
        if (ep.includes('generativelanguage.googleapis.com') || ep.includes('aiplatform.googleapis.com')) return 'Google';
        if (ep.includes('openai.com')) return 'OpenAI';
        if (ep.includes('mistral')) return 'Mistral';
        if (ep.includes('deepseek')) return 'DeepSeek';
        if (ep.includes('x.ai') || ep.includes('/xai')) return 'xAI';
        if (ep.includes('api.capra.flankspeed.us.navy.mil') || ep.includes('api.genai.army.mil') || ep.includes('api.genai.army.smil.mil')) return 'Ask Sage';
        if (ep.includes('llama') || ep.includes('meta')) return 'Meta';
        return null;
    },

    _getAskSageSettings(apiKeyOverride, options) {
        const opts = options || {};
        const profile = opts.profile || this.getActiveProfile() || {};
        const providerId = opts.providerId || profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint);
        const providerCfg = this._getAskSageProviderConfig(providerId) || {};
        return {
            apiKey: String(opts.apiKey || apiKeyOverride || this.getActiveApiKey() || '').trim(),
            serverBaseUrl: String(opts.serverBaseUrl || profile.serverBaseUrl || providerCfg.serverBaseUrl || 'https://api.capra.flankspeed.us.navy.mil/server').trim(),
            userBaseUrl: String(opts.userBaseUrl || profile.userBaseUrl || providerCfg.userBaseUrl || 'https://api.capra.flankspeed.us.navy.mil/user').trim(),
            queryEndpoint: String(opts.queryEndpoint || profile.queryEndpoint || providerCfg.queryEndpoint || 'https://api.capra.flankspeed.us.navy.mil/server/query').trim(),
            model: String(opts.model || this.getEffectiveModel() || 'gpt-4.1').trim() || 'gpt-4.1'
        };
    },

    getAskSageApiKey(apiKeyOverride, options) {
        const cfg = this._getAskSageSettings(apiKeyOverride, options);
        const key = String(cfg.apiKey || '').trim();
        if (!key) throw new Error('Missing API key');
        return key;
    },

    resolveAskSageBaseUrl(base) {
        const rawBase = (base === 'user') ? 'user' : 'server';
        const cfg = this._getAskSageSettings();
        const raw = rawBase === 'user' ? cfg.userBaseUrl : cfg.serverBaseUrl;
        return String(raw || '').trim().replace(/\/+$/, '');
    },

    _resolveAskSageBaseUrl(base, settings) {
        const cfg = settings || this._getAskSageSettings();
        const rawBase = (base === 'user') ? 'user' : 'server';
        const raw = rawBase === 'user' ? cfg.userBaseUrl : cfg.serverBaseUrl;
        return String(raw || '').trim().replace(/\/+$/, '');
    },

    async callSageApi(req, apiKeyOverride) {
        const args = req || {};
        const cfg = args.settings || this._getAskSageSettings(apiKeyOverride, { providerId: args.providerId });
        const apiKey = String(cfg.apiKey || apiKeyOverride || this.getActiveApiKey() || '').trim();
        if (!apiKey) throw new Error('Missing API key');

        const path = String(args.path || '');
        const absolute = /^https?:\/\//i.test(path);
        const baseUrl = absolute ? '' : this._resolveAskSageBaseUrl(args.base || 'server', cfg);
        const url = absolute ? path : (baseUrl + (path.startsWith('/') ? path : '/' + path));
        const method = String(args.method || 'POST').toUpperCase();
        const body = (args.body === undefined) ? null : args.body;
        const extraHeaders = args.headers || {};
        const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
        this._askSageDebugLog('callSageApi request', {
            url: url,
            method: method,
            base: args.base || 'server',
            hasBody: body != null,
            isFormData: isFormData,
            body: body,
            extraHeaderKeys: Object.keys(extraHeaders || {})
        });

        let response;
        try {
            response = await fetch(url, {
                method,
                headers: {
                    Authorization: 'Bearer ' + apiKey,
                    'x-access-tokens': apiKey,
                    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
                    ...extraHeaders
                },
                body: body == null ? undefined : (isFormData ? body : JSON.stringify(body))
            });
        } catch (err) {
            const reason = err && err.message ? err.message : 'Unknown network error';
            throw new Error('Network failure contacting Ask Sage API: ' + reason);
        }
        const raw = await response.text();
        let data = null;
        let parseError = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (err) { parseError = err ? (err.message || String(err)) : 'Unknown JSON parse error'; }
        this._askSageDebugLog('callSageApi response', {
            url: url,
            status: response.status,
            ok: response.ok,
            rawLength: String(raw || '').length,
            rawText: raw,
            parsedType: (data == null) ? 'null' : (Array.isArray(data) ? 'array' : typeof data),
            parsedKeys: (data && typeof data === 'object' && !Array.isArray(data)) ? Object.keys(data) : [],
            parseError: parseError
        }, (!response.ok || parseError) ? 'warn' : 'log');

        if (!response.ok) {
            const message = (data && (data.error || data.message || data.response)) || raw || ('Ask Sage request failed (' + response.status + ')');
            throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
        }
        return data ?? raw;
    },

    _formatDebugValue(value, maxChars) {
        const limit = Number(maxChars) > 0 ? Number(maxChars) : 2000;
        let text = '';
        try {
            if (typeof value === 'string') text = value;
            else text = JSON.stringify(value, null, 2);
        } catch (_) {
            text = String(value);
        }
        if (text.length <= limit) return text;
        return text.slice(0, limit) + '\n... (truncated, ' + text.length + ' chars total)';
    },

    _buildDebugLogEnvelope(label, details, level) {
        return {
            ts: new Date().toISOString(),
            label: String(label || ''),
            level: String(level || 'log').toLowerCase(),
            capraRunId: this._activeCapraTrace?.runId || null,
            capraStep: this._capraTraceStep || null,
            apiCall: this._runApiCalls || 0,
            details: details == null ? null : details
        };
    },

    /**
     * Log debug information to the browser console for all providers.
     * When _askSageDebugEnabled is true, also mirrors to chat for AskSage.
     */
    _debugLog(label, details, level) {
        const lvl = String(level || 'log').toLowerCase();
        const fn = (typeof console !== 'undefined')
            ? ((lvl === 'warn' && console.warn) ? console.warn : ((lvl === 'error' && console.error) ? console.error : console.log))
            : null;
        if (fn) {
            try {
                const envelope = this._buildDebugLogEnvelope(label, details, lvl);
                fn.call(console, '[Prometheus DEBUG]', this._formatDebugValue(envelope, 1000000));
            } catch (_) { /* noop */ }
        }
    },

    _askSageDebugLog(label, details, level) {
        // Always log to console via shared logger
        this._debugLog('[CAPRA] ' + label, details, level);
        this._traceCapraEvent(label, details, level);
        // Only show in chat when explicitly enabled (dev mode)
        if (!this._askSageDebugEnabled) return;
        const payload = this._formatDebugValue(details, 2600);
        const prefix = '[CAPRA DEBUG] ' + label;
        addAIChatMessage('system', prefix + (payload ? '\n' + payload : ''));
    },

    _summarizeTraceContent(content, maxPreview) {
        const limit = Number(maxPreview) > 0 ? Number(maxPreview) : 160;
        if (typeof content === 'string') {
            return {
                kind: 'string',
                length: content.length,
                preview: content.slice(0, limit)
            };
        }
        if (Array.isArray(content)) {
            return {
                kind: 'array',
                length: content.length,
                itemKinds: content.slice(0, 8).map(item => {
                    if (typeof item === 'string') return 'string';
                    if (item && typeof item === 'object') return item.type || 'object';
                    return typeof item;
                }),
                preview: this._formatDebugValue(content.slice(0, 3), limit)
            };
        }
        if (content && typeof content === 'object') {
            return {
                kind: 'object',
                keys: Object.keys(content).slice(0, 12),
                preview: this._formatDebugValue(content, limit)
            };
        }
        return {
            kind: typeof content,
            preview: String(content)
        };
    },

    _summarizeTraceMessage(message, index) {
        const msg = message || {};
        const summary = {
            index: index,
            role: msg.role || 'unknown',
            content: this._summarizeTraceContent(msg.content, 180)
        };
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
            summary.toolCalls = msg.tool_calls.map(tc => ({
                name: tc?.function?.name || tc?.name || 'unknown',
                id: tc?.id || ''
            }));
        } else if (Array.isArray(msg.content)) {
            const toolBlocks = msg.content.filter(block => block && (block.type === 'tool_use' || block.type === 'tool_result'));
            if (toolBlocks.length) {
                summary.toolBlocks = toolBlocks.slice(0, 8).map(block => ({
                    type: block.type,
                    name: block.name || block._toolName || '',
                    id: block.id || block.tool_use_id || ''
                }));
            }
        } else if (msg.role === 'tool') {
            summary.toolName = msg._toolName || '';
            summary.toolCallId = msg.tool_call_id || '';
        }
        return summary;
    },

    _summarizeTraceMessages(messages) {
        const list = Array.isArray(messages) ? messages : [];
        const roles = {};
        let toolCallCount = 0;
        for (const msg of list) {
            const role = String(msg?.role || 'unknown');
            roles[role] = (roles[role] || 0) + 1;
            if (Array.isArray(msg?.tool_calls)) toolCallCount += msg.tool_calls.length;
            if (Array.isArray(msg?.content)) {
                toolCallCount += msg.content.filter(block => block && block.type === 'tool_use').length;
            }
        }
        const first = list.slice(0, 3).map((msg, idx) => this._summarizeTraceMessage(msg, idx));
        const tailStart = Math.max(0, list.length - 4);
        const last = list.slice(tailStart).map((msg, idx) => this._summarizeTraceMessage(msg, tailStart + idx));
        return {
            messageCount: list.length,
            estimatedTokens: this._estimateTokens(list),
            roles: roles,
            toolCallCount: toolCallCount,
            firstMessages: first,
            lastMessages: last
        };
    },

    _syncCapraTraceGlobal() {
        if (typeof window === 'undefined') return;
        window.__prometheusCapraTrace = {
            enabled: !!this._capraTraceEnabled,
            chatMirror: !!this._askSageDebugEnabled,
            active: this._activeCapraTrace,
            history: this._capraTraceHistory
        };
    },

    _refreshCapraDevToolsUi() {
        const root = document.getElementById('ai-capra-devtools');
        if (!root) return;
        root.style.display = this._capraDevToolsVisible ? '' : 'none';
    },

    setCapraDevToolsVisible(visible) {
        this._capraDevToolsVisible = visible !== false;
        this._refreshCapraDevToolsUi();
        if (this._capraDevToolsVisible) {
            this._setConfigOpen(true);
        }
        return this._capraDevToolsVisible;
    },

    _refreshCapraTraceUi() {
        this._syncCapraTraceGlobal();
        const exportBtn = document.getElementById('ai-capra-trace-export');
        if (exportBtn) exportBtn.disabled = !this._getLatestCapraTrace();
        const clearBtn = document.getElementById('ai-capra-trace-clear');
        if (clearBtn) clearBtn.disabled = !this._capraTraceHistory.length;
        const statusEl = document.getElementById('ai-capra-trace-status');
        if (!statusEl) return;
        const latest = this._getLatestCapraTrace();
        if (!this._capraTraceEnabled) {
            statusEl.textContent = 'Trace capture disabled.';
            return;
        }
        if (this._activeCapraTrace) {
            statusEl.textContent = 'Trace active: ' + this._activeCapraTrace.runId + ' (' + this._activeCapraTrace.events.length + ' events)';
            return;
        }
        if (latest) {
            statusEl.textContent = 'Latest trace: ' + latest.runId + ' (' + latest.events.length + ' events)';
            return;
        }
        statusEl.textContent = 'No Ask Sage traces captured yet.';
    },

    _getLatestCapraTrace() {
        if (this._activeCapraTrace) return this._activeCapraTrace;
        return this._capraTraceHistory.length ? this._capraTraceHistory[0] : null;
    },

    toggleCapraTrace(enabled) {
        this._capraTraceEnabled = enabled !== false;
        localStorage.setItem('forge:capra-trace-enabled', this._capraTraceEnabled ? '1' : '0');
        this._refreshCapraTraceUi();
    },

    toggleAskSageDebug(enabled) {
        this._askSageDebugEnabled = !!enabled;
        localStorage.setItem('forge:capra-debug-chat', this._askSageDebugEnabled ? '1' : '0');
        this._refreshCapraTraceUi();
    },

    _beginCapraTraceRun(meta) {
        if (!this._capraTraceEnabled) return null;
        const trace = {
            runId: 'capra_' + Date.now() + '_' + this._uid(),
            startedAt: new Date().toISOString(),
            finishedAt: null,
            status: 'running',
            meta: meta || {},
            events: []
        };
        this._activeCapraTrace = trace;
        this._capraTraceStep = 0;
        this._capraTraceHistory.unshift(trace);
        if (this._capraTraceHistory.length > this._capraTraceMaxRuns) {
            this._capraTraceHistory.length = this._capraTraceMaxRuns;
        }
        this._refreshCapraTraceUi();
        this._traceCapraEvent('Trace run started', trace.meta, 'log');
        return trace;
    },

    _finishCapraTraceRun(status, extra) {
        const trace = this._activeCapraTrace;
        if (!trace) return;
        trace.finishedAt = new Date().toISOString();
        trace.status = String(status || 'completed');
        if (extra && typeof extra === 'object') trace.result = extra;
        this._traceCapraEvent('Trace run finished', {
            status: trace.status,
            result: trace.result || null
        }, trace.status === 'error' ? 'error' : (trace.status === 'aborted' ? 'warn' : 'log'));
        this._activeCapraTrace = null;
        this._capraTraceStep = 0;
        this._refreshCapraTraceUi();
    },

    _traceCapraEvent(label, details, level) {
        const trace = this._activeCapraTrace;
        if (!trace) return;
        const entry = {
            seq: ++this._capraTraceSeq,
            at: new Date().toISOString(),
            level: String(level || 'log'),
            step: this._capraTraceStep || null,
            apiCall: this._runApiCalls || 0,
            label: String(label || ''),
            details: details == null ? null : details
        };
        trace.events.push(entry);
        if (trace.events.length > this._capraTraceMaxEventsPerRun) {
            trace.events.splice(0, trace.events.length - this._capraTraceMaxEventsPerRun);
        }
        this._debugLog('[CAPRA TRACE] ' + entry.label, {
            runId: trace.runId,
            step: entry.step,
            apiCall: entry.apiCall,
            details: entry.details
        }, entry.level);
        this._refreshCapraTraceUi();
    },

    exportCapraTraceJson() {
        const trace = this._getLatestCapraTrace();
        if (!trace) {
            this._showConfigStatus('No CAPRA trace available to export.', 'error');
            return;
        }
        let href = null;
        try {
            const payload = JSON.stringify(trace, null, 2);
            const blob = new Blob([payload], { type: 'application/json' });
            href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            a.download = trace.runId + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            this._showConfigStatus('Exported CAPRA trace ' + trace.runId + '.', 'success');
        } catch (_) {
            this._showConfigStatus('Failed to export CAPRA trace.', 'error');
        } finally {
            if (href) URL.revokeObjectURL(href);
        }
    },

    clearCapraTraceHistory() {
        this._capraTraceHistory = [];
        this._activeCapraTrace = null;
        this._capraTraceStep = 0;
        this._refreshCapraTraceUi();
        this._showConfigStatus('Cleared CAPRA trace history.', 'success');
    },

    _getCapraProbeToolDefs() {
        const wanted = new Set(['getProjectInfo', 'readFile']);
        return this._toolDefs().filter(def => wanted.has(def.name));
    },

    _getCapraProbeToolsPayload(style) {
        const defs = this._getCapraProbeToolDefs();
        const openAiTools = defs.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: { type: 'object', properties: t.params, required: t.required }
            }
        }));
        if (style === 'openai-tools') {
            return { tools: openAiTools };
        }
        if (style === 'flat-tools') {
            return {
                tools: defs.map(t => ({
                    name: t.name,
                    description: t.description,
                    parameters: { type: 'object', properties: t.params, required: t.required }
                }))
            };
        }
        if (style === 'legacy-functions') {
            return {
                functions: defs.map(t => ({
                    name: t.name,
                    description: t.description,
                    parameters: { type: 'object', properties: t.params, required: t.required }
                })),
                function_call: 'auto'
            };
        }
        if (style === 'anthropic-tools') {
            return {
                tools: defs.map(t => ({
                    name: t.name,
                    description: t.description,
                    input_schema: { type: 'object', properties: t.params, required: t.required }
                }))
            };
        }
        if (style === 'google-tools') {
            return {
                tools: [{
                    functionDeclarations: defs.map(t => ({
                        name: t.name,
                        description: t.description,
                        parameters: {
                            type: 'OBJECT',
                            properties: Object.fromEntries(
                                Object.entries(t.params).map(([k, v]) => [k, { type: String(v.type || 'string').toUpperCase(), description: v.description }])
                            ),
                            required: t.required
                        }
                    }))
                }],
                tool_config: { function_calling_config: { mode: 'AUTO' } }
            };
        }
        return {};
    },

    _buildCapraProbeVariants(model) {
        const prompt = 'Use the getProjectInfo tool immediately. Return only a tool call for getProjectInfo. Do not explain.';
        const systemText = 'You are a tool-calling protocol probe. When the user asks for a tool, call the tool immediately and return no prose.';
        const userOnlyMessages = [{ role: 'user', content: prompt }];
        const withSystemMessages = [{ role: 'system', content: systemText }, { role: 'user', content: prompt }];
        const base = { model: model, response_mode: 'sync', stream: false };
        const variants = [
            {
                id: 'current-full',
                label: 'Current native shape',
                category: 'openai-tools',
                payload: {
                    ...base,
                    message: prompt,
                    prompt: prompt,
                    query: prompt,
                    question: prompt,
                    input_text: prompt,
                    messages: userOnlyMessages,
                    message_history: userOnlyMessages,
                    persona: systemText,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'messages-only',
                label: 'Messages only + OpenAI tools',
                category: 'openai-tools',
                payload: {
                    ...base,
                    messages: userOnlyMessages,
                    persona: systemText,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'messages-system',
                label: 'System+user messages + OpenAI tools',
                category: 'openai-tools',
                payload: {
                    ...base,
                    messages: withSystemMessages,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'message-only',
                label: 'Single message field + OpenAI tools',
                category: 'openai-tools',
                payload: {
                    ...base,
                    message: prompt,
                    persona: systemText,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'message-openai-minimal',
                label: 'Single message + OpenAI tools minimal',
                category: 'openai-tools',
                payload: {
                    ...base,
                    message: prompt,
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'message-openai-no-choice',
                label: 'Single message + OpenAI tools no tool_choice',
                category: 'openai-tools',
                payload: {
                    ...base,
                    message: prompt,
                    persona: systemText,
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'message-openai-no-persona',
                label: 'Single message + OpenAI tools no persona',
                category: 'openai-tools',
                payload: {
                    ...base,
                    message: prompt,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'query-only',
                label: 'Query field + OpenAI tools',
                category: 'openai-tools',
                payload: {
                    ...base,
                    query: prompt,
                    persona: systemText,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'input-text-only',
                label: 'input_text + OpenAI tools',
                category: 'openai-tools',
                payload: {
                    ...base,
                    input_text: prompt,
                    persona: systemText,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'required-choice',
                label: 'Messages + OpenAI tools + required',
                category: 'openai-tools',
                payload: {
                    ...base,
                    messages: userOnlyMessages,
                    persona: systemText,
                    tool_choice: 'required',
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'specific-choice',
                label: 'Messages + OpenAI tools + specific choice',
                category: 'openai-tools',
                payload: {
                    ...base,
                    messages: userOnlyMessages,
                    persona: systemText,
                    tool_choice: { type: 'function', function: { name: 'getProjectInfo' } },
                    ...this._getCapraProbeToolsPayload('openai-tools')
                }
            },
            {
                id: 'flat-tools',
                label: 'Messages + flat tools array',
                category: 'flat-tools',
                payload: {
                    ...base,
                    messages: userOnlyMessages,
                    persona: systemText,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('flat-tools')
                }
            },
            {
                id: 'message-flat-tools',
                label: 'Single message + flat tools array',
                category: 'flat-tools',
                payload: {
                    ...base,
                    message: prompt,
                    persona: systemText,
                    tool_choice: 'auto',
                    ...this._getCapraProbeToolsPayload('flat-tools')
                }
            },
            {
                id: 'legacy-functions',
                label: 'Messages + legacy functions',
                category: 'legacy-functions',
                payload: {
                    ...base,
                    messages: userOnlyMessages,
                    persona: systemText,
                    ...this._getCapraProbeToolsPayload('legacy-functions')
                }
            },
            {
                id: 'message-legacy-functions',
                label: 'Single message + legacy functions',
                category: 'legacy-functions',
                payload: {
                    ...base,
                    message: prompt,
                    persona: systemText,
                    ...this._getCapraProbeToolsPayload('legacy-functions')
                }
            },
            {
                id: 'anthropic-tools',
                label: 'Messages + Anthropic tool schema',
                category: 'anthropic-tools',
                payload: {
                    ...base,
                    messages: userOnlyMessages,
                    persona: systemText,
                    ...this._getCapraProbeToolsPayload('anthropic-tools')
                }
            },
            {
                id: 'message-anthropic-tools',
                label: 'Single message + Anthropic tool schema',
                category: 'anthropic-tools',
                payload: {
                    ...base,
                    message: prompt,
                    persona: systemText,
                    ...this._getCapraProbeToolsPayload('anthropic-tools')
                }
            },
            {
                id: 'google-tools',
                label: 'Messages + Google tool schema',
                category: 'google-tools',
                payload: {
                    ...base,
                    messages: userOnlyMessages,
                    persona: systemText,
                    ...this._getCapraProbeToolsPayload('google-tools')
                }
            },
            {
                id: 'message-google-tools',
                label: 'Single message + Google tool schema',
                category: 'google-tools',
                payload: {
                    ...base,
                    message: prompt,
                    persona: systemText,
                    ...this._getCapraProbeToolsPayload('google-tools')
                }
            },
            {
                id: 'text-control',
                label: 'Text tool prompt control',
                category: 'text-control',
                payload: this._buildAskSagePayload({
                    model: model,
                    prompt: prompt,
                    messages: withSystemMessages,
                    textToolMode: true
                })
            }
        ];
        return variants;
    },

    _summarizeCapraProbeResponse(variant, httpStatus, payload, rawText, parsed) {
        const data = parsed;
        const parsedKeys = (data && typeof data === 'object' && !Array.isArray(data)) ? Object.keys(data) : [];
        const parsedType = (data == null) ? 'null' : (Array.isArray(data) ? 'array' : typeof data);
        const bodyStatus = data && typeof data === 'object' ? data.status : null;
        const bodyMessage = data && typeof data === 'object'
            ? (data.response || data.message || data.error || '')
            : '';
        const internalError = Number(bodyStatus) === 400 && /internal error/i.test(String(bodyMessage || ''));
        let parsedResult;
        try {
            parsedResult = this._parseAskSageResponse(data ?? rawText);
        } catch (err) {
            parsedResult = {
                text: '',
                toolCalls: [],
                stopReason: 'parse_error',
                parseError: err && err.message ? err.message : String(err)
            };
        }
        const structuredToolCalls = [
            ...(Array.isArray(data?.tool_calls) ? data.tool_calls : []),
            ...(Array.isArray(data?.tool_calls_unified) ? data.tool_calls_unified : [])
        ];
        const status = internalError
            ? 'body_error'
            : (parsedResult.toolCalls && parsedResult.toolCalls.length)
                ? 'tool_calls'
                : String(parsedResult.text || '').trim()
                    ? 'text_only'
                    : 'empty';
        return {
            id: variant.id,
            label: variant.label,
            category: variant.category,
            requestKeys: Object.keys(payload || {}),
            httpStatus: httpStatus,
            parsedType: parsedType,
            parsedKeys: parsedKeys,
            bodyStatus: bodyStatus,
            bodyMessage: String(bodyMessage || ''),
            internalError: internalError,
            structuredToolCalls: structuredToolCalls.length,
            parsedToolCalls: Array.isArray(parsedResult.toolCalls) ? parsedResult.toolCalls.length : 0,
            parsedToolNames: Array.isArray(parsedResult.toolCalls) ? parsedResult.toolCalls.map(tc => tc && tc.name).filter(Boolean) : [],
            parsedTextPreview: String(parsedResult.text || '').slice(0, 240),
            stopReason: parsedResult.stopReason || '',
            parseError: parsedResult.parseError || '',
            rawPreview: String(rawText || '').slice(0, 800),
            verdict: status
        };
    },

    _formatCapraProbeResults(results) {
        if (!results || !Array.isArray(results.variants) || !results.variants.length) {
            return 'No Ask Sage probe results yet.';
        }
        const lines = [];
        lines.push('Ask Sage Tool Probe');
        lines.push('Started: ' + (results.startedAt || ''));
        lines.push('Model: ' + (results.model || ''));
        lines.push('Prompt: ' + (results.prompt || ''));
        lines.push('');
        for (const item of results.variants) {
            lines.push('[' + String(item.verdict || '').toUpperCase() + '] ' + item.label);
            lines.push('  HTTP=' + item.httpStatus + ' bodyStatus=' + item.bodyStatus + ' tools=' + item.parsedToolCalls + ' structured=' + item.structuredToolCalls);
            if (item.bodyMessage) lines.push('  body=' + item.bodyMessage.slice(0, 180));
            if (item.parsedToolNames && item.parsedToolNames.length) lines.push('  toolNames=' + item.parsedToolNames.join(', '));
            if (item.parsedTextPreview) lines.push('  text=' + item.parsedTextPreview.replace(/\s+/g, ' ').slice(0, 180));
            lines.push('  keys=' + item.requestKeys.join(', '));
            lines.push('');
        }
        return lines.join('\n');
    },

    _refreshCapraProbeUi() {
        const runBtn = document.getElementById('ai-capra-probe-run');
        const exportBtn = document.getElementById('ai-capra-probe-export');
        const statusEl = document.getElementById('ai-capra-probe-status');
        const outputEl = document.getElementById('ai-capra-probe-output');
        const profile = this.getActiveProfile();
        const providerId = profile ? (profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint)) : '';
        const canRun = this._isAskSageProvider(providerId) && !!this.getActiveApiKey();
        if (runBtn) runBtn.disabled = this._capraProbeRunning || !canRun;
        if (exportBtn) exportBtn.disabled = !this._lastCapraProbeResults;
        if (statusEl) {
            if (this._capraProbeRunning) {
                statusEl.textContent = 'Running Ask Sage probe...';
            } else if (!canRun) {
                statusEl.textContent = 'Select an active Ask Sage profile with a validated key to run the probe.';
            } else if (this._lastCapraProbeResults) {
                const count = Array.isArray(this._lastCapraProbeResults.variants) ? this._lastCapraProbeResults.variants.length : 0;
                statusEl.textContent = 'Last probe: ' + count + ' variants tested.';
            } else {
                statusEl.textContent = 'Probe sends multiple minimal Ask Sage requests to find an accepted tool-calling shape.';
            }
        }
        if (outputEl) {
            outputEl.textContent = this._lastCapraProbeResults
                ? this._formatCapraProbeResults(this._lastCapraProbeResults)
                : 'No probe results yet.';
        }
    },

    async runCapraToolProbe() {
        if (this._capraProbeRunning) return;
        const profile = this.getActiveProfile();
        const providerId = profile ? (profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint)) : '';
        const apiKey = this.getActiveApiKey();
        if (!this._isAskSageProvider(providerId) || !apiKey) {
            this._showConfigStatus('Select an active Ask Sage profile with an API key first.', 'error');
            this._refreshCapraProbeUi();
            return;
        }
        const model = this.getEffectiveModel();
        const queryUrl = this._getApiUrl(false);
        const headers = this._buildHeaders();
        const variants = this._buildCapraProbeVariants(model);
        const results = {
            startedAt: new Date().toISOString(),
            provider: providerId,
            model: model,
            endpoint: queryUrl,
            prompt: 'Use the getProjectInfo tool immediately. Return only a tool call for getProjectInfo. Do not explain.',
            variants: []
        };
        this._capraProbeRunning = true;
        this._refreshCapraProbeUi();
        addAIChatMessage('system', 'Running Ask Sage tool-call probe (' + variants.length + ' variants).');
        try {
            for (let i = 0; i < variants.length; i++) {
                const variant = variants[i];
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 45000);
                let httpStatus = 0;
                let rawText = '';
                let parsed = null;
                try {
                    this._debugLog('[CAPRA PROBE] Request', {
                        index: i + 1,
                        total: variants.length,
                        id: variant.id,
                        label: variant.label,
                        payload: variant.payload
                    });
                    const res = await fetch(queryUrl, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(variant.payload),
                        signal: controller.signal
                    });
                    httpStatus = res.status;
                    rawText = await res.text();
                    try { parsed = rawText ? JSON.parse(rawText) : null; } catch (_) { parsed = rawText; }
                } catch (err) {
                    rawText = err && err.message ? err.message : String(err);
                    parsed = { error: rawText, status: controller.signal.aborted ? 'timeout' : 'exception' };
                } finally {
                    clearTimeout(timeoutId);
                }
                const summary = this._summarizeCapraProbeResponse(variant, httpStatus, variant.payload, rawText, parsed);
                results.variants.push(summary);
                this._debugLog('[CAPRA PROBE] Result', summary, summary.internalError ? 'warn' : 'log');
                this._lastCapraProbeResults = results;
                this._refreshCapraProbeUi();
            }
            const successCount = results.variants.filter(item => item.verdict === 'tool_calls').length;
            const bodyErrorCount = results.variants.filter(item => item.verdict === 'body_error').length;
            results.completedAt = new Date().toISOString();
            addAIChatMessage('system', 'Ask Sage probe finished. Tool-call variants: ' + successCount + ', body-error variants: ' + bodyErrorCount + '.');
            this._showConfigStatus('Ask Sage probe finished. ' + successCount + ' variant(s) returned tool calls.', successCount ? 'success' : 'dim');
        } finally {
            this._capraProbeRunning = false;
            this._refreshCapraProbeUi();
        }
    },

    exportCapraProbeResults() {
        if (!this._lastCapraProbeResults) {
            this._showConfigStatus('No Ask Sage probe results to export.', 'error');
            return;
        }
        let href = null;
        try {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const blob = new Blob([JSON.stringify(this._lastCapraProbeResults, null, 2)], { type: 'application/json' });
            href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            a.download = 'capra-tool-probe-' + stamp + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            this._showConfigStatus('Exported Ask Sage probe results.', 'success');
        } catch (_) {
            this._showConfigStatus('Failed to export Ask Sage probe results.', 'error');
        } finally {
            if (href) URL.revokeObjectURL(href);
        }
    },

    _isTrivialAskSageText(text) {
        const s = String(text || '').trim();
        if (!s) return true;
        if (s.length <= 12 && /^(ok|okay|success|successful|done|complete|completed|accepted|true|false|null)$/i.test(s)) return true;
        if (s.length <= 24 && /^[a-z0-9 _.\-]+$/i.test(s) && /(success|completed|accepted)/i.test(s)) return true;
        return false;
    },

    _extractAskSageResponseMeta(payload) {
        const candidates = [];
        const seen = new Set();
        const pushCandidate = (value, source, priority) => {
            if (typeof value !== 'string') return;
            const text = value.trim();
            if (!text) return;
            const key = source + '::' + text;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push({
                text: text,
                source: source || 'unknown',
                priority: Number(priority) || 0,
                trivial: this._isTrivialAskSageText(text)
            });
        };
        const priorityForKey = (key) => {
            const k = String(key || '').toLowerCase();
            if (k === 'query' || k === 'question' || k === 'input_text' || k === 'prompt' || k === 'messages' || k === 'message_history') return -200;
            if (k === 'output_text' || k === 'generated_text') return 130;
            if (k === 'answer' || k === 'completion') return 125;
            if (k === 'content' || k === 'text') return 120;
            if (k === 'assistant_response' || k === 'assistant') return 115;
            if (k === 'message') return 92;
            if (k === 'response') return 70;
            return 85;
        };
        const walk = (node, path, depth) => {
            if (node == null || depth > 6) return;
            if (typeof node === 'string') {
                const leaf = String(path || '').split('.').pop() || '';
                const score = priorityForKey(leaf);
                if (score >= 0) pushCandidate(node, path || 'string', score);
                return;
            }
            if (Array.isArray(node)) {
                for (let i = 0; i < node.length; i++) {
                    walk(node[i], (path ? path + '[' + i + ']' : '[' + i + ']'), depth + 1);
                }
                return;
            }
            if (typeof node === 'object') {
                for (const [k, v] of Object.entries(node)) {
                    const branchScore = priorityForKey(k);
                    if (branchScore < 0) continue;
                    const nextPath = path ? (path + '.' + k) : k;
                    if (typeof v === 'string') pushCandidate(v, nextPath, branchScore);
                    else walk(v, nextPath, depth + 1);
                }
            }
        };

        if (typeof payload === 'string') {
            pushCandidate(payload, 'payload', 140);
        } else if (payload && typeof payload === 'object') {
            // Common OpenAI-like and CAPRA-like shapes first
            pushCandidate(payload.output_text, 'output_text', 130);
            pushCandidate(payload.generated_text, 'generated_text', 130);
            pushCandidate(payload.answer, 'answer', 128);
            pushCandidate(payload.completion, 'completion', 126);
            pushCandidate(payload.text, 'text', 124);
            pushCandidate(payload.message, 'message', 92);
            pushCandidate(payload.response, 'response', 70);
            pushCandidate(payload.result && payload.result.text, 'result.text', 124);
            pushCandidate(payload.data && payload.data.text, 'data.text', 122);
            if (payload.choices && payload.choices[0]) {
                pushCandidate(payload.choices[0].message && payload.choices[0].message.content, 'choices[0].message.content', 140);
                pushCandidate(payload.choices[0].text, 'choices[0].text', 136);
            }
            walk(payload, 'root', 0);
        }

        if (!candidates.length) {
            return { text: '', source: 'none', candidates: [] };
        }

        candidates.sort((a, b) => {
            if (a.trivial !== b.trivial) return a.trivial ? 1 : -1;
            if (a.priority !== b.priority) return b.priority - a.priority;
            if (a.text.length !== b.text.length) return b.text.length - a.text.length;
            return a.source.localeCompare(b.source);
        });
        const best = candidates[0];
        return {
            text: best.text,
            source: best.source,
            candidates: candidates.slice(0, 10)
        };
    },

    extractAskSageResponseText(payload) {
        const meta = this._extractAskSageResponseMeta(payload);
        if (meta.text) return meta.text;
        if (payload == null) return '';
        if (typeof payload === 'string') return payload.trim();
        try { return JSON.stringify(payload); } catch (_) { return String(payload); }
    },

    _canonicalToolName(name) {
        const raw = String(name || '').trim();
        if (!raw) return '';
        const normalizedRaw = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
        const defs = this._toolDefs();
        for (const def of defs) {
            const canonical = String(def.name || '');
            const normalizedCanonical = canonical.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalizedCanonical === normalizedRaw) return canonical;
        }
        return '';
    },

    _stableStringify(value) {
        const walk = (v) => {
            if (v == null) return 'null';
            if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
            if (typeof v === 'object') {
                const keys = Object.keys(v).sort();
                return '{' + keys.map(k => JSON.stringify(k) + ':' + walk(v[k])).join(',') + '}';
            }
            return JSON.stringify(v);
        };
        return walk(value);
    },

    _extractAskSageToolCallsFromStructured(payload) {
        const out = [];
        const seenObjects = new Set();
        const addCall = (node, source, index) => {
            const call = this._normalizeAskSageToolCall(node, source, index);
            if (call) out.push(call);
        };
        const extractCollection = (node, source) => {
            if (node == null) return;
            if (typeof node === 'string') {
                const parsed = this._safeParse(node);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
                    extractCollection(parsed, source + ':json');
                }
                return;
            }
            if (Array.isArray(node)) {
                for (let i = 0; i < node.length; i++) addCall(node[i], source, i);
                return;
            }
            if (typeof node === 'object') {
                if (Array.isArray(node.calls)) {
                    for (let i = 0; i < node.calls.length; i++) addCall(node.calls[i], source + '.calls', i);
                    return;
                }
                addCall(node, source, 0);
            }
        };
        const walk = (node, path, depth) => {
            if (node == null || depth > 6) return;
            if (typeof node !== 'object') return;
            if (seenObjects.has(node)) return;
            seenObjects.add(node);
            if (Array.isArray(node)) {
                for (let i = 0; i < node.length; i++) walk(node[i], path + '[' + i + ']', depth + 1);
                return;
            }
            for (const [k, v] of Object.entries(node)) {
                const key = String(k || '').toLowerCase();
                const nextPath = path ? (path + '.' + k) : k;
                if (key === 'tool_call' || key === 'tool_calls' || key === 'tool_calls_unified' || key === 'toolcalls' || key === 'toolcallsunified') {
                    extractCollection(v, nextPath);
                }
                walk(v, nextPath, depth + 1);
            }
        };
        walk(payload, 'root', 0);
        return out;
    },

    _normalizeAskSageToolCall(node, source, index) {
        if (node == null) return null;
        if (typeof node === 'string') {
            const parsed = this._safeParse(node);
            if (!parsed || typeof parsed !== 'object' || !Object.keys(parsed).length) return null;
            return this._normalizeAskSageToolCall(parsed, source, index);
        }
        if (typeof node !== 'object') return null;
        const fn = (node.function && typeof node.function === 'object') ? node.function : null;
        const fc = (node.functionCall && typeof node.functionCall === 'object') ? node.functionCall : null;
        const rawName = node.name || node.tool_name || node.tool || node.function_name
            || (fn && (fn.name || fn.function_name))
            || (fc && fc.name)
            || '';
        const name = this._canonicalToolName(rawName);
        if (!name) return null;
        let args = node.args;
        if (args == null) args = node.arguments;
        if (args == null && fn) args = (fn.arguments != null ? fn.arguments : fn.args);
        if (args == null && fc) args = fc.args;
        if (args == null) args = node.input;
        if (args == null) args = node.parameters;
        if (args == null) args = node.payload;
        if (args == null && !fn && !fc) {
            const params = {};
            for (const [k, v] of Object.entries(node)) {
                if (k === 'id' || k === 'name' || k === 'tool_name' || k === 'tool'
                    || k === 'function_name' || k === 'function' || k === 'functionCall'
                    || k === 'type') {
                    continue;
                }
                params[this._normalizeAskSageArgKey(k)] = v;
            }
            args = params;
        }
        if (typeof args === 'string') {
            const parsedArgs = this._safeParse(args);
            if (parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)) args = parsedArgs;
            else args = {};
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
        if (args && typeof args === 'object' && !Array.isArray(args)) {
            const normalizedArgs = {};
            for (const [k, v] of Object.entries(args)) {
                normalizedArgs[this._normalizeAskSageArgKey(k)] = v;
            }
            args = normalizedArgs;
        }
        const id = node.id || node.tool_call_id || ('as_tc_' + this._uid() + '_' + index);
        return { id, name, args, _source: source || 'structured' };
    },

    _normalizeAskSageArgKey(key) {
        const raw = String(key || '').trim();
        if (!raw) return raw;
        const lowered = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
        const aliases = {
            filepath: 'path',
            file: 'path',
            filename: 'path',
            fileglob: 'fileGlob',
            startline: 'startLine',
            endline: 'endLine'
        };
        if (aliases[lowered]) return aliases[lowered];
        return raw;
    },

    _extractAskSageToolCallsFromTaggedText(text) {
        const src = String(text || '');
        if (!src) return { toolCalls: [], cleanedText: '', matchedTags: [] };
        const calls = [];
        const spans = [];
        const matchedTags = [];
        const pushCall = (tc) => {
            if (!tc || !tc.name) return;
            calls.push(tc);
        };

        // CAPRA sometimes returns wrapper tags with JSON payloads:
        // <tool_call>{"name":"writeFile","path":"index.html","content":"..."}</tool_call>
        const explicitToolCallPattern = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
        let tcMatch;
        while ((tcMatch = explicitToolCallPattern.exec(src)) !== null) {
            const rawBody = String(tcMatch[1] || '').trim();
            if (!rawBody) continue;
            let parsed = null;
            try {
                parsed = JSON.parse(rawBody);
            } catch (_) {
                parsed = this._safeParse(rawBody);
            }
            const addParsed = (entry, idx) => {
                const normalized = this._normalizeAskSageToolCall(entry, 'message-tag:tool_call', idx);
                if (normalized) pushCall(normalized);
            };
            if (Array.isArray(parsed)) {
                for (let i = 0; i < parsed.length; i++) addParsed(parsed[i], i);
            } else if (parsed && typeof parsed === 'object') {
                addParsed(parsed, 0);
            }
            spans.push({ start: tcMatch.index, end: tcMatch.index + tcMatch[0].length });
            matchedTags.push('tool_call');
        }

        // Also support direct JSON array/object inside <tool_calls>...</tool_calls>
        const toolCallsContainerPattern = /<tool_calls\b[^>]*>([\s\S]*?)<\/tool_calls>/gi;
        let tcsMatch;
        while ((tcsMatch = toolCallsContainerPattern.exec(src)) !== null) {
            const containerBody = String(tcsMatch[1] || '').trim();
            if (!containerBody) continue;
            // Skip if it only contains nested <tool_call> blocks (already handled above).
            if (!/<tool_call\b/i.test(containerBody)) {
                const parsedContainer = this._safeParse(containerBody);
                const addParsed = (entry, idx) => {
                    const normalized = this._normalizeAskSageToolCall(entry, 'message-tag:tool_calls', idx);
                    if (normalized) pushCall(normalized);
                };
                if (Array.isArray(parsedContainer)) {
                    for (let i = 0; i < parsedContainer.length; i++) addParsed(parsedContainer[i], i);
                } else if (parsedContainer && typeof parsedContainer === 'object') {
                    if (Array.isArray(parsedContainer.calls)) {
                        for (let i = 0; i < parsedContainer.calls.length; i++) addParsed(parsedContainer.calls[i], i);
                    } else {
                        addParsed(parsedContainer, 0);
                    }
                }
            }
            spans.push({ start: tcsMatch.index, end: tcsMatch.index + tcsMatch[0].length });
            matchedTags.push('tool_calls');
        }

        // Unclosed <tool_calls> tag fallback � model hit max output tokens before
        // writing the closing </tool_calls>. The regex above requires the closing tag,
        // so we detect the unclosed opening tag and extract JSON objects from the body.
        const unclosedResult = this._extractUnclosedToolCallsTag(src, spans);
        for (const tc of unclosedResult.calls) pushCall(tc);
        for (const sp of unclosedResult.spans) spans.push(sp);
        for (const tag of unclosedResult.matchedTags) matchedTags.push(tag);

        // Inline JSON tool calls separated by "next" delimiter
        // Pattern: {"tool":"readFile","path":"..."}next{"tool":"writeFile",...}
        // Common when CAPRA relays model responses that embed tool calls in plain text.
        const inlineResult = this._extractInlineJsonToolCalls(src);
        for (const tc of inlineResult.calls) pushCall(tc);
        for (const sp of inlineResult.spans) spans.push(sp);
        for (const tag of inlineResult.matchedTags) matchedTags.push(tag);

        // Dash-prefixed tool calls � model echoes the conversation history format:
        // [TOOL CALLS]
        // - writeFile: {"path":"index.html","content":"..."}
        const dashResult = this._extractDashPrefixedToolCalls(src);
        for (const tc of dashResult.calls) pushCall(tc);
        for (const sp of dashResult.spans) spans.push(sp);
        for (const tag of dashResult.matchedTags) matchedTags.push(tag);

        const tagPattern = /<([A-Za-z][A-Za-z0-9_-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
        let match;
        while ((match = tagPattern.exec(src)) !== null) {
            const rawTag = String(match[1] || '');
            const rawTagNorm = rawTag.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (rawTagNorm === 'toolcall' || rawTagNorm === 'toolcalls') continue;
            const canonical = this._canonicalToolName(rawTag);
            if (!canonical) continue;
            const args = this._extractAskSageXmlToolArgs(canonical, String(match[2] || ''));
            const def = this._toolDefs().find(d => d.name === canonical);
            const missingRequired = !!(def && Array.isArray(def.required) && def.required.some(req => args[req] == null || args[req] === ''));
            if (missingRequired) continue;
            pushCall({
                id: 'as_xml_' + this._uid(),
                name: canonical,
                args,
                _source: 'message-tag:' + rawTag
            });
            spans.push({ start: match.index, end: match.index + match[0].length });
            matchedTags.push(rawTag);
        }
        let cleaned = src;
        if (spans.length) {
            spans.sort((a, b) => a.start - b.start);
            let cursor = 0;
            let rebuilt = '';
            for (const span of spans) {
                rebuilt += src.slice(cursor, span.start);
                cursor = span.end;
            }
            rebuilt += src.slice(cursor);
            cleaned = rebuilt;
        }
        cleaned = cleaned
            .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return { toolCalls: calls, cleanedText: cleaned, matchedTags };
    },

    /**
     * Extract a balanced JSON object (brace-counted) starting at `startIdx`.
     * Returns the JSON substring or null if braces are unbalanced.
     */
    _extractBalancedJson(text, startIdx) {
        if (!text || startIdx < 0 || startIdx >= text.length || text[startIdx] !== '{') return null;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = startIdx; i < text.length; i++) {
            const ch = text[i];
            if (escaped) { escaped = false; continue; }
            if (ch === '\\' && inString) { escaped = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return text.slice(startIdx, i + 1);
            }
        }
        return null;
    },

    /**
     * Handle an unclosed <tool_calls> tag � the model hit its output token limit
     * before writing </tool_calls>.  We locate the opening tag, skip any positions
     * already consumed by the closed-tag regex, then extract individual JSON objects
     * from whatever is left after the tag.
     */
    _extractUnclosedToolCallsTag(text, existingSpans) {
        const src = String(text || '');
        const calls = [];
        const spans = [];
        const matchedTags = [];

        // Find all <tool_calls> opening positions
        const openPattern = /<tool_calls\b[^>]*>/gi;
        let openMatch;
        while ((openMatch = openPattern.exec(src)) !== null) {
            const openStart = openMatch.index;
            const bodyStart = openStart + openMatch[0].length;

            // Skip if this opening tag was already covered by the closed-tag regex
            const alreadyCaptured = (existingSpans || []).some(
                sp => sp.start <= openStart && sp.end > openStart
            );
            if (alreadyCaptured) continue;

            // No closing tag found � grab everything after the opening tag
            const body = src.slice(bodyStart).trim();
            if (!body) continue;

            // The body should start with '[' (JSON array) � skip to first '{'
            let pos = 0;
            let found = 0;
            while (pos < body.length) {
                const nextBrace = body.indexOf('{', pos);
                if (nextBrace < 0) break;

                const jsonStr = this._extractBalancedJson(body, nextBrace);
                if (!jsonStr) {
                    // Truncated JSON � can't extract more.  Stop here.
                    break;
                }

                let obj;
                try { obj = JSON.parse(jsonStr); } catch (_) {
                    try { obj = this._safeParse(jsonStr); } catch (_2) { obj = null; }
                }

                if (obj && typeof obj === 'object' && Object.keys(obj).length) {
                    const normalized = this._normalizeAskSageToolCall(obj, 'message-tag:tool_calls:unclosed', found);
                    if (normalized) {
                        calls.push(normalized);
                        found++;
                    }
                }

                pos = nextBrace + jsonStr.length;
            }

            if (found > 0) {
                spans.push({ start: openStart, end: openStart + src.length - openStart });
                matchedTags.push('tool_calls');
                this._askSageDebugLog('Extracted tool calls from unclosed <tool_calls> tag', {
                    toolCallCount: found,
                    bodyPreview: body.slice(0, 300)
                });
            }
        }

        return { calls, spans, matchedTags };
    },

    /**
     * Scan text for inline JSON tool-call objects optionally separated by "next".
     * Handles the CAPRA pattern: {"tool":"readFile",...}next{"tool":"writeFile",...}
     * Also expands replaceInFile with a "replacements" array into individual calls.
     */
    _extractInlineJsonToolCalls(text) {
        const src = String(text || '');
        if (!src) return { calls: [], spans: [], matchedTags: [] };

        const calls = [];
        const matchedTags = [];
        const jsonSpans = []; // individual { start, end } for each JSON object

        let pos = 0;
        while (pos < src.length) {
            // Find next potential inline JSON tool object
            const marker = src.indexOf('{"tool"', pos);
            const markerAlt = src.indexOf('{\\"tool\\"', pos); // double-escaped variant
            let idx = -1;
            if (marker >= 0 && (markerAlt < 0 || marker <= markerAlt)) idx = marker;
            else if (markerAlt >= 0) idx = markerAlt;
            if (idx < 0) break;

            const jsonStr = this._extractBalancedJson(src, idx);
            if (!jsonStr) { pos = idx + 7; continue; }

            let obj;
            try { obj = JSON.parse(jsonStr); } catch (_) {
                // Try unescaping one level (CAPRA sometimes double-escapes)
                try { obj = JSON.parse(JSON.parse('"' + jsonStr + '"')); } catch (_2) {
                    pos = idx + 7; continue;
                }
            }

            if (!obj || typeof obj !== 'object' || !obj.tool) { pos = idx + 7; continue; }

            // Verify it maps to a known tool
            const canonicalName = this._canonicalToolName(obj.tool);
            if (!canonicalName) { pos = idx + jsonStr.length; continue; }

            jsonSpans.push({ start: idx, end: idx + jsonStr.length });

            // Expand replaceInFile with "replacements" array into individual calls
            if (canonicalName === 'replaceInFile' && Array.isArray(obj.replacements)) {
                for (let i = 0; i < obj.replacements.length; i++) {
                    const rep = obj.replacements[i];
                    const normalized = this._normalizeAskSageToolCall({
                        tool: 'replaceInFile',
                        path: obj.path,
                        find: rep.find || rep.search || rep.old,
                        replace: rep.replace || rep.replacement || rep['new'] || rep['with']
                    }, 'message-inline-json', calls.length);
                    if (normalized) {
                        calls.push(normalized);
                        matchedTags.push('inline-json');
                    }
                }
            } else {
                const normalized = this._normalizeAskSageToolCall(obj, 'message-inline-json', calls.length);
                if (normalized) {
                    calls.push(normalized);
                    matchedTags.push('inline-json');
                }
            }

            pos = idx + jsonStr.length;
            // Skip past any "next" delimiter between tool calls
            const afterJson = src.slice(pos);
            const nextDelim = afterJson.match(/^\s*next\s*/i);
            if (nextDelim) pos += nextDelim[0].length;
        }

        // Merge adjacent spans that are only separated by "next" or whitespace
        const mergedSpans = [];
        for (const span of jsonSpans) {
            if (mergedSpans.length) {
                const prev = mergedSpans[mergedSpans.length - 1];
                const between = src.slice(prev.end, span.start).trim();
                if (!between || /^next$/i.test(between)) {
                    prev.end = span.end;
                    continue;
                }
            }
            mergedSpans.push({ start: span.start, end: span.end });
        }

        return { calls, spans: mergedSpans, matchedTags };
    },

    /**
     * Parse dash-prefixed tool calls that match the conversation history format:
     *   [TOOL CALLS]
     *   - toolName: {"path":"...","content":"..."}
     *   - toolName: {"path":"...","find":"...","replace":"..."}
     * The model sees this format in prior turns and sometimes echoes it back.
     */
    _extractDashPrefixedToolCalls(text) {
        const src = String(text || '');
        if (!src) return { calls: [], spans: [], matchedTags: [] };

        const calls = [];
        const matchedTags = [];
        const allSpans = [];

        // Find [TOOL CALLS] header(s) and process lines after each one
        const headerPattern = /\[TOOL CALLS\]/gi;
        let headerMatch;
        while ((headerMatch = headerPattern.exec(src)) !== null) {
            const headerStart = headerMatch.index;
            let pos = headerMatch.index + headerMatch[0].length;

            // Process consecutive dash-prefixed lines after the header
            let blockEnd = pos;
            while (pos < src.length) {
                // Skip whitespace/newlines between entries
                const gap = src.slice(pos).match(/^[\s\n]*/);
                if (gap) pos += gap[0].length;
                if (pos >= src.length) break;

                // Must start with "- "
                if (src[pos] !== '-' || src[pos + 1] !== ' ') break;

                // Extract "- toolName: " prefix
                const lineStart = pos;
                const colonMatch = src.slice(pos + 2).match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*/);
                if (!colonMatch) break;

                const rawName = colonMatch[1];
                const canonicalName = this._canonicalToolName(rawName);
                if (!canonicalName) break;

                const jsonStart = pos + 2 + colonMatch[0].length;
                if (jsonStart >= src.length || src[jsonStart] !== '{') break;

                const jsonStr = this._extractBalancedJson(src, jsonStart);
                if (!jsonStr) break;

                let args;
                try { args = JSON.parse(jsonStr); } catch (_) {
                    try { args = JSON.parse(JSON.parse('"' + jsonStr + '"')); } catch (_2) { break; }
                }
                if (!args || typeof args !== 'object') break;

                // Build a tool-call-like object and normalize it
                const toolObj = Object.assign({ tool: canonicalName }, args);
                const normalized = this._normalizeAskSageToolCall(toolObj, 'message-dash-prefix', calls.length);
                if (normalized) {
                    calls.push(normalized);
                    matchedTags.push('dash-prefix');
                }

                blockEnd = jsonStart + jsonStr.length;
                pos = blockEnd;
            }

            // Record the entire [TOOL CALLS]...entries block as one span for cleanup
            if (blockEnd > headerStart + headerMatch[0].length) {
                allSpans.push({ start: headerStart, end: blockEnd });
            }
        }

        return { calls, spans: allSpans, matchedTags };
    },

    _extractAskSageXmlToolArgs(toolName, blockBody) {
        const defs = this._toolDefs();
        const def = defs.find(d => d.name === toolName);
        const args = {};
        const preserveRaw = new Set(['content', 'find', 'replace']);
        const fallbackAliases = {
            path: ['path', 'file', 'filepath', 'file_path'],
            content: ['content', 'text', 'body'],
            find: ['find', 'search', 'old', 'target'],
            replace: ['replace', 'replacement', 'new', 'with'],
            pattern: ['pattern', 'query', 'regex'],
            patterns: ['patterns', 'pattern_list'],
            fileGlob: ['fileGlob', 'file_glob', 'glob', 'extension'],
            startLine: ['startLine', 'start_line', 'start'],
            endLine: ['endLine', 'end_line', 'end'],
            plan: ['plan', 'steps']
        };
        const extract = (paramName) => {
            const aliases = [];
            if (Array.isArray(fallbackAliases[paramName])) aliases.push(...fallbackAliases[paramName]);
            aliases.push(paramName);
            const snake = paramName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
            const kebab = snake.replace(/_/g, '-');
            const lower = paramName.toLowerCase();
            aliases.push(snake, kebab, lower);
            const uniqueAliases = [...new Set(aliases.filter(Boolean))];
            return this._extractAskSageTagValue(blockBody, uniqueAliases, preserveRaw.has(paramName));
        };
        if (def) {
            for (const paramName of Object.keys(def.params || {})) {
                const value = extract(paramName);
                if (value == null || value === '') continue;
                args[paramName] = value;
            }
        }
        if (args.startLine != null) {
            const start = parseInt(args.startLine, 10);
            if (Number.isFinite(start)) args.startLine = start;
        }
        if (args.endLine != null) {
            const end = parseInt(args.endLine, 10);
            if (Number.isFinite(end)) args.endLine = end;
        }
        if (Object.keys(args).length) return args;
        const trimmed = String(blockBody || '').trim();
        if (!trimmed) return {};
        const parsed = this._safeParse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return {};
    },

    _extractAskSageTagValue(text, aliases, preserveWhitespace) {
        const src = String(text || '');
        for (const alias of aliases || []) {
            const key = String(alias || '').trim();
            if (!key) continue;
            const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp('<' + escaped + '\\b[^>]*>([\\s\\S]*?)<\\/' + escaped + '>', 'i');
            const match = pattern.exec(src);
            if (!match) continue;
            let value = String(match[1] || '');
            if (preserveWhitespace) {
                value = value.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
                return value;
            }
            return value.trim();
        }
        return null;
    },

    _normalizeAskSageMessages(messages) {
        const normalized = [];
        for (const m of (Array.isArray(messages) ? messages : [])) {
            if (!m) continue;
            if (m.role === 'tool') {
                const toolName = String(m._toolName || 'tool');
                const toolArgs = m._toolArgs && typeof m._toolArgs === 'object' ? m._toolArgs : {};
                const rawToolResult = m._toolResultContract
                    ? this._toolResultContractToMessageContent(m._toolResultContract, 32000)
                    : (typeof m.content === 'string'
                        ? m.content
                        : this._formatDebugValue(m.content, 20000));
                const toolResult = this._buildAskSageToolResultText(toolName, toolArgs, rawToolResult);
                normalized.push({
                    role: 'user',
                    content: '[TOOL RESULT ' + toolName + ']\n' + toolResult
                });
                continue;
            }
            if (m.role === 'assistant' && Array.isArray(m.content)) {
                const text = m.content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n').trim();
                if (text) normalized.push({ role: 'assistant', content: text });
                continue;
            }
            if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
                const callLines = m.tool_calls.map(tc => {
                    const fn = tc && tc.function ? tc.function : {};
                    const name = String(fn.name || tc.name || 'tool');
                    const args = (fn.arguments != null) ? fn.arguments : (tc.args != null ? tc.args : {});
                    const argsText = (typeof args === 'string') ? args : this._formatDebugValue(args, 1400);
                    return '- ' + name + ': ' + argsText;
                }).join('\n');
                const assistantText = typeof m.content === 'string' ? m.content.trim() : '';
                const merged = (assistantText ? assistantText + '\n\n' : '') + '[TOOL CALLS]\n' + callLines;
                normalized.push({ role: 'assistant', content: merged });
                continue;
            }
            if (m.role === 'user' && Array.isArray(m.content)) {
                const text = m.content
                    .map(part => {
                        if (typeof part === 'string') return part;
                        if (part && part.type === 'tool_result') {
                            const toolName = String(part._toolName || 'tool');
                            const toolArgs = part._toolArgs && typeof part._toolArgs === 'object' ? part._toolArgs : {};
                            const payload = part._toolResultContract
                                ? this._toolResultContractToMessageContent(part._toolResultContract, 32000)
                                : (typeof part.content === 'string' ? part.content : this._formatDebugValue(part.content, 16000));
                            return '[TOOL RESULT ' + toolName + ']\n' + this._buildAskSageToolResultText(toolName, toolArgs, payload);
                        }
                        if (part && typeof part.text === 'string') return part.text;
                        if (part && typeof part.content === 'string') return part.content;
                        return '';
                    })
                    .filter(Boolean)
                    .join('\n')
                    .trim();
                if (text) normalized.push({ role: 'user', content: text });
                continue;
            }
            if (typeof m.content === 'string' && m.content.trim()) {
                normalized.push({ role: m.role, content: m.content });
            }
        }
        return normalized;
    },

    _selectAskSageHistoryWindow(historyMessages, opts) {
        const history = Array.isArray(historyMessages) ? historyMessages : [];
        const options = opts || {};
        const maxEntries = Math.max(8, Number(options.maxEntries) || 24);
        const maxChars = Math.max(6000, Number(options.maxChars) || 36000);
        const selected = [];
        let totalChars = 0;
        for (let i = history.length - 1; i >= 0; i--) {
            const entry = history[i];
            if (!entry || typeof entry.content !== 'string' || !entry.content.trim()) continue;
            const nextLen = entry.content.length;
            if (selected.length >= maxEntries) break;
            if (selected.length > 0 && totalChars + nextLen > maxChars && selected.length >= Math.min(12, maxEntries)) break;
            selected.unshift(entry);
            totalChars += nextLen;
        }
        return selected;
    },

    _buildAskSageToolResultText(toolName, toolArgs, rawResult) {
        const name = String(toolName || 'tool');
        const args = (toolArgs && typeof toolArgs === 'object') ? toolArgs : {};
        const resultText = typeof rawResult === 'string' ? rawResult : this._formatDebugValue(rawResult, 20000);
        const headerParts = [];
        if (args.path) headerParts.push('path=' + args.path);
        if (args.startLine != null) headerParts.push('startLine=' + args.startLine);
        if (args.endLine != null) headerParts.push('endLine=' + args.endLine);
        if (args.find && name === 'replaceInFile') {
            headerParts.push('findPreview=' + JSON.stringify(String(args.find).slice(0, 120)));
        }
        const argsText = Object.keys(args).length ? this._formatDebugValue(args, 4000) : '';
        const prelude = [];
        if (headerParts.length) prelude.push('Context: ' + headerParts.join(', '));
        if (argsText) prelude.push('Args: ' + argsText);
        prelude.push('Result:\n' + resultText);
        return prelude.join('\n');
    },

    _buildAskSagePayload(args) {
        const req = args || {};
        const model = String(req.model || this.getEffectiveModel() || '').trim() || 'gpt-4.1';
        const normalized = this._normalizeAskSageMessages(req.messages);
        const personaText = normalized
            .filter(entry => entry && entry.role === 'system' && typeof entry.content === 'string' && entry.content.trim())
            .map(entry => entry.content.trim())
            .join('\n\n')
            .trim();
        const historyMessages = normalized.filter(entry => entry && entry.role !== 'system' && typeof entry.content === 'string' && entry.content.trim());
        const latestUser = [...historyMessages].reverse().find(entry => entry.role === 'user');
        const promptText = String(req.prompt || latestUser?.content || '').trim();
        if (req.textToolMode) {
            const composedPrompt = this._buildAskSageTextToolPrompt({
                personaText: personaText,
                historyMessages: historyMessages,
                promptText: promptText
            });
            const retryPrompt = composedPrompt || promptText;
            return Object.fromEntries(
                Object.entries({
                    model: model,
                    message: retryPrompt || undefined,
                    prompt: retryPrompt || undefined,
                    query: retryPrompt || undefined,
                    question: retryPrompt || undefined,
                    input_text: retryPrompt || undefined,
                    messages: retryPrompt ? [{ role: 'user', content: retryPrompt }] : undefined,
                    response_mode: 'sync',
                    stream: false
                }).filter(([, value]) => value !== undefined && value !== '')
            );
        }
        if (req.includeTools && !req.compatibilityMode) {
            const nativeMessage = this._buildAskSageNativeToolMessage({
                personaText: personaText,
                historyMessages: historyMessages,
                promptText: promptText
            });
            const payload = {
                model: model,
                message: nativeMessage || undefined,
                response_mode: 'sync',
                stream: false,
                tools: this._toolDefs().map(t => ({
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: { type: 'object', properties: t.params, required: t.required }
                    }
                })),
                tool_choice: this._forceToolChoice ? 'required' : 'auto'
            };
            return Object.fromEntries(
                Object.entries(payload).filter(([, value]) => value !== undefined && value !== '')
            );
        }
        const primaryMessages = req.compatibilityMode
            ? (promptText ? [{ role: 'user', content: promptText }] : historyMessages.slice(-1))
            : historyMessages;
        const payload = {
            model: model,
            message: promptText || undefined,
            prompt: promptText || undefined,
            query: promptText || undefined,
            question: promptText || undefined,
            input_text: promptText || undefined,
            messages: primaryMessages.length ? primaryMessages : undefined,
            message_history: historyMessages.length ? historyMessages : undefined,
            persona: personaText || undefined,
            response_mode: 'sync',
            stream: false
        };
        if (req.includeTools) {
            payload.tools = this._toolDefs().map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: { type: 'object', properties: t.params, required: t.required }
                }
            }));
            payload.tool_choice = this._forceToolChoice ? 'required' : 'auto';
        }
        return Object.fromEntries(
            Object.entries(payload).filter(([, value]) => value !== undefined && value !== '')
        );
    },

    _buildAskSageNativeToolMessage(args) {
        const req = args || {};
        const personaText = String(req.personaText || '').trim();
        const promptText = String(req.promptText || '').trim();
        const history = Array.isArray(req.historyMessages) ? req.historyMessages : [];
        const recent = this._selectAskSageHistoryWindow(history, {
            maxEntries: promptText ? 24 : 28,
            maxChars: promptText ? 42000 : 48000
        });
        const prior = promptText && recent.length
            ? recent.slice(0, -1)
            : recent;
        const transcript = prior.map(entry => {
            const role = entry && entry.role === 'assistant' ? 'Assistant' : 'User';
            const content = String(entry && entry.content || '').trim();
            return content ? (role + ': ' + content) : '';
        }).filter(Boolean).join('\n\n');
        const parts = [];
        if (personaText) parts.push(personaText);
        if (transcript) parts.push('Conversation context:\n' + transcript);
        if (promptText) {
            parts.push((transcript || personaText)
                ? ('Current user request:\n' + promptText)
                : promptText);
        } else if (recent.length) {
            parts.push(String(recent[recent.length - 1].content || '').trim());
        }
        return parts.join('\n\n').trim();
    },

    _buildAskSageTextToolPrompt(args) {
        const req = args || {};
        const personaText = String(req.personaText || '').trim();
        const promptText = String(req.promptText || '').trim();
        const history = this._selectAskSageHistoryWindow(req.historyMessages, {
            maxEntries: 20,
            maxChars: 32000
        });
        const toolSpecs = this._toolDefs().map(def => {
            const required = Array.isArray(def.required) && def.required.length
                ? ' Required args: ' + def.required.join(', ') + '.'
                : '';
            return '- ' + def.name + ': ' + def.description + required;
        }).join('\n');
        const historyText = history.map(entry => {
            const role = entry && entry.role === 'assistant' ? 'Assistant' : 'User';
            const content = this._capToolResultNoReread(String(entry && entry.content || '').trim(), 1200);
            return role + ': ' + content;
        }).filter(Boolean).join('\n\n');
        let prompt = '';
        if (personaText) {
            prompt += personaText + '\n\n';
        }
        prompt += 'If you need to use tools, do not describe your plan first. Respond in plain text using exactly this format:\n';
        prompt += '[TOOL CALLS]\n';
        prompt += '- readFile: {"path":"index.html"}\n';
        prompt += '- replaceInFile: {"path":"index.html","find":"old","replace":"new"}\n';
        prompt += 'You may include multiple tool calls, one per line. Do not use markdown code fences around tool calls.\n\n';
        prompt += 'Available tools:\n' + toolSpecs + '\n';
        if (historyText) {
            prompt += '\nConversation so far:\n' + historyText + '\n';
        }
        if (promptText) {
            prompt += '\nCurrent user request:\n' + promptText + '\n';
        }
        prompt += '\nIf no tools are needed, answer briefly.';
        return prompt.trim();
    },

    _isAskSageMissingMessageError(payload) {
        const candidates = [
            payload && payload.message,
            payload && payload.error,
            payload && payload.response,
            typeof payload === 'string' ? payload : null
        ].filter(value => typeof value === 'string' && value.trim());
        return candidates.some(value => /did not contain a message/i.test(value));
    },

    _isAskSageRetryableBodyError(payload) {
        const bodyStatus = Number(payload && payload.status);
        const candidates = [
            payload && payload.message,
            payload && payload.error,
            payload && payload.response,
            typeof payload === 'string' ? payload : null
        ].filter(value => typeof value === 'string' && value.trim());
        if (Number.isFinite(bodyStatus) && bodyStatus >= 400) return true;
        return candidates.some(value => /internal error|bad request|invalid request/i.test(value));
    },

    async callAskSageQuery(args) {
        const req = args || {};
        const prompt = String(req.prompt || '').trim();
        if (!prompt) throw new Error('Missing prompt');
        const model = String(req.model || this._getAskSageSettings().model || '').trim() || 'gpt-4.1';
        const messages = (Array.isArray(req.messages) && req.messages.length) ? req.messages : [{ role: 'user', content: prompt }];
        const payload = this._buildAskSagePayload({
            model: model,
            prompt: prompt,
            messages: messages,
            includeTools: false
        });
        const settings = this._getAskSageSettings();
        const data = await this.callSageApi({
            path: settings.queryEndpoint,
            base: 'server',
            body: payload
        });
        return this.extractAskSageResponseText(data);
    },

    extractModelNamesFromResponse(payload) {
        const out = [];
        const seen = new Set();
        const add = (value) => {
            const v = String(value || '').trim().toLowerCase();
            if (!v || seen.has(v)) return;
            seen.add(v);
            out.push(v);
        };
        const process = (item) => {
            if (!item) return;
            if (typeof item === 'string') return add(item);
            if (typeof item === 'object') add(item.model || item.name || item.id || item.slug || item.value || item.label);
        };
        if (Array.isArray(payload)) payload.forEach(process);
        if (payload && typeof payload === 'object') {
            if (Array.isArray(payload.models)) payload.models.forEach(process);
            if (Array.isArray(payload.data)) payload.data.forEach(process);
            if (Array.isArray(payload.response)) payload.response.forEach(process);
            if (typeof payload.response === 'string') add(payload.response);
        }
        return out;
    },

    async fetchAskSageModels(apiKeyOverride, providerId) {
        const data = await this.callSageApi({ path: '/get-models', base: 'server', body: {}, providerId: providerId }, apiKeyOverride);
        return this.extractModelNamesFromResponse(data);
    },

    extractTokenCount(payload, depth) {
        const level = Number(depth || 0);
        if (payload == null || level > 6) return null;
        if (typeof payload === 'number' && Number.isFinite(payload)) return payload;
        if (typeof payload === 'string') {
            const n = Number(payload.replace(/,/g, '').trim());
            if (Number.isFinite(n)) return n;
        }
        if (Array.isArray(payload)) {
            for (const item of payload) {
                const found = this.extractTokenCount(item, level + 1);
                if (found != null) return found;
            }
            return null;
        }
        if (typeof payload === 'object') {
            const keys = ['tokens_used', 'tokens', 'token_count', 'tokenCount', 'total_tokens', 'totalTokens', 'usage', 'count', 'total', 'value'];
            for (const key of keys) {
                if (Object.prototype.hasOwnProperty.call(payload, key)) {
                    const found = this.extractTokenCount(payload[key], level + 1);
                    if (found != null) return found;
                }
            }
            const wrappers = ['response', 'data', 'result', 'payload'];
            for (const key of wrappers) {
                if (Object.prototype.hasOwnProperty.call(payload, key)) {
                    const found = this.extractTokenCount(payload[key], level + 1);
                    if (found != null) return found;
                }
            }
        }
        return null;
    },

    async fetchAskSageTokenCount(path, apiKeyOverride) {
        const data = await this.callSageApi({ path: path, method: 'GET', base: 'server' }, apiKeyOverride);
        const count = this.extractTokenCount(data, 0);
        if (count == null) throw new Error('Token count missing in response');
        return count;
    },

    async fetchAskSageTokenUsageSnapshot(apiKeyOverride) {
        const [inference, training] = await Promise.all([
            this.fetchAskSageTokenCount('/count-monthly-tokens', apiKeyOverride),
            this.fetchAskSageTokenCount('/count-monthly-teach-tokens', apiKeyOverride)
        ]);
        return { inference: inference, training: training };
    },

    async fetchTokenCount(path, apiKeyOverride) {
        return this.fetchAskSageTokenCount(path, apiKeyOverride);
    },

    async fetchTokenUsageSnapshot(apiKeyOverride) {
        return this.fetchAskSageTokenUsageSnapshot(apiKeyOverride);
    },

    filterModelsByEndpoint() {
        // Legacy compat �" now handled by selectProvider()
        this.selectProvider();
    },

    _onModelChange() {
        this._syncCustomField();
        this._updateModelInfo();
    },

    _syncCustomField() {
        const select = document.getElementById('ai-model-select');
        const customInput = document.getElementById('ai-model-custom');
        if (!select || !customInput) return;
        customInput.style.display = select.value === 'custom' ? '' : 'none';
    },

    _getModelInfo(modelId) {
        if (!modelId) return null;
        for (const p of Object.values(this.PROVIDERS)) {
            const m = p.models.find(m => m.value === modelId);
            if (m) return { ...m, rateLimit: p.rateLimit, providerName: p.name };
        }
        return null;
    },

    _formatTokenCount(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
        return String(n);
    },

    _updateModelInfo() {
        const infoEl = document.getElementById('ai-model-info');
        if (!infoEl) return;
        const select = document.getElementById('ai-model-select');
        const modelId = select?.value;
        if (!modelId || modelId === 'custom') {
            infoEl.style.display = 'none';
            return;
        }
        const info = this._getModelInfo(modelId);
        if (!info) { infoEl.style.display = 'none'; return; }
        const parts = [];
        if (info.context) parts.push('Context: ' + this._formatTokenCount(info.context));
        if (info.maxOutput) parts.push('Max output: ' + this._formatTokenCount(info.maxOutput));
        if (info.rateLimit) parts.push('Rate: ' + info.rateLimit);
        infoEl.textContent = parts.join(' \u2022 ');
        infoEl.style.display = parts.length ? '' : 'none';
    },

    getEffectiveModel() {
        const profile = this.getActiveProfile();
        const select = document.getElementById('ai-model-select');
        if (select?.value === 'custom') {
            return document.getElementById('ai-model-custom')?.value.trim() || 'custom';
        }
        return profile?.model || '';
    },

    // ══════════════════════════════════════════════════════════════════
    //  API FORMAT DETECTION & ENDPOINT RESOLUTION
    // ══════════════════════════════════════════════════════════════════

    _detectFormat() {
        if (this._apiFormat) return this._apiFormat;
        const profile = this.getActiveProfile();
        if (profile?.format) { this._apiFormat = profile.format; return this._apiFormat; }
        // Detect from provider field
        const providerId = profile?.provider;
        if (providerId && this.PROVIDERS[providerId]) {
            this._apiFormat = this.PROVIDERS[providerId].format;
            return this._apiFormat;
        }
        // Fallback: detect from endpoint
        const ep = (profile?.endpoint || '').toLowerCase();
        if (ep.includes('anthropic') || ep.includes('/v1/messages')) {
            this._apiFormat = 'anthropic';
        } else if (ep.includes('generativelanguage.googleapis.com')) {
            this._apiFormat = 'google';
        } else if (ep.includes('api.capra.flankspeed.us.navy.mil') || ep.includes('api.genai.army.mil')) {
            this._apiFormat = 'asksage';
        } else {
            this._apiFormat = 'openai';
        }
        return this._apiFormat;
    },

    _getApiUrl(streaming) {
        const profile = this.getActiveProfile();
        if (!profile) return '';
        const fmt = this._detectFormat();
        if (fmt === 'asksage') {
            const providerCfg = this._getAskSageProviderConfig(profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint)) || this.PROVIDERS.asksage;
            return profile.queryEndpoint || profile.endpoint || providerCfg?.queryEndpoint || this.PROVIDERS.asksage.queryEndpoint;
        }
        if (fmt === 'google') {
            // Google Gemini needs model in URL: /v1beta/models/{model}:generateContent
            let ep = profile.endpoint.replace(/\/+$/, '');
            const model = this.getEffectiveModel();
            if (!ep.includes(':generateContent') && !ep.includes(':streamGenerateContent')) {
                if (!ep.includes('/models/')) {
                    ep += '/v1beta/models/' + model;
                }
                ep += streaming ? ':streamGenerateContent?alt=sse' : ':generateContent';
            }
            return ep;
        }
        return profile.endpoint;
    },

    // ══════════════════════════════════════════════════════════════════
    //  TOOL DEFINITIONS �" Format-agnostic, converted per provider
    // ══════════════════════════════════════════════════════════════════

    _toolDefs() {
        return [
            {
                name: 'listFiles',
                description: 'List all files in the project directory tree. Returns one file path per line.',
                params: {},
                required: []
            },
            {
                name: 'readFile',
                description: 'Read a file with line numbers. If startLine/endLine are omitted and the file is 2000 lines or less, returns the entire file by default. For larger files, pass startLine/endLine to read a range. Read before modifying, but do not repeat an identical read unless prior content was compacted or the file changed.',
                params: {
                    path: { type: 'string', description: 'File path relative to project root (e.g. "js/app.js", "index.html")' },
                    startLine: { type: 'integer', description: 'First line to read (1-based). Omit to start from beginning.' },
                    endLine: { type: 'integer', description: 'Last line to read (inclusive). Omit to read to end (capped at 2000 lines per call).' }
                },
                required: ['path']
            },
            {
                name: 'writeFile',
                description: 'Overwrite an existing file with new content. User will be shown a diff and asked to approve. You MUST readFile first.',
                params: {
                    path: { type: 'string', description: 'File path to overwrite' },
                    content: { type: 'string', description: 'Complete new file content' }
                },
                required: ['path', 'content']
            },
            {
                name: 'createFile',
                description: 'Create a new file that does not exist yet. User will be asked to approve.',
                params: {
                    path: { type: 'string', description: 'New file path to create' },
                    content: { type: 'string', description: 'File content' }
                },
                required: ['path', 'content']
            },
            {
                name: 'deleteFile',
                description: 'Delete a file. User will be asked to confirm. Use with caution.',
                params: {
                    path: { type: 'string', description: 'File path to delete' }
                },
                required: ['path']
            },
            {
                name: 'searchFiles',
                description: 'Search file contents with regex. Returns matching lines as "file:line: content". Max 25 results. Use when you need to find a specific string across the project.',
                params: {
                    pattern: { type: 'string', description: 'Regex pattern. For multiple patterns, separate with newlines or pass a JSON array string.' },
                    patterns: { type: 'string', description: 'Optional extra patterns as newline-delimited text or JSON array string.' },
                    fileGlob: { type: 'string', description: 'Optional file extension filter (e.g. "js", "html", "css")' }
                },
                required: []
            },
            {
                name: 'replaceInFile',
                description: 'Find exact text in a file and replace it, or provide a unified diff in diff for targeted edits. Prefer this over writeFile for targeted edits. User will be shown a diff.',
                params: {
                    path: { type: 'string', description: 'File path' },
                    find: { type: 'string', description: 'Exact text to find (must match exactly, including whitespace)' },
                    replace: { type: 'string', description: 'Replacement text' },
                    diff: { type: 'string', description: 'Optional unified diff hunk(s) for this file. Use when exact find/replace would be too large or brittle.' }
                },
                required: ['path', 'find', 'replace']
            },
            {
                name: 'getActiveFile',
                description: 'Get the path and content of the file currently open in the editor.',
                params: {},
                required: []
            },
            {
                name: 'getProjectInfo',
                description: 'Get project name, total file count, open files, and active file.',
                params: {},
                required: []
            },
            {
                name: 'createCheckpoint',
                description: 'Create a named snapshot of all project files. Use before making large or risky changes.',
                params: {
                    name: { type: 'string', description: 'Checkpoint name (optional)' }
                },
                required: []
            },
            {
                name: 'updatePlan',
                description: 'Create or update a structured task plan. Use for tasks involving 3+ steps. Each item has a status: pending, in_progress, or completed. Update status as you work through items.',
                params: {
                    plan: { type: 'string', description: 'JSON array of {task, status} objects. status must be "pending", "in_progress", or "completed".' }
                },
                required: ['plan']
            },
            {
                name: 'saveProjectNote',
                description: 'Save a note about this project for future sessions. Use to record architecture decisions, conventions, or important context that should persist across conversations.',
                params: {
                    content: { type: 'string', description: 'Note content (markdown). Replaces any existing project notes.' }
                },
                required: ['content']
            },
            {
                name: 'readCsv',
                description: 'Read a CSV file and return its contents as a formatted text table. Handles quoting and delimiters automatically.',
                params: {
                    path: { type: 'string', description: 'CSV file path relative to project root' },
                    maxRows: { type: 'integer', description: 'Maximum rows to return (default 200). Use to limit output for large files.' }
                },
                required: ['path']
            },
            {
                name: 'readXlsx',
                description: 'Read an Excel (.xlsx/.xls) file and return sheet contents as text. Requires the SheetJS library.',
                params: {
                    path: { type: 'string', description: 'Excel file path relative to project root' },
                    sheet: { type: 'string', description: 'Sheet name to read (default: first sheet)' },
                    maxRows: { type: 'integer', description: 'Maximum rows to return (default 200).' }
                },
                required: ['path']
            },
            {
                name: 'readDocx',
                description: 'Read a Word (.docx) file and return its text content. Requires the Mammoth.js library.',
                params: {
                    path: { type: 'string', description: 'DOCX file path relative to project root' }
                },
                required: ['path']
            },
            {
                name: 'readPdf',
                description: 'Read a PDF file and return its text content. Requires the PDF.js library.',
                params: {
                    path: { type: 'string', description: 'PDF file path relative to project root' },
                    maxPages: { type: 'integer', description: 'Maximum pages to extract (default: all).' }
                },
                required: ['path']
            }
        ];
    },

    _getToolDefinitions() {
        const fmt = this._detectFormat();
        const tools = this._toolDefs();

        if (fmt === 'anthropic') {
            return tools.map(t => ({
                name: t.name,
                description: t.description,
                input_schema: { type: 'object', properties: t.params, required: t.required }
            }));
        }

        if (fmt === 'google') {
            // Google Gemini uses functionDeclarations format
            return [{
                functionDeclarations: tools.map(t => ({
                    name: t.name,
                    description: t.description,
                    parameters: {
                        type: 'OBJECT',
                        properties: Object.fromEntries(
                            Object.entries(t.params).map(([k, v]) => [k, { type: v.type.toUpperCase(), description: v.description }])
                        ),
                        required: t.required
                    }
                }))
            }];
        }

        // OpenAI format (also works for Mistral, DeepSeek, xAI, etc.)
        return tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: { type: 'object', properties: t.params, required: t.required }
            }
        }));
    },

    // ══════════════════════════════════════════════════════════════════
    //  TOOL EXECUTION �" With read-tracking and actionable errors
    // ══════════════════════════════════════════════════════════════════

    async _executeTool(name, args) {
        try {
            if (window.athenaCompat && typeof window.athenaCompat.syncState === 'function') {
                window.athenaCompat.syncState();
            }
            this._refreshProjectCacheState();
            // Plan mode: intercept file-modifying tools
            if (this._planMode) {
                var WRITE_TOOLS = { writeFile: 1, createFile: 1, deleteFile: 1, replaceInFile: 1 };
                if (WRITE_TOOLS[name]) {
                    var planPath = this._normalizeToolPath(args.path) || args.path || '(unknown)';
                    var planDescs = {
                        writeFile: 'Would overwrite file: ' + planPath,
                        createFile: 'Would create new file: ' + planPath,
                        deleteFile: 'Would delete file: ' + planPath,
                        replaceInFile: 'Would replace text in: ' + planPath
                    };
                    return '[Plan mode] ' + planDescs[name] + '. Change noted but NOT applied.';
                }
            }

            switch (name) {
                case 'listFiles': {
                    const paths = Object.keys(fileHandles);
                    if (!paths.length) return 'No files loaded. Ask the user to open a project directory first.';
                    if (paths.length <= 100) return paths.join('\n');
                    // Large project: group by top-level directory
                    const grouped = {};
                    for (const p of paths) {
                        const slash = p.indexOf('/');
                        const dir = slash === -1 ? '.' : p.slice(0, slash);
                        if (!grouped[dir]) grouped[dir] = [];
                        grouped[dir].push(p);
                    }
                    const lines = [];
                    for (const [dir, files] of Object.entries(grouped)) {
                        if (dir === '.') { lines.push(...files); continue; }
                        if (files.length <= 10) { lines.push(...files); continue; }
                        lines.push(dir + '/ (' + files.length + ' files)');
                        lines.push(...files.slice(0, 8));
                        lines.push('  ... +' + (files.length - 8) + ' more in ' + dir + '/');
                    }
                    return lines.join('\n') + '\n\n[' + paths.length + ' files total. Use searchFiles to find specific files by content.]';
                }

                case 'readFile': {
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path "' + String(args.path || '') + '". Paths must be relative (e.g. "index.html", "js/app.js").';
                    if (!fileHandles[safePath]) {
                        const available = Object.keys(fileHandles);
                        const suggestions = available.filter(p => p.includes(safePath.split('/').pop() || '')).slice(0, 5);
                        return 'Error: File not found: "' + safePath + '".' +
                            (suggestions.length ? ' Did you mean: ' + suggestions.join(', ') + '?' : ' Use listFiles to see available files.');
                    }
                    try {
                        const hasExplicitStart = args.startLine !== undefined && args.startLine !== null && String(args.startLine).trim() !== '';
                        const hasExplicitEnd = args.endLine !== undefined && args.endLine !== null && String(args.endLine).trim() !== '';
                        const requestedStart = Math.max(1, parseInt(args.startLine) || 1);
                        const requestedEnd = hasExplicitEnd ? Math.max(requestedStart, parseInt(args.endLine) || requestedStart) : null;
                        const rangeKey = hasExplicitStart || hasExplicitEnd
                            ? (requestedStart + '-' + (requestedEnd == null ? 'auto' : requestedEnd))
                            : 'default';
                        const previousRead = this._readFileResultMeta[safePath];
                        if (previousRead
                            && previousRead.rev === this._cacheRev
                            && previousRead.compactionSeq === this._contextCompactionSeq
                            && previousRead.rangeKey === rangeKey
                            && this._readFiles.has(safePath)) {
                            return 'Cached readFile result: "' + safePath + '" ' + previousRead.label + ' was already returned earlier in this run. Use that prior content; call readFile with startLine/endLine only for a different range, after compaction, or after the file changes.';
                        }

                        const content = await this._readFileWithCache(safePath);
                        this._readFiles.add(safePath);
                        const allLines = content.split('\n');
                        const totalLines = allLines.length;
                        const MAX_LINES = 2000;
                        const MAX_BYTES = 50 * 1024; // 50 KB cap per read (matches OpenCode)
                        const MAX_LINE_LEN = 2000;
                        const start = Math.max(1, parseInt(args.startLine) || 1);
                        const shouldReadWholeFileByDefault = !hasExplicitStart && !hasExplicitEnd && totalLines <= MAX_LINES;
                        let end = shouldReadWholeFileByDefault
                            ? totalLines
                            : Math.min(totalLines, parseInt(args.endLine) || (start + MAX_LINES - 1));
                        // Byte-cap: stop early if accumulated bytes exceed MAX_BYTES
                        let bytes = 0;
                        let truncatedByBytes = false;
                        const enforceByteCap = !shouldReadWholeFileByDefault;
                        const numbered = [];
                        for (let idx = start - 1; idx < end; idx++) {
                            let line = allLines[idx];
                            if (line.length > MAX_LINE_LEN) line = line.slice(0, MAX_LINE_LEN) + '... (line truncated)';
                            const lineBytes = line.length + 1; // rough byte estimate
                            if (enforceByteCap && bytes + lineBytes > MAX_BYTES && numbered.length > 0) {
                                truncatedByBytes = true;
                                end = idx; // adjust end for the message
                                break;
                            }
                            bytes += lineBytes;
                            numbered.push((idx + 1) + '| ' + line);
                        }
                        const result = numbered.join('\n');
                        const rememberRead = (text) => {
                            this._readFileResultMeta[safePath] = {
                                rev: this._cacheRev,
                                compactionSeq: this._contextCompactionSeq,
                                rangeKey: rangeKey,
                                label: 'lines ' + start + '-' + end + ' of ' + totalLines,
                                length: String(text || '').length
                            };
                            return text;
                        };
                        if (truncatedByBytes) {
                            return rememberRead(result + '\n\n[Output capped at 50 KB. Showing lines ' + start + '-' + end + ' of ' + totalLines + '. Call readFile with startLine=' + (end + 1) + ' to continue.]');
                        }
                        if (end < totalLines) {
                            return rememberRead(result + '\n\n[Showing lines ' + start + '-' + end + ' of ' + totalLines + '. Call readFile with startLine=' + (end + 1) + ' to see more.]');
                        }
                        return rememberRead(result);
                    } catch (e) {
                        return 'Error reading file "' + safePath + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'writeFile': {
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    const handle = fileHandles[safePath];
                    if (!handle) return 'Error: File not found: "' + safePath + '". Use createFile for new files.';
                    if (!this._readFiles.has(safePath)) {
                        return 'Warning: You have not read "' + safePath + '" yet. Please use readFile first to understand the current content before overwriting.';
                    }
                    try {
                        await this._ensureCheckpoint();
                        const newContent = typeof args.content === 'string' ? args.content : String(args.content ?? '');
                        const oldContent = await this._readFileWithCache(safePath);
                        const approvalResult = await this._requestApproval(safePath, oldContent, newContent);
                        const approved = approvalResult && (approvalResult === true || approvalResult.accepted);
                        const finalContent = (approvalResult && approvalResult.content != null) ? approvalResult.content : newContent;
                        if (!approved) return 'User rejected this file change. Ask the user what they would prefer or try a different approach.';
                        await writeFileToHandle(handle, finalContent, safePath);
                        this._syncEditor(safePath, finalContent);
                        this._markProjectMutated(safePath);
                        this._setCachedFile(safePath, finalContent);
                        markUnsaved(safePath);
                        return 'File written successfully: ' + safePath;
                    } catch (e) {
                        return 'Error writing file "' + safePath + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'createFile': {
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    if (fileHandles[safePath]) return 'Error: File already exists: "' + safePath + '". Use writeFile to overwrite.';
                    try {
                        await this._ensureCheckpoint();
                        const newContent = typeof args.content === 'string' ? args.content : String(args.content ?? '');
                        const createResult = await this._requestApproval(safePath, null, newContent);
                        const createApproved = createResult && (createResult === true || createResult.accepted);
                        const createContent = (createResult && createResult.content != null) ? createResult.content : newContent;
                        if (!createApproved) return 'User rejected file creation. Ask what they would prefer.';
                        await writeNewFile(safePath, createContent);
                        this._markProjectMutated();
                        this._setCachedFile(safePath, createContent);
                        if (fileHandles[safePath]) {
                            await openFile(safePath);
                        }
                        return 'Created file: ' + safePath;
                    } catch (e) {
                        return 'Error creating file "' + safePath + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'deleteFile': {
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    const handle = fileHandles[safePath];
                    if (!handle) return 'Error: File not found: "' + safePath + '".';
                    try {
                        await this._ensureCheckpoint();
                        const ok = confirm('Prometheus wants to delete "' + safePath + '". Allow?');
                        if (!ok) return 'User rejected file deletion.';
                        const parts = safePath.split('/');
                        let parent = dirHandle;
                        for (let i = 0; i < parts.length - 1; i++) parent = await parent.getDirectoryHandle(parts[i]);
                        await parent.removeEntry(parts[parts.length - 1]);
                        closeTab(safePath);
                        delete fileHandles[safePath];
                        await refreshFileTree();
                        this._markProjectMutated(safePath);
                        return 'Deleted: ' + safePath;
                    } catch (e) {
                        return 'Error deleting file "' + safePath + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'searchFiles': {
                    try {
                        await this._ensureSmallProjectSnapshot();
                        const patterns = this._parseSearchPatterns(args);
                        if (!patterns.length) {
                            return 'Error: Provide at least one regex in pattern or patterns.';
                        }
                        const regexes = [];
                        for (const p of patterns) {
                            try {
                                regexes.push(new RegExp(p, 'gi'));
                            } catch (e) {
                                return 'Error: Invalid regex "' + p + '": ' + e.message;
                            }
                        }
                        const ext = args.fileGlob ? args.fileGlob.replace(/^\*?\.?/, '').toLowerCase() : null;
                        const cacheKey = (ext || '*') + '::' + patterns.join('\u0001');
                        const cached = this._searchCache[cacheKey];
                        if (cached && cached.rev === this._cacheRev) {
                            return cached.result;
                        }

                        const results = [];
                        const seenLines = new Set();
                        for (const path of Object.keys(fileHandles)) {
                            if (ext && !path.toLowerCase().endsWith('.' + ext)) continue;
                            const content = await this._readFileWithCache(path);
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                const line = lines[i];
                                let matched = false;
                                for (const re of regexes) {
                                    if (re.test(line)) {
                                        matched = true;
                                        break;
                                    }
                                    re.lastIndex = 0;
                                }
                                for (const re of regexes) re.lastIndex = 0;
                                if (!matched) continue;

                                const lineKey = path + ':' + (i + 1);
                                if (seenLines.has(lineKey)) continue;
                                seenLines.add(lineKey);
                                const trimmed = line.trim().length > 150 ? line.trim().slice(0, 150) + '...' : line.trim();
                                results.push(path + ':' + (i + 1) + ': ' + trimmed);
                                if (results.length >= 25) break;
                            }
                            if (results.length >= 25) break;
                        }
                        let resultText;
                        if (results.length) {
                            const uniqueFiles = [...new Set(results.map(r => r.split(':')[0]))];
                            resultText = results.join('\n')
                                + '\n\n� Found in: ' + uniqueFiles.join(', ')
                                + '. Read only the relevant file you have not already read, then edit it. Do not search again.';
                        } else {
                            resultText = 'No matches found for pattern(s): "' + patterns.join(' | ') + '".';
                        }
                        this._searchCache[cacheKey] = { rev: this._cacheRev, result: resultText };
                        return resultText;
                    } catch (e) {
                        return 'Error searching files: ' + (e.message || 'Unknown error');
                    }
                }

                case 'replaceInFile': {
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    const findText = typeof args.find === 'string' ? args.find : String(args.find ?? '');
                    const replaceText = typeof args.replace === 'string' ? args.replace : String(args.replace ?? '');
                    const diffText = typeof args.diff === 'string' ? args.diff : String(args.diff ?? '');
                    const handle = fileHandles[safePath];
                    if (!handle) return 'Error: File not found: "' + safePath + '".';
                    try {
                        const content = await this._readFileWithCache(safePath);
                        if (!findText && diffText.trim()) {
                            const patchResult = this._applyUnifiedDiffToContent(content, diffText, { path: safePath });
                            if (!patchResult.ok) {
                                return 'Error applying unified diff in ' + safePath + ': ' + patchResult.reason
                                    + ' ACTION REQUIRED: Call readFile on "' + safePath + '" and then use writeFile with full updated content.';
                            }
                            const newContentFromDiff = String(patchResult.content || '');
                            await this._ensureCheckpoint();
                            const diffApproval = await this._requestApproval(safePath, content, newContentFromDiff);
                            const diffApproved = diffApproval && (diffApproval === true || diffApproval.accepted);
                            const diffContent = (diffApproval && diffApproval.content != null) ? diffApproval.content : newContentFromDiff;
                            if (!diffApproved) return 'User rejected this replacement.';
                            await writeFileToHandle(handle, diffContent, safePath);
                            this._syncEditor(safePath, diffContent);
                            this._markProjectMutated(safePath);
                            markUnsaved(safePath);
                            try {
                                const actual = await this._readFileFromHandle(safePath);
                                this._setCachedFile(safePath, actual);
                            } catch (_) {
                                this._setCachedFile(safePath, diffContent);
                            }
                            return 'Applied unified diff (' + patchResult.applied + '/' + patchResult.total + ' hunks) in ' + safePath;
                        }
                        if (!findText) return 'Error: find text is required.';
                        let newContent;
                        let matchStrategy = 'exact';
                        if (content.includes(findText)) {
                            newContent = content.split(findText).join(replaceText);
                        } else {
                            // Fuzzy replacer chain — try multiple strategies before giving up
                            const fuzzy = this._fuzzyReplace(content, findText, replaceText);
                            if (fuzzy) {
                                newContent = fuzzy.content;
                                matchStrategy = fuzzy.strategy;
                            } else {
                                const firstLine = findText.split('\n')[0].trim();
                                const nearLines = content.split('\n').filter(l => l.includes(firstLine.slice(0, 30))).slice(0, 3);
                                return 'Error: Exact text not found in ' + safePath + '. The find text must match the file EXACTLY (including whitespace and indentation). ' +
                                    (nearLines.length ? 'Similar lines found:\n' + nearLines.join('\n') + '\n' : '') +
                                    'ACTION REQUIRED: Call readFile on "' + safePath + '" to see the current content, then retry replaceInFile with the exact text from the file.';
                            }
                        }
                        await this._ensureCheckpoint();
                        const replaceResult = await this._requestApproval(safePath, content, newContent);
                        const replaceApproved = replaceResult && (replaceResult === true || replaceResult.accepted);
                        const replaceContent = (replaceResult && replaceResult.content != null) ? replaceResult.content : newContent;
                        if (!replaceApproved) return 'User rejected this replacement.';
                        await writeFileToHandle(handle, replaceContent, safePath);
                        this._syncEditor(safePath, replaceContent);
                        this._markProjectMutated(safePath);
                        markUnsaved(safePath);
                        const strategyNote = matchStrategy !== 'exact' ? ' (fuzzy match: ' + matchStrategy + ')' : '';
                        // Post-edit verification: re-read from handle to catch merge editor edits
                        try {
                            const actual = await this._readFileFromHandle(safePath);
                            this._setCachedFile(safePath, actual);
                            if (actual !== replaceContent) {
                                return 'Replaced in ' + safePath + strategyNote + ' (note: content was modified during review).';
                            }
                        } catch (_) {
                            this._setCachedFile(safePath, replaceContent);
                        }
                        return 'Replaced in ' + safePath + strategyNote + '.';
                    } catch (e) {
                        return 'Error replacing in file "' + safePath + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'getActiveFile': {
                    const currentActive = (window.athenaCompat && typeof window.athenaCompat.getActiveFilePath === 'function')
                        ? window.athenaCompat.getActiveFilePath()
                        : activeFile;
                    if (!currentActive) return 'No file is currently active in the editor. Use listFiles to see available files.';
                    try {
                        const content = await this._readFileWithCache(currentActive);
                        this._readFiles.add(currentActive);
                        const allLines = content.split('\n');
                        const MAX_LINES = 500;
                        const slice = allLines.slice(0, MAX_LINES);
                        const numbered = slice.map((l, i) => (i + 1) + '| ' + l).join('\n');
                        const result = 'Active file: ' + currentActive + ' (' + allLines.length + ' lines)\n\n' + numbered;
                        if (allLines.length > MAX_LINES) {
                            return result + '\n\n[Showing lines 1-' + MAX_LINES + ' of ' + allLines.length + '. Use readFile with startLine=' + (MAX_LINES + 1) + ' to see more.]';
                        }
                        return result;
                    } catch (e) {
                        return 'Error reading active file "' + currentActive + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'getProjectInfo': {
                    const name = dirHandle ? dirHandle.name : 'No project loaded';
                    const count = Object.keys(fileHandles).length;
                    const open = (window.athenaCompat && typeof window.athenaCompat.getOpenFilePaths === 'function')
                        ? window.athenaCompat.getOpenFilePaths().join(', ')
                        : openFiles.map(f => f.path).join(', ');
                    const currentActive = (window.athenaCompat && typeof window.athenaCompat.getActiveFilePath === 'function')
                        ? window.athenaCompat.getActiveFilePath()
                        : activeFile;
                    return 'Project: ' + name + '\nTotal files: ' + count + '\nOpen files: ' + (open || 'none') + '\nActive: ' + (currentActive || 'none');
                }

                case 'createCheckpoint': {
                    if (!dirHandle) return 'No project loaded.';
                    try {
                        const cpName = args.name || 'Prometheus checkpoint';
                        const ok = await checkpointManager.createAutoCheckpoint(cpName);
                        return ok ? 'Checkpoint created: ' + cpName : 'Failed to create checkpoint.';
                    } catch (e) {
                        return 'Error creating checkpoint: ' + (e.message || 'Unknown error');
                    }
                }

                case 'updatePlan': {
                    try {
                        const items = JSON.parse(args.plan);
                        if (!Array.isArray(items)) return 'Error: plan must be a JSON array of {task, status} objects.';
                        this._currentPlan = items.map(item => ({
                            task: String(item.task || ''),
                            status: ['pending', 'in_progress', 'completed'].includes(item.status) ? item.status : 'pending'
                        }));
                        this._renderPlanUI();
                        const done = this._currentPlan.filter(i => i.status === 'completed').length;
                        const total = this._currentPlan.length;
                        return 'Plan updated: ' + done + '/' + total + ' tasks completed.';
                    } catch (e) {
                        return 'Error parsing plan JSON: ' + (e.message || 'Invalid JSON');
                    }
                }

                case 'saveProjectNote': {
                    if (!dirHandle) return 'No project loaded.';
                    const noteContent = String(args.content || '');
                    if (!noteContent.trim()) return 'Error: content is required.';
                    try {
                        const athenaDir = await dirHandle.getDirectoryHandle('.athena', { create: true });
                        const noteHandle = await athenaDir.getFileHandle('notes.md', { create: true });
                        const writable = await noteHandle.createWritable();
                        await writable.write(noteContent);
                        await writable.close();
                        // Register in fileHandles so it's accessible
                        fileHandles['.athena/notes.md'] = noteHandle;
                        this._setCachedFile('.athena/notes.md', noteContent);
                        return 'Project notes saved to .athena/notes.md. These will be loaded automatically in future sessions.';
                    } catch (e) {
                        return 'Error saving project note: ' + (e.message || 'Unknown error');
                    }
                }

                // -- Document readers (CSV, XLSX, DOCX, PDF) --------------
                case 'readCsv': {
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    if (!fileHandles[safePath]) return 'Error: File not found: "' + safePath + '". Use listFiles to see available files.';
                    try {
                        const handle = fileHandles[safePath];
                        const file = await handle.getFile();
                        const text = await file.text();
                        const maxRows = parseInt(args.maxRows, 10) || 200;
                        // Simple CSV parser that handles quoted fields
                        const rows = [];
                        let current = '';
                        let inQuotes = false;
                        const row = [];
                        for (let i = 0; i < text.length; i++) {
                            const ch = text[i];
                            if (inQuotes) {
                                if (ch === '"' && text[i + 1] === '"') { current += '"'; i++; }
                                else if (ch === '"') inQuotes = false;
                                else current += ch;
                            } else {
                                if (ch === '"') inQuotes = true;
                                else if (ch === ',') { row.push(current); current = ''; }
                                else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
                                    if (ch === '\r') i++;
                                    row.push(current); current = '';
                                    rows.push([...row]); row.length = 0;
                                    if (rows.length > maxRows) break;
                                } else current += ch;
                            }
                        }
                        if (row.length || current) { row.push(current); rows.push(row); }
                        if (rows.length === 0) return 'CSV file is empty.';
                        // Format as aligned text table
                        const header = rows[0];
                        const dataRows = rows.slice(1, maxRows + 1);
                        const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
                        for (const r of dataRows) lines.push(r.join(' | '));
                        const result = lines.join('\n');
                        const truncNote = rows.length > maxRows ? '\n\n[Showing first ' + maxRows + ' of ' + rows.length + ' rows. Use maxRows to see more.]' : '';
                        return result + truncNote;
                    } catch (e) {
                        return 'Error reading CSV: ' + (e.message || 'Unknown error');
                    }
                }

                case 'readXlsx': {
                    if (typeof XLSX === 'undefined') return 'Error: SheetJS (XLSX) library is not loaded. The user needs to include the SheetJS CDN script.';
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    if (!fileHandles[safePath]) return 'Error: File not found: "' + safePath + '". Use listFiles to see available files.';
                    try {
                        const handle = fileHandles[safePath];
                        const file = await handle.getFile();
                        const ab = await file.arrayBuffer();
                        const workbook = XLSX.read(ab, { type: 'array' });
                        const sheetName = args.sheet || workbook.SheetNames[0];
                        const sheet = workbook.Sheets[sheetName];
                        if (!sheet) return 'Error: Sheet "' + sheetName + '" not found. Available sheets: ' + workbook.SheetNames.join(', ');
                        const maxRows = parseInt(args.maxRows, 10) || 200;
                        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                        const rows = jsonData.slice(0, maxRows + 1);
                        if (rows.length === 0) return 'Sheet is empty.';
                        const header = rows[0].map(c => String(c));
                        const dataRows = rows.slice(1);
                        const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
                        for (const r of dataRows) lines.push(r.map(c => String(c)).join(' | '));
                        const result = 'Sheet: ' + sheetName + ' (' + workbook.SheetNames.length + ' sheets total)\n\n' + lines.join('\n');
                        const truncNote = jsonData.length > maxRows + 1 ? '\n\n[Showing first ' + maxRows + ' of ' + (jsonData.length - 1) + ' data rows.]' : '';
                        return result + truncNote;
                    } catch (e) {
                        return 'Error reading Excel file: ' + (e.message || 'Unknown error');
                    }
                }

                case 'readDocx': {
                    if (typeof mammoth === 'undefined') return 'Error: Mammoth.js library is not loaded. The user needs to include the Mammoth CDN script.';
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    if (!fileHandles[safePath]) return 'Error: File not found: "' + safePath + '". Use listFiles to see available files.';
                    try {
                        const handle = fileHandles[safePath];
                        const file = await handle.getFile();
                        const ab = await file.arrayBuffer();
                        const result = await mammoth.extractRawText({ arrayBuffer: ab });
                        const text = (result.value || '').trim();
                        if (!text) return 'Document is empty (no text content extracted).';
                        if (text.length > 50000) {
                            return text.slice(0, 50000) + '\n\n[Truncated � showing first 50,000 of ' + text.length + ' characters.]';
                        }
                        return text;
                    } catch (e) {
                        return 'Error reading DOCX: ' + (e.message || 'Unknown error');
                    }
                }

                case 'readPdf': {
                    if (typeof pdfjsLib === 'undefined') return 'Error: PDF.js library is not loaded. The user needs to include the PDF.js CDN script.';
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    if (!fileHandles[safePath]) return 'Error: File not found: "' + safePath + '". Use listFiles to see available files.';
                    try {
                        const handle = fileHandles[safePath];
                        const file = await handle.getFile();
                        const ab = await file.arrayBuffer();
                        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
                        const maxPages = parseInt(args.maxPages, 10) || pdf.numPages;
                        const pagesToRead = Math.min(maxPages, pdf.numPages);
                        const texts = [];
                        for (let i = 1; i <= pagesToRead; i++) {
                            const page = await pdf.getPage(i);
                            const content = await page.getTextContent();
                            const pageText = content.items.map(item => item.str).join(' ');
                            texts.push('--- Page ' + i + ' ---\n' + pageText);
                        }
                        const result = texts.join('\n\n');
                        if (!result.trim()) return 'PDF has no extractable text (may be scanned/image-based).';
                        const truncNote = pagesToRead < pdf.numPages ? '\n\n[Showing ' + pagesToRead + ' of ' + pdf.numPages + ' pages. Use maxPages to read more.]' : '';
                        return result + truncNote;
                    } catch (e) {
                        return 'Error reading PDF: ' + (e.message || 'Unknown error');
                    }
                }

                default:
                    return 'Error: Unknown tool "' + name + '". Available tools: ' + this._toolDefs().map(t => t.name).join(', ');
            }
        } catch (e) {
            return 'Tool error (' + name + '): ' + (e.message || 'Unknown error');
        }
    },

    _renderPlanUI() {
        var host = document.getElementById('right-panel-content');
        var messagesEl = document.getElementById('ai-chat-messages');
        if (!host || !messagesEl) return;

        var hasPlan = Array.isArray(this._currentPlan) && this._currentPlan.length > 0;
        var gate = this._pendingPlanGate;
        var hasGate = !!gate;
        var el = document.getElementById('athena-plan-bar');

        if (!hasPlan && !hasGate) {
            this._planUiExpanded = false;
            if (el) el.remove();
            return;
        }

        if (!el) {
            el = document.createElement('div');
            el.id = 'athena-plan-bar';
            el.className = 'athena-plan-bar';
            host.insertBefore(el, messagesEl);
        }

        var done = hasPlan ? this._currentPlan.filter(function (i) { return i.status === 'completed'; }).length : 0;
        var total = hasPlan ? this._currentPlan.length : 0;
        var summary = hasPlan
            ? (done + '/' + total + ' completed')
            : (gate && gate.isPlan ? 'Ready for approval' : 'Ready to continue');
        if (hasGate) this._planUiExpanded = true;
        var expanded = !!this._planUiExpanded;
        var title = hasPlan ? 'Plan' : ((gate && gate.isPlan) ? 'Plan' : 'Step');
        var itemsHtml = hasPlan
            ? this._currentPlan.map(function (item) {
                var status = ['completed', 'in_progress', 'pending'].includes(item.status) ? item.status : 'pending';
                var icon = status === 'completed' ? '&#10003;' : (status === 'in_progress' ? '&#9654;' : '&#9675;');
                return '<div class="athena-plan-item is-' + status + '">' +
                    '<span class="athena-plan-item-icon">' + icon + '</span>' +
                    '<span class="athena-plan-item-text">' + (typeof escHtml === 'function' ? escHtml(item.task) : item.task) + '</span>' +
                    '</div>';
            }).join('')
            : '';
        var actionHtml = '';
        if (hasGate) {
            actionHtml =
                '<div class="athena-plan-actions">' +
                '<button type="button" class="btn btn-sm btn-success" id="athena-plan-approve-btn">' +
                ((gate.isPlan ? '<svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M5 3.5L12 8L5 12.5Z" fill="currentColor"></path></svg> Execute Plan' : '<svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M6 3L11 8L6 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg> Continue Step')) +
                '</button>' +
                '<button type="button" class="btn btn-sm" id="athena-plan-revise-btn">' +
                (gate.isPlan ? 'Revise Plan' : 'Pause / Revise') +
                '</button>' +
                '</div>';
        }

        el.innerHTML =
            '<button type="button" class="athena-plan-toggle' + (expanded ? ' open' : '') + '" id="athena-plan-toggle-btn" title="Toggle plan details">' +
            '<svg class="ai-inline-icon athena-plan-chevron" viewBox="0 0 16 16"><path d="M6 3L11 8L6 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>' +
            '<span class="athena-plan-title">' + title + '</span>' +
            '<span class="athena-plan-meta">' + escHtml(summary) + '</span>' +
            '</button>' +
            '<div class="athena-plan-dropdown' + (expanded ? ' open' : '') + '" id="athena-plan-dropdown">' +
            (itemsHtml ? ('<div class="athena-plan-items">' + itemsHtml + '</div>') : '') +
            actionHtml +
            '</div>';

        var toggleBtn = document.getElementById('athena-plan-toggle-btn');
        if (toggleBtn) {
            bindManagedDomEvent(toggleBtn, 'click', 'athena-plan-toggle', () => {
                this._planUiExpanded = !this._planUiExpanded;
                this._renderPlanUI();
            });
        }
        var approveBtn = document.getElementById('athena-plan-approve-btn');
        if (approveBtn) {
            bindManagedDomEvent(approveBtn, 'click', 'athena-plan-approve', () => {
                if (gate && gate.isPlan) this.approvePlan();
                else this.continueStep();
            });
        }
        var reviseBtn = document.getElementById('athena-plan-revise-btn');
        if (reviseBtn) {
            bindManagedDomEvent(reviseBtn, 'click', 'athena-plan-revise', () => this.revisePlan());
        }
    },

    _renderPlanApprovalCard(targetEl, isPlan) {
        if (!targetEl) return;
        targetEl.querySelectorAll('.ai-plan-approval').forEach(el => el.remove());

        const card = document.createElement('div');
        card.className = 'ai-plan-approval';
        card.innerHTML =
            '<div class="ai-plan-approval-title">' + (isPlan ? 'Plan ready for approval' : 'Step ready for approval') + '</div>' +
            '<button type="button" class="btn btn-sm btn-success ai-plan-primary" data-plan-action="approve">' +
            (isPlan
                ? '<svg class="ai-inline-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5L12 8L5 12.5Z" fill="currentColor"></path></svg> Execute Plan'
                : '<svg class="ai-inline-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.8L11 8L6 12.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg> Continue Step') +
            '</button>' +
            '<button type="button" class="btn btn-sm" data-plan-action="revise">' +
            (isPlan ? 'Revise Plan' : 'Pause / Revise') +
            '</button>';
        targetEl.appendChild(card);

        const approveBtn = card.querySelector('[data-plan-action="approve"]');
        const reviseBtn = card.querySelector('[data-plan-action="revise"]');
        if (approveBtn) {
            bindManagedDomEvent(approveBtn, 'click', 'athena-inline-plan-approve', () => {
                if (isPlan) this.approvePlan();
                else this.continueStep();
            });
        }
        if (reviseBtn) {
            bindManagedDomEvent(reviseBtn, 'click', 'athena-inline-plan-revise', () => this.revisePlan());
        }
    },

    _showApprovalGate(gateInfo, targetEl) {
        if (!gateInfo || !gateInfo.needsApproval) return false;
        var isPlan = !!gateInfo.isPlan;
        if (targetEl) this._renderPlanApprovalCard(targetEl, isPlan);
        this._setPlanActionButton(true, isPlan);
        this._renderPlanUI();
        this._setActivity('waiting', isPlan ? 'Waiting for plan approval...' : 'Waiting to continue...');
        return true;
    },

    _getPlanSummary() {
        if (!this._currentPlan || this._currentPlan.length === 0) return '';
        return '\n<current-plan>\n' + this._currentPlan.map(function (item) {
            return '- [' + item.status + '] ' + item.task;
        }).join('\n') + '\n</current-plan>';
    },

    _loadProjectNotes() {
        const notePath = '.athena/notes.md';
        if (!fileHandles[notePath]) return '';
        try {
            if (this._fileContentCache[notePath]) return this._fileContentCache[notePath];
        } catch (_) { }
        return '';
    },

    async _loadProjectNotesAsync() {
        const notePath = '.athena/notes.md';
        if (!fileHandles[notePath]) return '';
        try {
            const content = await this._readFileWithCache(notePath);
            return content || '';
        } catch (_) {
            return '';
        }
    },

    _syncEditor(path, content) {
        if (window.athenaCompat && typeof window.athenaCompat.syncEditorPath === 'function') {
            Promise.resolve(window.athenaCompat.syncEditorPath(path, content)).catch(function () { });
        }
    },

    // ══════════════════════════════════════════════════════════════════
    //  AUTO-CHECKPOINT
    // ══════════════════════════════════════════════════════════════════

    async _ensureCheckpoint() {
        if (this._sessionCheckpointed || !dirHandle) return;
        this._sessionCheckpointed = true;
        addAIChatMessage('system', 'Creating auto-checkpoint before AI changes...');
        await checkpointManager.createAutoCheckpoint('Before Prometheus changes');
    },

    // ══════════════════════════════════════════════════════════════════
    //  APPROVAL UI �" Diff preview with accept/reject
    // ══════════════════════════════════════════════════════════════════

    _renderPendingApprovalBar(state) {
        const bar = document.getElementById('ai-review-bar');
        const label = document.getElementById('ai-review-label');
        const openBtn = document.getElementById('ai-review-open-btn');
        if (!bar || !label) return false;
        const suffix = state.oldContent === null ? ' (new file)' : '';
        label.innerHTML = '<svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M10.5 4.5l1.5-1.5 1.5 1.5M12 3v6M5.5 11.5L4 13l-1.5-1.5M4 13V7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="12" cy="11.5" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"></circle><circle cx="4" cy="4.5" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"></circle></svg> Prometheus change pending: <code>' + escHtml(state.path) + suffix + '</code>';
        bar.classList.add('visible');
        if (openBtn) openBtn.textContent = 'Hide Diff';
        return true;
    },

    _hidePendingApprovalBar() {
        const bar = document.getElementById('ai-review-bar');
        const label = document.getElementById('ai-review-label');
        const openBtn = document.getElementById('ai-review-open-btn');
        if (bar) bar.classList.remove('visible');
        if (label) label.innerHTML = '';
        if (openBtn) openBtn.textContent = 'View Diff';
    },

    openPendingDiff() {
        var state = this._pendingApproval;
        var inlineEl = document.getElementById('ai-diff-inline');
        var openBtn = document.getElementById('ai-review-open-btn');
        if (!inlineEl) return;
        if (!state) {
            inlineEl.classList.remove('visible');
            inlineEl.innerHTML = '';
            if (openBtn) openBtn.textContent = 'View Diff';
            return;
        }

        if (inlineEl.classList.contains('visible')) {
            inlineEl.classList.remove('visible');
            inlineEl.innerHTML = '';
            if (openBtn) openBtn.textContent = 'View Diff';
            return;
        }

        var suffix = state.oldContent === null ? ' (new file)' : '';
        var diffHtml = (typeof mergeEditor !== 'undefined' && mergeEditor && typeof mergeEditor.buildInlineReviewHtml === 'function')
            ? mergeEditor.buildInlineReviewHtml(state.path, state.oldContent, state.newContent)
            : this._buildDiffHtml(state.path, state.oldContent, state.newContent, { maxShow: 2000 });
        inlineEl.innerHTML =
            '<div class="diff-inline-header">' +
            '<svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M10.5 4.5l1.5-1.5 1.5 1.5M12 3v6M5.5 11.5L4 13l-1.5-1.5M4 13V7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="12" cy="11.5" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"></circle><circle cx="4" cy="4.5" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"></circle></svg> ' +
            (typeof escHtml === 'function' ? escHtml(state.path) : state.path) + suffix +
            '<div style="flex:1"></div>' +
            '<button class="btn btn-sm" data-action="hide">Hide</button>' +
            '</div>' +
            '<div class="diff-inline-body">' + diffHtml + '</div>' +
            '<div class="diff-inline-actions">' +
            '<button class="btn btn-sm btn-success" data-action="accept-all">Accept All</button>' +
            '<button class="btn btn-sm btn-success" data-action="accept">Accept</button>' +
            '<button class="btn btn-sm" data-action="reject">Reject</button>' +
            '</div>';
        inlineEl.querySelector('[data-action="hide"]').addEventListener('click', function () { aiAgent.openPendingDiff(); });
        inlineEl.querySelector('[data-action="accept-all"]').addEventListener('click', function () { aiAgent.acceptAllPending(); });
        inlineEl.querySelector('[data-action="accept"]').addEventListener('click', function () { aiAgent._resolvePendingApproval(true, 'ide'); });
        inlineEl.querySelector('[data-action="reject"]').addEventListener('click', function () { aiAgent._resolvePendingApproval(false, 'ide'); });
        inlineEl.classList.add('visible');
        if (openBtn) openBtn.textContent = 'Hide Diff';
        requestAnimationFrame(function () {
            var bodyEl = inlineEl.querySelector('.diff-inline-body');
            var targetEl = inlineEl.querySelector('[data-review-target="true"]');
            if (bodyEl) bodyEl.scrollTop = 0;
            if (targetEl && typeof targetEl.scrollIntoView === 'function') {
                targetEl.scrollIntoView({ block: 'center', inline: 'nearest' });
            }
        });
    },

    _clearPendingApprovalUI() {
        this._hidePendingApprovalBar();
        var inlineEl = document.getElementById('ai-diff-inline');
        if (inlineEl) {
            inlineEl.classList.remove('visible');
            inlineEl.innerHTML = '';
        }
        // Also close modal if it was somehow open
        var modal = document.getElementById('ai-diff-modal');
        if (modal) modal.classList.remove('show');
    },

    acceptAllPending() {
        this._autoApproveRemaining = true;
        if (this._pendingApproval && !this._pendingApproval.resolved) {
            this._resolvePendingApproval(true, 'accept-all');
            return;
        }
        if (this._busy) this._setActivity('working', 'Continuing...');
    },

    _resolvePendingApproval(accepted, source) {
        const state = this._pendingApproval;
        if (!state || state.resolved) return;
        state.resolved = true;

        if (!accepted && !this._autoAcceptToggle) if (!this._autoAcceptToggle) this._autoApproveRemaining = false;

        if (state.chatButtonsEl) {
            state.chatButtonsEl.innerHTML = accepted
                ? '<span style="color:var(--success);font-size:11px">Accepted' + ((source === 'ide' || source === 'accept-all') ? ' in IDE' : '') + '</span>'
                : '<span style="color:var(--error);font-size:11px">Rejected' + (source === 'ide' ? ' in IDE' : '') + '</span>';
        }

        this._clearPendingApprovalUI();
        const resolver = state.resolve;
        this._pendingApproval = null;
        if (accepted && this._busy) this._setActivity('working', 'Continuing...');
        if (typeof resolver === 'function') resolver(!!accepted);
    },

    _requestApproval(path, oldContent, newContent) {
        if (this._autoApproveRemaining) {
            return Promise.resolve({ accepted: true, content: newContent });
        }
        this._setActivity('waiting', 'Waiting for approval...');

        const approvalPromise = this._requestApprovalInner(path, oldContent, newContent);
        const timeoutMs = this.APPROVAL_TIMEOUT_MS || 300000;
        var self = this;
        var countdownId;
        var remainingSec = Math.floor(timeoutMs / 1000);
        countdownId = setInterval(function () {
            remainingSec -= 30;
            if (remainingSec > 0 && ((self._pendingApproval && !self._pendingApproval.resolved) || (typeof mergeEditor !== 'undefined' && mergeEditor._active))) {
                self._setActivity('waiting', 'Waiting for approval... (' + Math.ceil(remainingSec / 60) + 'm remaining)');
            } else {
                clearInterval(countdownId);
            }
        }, 30000);

        var timeoutId;
        var timeoutPromise = new Promise(function (resolve) {
            timeoutId = setTimeout(function () {
                addAIChatMessage('system', 'Approval timeout (' + Math.round(timeoutMs / 60000) + ' min). Auto-skipping change to "' + path + '".');
                if (self._pendingApproval && !self._pendingApproval.resolved) {
                    self._resolvePendingApproval(false, 'timeout');
                }
                if (typeof mergeEditor !== 'undefined' && mergeEditor._active) {
                    mergeEditor.close(false);
                }
                resolve(false);
            }, timeoutMs);
        });

        return Promise.race([approvalPromise, timeoutPromise]).finally(function () {
            clearTimeout(timeoutId);
            clearInterval(countdownId);
        });
    },

    _requestApprovalInner(path, oldContent, newContent) {
        // Merge editor now auto-continues when all hunks are resolved.
        // Keep it enabled for richer in-editor review (overview ruler + per-hunk controls).
        const useMergeEditorApproval = true;

        // Use merge editor only when explicitly enabled
        if (useMergeEditorApproval && typeof mergeEditor !== 'undefined' && window.cmModules && window.cmModules.StateField) {
            var self = this;
            var showDiffInChat = this._isChatDiffEnabled();
            var container = document.getElementById('ai-chat-messages');
            var chatBtnsEl = null;
            if (container) {
                var div = document.createElement('div');
                div.className = 'ai-msg';
                var diffHtml = this._buildDiffHtml(path, oldContent, newContent);
                div.innerHTML =
                    '<div class="ai-chat-diff-preview"' + (showDiffInChat ? '' : ' style="display:none"') + '>' + diffHtml + '</div>' +
                    '<div class="approve-btns">' +
                    '<button class="btn btn-sm btn-success" data-action="accept-all">Accept All</button>' +
                    '<button class="btn btn-sm btn-success" data-action="accept">Accept</button>' +
                    '<button class="btn btn-sm" data-action="reject">Reject</button>' +
                    '</div>';
                chatBtnsEl = div.querySelector('.approve-btns');
                div.querySelector('[data-action="accept-all"]').addEventListener('click', function () {
                    if (typeof mergeEditor !== 'undefined' && mergeEditor._active) {
                        mergeEditor.acceptAll();
                    }
                });
                div.querySelector('[data-action="accept"]').addEventListener('click', function () {
                    if (typeof mergeEditor !== 'undefined' && mergeEditor._active) {
                        mergeEditor.acceptAll();
                    }
                });
                div.querySelector('[data-action="reject"]').addEventListener('click', function () {
                    if (typeof mergeEditor !== 'undefined' && mergeEditor._active) {
                        mergeEditor.close(false);
                    }
                });
                this._appendChatElement(container, div);
            }
            return mergeEditor.open(path, oldContent, newContent).then(function (result) {
                self._setActivity('working', 'Continuing...');
                if (chatBtnsEl) {
                    chatBtnsEl.innerHTML = result.accepted
                        ? '<span style="color:var(--success);font-size:11px">Accepted</span>'
                        : '<span style="color:var(--error);font-size:11px">Rejected</span>';
                }
                return result;
            });
        }

        // Fallback: simple diff flow
        return new Promise(resolve => {
            if (this._pendingApproval && !this._pendingApproval.resolved) {
                this._resolvePendingApproval(false, 'superseded');
            }

            const state = {
                path,
                oldContent,
                newContent,
                resolve,
                resolved: false,
                chatButtonsEl: null
            };
            this._pendingApproval = state;

            const hasInlineBar = this._renderPendingApprovalBar(state);
            const container = document.getElementById('ai-chat-messages');

            if (container) {
                const showDiffInChat = this._isChatDiffEnabled();
                const div = document.createElement('div');
                div.className = 'ai-msg';
                const diffHtml = this._buildDiffHtml(path, oldContent, newContent);
                div.innerHTML =
                    '<div class="ai-chat-diff-preview"' + (showDiffInChat ? '' : ' style="display:none"') + '>' + diffHtml + '</div>' +
                    '<div class="approve-btns">' +
                    '<button class="btn btn-sm btn-success" data-action="accept-all">Accept All</button>' +
                    '<button class="btn btn-sm btn-success" data-action="accept">Accept</button>' +
                    '<button class="btn btn-sm" data-action="reject">Reject</button>' +
                    '</div>';
                state.chatButtonsEl = div.querySelector('.approve-btns');
                div.querySelector('[data-action="accept-all"]').addEventListener('click', () => this.acceptAllPending());
                div.querySelector('[data-action="accept"]').addEventListener('click', () => this._resolvePendingApproval(true, 'chat'));
                div.querySelector('[data-action="reject"]').addEventListener('click', () => this._resolvePendingApproval(false, 'chat'));
                this._appendChatElement(container, div);
            }

            if (hasInlineBar) {
                this.openPendingDiff();
            }

            if (!hasInlineBar && !container) {
                const ok = confirm('Prometheus wants to change "' + path + '". Accept?');
                this._resolvePendingApproval(ok, 'fallback');
            }
        });
    },

    _buildDiffHtml(path, oldContent, newContent, opts = {}) {
        var preferSharedPreview = !(Number.isFinite(opts.maxShow) && opts.maxShow > 120);
        if (preferSharedPreview && typeof mergeEditor !== 'undefined' && mergeEditor && typeof mergeEditor.buildChatDiffHtml === 'function') {
            var sharedHtml = mergeEditor.buildChatDiffHtml(path, oldContent, newContent, opts);
            if (sharedHtml) return sharedHtml;
        }

        let bodyHtml = '';
        const maxShow = Number.isFinite(opts.maxShow) ? opts.maxShow : 28;
        if (oldContent === null) {
            const lines = (newContent || '').split('\n');
            bodyHtml = lines.map(l => '<div class="diff-line added">+ ' + escHtml(l) + '</div>').join('');
        } else {
            const oldLines = oldContent.split('\n');
            const newLines = newContent.split('\n');
            let shown = 0;
            let firstDiff = 0;
            while (firstDiff < oldLines.length && firstDiff < newLines.length && oldLines[firstDiff] === newLines[firstDiff]) firstDiff++;
            let lastDiffOld = oldLines.length - 1, lastDiffNew = newLines.length - 1;
            while (lastDiffOld > firstDiff && lastDiffNew > firstDiff && oldLines[lastDiffOld] === newLines[lastDiffNew]) { lastDiffOld--; lastDiffNew--; }
            const ctxStart = Math.max(0, firstDiff - 3);
            if (ctxStart > 0) bodyHtml += '<div class="diff-line context">... (' + ctxStart + ' lines above)</div>';
            for (let i = ctxStart; i < firstDiff && shown < maxShow; i++, shown++) {
                bodyHtml += '<div class="diff-line context"> ' + escHtml(oldLines[i]) + '</div>';
            }
            for (let i = firstDiff; i <= lastDiffOld && shown < maxShow; i++, shown++) {
                bodyHtml += '<div class="diff-line removed">- ' + escHtml(oldLines[i]) + '</div>';
            }
            for (let i = firstDiff; i <= lastDiffNew && shown < maxShow; i++, shown++) {
                bodyHtml += '<div class="diff-line added">+ ' + escHtml(newLines[i]) + '</div>';
            }
            const ctxEnd = Math.min(oldLines.length - 1, lastDiffOld + 4);
            for (let i = lastDiffOld + 1; i <= ctxEnd && shown < maxShow; i++, shown++) {
                bodyHtml += '<div class="diff-line context"> ' + escHtml(oldLines[i]) + '</div>';
            }
            if (ctxEnd < oldLines.length - 1) bodyHtml += '<div class="diff-line context">... (' + (oldLines.length - 1 - ctxEnd) + ' lines below)</div>';
            if (shown >= maxShow) bodyHtml += '<div class="diff-line context">... (diff truncated)</div>';
        }
        return '<div class="diff-preview">' +
            '<div class="diff-header"><svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M13 5.5l-4-4H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1v-8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path><path d="M9 1.5v4h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path></svg> ' + escHtml(path) + (oldContent === null ? ' (new file)' : '') + '</div>' +
            '<div class="diff-body">' + bodyHtml + '</div></div>';
    },

    // ══════════════════════════════════════════════════════════════════
    //  SYSTEM PROMPT �" Dynamic, instruction-rich
    // ══════════════════════════════════════════════════════════════════

    async _buildSystemPrompt() {
        this._projectNotesContent = await this._loadProjectNotesAsync();
        const projectName = dirHandle ? dirHandle.name : 'No project loaded';
        const fileCount = Object.keys(fileHandles).length;
        const allFiles = Object.keys(fileHandles);
        const fileList = allFiles.length <= 30
            ? allFiles.join(', ')
            : this._summarizeFileTree(allFiles);
        const openList = (window.athenaCompat && typeof window.athenaCompat.getOpenFilePaths === 'function')
            ? (window.athenaCompat.getOpenFilePaths().join(', ') || 'none')
            : (openFiles.map(f => f.path).join(', ') || 'none');
        const active = (window.athenaCompat && typeof window.athenaCompat.getActiveFilePath === 'function')
            ? (window.athenaCompat.getActiveFilePath() || 'none')
            : (activeFile || 'none');

        var prompt = `You are Prometheus, a senior software developer working inside Forge, a browser-based IDE. You think carefully about problems and write excellent code.

<environment>
Project: ${projectName}
Files (${fileCount}): ${fileList}
Open in editor: ${openList}
Active file: ${active}
</environment>` + (this._projectNotesContent ? '\n\n<project-notes>\n' + this._projectNotesContent + '\n</project-notes>' : '') + `

You have tools to read, write, and search files. Use readFile to understand the code, then replaceInFile or writeFile to make changes. You can call multiple tools in one response.

For small projects the file list shows every file. For larger projects it shows the directory structure � use listFiles or searchFiles to find specific files.

If replaceInFile fails, re-read the file and retry. Prefer replaceInFile for targeted edits, writeFile for new files or full rewrites.

Think through the problem first, then act. Keep your explanations concise but don't skip reasoning when it matters.

Default to the smallest valid change set and the fewest tool calls that fully satisfy the request.
Avoid repeated scans/reads when you already have enough context; if a file is listed as recently read, use that prior content unless it was compacted, changed, or you need a different line range.
When the request is complete, provide a short summary and STOP. Do not continue with extra changes or verification unless the user explicitly asks for it.`;

        if (this._htmlAppMode) {
            prompt += '\n\n' + this._buildHtmlAppModePrompt();
        }

        if (this._planMode) {
            prompt += `

<plan-mode>
You are in PLAN MODE. The user wants to see what changes you would make WITHOUT applying them.
1. Read files and analyze the codebase as normal using readFile, listFiles, searchFiles
2. Describe EXACTLY what changes you would make, including specific code snippets
3. When you call writeFile, createFile, deleteFile, or replaceInFile, they will NOT be applied �" they are recorded as planned changes
4. Still call the write tools so the user can see your intended changes, but know they will not execute
5. At the end, summarize your complete plan with a list of all files that would be modified and why
6. End with exactly: "**Ready to execute this plan?**" and STOP
</plan-mode>`;
        }

        // Skills injection � add available skill summaries for auto-discovery
        if (typeof skillsManager !== 'undefined' && skillsManager._initialized) {
            const summaries = skillsManager.getSkillSummaries();
            if (summaries.length > 0) {
                prompt += '\n\n<available_skills>\nThe user has specialized skills available. When a skill is activated, you will receive its full instructions as a system message. Follow those instructions for the conversation.\n';
                for (const s of summaries) {
                    prompt += '- /' + s.name + ': ' + s.description;
                    if (s.argumentHint) prompt += ' ' + s.argumentHint;
                    prompt += '\n';
                }
                prompt += '</available_skills>';
            }
        }

        return prompt;
    },

    // ══════════════════════════════════════════════════════════════════
    //  MARKDOWN RENDERER
    // ══════════════════════════════════════════════════════════════════

    _summarizeFileTree(allFiles) {
        const dirs = {};
        const rootFiles = [];
        for (const f of allFiles) {
            const slash = f.indexOf('/');
            if (slash === -1) { rootFiles.push(f); continue; }
            const dir = f.slice(0, slash);
            if (!dirs[dir]) dirs[dir] = { count: 0, exts: new Set() };
            dirs[dir].count++;
            const dot = f.lastIndexOf('.');
            if (dot > slash) dirs[dir].exts.add(f.slice(dot));
        }
        const parts = [];
        if (rootFiles.length) parts.push(rootFiles.slice(0, 10).join(', ') + (rootFiles.length > 10 ? ' +' + (rootFiles.length - 10) + ' more' : ''));
        for (const [dir, info] of Object.entries(dirs)) {
            parts.push(dir + '/ (' + info.count + ' files: ' + [...info.exts].slice(0, 5).join(', ') + ')');
        }
        return parts.join('; ') + ' � use listFiles for full paths';
    },

    _isAllowedLinkHref(hrefValue) {
        const href = String(hrefValue || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        if (!href) return false;
        try {
            const url = new URL(href, window.location.origin);
            return ['https:', 'http:', 'mailto:'].includes(url.protocol);
        } catch { return false; }
    },

    _sanitizeRenderedHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = html;
        const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math']);
        const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
        const removeQueue = [];
        while (walker.nextNode()) {
            const el = walker.currentNode;
            const tag = el.tagName.toLowerCase();
            if (blockedTags.has(tag)) { removeQueue.push(el); continue; }
            for (const attr of [...el.attributes]) {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || name === 'style') { el.removeAttribute(attr.name); continue; }
                if (tag === 'a' && name === 'href') continue;
                if (name !== 'class' && name !== 'target' && name !== 'rel') el.removeAttribute(attr.name);
            }
            if (tag === 'a') {
                const href = el.getAttribute('href');
                if (!this._isAllowedLinkHref(href)) { el.removeAttribute('href'); el.removeAttribute('target'); }
                else el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
            }
        }
        removeQueue.forEach(node => node.replaceWith(document.createTextNode(node.textContent || '')));
        return template.innerHTML;
    },

    _normalizeMarkdownForChat(text) {
        const normalizeSegment = (segment) => {
            return String(segment || '')
                .replace(/\r\n?/g, '\n')
                .split('\n')
                .map(line => {
                    const pipeCount = (line.match(/\|/g) || []).length;
                    if (pipeCount >= 8 && /\|\s+\|(?:\s*:?-{3,}:?\s*\||\s*\d{1,3}\s*\|)/.test(line)) {
                        line = line.replace(/\|\s+\|/g, '|\n|');
                    }

                    const numberedMarkers = line.match(/(?:^|\s)\d{1,2}\.\s+/g) || [];
                    if (numberedMarkers.length >= 2) {
                        line = line.replace(/^(.+?)\s+(\d{1,2}\.\s+)/, '$1\n\n$2');
                        line = line.replace(/[ \t]+(\d{1,2}\.\s+)/g, '\n$1');
                    }
                    return line;
                })
                .join('\n');
        };

        const chunks = String(text || '').split(/(```[\s\S]*?```)/g);
        return chunks.map(chunk => chunk.startsWith('```') ? chunk.replace(/\r\n?/g, '\n') : normalizeSegment(chunk)).join('');
    },

    _isMarkdownTableRow(line) {
        const trimmed = String(line || '').trim();
        return trimmed.startsWith('|') && trimmed.endsWith('|') && (trimmed.match(/\|/g) || []).length >= 3;
    },

    _isMarkdownTableSeparator(line) {
        if (!this._isMarkdownTableRow(line)) return false;
        const cells = String(line || '').trim().replace(/^\||\|$/g, '').split('|');
        return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
    },

    _splitMarkdownTableRow(line) {
        return String(line || '').trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    },

    _renderMarkdownTableBlock(lines) {
        if (!Array.isArray(lines) || lines.length < 2) return '';
        const header = this._splitMarkdownTableRow(lines[0]);
        const bodyRows = lines.slice(2).filter(line => this._isMarkdownTableRow(line)).map(line => this._splitMarkdownTableRow(line));
        const cellCount = Math.max(header.length, ...bodyRows.map(row => row.length));
        const pad = (row) => {
            const out = row.slice(0, cellCount);
            while (out.length < cellCount) out.push('');
            return out;
        };
        const headHtml = pad(header).map(cell => '<th>' + cell + '</th>').join('');
        const bodyHtml = bodyRows.map(row => '<tr>' + pad(row).map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('');
        return '<div class="ai-markdown-table-wrap"><table class="ai-markdown-table"><thead><tr>' + headHtml + '</tr></thead><tbody>' + bodyHtml + '</tbody></table></div>';
    },

    _extractMarkdownTables(html, blocks) {
        const lines = String(html || '').split('\n');
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            if (this._isMarkdownTableRow(lines[i]) && i + 1 < lines.length && this._isMarkdownTableSeparator(lines[i + 1])) {
                const tableLines = [lines[i], lines[i + 1]];
                i += 2;
                while (i < lines.length && this._isMarkdownTableRow(lines[i])) {
                    tableLines.push(lines[i]);
                    i++;
                }
                i--;
                const token = '%%FORGE_TABLE_' + blocks.length + '%%';
                blocks.push({ token, html: this._renderMarkdownTableBlock(tableLines) });
                out.push('', token, '');
            } else {
                out.push(lines[i]);
            }
        }
        return out.join('\n');
    },

    _restoreMarkdownBlockTokens(html, blocks) {
        let restored = String(html || '');
        blocks.forEach(block => {
            const tokenPattern = block.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            restored = restored.replace(new RegExp('<p>\\s*' + tokenPattern + '\\s*</p>', 'g'), block.html);
            restored = restored.replace(new RegExp(tokenPattern, 'g'), block.html);
        });
        return restored;
    },

    _renderMarkdown(text) {
        if (!text) return '';
        const blocks = [];
        let source = this._normalizeMarkdownForChat(text);
        source = source.replace(/```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const token = '%%FORGE_CODE_' + blocks.length + '%%';
            blocks.push({ token, html: '<pre><code class="lang-' + escHtml(lang || 'text') + '">' + escHtml(code) + '</code></pre>' });
            return '\n\n' + token + '\n\n';
        });

        let html = escHtml(source);
        html = this._extractMarkdownTables(html, blocks);
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
        html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        html = html.replace(/^[ \t]*[-*] (.+)$/gm, '<li data-list="ul">$1</li>');
        html = html.replace(/^[ \t]*\d+\. (.+)$/gm, '<li data-list="ol">$1</li>');
        html = html.replace(/((?:<li data-list="ul">.*<\/li>\n?)+)/g, match => '<ul>' + match.replace(/ data-list="ul"/g, '') + '</ul>');
        html = html.replace(/((?:<li data-list="ol">.*<\/li>\n?)+)/g, match => '<ol>' + match.replace(/ data-list="ol"/g, '') + '</ol>');
        html = html.replace(/\n{3,}/g, '\n\n');
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>\s*(<(?:pre|h[34]|ul|ol|blockquote|div|table))/g, '$1');
        html = html.replace(/(<\/(?:pre|h[34]|ul|ol|blockquote|div|table)>)\s*<\/p>/g, '$1');
        html = this._restoreMarkdownBlockTokens(html, blocks);
        return this._sanitizeRenderedHtml(html);
    },

    // ══════════════════════════════════════════════════════════════════
    //  API REQUEST BUILDING �" Per-provider format
    // ══════════════════════════════════════════════════════════════════

    _buildRequestBody(messages, stream) {
        const fmt = this._detectFormat();
        const model = this.getEffectiveModel();
        const tools = this._getToolDefinitions();
        const info = this._getModelInfo(model);
        const maxOut = info?.maxOutput || 8192;
        const cappedMaxOut = Math.min(maxOut, this.AGENT_MAX_OUTPUT_TOKENS || 4096);

        if (fmt === 'anthropic') {
            const systemMsg = messages
                .filter(m => m && m.role === 'system' && typeof m.content === 'string' && m.content.trim())
                .map(m => m.content)
                .join('\n\n');
            const nonSystem = messages.filter(m => m.role !== 'system');
            const body = {
                model,
                system: systemMsg || '',
                messages: nonSystem,
                tools,
                max_tokens: Math.min(cappedMaxOut, 128000),
                temperature: 0.2
            };
            if (this._forceToolChoice) {
                body.tool_choice = { type: 'any' };
                // Prefill assistant response to bias toward tool calling
                const lastMsg = nonSystem[nonSystem.length - 1];
                if (lastMsg && lastMsg.role !== 'assistant') {
                    nonSystem.push({ role: 'assistant', content: [{ type: 'text', text: 'I\'ll call the appropriate tool now.\n\n' }] });
                }
            }
            if (stream) body.stream = true;
            return body;
        }

        if (fmt === 'google') {
            // Convert to Gemini format
            const contents = [];
            for (const m of messages) {
                if (m.role === 'system') continue; // handled separately
                if (m.role === 'user') {
                    if (m._multimodal && Array.isArray(m.content)) {
                        // Multimodal (image + text) �" content is already in Google parts format
                        contents.push({ role: 'user', parts: m.content });
                    } else if (typeof m.content === 'string') {
                        contents.push({ role: 'user', parts: [{ text: m.content }] });
                    } else if (Array.isArray(m.content)) {
                        // Tool results
                        const parts = m.content.map(block => {
                            if (block.type === 'tool_result') {
                                return { functionResponse: { name: block._toolName || 'unknown', response: { result: block.content } } };
                            }
                            return { text: typeof block === 'string' ? block : JSON.stringify(block) };
                        });
                        contents.push({ role: 'user', parts });
                    }
                } else if (m.role === 'assistant') {
                    if (typeof m.content === 'string') {
                        contents.push({ role: 'model', parts: [{ text: m.content }] });
                    } else if (Array.isArray(m.content)) {
                        const parts = m.content.map(block => {
                            if (block.type === 'text') return { text: block.text };
                            if (block.type === 'tool_use') {
                                const part = { functionCall: { name: block.name, args: block.input } };
                                if (block._thoughtSignature) part.thoughtSignature = block._thoughtSignature;
                                return part;
                            }
                            return { text: JSON.stringify(block) };
                        });
                        contents.push({ role: 'model', parts });
                    }
                } else if (m.role === 'tool') {
                    // OpenAI-style tool result �" convert to Gemini functionResponse
                    contents.push({ role: 'user', parts: [{ functionResponse: { name: m._toolName || 'unknown', response: { result: m.content } } }] });
                }
            }
            const systemMsg = messages
                .filter(m => m && m.role === 'system' && typeof m.content === 'string' && m.content.trim())
                .map(m => m.content)
                .join('\n\n');
            const genConfig = { maxOutputTokens: Math.min(cappedMaxOut, 65536), temperature: 0.2 };
            const body = {
                contents,
                tools,
                systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
                generationConfig: genConfig
            };
            if (this._forceToolChoice) {
                body.tool_config = { function_calling_config: { mode: 'ANY' } };
            }
            return body;
        }

        if (fmt === 'asksage') {
            return this._buildAskSagePayload({
                model: model,
                messages: messages,
                includeTools: true
            });
        }

        // OpenAI format (default)
        const body = { model, messages, tools };
        const modelInfo = this._getModelInfo(model);
        if (modelInfo?.flags?.reasoning) {
            // Reasoning models use max_completion_tokens, no temperature
            body.max_completion_tokens = Math.min(cappedMaxOut, 128000);
            body.reasoning_effort = 'medium';
        } else {
            body.max_tokens = Math.min(cappedMaxOut, 128000);
            body.temperature = 0.2;
        }
        if (this._forceToolChoice && !modelInfo?.flags?.reasoning) {
            body.tool_choice = 'required';
        }
        if (stream) body.stream = true;
        return body;
    },

    _buildHeaders() {
        const fmt = this._detectFormat();
        const apiKey = this.getActiveApiKey();
        const headers = { 'Content-Type': 'application/json' };
        if (fmt === 'anthropic') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
        } else if (fmt === 'asksage') {
            headers['Authorization'] = 'Bearer ' + apiKey;
            headers['x-access-tokens'] = apiKey;
        } else if (fmt === 'google') {
            // Google uses ?key= query param, but also supports Bearer
            headers['Authorization'] = 'Bearer ' + apiKey;
        } else {
            headers['Authorization'] = 'Bearer ' + apiKey;
        }
        return headers;
    },

    /**
     * Verify an API key works with the given provider by sending a minimal request.
     * Returns { ok: true } or { ok: false, reason: string }.
     */
    async _verifyApiKey(providerId, apiKey, model) {
        var providerCfg = this.PROVIDERS[providerId];
        if (!providerCfg) return { ok: false, reason: 'Unknown provider.' };
        var isGoogle = providerCfg.format === 'google';
        var timeoutMs = isGoogle ? 15000 : 12000;
        var maxAttempts = isGoogle ? 2 : 1;

        try {
            var url, headers, body, method;

            if (providerCfg.format === 'anthropic') {
                url = providerCfg.endpoint;
                headers = {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                };
                body = JSON.stringify({
                    model: model,
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'Hi' }]
                });
                method = 'POST';
            } else if (providerCfg.format === 'google') {
                // Validate key with a lightweight endpoint to avoid model-specific false negatives.
                url = providerCfg.endpoint + '/v1beta/models?pageSize=1&key=' + encodeURIComponent(apiKey);
                headers = { 'Content-Type': 'application/json' };
                body = null;
                method = 'GET';
            } else if (providerCfg.format === 'asksage') {
                // Ask Sage / CAPRA: verify via get-models endpoint using required headers
                var serverBase = String(providerCfg.serverBaseUrl || 'https://api.capra.flankspeed.us.navy.mil/server').replace(/\/+$/, '');
                url = serverBase + '/get-models';
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey,
                    'x-access-tokens': apiKey
                };
                body = JSON.stringify({});
                method = 'POST';
            } else {
                // OpenAI-compatible (openai, xai, genaimil)
                url = providerCfg.endpoint;
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey
                };
                body = JSON.stringify({
                    model: model,
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'Hi' }]
                });
                method = 'POST';
            }
            var host = '';
            try {
                host = new URL(url).host;
            } catch (e) {
                host = providerCfg.endpoint || 'provider endpoint';
            }

            for (var attempt = 1; attempt <= maxAttempts; attempt++) {
                var controller = new AbortController();
                var timeout = setTimeout(function () { controller.abort(); }, timeoutMs);
                try {
                    var res = await fetch(url, {
                        method: method,
                        headers: headers,
                        body: body,
                        signal: controller.signal
                    });
                    clearTimeout(timeout);

                    if (res.ok || res.status === 200) {
                        return { ok: true };
                    }

                    // Parse error for helpful message
                    var errText = '';
                    try {
                        var errData = await res.json();
                        errText = errData.error?.message || errData.error?.status || JSON.stringify(errData.error || errData);
                    } catch (e) {
                        errText = 'HTTP ' + res.status;
                    }

                    if (res.status === 401 || res.status === 403) {
                        return { ok: false, reason: 'Invalid API key. ' + errText };
                    }
                    if (isGoogle && res.status === 400 && /api key|api_key|invalid key|permission denied/i.test(errText)) {
                        return { ok: false, reason: 'Invalid API key. ' + errText };
                    }
                    if (res.status === 404) {
                        if (isGoogle) {
                            return { ok: false, reason: 'Google API endpoint not found. ' + errText };
                        }
                        return { ok: false, reason: 'Model "' + model + '" not found or not available. ' + errText };
                    }
                    if (res.status === 429) {
                        // Rate limited but key is valid
                        return { ok: true };
                    }
                    return { ok: false, reason: 'HTTP ' + res.status + ': ' + errText };
                } catch (e) {
                    clearTimeout(timeout);
                    if (e.name === 'AbortError') {
                        if (attempt < maxAttempts) continue;
                        return {
                            ok: false,
                            reason: 'Request timed out after ' + Math.round(timeoutMs / 1000) + 's to ' + host + '. Check VPN/proxy/firewall rules for this provider endpoint.'
                        };
                    }
                    // Fetch failures (CORS, DNS, network): provide a targeted hint.
                    if (!navigator.onLine) {
                        return { ok: false, reason: 'You appear to be offline.' };
                    }
                    var msg = String(e.message || 'Unknown error');
                    if (/failed to fetch/i.test(msg)) {
                        return { ok: false, reason: 'Connection failed to ' + host + '. This can be caused by firewall/proxy policy or browser CORS blocking.' };
                    }
                    return { ok: false, reason: 'Connection failed: ' + msg };
                }
            }
            return { ok: false, reason: 'Request timed out while verifying key.' };

        } catch (e) {
            // Setup/parsing failures before fetch attempts
            if (!navigator.onLine) {
                return { ok: false, reason: 'You appear to be offline.' };
            }
            return { ok: false, reason: 'Connection failed: ' + (e.message || 'Unknown error') };
        }
    },

    // ══════════════════════════════════════════════════════════════════
    //  RESPONSE PARSING �" Per-provider
    // ══════════════════════════════════════════════════════════════════

    _parseResponse(data) {
        const fmt = this._detectFormat();
        if (fmt === 'anthropic') return this._parseAnthropicResponse(data);
        if (fmt === 'google') return this._parseGoogleResponse(data);
        if (fmt === 'asksage') return this._parseAskSageResponse(data);
        return this._parseOpenAIResponse(data);
    },

    _parseAskSageResponse(data) {
        const meta = this._extractAskSageResponseMeta(data);
        const selectedText = meta.text || this.extractAskSageResponseText(data);
        const structuredCalls = this._extractAskSageToolCallsFromStructured(data);
        const tagged = this._extractAskSageToolCallsFromTaggedText(selectedText);
        const mergedToolCalls = [];
        const seenSig = new Set();
        const pushUnique = (tc) => {
            if (!tc || !tc.name) return;
            const sig = tc.name + '::' + this._stableStringify(tc.args || {});
            if (seenSig.has(sig)) return;
            seenSig.add(sig);
            mergedToolCalls.push(tc);
        };
        structuredCalls.forEach(pushUnique);
        tagged.toolCalls.forEach(pushUnique);
        const text = (tagged.cleanedText != null ? tagged.cleanedText : selectedText) || '';
        const isTrivial = this._isTrivialAskSageText(text || '');
        this._askSageDebugLog('Parsed response candidate selection', {
            selectedSource: meta.source || 'unknown',
            selectedPreview: String(text || '').slice(0, 700),
            selectedLength: String(text || '').length,
            selectedIsTrivial: isTrivial,
            extractedToolCalls: mergedToolCalls.length,
            structuredToolCalls: structuredCalls.length,
            taggedToolCalls: tagged.toolCalls.length,
            matchedTags: tagged.matchedTags || [],
            toolCallPreview: mergedToolCalls.slice(0, 8).map(tc => ({
                name: tc.name,
                source: tc._source,
                args: this._formatDebugValue(tc.args, 260)
            })),
            topCandidates: (meta.candidates || []).map(c => ({
                source: c.source,
                len: c.text.length,
                trivial: c.trivial,
                preview: c.text.slice(0, 120)
            }))
        });
        let finalText = text || '';
        if (isTrivial && mergedToolCalls.length === 0) {
            finalText = 'Ask Sage returned a status-only response (' + JSON.stringify(String(text || '').trim() || 'empty') + ') instead of an answer. Review the CAPRA DEBUG logs above for request/response details.';
        }
        if (mergedToolCalls.length > 0) {
            finalText = '';
        }
        const rawStop = data && typeof data === 'object'
            ? (data.stop_reason || data.finish_reason || data.stopReason || data.status)
            : null;
        return {
            text: finalText || (mergedToolCalls.length ? '' : 'No response text returned by Ask Sage.'),
            toolCalls: mergedToolCalls.map(tc => ({ id: tc.id, name: tc.name, args: tc.args })),
            stopReason: mergedToolCalls.length ? 'tool_calls' : (rawStop || 'stop')
        };
    },

    _parseOpenAIResponse(data) {
        const choice = data.choices?.[0];
        if (!choice) return { text: 'Unexpected response: ' + JSON.stringify(data).slice(0, 300), toolCalls: [], stopReason: 'error' };
        const msg = choice.message;
        const text = msg?.content || '';
        const toolCalls = (msg?.tool_calls || []).map(tc => ({
            id: tc.id,
            name: tc.function?.name,
            args: this._safeParse(tc.function?.arguments)
        }));
        return { text, toolCalls, stopReason: choice.finish_reason };
    },

    _parseAnthropicResponse(data) {
        const blocks = data.content || [];
        let text = '';
        const toolCalls = [];
        for (const block of blocks) {
            if (block.type === 'text') text += block.text;
            else if (block.type === 'tool_use') {
                toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
            }
        }
        return { text, toolCalls, stopReason: data.stop_reason };
    },

    _parseGoogleResponse(data) {
        // Gemini returns { candidates: [{ content: { parts: [...] } }] }
        const candidate = data.candidates?.[0];
        if (!candidate) return { text: 'Unexpected Gemini response: ' + JSON.stringify(data).slice(0, 300), toolCalls: [], stopReason: 'error' };
        const parts = candidate.content?.parts || [];
        let text = '';
        const toolCalls = [];
        for (const part of parts) {
            if (part.text) text += part.text;
            if (part.functionCall) {
                toolCalls.push({
                    id: 'gc_' + this._uid(),
                    name: part.functionCall.name,
                    args: part.functionCall.args || {},
                    thoughtSignature: part.thoughtSignature || null
                });
            }
        }
        const stopReason = candidate.finishReason || (toolCalls.length ? 'tool_calls' : 'stop');
        return { text, toolCalls, stopReason };
    },

    _safeParse(str) {
        if (!str) return {};
        if (typeof str === 'object') return str;
        try { return JSON.parse(str); } catch { return {}; }
    },

    _normalizeStopReason(raw) {
        if (!raw) return 'stop';
        const r = String(raw).toLowerCase();
        if (r === 'length' || r === 'max_tokens') return 'max_tokens';
        if (r === 'tool_calls' || r === 'tool_use') return 'tool_calls';
        if (r === 'content_filter' || r === 'safety') return 'error';
        return 'stop'; // end_turn, stop, STOP, etc.
    },

    _extractUnifiedDiffText(diffText) {
        const normalized = String(diffText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalized.split('\n');
        const blocks = [];
        let active = null;
        let sawBegin = false;
        for (const rawLine of lines) {
            const line = String(rawLine || '');
            const trimmed = line.trim();
            if (/^BEGIN_FORGE_UNIFIED_DIFF$/i.test(trimmed)) {
                sawBegin = true;
                active = [];
                continue;
            }
            if (/^END_FORGE_UNIFIED_DIFF$/i.test(trimmed)) {
                if (active) blocks.push(active.join('\n'));
                active = null;
                continue;
            }
            if (active) active.push(line);
        }
        if (active && active.length) blocks.push(active.join('\n'));
        return sawBegin ? blocks.join('\n') : normalized;
    },

    _isUnifiedDiffNoiseLine(line) {
        const trimmed = String(line || '').trim();
        if (!trimmed) return false;
        if (/^(`{3,}|~{3,})(?:\s*(?:diff|patch|udiff|text|txt))?\s*$/i.test(trimmed)) return true;
        if (/^(?:BEGIN_FORGE_UNIFIED_DIFF|END_FORGE_UNIFIED_DIFF)$/i.test(trimmed)) return true;
        if (/^(?:diff|patch|udiff|text|txt|code|copy|copy code|content_copy|download|play_circle|expand_less|expand_more)$/i.test(trimmed)) return true;
        return false;
    },

    _parseUnifiedDiffHunks(diffText) {
        const text = this._extractUnifiedDiffText(diffText);
        if (!text.trim()) return [];
        const lines = text.split('\n');
        const hunks = [];
        let current = null;
        for (const rawLine of lines) {
            const line = String(rawLine || '');
            if (this._isUnifiedDiffNoiseLine(line)) continue;

            const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
            if (hunkMatch) {
                if (current) hunks.push(current);
                current = {
                    header: line,
                    oldStart: parseInt(hunkMatch[1], 10),
                    oldCount: hunkMatch[2] == null ? 1 : parseInt(hunkMatch[2], 10),
                    newStart: parseInt(hunkMatch[3], 10),
                    newCount: hunkMatch[4] == null ? 1 : parseInt(hunkMatch[4], 10),
                    lines: []
                };
                continue;
            }

            if (!current) continue;
            if (line === '\\ No newline at end of file') continue;
            if (line === '') continue;

            const prefix = line[0];
            const body = line.slice(1);
            if (prefix === ' ') {
                current.lines.push({ type: 'context', text: body });
            } else if (prefix === '-') {
                current.lines.push({ type: 'remove', text: body });
            } else if (prefix === '+') {
                current.lines.push({ type: 'add', text: body });
            } else {
                current.lines.push({ type: 'context', text: line });
            }
        }
        if (current) hunks.push(current);
        return hunks.filter(hunk => hunk.lines.some(line => line.type === 'context' || line.type === 'remove' || line.type === 'add'));
    },

    _repairMarkdownEscapedDiffLine(line) {
        return String(line || '').replace(/\\([\\`*_{}\[\]()#+.!<>|-])/g, '$1');
    },

    _hunkOldLines(hunk, repairMarkdownEscapes) {
        const out = [];
        for (const line of (hunk && hunk.lines) || []) {
            if (line.type === 'context' || line.type === 'remove') {
                const text = String(line.text || '');
                out.push(repairMarkdownEscapes ? this._repairMarkdownEscapedDiffLine(text) : text);
            }
        }
        return out;
    },

    _hunkNewLines(hunk, repairMarkdownEscapes) {
        const out = [];
        for (const line of (hunk && hunk.lines) || []) {
            if (line.type === 'context' || line.type === 'add') {
                const text = String(line.text || '');
                out.push(repairMarkdownEscapes ? this._repairMarkdownEscapedDiffLine(text) : text);
            }
        }
        return out;
    },

    _splitPatchContent(content) {
        const text = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        return {
            lines: text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n'),
            hadFinalNewline: text.endsWith('\n')
        };
    },

    _joinPatchContent(lines, hadFinalNewline) {
        let out = lines.join('\n');
        if (hadFinalNewline) out += '\n';
        return out;
    },

    _patchLinesMatchAt(lines, needle, index, normalize) {
        if (index < 0 || index + needle.length > lines.length) return false;
        const norm = typeof normalize === 'function' ? normalize : value => String(value || '');
        for (let i = 0; i < needle.length; i++) {
            if (norm(lines[index + i]) !== norm(needle[i])) return false;
        }
        return true;
    },

    _findPatchLineSequence(lines, needle, preferredIndex, normalize) {
        if (!needle.length) return Math.max(0, Math.min(lines.length, preferredIndex));
        const maxIndex = lines.length - needle.length;
        if (maxIndex < 0) return -1;
        const preferred = Math.max(0, Math.min(maxIndex, preferredIndex || 0));
        if (this._patchLinesMatchAt(lines, needle, preferred, normalize)) return preferred;

        const windowSize = 40;
        const start = Math.max(0, preferred - windowSize);
        const end = Math.min(maxIndex, preferred + windowSize);
        for (let i = start; i <= end; i++) {
            if (i !== preferred && this._patchLinesMatchAt(lines, needle, i, normalize)) return i;
        }
        for (let i = 0; i <= maxIndex; i++) {
            if (i >= start && i <= end) continue;
            if (this._patchLinesMatchAt(lines, needle, i, normalize)) return i;
        }
        return -1;
    },

    _findPatchLineSequenceFlexible(lines, needle, preferredIndex) {
        const normalizers = [
            value => String(value || ''),
            value => String(value || '').replace(/[ \t]+$/g, ''),
            value => String(value || '').trim()
        ];
        for (const normalize of normalizers) {
            const index = this._findPatchLineSequence(lines, needle, preferredIndex, normalize);
            if (index >= 0) return index;
        }
        return -1;
    },

    _meaningfulPatchLines(lines) {
        return (lines || [])
            .map((text, index) => ({ text: String(text || ''), index }))
            .filter(item => item.text.trim().length >= 2 && !/^[{}()[\];,.:]+$/.test(item.text.trim()));
    },

    _findPatchAnchorBefore(lines, anchorLines, preferredIndex) {
        if (!anchorLines.length) return { index: Math.max(0, Math.min(lines.length, preferredIndex || 0)), strength: 0 };
        const fullIndex = this._findPatchLineSequenceFlexible(lines, anchorLines, preferredIndex);
        if (fullIndex >= 0) return { index: fullIndex + anchorLines.length, strength: anchorLines.length >= 2 ? 3 : 2 };
        const meaningful = this._meaningfulPatchLines(anchorLines);
        if (!meaningful.length) return null;
        const last = meaningful[meaningful.length - 1];
        const index = this._findPatchLineSequenceFlexible(lines, [last.text], (preferredIndex || 0) + last.index);
        return index >= 0 ? { index: index + 1, strength: 1 } : null;
    },

    _findPatchAnchorAfter(lines, anchorLines, minIndex, preferredIndex) {
        if (!anchorLines.length) return { index: Math.max(0, Math.min(lines.length, preferredIndex || 0)), strength: 0 };
        const fullIndex = this._findPatchLineSequenceFlexible(lines, anchorLines, preferredIndex);
        if (fullIndex >= minIndex) return { index: fullIndex, strength: anchorLines.length >= 2 ? 3 : 2 };
        const meaningful = this._meaningfulPatchLines(anchorLines);
        if (!meaningful.length) return null;
        const first = meaningful[0];
        const index = this._findPatchLineSequenceFlexible(lines, [first.text], (preferredIndex || 0) + first.index);
        return index >= minIndex ? { index, strength: 1 } : null;
    },

    _hunkChangeSegments(hunk, repairMarkdownEscapes) {
        const hunkLines = Array.isArray(hunk && hunk.lines) ? hunk.lines : [];
        const mapText = line => {
            const text = String(line && line.text || '');
            return repairMarkdownEscapes ? this._repairMarkdownEscapedDiffLine(text) : text;
        };
        const segments = [];
        let i = 0;
        while (i < hunkLines.length) {
            while (i < hunkLines.length && hunkLines[i] && hunkLines[i].type === 'context') i++;
            if (i >= hunkLines.length) break;
            const start = i;
            while (i < hunkLines.length && hunkLines[i] && hunkLines[i].type !== 'context') i++;
            const end = i - 1;

            let beforeStart = start - 1;
            while (beforeStart >= 0 && hunkLines[beforeStart] && hunkLines[beforeStart].type === 'context') beforeStart--;
            beforeStart++;
            let afterEnd = end + 1;
            while (afterEnd < hunkLines.length && hunkLines[afterEnd] && hunkLines[afterEnd].type === 'context') afterEnd++;

            const changed = hunkLines.slice(start, end + 1);
            segments.push({
                before: hunkLines.slice(beforeStart, start).map(mapText),
                after: hunkLines.slice(end + 1, afterEnd).map(mapText),
                oldLines: changed.filter(line => line && line.type === 'remove').map(mapText),
                newLines: changed.filter(line => line && line.type === 'add').map(mapText)
            });
        }
        return segments;
    },

    _applyHunkBySegments(lines, hunk, preferredIndex, repairMarkdownEscapes) {
        const segments = this._hunkChangeSegments(hunk, repairMarkdownEscapes);
        if (!segments.length) return null;
        let working = lines.slice();
        let cursor = preferredIndex || 0;
        let changed = false;

        for (const segment of segments) {
            let index = segment.oldLines.length
                ? this._findPatchLineSequenceFlexible(working, segment.oldLines, cursor)
                : -1;
            if (index >= 0) {
                let removeLength = segment.oldLines.length;
                if (!segment.newLines.length && segment.before.length && segment.after.length) {
                    const before = this._findPatchAnchorBefore(working, segment.before, cursor);
                    const after = this._findPatchAnchorAfter(working, segment.after, index + segment.oldLines.length, index + segment.oldLines.length);
                    const anchoredLength = after && after.index >= index ? after.index - index : removeLength;
                    const maxRegionLength = Math.max(segment.oldLines.length * 3 + 80, segment.oldLines.length + 160, 240);
                    if (before && before.index === index && anchoredLength > removeLength && anchoredLength <= maxRegionLength) {
                        removeLength = anchoredLength;
                    }
                }
                working.splice(index, removeLength, ...segment.newLines);
                cursor = index + segment.newLines.length;
                changed = true;
                continue;
            }

            if (segment.newLines.length) {
                const existingIndex = this._findPatchLineSequenceFlexible(working, segment.newLines, cursor);
                if (existingIndex >= 0) {
                    cursor = existingIndex + segment.newLines.length;
                    continue;
                }
            }

            const before = this._findPatchAnchorBefore(working, segment.before, cursor);
            if (!before) return null;
            const afterPreferred = before.index + Math.max(segment.oldLines.length, 0);
            const after = this._findPatchAnchorAfter(working, segment.after, before.index, afterPreferred);
            if (!after || after.index < before.index) return null;
            const regionLength = after.index - before.index;
            const maxRegionLength = Math.max(segment.oldLines.length * 3 + 80, segment.oldLines.length + 160, 240);
            if (regionLength > maxRegionLength) return null;

            working.splice(before.index, regionLength, ...segment.newLines);
            cursor = before.index + segment.newLines.length;
            changed = true;
        }

        return changed ? working : null;
    },

    _makeSimpleHash(text) {
        const value = String(text || '');
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    },

    _diffDebugPreviewLines(lines, index, radius) {
        const arr = Array.isArray(lines) ? lines : [];
        const center = Number.isFinite(index) ? index : 0;
        const r = Number.isFinite(radius) ? radius : 8;
        const start = Math.max(0, center - r);
        const end = Math.min(arr.length, center + r + 1);
        return arr.slice(start, end).map((text, offset) => ({
            line: start + offset + 1,
            text: String(text || '')
        }));
    },

    _summarizeDiffHunkForDebug(hunk, index) {
        const oldLinesRaw = this._hunkOldLines(hunk, false);
        const newLinesRaw = this._hunkNewLines(hunk, false);
        const oldLinesRepaired = this._hunkOldLines(hunk, true);
        const newLinesRepaired = this._hunkNewLines(hunk, true);
        return {
            index: index + 1,
            header: hunk && hunk.header || '',
            oldStart: hunk && hunk.oldStart,
            oldCount: hunk && hunk.oldCount,
            newStart: hunk && hunk.newStart,
            newCount: hunk && hunk.newCount,
            parsedLineTypes: (hunk && hunk.lines || []).map(line => line && line.type),
            oldLinesRaw,
            newLinesRaw,
            oldLinesMarkdownRepaired: oldLinesRepaired,
            newLinesMarkdownRepaired: newLinesRepaired,
            markdownRepairChangesOld: oldLinesRaw.join('\n') !== oldLinesRepaired.join('\n'),
            markdownRepairChangesNew: newLinesRaw.join('\n') !== newLinesRepaired.join('\n')
        };
    },

    _createDiffDebugTrace(content, diffText, meta, hunks) {
        const sourceText = String(content || '');
        const diff = String(diffText || '');
        const parsed = this._splitPatchContent(sourceText);
        return {
            id: ++this._diffDebugSeq,
            createdAt: new Date().toISOString(),
            path: meta && meta.path ? String(meta.path) : '',
            tool: 'replaceInFile.diff',
            status: 'running',
            originalContent: sourceText,
            originalContentHash: this._makeSimpleHash(sourceText),
            originalLineCount: parsed.lines.length === 1 && parsed.lines[0] === '' && !parsed.hadFinalNewline ? 0 : parsed.lines.length,
            diffText: diff,
            diffHash: this._makeSimpleHash(diff),
            extractedDiffText: this._extractUnifiedDiffText(diff),
            extractedDiffHash: this._makeSimpleHash(this._extractUnifiedDiffText(diff)),
            parsedHunks: (hunks || []).map((hunk, index) => this._summarizeDiffHunkForDebug(hunk, index)),
            logs: [],
            result: null,
            finalContent: '',
            finalContentHash: '',
            failureContext: null
        };
    },

    _recordDiffDebugLog(trace, message, data) {
        if (!trace) return;
        const entry = {
            step: trace.logs.length + 1,
            message: String(message || ''),
            data: data || null
        };
        trace.logs.push(entry);
        try {
            console.log('[Forge diff debug #' + trace.id + '] ' + entry.message, entry.data || '');
        } catch (_) {
            // no-op
        }
    },

    _appendMarkdownFence(lines, language, text) {
        const value = String(text || '');
        const matches = value.match(/`+/g) || [];
        const longest = matches.reduce((max, run) => Math.max(max, run.length), 0);
        const fence = '`'.repeat(Math.max(3, longest + 1));
        lines.push(fence + (language ? String(language) : ''));
        lines.push(value);
        lines.push(fence);
    },

    _formatLastDiffDebugPackage() {
        const trace = this._lastDiffDebugPackage;
        if (!trace && window.aiResponseImporter && typeof window.aiResponseImporter.formatLastDiffDebugPackage === 'function') {
            return window.aiResponseImporter.formatLastDiffDebugPackage();
        }
        if (!trace) {
            return [
                '# Forge Unified Diff Debug Package',
                '',
                'No diff debug package has been captured yet.',
                'Run an AI edit that uses replaceInFile with a diff, or paste/analyze/apply a diff in the AI response importer, then press Ctrl+Shift+Alt+D again.'
            ].join('\n');
        }

        const lines = [];
        lines.push('# Forge Unified Diff Debug Package');
        lines.push('');
        lines.push('Use this package to debug Forge/Prometheus unified-diff parsing and application failures.');
        lines.push('');
        lines.push('## Metadata');
        this._appendMarkdownFence(lines, 'json', JSON.stringify({
            id: trace.id,
            createdAt: trace.createdAt,
            path: trace.path,
            tool: trace.tool,
            status: trace.status,
            originalLineCount: trace.originalLineCount,
            originalContentHash: trace.originalContentHash,
            diffHash: trace.diffHash,
            extractedDiffHash: trace.extractedDiffHash,
            parsedHunkCount: trace.parsedHunks.length,
            result: trace.result
        }, null, 2));
        lines.push('');
        lines.push('## Diff Analysis');
        this._appendMarkdownFence(lines, 'json', JSON.stringify({
            parsedHunks: trace.parsedHunks,
            logs: trace.logs,
            failureContext: trace.failureContext
        }, null, 2));
        lines.push('');
        lines.push('## Code Being Edited');
        this._appendMarkdownFence(lines, '', trace.originalContent);
        lines.push('');
        lines.push('## Raw Diff Input');
        this._appendMarkdownFence(lines, 'diff', trace.diffText);
        lines.push('');
        lines.push('## Extracted Diff Input');
        this._appendMarkdownFence(lines, 'diff', trace.extractedDiffText);
        lines.push('');
        if (trace.finalContent) {
            lines.push('## Final Or Partial Content After Applying Hunks');
            this._appendMarkdownFence(lines, '', trace.finalContent);
            lines.push('');
        }
        lines.push('## Debugging Prompt');
        lines.push('The Forge unified-diff applier failed or behaved unexpectedly. Analyze the original code, raw diff, parsed hunk analysis, and per-hunk logs. Identify why a later chunk fails after earlier chunks are applied, then propose a robust parser/apply fix.');
        return lines.join('\n');
    },

    async copyLastDiffDebugPackage() {
        if (!this._lastDiffDebugPackage && window.aiResponseImporter && typeof window.aiResponseImporter.copyLastDiffDebugPackage === 'function') {
            return window.aiResponseImporter.copyLastDiffDebugPackage();
        }
        const packageText = this._formatLastDiffDebugPackage();
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(packageText);
                addAIChatMessage('system', 'Copied unified-diff debug package to clipboard.');
                return true;
            }
        } catch (_) {
            // Fall through to textarea copy fallback.
        }

        try {
            const ta = document.createElement('textarea');
            ta.value = packageText;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.left = '-10000px';
            ta.style.top = '-10000px';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, ta.value.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            addAIChatMessage('system', ok ? 'Copied unified-diff debug package to clipboard.' : 'Could not copy unified-diff debug package.');
            return !!ok;
        } catch (err) {
            addAIChatMessage('system', 'Could not copy unified-diff debug package: ' + (err && err.message ? err.message : err));
            return false;
        }
    },

    /**
     * Fuzzy replacer chain (OpenCode pattern).
     * Attempts multiple strategies to find `needle` in `haystack`, returning the
     * replaced string on success or null on failure.  Strategies are tried in order
     * of reliability; the first match wins.
     *
     * Strategies:
     *  1. Exact           – literal string match (fastest, most reliable)
     *  2. LineTrimmed     – trim trailing whitespace per-line before comparing
     *  3. WhitespaceNorm  – collapse all runs of whitespace to single space
     *  4. IndentFlex      – strip leading whitespace, match on content only
     *  5. BlockAnchor     – use first and last 3 non-blank lines as anchors
     */
    _fuzzyReplace(haystack, needle, replacement) {
        // -- Strategy 1: Exact match (already checked by caller, but kept for completeness)
        if (haystack.includes(needle)) {
            return { content: haystack.split(needle).join(replacement), strategy: 'exact' };
        }

        // Helper: find a contiguous range of lines in target that match given normalised lines
        const findLineRange = (targetLines, normalisedNeedle, normFn) => {
            const needleLines = normalisedNeedle.split('\n');
            if (!needleLines.length) return null;
            for (let i = 0; i <= targetLines.length - needleLines.length; i++) {
                let match = true;
                for (let j = 0; j < needleLines.length; j++) {
                    if (normFn(targetLines[i + j]) !== needleLines[j]) { match = false; break; }
                }
                if (match) return { start: i, end: i + needleLines.length };
            }
            return null;
        };

        const hayLines = haystack.split('\n');

        // -- Strategy 2: Line-trimmed (trim trailing whitespace per line)
        {
            const normFn = l => l.trimEnd();
            const normNeedle = needle.split('\n').map(normFn).join('\n');
            const range = findLineRange(hayLines, normNeedle, normFn);
            if (range) {
                const before = hayLines.slice(0, range.start);
                const after = hayLines.slice(range.end);
                return { content: [...before, ...replacement.split('\n'), ...after].join('\n'), strategy: 'line-trimmed' };
            }
        }

        // -- Strategy 3: Whitespace-normalised (collapse whitespace runs)
        {
            const normFn = l => l.replace(/\s+/g, ' ').trim();
            const normNeedle = needle.split('\n').map(normFn).join('\n');
            const range = findLineRange(hayLines, normNeedle, normFn);
            if (range) {
                const before = hayLines.slice(0, range.start);
                const after = hayLines.slice(range.end);
                return { content: [...before, ...replacement.split('\n'), ...after].join('\n'), strategy: 'whitespace-normalised' };
            }
        }

        // -- Strategy 4: Indentation-flexible (strip all leading whitespace)
        {
            const normFn = l => l.trimStart();
            const normNeedle = needle.split('\n').map(normFn).join('\n');
            const range = findLineRange(hayLines, normNeedle, normFn);
            if (range) {
                const before = hayLines.slice(0, range.start);
                const after = hayLines.slice(range.end);
                return { content: [...before, ...replacement.split('\n'), ...after].join('\n'), strategy: 'indent-flex' };
            }
        }

        // -- Strategy 5: Block anchor (first/last 3 non-blank lines as anchors)
        {
            const needleLines = needle.split('\n');
            const nonBlank = needleLines.map((l, i) => ({ l: l.trim(), i })).filter(x => x.l.length > 0);
            if (nonBlank.length >= 4) {
                const anchorCount = Math.min(3, Math.floor(nonBlank.length / 2));
                const headAnchors = nonBlank.slice(0, anchorCount).map(x => x.l);
                const tailAnchors = nonBlank.slice(-anchorCount).map(x => x.l);
                const trimmedHay = hayLines.map(l => l.trim());

                // Find starting position matching head anchors
                for (let i = 0; i <= trimmedHay.length - needleLines.length; i++) {
                    let headOk = true;
                    let hIdx = i;
                    for (const a of headAnchors) {
                        while (hIdx < trimmedHay.length && trimmedHay[hIdx].length === 0) hIdx++;
                        if (hIdx >= trimmedHay.length || trimmedHay[hIdx] !== a) { headOk = false; break; }
                        hIdx++;
                    }
                    if (!headOk) continue;

                    // Search for tail anchors within a reasonable window
                    const maxEnd = Math.min(i + needleLines.length + 5, trimmedHay.length);
                    for (let e = maxEnd; e >= hIdx; e--) {
                        let tailOk = true;
                        let tIdx = e;
                        for (let t = tailAnchors.length - 1; t >= 0; t--) {
                            tIdx--;
                            while (tIdx >= i && trimmedHay[tIdx].length === 0) tIdx--;
                            if (tIdx < i || trimmedHay[tIdx] !== tailAnchors[t]) { tailOk = false; break; }
                        }
                        if (tailOk) {
                            const before = hayLines.slice(0, i);
                            const after = hayLines.slice(e);
                            return { content: [...before, ...replacement.split('\n'), ...after].join('\n'), strategy: 'block-anchor' };
                        }
                    }
                }
            }
        }

        return null; // No strategy matched
    },

    _applyUnifiedDiffToContent(content, diffText, meta) {
        const hunks = this._parseUnifiedDiffHunks(diffText);
        const trace = this._createDiffDebugTrace(content, diffText, meta || {}, hunks);
        this._lastDiffDebugPackage = trace;
        this._recordDiffDebugLog(trace, 'Parsed unified diff input.', {
            hunkCount: hunks.length,
            path: trace.path || null,
            originalLineCount: trace.originalLineCount
        });
        if (!hunks.length) {
            trace.status = 'error';
            trace.result = { ok: false, reason: 'Unified diff did not contain any parseable hunks.' };
            return { ok: false, reason: 'Unified diff did not contain any parseable hunks.' };
        }
        const parsed = this._splitPatchContent(content);
        const lines = parsed.lines.length === 1 && parsed.lines[0] === '' && !parsed.hadFinalNewline ? [] : parsed.lines;
        let offset = 0;
        let applied = 0;
        for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
            const hunk = hunks[hunkIndex];
            let oldLines = this._hunkOldLines(hunk, false);
            let newLines = this._hunkNewLines(hunk, false);
            const oldStart = Number.isFinite(hunk.oldStart) ? hunk.oldStart : 1;
            const preferredIndex = Math.max(0, oldStart - 1 + offset);
            this._recordDiffDebugLog(trace, 'Starting hunk ' + (hunkIndex + 1) + '/' + hunks.length + '.', {
                header: hunk.header || '',
                oldStart,
                offset,
                preferredIndex,
                currentLineCount: lines.length,
                oldLineCount: oldLines.length,
                newLineCount: newLines.length,
                contextWindow: this._diffDebugPreviewLines(lines, preferredIndex, 6)
            });
            let index = this._findPatchLineSequenceFlexible(lines, oldLines, preferredIndex);
            if (index >= 0) {
                this._recordDiffDebugLog(trace, 'Hunk ' + (hunkIndex + 1) + ' matched direct/flexible context.', {
                    index,
                    line: index + 1
                });
            }

            if (index < 0) {
                const repairedOldLines = this._hunkOldLines(hunk, true);
                const repairedNewLines = this._hunkNewLines(hunk, true);
                const changedByRepair = repairedOldLines.join('\n') !== oldLines.join('\n')
                    || repairedNewLines.join('\n') !== newLines.join('\n');
                this._recordDiffDebugLog(trace, 'Hunk ' + (hunkIndex + 1) + ' direct match failed; checking markdown-escape repair.', {
                    changedByRepair,
                    repairedOldLineCount: repairedOldLines.length,
                    repairedNewLineCount: repairedNewLines.length
                });
                if (changedByRepair) {
                    const repairedIndex = this._findPatchLineSequenceFlexible(lines, repairedOldLines, preferredIndex);
                    if (repairedIndex >= 0) {
                        oldLines = repairedOldLines;
                        newLines = repairedNewLines;
                        index = repairedIndex;
                        this._recordDiffDebugLog(trace, 'Hunk ' + (hunkIndex + 1) + ' matched after markdown-escape repair.', {
                            index,
                            line: index + 1
                        });
                    } else {
                        this._recordDiffDebugLog(trace, 'Hunk ' + (hunkIndex + 1) + ' did not match after markdown-escape repair.', null);
                    }
                }
            }

            if (index < 0) {
                this._recordDiffDebugLog(trace, 'Hunk ' + (hunkIndex + 1) + ' trying segmented/context-anchor fallback.', {
                    rawSegments: this._hunkChangeSegments(hunk, false).map(segment => ({
                        beforeCount: segment.before.length,
                        oldCount: segment.oldLines.length,
                        newCount: segment.newLines.length,
                        afterCount: segment.after.length
                    })),
                    repairedSegments: this._hunkChangeSegments(hunk, true).map(segment => ({
                        beforeCount: segment.before.length,
                        oldCount: segment.oldLines.length,
                        newCount: segment.newLines.length,
                        afterCount: segment.after.length
                    }))
                });
                const segmented = this._applyHunkBySegments(lines, hunk, preferredIndex, false)
                    || this._applyHunkBySegments(lines, hunk, preferredIndex, true);
                if (segmented) {
                    const oldLength = lines.length;
                    lines.splice(0, lines.length, ...segmented);
                    offset += lines.length - oldLength;
                    applied++;
                    this._recordDiffDebugLog(trace, 'Hunk ' + (hunkIndex + 1) + ' applied with segmented/context-anchor fallback.', {
                        oldLineCount: oldLength,
                        newLineCount: lines.length,
                        offset,
                        applied
                    });
                    continue;
                }
                this._recordDiffDebugLog(trace, 'Hunk ' + (hunkIndex + 1) + ' segmented/context-anchor fallback failed.', null);
            }

            if (index < 0) {
                trace.status = 'error';
                trace.finalContent = this._joinPatchContent(lines, parsed.hadFinalNewline);
                trace.finalContentHash = this._makeSimpleHash(trace.finalContent);
                trace.failureContext = {
                    failedHunk: hunkIndex + 1,
                    header: hunk.header || '',
                    preferredIndex,
                    appliedBeforeFailure: applied,
                    currentLineCount: lines.length,
                    currentContentWindow: this._diffDebugPreviewLines(lines, preferredIndex, 14),
                    oldLinesRaw: this._hunkOldLines(hunk, false),
                    newLinesRaw: this._hunkNewLines(hunk, false),
                    oldLinesMarkdownRepaired: this._hunkOldLines(hunk, true),
                    newLinesMarkdownRepaired: this._hunkNewLines(hunk, true)
                };
                trace.result = {
                    ok: false,
                    reason: 'Diff hunk context not found in file (' + (hunk.header || 'unknown hunk') + ').',
                    applied: applied,
                    total: hunks.length
                };
                return {
                    ok: false,
                    reason: 'Diff hunk context not found in file (' + (hunk.header || 'unknown hunk') + ').',
                    applied: applied,
                    total: hunks.length
                };
            }

            lines.splice(index, oldLines.length, ...newLines);
            offset += newLines.length - oldLines.length;
            applied++;
            this._recordDiffDebugLog(trace, 'Hunk ' + (hunkIndex + 1) + ' applied by splice.', {
                index,
                removedLineCount: oldLines.length,
                insertedLineCount: newLines.length,
                offset,
                currentLineCount: lines.length,
                applied
            });
        }
        if (!applied) {
            trace.status = 'error';
            trace.result = { ok: false, reason: 'No diff hunks were applied.' };
            return { ok: false, reason: 'No diff hunks were applied.' };
        }
        const finalContent = this._joinPatchContent(lines, parsed.hadFinalNewline);
        trace.status = 'success';
        trace.finalContent = finalContent;
        trace.finalContentHash = this._makeSimpleHash(finalContent);
        trace.result = { ok: true, applied: applied, total: hunks.length };
        this._recordDiffDebugLog(trace, 'Finished unified diff apply.', trace.result);
        return { ok: true, content: finalContent, applied: applied, total: hunks.length };
    },


    // ══════════════════════════════════════════════════════════════════
    //  MESSAGE BUILDERS �" Construct format-correct messages
    // ══════════════════════════════════════════════════════════════════

    _capToolResult(text, maxChars) {
        // Cap large tool results to avoid blowing up the context
        const limit = maxChars || 12000; // ~3.5K tokens
        if (!text || text.length <= limit) return text;
        const half = Math.floor(limit / 2);
        return text.slice(0, half) + '\n\n... [' + Math.round((text.length - limit) / 1000) + 'K chars omitted] ...\n\n' + text.slice(-half);
    },

    _capToolResultNoReread(text, maxChars) {
        const limit = maxChars || 12000;
        if (!text || text.length <= limit) return text;
        const half = Math.floor(limit / 2);
        return text.slice(0, half) + '\n\n... [' + Math.round((text.length - limit) / 1000) + 'K chars omitted] ...\n\n' + text.slice(-half);
    },

    _isLikelyTextPath(path) {
        const p = String(path || '').trim();
        if (!p) return false;
        const ext = p.includes('.') ? p.split('.').pop().toLowerCase() : '';
        if (!ext) return true;
        const blocked = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'zip', 'gz', 'tar', '7z', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'mp3', 'wav', 'webm', 'mov', 'exe', 'dll', 'bin']);
        return !blocked.has(ext);
    },

    _extractPathsFromSearchResult(resultText) {
        const text = String(resultText || '');
        if (!text || /^no matches found/i.test(text) || /^error:/i.test(text)) return [];
        const out = [];
        const seen = new Set();
        const lines = text.split('\n');
        for (const raw of lines) {
            const line = String(raw || '').trim();
            if (!line) continue;
            const m = line.match(/^(.+?):(\d+):\s/);
            if (!m) continue;
            const path = String(m[1] || '').trim();
            if (!path || seen.has(path)) continue;
            if (!fileHandles[path]) continue;
            if (!this._isLikelyTextPath(path)) continue;
            seen.add(path);
            out.push(path);
            if (out.length >= 8) break;
        }
        return out;
    },

    _pickAutoReadPathFromSearchResults(results) {
        const list = Array.isArray(results) ? results : [];
        for (const r of list) {
            const paths = this._extractPathsFromSearchResult(r);
            for (const p of paths) {
                if (p !== this._lastAutoReadPath) return p;
            }
        }
        return '';
    },

    _buildToolResultMessages(toolCalls, results) {
        const fmt = this._detectFormat();
        const contracts = toolCalls.map((tc, i) => this._buildToolResultContract(tc && tc.name, tc && tc.args, results[i]));
        const capped = contracts.map(contract => this._toolResultContractToMessageContent(contract, 32000));
        if (fmt === 'anthropic') {
            return [{
                role: 'user',
                content: toolCalls.map((tc, i) => ({
                    type: 'tool_result',
                    tool_use_id: tc.id,
                    _toolArgs: tc.args,
                    _toolResultContract: contracts[i],
                    content: capped[i]
                }))
            }];
        }
        if (fmt === 'google') {
            return [{
                role: 'user',
                content: toolCalls.map((tc, i) => ({
                    type: 'tool_result',
                    _toolName: tc.name,
                    tool_use_id: tc.id,
                    _toolArgs: tc.args,
                    _toolResultContract: contracts[i],
                    content: capped[i]
                }))
            }];
        }
        // OpenAI
        return toolCalls.map((tc, i) => ({
            role: 'tool',
            tool_call_id: tc.id,
            _toolName: tc.name,
            _toolArgs: tc.args,
            _toolResultContract: contracts[i],
            content: capped[i]
        }));
    },

    _formatToolResultHistorySnippet(tc, result, maxChars) {
        const toolCall = tc || {};
        const name = String(toolCall.name || 'tool');
        const args = toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {};
        const limit = Number(maxChars) > 0 ? Number(maxChars) : 300;
        const pathPrefix = args.path ? ' path="' + String(args.path).replace(/"/g, '\\"') + '"' : '';
        const base = '[Tool ' + name + pathPrefix + ']: ';
        const resultText = this._toolResultToDisplayString(result);
        const body = resultText.length > limit ? resultText.slice(0, limit) : resultText;
        return base + body;
    },

    _toolResultToDisplayString(result) {
        if (result && typeof result === 'object' && typeof result.display === 'string') {
            return result.display;
        }
        return String(result || '');
    },

    _buildToolResultContract(name, args, result) {
        const toolName = String(name || '');
        const safeArgs = (args && typeof args === 'object') ? args : {};
        const text = this._toolResultToDisplayString(result);
        const lower = text.trim().toLowerCase();
        let status = 'ok';
        if (!text.trim()) status = 'empty';
        else if (lower.startsWith('error:') || lower.startsWith('validation error') || lower.startsWith('tool error')) status = 'error';
        else if (lower.includes('rejected')) status = 'rejected';
        else if (lower.startsWith('warning:')) status = 'warning';

        const contract = {
            tool: toolName,
            status: status,
            path: safeArgs.path ? String(safeArgs.path) : null,
            mutation: this._toolResultIndicatesMutation(toolName, text),
            summary: text.split('\n')[0].slice(0, 500),
            data: {}
        };

        if (toolName === 'readFile') {
            const numberedLines = text.split('\n').filter(line => /^\d+\| /.test(line));
            if (numberedLines.length) {
                const first = Number(numberedLines[0].split('|')[0]);
                const last = Number(numberedLines[numberedLines.length - 1].split('|')[0]);
                contract.data.returnedStartLine = Number.isFinite(first) ? first : null;
                contract.data.returnedEndLine = Number.isFinite(last) ? last : null;
            }
            const rangeMatch = text.match(/\[(?:Output capped at 50 KB\. )?Showing lines (\d+)-(\d+) of (\d+)\./);
            if (rangeMatch) {
                contract.data.returnedStartLine = Number(rangeMatch[1]);
                contract.data.returnedEndLine = Number(rangeMatch[2]);
                contract.data.totalLines = Number(rangeMatch[3]);
            } else if (contract.data.returnedEndLine != null) {
                contract.data.totalLines = contract.data.returnedEndLine;
            }
            contract.data.truncated = /\[Output capped at 50 KB\./.test(text) || /\[Showing lines \d+-\d+ of \d+\./.test(text);
            contract.data.content = text;
            if (contract.path) {
                const rangeText = (contract.data.returnedStartLine != null && contract.data.returnedEndLine != null)
                    ? (' lines ' + contract.data.returnedStartLine + '-' + contract.data.returnedEndLine
                        + (contract.data.totalLines != null ? (' of ' + contract.data.totalLines) : ''))
                    : '';
                contract.summary = 'Read ' + contract.path + rangeText + (contract.data.truncated ? ' (partial)' : '');
            }
        } else if (toolName === 'searchFiles') {
            contract.data.matches = text.split('\n').filter(line => /^\S.+:\d+:\s/.test(line)).slice(0, 25);
            contract.summary = contract.data.matches.length
                ? ('Search found ' + contract.data.matches.length + ' matches')
                : contract.summary;
        } else if (toolName === 'getActiveFile') {
            const activeMatch = text.match(/^Active file: (.+?) \((\d+) lines\)/m);
            if (activeMatch) {
                contract.path = activeMatch[1];
                contract.data.totalLines = Number(activeMatch[2]);
            }
            contract.data.content = text;
            if (contract.path) contract.summary = 'Loaded active file ' + contract.path;
        } else if (toolName === 'getProjectInfo') {
            contract.data.snapshot = text;
            contract.summary = 'Loaded project info';
        } else if (toolName === 'createCheckpoint') {
            const cpMatch = text.match(/^Checkpoint created: (.+)$/m);
            if (cpMatch) {
                contract.data.checkpointName = cpMatch[1];
                contract.summary = 'Created checkpoint ' + cpMatch[1];
            }
        } else if (toolName === 'updatePlan') {
            contract.data.planSummary = text;
            contract.summary = 'Updated plan';
        } else if (toolName === 'replaceInFile' || toolName === 'writeFile' || toolName === 'createFile' || toolName === 'deleteFile') {
            contract.data.resultText = text;
        }

        if (status === 'error' || status === 'rejected' || status === 'warning') {
            contract.data.blocker = text.slice(0, 1000);
        }
        return contract;
    },

    _toolResultContractToMessageContent(contract, maxChars) {
        const payload = contract && typeof contract === 'object'
            ? contract
            : {
                tool: 'tool',
                status: 'unknown',
                summary: this._toolResultToDisplayString(contract)
            };
        return this._capToolResultNoReread(this._formatDebugValue(payload, Math.max(2000, Number(maxChars) || 24000)), maxChars || 24000);
    },

    _buildAssistantMessage(parsed) {
        const fmt = this._detectFormat();
        if (fmt === 'anthropic' || fmt === 'google') {
            const blocks = [];
            if (parsed.text) blocks.push({ type: 'text', text: parsed.text });
            for (const tc of parsed.toolCalls) {
                const block = { type: 'tool_use', id: tc.id, name: tc.name, input: tc.args };
                // Carry through Google thought signature directly from the tool call
                if (tc.thoughtSignature) {
                    block._thoughtSignature = tc.thoughtSignature;
                }
                blocks.push(block);
            }
            return { role: 'assistant', content: blocks };
        }
        // OpenAI
        const msg = { role: 'assistant', content: parsed.text || null };
        if (parsed.toolCalls.length > 0) {
            msg.tool_calls = parsed.toolCalls.map(tc => ({
                id: tc.id, type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.args) }
            }));
        }
        return msg;
    },

    // ══════════════════════════════════════════════════════════════════
    //  CONTEXT MANAGEMENT �" Token estimation & compaction
    // ══════════════════════════════════════════════════════════════════

    _getTokenBudget() {
        const info = this._getModelInfo(this.getEffectiveModel());
        const ctx = info?.context || 200000;
        // 80% of context window, clamped to 60K-400K
        return Math.max(60000, Math.min(400000, Math.floor(ctx * 0.8)));
    },

    _estimateTokens(messages) {
        let chars = 0;
        for (const m of messages) {
            if (typeof m.content === 'string') chars += m.content.length;
            else if (Array.isArray(m.content)) {
                for (const block of m.content) {
                    chars += typeof block === 'string' ? block.length : JSON.stringify(block).length;
                }
            }
        }
        return Math.ceil(chars / 3.5);
    },

    _compactMessages(messages) {
        const leadingSystem = [];
        let firstNonSystem = 0;
        while (firstNonSystem < messages.length && messages[firstNonSystem] && messages[firstNonSystem].role === 'system') {
            leadingSystem.push(messages[firstNonSystem]);
            firstNonSystem++;
        }
        const convo = messages.slice(firstNonSystem);

        // Phase 1: Trim large tool results in older messages (keep last 6 intact)
        const keepRecent = 6;
        const trimBoundary = Math.max(0, convo.length - keepRecent);
        for (let i = 0; i < trimBoundary; i++) {
            const m = convo[i];
                if (typeof m.content === 'string' && m.content.length > 800) {
                    convo[i] = { ...m, content: m.content.slice(0, 400) + '\n... [truncated]' };
                } else if (Array.isArray(m.content)) {
                    convo[i] = {
                        ...m, content: m.content.map(block => {
                        if (block.content && typeof block.content === 'string' && block.content.length > 800) {
                            return { ...block, content: block.content.slice(0, 400) + '\n... [truncated]' };
                        }
                        return block;
                    })
                };
            }
        }

        const combined = [...leadingSystem, ...convo];
        if (this._estimateTokens(combined) <= this._getTokenBudget()) {
            return combined;
        }

        // Phase 2: Structured summarization (OpenCode pattern)
        // Keep system + last 6 messages, generate a structured summary of the middle
        if (convo.length <= 8) return combined;
        const middle = convo.slice(0, -6);
        const recent = convo.slice(-6);

        // --- Extract structured context from discarded messages ---
        const userGoals = [];
        const userInstructions = [];
        const discoveries = [];
        const accomplished = [];
        const failedAttempts = [];
        const filesRead = new Set();
        const filesModified = new Set();

        for (const m of middle) {
            const text = typeof m.content === 'string' ? m.content
                : (Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text || '').join('') : '');

            if (m.role === 'user') {
                // Distinguish user goals from tool results and system nudges
                if (text.startsWith('[Tool ')) {
                    // Tool result - extract file paths and notable content
                    const readMatch = text.match(/\[Tool readFile(?: path="([^"]+)")?\]:/);
                    if (readMatch && readMatch[1]) filesRead.add(readMatch[1].trim());
                    const writeMatch = text.match(/\[Tool (writeFile|replaceInFile|createFile|deleteFile)(?: path="([^"]+)")?\]:/);
                    if (writeMatch && writeMatch[2]) filesModified.add(writeMatch[2].trim());
                    // Extract errors from tool results
                    if (text.includes('Error:')) {
                        const errLine = text.split('\n').find(l => l.includes('Error:'));
                        if (errLine) failedAttempts.push(errLine.trim().slice(0, 200));
                    }
                } else if (text.startsWith('[SYSTEM')) {
                    // System nudges - skip
                } else if (text.length > 5) {
                    // Genuine user message - likely a goal or instruction
                    const trimmed = text.slice(0, 300).trim();
                    if (userGoals.length < 3) {
                        userGoals.push(trimmed);
                    } else {
                        userInstructions.push(trimmed.slice(0, 150));
                    }
                }
            } else if (m.role === 'assistant') {
                // Extract tool uses and their outcomes
                const tools = Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_use') : [];
                for (const t of tools) {
                    const path = t.input?.path || t.args?.path;
                    if (path && ['writeFile', 'replaceInFile', 'createFile', 'deleteFile'].includes(t.name)) {
                        filesModified.add(path);
                        accomplished.push(t.name + ' on ' + path);
                    }
                    if (path && t.name === 'readFile') filesRead.add(path);
                }
                // Extract assistant reasoning/decisions
                if (text && !text.startsWith('(') && text.length > 20 && accomplished.length < 10) {
                    const brief = text.slice(0, 200).trim();
                    if (brief.length > 20) discoveries.push(brief);
                }
                const toolResults = Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : [];
                for (const tr of toolResults) {
                    const contract = tr._toolResultContract;
                    if (contract && contract.path && contract.tool === 'readFile') filesRead.add(contract.path);
                    if (contract && contract.path && contract.mutation) filesModified.add(contract.path);
                }
            } else if (m.role === 'tool') {
                const contract = m._toolResultContract;
                if (contract && contract.path && contract.tool === 'readFile') filesRead.add(contract.path);
                if (contract && contract.path && contract.mutation) filesModified.add(contract.path);
                if (contract && contract.status === 'error' && contract.summary) {
                    failedAttempts.push(contract.summary.slice(0, 200));
                }
            }
        }

        // Build structured summary following OpenCode's compaction template
        let summary = '<context_summary>\n';
        summary += '<goal>\n';
        if (userGoals.length) {
            summary += userGoals.join('\n') + '\n';
        } else {
            summary += '(not explicitly stated in compacted messages)\n';
        }
        summary += '</goal>\n';

        if (userInstructions.length) {
            summary += '<instructions>\n';
            summary += userInstructions.slice(0, 5).join('\n') + '\n';
            summary += '</instructions>\n';
        }

        if (discoveries.length) {
            summary += '<discoveries>\n';
            const uniqueDisc = [...new Set(discoveries)].slice(0, 8);
            summary += uniqueDisc.join('\n') + '\n';
            summary += '</discoveries>\n';
        }

        if (accomplished.length) {
            summary += '<accomplished>\n';
            const uniqueAcc = [...new Set(accomplished)].slice(0, 15);
            summary += uniqueAcc.join('\n') + '\n';
            summary += '</accomplished>\n';
        }

        if (failedAttempts.length) {
            summary += '<failed_attempts>\n';
            summary += [...new Set(failedAttempts)].slice(0, 5).join('\n') + '\n';
            summary += 'Do NOT repeat these failed approaches.\n';
            summary += '</failed_attempts>\n';
        }

        summary += '<relevant_files>\n';
        if (filesRead.size) summary += 'Read: ' + [...filesRead].join(', ') + '\n';
        if (filesModified.size) summary += 'Modified: ' + [...filesModified].join(', ') + '\n';
        if (!filesRead.size && !filesModified.size) summary += '(none tracked)\n';
        summary += '</relevant_files>\n';

        summary += '</context_summary>\n';
        summary += 'IMPORTANT: Use the summary and recent messages first. Only call readFile again when exact compacted content is needed, the file changed, or a different line range is required.';

        return [
            ...leadingSystem,
            { role: 'user', content: summary },
            { role: 'assistant', content: 'Understood. I have the conversation context from the summary. Continuing with the task.' },
            ...recent
        ];
    },

    // ══════════════════════════════════════════════════════════════════
    //  STREAMING �" Parse SSE chunks for Anthropic/OpenAI
    // ══════════════════════════════════════════════════════════════════

    async _fetchStreaming(url, headers, body, signal) {
        const res = await fetch(url, {
            method: 'POST', headers,
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 300));
        }
        return res;
    },

    async _readStreamedResponse(res, fmt) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        const toolCalls = [];
        let currentToolCall = null;
        let stopReason = null;
        const container = document.getElementById('ai-chat-messages');

        // Create streaming message div
        const div = document.createElement('div');
        div.className = 'ai-msg assistant streaming';
        div.innerHTML = '<span class="stream-cursor"></span>';
        const shouldAutoScroll = this._shouldAutoScrollChat(container);
        if (container) {
            container.appendChild(div);
            this._scrollChatToBottom(container, shouldAutoScroll);
        }
        this._streamingDiv = div;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') { stopReason = 'stop'; continue; }

                    let parsed;
                    try { parsed = JSON.parse(data); } catch { continue; }

                    if (fmt === 'anthropic') {
                        // Anthropic streaming events
                        if (parsed.type === 'content_block_start') {
                            if (parsed.content_block?.type === 'tool_use') {
                                currentToolCall = { id: parsed.content_block.id, name: parsed.content_block.name, argsStr: '' };
                            }
                        } else if (parsed.type === 'content_block_delta') {
                            if (parsed.delta?.type === 'text_delta') {
                                fullText += parsed.delta.text;
                                const shouldAutoScroll = this._shouldAutoScrollChat(container);
                                div.innerHTML = this._renderMarkdown(fullText) + '<span class="stream-cursor"></span>';
                                this._scrollChatToBottom(container, shouldAutoScroll);
                            } else if (parsed.delta?.type === 'input_json_delta' && currentToolCall) {
                                currentToolCall.argsStr += parsed.delta.partial_json || '';
                            }
                        } else if (parsed.type === 'content_block_stop' && currentToolCall) {
                            currentToolCall.args = this._safeParse(currentToolCall.argsStr);
                            toolCalls.push({ id: currentToolCall.id, name: currentToolCall.name, args: currentToolCall.args });
                            currentToolCall = null;
                        } else if (parsed.type === 'message_delta') {
                            stopReason = parsed.delta?.stop_reason || stopReason;
                        }
                    } else if (fmt === 'google') {
                        // Google Gemini streaming �" each chunk is a full candidates object
                        const parts = parsed.candidates?.[0]?.content?.parts || [];
                        for (const part of parts) {
                            if (part.text) {
                                fullText += part.text;
                                const shouldAutoScroll = this._shouldAutoScrollChat(container);
                                div.innerHTML = this._renderMarkdown(fullText) + '<span class="stream-cursor"></span>';
                                this._scrollChatToBottom(container, shouldAutoScroll);
                            }
                            if (part.functionCall) {
                                toolCalls.push({
                                    id: 'gc_' + this._uid(),
                                    name: part.functionCall.name,
                                    args: part.functionCall.args || {},
                                    thoughtSignature: part.thoughtSignature || null
                                });
                            }
                        }
                        if (parsed.candidates?.[0]?.finishReason) {
                            stopReason = parsed.candidates[0].finishReason;
                        }
                    } else {
                        // OpenAI streaming format
                        const delta = parsed.choices?.[0]?.delta;
                        if (delta?.content) {
                            fullText += delta.content;
                            const shouldAutoScroll = this._shouldAutoScrollChat(container);
                            div.innerHTML = this._renderMarkdown(fullText) + '<span class="stream-cursor"></span>';
                            this._scrollChatToBottom(container, shouldAutoScroll);
                        }
                        if (delta?.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index ?? 0;
                                if (!toolCalls[idx]) {
                                    toolCalls[idx] = { id: tc.id || ('tc_' + idx), name: '', argsStr: '' };
                                }
                                if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                                if (tc.function?.arguments) toolCalls[idx].argsStr += tc.function.arguments;
                            }
                        }
                        if (parsed.choices?.[0]?.finish_reason) {
                            stopReason = parsed.choices[0].finish_reason;
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        // Finalize tool calls
        const finalToolCalls = toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            args: tc.args || this._safeParse(tc.argsStr),
            thoughtSignature: tc.thoughtSignature || null
        }));

        // Finalize streaming div �" remove if empty
        if (div) {
            div.classList.remove('streaming');
            if (fullText) {
                var gateInfo = this._getApprovalGateInfo(fullText);
                var needsApproval = !!gateInfo.needsApproval;
                var cleanedText = gateInfo.cleanedText || fullText;
                div.innerHTML = this._renderMarkdown(cleanedText || fullText);
                if (needsApproval) {
                    this._showApprovalGate(gateInfo, div);
                }
            } else {
                div.remove();
            }
        }
        this._streamingDiv = null;

        const result = { text: fullText, toolCalls: finalToolCalls, stopReason: stopReason || 'stop' };
        return result;
    },

    // ══════════════════════════════════════════════════════════════════
    //  RETRY WITH BACKOFF
    // ══════════════════════════════════════════════════════════════════

    _isRetryable(status) {
        return [429, 500, 502, 503, 529].includes(status);
    },

    async _fetchWithRetry(url, headers, body, signal) {
        let lastError;
        const isGoogle = /generativelanguage\.googleapis\.com/i.test(String(url || ''));
        const isAskSage = /capra\.flankspeed|asksage\.com|genai\.army\.mil/i.test(String(url || ''));
        const timeoutMs = isGoogle
            ? (this._runGoogleTimeoutMs || this.GOOGLE_REQUEST_TIMEOUT_MS)
            : isAskSage
                ? (this.ASKSAGE_REQUEST_TIMEOUT_MS || 300000)
                : (this._runRequestTimeoutMs || this.REQUEST_TIMEOUT_MS);
        const maxRetries = Math.max(1, Number(this._runMaxRetries || this.MAX_RETRIES) || this.MAX_RETRIES);
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            this._runApiAttempts++;
            this._updateUsageBadges();
            let timeoutId = null;
            const attemptController = new AbortController();
            const onAbort = () => attemptController.abort();
            if (signal) {
                if (signal.aborted) attemptController.abort();
                else signal.addEventListener('abort', onAbort, { once: true });
            }
            timeoutId = setTimeout(() => attemptController.abort(), timeoutMs);
            try {
                const attemptStartedAt = Date.now();
                if (isAskSage) {
                    this._askSageDebugLog('HTTP attempt start', {
                        attempt: attempt + 1,
                        maxRetries: maxRetries,
                        timeoutMs: timeoutMs,
                        url: url,
                        bodyKeys: body && typeof body === 'object' ? Object.keys(body) : [],
                        bodyPreview: this._formatDebugValue(body, 1200)
                    });
                }
                this._setActivity('waiting', attempt === 0 ? 'Waiting for API reply...' : 'Waiting for API retry reply...');
                const res = await fetch(url, {
                    method: 'POST', headers,
                    body: JSON.stringify(body),
                    signal: attemptController.signal
                });
                clearTimeout(timeoutId);
                if (signal) signal.removeEventListener('abort', onAbort);
                if (isAskSage) {
                    this._askSageDebugLog('HTTP attempt response', {
                        attempt: attempt + 1,
                        durationMs: Date.now() - attemptStartedAt,
                        status: res.status,
                        ok: res.ok,
                        retryable: this._isRetryable(res.status)
                    }, res.ok ? 'log' : 'warn');
                }
                if (res.ok) return res;
                const status = res.status;
                const errText = await res.text();
                if (!this._isRetryable(status) || attempt === maxRetries - 1) {
                    throw new Error('HTTP ' + status + ': ' + errText.slice(0, 300));
                }
                lastError = new Error('HTTP ' + status);
                // Exponential backoff with jitter
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                if (isAskSage) {
                    this._askSageDebugLog('HTTP retry scheduled', {
                        attempt: attempt + 1,
                        status: status,
                        delayMs: Math.round(delay),
                        errorPreview: errText.slice(0, 300)
                    }, 'warn');
                }
                addAIChatMessage('system', 'Rate limited (HTTP ' + status + '). Retrying in ' + Math.round(delay / 1000) + 's...');
                await new Promise(r => setTimeout(r, delay));
            } catch (e) {
                clearTimeout(timeoutId);
                if (signal) signal.removeEventListener('abort', onAbort);
                if (signal?.aborted) throw e;
                if (e.name === 'AbortError') {
                    const timeoutErr = new Error('Request timed out after ' + Math.round(timeoutMs / 1000) + 's');
                    timeoutErr.name = 'TimeoutError';
                    if (isAskSage) {
                        this._askSageDebugLog('HTTP attempt timeout', {
                            attempt: attempt + 1,
                            maxRetries: maxRetries,
                            timeoutMs: timeoutMs
                        }, 'warn');
                    }
                    if (attempt === maxRetries - 1) throw timeoutErr;
                    lastError = timeoutErr;
                    const delay = 1000 + Math.random() * 1000;
                    addAIChatMessage('system', 'Request timeout. Retrying in ' + Math.round(delay / 1000) + 's...');
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                if (isAskSage) {
                    this._askSageDebugLog('HTTP attempt error', {
                        attempt: attempt + 1,
                        maxRetries: maxRetries,
                        errorName: e && e.name ? e.name : 'Error',
                        errorMessage: e && e.message ? e.message : String(e)
                    }, 'warn');
                }
                if (attempt === maxRetries - 1) throw e;
                lastError = e;
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                addAIChatMessage('system', 'Network error. Retrying in ' + Math.round(delay / 1000) + 's...');
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastError || new Error('Max retries exceeded');
    },

    // ══════════════════════════════════════════════════════════════════
    //  UI HELPERS
    // ══════════════════════════════════════════════════════════════════

    _thinkingPhrases: {
        api: [
            'Packing the prompt for launch',
            'Sending burst to the API',
            'Holding for the API reply',
            'Reading the return signal',
            'Parsing the response payload',
            'Checking the response for tool calls'
        ]
    },

    _showThinking(stage) {
        const container = document.getElementById('ai-chat-messages');
        if (!container) return null;
        const div = document.createElement('div');
        div.className = 'ai-thinking';
        var phrases = this._thinkingPhrases[String(stage || 'api')] || this._thinkingPhrases.api;
        var phrase = phrases[Math.floor(Math.random() * phrases.length)];
        div.innerHTML = '<span class="ai-thinking-status">' + phrase + '</span><span class="ai-thinking-timer">0s</span>';
        this._appendChatElement(container, div);
        var startTime = Date.now();
        var phraseIdx = phrases.indexOf(phrase);
        div._thinkInterval = setInterval(function () {
            var elapsed = Math.floor((Date.now() - startTime) / 1000);
            var timerEl = div.querySelector('.ai-thinking-timer');
            if (timerEl) timerEl.textContent = elapsed + 's';
            // Rotate phrase every 4 seconds
            if (elapsed > 0 && elapsed % 4 === 0) {
                phraseIdx = (phraseIdx + 1) % phrases.length;
                var statusEl = div.querySelector('.ai-thinking-status');
                if (statusEl) statusEl.textContent = phrases[phraseIdx];
            }
        }, 1000);
        return div;
    },

    _hideThinking(el) {
        if (el) {
            if (el._thinkInterval) clearInterval(el._thinkInterval);
            if (el.parentNode) el.parentNode.removeChild(el);
        }
    },

    _shouldAutoScrollChat(container) {
        if (!container) return false;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return distanceFromBottom <= 24;
    },

    _scrollChatToBottom(container, shouldScroll) {
        if (container && shouldScroll) {
            container.scrollTop = container.scrollHeight;
        }
    },

    _appendChatElement(container, el, opts) {
        if (!container || !el) return;
        const force = !!(opts && opts.force);
        const shouldAutoScroll = force || this._shouldAutoScrollChat(container);
        container.appendChild(el);
        this._scrollChatToBottom(container, shouldAutoScroll);
    },

    _showToolCall(name, args) {
        const container = document.getElementById('ai-chat-messages');
        if (!container) return;
        let batch = this._activeToolBatchEl;
        if (!batch || !batch.isConnected) {
            const shouldAutoScroll = this._shouldAutoScrollChat(container);
            batch = document.createElement('div');
            batch.className = 'ai-msg tool-call tool-call-batch';
            batch.innerHTML =
                '<div class="tool-batch-header">' +
                '<svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M13.5 2.5l-3 3-1.5-1.5-3 3 1.5 1.5-3 3 1.4 1.4 3-3 1.5 1.5 3-3-1.5-1.5 3-3-1.4-1.4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path></svg> Tool activity' +
                '</div>' +
                '<div class="tool-batch-list"></div>';
            container.appendChild(batch);
            this._scrollChatToBottom(container, shouldAutoScroll);
            this._activeToolBatchEl = batch;
        }
        const list = batch.querySelector('.tool-batch-list');
        if (!list) return null;

        const div = document.createElement('details');
        div.className = 'tool-call-item';
        const argsStr = Object.entries(args || {}).map(([k, v]) => {
            const val = typeof v === 'string' ? (v.length > 80 ? v.slice(0, 80) + '...' : v) : JSON.stringify(v);
            return k + ': ' + val;
        }).join(', ');
        div.innerHTML =
            '<summary class="tool-call-header">' +
            '<svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M6 3L11 8L6 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg> ' +
            '<span style="color:var(--accent2)">Tool:</span> ' + escHtml(name) +
            (argsStr ? ' <span style="color:var(--text-dim)">(' + escHtml(argsStr) + ')</span>' : '') +
            '</summary>' +
            '<div class="tool-call-body"></div>';
        const shouldAutoScroll = this._shouldAutoScrollChat(container);
        list.appendChild(div);
        this._scrollChatToBottom(container, shouldAutoScroll);
        return div;
    },

    _showToolResult(div, result) {
        if (!div) return;
        const container = document.getElementById('ai-chat-messages');
        const shouldAutoScroll = this._shouldAutoScrollChat(container);
        const body = div.querySelector('.tool-call-body');
        if (body) {
            const truncated = result.length > 500 ? result.slice(0, 500) + '\n... (' + result.length + ' chars total)' : result;
            body.textContent = truncated;
        }
        this._scrollChatToBottom(container, shouldAutoScroll);
    },

    _setButtonState(busy) {
        this._busy = busy;
        const sendBtn = document.getElementById('ai-chat-send-btn');
        const redirectBtn = document.getElementById('ai-chat-redirect');
        const stopBtn = document.getElementById('ai-chat-stop');
        const inlineStopBtn = document.getElementById('ai-chat-stop-inline');
        if (sendBtn) {
            sendBtn.style.display = '';
            sendBtn.innerHTML = '<svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M2 8L14 2.5L11.2 13.5L7.4 8.6L2 8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"></path><path d="M7.4 8.6L14 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg>';
            sendBtn.className = 'ai-input-send-btn';
            sendBtn.title = busy ? 'Send redirect message' : 'Send message';
        }
        if (redirectBtn) redirectBtn.style.display = busy ? '' : 'none';
        if (stopBtn) stopBtn.style.display = busy ? '' : 'none';
        if (inlineStopBtn) inlineStopBtn.style.display = busy ? '' : 'none';
        // Reset input placeholder
        var input = document.getElementById('ai-chat-input');
        if (input && !busy) input.placeholder = 'Ask Prometheus... (Enter to send, Shift+Enter for newline)';
    },

    _isChatDiffEnabled() {
        return localStorage.getItem('forge:ai-show-chat-diff') !== '0';
    },

    toggleChatDiff(enabled) {
        const show = !!enabled;
        localStorage.setItem('forge:ai-show-chat-diff', show ? '1' : '0');
        document.querySelectorAll('.ai-chat-diff-preview').forEach(function (el) {
            el.style.display = show ? '' : 'none';
        });
    },

    toggleAutoAccept(enabled) {
        this._autoAcceptToggle = !!enabled;
        this._autoApproveRemaining = this._autoAcceptToggle;
        localStorage.setItem('forge:ai-auto-accept', this._autoAcceptToggle ? '1' : '0');
    },

    toggleHtmlAppMode(enabled) {
        this._htmlAppMode = enabled !== false;
        localStorage.setItem('forge:ai-html-app-mode', this._htmlAppMode ? '1' : '0');
        var label = document.getElementById('html-app-mode-label');
        if (label) label.classList.toggle('active', this._htmlAppMode);
    },

    _isSharePointAppTarget() {
        try {
            if (document.getElementById('sharepoint-compat-mode')?.checked) return true;
        } catch (_) { }
        try {
            if (typeof compiler !== 'undefined' && compiler && typeof compiler.canUseSharePointDeploy === 'function' && compiler.canUseSharePointDeploy()) {
                return true;
            }
        } catch (_) { }
        try {
            if (window._spPageContextInfo && typeof window._spPageContextInfo === 'object') return true;
        } catch (_) { }
        try {
            if (window.parent && window.parent !== window && window.parent._spPageContextInfo && typeof window.parent._spPageContextInfo === 'object') {
                return true;
            }
        } catch (_) { }
        return false;
    },

    _buildHtmlAppModePrompt() {
        if (!this._htmlAppMode) return '';
        const targetRuntime = this._isSharePointAppTarget()
            ? 'Target runtime: build for a static HTML app that should work offline when pulled down, and may also run inside SharePoint when the project/runtime already indicates that mode.'
            : 'Target runtime: build for a static HTML app that opens directly from file:// by default.';
        return `<html-app-mode>
${targetRuntime}
- Use plain HTML, CSS, and vanilla JavaScript files only unless the user explicitly asks to leave HTML App Mode.
- Do not use JavaScript modules, import/export, npm, bundlers, frameworks, or a server runtime.
- Any library you choose must still work when downloaded and shipped locally for offline use.
- CDN usage is acceptable during development only if that library can be pulled down and packaged locally later.
- Do not send project or user data anywhere over the network. The only exception is explicit SharePoint-context behavior that the user asks for or the project already indicates.
- Prefer local files, browser storage, and offline-safe browser APIs over hosted services.
</html-app-mode>`;
    },

    _applyLimits() {
        const stepsInput = document.getElementById('ai-max-steps');
        const timeoutInput = document.getElementById('ai-max-time');
        const maxSteps = Math.max(1, Math.min(200, Number(stepsInput && stepsInput.value) || 25));
        const timeoutMinutes = Math.max(1, Math.min(30, Number(timeoutInput && timeoutInput.value) || 5));
        const timeoutMs = timeoutMinutes * 60000;

        if (stepsInput) stepsInput.value = String(maxSteps);
        if (timeoutInput) timeoutInput.value = String(timeoutMinutes);

        this.MAX_API_CALLS_PER_RUN = maxSteps;
        this.MAX_TIME_MS = timeoutMs;
        this.REQUEST_TIMEOUT_MS = timeoutMs;
        this.ASKSAGE_REQUEST_TIMEOUT_MS = timeoutMs;
        this.GOOGLE_REQUEST_TIMEOUT_MS = timeoutMs;

        try { localStorage.setItem('forge:ai-max-steps', String(maxSteps)); } catch (_) { }
        try { localStorage.setItem('forge:ai-max-time', String(timeoutMinutes)); } catch (_) { }
    },


    _isExplicitPlanRequest(userMsg) {
        const text = String(userMsg || '').trim().toLowerCase();
        if (!text) return false;
        if (/^\s*plan\b/.test(text)) return true;
        if (/\b(plan mode|draft a plan|give me a plan|step[- ]by[- ]step plan|outline (the )?plan)\b/.test(text)) return true;
        if (/\b(before (you )?(execute|coding)|do not execute|don't execute|hold off|wait for approval)\b/.test(text)) return true;
        return false;
    },

    _isReadOnlyTool(name) {
        return name === 'listFiles'
            || name === 'readFile'
            || name === 'searchFiles'
            || name === 'getActiveFile'
            || name === 'getProjectInfo';
    },

    _isFileMutatingTool(name) {
        return name === 'writeFile'
            || name === 'createFile'
            || name === 'deleteFile'
            || name === 'replaceInFile'
            || name === 'saveProjectNote';
    },

    _toolResultIndicatesMutation(name, result) {
        const text = this._toolResultToDisplayString(result).trim().toLowerCase();
        if (!text) return false;
        if (text.startsWith('error:') || text.startsWith('tool error') || text.includes('rejected')) return false;
        if (name === 'writeFile') return text.includes('file written successfully:');
        if (name === 'createFile') return text.startsWith('created file:');
        if (name === 'deleteFile') return text.startsWith('deleted:');
        if (name === 'replaceInFile') return text.startsWith('replaced ');
        if (name === 'saveProjectNote') return text.includes('project notes saved');
        return false;
    },

    _isCompletionCue(text) {
        const t = String(text || '').toLowerCase();
        if (!t) return false;
        const positive = [
            'task is complete',
            'changes are complete',
            'all set',
            'completed',
            'finished',
            'implemented',
            'updated',
            'applied the changes',
            'done'
        ];
        const negative = [
            'not done',
            'not complete',
            'not finished',
            'still need',
            'next i will',
            'next step'
        ];
        if (!positive.some(p => t.includes(p))) return false;
        if (negative.some(n => t.includes(n))) return false;
        return true;
    },

    _getApprovalGateInfo(text) {
        const raw = String(text || '');
        const lower = raw.toLowerCase();
        if (!lower.trim()) return { needsApproval: false, isPlan: false, cleanedText: raw };

        const approvalPatterns = [
            'ready to execute this plan',
            'ready to execute this step',
            'shall i proceed',
            'should i continue',
            'ready to proceed',
            'does this plan look good',
            'want me to go ahead',
            'approve this plan',
            'approve the plan',
            'should i execute this plan',
            'want me to execute this plan',
            'would you like me to execute the plan',
            'awaiting approval',
            'with your approval',
            'once you approve'
        ];

        const phraseHit = approvalPatterns.some(function (p) { return lower.includes(p); });
        const approvalIntent = /\b(approve|approval|should i|shall i|want me to|would you like me to)\b/.test(lower);
        const actionIntent = /\b(execute|proceed|continue|go ahead|apply|implement|run)\b/.test(lower);
        const needsApprovalRaw = phraseHit || (approvalIntent && actionIntent);
        const isPlan = /\bplan\b/.test(lower) || /\bexecute this plan\b/.test(lower);
        const strongApprovalCue = /\b(approve|approval|awaiting approval)\b/.test(lower);
        const canShowGate = this._planMode || this._allowPlanApproval || strongApprovalCue;
        const needsApproval = needsApprovalRaw && canShowGate;

        let cleanedText = raw;
        if (needsApprovalRaw) {
            approvalPatterns.forEach(function (p) {
                var esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cleanedText = cleanedText.replace(new RegExp('\\*\\*\\s*' + esc + '\\s*\\*\\*', 'ig'), '');
                cleanedText = cleanedText.replace(new RegExp(esc, 'ig'), '');
            });
            cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();
        }

        return { needsApproval: needsApproval, isPlan: isPlan, cleanedText: cleanedText };
    },

    _updateUsageBadges(tokens) {
        if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0) {
            this._lastTokenEstimate = tokens;
        }

        const tokEl = document.getElementById('ai-token-counter');
        if (tokEl) {
            const used = Math.max(0, Math.round(this._lastTokenEstimate));
            const usedLabel = used >= 1000
                ? ('~' + (Math.round((used / 1000) * 10) / 10) + 'K tok')
                : (used + ' tok');
            const budget = this._getTokenBudget();
            const pct = budget > 0 ? (used / budget) : 0;
            tokEl.textContent = usedLabel;
            tokEl.style.color = pct > 0.8 ? 'var(--error, #e74c3c)' : pct > 0.5 ? 'var(--warning, orange)' : 'var(--text-dim)';
            tokEl.title = 'Estimated tokens used this run: ' + used.toLocaleString() + ' / ' + Math.round((budget || 0) / 1000) + 'K budget';
        }
    },

    _resetRunUsage() {
        this._runApiCalls = 0;
        this._runApiAttempts = 0;
        this._lastTokenEstimate = 0;
        this._updateUsageBadges(0);
    },

    _updateStepCounter(step, max, tokens) {
        const el = document.getElementById('ai-step-counter');
        if (el) {
            if (step <= 0) {
                el.style.display = 'none';
                el.textContent = '';
            } else {
                el.style.display = '';
                if (max > 0) {
                    el.textContent = 'Step ' + step + '/' + max;
                    el.style.color = step > max * 0.8 ? 'var(--warning, orange)' : '';
                } else {
                    el.textContent = 'Step ' + step;
                    el.style.color = '';
                }
            }
        }
        this._updateUsageBadges(tokens);
    },

    _askContinue(step, tokens) {
        return new Promise(resolve => {
            const container = document.getElementById('ai-chat-messages');
            if (!container) { resolve(false); return; }
            const div = document.createElement('div');
            div.className = 'ai-msg system';
            const tokStr = tokens > 0 ? ' (~' + Math.round(tokens / 1000) + 'K tokens used)' : '';
            div.innerHTML = '<div style="margin-bottom:6px">Reached ' + step + ' steps' + tokStr + '. Stopping this run.</div>';
            this._appendChatElement(container, div);
            resolve(false);
        });
    },

    // ══════════════════════════════════════════════════════════════════
    //  ATTACHMENTS �" Images and files
    // ══════════════════════════════════════════════════════════════════

    _pendingAttachment: null, // { type: 'image', mimeType, base64, name, previewUrl }

    handleAttachment(input) {
        const file = input.files?.[0];
        if (!file) return;
        input.value = ''; // reset for re-use
        const isImage = file.type.startsWith('image/');
        const reader = new FileReader();
        const self = this;

        if (isImage) {
            reader.onload = function () {
                const base64 = reader.result.split(',')[1];
                self._pendingAttachment = {
                    type: 'image',
                    mimeType: file.type,
                    base64: base64,
                    name: file.name,
                    previewUrl: reader.result
                };
                self._showAttachPreview();
            };
            reader.readAsDataURL(file);
        } else {
            reader.onload = function () {
                self._pendingAttachment = {
                    type: 'file',
                    mimeType: file.type || 'text/plain',
                    text: reader.result,
                    name: file.name
                };
                self._showAttachPreview();
            };
            reader.readAsText(file);
        }
    },

    handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                if (!blob) return;
                const reader = new FileReader();
                const self = this;
                reader.onload = function () {
                    const base64 = reader.result.split(',')[1];
                    self._pendingAttachment = {
                        type: 'image',
                        mimeType: blob.type,
                        base64: base64,
                        name: 'clipboard-image.png',
                        previewUrl: reader.result
                    };
                    self._showAttachPreview();
                };
                reader.readAsDataURL(blob);
                return;
            }
        }
    },

    _showAttachPreview() {
        const el = document.getElementById('ai-attach-preview');
        if (!el || !this._pendingAttachment) return;
        const a = this._pendingAttachment;
        if (a.type === 'image') {
            el.innerHTML = '<img src="' + a.previewUrl + '" class="ai-attach-thumb">' +
                '<span class="ai-attach-name">' + (typeof escHtml === 'function' ? escHtml(a.name) : a.name) + '</span>' +
                '<button class="ai-attach-remove" onclick="aiAgent.removeAttachment()" title="Remove">&times;</button>';
        } else {
            el.innerHTML = '<svg class="ai-inline-icon" viewBox="0 0 16 16"><path d="M13 5.5l-4-4H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1v-8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path><path d="M9 1.5v4h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path></svg> ' +
                '<span class="ai-attach-name">' + (typeof escHtml === 'function' ? escHtml(a.name) : a.name) + ' (' + Math.round(a.text.length / 1024) + 'KB)</span>' +
                '<button class="ai-attach-remove" onclick="aiAgent.removeAttachment()" title="Remove">&times;</button>';
        }
        el.style.display = 'flex';
    },

    removeAttachment() {
        this._pendingAttachment = null;
        const el = document.getElementById('ai-attach-preview');
        if (el) { el.innerHTML = ''; el.style.display = 'none'; }
    },

    _consumeAttachment() {
        const att = this._pendingAttachment;
        this._pendingAttachment = null;
        const el = document.getElementById('ai-attach-preview');
        if (el) { el.innerHTML = ''; el.style.display = 'none'; }
        return att;
    },

    _buildMultimodalUserMessage(text, attachment) {
        const fmt = this._detectFormat();

        if (fmt === 'anthropic') {
            // Anthropic: content is array of blocks
            const content = [];
            content.push({
                type: 'image',
                source: { type: 'base64', media_type: attachment.mimeType, data: attachment.base64 }
            });
            if (text) content.push({ type: 'text', text: text });
            return { role: 'user', content: content };
        }

        if (fmt === 'google') {
            // Google Gemini: parts array with inlineData
            const parts = [];
            parts.push({
                inlineData: { mimeType: attachment.mimeType, data: attachment.base64 }
            });
            if (text) parts.push({ text: text });
            return { role: 'user', content: parts, _multimodal: true };
        }

        // OpenAI format: content array with image_url
        const content = [];
        content.push({
            type: 'image_url',
            image_url: { url: 'data:' + attachment.mimeType + ';base64,' + attachment.base64 }
        });
        if (text) content.push({ type: 'text', text: text });
        return { role: 'user', content: content };
    },

    // ══════════════════════════════════════════════════════════════════
    //  PLAN MODE
    // ══════════════════════════════════════════════════════════════════

    togglePlanMode(enabled) {
        this._planMode = !!enabled;
        localStorage.setItem('forge:ai-plan-mode', this._planMode ? '1' : '0');
        var label = document.getElementById('plan-mode-label');
        if (label) label.classList.toggle('active', this._planMode);
        var inputRow = document.getElementById('ai-chat-input-row');
        if (inputRow) inputRow.classList.toggle('plan-mode', this._planMode);
        var input = document.getElementById('ai-chat-input');
        if (input) input.placeholder = this._planMode
            ? 'Plan mode: AI will describe changes without applying them...'
            : 'Ask Prometheus... (Enter to send, Shift+Enter for newline)';
        if (!this._planMode) {
            this._allowPlanApproval = false;
            this._setPlanActionButton(false);
        }
    },

    // ══════════════════════════════════════════════════════════════════
    //  ONLINE STATUS INDICATOR
    // ══════════════════════════════════════════════════════════════════

    _updateOnlineIndicator(state) {
        this._online = state;
        var dot = document.getElementById('ai-online-status');
        if (!dot) return;
        dot.className = 'ai-online-dot ' + (state === true ? 'online' : state === false ? 'offline' : 'unknown');
        dot.title = state === true ? 'API reachable' : state === false ? 'API unreachable (offline)' : 'Checking...';
    },

    _formatActivityLabel(state, title) {
        var raw = String(title || '').trim();
        if (!raw || state === 'idle') return '';
        if (state === 'error') return raw;
        if (/^Thinking\.\.\.$/i.test(raw)) return 'Sending prompt to API...';
        if (/^Continuing\.\.\.$/i.test(raw)) return 'Back on station...';
        if (/^Redirect pending\.\.\.$/i.test(raw)) return 'Queueing your redirect...';
        if (/^Redirecting\.\.\.$/i.test(raw)) return 'Passing the new orders...';
        if (/^Running (\d+) read-only tools\.\.\.$/i.test(raw)) {
            return raw.replace(/^Running (\d+) read-only tools\.\.\.$/i, 'Tool deck: running $1 read-only checks...');
        }
        if (/^Running (.+)\.\.\.$/i.test(raw)) {
            return raw.replace(/^Running (.+)\.\.\.$/i, 'Tool deck: $1...');
        }
        if (/^Auto-reading top search match\.\.\.$/i.test(raw)) return 'Chart room: opening the top search hit...';
        if (/^Waiting for approval\.\.\.(.*)$/i.test(raw)) {
            return raw.replace(/^Waiting for approval\.\.\.(.*)$/i, 'Holding for your approval...$1');
        }
        if (/^Waiting for plan approval\.\.\.$/i.test(raw)) return 'Holding for plan approval...';
        if (/^Waiting to continue\.\.\.$/i.test(raw)) return 'Holding for your next signal...';
        return raw;
    },

    _setActivity(state, title) {
        var dot = document.getElementById('ai-activity-indicator');
        var label = document.getElementById('ai-activity-label');
        var renderedTitle = this._formatActivityLabel(state, title);
        if (dot) {
            dot.className = 'ai-activity-dot ' + state;
            dot.title = renderedTitle || title || state;
        }
        if (label) label.textContent = (state === 'idle') ? '' : (renderedTitle || title || '');
    },

    _setPlanActionButton(show, isPlan) {
        var btn = document.getElementById('ai-plan-execute-btn');
        if (btn) btn.style.display = 'none';
        if (!show) {
            this._pendingPlanGate = null;
            if (btn) {
                btn.classList.remove('step-mode');
                btn.textContent = 'Execute Plan';
                bindManagedDomEvent(btn, 'click', 'athena-plan-action', () => this.approvePlan());
            }
            this._renderPlanUI();
            return;
        }
        var planModeGate = isPlan !== false;
        this._pendingPlanGate = { isPlan: planModeGate };
        this._planUiExpanded = true;
        if (btn) {
            btn.style.display = '';
            btn.classList.toggle('step-mode', !planModeGate);
            btn.title = planModeGate ? 'Execute pending plan' : 'Continue pending step';
            btn.innerHTML = planModeGate
                ? '<svg class="ai-inline-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5L12 8L5 12.5Z" fill="currentColor"></path></svg> Execute Plan'
                : '<svg class="ai-inline-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.8L11 8L6 12.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg> Continue Step';
            bindManagedDomEvent(btn, 'click', 'athena-plan-action', () => {
                if (this._pendingPlanGate && this._pendingPlanGate.isPlan) this.approvePlan();
                else this.continueStep();
            });
        }
        this._renderPlanUI();
    },

    startOnlineCheck() {
        var self = this;
        window.addEventListener('online', function () { self._updateOnlineIndicator(navigator.onLine); });
        window.addEventListener('offline', function () { self._updateOnlineIndicator(false); });
        // Initial state
        this._updateOnlineIndicator(navigator.onLine || null);
        // Periodic check every 30s
        if (this._onlineCheckInterval) clearInterval(this._onlineCheckInterval);
        this._onlineCheckInterval = setInterval(function () {
            self._updateOnlineIndicator(navigator.onLine);
        }, 30000);
    },

    // ══════════════════════════════════════════════════════════════════
    //  PLAN APPROVAL
    // ══════════════════════════════════════════════════════════════════

    approvePlan() {
        // Remove any existing plan approval buttons
        document.querySelectorAll('.ai-plan-approval').forEach(el => el.remove());
        this._setPlanActionButton(false);
        // Disable plan mode so write tools actually execute
        this._planMode = false;
        addAIChatMessage('system', 'Plan approved �" executing...');
        this.sendMessage(
            'Plan mode is now OFF. Execute the plan now � all write tools will apply changes for real. Reuse your prior discovery and do not repeat file scanning unless a tool error requires it.',
            { reuseDiscovery: true }
        );
    },

    continueStep() {
        document.querySelectorAll('.ai-plan-approval').forEach(el => el.remove());
        this._setPlanActionButton(false);
        addAIChatMessage('system', 'Continuing...');
        this.sendMessage(
            'Yes, continue. Reuse your prior discovery and avoid repeating scans unless needed.',
            { reuseDiscovery: true }
        );
    },

    _removeSafetyContinuePrompts() {
        document.querySelectorAll('.ai-safety-continue').forEach(el => el.remove());
    },

    /**
     * Show a recommendation to switch models after consecutive CAPRA timeouts.
     * Lists alternative AskSage models from the cache and renders clickable buttons.
     */
    _showModelSwitchRecommendation() {
        const container = document.getElementById('ai-chat-messages');
        if (!container) return;

        const currentModel = this.getEffectiveModel();
        const div = document.createElement('div');
        div.className = 'ai-msg system';
        div.style.cssText = 'border-left: 3px solid #f0ad4e; background: #fff8e1; padding: 12px;';

        let html = '<strong>? Consecutive Timeouts</strong><br>';
        html += 'The current model (<code>' + (currentModel || 'unknown') + '</code>) has timed out twice in a row. ';
        html += 'This usually means the model is overloaded or the response is too large for the timeout window.<br><br>';
        html += '<strong>Suggestions:</strong><br>';
        html += '� Try a different model � smaller or faster models tend to respond quicker<br>';
        html += '� Check your network connection to CAPRA<br><br>';

        // Collect alternative models from cache
        const altModels = [];
        if (this._askSageModelsCache && Array.isArray(this._askSageModelsCache.models)) {
            for (const m of this._askSageModelsCache.models) {
                const id = typeof m === 'string' ? m : (m && m.value ? m.value : '');
                if (id && id !== currentModel) altModels.push(id);
            }
        }

        // Show up to 5 alternative models as clickable buttons
        const suggestions = altModels.slice(0, 5);
        if (suggestions.length > 0) {
            html += '<strong>Switch model:</strong><br>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">';
            for (const modelId of suggestions) {
                html += '<button onclick="athenaAgent.switchActiveModel(\'' + modelId.replace(/'/g, "\\'") + '\')" '
                    + 'style="padding:4px 10px;border:1px solid #2a5298;border-radius:4px;background:#e8eef7;'
                    + 'color:#1e3c72;cursor:pointer;font-size:12px;font-weight:600;">'
                    + modelId + '</button>';
            }
            html += '</div>';
        } else {
            html += 'Open the config panel to choose a different model.';
        }

        div.innerHTML = html;
        this._appendChatElement(container, div);
    },

    _showSafetyContinuePrompt(reason) {
        const container = document.getElementById('ai-chat-messages');
        if (!container) return;
        this._removeSafetyContinuePrompts();
        const div = document.createElement('div');
        div.className = 'ai-msg system ai-safety-continue';
        const text = document.createElement('span');
        const cap = Math.max(1, Number(this.MAX_API_CALLS_PER_RUN) || 25);
        let reasonText = 'I\'ve reached the step limit for this run.';
        if (reason === 'timeout') reasonText = 'I\'ve reached the time limit for this run.';
        if (reason === 'api_cap') reasonText = 'I\'ve reached the API call limit (' + cap + ') for this run.';
        if (reason === 'error') reasonText = 'I hit a connection issue and stopped this run.';
        this._lastSafetyLimitReason = String(reason || 'limit');
        text.textContent = 'Prometheus: ' + reasonText + ' ';
        div.appendChild(text);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ai-inline-action-btn';
        btn.innerHTML = '<svg class="ai-inline-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.8L11 8L6 12.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg> Continue';
        btn.title = 'Resume this run from the preserved context';
        btn.addEventListener('click', () => this.continueAfterSafetyLimit());
        div.appendChild(btn);
        this._appendChatElement(container, div);
    },

    continueAfterSafetyLimit() {
        this._removeSafetyContinuePrompts();
        this._setPlanActionButton(false);
        addAIChatMessage('system', 'Continuing from the safety stop...');
        const reason = this._lastSafetyLimitReason || 'limit';
        this._lastSafetyLimitReason = '';
        this.sendMessage(
            '[SYSTEM RESUME]: Continue the in-progress task from the preserved context after the ' + reason + ' stop. Do not restart discovery. Use prior file content and tool results unless a file changed, content was compacted, or a different line range is required.',
            { reuseDiscovery: true, silentUserMessage: true, resumeSafetyLimit: true }
        );
    },

    revisePlan() {
        document.querySelectorAll('.ai-plan-approval').forEach(el => el.remove());
        this._setPlanActionButton(false);
        var input = document.getElementById('ai-chat-input');
        if (input) {
            input.focus();
            input.placeholder = 'Describe what to change in the plan...';
        }
    },

    // ══════════════════════════════════════════════════════════════════
    //  MESSAGE RECOVERY
    // ══════════════════════════════════════════════════════════════════

    checkPendingMessage() {
        var pending = sessionStorage.getItem('forge:ai-pending-msg');
        if (!pending) return;
        sessionStorage.removeItem('forge:ai-pending-msg');
    },

    // ══════════════════════════════════════════════════════════════════
    //  CHAT HISTORY PERSISTENCE
    // ══════════════════════════════════════════════════════════════════

    _persistChatHistory() {
        try {
            var toSave = aiChatHistory.slice(-50);
            localStorage.setItem('forge:ai-chat-history', JSON.stringify(toSave));
            // Also auto-save to active conversation
            if (this._activeConvId && aiChatHistory.length > 0) {
                this._saveConversation(this._activeConvId, this._autoTitle(aiChatHistory), aiChatHistory);
            }
        } catch (e) { /* localStorage full or disabled �" silently ignore */ }
    },

    _isSyntheticToolSummaryMessage(msg) {
        if (!msg || typeof msg.content !== 'string') return false;
        if (msg._hiddenFromChat === true) return true;

        // Backward compatibility for existing saved chats created before _hiddenFromChat.
        // Check if the first non-empty line starts with [Tool ...]: pattern.
        // Multi-line tool output (e.g. file contents) only has the prefix on the first line.
        if (msg.role !== 'user') return false;
        var content = msg.content.trim();
        if (!content) return false;
        var firstLine = content.split('\n')[0].trim();
        return /^\[Tool\s+[A-Za-z0-9_-]+\]:/i.test(firstLine);
    },

    _restoreChatHistory() {
        try {
            var saved = localStorage.getItem('forge:ai-chat-history');
            if (!saved) return;
            var parsed = JSON.parse(saved);
            if (!Array.isArray(parsed) || parsed.length === 0) return;
            aiChatHistory = parsed;
            if (!this._activeConvId) this._activeConvId = this._generateConvId();
            var renderedCount = 0;
            var hiddenCount = 0;
            for (var i = 0; i < aiChatHistory.length; i++) {
                var msg = aiChatHistory[i];
                if (this._isSyntheticToolSummaryMessage(msg)) {
                    hiddenCount++;
                    continue;
                }
                if (msg.role === 'user' || msg.role === 'assistant') {
                    addAIChatMessage(msg.role, msg.content);
                    renderedCount++;
                }
            }
            if (hiddenCount > 0) {
                addAIChatMessage('system', '(Restored ' + renderedCount + ' messages; hidden ' + hiddenCount + ' tool transcript messages)');
            } else {
                addAIChatMessage('system', '(Restored ' + renderedCount + ' messages from previous session)');
            }
        } catch (e) { /* corrupt data �" ignore */ }
    },

    // ══════════════════════════════════════════════════════════════════
    //  TOOL ARGUMENT VALIDATION
    // ══════════════════════════════════════════════════════════════════

    _validateToolArgs(name, args) {
        var defs = this._toolDefs();
        var def = null;
        for (var i = 0; i < defs.length; i++) {
            if (defs[i].name === name) { def = defs[i]; break; }
        }
        if (!def) return 'Unknown tool: ' + name;
        // Check required params
        for (var j = 0; j < def.required.length; j++) {
            var req = def.required[j];
            if (name === 'searchFiles' && req === 'pattern') {
                var hasPrimary = !(args.pattern === undefined || args.pattern === null || args.pattern === '');
                var hasSecondary = !(args.patterns === undefined || args.patterns === null || args.patterns === '');
                if (hasPrimary || hasSecondary) continue;
            }
            if (name === 'replaceInFile' && (req === 'find' || req === 'replace')) {
                var hasDiff = !(args.diff === undefined || args.diff === null || String(args.diff).trim() === '');
                if (hasDiff) continue;
            }
            if (args[req] === undefined || args[req] === null || args[req] === '') {
                return 'Missing required argument "' + req + '" for tool ' + name + '.';
            }
        }
        // Coerce types where possible
        var paramKeys = Object.keys(def.params);
        for (var k = 0; k < paramKeys.length; k++) {
            var key = paramKeys[k];
            if (args[key] === undefined) continue;
            if (name === 'searchFiles' && (key === 'pattern' || key === 'patterns') && Array.isArray(args[key])) continue;
            if (def.params[key].type === 'string' && typeof args[key] !== 'string') {
                args[key] = String(args[key]);
            }
        }
        return null; // valid
    },

    // ══════════════════════════════════════════════════════════════════
    //  ABORT
    // ══════════════════════════════════════════════════════════════════

    abort() {
        const wasActive = this._busy || !!this._abortController || !!this._pendingApproval;
        if (!wasActive) return;
        this._abortRequested = true;
        if (this._abortController) {
            this._abortController.abort();
        }
        if (this._pendingApproval && !this._pendingApproval.resolved) {
            this._resolvePendingApproval(false, 'stopped');
        }
        if (typeof mergeEditor !== 'undefined' && mergeEditor && mergeEditor._active) {
            try { mergeEditor.close(false); } catch (_) { }
        }
        this._setPlanActionButton(false);
        if (!this._autoAcceptToggle) this._autoApproveRemaining = false;
        // Clean up streaming div if active
        if (this._streamingDiv) {
            this._streamingDiv.classList.remove('streaming');
            this._streamingDiv = null;
        }
        this._pendingRedirect = null;
        const tokens = this._workingMessages && this._workingMessages.length
            ? this._estimateTokens(this._workingMessages)
            : 0;
        this._updateStepCounter(0, 0, tokens);
        this._setActivity('working', 'Stopping...');
        addAIChatMessage('system', 'Stopped. Context preserved �" send a message to continue or redirect.');
        // Focus input for quick redirect
        var input = document.getElementById('ai-chat-input');
        if (input) {
            input.focus();
            input.placeholder = 'Redirect Prometheus or continue...';
        }
    },

    // ══════════════════════════════════════════════════════════════════
    //  CLEAR CHAT
    // ══════════════════════════════════════════════════════════════════

    clearChat() {
        aiChatHistory = [];
        this._workingMessages = [];
        this._workingMemory = this._createWorkingMemory();
        this._readFiles.clear();
        this._clearDiscoveryCache(false);
        this._contextCompactionSeq = 0;
        this._projectFileSig = this._computeProjectFileSig();
        this._sessionCheckpointed = false;
        this._activeToolBatchEl = null;
        this._lastSafetyLimitReason = '';
        this._setPlanActionButton(false);
        if (!this._autoAcceptToggle) this._autoApproveRemaining = false;
        this._editingKeyProfileId = null;
        this._removeSafetyContinuePrompts();
        sessionStorage.removeItem('forge:ai-pending-msg');
        localStorage.removeItem('forge:ai-chat-history');
        this._resetRunUsage();
        this._updateStepCounter(0, 0, 0);
        const container = document.getElementById('ai-chat-messages');
        if (container) container.innerHTML = '';
        addAIChatMessage('system', 'Chat cleared. Starting fresh.');
    },

    // ══════════════════════════════════════════════════════════════════
    //  CHAT HISTORY �" Multi-conversation management
    // ══════════════════════════════════════════════════════════════════

    _activeConvId: null,
    _MAX_CONVERSATIONS: 30,

    _generateConvId() {
        return 'conv_' + Date.now();
    },

    _autoTitle(messages) {
        for (var i = 0; i < messages.length; i++) {
            if (
                messages[i].role === 'user' &&
                typeof messages[i].content === 'string' &&
                !this._isSyntheticToolSummaryMessage(messages[i])
            ) {
                var txt = messages[i].content.trim();
                return txt.length > 40 ? txt.slice(0, 37) + '...' : txt;
            }
        }
        return 'Untitled chat';
    },

    _getConversationList() {
        try {
            var data = localStorage.getItem('forge:ai-conversations');
            if (!data) return [];
            var list = JSON.parse(data);
            if (!Array.isArray(list)) return [];
            // Sort newest first
            list.sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
            return list;
        } catch (e) { return []; }
    },

    _saveConversation(id, title, messages) {
        if (!messages || messages.length === 0) return;
        try {
            var visibleCount = messages.filter(m => !this._isSyntheticToolSummaryMessage(m)).length;
            // Save messages
            localStorage.setItem('forge:ai-conv-' + id, JSON.stringify(messages));
            // Update index
            var list = this._getConversationList();
            var existing = false;
            for (var i = 0; i < list.length; i++) {
                if (list[i].id === id) {
                    list[i].title = title;
                    list[i].messageCount = visibleCount;
                    existing = true;
                    break;
                }
            }
            if (!existing) {
                list.unshift({ id: id, title: title, created: Date.now(), messageCount: visibleCount });
            }
            // Cap at max conversations �" remove oldest
            while (list.length > this._MAX_CONVERSATIONS) {
                var old = list.pop();
                if (old) localStorage.removeItem('forge:ai-conv-' + old.id);
            }
            localStorage.setItem('forge:ai-conversations', JSON.stringify(list));
        } catch (e) { /* localStorage full �" ignore */ }
    },

    newChat() {
        // Save current conversation if it has messages
        if (aiChatHistory.length > 0) {
            var id = this._activeConvId || this._generateConvId();
            this._saveConversation(id, this._autoTitle(aiChatHistory), aiChatHistory);
        }
        this._activeConvId = this._generateConvId();
        this.clearChat();
    },

    loadConversation(id) {
        // Save current conversation first
        if (aiChatHistory.length > 0 && this._activeConvId) {
            this._saveConversation(this._activeConvId, this._autoTitle(aiChatHistory), aiChatHistory);
        }
        try {
            var data = localStorage.getItem('forge:ai-conv-' + id);
            if (!data) return;
            aiChatHistory = JSON.parse(data);
            this._activeConvId = id;
            this._workingMessages = [];
            this._lastSafetyLimitReason = '';
            this._resetRunUsage();
            this._readFiles.clear();
            this._clearDiscoveryCache(false);
            this._contextCompactionSeq = 0;
            this._projectFileSig = this._computeProjectFileSig();
            // Re-render
            var container = document.getElementById('ai-chat-messages');
            if (container) container.innerHTML = '';
            var renderedCount = 0;
            var hiddenCount = 0;
            for (var i = 0; i < aiChatHistory.length; i++) {
                var msg = aiChatHistory[i];
                if (this._isSyntheticToolSummaryMessage(msg)) {
                    hiddenCount++;
                    continue;
                }
                if (msg.role === 'user' || msg.role === 'assistant') {
                    addAIChatMessage(msg.role, msg.content);
                    renderedCount++;
                }
            }
            if (hiddenCount > 0) {
                addAIChatMessage('system', '(Loaded conversation �" ' + renderedCount + ' messages shown, ' + hiddenCount + ' tool transcript messages hidden)');
            } else {
                addAIChatMessage('system', '(Loaded conversation �" ' + renderedCount + ' messages)');
            }
        } catch (e) { /* corrupt data */ }
        this._closeHistoryDropdown();
    },

    deleteConversation(id) {
        try {
            localStorage.removeItem('forge:ai-conv-' + id);
            var list = this._getConversationList();
            list = list.filter(function (c) { return c.id !== id; });
            localStorage.setItem('forge:ai-conversations', JSON.stringify(list));
        } catch (e) { /* ignore */ }
        // Re-render dropdown if open
        var dd = document.getElementById('ai-history-dropdown');
        if (dd && dd.classList.contains('open')) {
            this._renderHistoryDropdown();
        }
    },

    toggleHistoryDropdown() {
        var dd = document.getElementById('ai-history-dropdown');
        if (!dd) return;
        if (dd.classList.contains('open')) {
            dd.classList.remove('open');
        } else {
            this._renderHistoryDropdown();
            dd.classList.add('open');
        }
    },

    _closeHistoryDropdown() {
        var dd = document.getElementById('ai-history-dropdown');
        if (dd) dd.classList.remove('open');
    },

    _renderHistoryDropdown() {
        var dd = document.getElementById('ai-history-dropdown');
        if (!dd) return;
        var list = this._getConversationList();
        var html = '<div class="ai-history-header">Chat History</div>';
        if (list.length === 0) {
            html += '<div class="ai-history-empty">No previous conversations</div>';
        } else {
            for (var i = 0; i < list.length; i++) {
                var c = list[i];
                var age = this._timeAgo(c.created);
                var esc = typeof escHtml === 'function' ? escHtml : function (s) { return String(s).replace(/</g, '&lt;'); };
                html += '<div class="ai-history-item" onclick="aiAgent.loadConversation(\'' + c.id + '\')">' +
                    '<span class="ai-history-title">' + esc(c.title) + '</span>' +
                    '<span class="ai-history-meta">' + (c.messageCount || 0) + ' msgs &middot; ' + age + '</span>' +
                    '<button class="ai-history-delete" onclick="event.stopPropagation();aiAgent.deleteConversation(\'' + c.id + '\')" title="Delete">&times;</button>' +
                    '</div>';
            }
        }
        dd.innerHTML = html;
    },

    _getPromptPresetDefinitions() {
        return [
            {
                id: 'offline-compat',
                label: 'Offline Compatibility Review',
                description: 'Find anything that will break in the offline, open-from-file:// form factor and explain the fixes.',
                prompt: 'Review this project for incompatibilities with the offline static HTML app form factor. Assume the primary runtime is opening from file:// unless the project clearly indicates SharePoint hosting. Look for modules/import-export usage, server assumptions, unsupported browser APIs in file:// mode, network dependencies, CDN/runtime assumptions that would fail after pull-down, CSP or pathing issues, and any other Forge-unfriendly patterns. Summarize findings ordered by severity and recommend concrete fixes.'
            },
            {
                id: 'cyber-review',
                label: 'Cyber Review',
                description: 'Look for XSS, exfiltration, unsafe HTML handling, and any way the app could send data out.',
                prompt: 'Perform a focused cyber/security review of this project. Look for XSS, DOM injection, unsafe innerHTML usage, unsafe markdown/rendering, insecure file handling, risky use of eval/new Function, secret leakage, and any way data could leave the app over the network, navigation, forms, beacons, images, iframes, or other channels. Prioritize real findings with file references and explain the practical risk.'
            },
            {
                id: 'architecture-doc',
                label: 'Build architecture.md',
                description: 'Create or update a thorough architecture.md covering structure, data flow, dependencies, and runtime assumptions.',
                prompt: 'Create or update a thorough architecture.md file for this project. Read the relevant files first, then write a detailed architecture document that explains purpose, entry points, major components, file roles, data flow, state management, external dependencies, build/runtime assumptions, offline constraints, SharePoint-specific behavior if present, and key risks or maintenance notes. Make it useful to a new engineer opening the repo cold.'
            },
            {
                id: 'qa-doc',
                label: 'Build QA/Test Doc',
                description: 'Create a practical test document with manual test flows, edge cases, and regression checks.',
                prompt: 'Create or update a thorough QA/test document for this project. Read the code first, then produce a practical markdown file with core user flows, setup assumptions, offline/file:// checks, SharePoint checks if relevant, edge cases, negative tests, regression checks, and a short smoke-test section. Make it detailed enough that another person could validate the app without guessing.'
            },
            {
                id: 'cleanup-review',
                label: 'Cleanup and Bundle Review',
                description: 'Find dead code, unnecessary libraries, oversized dependencies, and simplification opportunities for offline shipping.',
                prompt: 'Review this project for cleanup and simplification opportunities with an emphasis on offline shipping. Look for dead code, unused files, redundant helpers, unnecessary libraries, overly large dependencies, duplicated logic, and places where the design can be simplified for maintainability. Summarize the highest-ROI cleanup opportunities first and explain expected impact.'
            }
        ];
    },

    togglePresetDropdown() {
        var dd = document.getElementById('ai-preset-dropdown');
        if (!dd) return;
        if (dd.classList.contains('open')) {
            dd.classList.remove('open');
        } else {
            this._renderPresetDropdown();
            dd.classList.add('open');
        }
    },

    _closePresetDropdown() {
        var dd = document.getElementById('ai-preset-dropdown');
        if (dd) dd.classList.remove('open');
    },

    _renderPresetDropdown() {
        var dd = document.getElementById('ai-preset-dropdown');
        if (!dd) return;
        var presets = this._getPromptPresetDefinitions();
        var esc = typeof escHtml === 'function' ? escHtml : function (s) { return String(s).replace(/</g, '&lt;'); };
        var html = '<div class="ai-preset-header">Prompt Presets</div>';
        if (!presets.length) {
            html += '<div class="ai-preset-empty">No prompt presets available</div>';
        } else {
            for (var i = 0; i < presets.length; i++) {
                var preset = presets[i];
                html += '<div class="ai-preset-item" onclick="aiAgent.runPromptPreset(\'' + preset.id + '\')">' +
                    '<div class="ai-preset-name">' + esc(preset.label) + '</div>' +
                    '<div class="ai-preset-desc">' + esc(preset.description) + '</div>' +
                    '</div>';
            }
        }
        dd.innerHTML = html;
    },

    runPromptPreset(id) {
        var presets = this._getPromptPresetDefinitions();
        var preset = presets.find(function (item) { return item.id === id; });
        this._closePresetDropdown();
        if (!preset || !preset.prompt) return;
        this.sendMessage(preset.prompt);
    },

    _timeAgo(ts) {
        if (!ts) return '';
        var diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
        return new Date(ts).toLocaleDateString();
    },

    // ══════════════════════════════════════════════════════════════════
    //  MAIN SEND MESSAGE �" The agentic loop
    // ══════════════════════════════════════════════════════════════════

    _getDefaultDeveloperSkill() {
        if (typeof skillsManager === 'undefined' || !skillsManager._initialized) return null;
        return skillsManager.getSkill('software-developer')
            || null;
    },

    _findSkillByName(skillName) {
        if (!skillName || typeof skillsManager === 'undefined' || !skillsManager._initialized) return null;
        const needle = String(skillName).trim().toLowerCase();
        if (!needle) return null;
        const all = skillsManager.getAllSkills();
        for (const s of all) {
            if (s && String(s.name || '').toLowerCase() === needle) return s;
        }
        return null;
    },

    setActiveSkillByName(skillName) {
        if (typeof skillsManager === 'undefined' || !skillsManager._initialized) return null;
        const skill = this._findSkillByName(skillName);
        if (!skill) return null;
        if (!skill.enabled && typeof skillsManager.toggleSkill === 'function') {
            skillsManager.toggleSkill(skill.id, true);
        }
        this._activeSkillId = skill.id;
        return skillsManager.getSkill(skill.id) || skill;
    },

    _getActiveSkill() {
        if (typeof skillsManager === 'undefined' || !skillsManager._initialized) return null;
        let skill = this._activeSkillId ? skillsManager.getSkill(this._activeSkillId) : null;
        if (!skill || !skill.enabled) {
            const fallback = this._getDefaultDeveloperSkill();
            if (fallback && fallback.enabled) {
                this._activeSkillId = fallback.id;
                skill = fallback;
            } else {
                skill = null;
            }
        }
        return skill;
    },

    _buildSkillContext(skill) {
        let skillCtx = '<skill name="' + skill.name + '">\n' + skill.body + '\n</skill>';
        // Expose markdown docs so skill workflows can discover/use them.
        const mdFiles = Object.keys(fileHandles).filter(p => p.toLowerCase().endsWith('.md'));
        if (mdFiles.length > 0) {
            skillCtx += '\n\n<project_documents type="markdown">\nThe project contains these .md files that may be relevant to this skill. Use readFile to review them and replaceInFile/writeFile to edit them as needed:\n';
            for (const f of mdFiles) skillCtx += '- ' + f + '\n';
            skillCtx += '</project_documents>';
        }
        return { skillCtx, mdFiles };
    },

    _buildSystemLayerMessages(basePrompt, skillCtx) {
        const layers = [{ role: 'system', content: basePrompt }];
        const memoryLayer = this._renderWorkingMemorySystemMessage();
        if (memoryLayer && String(memoryLayer).trim()) {
            layers.push({ role: 'system', content: memoryLayer });
        }
        if (skillCtx && String(skillCtx).trim()) {
            layers.push({ role: 'system', content: skillCtx });
        }
        return layers;
    },

    _stripLeadingSystemMessages(messages) {
        const out = Array.isArray(messages) ? messages.slice() : [];
        while (out.length > 0 && out[0] && out[0].role === 'system') {
            out.shift();
        }
        return out;
    },

    async sendMessage(userMsg, opts) {
        const options = opts || {};
        this._allowPlanApproval = false;
        if (window.athenaCompat && typeof window.athenaCompat.syncState === 'function') {
            window.athenaCompat.syncState();
        }
        this._refreshProjectCacheState();
        const profile = this.getActiveProfile();
        const apiKey = this.getActiveApiKey();

        if (!profile || !profile.endpoint || !apiKey) {
            addAIChatMessage('system', 'Set up a provider and API key first in API Settings below the chat.');
            return;
        }
        const providerId = profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint);
        if (!this._isProviderAllowed(providerId)) {
            addAIChatMessage('system', 'This provider is disabled by configuration. Select a CUI-compliant provider in API Settings below the chat.');
            this._setConfigOpen(true, { focus: true });
            return;
        }
        this._allowPlanApproval = !!(this._planMode || this._isExplicitPlanRequest(userMsg));
        if (this._isPublicProvider(providerId) && !profile.publicDataCertified) {
            addAIChatMessage('system', 'This provider is Public Info Only. Use API Settings below the chat to certify that this project contains no official/CUI data before use.');
            this._setConfigOpen(true, { focus: true });
            return;
        }
        const modelId = this.getEffectiveModel();
        if (!this._isValidModelId(modelId)) {
            addAIChatMessage('system', 'Invalid model ID. Use only letters, numbers, ., _, :, /, @, and -.');
            return;
        }
        if (this._busy) {
            // Queue as redirect �" will be injected at next tool boundary
            this._pendingRedirect = userMsg;
            addAIChatMessage('user', userMsg);
            addAIChatMessage('system', 'Redirect queued �" will take effect after current step.');
            this._setActivity('working', 'Redirect pending...');
            return;
        }
        if (!options.resumeSafetyLimit) this._lastSafetyLimitReason = '';
        this._removeSafetyContinuePrompts();
        this._resetRunUsage();
        if (options.resetDiscovery) {
            this._clearDiscoveryCache(true);
        }
        this._setActivity('working', 'Thinking...');
        this._setPlanActionButton(false);

        // Resolve active skill from explicit picker selection.
        let activeSkillPayload = null;
        if (typeof skillsManager !== 'undefined' && skillsManager._initialized) {
            const activeSkill = this._getActiveSkill();
            if (activeSkill) {
                const payload = this._buildSkillContext(activeSkill);
                activeSkillPayload = { skill: activeSkill, skillCtx: payload.skillCtx, mdFiles: payload.mdFiles };
            }
        }

        // Consume any pending attachment
        const attachment = this._consumeAttachment();
        if (!options.silentUserMessage) {
            this._recordWorkingMemoryUserRequest(userMsg, attachment);
        } else {
            const memory = this._refreshWorkingMemoryEditorContext();
            memory.taskStatus = 'active';
            memory.lastError = '';
            memory.blocker = '';
            memory.updatedAt = new Date().toISOString();
        }

        // Display user message (with attachment indicator)
        if (options.silentUserMessage) {
            // Internal resume messages keep the visible chat focused on user-authored turns.
        } else if (attachment && attachment.type === 'image') {
            addAIChatMessage('user', userMsg, attachment);
        } else {
            addAIChatMessage('user', userMsg);
        }

        // Build the user message for the API (may be multimodal)
        let userApiMsg;
        if (attachment && attachment.type === 'image') {
            userApiMsg = this._buildMultimodalUserMessage(userMsg, attachment);
        } else if (attachment && attachment.type === 'file') {
            // Inline file as text
            userApiMsg = { role: 'user', content: userMsg + '\n\n--- Attached file: ' + attachment.name + ' ---\n' + attachment.text };
        } else {
            userApiMsg = { role: 'user', content: userMsg };
        }
        if (!options.silentUserMessage) {
            aiChatHistory.push({ role: 'user', content: userMsg + (attachment ? ' [attached: ' + attachment.name + ']' : '') });
        }
        // Save pending message for recovery on network failure
        if (!options.silentUserMessage) {
            sessionStorage.setItem('forge:ai-pending-msg', userMsg);
        }
        if (!this._autoAcceptToggle) this._autoApproveRemaining = false;
        this._sessionCheckpointed = false;

        // Auto-accept safety: create a checkpoint before the agent runs
        if (!options.silentUserMessage && this._autoAcceptToggle && typeof checkpointManager !== 'undefined' && dirHandle) {
            try {
                var cpWords = String(userMsg || '').split(/\s+/).slice(0, 20).join(' ');
                if (cpWords.length > 120) cpWords = cpWords.slice(0, 120) + '�';
                var cpLabel = 'Before: ' + (cpWords || 'user prompt');
                await checkpointManager.createAutoCheckpoint(cpLabel);
                addAIChatMessage('assistant', 'Safety checkpoint created (auto-accept is ON).');
            } catch (e) {
                console.warn('[Prometheus] Auto-accept checkpoint failed:', e);
            }
        }

        this._nudgeCount = 0;
        this._totalStallCount = 0;
        this._truncContCount = 0;
        this._forceToolChoice = false;
        this._completionVerified = false;
        this._runMaxRetries = null;
        this._runRequestTimeoutMs = null;
        this._runGoogleTimeoutMs = null;
        this._lastAutoReadPath = null;
        this._setButtonState(true);
        this._abortRequested = false;
        this._abortController = new AbortController();
        this._apiFormat = null; // re-detect

        const fmt = this._detectFormat();
        const useStreaming = fmt !== 'asksage';
        const apiUrl = this._getApiUrl(useStreaming);
        const isAskSageRun = fmt === 'asksage';
        let capraTraceStatus = 'completed';
        let capraTraceError = null;
        if (isAskSageRun) {
            this._beginCapraTraceRun({
                provider: providerId,
                model: modelId,
                conversationId: this._activeConvId || null,
                htmlAppMode: !!this._htmlAppMode,
                planMode: !!this._planMode,
                promptPreview: String(userMsg || '').slice(0, 500),
                attachment: attachment ? {
                    type: attachment.type,
                    name: attachment.name || '',
                    size: attachment.text ? String(attachment.text).length : (attachment.base64 ? String(attachment.base64).length : 0)
                } : null,
                priorWorkingMessageCount: Array.isArray(this._workingMessages) ? this._workingMessages.length : 0,
                visibleHistoryCount: Array.isArray(aiChatHistory) ? aiChatHistory.length : 0
            });
        }

        // Reuse full-fidelity working messages across turns for continuous conversation.
        // Only rebuild from scratch if there's no prior working state.
        const systemPrompt = await this._buildSystemPrompt();
        const systemMessages = this._buildSystemLayerMessages(systemPrompt, activeSkillPayload ? activeSkillPayload.skillCtx : '');

        let messages;
        if (this._workingMessages && this._workingMessages.length > 1) {
            // Refresh layered system prompts and preserve prior conversational turns.
            const carryForward = this._stripLeadingSystemMessages(this._workingMessages);
            messages = [...systemMessages, ...carryForward, userApiMsg];
        } else {
            // First turn or after clearChat �" build from display history
            messages = [
                ...systemMessages,
                ...aiChatHistory
            ];
            // If this is the first message and has an attachment, replace the last entry
            if (attachment && messages.length > 0) {
                messages[messages.length - 1] = userApiMsg;
            } else if (options.silentUserMessage) {
                messages.push(userApiMsg);
            }
        }
        if (isAskSageRun) {
            this._askSageDebugLog('Prepared message context', {
                source: (this._workingMessages && this._workingMessages.length > 1) ? 'carry-forward-working-messages' : 'rebuilt-from-chat-history',
                systemMessageCount: systemMessages.length,
                summary: this._summarizeTraceMessages(messages)
            });
        }

        this._runMaxRetries = this.MAX_RETRIES;
        this._runRequestTimeoutMs = this.REQUEST_TIMEOUT_MS;
        this._runGoogleTimeoutMs = this.GOOGLE_REQUEST_TIMEOUT_MS;

        const startTime = Date.now();

        let totalSteps = 0;
        let deadlineMs = startTime + this.MAX_TIME_MS;
        let toolCallsExecuted = 0;
        let fileMutationsExecuted = 0;
        let consecutiveErrors = 0;
        let consecutiveTimeouts = 0;
        let noToolProgressTurns = 0;          // Consecutive API turns with zero tool calls
        const MAX_NO_TOOL_TURNS = 5;          // Hard cap on consecutive no-tool-call turns
        const MAX_TRUNC_CONTINUATIONS = 3; // Max truncation continuations without tool calls
        const MAX_TOTAL_STALLS = 4;         // Absolute stall limit across nudge resets
        // Doom loop detection (OpenCode pattern): track last N tool calls by signature.
        // If last 3 are identical (same tool name + same args), it's a doom loop.
        const DOOM_LOOP_THRESHOLD = 3;
        const recentToolCallSignatures = []; // ring buffer of recent call signatures
        try {
            for (let i = 0; ; i++) {
                totalSteps = i + 1;
                this._capraTraceStep = isAskSageRun ? totalSteps : 0;
                const curTokens = this._estimateTokens(messages);
                this._updateStepCounter(totalSteps, 0, curTokens);
                if (isAskSageRun) {
                    this._askSageDebugLog('Step context snapshot', {
                        step: totalSteps,
                        tokenEstimate: curTokens,
                        apiCallsSoFar: this._runApiCalls,
                        noToolProgressTurns: noToolProgressTurns,
                        nudgeCount: this._nudgeCount,
                        recentToolCallSignatures: recentToolCallSignatures.length,
                        totalStallCount: this._totalStallCount,
                        truncationContinuations: this._truncContCount,
                        summary: this._summarizeTraceMessages(messages)
                    });
                }
                if (this._abortRequested || this._abortController?.signal.aborted) break;

                if (Date.now() > deadlineMs) {
                    if (isAskSageRun) capraTraceStatus = 'timeout';
                    this._showSafetyContinuePrompt('timeout');
                    break;
                }

                // Context compaction if needed
                const tokens = curTokens;
                if (tokens > this._getTokenBudget()) {
                    const before = messages.length;
                    const beforeSummary = isAskSageRun ? this._summarizeTraceMessages(messages) : null;
                    const compacted = this._compactMessages(messages);
                    messages.length = 0;
                    messages.push(...compacted);
                    this._contextCompactionSeq++;
                    if (isAskSageRun) {
                        this._askSageDebugLog('Context compaction applied', {
                            step: totalSteps,
                            tokenEstimateBefore: tokens,
                            tokenBudget: this._getTokenBudget(),
                            messageCountBefore: before,
                            messageCountAfter: messages.length,
                            beforeSummary: beforeSummary,
                            afterSummary: this._summarizeTraceMessages(messages)
                        }, 'warn');
                    }
                    addAIChatMessage('system', 'I\'m condensing our conversation to stay within context (' + before + ' ? ' + messages.length + ' messages, ~' + Math.round(this._estimateTokens(messages) / 1000) + 'k tokens).');
                }

                // Periodic system prompt reinforcement � every 8 steps
                if (totalSteps > 1 && totalSteps % 8 === 0) {
                    const lastMsg = messages[messages.length - 1];
                    const isAlreadyReinforced = typeof lastMsg?.content === 'string' && lastMsg.content.includes('[SYSTEM REMINDER]');
                    if (!isAlreadyReinforced) {
                        let reminder = '';
                        const activeSkill = this._getActiveSkill();
                        if (activeSkill) reminder += 'Active skill: /' + activeSkill.name + '. Continue following its instructions.\n';
                        const planSummary = this._getPlanSummary();
                        if (planSummary) reminder += 'Current task plan:' + planSummary + '\nUpdate the plan status as you complete items.\n';
                        reminder += '[SYSTEM REMINDER]: Continue only if work remains. If the request is already satisfied, give a brief summary and stop. Use tools only for remaining work.';
                        messages.push({ role: 'user', content: reminder });
                    }
                }

                let parsed;
                const body = this._buildRequestBody(messages, useStreaming);
                const headers = this._buildHeaders();

                // Google uses ?key= in URL
                let fetchUrl = apiUrl;
                if (fmt === 'google') {
                    const sep = fetchUrl.includes('?') ? '&' : '?';
                    fetchUrl += sep + 'key=' + apiKey;
                    delete headers['Authorization'];
                }
                this._runApiCalls++;
                this._updateUsageBadges(curTokens);

                // Universal request debug logging (all providers)
                this._debugLog('Request payload', {
                    step: totalSteps,
                    apiCall: this._runApiCalls,
                    format: fmt,
                    url: fetchUrl.replace(/key=[^&]+/, 'key=***'),
                    model: body && (body.model || (body.generationConfig ? 'google' : '?')),
                    messagesCount: (body && Array.isArray(body.messages)) ? body.messages.length
                        : (body && Array.isArray(body.contents)) ? body.contents.length : 0,
                    toolDefsCount: body && Array.isArray(body.tools) ? body.tools.length
                        : (body && body.tools && body.tools[0] && Array.isArray(body.tools[0].functionDeclarations))
                            ? body.tools[0].functionDeclarations.length : 0,
                    streaming: useStreaming
                });

                if (fmt === 'asksage') {
                    this._askSageDebugLog('Request payload', {
                        step: totalSteps,
                        apiCall: this._runApiCalls,
                        url: fetchUrl,
                        method: 'POST',
                        model: body && body.model,
                        response_mode: body && body.response_mode,
                        stream: body && body.stream,
                        messagesCount: (body && Array.isArray(body.messages)) ? body.messages.length : 0,
                        messageSummary: this._summarizeTraceMessages(messages),
                        workingMessages: messages,
                        queryPreview: String((body && (body.query || body.question || body.input_text)) || '').slice(0, 500),
                        requestBody: body
                    });
                }

                try {
                if (useStreaming) {
                    const thinkingEl = this._showThinking();
                    try {
                        const res = await this._fetchWithRetry(fetchUrl, headers, body, this._abortController?.signal);
                        this._hideThinking(thinkingEl);
                        parsed = await this._readStreamedResponse(res, fmt);
                    } catch (e) {
                        this._hideThinking(thinkingEl);
                        throw e;
                    }
                } else {
                    // Non-streaming fallback
                    const thinkingEl = this._showThinking();
                    let data;
                    try {
                        const res = await this._fetchWithRetry(fetchUrl, headers, body, this._abortController?.signal);
                        if (fmt === 'asksage') {
                            const contentType = String(res.headers.get('content-type') || '');
                            const rawText = await res.text();
                            let parseError = null;
                            try {
                                data = rawText ? JSON.parse(rawText) : null;
                            } catch (err) {
                                parseError = err ? (err.message || String(err)) : 'Unknown JSON parse error';
                                data = rawText;
                            }
                            this._askSageDebugLog('HTTP response', {
                                status: res.status,
                                ok: res.ok,
                                contentType: contentType,
                                rawLength: String(rawText || '').length,
                                rawText: rawText,
                                parsedType: (data == null) ? 'null' : (Array.isArray(data) ? 'array' : typeof data),
                                parsedKeys: (data && typeof data === 'object' && !Array.isArray(data)) ? Object.keys(data) : [],
                                parseError: parseError
                            }, parseError ? 'warn' : 'log');
                            if (this._isAskSageMissingMessageError(data) || this._isAskSageRetryableBodyError(data)) {
                                const retryBody = this._buildAskSagePayload({
                                    model: body && body.model,
                                    messages: messages,
                                    textToolMode: true,
                                    compatibilityMode: true
                                });
                                this._askSageDebugLog('Compatibility retry', {
                                    reason: this._isAskSageMissingMessageError(data)
                                        ? 'CAPRA reported missing message in initial response'
                                        : 'CAPRA returned a body-level error for native tool request',
                                    originalKeys: (data && typeof data === 'object' && !Array.isArray(data)) ? Object.keys(data) : [],
                                    retryKeys: Object.keys(retryBody || {}),
                                    retryMessagePreview: String((retryBody && (retryBody.message || retryBody.query || retryBody.input_text)) || '').slice(0, 500),
                                    retryBody: retryBody
                                }, 'warn');
                                const retryRes = await this._fetchWithRetry(fetchUrl, headers, retryBody, this._abortController?.signal);
                                const retryContentType = String(retryRes.headers.get('content-type') || '');
                                const retryRawText = await retryRes.text();
                                let retryParseError = null;
                                try {
                                    data = retryRawText ? JSON.parse(retryRawText) : null;
                                } catch (err) {
                                    retryParseError = err ? (err.message || String(err)) : 'Unknown JSON parse error';
                                    data = retryRawText;
                                }
                                this._askSageDebugLog('HTTP response (compat retry)', {
                                    status: retryRes.status,
                                    ok: retryRes.ok,
                                    contentType: retryContentType,
                                    rawLength: String(retryRawText || '').length,
                                    rawText: retryRawText,
                                    parsedType: (data == null) ? 'null' : (Array.isArray(data) ? 'array' : typeof data),
                                    parsedKeys: (data && typeof data === 'object' && !Array.isArray(data)) ? Object.keys(data) : [],
                                    parseError: retryParseError
                                }, (!retryRes.ok || retryParseError) ? 'warn' : 'log');
                                if (!retryRes.ok) {
                                    const retryMessage = (data && (data.error || data.message || data.response)) || retryRawText || ('Ask Sage request failed (' + retryRes.status + ')');
                                    throw new Error(typeof retryMessage === 'string' ? retryMessage : JSON.stringify(retryMessage));
                                }
                            }
                        } else {
                            data = await res.json();
                            // Log response summary for non-AskSage providers
                            this._debugLog('HTTP response', {
                                status: res.status,
                                format: fmt,
                                dataType: typeof data,
                                topKeys: (data && typeof data === 'object') ? Object.keys(data).slice(0, 10) : []
                            });
                        }
                    } finally {
                        this._hideThinking(thinkingEl);
                    }
                    parsed = this._parseResponse(data);

                    // Universal parsed-response debug logging (all providers)
                    this._debugLog('Parsed response', {
                        format: fmt,
                        textLength: String(parsed && parsed.text || '').length,
                        textPreview: String(parsed && parsed.text || '').slice(0, 300),
                        stopReason: parsed && parsed.stopReason,
                        toolCallCount: (parsed && Array.isArray(parsed.toolCalls)) ? parsed.toolCalls.length : 0,
                        toolCalls: (parsed && Array.isArray(parsed.toolCalls))
                            ? parsed.toolCalls.slice(0, 8).map(tc => ({
                                name: tc && tc.name,
                                argsKeys: tc && tc.args ? Object.keys(tc.args) : []
                            }))
                            : []
                    });

                    if (fmt === 'asksage') {
                        this._askSageDebugLog('Final parsed text', {
                            textLength: String(parsed && parsed.text || '').length,
                            textPreview: String(parsed && parsed.text || '').slice(0, 900),
                            stopReason: parsed && parsed.stopReason,
                            toolCallCount: (parsed && Array.isArray(parsed.toolCalls)) ? parsed.toolCalls.length : 0,
                            toolCalls: (parsed && Array.isArray(parsed.toolCalls))
                                ? parsed.toolCalls.slice(0, 8).map(tc => ({
                                    name: tc && tc.name,
                                    args: this._formatDebugValue(tc && tc.args, 280)
                                }))
                                : []
                        });
                    }
                    if (parsed.text) addAIChatMessage('assistant', parsed.text);
                }
                } catch (stepErr) {
                    if (this._abortRequested || this._abortController?.signal.aborted) throw stepErr;
                    consecutiveErrors++;

                    // Track consecutive timeouts for model-switch recommendation
                    const isTimeout = stepErr.name === 'TimeoutError' || /timed? ?out/i.test(stepErr.message);
                    if (isTimeout) {
                        consecutiveTimeouts++;
                    } else {
                        consecutiveTimeouts = 0;
                    }

                    if (consecutiveErrors >= 2) {
                        // Two failures in a row � stop and let user retry when ready
                        addAIChatMessage('system', 'Prometheus: ' + stepErr.message);

                        // If both failures were timeouts on CAPRA, recommend switching models
                        if (consecutiveTimeouts >= 2 && fmt === 'asksage') {
                            this._showModelSwitchRecommendation();
                        }

                        this._showSafetyContinuePrompt('error');
                        break;
                    }
                    // First failure � wait and retry this step
                    addAIChatMessage('system', 'Prometheus: ' + stepErr.message + ' � retrying...');
                    await new Promise(r => setTimeout(r, 3000));
                    i--; totalSteps--;
                    continue;
                }

                // Add assistant message to working conversation
                messages.push(this._buildAssistantMessage(parsed));
                consecutiveErrors = 0;

                // Ask Sage run with no tool calls: detect planning-intent responses and nudge.
                if (fmt === 'asksage' && parsed.toolCalls.length === 0) {
                    const sageText = String(parsed.text || '').trim();
                    const sageLower = sageText.toLowerCase();

                    // Detect "planning intent" � model said what it will do but didn't call tools.
                    // These patterns indicate the model intends to take action but CAPRA returned
                    // before the model actually produced tool calls.
                    const sageIntentPatterns = [
                        "i'll inspect", "i will inspect", "let me inspect",
                        "i'll read", "i will read", "let me read",
                        "i'll look", "i will look", "let me look",
                        "i'll check", "i will check", "let me check",
                        "i'll update", "i will update", "let me update",
                        "i'll modify", "i will modify", "let me modify",
                        "i'll change", "i will change", "let me change",
                        "i'll fix", "i will fix", "let me fix",
                        "i'll create", "i will create", "let me create",
                        "i'll write", "i will write", "let me write",
                        "i'll add", "i will add", "let me add",
                        "i'll implement", "i will implement", "let me implement",
                        "i'll start by", "i will start by", "let me start by",
                        "i'll begin by", "i will begin by", "let me begin by",
                        "i'll now", "i will now", "let me now",
                        "i'll proceed", "i will proceed", "let me proceed",
                        "let me go ahead", "i'll go ahead", "i will go ahead",
                        "first, i'll", "first, i will", "first, let me",
                        "i need to read", "i need to check", "i need to inspect",
                        "i'll open", "i will open", "let me open",
                        "i'll analyze", "i will analyze", "let me analyze",
                        "i'll review", "i will review", "let me review",
                        "i'll make", "i will make the", "let me make"
                    ];
                    const hasIntent = sageIntentPatterns.some(p => sageLower.includes(p));
                    const MAX_SAGE_NUDGES = 3;

                    if (hasIntent && this._nudgeCount < MAX_SAGE_NUDGES) {
                        this._nudgeCount++;
                        this._totalStallCount++;
                        let nudgeMsg = this._nudgeCount === 1
                            ? '[SYSTEM]: You described what you plan to do, but you did not call any tools. Call your tools now � start with readFile to read the relevant file, then use replaceInFile or writeFile to make changes. Output ONLY tool calls, not descriptions of what you will do.'
                            : '[SYSTEM]: You MUST call tools immediately. Do NOT describe your plan. Call readFile, writeFile, or replaceInFile RIGHT NOW. Output only the tool call, nothing else.';
                        nudgeMsg = this._nudgeCount === 1
                            ? '[SYSTEM]: You described what you plan to do, but you did not call any tools. Call the next necessary tool now. Use prior file content if already read; otherwise read only the relevant file, then use replaceInFile or writeFile to make changes. Output ONLY tool calls, not descriptions of what you will do.'
                            : '[SYSTEM]: You MUST call tools immediately. Do NOT describe your plan. Use prior file content if available; otherwise read only the relevant file. Then call writeFile or replaceInFile. Output only the tool call, nothing else.';
                        messages.push({ role: 'user', content: nudgeMsg });
                        this._askSageDebugLog('AskSage execution decision', {
                            action: 'nudge_intent_detected',
                            nudgeCount: this._nudgeCount,
                            reason: 'Model described intent but produced no tool calls. Sending continuation prompt.',
                            responsePreview: sageText.slice(0, 300)
                        });
                        addAIChatMessage('system', 'Prometheus described a plan � nudging to execute tools (attempt ' + this._nudgeCount + '/' + MAX_SAGE_NUDGES + ').');
                        continue;
                    }

                    // No intent detected, or max nudges reached � stop normally.
                    this._askSageDebugLog('AskSage execution decision', {
                        action: 'stop_no_tools',
                        reason: hasIntent
                            ? 'Max AskSage nudges (' + MAX_SAGE_NUDGES + ') reached; model still not calling tools.'
                            : 'No executable tool calls detected in parsed response.',
                        nudgeCount: this._nudgeCount,
                        responsePreview: sageText.slice(0, 500)
                    });
                    aiChatHistory.push({ role: 'assistant', content: parsed.text || '' });
                    break;
                }
                if (fmt === 'asksage' && parsed.toolCalls.length > 0) {
                    this._askSageDebugLog('AskSage execution decision', {
                        action: 'execute_tools',
                        toolCallCount: parsed.toolCalls.length,
                        toolNames: parsed.toolCalls.map(tc => tc && tc.name)
                    });
                }

                // Universal execution decision logging (all providers)
                this._debugLog('Execution decision', {
                    format: fmt,
                    toolCallCount: parsed.toolCalls.length,
                    toolNames: parsed.toolCalls.map(tc => tc && tc.name),
                    stopReason: parsed.stopReason,
                    textLength: String(parsed.text || '').length
                });

                // Enforce API call cap per run
                if (this._runApiCalls >= this.MAX_API_CALLS_PER_RUN && parsed.toolCalls.length === 0) {
                    aiChatHistory.push({ role: 'assistant', content: parsed.text || '' });
                    break;
                }

                // Track consecutive turns with no tool calls for safety
                if (parsed.toolCalls.length === 0) {
                    noToolProgressTurns++;
                    if (noToolProgressTurns >= MAX_NO_TOOL_TURNS) {
                        addAIChatMessage('system', 'I wasn\'t able to make tool-based progress after ' + noToolProgressTurns + ' attempts. Try rephrasing or breaking the task into smaller steps.');
                        aiChatHistory.push({ role: 'assistant', content: parsed.text || '(no tool progress limit reached)' });
                        break;
                    }
                } else {
                    noToolProgressTurns = 0;
                }

                // Stop reason awareness: detect truncated responses
                const normStop = this._normalizeStopReason(parsed.stopReason);
                if (normStop === 'max_tokens' && parsed.toolCalls.length === 0 && (parsed.text || '').length > 200) {
                    this._truncContCount++;
                    // Check if the truncated text is actually a stall (describing actions without calling tools)
                    const truncLower = (parsed.text || '').toLowerCase();
                    const truncStallPatterns = [
                        'i will now', 'i\'ll now', 'let me now',
                        'i will proceed', 'i\'ll proceed', 'let me proceed',
                        'i will make the changes', 'i\'ll make the changes',
                        'i will apply', 'let me apply',
                        'proceeding with the changes'
                    ];
                    const isTruncStall = truncStallPatterns.some(p => truncLower.includes(p));
                    if (isTruncStall) {
                        // Truncation + stall language: count as nudge only (not totalStall)
                        // so truncation doesn't burn through the real stall budget.
                        this._nudgeCount++;
                        messages.push({ role: 'user', content: '[SYSTEM]: Your response was truncated AND you are describing changes instead of calling tools. STOP writing prose. Call tools (readFile, writeFile, replaceInFile) directly. Do NOT describe what you will do.' });
                        addAIChatMessage('system', 'My response was cut short. Switching to direct tool calls.');
                        if (this._nudgeCount >= 2) this._forceToolChoice = true;
                        continue;
                    }
                    if (this._truncContCount >= MAX_TRUNC_CONTINUATIONS) {
                        messages.push({ role: 'user', content: '[SYSTEM]: Your response was truncated ' + this._truncContCount + ' times without calling tools. You MUST call tools now. Do NOT continue writing text.' });
                        addAIChatMessage('system', 'I\'ve been running long � switching to tool calls to make progress.');
                        this._forceToolChoice = true;
                        continue;
                    }
                    messages.push({ role: 'user', content: '[SYSTEM]: Your response was truncated (hit output token limit). If work remains, call tools directly now instead of writing more prose. If the task is already complete, provide a brief summary and stop.' });
                    addAIChatMessage('system', 'My response was cut short � retrying with direct tool actions.');
                    continue;
                }
                // Discard truncated tool calls with empty args
                if (normStop === 'max_tokens' && parsed.toolCalls.length > 0) {
                    const lastTc = parsed.toolCalls[parsed.toolCalls.length - 1];
                    if (!lastTc.name || (typeof lastTc.args === 'object' && Object.keys(lastTc.args).length === 0)) {
                        parsed.toolCalls.pop();
                        if (parsed.toolCalls.length === 0) {
                            messages.push({ role: 'user', content: '[SYSTEM]: Your tool call was truncated. Please call the tool again with complete arguments.' });
                            addAIChatMessage('system', 'My tool call was incomplete � retrying...');
                            continue;
                        }
                    }
                }

                // No tool calls � check if the model stalled mid-task
                if (parsed.toolCalls.length === 0) {
                    const lowerText = (parsed.text || '').toLowerCase();
                    // Only detect clear "I will do X" stalls � not thinking/reasoning.
                    // The model is allowed to explain its approach. Only stall when
                    // it says it's about to act but produces no tool calls.
                    const stallPatterns = [
                        'i will now', 'i\'ll now', 'let me now',
                        'i will proceed', 'i\'ll proceed', 'let me proceed',
                        'i will make the changes', 'i\'ll make the changes',
                        'i will apply', 'let me apply',
                        'i\'m going to make', 'i am going to make',
                        'proceeding with the changes',
                        'let me go ahead and'
                    ];
                    const isStalled = stallPatterns.some(p => lowerText.includes(p));
                    if (isStalled) {
                        this._totalStallCount++;
                        // Hard limit: if total stalls across all nudge cycles exceeds threshold, break
                        if (this._totalStallCount >= MAX_TOTAL_STALLS) {
                            addAIChatMessage('system', 'I wasn\'t able to make the changes. Try breaking this into a smaller, more specific task.');
                            aiChatHistory.push({ role: 'assistant', content: parsed.text || '(stall limit reached)' });
                            break;
                        }
                        if (this._nudgeCount < 2) {
                            this._nudgeCount++;
                            const nudgeMessages = [
                                '[SYSTEM]: Go ahead and make the changes now. Use prior file content if you already have it; otherwise call readFile only for the relevant file, then replaceInFile or writeFile to edit it.',
                                '[SYSTEM]: Please call your tools to make the changes. If the relevant file was already read, do not read it again; edit it. If not, read only that file first.',
                                '[SYSTEM]: Call a tool now. readFile to read, replaceInFile to edit.'
                            ];
                            messages.push({ role: 'user', content: nudgeMessages[this._nudgeCount - 1] });
                            // Force the model to call a tool on nudge 2+
                            if (this._nudgeCount >= 2) this._forceToolChoice = true;
                            continue;
                        }
                        // Nudge limit reached � force one last attempt with strongest possible prompt
                        messages.push({ role: 'user', content: '[SYSTEM]: FINAL ATTEMPT. Call the next necessary tool RIGHT NOW. If the relevant file was already read, edit it instead of reading it again. Do not output any text.' });
                        this._forceToolChoice = true;
                        continue;
                    }
                    if (!isStalled) { this._nudgeCount = 0; this._truncContCount = 0; }
                    // Completion verification: catch premature "I'm done" on multi-step tasks
                    const hasFileMutations = fileMutationsExecuted > 0;
                    const likelyMultiChangeTask = fileMutationsExecuted >= 2;
                    const textLen = String(parsed.text || '').trim().length;
                    const looksFinished = textLen > 0 && textLen < 240;
                    if (hasFileMutations && likelyMultiChangeTask && !this._completionVerified && totalSteps > 4 && looksFinished) {
                        this._completionVerified = true;
                        messages.push({ role: 'user', content: '[SYSTEM]: Before finishing, verify your work is complete. Call readFile on the file(s) you edited to confirm changes are correct. If anything is missing or broken, fix it now. Only respond with a summary after verifying.' });
                        this._forceToolChoice = true;
                        continue;
                    }
                    aiChatHistory.push({ role: 'assistant', content: parsed.text || '' });
                    break;
                }

                // Successful tool call - reset nudge counter, truncation counter, and forced tool choice
                this._nudgeCount = 0;
                this._truncContCount = 0;
                this._forceToolChoice = false;

                // --- Doom loop detection (OpenCode pattern) ---
                // Build a signature for every tool call in this step
                const callSig = JSON.stringify(parsed.toolCalls.map(tc => [tc.name, tc.args]));
                recentToolCallSignatures.push(callSig);
                // Keep ring buffer at DOOM_LOOP_THRESHOLD size
                if (recentToolCallSignatures.length > DOOM_LOOP_THRESHOLD) {
                    recentToolCallSignatures.shift();
                }

                if (recentToolCallSignatures.length >= DOOM_LOOP_THRESHOLD) {
                    const allIdentical = recentToolCallSignatures.every(s => s === recentToolCallSignatures[0]);
                    if (allIdentical) {
                        if (fmt === 'asksage') {
                            this._askSageDebugLog('Doom loop detected - last ' + DOOM_LOOP_THRESHOLD + ' steps identical', {
                                step: totalSteps,
                                signature: callSig
                            }, 'warn');
                        }
                        messages.push({
                            role: 'user',
                            content: '[SYSTEM]: You have made the same tool call ' + DOOM_LOOP_THRESHOLD + ' times in a row. STOP repeating. Use the information you already have. If you need to edit a file, call replaceInFile or writeFile now. If you are stuck, explain concisely what is blocking you.'
                        });
                        this._forceToolChoice = true;
                        // Clear the ring buffer so the agent gets one fresh chance
                        recentToolCallSignatures.length = 0;
                        continue;
                    }
                }

                // Execute tool calls with validation
                this._activeToolBatchEl = null;
                toolCallsExecuted += parsed.toolCalls.length;
                const results = [];
                const canParallelizeReadOnly = parsed.toolCalls.length > 1
                    && parsed.toolCalls.every(tc => tc && this._isReadOnlyTool(tc.name));
                const runTool = async (tc) => {
                    if (this._abortRequested || this._abortController?.signal.aborted) return 'Aborted';
                    this._recordWorkingMemoryToolCall(tc.name, tc.args);
                    if (fmt === 'asksage') {
                        this._askSageDebugLog('Tool execution start', {
                            step: totalSteps,
                            name: tc.name,
                            args: tc.args,
                            readOnly: this._isReadOnlyTool(tc.name),
                            mutating: this._isFileMutatingTool(tc.name)
                        });
                    }
                    const toolDiv = this._showToolCall(tc.name, tc.args);
                    const validationError = this._validateToolArgs(tc.name, tc.args);
                    var result;
                    if (validationError) {
                        result = 'Validation error: ' + validationError;
                        if (fmt === 'asksage') {
                            this._askSageDebugLog('Tool validation failed', {
                                step: totalSteps,
                                name: tc.name,
                                args: tc.args,
                                error: validationError
                            }, 'warn');
                        }
                    } else {
                        result = await this._executeTool(tc.name, tc.args);
                    }
                    const resultContract = this._recordWorkingMemoryToolResult(tc.name, tc.args, result);
                    this._showToolResult(toolDiv, result);
                    if (fmt === 'asksage') {
                        this._askSageDebugLog('Tool execution finished', {
                            step: totalSteps,
                            name: tc.name,
                            resultLength: String(result || '').length,
                            result: result,
                            resultContract: resultContract,
                            mutationDetected: this._toolResultIndicatesMutation(tc.name, result)
                        }, /^error:|^validation error/i.test(String(result || '')) ? 'warn' : 'log');
                    }
                    return result;
                };
                if (canParallelizeReadOnly) {
                    this._setActivity('working', 'Running ' + parsed.toolCalls.length + ' read-only tools...');
                    const batchResults = await Promise.all(parsed.toolCalls.map(tc => runTool(tc)));
                    results.push(...batchResults);
                } else {
                    for (const tc of parsed.toolCalls) {
                        if (this._abortRequested || this._abortController?.signal.aborted) break;
                        this._setActivity('working', 'Running ' + tc.name + '...');
                        const result = await runTool(tc);
                        results.push(result);
                    }
                }
                this._activeToolBatchEl = null;

                if (this._abortRequested || this._abortController?.signal.aborted) break;

                let successfulMutationsThisStep = 0;
                for (let r = 0; r < parsed.toolCalls.length; r++) {
                    const tc = parsed.toolCalls[r];
                    if (!tc || !this._isFileMutatingTool(tc.name)) continue;
                    if (this._toolResultIndicatesMutation(tc.name, results[r])) successfulMutationsThisStep++;
                }
                if (successfulMutationsThisStep > 0) fileMutationsExecuted += successfulMutationsThisStep;

                // Universal tool execution results logging (all providers)
                this._debugLog('Tool execution results', {
                    format: fmt,
                    executed: parsed.toolCalls.length,
                    successfulMutations: successfulMutationsThisStep,
                    results: parsed.toolCalls.map((tc, idx) => ({
                        name: tc && tc.name,
                        resultLength: String(results[idx] || '').length,
                        resultPreview: String(results[idx] || '').slice(0, 200)
                    }))
                });

                if (fmt === 'asksage') {
                    this._askSageDebugLog('AskSage tool execution results', {
                        executed: parsed.toolCalls.length,
                        successfulMutations: successfulMutationsThisStep,
                        results: parsed.toolCalls.map((tc, idx) => ({
                            name: tc && tc.name,
                            resultPreview: String(results[idx] || '').slice(0, 500)
                        }))
                    });
                }

                // Push tool results
                const toolMsgs = this._buildToolResultMessages(parsed.toolCalls, results);
                messages.push(...toolMsgs);

                // If this step only searched, auto-read one top match (same API turn) to reduce search-only churn.
                const searchOnlyStep = parsed.toolCalls.length > 0
                    && parsed.toolCalls.every(tc => tc && tc.name === 'searchFiles');
                if (searchOnlyStep) {
                    const autoPath = this._pickAutoReadPathFromSearchResults(results);
                    if (autoPath) {
                        const autoTc = { id: 'auto_read_' + this._uid(), name: 'readFile', args: { path: autoPath } };
                        // For Google thinking models, synthetic tool calls without thought_signature
                        // cause HTTP 400 errors. Instead of faking an assistant functionCall message,
                        // inject the auto-read result as a user-role context message.
                        const fmt = this._detectFormat();
                        let autoResult;
                        if (fmt === 'google') {
                            this._setActivity('working', 'Auto-reading top search match...');
                            autoResult = await runTool(autoTc);
                            const cappedResult = this._capToolResultNoReread(String(autoResult));
                            messages.push({ role: 'user', content: '[SYSTEM AUTO-READ of "' + autoPath + '"]:\n' + cappedResult });
                        } else {
                            messages.push(this._buildAssistantMessage({ text: '', toolCalls: [autoTc] }));
                            this._setActivity('working', 'Auto-reading top search match...');
                            autoResult = await runTool(autoTc);
                            messages.push(...this._buildToolResultMessages([autoTc], [autoResult]));
                        }
                        aiChatHistory.push({
                            role: 'user',
                            content: '[Tool ' + autoTc.name + ']: ' + String(autoResult || '').slice(0, 300),
                            _hiddenFromChat: true
                        });
                        toolCallsExecuted += 1;
                        this._lastAutoReadPath = autoPath;
                    }
                }

                // Persist to display history (summarized)
                aiChatHistory.push({ role: 'assistant', content: parsed.text || '(used tools: ' + parsed.toolCalls.map(tc => tc.name).join(', ') + ')' });
                aiChatHistory.push({
                    role: 'user',
                    content: parsed.toolCalls.map((tc, j) => this._formatToolResultHistorySnippet(tc, results[j], 300)).join('\n'),
                    _hiddenFromChat: true
                });

                // Check for user redirect �" inject course correction
                if (this._pendingRedirect) {
                    const redirect = this._pendingRedirect;
                    this._pendingRedirect = null;
                    messages.push({ role: 'user', content: '[USER REDIRECT]: ' + redirect + '\n\nIMPORTANT: The user wants to change direction. Stop what you were doing and follow this new instruction instead. Acknowledge the redirect briefly, then proceed with the new request.' });
                    aiChatHistory.push({ role: 'user', content: redirect });
                    addAIChatMessage('system', 'Got it � changing course.');
                    this._setActivity('working', 'Redirecting...');
                    continue; // skip step limit check, go straight to next API call
                }

                const readOnlyStep = parsed.toolCalls.length > 0
                    && parsed.toolCalls.every(tc => tc && this._isReadOnlyTool(tc.name));
                const completionCue = this._isCompletionCue(parsed.text || '');
                if (fileMutationsExecuted > 0 && successfulMutationsThisStep === 0 && readOnlyStep && completionCue) {
                    break;
                }

            }
        } catch (e) {
            capraTraceError = e;
            capraTraceStatus = e && e.name === 'AbortError' ? 'aborted' : 'error';
            if (this._workingMemory && capraTraceStatus === 'error') {
                this._workingMemory.taskStatus = 'error';
                this._workingMemory.lastError = e && e.message ? e.message : String(e);
                this._workingMemory.blocker = this._workingMemory.lastError;
                this._workingMemory.updatedAt = new Date().toISOString();
            }
            if (e.name !== 'AbortError') {
                this._setActivity('error', 'Error: ' + e.message);
                addAIChatMessage('system', 'Error: ' + e.message);
            }
        } finally {
            if ((this._abortRequested || this._abortController?.signal.aborted) && capraTraceStatus === 'completed') {
                capraTraceStatus = 'aborted';
            }
            // Preserve full-fidelity messages for continuous conversation
            this._workingMessages = messages;
            if (isAskSageRun) {
                this._askSageDebugLog('Run final state', {
                    status: capraTraceStatus,
                    totalSteps: totalSteps,
                    apiCalls: this._runApiCalls,
                    apiAttempts: this._runApiAttempts,
                    toolCallsExecuted: toolCallsExecuted,
                    fileMutationsExecuted: fileMutationsExecuted,
                    finalMessageSummary: this._summarizeTraceMessages(messages),
                    error: capraTraceError ? {
                        name: capraTraceError.name || 'Error',
                        message: capraTraceError.message || String(capraTraceError)
                    } : null
                }, capraTraceStatus === 'error' ? 'error' : (capraTraceStatus === 'aborted' || capraTraceStatus === 'timeout' ? 'warn' : 'log'));
                this._finishCapraTraceRun(capraTraceStatus, {
                    totalSteps: totalSteps,
                    apiCalls: this._runApiCalls,
                    apiAttempts: this._runApiAttempts,
                    toolCallsExecuted: toolCallsExecuted,
                    fileMutationsExecuted: fileMutationsExecuted,
                    finalTokenEstimate: this._estimateTokens(messages)
                });
            }
            if (!this._autoAcceptToggle) this._autoApproveRemaining = false;
            this._forceToolChoice = false;
            this._nudgeCount = 0;
            this._totalStallCount = 0;
            this._truncContCount = 0;
            this._completionVerified = false;
            this._runMaxRetries = null;
            this._runRequestTimeoutMs = null;
            this._runGoogleTimeoutMs = null;
            this._lastAutoReadPath = null;
            this._refreshWorkingMemoryEditorContext();
            if (this._workingMemory && this._workingMemory.taskStatus === 'active' && capraTraceStatus !== 'error') {
                this._workingMemory.taskStatus = toolCallsExecuted > 0 ? 'waiting' : 'idle';
                this._workingMemory.updatedAt = new Date().toISOString();
            }
            const pendingPlanGate = this._pendingPlanGate;
            this._setButtonState(false);
            this._abortController = null;
            if (this._abortRequested) {
                this._setActivity('idle', 'Idle');
            } else if (pendingPlanGate) {
                this._setActivity('waiting', pendingPlanGate.isPlan ? 'Waiting for plan approval...' : 'Waiting to continue...');
            } else {
                this._setActivity('idle', 'Idle');
            }
            this._abortRequested = false;
            const finalTokens = this._estimateTokens(messages);
            this._updateStepCounter(0, 0, finalTokens);
            sessionStorage.removeItem('forge:ai-pending-msg');
            this._persistChatHistory();
        }
    }
};

// ══════════════════════════════════════════════════════════════════
//  GLOBAL FUNCTIONS �" Chat display, send, config
// ══════════════════════════════════════════════════════════════════

function addAIChatMessage(role, content, attachment) {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    if (role === 'assistant') {
        var text = String(content || '');
        var gateInfo = (aiAgent && typeof aiAgent._getApprovalGateInfo === 'function')
            ? aiAgent._getApprovalGateInfo(text)
            : { needsApproval: false, isPlan: /plan/i.test(text), cleanedText: text };
        var needsApproval = !!gateInfo.needsApproval;
        var cleanedText = gateInfo.cleanedText || text;

        div.innerHTML = aiAgent._renderMarkdown(cleanedText || text);

        if (needsApproval) {
            aiAgent._showApprovalGate(gateInfo, div);
        }
    } else if (role === 'user') {
        if (attachment && attachment.type === 'image' && attachment.previewUrl) {
            var img = document.createElement('img');
            img.src = attachment.previewUrl;
            img.className = 'ai-chat-image';
            div.appendChild(img);
        }
        var textNode = document.createElement('span');
        textNode.textContent = content;
        div.appendChild(textNode);
    } else {
        div.textContent = 'Prometheus: ' + content;
    }
    if (aiAgent && typeof aiAgent._appendChatElement === 'function') {
        aiAgent._appendChatElement(container, div, { force: role === 'user' });
    } else {
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        const shouldAutoScroll = role === 'user' || distanceFromBottom <= 24;
        container.appendChild(div);
        if (shouldAutoScroll) container.scrollTop = container.scrollHeight;
    }
}

function sendAIMessage() {
    const input = document.getElementById('ai-chat-input');
    let msg = input.value.trim();
    if (!msg) return;
    // Sync selected skill from chip into explicit agent state.
    const chip = document.querySelector('.ai-skill-chip');
    if (chip && typeof aiAgent !== 'undefined' && aiAgent && typeof aiAgent.setActiveSkillByName === 'function') {
        const skillName = String(chip.getAttribute('data-skill-name') || '').trim()
            || chip.textContent.replace(/\s*�?\s*$/, '').trim().replace(/^\//, '');
        if (skillName) aiAgent.setActiveSkillByName(skillName);
    }
    input.value = '';
    autoResizeAthenaInput(input);
    aiAgent.sendMessage(msg);
}

function openAIAttachPicker() {
    var input = document.getElementById('ai-attach-input');
    if (input) input.click();
}

function bindManagedDomEvent(el, type, key, handler, options) {
    if (!el || !type || !handler) return;
    const listenerKey = key || type;
    const store = el.__forgeManagedListeners || (el.__forgeManagedListeners = {});
    if (store[listenerKey]) {
        el.removeEventListener(type, store[listenerKey]);
    }
    store[listenerKey] = handler;
    el.addEventListener(type, handler, options);
}

function bindAthenaDiffDebugHotkey() {
    bindManagedDomEvent(document, 'keydown', 'athena-diff-debug-copy', function (event) {
        const key = String(event.key || '').toLowerCase();
        if (event.ctrlKey && event.shiftKey && event.altKey && key === 'd') {
            event.preventDefault();
            if (typeof aiAgent !== 'undefined' && aiAgent && typeof aiAgent.copyLastDiffDebugPackage === 'function') {
                aiAgent.copyLastDiffDebugPackage();
            }
        }
    });
}

function bindAthenaStaticDomEvents() {
    bindAthenaDiffDebugHotkey();

    const input = document.getElementById('ai-chat-input');
    if (input) {
        bindManagedDomEvent(input, 'input', 'athena-resize', function () { autoResizeAthenaInput(input); });
        bindManagedDomEvent(input, 'keydown', 'athena-send', function (event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendAIMessage();
            }
        });
        bindManagedDomEvent(input, 'paste', 'athena-paste', function (event) { aiAgent.handlePaste(event); });
    }

    const attachInput = document.getElementById('ai-attach-input');
    if (attachInput) {
        bindManagedDomEvent(attachInput, 'change', 'athena-attach-input', function (event) {
            aiAgent.handleAttachment(event.target);
        });
    }

    const profilesImportInput = document.getElementById('ai-profiles-import-input');
    if (profilesImportInput) {
        bindManagedDomEvent(profilesImportInput, 'change', 'athena-profiles-import', function (event) {
            aiAgent.importProfilesFromFile(event.target);
        });
    }

    const clickBindings = [
        ['ai-review-open-btn', function () { openAIPendingDiff(); }],
        ['ai-review-accept-all-btn', function () { acceptAllAIPendingFromIDE(); }],
        ['ai-review-accept-btn', function () { approveAIPendingFromIDE(); }],
        ['ai-review-reject-btn', function () { rejectAIPendingFromIDE(); }],
        ['athena-new-chat-btn', function () { restartAthenaConversation(); }],
        ['athena-preset-toggle-btn', function () { aiAgent.togglePresetDropdown(); }],
        ['athena-history-toggle-btn', function () { aiAgent.toggleHistoryDropdown(); }],
        ['athena-config-toggle', function () { toggleAthenaConfig(); }],
        ['athena-close-btn', function () { toggleRightPanel(false); }],
        ['ai-chat-attach-btn', function () { openAIAttachPicker(); }],
        ['ai-chat-send-btn', function () { sendAIMessage(); }],
        ['ai-chat-stop', function () { aiAgent.abort(); }],
        ['ai-chat-stop-inline', function () { aiAgent.abort(); }],
        ['ai-config-close-btn', function () { toggleAthenaConfig(false); }],
        ['ai-prometheus-setup-help-btn', function () { aiAgent.showPrometheusSetupModal('guide'); }],
        ['ai-key-use-loaded-btn', function () { aiAgent.useLoadedValidatedKey(); }],
        ['ai-capra-trace-export', function () { aiAgent.exportCapraTraceJson(); }],
        ['ai-capra-trace-clear', function () { aiAgent.clearCapraTraceHistory(); }],
        ['ai-capra-probe-run', function () { aiAgent.runCapraToolProbe(); }],
        ['ai-capra-probe-export', function () { aiAgent.exportCapraProbeResults(); }],
        ['ai-save-config-btn', function () { saveAgentConfig(); }],
        ['ai-export-profiles-btn', function () { aiAgent.exportProfilesJson(); }],
        ['ai-import-profiles-btn', function () { aiAgent.openProfilesImportPicker(); }],
        ['prometheus-setup-help-btn', function () { aiAgent.showPrometheusSetupModal('guide'); }],
        ['prometheus-setup-skip-btn', function () { aiAgent.dismissPrometheusSetupModal(true); }],
        ['prometheus-setup-later-btn', function () { aiAgent.dismissPrometheusSetupModal(false); }],
        ['prometheus-setup-open-config-btn', function () { aiAgent.openCapraGuidedSetup(); }],
        ['prometheus-setup-done-btn', function () { aiAgent.dismissPrometheusSetupModal(true); }],
        ['prometheus-setup-back-btn', function () { aiAgent.showPrometheusSetupModal('choice'); }]
    ];
    clickBindings.forEach(function (binding) {
        const el = document.getElementById(binding[0]);
        if (el) bindManagedDomEvent(el, 'click', 'athena-static-click', binding[1]);
    });

    const changeBindings = [
        ['ai-html-app-mode', function (event) { aiAgent.toggleHtmlAppMode(event.target.checked); }],
        ['ai-plan-mode', function (event) { aiAgent.togglePlanMode(event.target.checked); }],
        ['ai-auto-accept', function (event) { aiAgent.toggleAutoAccept(event.target.checked); }],
        ['ai-max-steps', function () { aiAgent._applyLimits(); }],
        ['ai-max-time', function () { aiAgent._applyLimits(); }],
        ['ai-provider-select', function () { aiAgent.selectProvider(true); }],
        ['ai-model-select', function () { aiAgent._onModelChange(); }],
        ['ai-capra-trace-enabled', function (event) { aiAgent.toggleCapraTrace(event.target.checked); }],
        ['ai-capra-debug-chat', function (event) { aiAgent.toggleAskSageDebug(event.target.checked); }]
    ];
    changeBindings.forEach(function (binding) {
        const el = document.getElementById(binding[0]);
        if (el) bindManagedDomEvent(el, 'change', 'athena-static-change', binding[1]);
    });

    const apiKeyInput = document.getElementById('ai-api-key');
    if (apiKeyInput) {
        bindManagedDomEvent(apiKeyInput, 'input', 'athena-api-key', function () { aiAgent.onApiKeyInput(); });
    }
}

function initAIComposer() {
    bindAthenaStaticDomEvents();
    const input = document.getElementById('ai-chat-input');
    if (input) autoResizeAthenaInput(input);
}

function autoResizeAthenaInput(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const minHeight = 52;
    const nextHeight = Math.min(160, Math.max(minHeight, textarea.scrollHeight));
    textarea.style.height = nextHeight + 'px';
}

window.autoResizeAthenaInput = autoResizeAthenaInput;

function saveAgentConfig() { aiAgent.saveProfile(); }
function clearAgentConfig() { aiAgent.deleteProfile(); }
function toggleAthenaConfig(forceOpen) {
    if (typeof forceOpen === 'boolean') aiAgent._setConfigOpen(forceOpen, { focus: forceOpen });
    else aiAgent._toggleConfig();
}
function openAIPendingDiff() { aiAgent.openPendingDiff(); }
function acceptAllAIPendingFromIDE() { aiAgent.acceptAllPending(); }
function approveAIPendingFromIDE() { aiAgent._resolvePendingApproval(true, 'ide'); }
function rejectAIPendingFromIDE() { aiAgent._resolvePendingApproval(false, 'ide'); }

// Expose on window so other modules can call aiAgent methods.
window.aiAgent = aiAgent;
window.showPrometheusCapraDevTools = function (visible) {
    return aiAgent.setCapraDevToolsVisible(visible !== false);
};
window.hidePrometheusCapraDevTools = function () {
    return aiAgent.setCapraDevToolsVisible(false);
};
initAIComposer();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAIComposer, { once: true });
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    const dd = document.getElementById('ai-profile-dropdown');
    if (dd && !e.target.closest('.profile-active') && !e.target.closest('.profile-dropdown')) {
        dd.classList.remove('open');
    }
    const hd = document.getElementById('ai-history-dropdown');
    if (hd && !e.target.closest('.ai-history-wrapper')) {
        hd.classList.remove('open');
    }
    const pd = document.getElementById('ai-preset-dropdown');
    if (pd && !e.target.closest('.ai-preset-wrapper')) {
        pd.classList.remove('open');
    }
});
