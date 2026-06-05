/* ===== Forge v2 â€” Athena: Full Agentic Coding Assistant (v2 Rewrite) ===== */
/* Zero external dependencies. Vanilla JS only. */

const aiAgent = {
    // â€”â€”â€” State â€”â€”â€”
    _profiles: [],
    _activeProfileId: null,
    _abortController: null,
    _busy: false,
    _pendingRedirect: null,    // queued user message to inject at next tool boundary
    _sessionCheckpointed: false,
    _apiFormat: null,          // 'openai' | 'anthropic' | 'google'
    _workingMessages: [],       // Full-fidelity messages for the API (reset per task)
    _readFiles: new Set(),      // Track which files the agent has read this session
    _lastToolCall: null,        // Loop detection
    _loopCount: 0,
    _streamingDiv: null,        // Current streaming message element
    _planMode: false,            // Plan mode: describe changes without applying
    _online: null,               // null = unknown, true = online, false = offline
    _onlineCheckInterval: null,  // Periodic online check timer
    _pendingApproval: null,      // Active file-change approval state
    _autoApproveRemaining: false,// If true, auto-accept remaining file approvals in this run

    // â€”â€”â€” Constants â€”â€”â€”
    MAX_ITERATIONS: 25,
    MAX_TIME_MS: 180000,        // 3 minutes
    MAX_RETRIES: 3,
    TOKEN_BUDGET: 100000,

    PROVIDERS: {
        anthropic: {
            name: 'Anthropic',
            icon: 'A',
            endpoint: 'https://api.anthropic.com/v1/messages',
            format: 'anthropic',
            keyPlaceholder: 'sk-ant-...',
            rateLimit: '50 RPM (Tier 1)',
            models: [
                { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   context: 200000, maxOutput: 128000 },
                { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', context: 200000, maxOutput: 64000 },
                { value: 'claude-opus-4-5',   label: 'Claude Opus 4.5',   context: 200000, maxOutput: 128000 },
                { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', context: 200000, maxOutput: 64000 },
                { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  context: 200000, maxOutput: 64000 }
            ]
        },
        openai: {
            name: 'OpenAI',
            icon: 'O',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            format: 'openai',
            keyPlaceholder: 'sk-...',
            rateLimit: '500 RPM (Tier 1)',
            models: [
                { value: 'gpt-5.3-codex',   label: 'GPT-5.3 Codex',  context: 400000, maxOutput: 128000 },
                { value: 'gpt-5.2',         label: 'GPT-5.2',        context: 400000, maxOutput: 128000 },
                { value: 'gpt-5.2-codex',   label: 'GPT-5.2 Codex',  context: 400000, maxOutput: 128000 },
                { value: 'o3',              label: 'o3',              context: 200000, maxOutput: 100000, flags: { reasoning: true } },
                { value: 'o3-pro',          label: 'o3 Pro',          context: 200000, maxOutput: 100000, flags: { reasoning: true } },
                { value: 'o4-mini',         label: 'o4-mini',         context: 200000, maxOutput: 100000, flags: { reasoning: true } },
                { value: 'gpt-4.1',         label: 'GPT-4.1',        context: 1047576, maxOutput: 32768 },
                { value: 'gpt-4.1-mini',    label: 'GPT-4.1 Mini',   context: 1047576, maxOutput: 32768 },
                { value: 'gpt-4.1-nano',    label: 'GPT-4.1 Nano',   context: 1047576, maxOutput: 32768 }
            ]
        },
        google: {
            name: 'Google',
            icon: 'G',
            endpoint: 'https://generativelanguage.googleapis.com',
            format: 'google',
            keyPlaceholder: 'AIza...',
            rateLimit: '5 RPM (free) / 300 RPM (paid)',
            models: [
                { value: 'gemini-3.1-pro-preview',  label: 'Gemini 3.1 Pro (Preview)',  context: 1048576, maxOutput: 65536 },
                { value: 'gemini-3-pro-preview',     label: 'Gemini 3 Pro (Preview)',    context: 1048576, maxOutput: 65536 },
                { value: 'gemini-3-flash-preview',   label: 'Gemini 3 Flash (Preview)',  context: 1048576, maxOutput: 65536 },
                { value: 'gemini-2.5-pro',           label: 'Gemini 2.5 Pro',            context: 1048576, maxOutput: 65536 },
                { value: 'gemini-2.5-flash',         label: 'Gemini 2.5 Flash',          context: 1048576, maxOutput: 65536 },
                { value: 'gemini-2.5-flash-lite',    label: 'Gemini 2.5 Flash Lite',     context: 1048576, maxOutput: 65536 }
            ]
        },
        xai: {
            name: 'xAI',
            icon: 'X',
            endpoint: 'https://api.x.ai/v1/chat/completions',
            format: 'openai',
            keyPlaceholder: 'xai-...',
            rateLimit: 'Varies by plan',
            models: [
                { value: 'grok-4-1-fast-reasoning',     label: 'Grok 4.1 Reasoning',     context: 2000000, maxOutput: 131072, flags: { reasoning: true } },
                { value: 'grok-4-1-fast-non-reasoning',  label: 'Grok 4.1 Non-Reasoning', context: 2000000, maxOutput: 131072 },
                { value: 'grok-code-fast-1',             label: 'Grok Code',              context: 256000,  maxOutput: 131072 },
                { value: 'grok-4',                       label: 'Grok 4',                 context: 256000,  maxOutput: 131072 },
                { value: 'grok-3',                       label: 'Grok 3',                 context: 131072,  maxOutput: 131072 }
            ]
        }
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  PROFILE MANAGEMENT â€” Save/switch between API configurations
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    loadProfiles() {
        try {
            const saved = localStorage.getItem('forge:ai-profiles');
            if (saved) this._profiles = JSON.parse(saved) || [];
        } catch { this._profiles = []; }
        // Migrate old single-config format
        if (!this._profiles.length) {
            try {
                const old = localStorage.getItem('forge:ai-agent-config');
                if (old) {
                    const parsed = JSON.parse(old);
                    if (parsed && parsed.endpoint) {
                        const providerId = this._detectProviderIdFromEndpoint(parsed.endpoint);
                        const providerCfg = this.PROVIDERS[providerId];
                        this._profiles.push({
                            id: this._uid(),
                            name: providerCfg?.name || 'Default',
                            provider: providerId,
                            endpoint: parsed.endpoint || '',
                            model: parsed.model || '',
                            customModel: parsed.customModel || '',
                            format: providerCfg?.format || null
                        });
                        this._saveProfiles();
                        localStorage.removeItem('forge:ai-agent-config');
                    }
                }
            } catch { }
        }
        // Backfill provider field on old profiles
        for (const p of this._profiles) {
            if (!p.provider && p.endpoint) {
                p.provider = this._detectProviderIdFromEndpoint(p.endpoint);
            }
        }
        // API keys are in sessionStorage (keyed by profile id)
        this._activeProfileId = sessionStorage.getItem('forge:ai-active-profile') || (this._profiles[0]?.id || null);
        this._renderProfileBar();
        this._populateConfigEditor();

        // Restore plan mode setting
        var savedPlanMode = localStorage.getItem('forge:ai-plan-mode') === '1';
        var planCheckbox = document.getElementById('ai-plan-mode');
        if (planCheckbox) planCheckbox.checked = savedPlanMode;
        this.togglePlanMode(savedPlanMode);

        // Start online connectivity checks
        this.startOnlineCheck();

        // Restore chat history from previous session
        this._restoreChatHistory();

        // Check for interrupted messages (after a short delay so UI is ready)
        var self = this;
        setTimeout(function () { self.checkPendingMessage(); }, 500);
    },

    _saveProfiles() {
        localStorage.setItem('forge:ai-profiles', JSON.stringify(this._profiles));
    },

    _uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    getActiveProfile() {
        return this._profiles.find(p => p.id === this._activeProfileId) || null;
    },

    getActiveApiKey() {
        if (!this._activeProfileId) return '';
        return sessionStorage.getItem('forge:ai-key-' + this._activeProfileId) || '';
    },

    switchProfile(profileId) {
        this._activeProfileId = profileId;
        this._apiFormat = null;
        sessionStorage.setItem('forge:ai-active-profile', profileId);
        this._renderProfileBar();
        this._populateConfigEditor();
    },

    selectProvider() {
        const providerEl = document.getElementById('ai-provider-select');
        const keyEl = document.getElementById('ai-api-key');
        const selectEl = document.getElementById('ai-model-select');
        if (!providerEl) return;
        const providerId = providerEl.value;
        const providerCfg = this.PROVIDERS[providerId];

        // Update key placeholder
        if (keyEl) keyEl.placeholder = providerCfg ? providerCfg.keyPlaceholder : 'Paste your API key...';

        // Populate model dropdown
        if (selectEl) {
            selectEl.innerHTML = '';
            if (!providerCfg) {
                selectEl.innerHTML = '<option value="" disabled selected>Select a provider first</option>';
                return;
            }
            for (const m of providerCfg.models) {
                const opt = document.createElement('option');
                opt.value = m.value;
                opt.textContent = m.label;
                selectEl.appendChild(opt);
            }
            const customOpt = document.createElement('option');
            customOpt.value = 'custom';
            customOpt.textContent = 'Custom model ID...';
            selectEl.appendChild(customOpt);
        }
        this._syncCustomField();
        this._updateModelInfo();
    },

    saveProfile() {
        const providerEl = document.getElementById('ai-provider-select');
        const keyEl = document.getElementById('ai-api-key');
        const selectEl = document.getElementById('ai-model-select');
        const customEl = document.getElementById('ai-model-custom');
        const providerId = (providerEl?.value || '').trim();
        const apiKey = (keyEl?.value || '').trim();
        const model = selectEl?.value === 'custom'
            ? (customEl?.value || '').trim()
            : (selectEl?.value || '').trim();

        if (!providerId || !this.PROVIDERS[providerId]) {
            this._showConfigStatus('Select a provider.', 'error');
            return;
        }
        if (!apiKey) {
            this._showConfigStatus('Enter an API key.', 'error');
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

        let profile = this.getActiveProfile();
        if (profile) {
            profile.name = name;
            profile.provider = providerId;
            profile.endpoint = endpoint;
            profile.model = model;
            profile.customModel = selectEl?.value === 'custom' ? model : '';
            profile.format = providerCfg.format;
        } else {
            profile = {
                id: this._uid(),
                name,
                provider: providerId,
                endpoint,
                model,
                customModel: selectEl?.value === 'custom' ? model : '',
                format: providerCfg.format
            };
            this._profiles.push(profile);
            this._activeProfileId = profile.id;
            sessionStorage.setItem('forge:ai-active-profile', profile.id);
        }

        // Store API key in sessionStorage only (security)
        sessionStorage.setItem('forge:ai-key-' + profile.id, apiKey);

        this._apiFormat = null;
        this._saveProfiles();
        this._renderProfileBar();
        this._showConfigStatus('Saved. Verifying key...', 'dim');

        // Verify the API key actually works with this provider
        var self = this;
        this._verifyApiKey(providerId, apiKey, model).then(function (result) {
            if (result.ok) {
                self._showConfigStatus('Verified! Key is valid.', 'success');
                self._updateOnlineIndicator(true);
            } else {
                self._showConfigStatus('Key error: ' + result.reason, 'error');
            }
        });
    },

    deleteProfile() {
        const profile = this.getActiveProfile();
        if (!profile) return;
        if (!confirm('Delete profile "' + profile.name + '"?')) return;
        sessionStorage.removeItem('forge:ai-key-' + profile.id);
        this._profiles = this._profiles.filter(p => p.id !== profile.id);
        this._activeProfileId = this._profiles[0]?.id || null;
        if (this._activeProfileId) sessionStorage.setItem('forge:ai-active-profile', this._activeProfileId);
        this._apiFormat = null;
        this._saveProfiles();
        this._renderProfileBar();
        this._populateConfigEditor();
        this._showConfigStatus('Profile deleted.', 'dim');
    },

    addNewProfile() {
        const profile = {
            id: this._uid(),
            name: 'New Profile',
            provider: '',
            endpoint: '',
            model: '',
            customModel: '',
            format: null
        };
        this._profiles.push(profile);
        this._activeProfileId = profile.id;
        sessionStorage.setItem('forge:ai-active-profile', profile.id);
        this._apiFormat = null;
        this._saveProfiles();
        this._renderProfileBar();
        this._populateConfigEditor();
        const provEl = document.getElementById('ai-provider-select');
        if (provEl) provEl.focus();
    },

    _showConfigStatus(msg, type) {
        const el = document.getElementById('agent-config-status');
        if (!el) return;
        el.textContent = msg;
        el.style.color = type === 'error' ? 'var(--error)' : type === 'success' ? 'var(--success)' : 'var(--text-dim)';
        if (type !== 'error') setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
    },

    // â€”â€”â€” Profile Bar Rendering â€”â€”â€”

    _renderProfileBar() {
        const bar = document.getElementById('ai-profile-bar');
        if (!bar) return;
        const profile = this.getActiveProfile();
        const hasKey = !!this.getActiveApiKey();

        if (!profile) {
            bar.innerHTML = '<span class="profile-indicator no-profile" onclick="aiAgent.addNewProfile()" title="Add API profile">+ Add API</span>';
            return;
        }

        const providerId = profile.provider || this._detectProviderIdFromEndpoint(profile.endpoint);
        const providerIcon = this._getProviderIcon(providerId);
        const modelShort = this._shortenModel(profile.model);
        const statusDot = hasKey
            ? '<span class="profile-dot connected" title="API key set"></span>'
            : '<span class="profile-dot disconnected" title="No API key"></span>';

        let dropdownHtml = '';
        if (this._profiles.length > 1) {
            dropdownHtml = '<div class="profile-dropdown" id="ai-profile-dropdown">';
            for (const p of this._profiles) {
                const active = p.id === this._activeProfileId ? ' active' : '';
                const prov = p.provider || this._detectProviderIdFromEndpoint(p.endpoint);
                dropdownHtml += '<div class="profile-dropdown-item' + active + '" onclick="aiAgent.switchProfile(\'' + p.id + '\')">' +
                    '<span class="profile-dropdown-icon">' + this._getProviderIcon(prov) + '</span>' +
                    '<span class="profile-dropdown-name">' + escHtml(p.name) + '</span>' +
                    '<span class="profile-dropdown-model">' + escHtml(this._shortenModel(p.model)) + '</span>' +
                    '</div>';
            }
            dropdownHtml += '</div>';
        }

        bar.innerHTML =
            '<div class="profile-active" onclick="aiAgent._toggleProfileDropdown()" title="' + escHtml(profile.name) + '">' +
            statusDot +
            '<span class="profile-provider-icon">' + providerIcon + '</span>' +
            '<span class="profile-model-name">' + escHtml(modelShort) + '</span>' +
            (this._profiles.length > 1 ? '<span class="profile-chevron">&#9662;</span>' : '') +
            '</div>' +
            '<button class="profile-add-btn" onclick="event.stopPropagation();aiAgent.addNewProfile()" title="Add new profile">+</button>' +
            '<button class="profile-add-btn" onclick="event.stopPropagation();aiAgent.deleteProfile()" title="Delete profile">&times;</button>' +
            dropdownHtml;
    },

    _toggleProfileDropdown() {
        const dd = document.getElementById('ai-profile-dropdown');
        if (dd) dd.classList.toggle('open');
    },

    _toggleConfig() {
        // Config is now always visible in the compact bar â€” no-op for backward compat
        this._populateConfigEditor();
    },

    _populateConfigEditor() {
        const profile = this.getActiveProfile();
        const providerEl = document.getElementById('ai-provider-select');
        const keyEl = document.getElementById('ai-api-key');
        const selectEl = document.getElementById('ai-model-select');
        const customEl = document.getElementById('ai-model-custom');

        // Set provider dropdown
        const providerId = profile?.provider || this._detectProviderIdFromEndpoint(profile?.endpoint);
        if (providerEl) providerEl.value = providerId || '';

        // Populate models for the provider
        this.selectProvider();

        // Set API key
        if (keyEl) keyEl.value = this.getActiveApiKey();

        // Set model
        if (selectEl && profile?.model) {
            const optExists = [...selectEl.options].some(o => o.value === profile.model);
            if (optExists) {
                selectEl.value = profile.model;
            } else if (profile.model) {
                selectEl.value = 'custom';
                if (customEl) { customEl.value = profile.model; }
            }
        }
        this._syncCustomField();
        this._updateModelInfo();
    },

    _detectProviderIdFromEndpoint(endpoint) {
        if (!endpoint) return '';
        const ep = endpoint.toLowerCase();
        if (ep.includes('anthropic')) return 'anthropic';
        if (ep.includes('openai.com')) return 'openai';
        if (ep.includes('googleapis.com')) return 'google';
        if (ep.includes('x.ai')) return 'xai';
        return '';
    },

    _getProviderIcon(providerIdOrName) {
        // Support both provider IDs (new) and display names (legacy)
        const p = String(providerIdOrName || '').toLowerCase();
        if (p === 'anthropic') return 'A';
        if (p === 'openai') return 'O';
        if (p === 'google') return 'G';
        if (p === 'xai') return 'X';
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  VALIDATION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

    _detectProvider(endpoint) {
        const ep = (endpoint || '').toLowerCase();
        if (ep.includes('anthropic')) return 'Anthropic';
        if (ep.includes('generativelanguage.googleapis.com') || ep.includes('aiplatform.googleapis.com')) return 'Google';
        if (ep.includes('openai.com')) return 'OpenAI';
        if (ep.includes('mistral')) return 'Mistral';
        if (ep.includes('deepseek')) return 'DeepSeek';
        if (ep.includes('x.ai') || ep.includes('/xai')) return 'xAI';
        if (ep.includes('llama') || ep.includes('meta')) return 'Meta';
        return null;
    },

    filterModelsByEndpoint() {
        // Legacy compat â€” now handled by selectProvider()
        this.selectProvider();
    },

    _onModelChange() {
        this._syncCustomField();
        this._updateModelInfo();
    },

    _syncCustomField() {
        const select = document.getElementById('ai-model-select');
        const customRow = document.getElementById('ai-custom-model-row');
        if (!select || !customRow) return;
        customRow.style.display = select.value === 'custom' ? 'flex' : 'none';
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  API FORMAT DETECTION & ENDPOINT RESOLUTION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
        } else {
            this._apiFormat = 'openai';
        }
        return this._apiFormat;
    },

    _getApiUrl(streaming) {
        const profile = this.getActiveProfile();
        if (!profile) return '';
        const fmt = this._detectFormat();
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  TOOL DEFINITIONS â€” Format-agnostic, converted per provider
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
                description: 'Read the full content of a file. ALWAYS read a file before modifying it. Returns file content as text.',
                params: {
                    path: { type: 'string', description: 'File path relative to project root (e.g. "js/app.js", "index.html")' }
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
                description: 'Search file contents with a regex pattern. Returns matching lines as "file:line: content". Max 100 results.',
                params: {
                    pattern: { type: 'string', description: 'Regex pattern to search for' },
                    fileGlob: { type: 'string', description: 'Optional file extension filter (e.g. "js", "html", "css")' }
                },
                required: ['pattern']
            },
            {
                name: 'replaceInFile',
                description: 'Find exact text in a file and replace it. Prefer this over writeFile for targeted edits. User will be shown a diff.',
                params: {
                    path: { type: 'string', description: 'File path' },
                    find: { type: 'string', description: 'Exact text to find (must match exactly, including whitespace)' },
                    replace: { type: 'string', description: 'Replacement text' }
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  TOOL EXECUTION â€” With read-tracking and actionable errors
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    async _executeTool(name, args) {
        try {
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
                case 'listFiles':
                    return Object.keys(fileHandles).join('\n') || 'No files loaded. Ask the user to open a project directory first.';

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
                        const content = await readFileContent(safePath);
                        this._readFiles.add(safePath);
                        return content;
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
                        const oldContent = await readFileContent(safePath);
                        const approvalResult = await this._requestApproval(safePath, oldContent, newContent);
                        const approved = approvalResult && (approvalResult === true || approvalResult.accepted);
                        const finalContent = (approvalResult && approvalResult.content != null) ? approvalResult.content : newContent;
                        if (!approved) return 'User rejected this file change. Ask the user what they would prefer or try a different approach.';
                        await writeFileToHandle(handle, finalContent);
                        this._syncEditor(safePath, finalContent);
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
                        const ok = confirm('Athena wants to delete "' + safePath + '". Allow?');
                        if (!ok) return 'User rejected file deletion.';
                        const parts = safePath.split('/');
                        let parent = dirHandle;
                        for (let i = 0; i < parts.length - 1; i++) parent = await parent.getDirectoryHandle(parts[i]);
                        await parent.removeEntry(parts[parts.length - 1]);
                        closeTab(safePath);
                        delete fileHandles[safePath];
                        await refreshFileTree();
                        return 'Deleted: ' + safePath;
                    } catch (e) {
                        return 'Error deleting file "' + safePath + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'searchFiles': {
                    try {
                        let regex;
                        try { regex = new RegExp(args.pattern, 'gi'); } catch (e) { return 'Error: Invalid regex: ' + e.message; }
                        const ext = args.fileGlob ? args.fileGlob.replace(/^\*?\.?/, '').toLowerCase() : null;
                        const results = [];
                        for (const path of Object.keys(fileHandles)) {
                            if (ext && !path.toLowerCase().endsWith('.' + ext)) continue;
                            const content = await readFileContent(path);
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                if (regex.test(lines[i])) {
                                    results.push(path + ':' + (i + 1) + ': ' + lines[i].trim());
                                    if (results.length >= 100) break;
                                }
                                regex.lastIndex = 0;
                            }
                            if (results.length >= 100) break;
                        }
                        return results.length ? results.join('\n') : 'No matches found for pattern: "' + args.pattern + '".';
                    } catch (e) {
                        return 'Error searching files: ' + (e.message || 'Unknown error');
                    }
                }

                case 'replaceInFile': {
                    const safePath = this._normalizeToolPath(args.path);
                    if (!safePath) return 'Error: Invalid file path.';
                    const findText = typeof args.find === 'string' ? args.find : String(args.find ?? '');
                    const replaceText = typeof args.replace === 'string' ? args.replace : String(args.replace ?? '');
                    if (!findText) return 'Error: find text is required.';
                    const handle = fileHandles[safePath];
                    if (!handle) return 'Error: File not found: "' + safePath + '".';
                    try {
                        const content = await readFileContent(safePath);
                        if (!content.includes(findText)) {
                            const firstLine = findText.split('\n')[0].trim();
                            const nearLines = content.split('\n').filter(l => l.includes(firstLine.slice(0, 30))).slice(0, 3);
                            return 'Error: Exact text not found in ' + safePath + '.' +
                                (nearLines.length ? ' Similar lines found:\n' + nearLines.join('\n') : ' Use readFile to check the current content.');
                        }
                        const newContent = content.split(findText).join(replaceText);
                        await this._ensureCheckpoint();
                        const replaceResult = await this._requestApproval(safePath, content, newContent);
                        const replaceApproved = replaceResult && (replaceResult === true || replaceResult.accepted);
                        const replaceContent = (replaceResult && replaceResult.content != null) ? replaceResult.content : newContent;
                        if (!replaceApproved) return 'User rejected this replacement.';
                        await writeFileToHandle(handle, replaceContent);
                        this._syncEditor(safePath, replaceContent);
                        markUnsaved(safePath);
                        const count = content.split(findText).length - 1;
                        return 'Replaced ' + count + ' occurrence(s) in ' + safePath;
                    } catch (e) {
                        return 'Error replacing in file "' + safePath + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'getActiveFile': {
                    if (!activeFile) return 'No file is currently active in the editor. Use listFiles to see available files.';
                    try {
                        const content = await readFileContent(activeFile);
                        this._readFiles.add(activeFile);
                        return 'Active file: ' + activeFile + '\n\n' + content;
                    } catch (e) {
                        return 'Error reading active file "' + activeFile + '": ' + (e.message || 'Unknown error');
                    }
                }

                case 'getProjectInfo': {
                    const name = dirHandle ? dirHandle.name : 'No project loaded';
                    const count = Object.keys(fileHandles).length;
                    const open = openFiles.map(f => f.path).join(', ') || 'none';
                    return 'Project: ' + name + '\nTotal files: ' + count + '\nOpen files: ' + open + '\nActive: ' + (activeFile || 'none');
                }

                case 'createCheckpoint': {
                    if (!dirHandle) return 'No project loaded.';
                    try {
                        const cpName = args.name || 'Athena checkpoint';
                        const ok = await checkpointManager.createAutoCheckpoint(cpName);
                        return ok ? 'Checkpoint created: ' + cpName : 'Failed to create checkpoint.';
                    } catch (e) {
                        return 'Error creating checkpoint: ' + (e.message || 'Unknown error');
                    }
                }

                default:
                    return 'Error: Unknown tool "' + name + '". Available tools: ' + this._toolDefs().map(t => t.name).join(', ');
            }
        } catch (e) {
            return 'Tool error (' + name + '): ' + (e.message || 'Unknown error');
        }
    },

    _syncEditor(path, content) {
        // Auto-open the file if not already open so the user sees changes live
        let f = openFiles.find(fi => fi.path === path);
        if (!f && fileHandles[path]) {
            const ext = path.split('.').pop().toLowerCase();
            openFiles.push({ path, name: path.split('/').pop(), content, original: content, ext });
            renderTabs();
            activateTab(path);
            f = openFiles.find(fi => fi.path === path);
        }
        if (f) {
            f.content = content;
            if (cmEditors[path]) {
                const view = cmEditors[path];
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
            }
            // Bring the file into view if not active
            if (activeFile !== path) activateTab(path);
        }
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  AUTO-CHECKPOINT
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    async _ensureCheckpoint() {
        if (this._sessionCheckpointed || !dirHandle) return;
        this._sessionCheckpointed = true;
        addAIChatMessage('system', 'Creating auto-checkpoint before AI changes...');
        await checkpointManager.createAutoCheckpoint('Before Athena changes');
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  APPROVAL UI â€” Diff preview with accept/reject
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _renderPendingApprovalBar(state) {
        const bar = document.getElementById('ai-review-bar');
        const label = document.getElementById('ai-review-label');
        const openBtn = document.getElementById('ai-review-open-btn');
        if (!bar || !label) return false;
        const suffix = state.oldContent === null ? ' (new file)' : '';
        label.innerHTML = '<span class="codicon codicon-git-compare"></span> Athena change pending: <code>' + escHtml(state.path) + suffix + '</code>';
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
                '<span class="codicon codicon-git-compare"></span> ' +
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

        if (!accepted) this._autoApproveRemaining = false;

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

        // Merge editor now auto-continues when all hunks are resolved.
        // Keep it enabled for richer in-editor review (overview ruler + per-hunk controls).
        const useMergeEditorApproval = true;

        // Use merge editor only when explicitly enabled
        if (useMergeEditorApproval && typeof mergeEditor !== 'undefined' && window.cmModules && window.cmModules.StateField) {
            var self = this;
            // Show mini diff in chat for context
            var container = document.getElementById('ai-chat-messages');
            var chatBtnsEl = null;
            if (container) {
                var div = document.createElement('div');
                div.className = 'ai-msg';
                div.innerHTML = this._buildDiffHtml(path, oldContent, newContent) +
                    '<div class="approve-btns"><span style="font-size:11px;color:var(--text-dim)">Review in merge editor...</span></div>';
                chatBtnsEl = div.querySelector('.approve-btns');
                container.appendChild(div);
                container.scrollTop = container.scrollHeight;
            }
            // No approval bar â€” the merge editor has its own Accept/Reject controls
            return mergeEditor.open(path, oldContent, newContent).then(function (result) {
                self._setActivity('working', 'Continuing...');
                if (chatBtnsEl) {
                    chatBtnsEl.innerHTML = result.accepted
                        ? '<span style="color:var(--success);font-size:11px">Accepted in merge editor</span>'
                        : '<span style="color:var(--error);font-size:11px">Rejected in merge editor</span>';
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
                const div = document.createElement('div');
                div.className = 'ai-msg';
                const diffHtml = this._buildDiffHtml(path, oldContent, newContent);
                div.innerHTML = diffHtml +
                    '<div class="approve-btns">' +
                    '<button class="btn btn-sm btn-success" data-action="accept-all">Accept All</button>' +
                    '<button class="btn btn-sm btn-success" data-action="accept">Accept</button>' +
                    '<button class="btn btn-sm" data-action="reject">Reject</button>' +
                    '</div>';
                state.chatButtonsEl = div.querySelector('.approve-btns');
                div.querySelector('[data-action="accept-all"]').addEventListener('click', () => this.acceptAllPending());
                div.querySelector('[data-action="accept"]').addEventListener('click', () => this._resolvePendingApproval(true, 'chat'));
                div.querySelector('[data-action="reject"]').addEventListener('click', () => this._resolvePendingApproval(false, 'chat'));
                container.appendChild(div);
                container.scrollTop = container.scrollHeight;
            }

            if (hasInlineBar) {
                this.openPendingDiff();
            }

            if (!hasInlineBar && !container) {
                const ok = confirm('Athena wants to change "' + path + '". Accept?');
                this._resolvePendingApproval(ok, 'fallback');
            }
        });
    },

    _buildDiffHtml(path, oldContent, newContent, opts = {}) {
        let bodyHtml = '';
        const maxShow = Number.isFinite(opts.maxShow) ? opts.maxShow : 60;
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
            '<div class="diff-header"><span class="codicon codicon-file"></span> ' + escHtml(path) + (oldContent === null ? ' (new file)' : '') + '</div>' +
            '<div class="diff-body">' + bodyHtml + '</div></div>';
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  SYSTEM PROMPT â€” Dynamic, instruction-rich
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _buildSystemPrompt() {
        const projectName = dirHandle ? dirHandle.name : 'No project loaded';
        const fileCount = Object.keys(fileHandles).length;
        const modelInfo = this._getModelInfo(this.getEffectiveModel());
        const ctx = modelInfo?.context || 200000;
        const maxFiles = ctx > 500000 ? 80 : (ctx > 200000 ? 50 : 25);
        const fileList = Object.keys(fileHandles).slice(0, maxFiles).join(', ');
        const openList = openFiles.map(f => f.path).join(', ') || 'none';
        const active = activeFile || 'none';

        var prompt = `You are Athena, an expert coding agent inside Forge (Forge), a browser-based IDE for building offline HTML/CSS/JS applications.

You have tools to read, write, create, delete, and search files in the user's project. Use them to accomplish coding tasks.

<environment>
Project: ${projectName}
Files (${fileCount}): ${fileList}${fileCount > maxFiles ? '... (use listFiles for full list)' : ''}
Open in editor: ${openList}
Active file: ${active}
</environment>

<instructions>
## Planning
Before making ANY code changes:
1. Read the relevant files with readFile to understand current state
2. Identify what needs to change and why
3. Briefly explain your plan to the user
4. Execute changes step by step

## Tool Usage Rules
- ALWAYS use readFile before writeFile or replaceInFile â€” you must understand the code before changing it
- Prefer replaceInFile for targeted edits (changing a function, adding a block) â€” it shows a cleaner diff
- Only use writeFile when creating entirely new content or when most of the file changes
- Use searchFiles to find code patterns across the project before making cross-cutting changes
- Use getProjectInfo or listFiles to orient yourself when starting a new task

## Efficiency â€” MINIMIZE API CALLS
- **Batch tool calls**: Call MULTIPLE tools in a single response whenever possible. For example, read 3 files at once instead of one at a time.
- **Be concise**: Keep your responses short. Don't repeat file contents back to the user â€” just describe what you changed.
- **Don't re-read files** you already have in context from earlier in the conversation.
- **Combine related changes** into one replaceInFile or writeFile call instead of multiple small edits to the same file.
- Every response costs tokens. Be direct and efficient.

## Code Quality
- Write clean, well-structured code
- Preserve existing code style (indentation, naming conventions, patterns)
- Do NOT add unnecessary comments, type annotations, or documentation unless asked
- Do NOT refactor code that is not related to the current task
- Keep changes minimal and focused on what was asked

## Error Handling
- If a tool call fails, read the error message and adjust your approach
- If the user rejects a change, ask them what they would prefer
- If you cannot find a file, use listFiles or searchFiles to locate it
</instructions>`;

        if (this._planMode) {
            prompt += `

<plan-mode>
You are in PLAN MODE. The user wants to see what changes you would make WITHOUT applying them.
1. Read files and analyze the codebase as normal using readFile, listFiles, searchFiles
2. Describe EXACTLY what changes you would make, including specific code snippets
3. When you call writeFile, createFile, deleteFile, or replaceInFile, they will NOT be applied â€” they are recorded as planned changes
4. Still call the write tools so the user can see your intended changes, but know they will not execute
5. At the end, summarize your complete plan with a list of all files that would be modified and why
</plan-mode>`;
        }

        prompt += `

## Planning Workflow
For any task that involves modifying files:
1. First, read the relevant files to understand the current code
2. Present a clear, numbered plan of what you intend to change, including which files and what modifications
3. End your plan with exactly: "**Ready to execute this plan?**"
4. STOP and wait for the user to respond â€” do NOT call any write tools yet
5. Only after the user confirms (e.g. "yes", "go ahead", "approved"), proceed with the actual file modifications

For simple questions, read-only tasks, or if the user says "just do it", skip the planning step and respond directly.`;

        return prompt;
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  MARKDOWN RENDERER
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

    _renderMarkdown(text) {
        if (!text) return '';
        let html = escHtml(text);
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => '<pre><code class="lang-' + (lang || 'text') + '">' + code + '</code></pre>');
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
        html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>\s*(<(?:pre|h[34]|ul|ol|blockquote|div))/g, '$1');
        html = html.replace(/(<\/(?:pre|h[34]|ul|ol|blockquote|div)>)\s*<\/p>/g, '$1');
        return this._sanitizeRenderedHtml(html);
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  API REQUEST BUILDING â€” Per-provider format
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _buildRequestBody(messages, stream) {
        const fmt = this._detectFormat();
        const model = this.getEffectiveModel();
        const tools = this._getToolDefinitions();
        const info = this._getModelInfo(model);
        const maxOut = info?.maxOutput || 8192;

        if (fmt === 'anthropic') {
            const systemMsg = messages.find(m => m.role === 'system');
            const nonSystem = messages.filter(m => m.role !== 'system');
            const body = {
                model,
                system: systemMsg ? systemMsg.content : '',
                messages: nonSystem,
                tools,
                max_tokens: Math.min(maxOut, 128000),
                temperature: 0.2
            };
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
                        // Multimodal (image + text) â€” content is already in Google parts format
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
                    // OpenAI-style tool result â€” convert to Gemini functionResponse
                    contents.push({ role: 'user', parts: [{ functionResponse: { name: m._toolName || 'unknown', response: { result: m.content } } }] });
                }
            }
            const systemMsg = messages.find(m => m.role === 'system');
            const genConfig = { maxOutputTokens: Math.min(maxOut, 65536), temperature: 0.2 };
            const body = {
                contents,
                tools,
                systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
                generationConfig: genConfig
            };
            // Gemini 2.5 thinking â€” top-level thinkingConfig (Gemini 3 preview doesn't support it yet)
            if (model && /^gemini-2\.5/.test(model)) {
                body.thinkingConfig = { thinkingBudget: 2048 };
            }
            return body;
        }

        // OpenAI format (default)
        const body = { model, messages, tools };
        const modelInfo = this._getModelInfo(model);
        if (modelInfo?.flags?.reasoning) {
            // Reasoning models use max_completion_tokens, no temperature
            body.max_completion_tokens = Math.min(maxOut, 128000);
            body.reasoning_effort = 'medium';
        } else {
            body.max_tokens = Math.min(maxOut, 128000);
            body.temperature = 0.2;
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

        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 10000);

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
                // Use generateContent with a tiny request
                url = providerCfg.endpoint + '/v1beta/models/' + model + ':generateContent?key=' + apiKey;
                headers = { 'Content-Type': 'application/json' };
                body = JSON.stringify({
                    contents: [{ parts: [{ text: 'Hi' }] }],
                    generationConfig: { maxOutputTokens: 1 }
                });
                method = 'POST';
            } else {
                // OpenAI-compatible (openai, xai)
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
            if (res.status === 404) {
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
                return { ok: false, reason: 'Request timed out. Check your network connection.' };
            }
            // Fetch failures (CORS, network) â€” can't distinguish, but likely offline or CORS
            if (!navigator.onLine) {
                return { ok: false, reason: 'You appear to be offline.' };
            }
            return { ok: false, reason: 'Connection failed: ' + (e.message || 'Unknown error') };
        }
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  RESPONSE PARSING â€” Per-provider
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _parseResponse(data) {
        const fmt = this._detectFormat();
        if (fmt === 'anthropic') return this._parseAnthropicResponse(data);
        if (fmt === 'google') return this._parseGoogleResponse(data);
        return this._parseOpenAIResponse(data);
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
        const thoughtSignatures = [];
        for (const part of parts) {
            if (part.text) text += part.text;
            if (part.functionCall) {
                toolCalls.push({
                    id: 'gc_' + this._uid(),
                    name: part.functionCall.name,
                    args: part.functionCall.args || {}
                });
            }
            if (part.thoughtSignature) {
                thoughtSignatures.push(part.thoughtSignature);
            }
        }
        const stopReason = candidate.finishReason || (toolCalls.length ? 'tool_calls' : 'stop');
        return { text, toolCalls, stopReason, thoughtSignatures };
    },

    _safeParse(str) {
        if (!str) return {};
        if (typeof str === 'object') return str;
        try { return JSON.parse(str); } catch { return {}; }
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  MESSAGE BUILDERS â€” Construct format-correct messages
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _capToolResult(text, maxChars) {
        // Cap large tool results to avoid blowing up the context
        const limit = maxChars || 12000; // ~3.5K tokens
        if (!text || text.length <= limit) return text;
        const half = Math.floor(limit / 2);
        return text.slice(0, half) + '\n\n... [' + Math.round((text.length - limit) / 1000) + 'K chars omitted â€” use readFile to re-read if needed] ...\n\n' + text.slice(-half);
    },

    _buildToolResultMessages(toolCalls, results) {
        const fmt = this._detectFormat();
        const capped = results.map(r => this._capToolResult(String(r)));
        if (fmt === 'anthropic') {
            return [{
                role: 'user',
                content: toolCalls.map((tc, i) => ({
                    type: 'tool_result',
                    tool_use_id: tc.id,
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
                    content: capped[i]
                }))
            }];
        }
        // OpenAI
        return toolCalls.map((tc, i) => ({
            role: 'tool',
            tool_call_id: tc.id,
            _toolName: tc.name,
            content: capped[i]
        }));
    },

    _buildAssistantMessage(parsed) {
        const fmt = this._detectFormat();
        if (fmt === 'anthropic' || fmt === 'google') {
            const blocks = [];
            let sigIdx = 0;
            if (parsed.text) blocks.push({ type: 'text', text: parsed.text });
            for (const tc of parsed.toolCalls) {
                const block = { type: 'tool_use', id: tc.id, name: tc.name, input: tc.args };
                if (parsed.thoughtSignatures && parsed.thoughtSignatures[sigIdx]) {
                    block._thoughtSignature = parsed.thoughtSignatures[sigIdx];
                    sigIdx++;
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  CONTEXT MANAGEMENT â€” Token estimation & compaction
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _getTokenBudget() {
        const info = this._getModelInfo(this.getEffectiveModel());
        const ctx = info?.context || 200000;
        // 40% of context window, clamped to 60Kâ€“400K
        return Math.max(60000, Math.min(400000, Math.floor(ctx * 0.4)));
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
        // Phase 1: Trim large tool results in older messages (keep last 4 intact)
        const keepRecent = 4;
        const trimBoundary = Math.max(1, messages.length - keepRecent);
        for (let i = 1; i < trimBoundary; i++) {
            const m = messages[i];
            if (typeof m.content === 'string' && m.content.length > 2000) {
                // Truncate large string results (tool outputs, file contents)
                messages[i] = { ...m, content: m.content.slice(0, 800) + '\n... [truncated â€” ' + Math.round(m.content.length / 1000) + 'K chars]' };
            } else if (Array.isArray(m.content)) {
                // Truncate blocks (Anthropic/Google tool results)
                messages[i] = { ...m, content: m.content.map(block => {
                    if (block.content && typeof block.content === 'string' && block.content.length > 2000) {
                        return { ...block, content: block.content.slice(0, 800) + '\n... [truncated â€” ' + Math.round(block.content.length / 1000) + 'K chars]' };
                    }
                    return block;
                })};
            }
        }

        // Check if Phase 1 was enough
        if (this._estimateTokens(messages) <= this._getTokenBudget()) {
            return messages;
        }

        // Phase 2: Full summarization â€” keep system + last 6, summarize middle
        if (messages.length <= 8) return messages;
        const system = messages[0];
        const middle = messages.slice(1, -6);
        const recent = messages.slice(-6);

        let summary = 'Previous conversation summary:\n';
        for (const m of middle) {
            if (m.role === 'user' && typeof m.content === 'string') {
                summary += '- User: ' + m.content.slice(0, 120) + '\n';
            } else if (m.role === 'assistant') {
                const text = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join('') : '');
                if (text) summary += '- Athena: ' + text.slice(0, 120) + '\n';
                const tools = Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_use').map(b => b.name) : [];
                if (tools.length) summary += '  (used tools: ' + tools.join(', ') + ')\n';
            }
        }

        return [
            system,
            { role: 'user', content: summary },
            { role: 'assistant', content: 'Understood, continuing with the conversation context.' },
            ...recent
        ];
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  STREAMING â€” Parse SSE chunks for Anthropic/OpenAI
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
        if (container) { container.appendChild(div); container.scrollTop = container.scrollHeight; }
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
                                div.innerHTML = this._renderMarkdown(fullText) + '<span class="stream-cursor"></span>';
                                if (container) container.scrollTop = container.scrollHeight;
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
                        // Google Gemini streaming â€” each chunk is a full candidates object
                        const parts = parsed.candidates?.[0]?.content?.parts || [];
                        for (const part of parts) {
                            if (part.text) {
                                fullText += part.text;
                                div.innerHTML = this._renderMarkdown(fullText) + '<span class="stream-cursor"></span>';
                                if (container) container.scrollTop = container.scrollHeight;
                            }
                            if (part.functionCall) {
                                toolCalls.push({
                                    id: 'gc_' + this._uid(),
                                    name: part.functionCall.name,
                                    args: part.functionCall.args || {}
                                });
                            }
                            if (part.thoughtSignature) {
                                if (!this._streamThoughtSigs) this._streamThoughtSigs = [];
                                this._streamThoughtSigs.push(part.thoughtSignature);
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
                            div.innerHTML = this._renderMarkdown(fullText) + '<span class="stream-cursor"></span>';
                            if (container) container.scrollTop = container.scrollHeight;
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
            args: tc.args || this._safeParse(tc.argsStr)
        }));

        // Finalize streaming div â€” remove if empty
        if (div) {
            div.classList.remove('streaming');
            if (fullText) {
                div.innerHTML = this._renderMarkdown(fullText);
                var approvalPatterns = [
                    'ready to execute this plan',
                    'ready to execute this step',
                    'shall i proceed',
                    'should i continue',
                    'ready to proceed',
                    'does this plan look good',
                    'want me to go ahead'
                ];
                var fullTextLower = fullText.toLowerCase();
                var needsApproval = approvalPatterns.some(function (p) { return fullTextLower.includes(p); });
                if (needsApproval) {
                    var isPlan = /plan/i.test(fullText);
                    var planDiv = document.createElement('div');
                    planDiv.className = 'ai-plan-approval';

                    var planLabel = document.createElement('div');
                    planLabel.className = 'ai-plan-approval-title';
                    planLabel.textContent = isPlan ? 'Plan ready for approval' : 'Step ready for approval';
                    planDiv.appendChild(planLabel);

                    var approveBtn = document.createElement('button');
                    approveBtn.className = 'btn btn-sm btn-success ai-plan-primary';
                    approveBtn.innerHTML = isPlan
                        ? '<span class="codicon codicon-play"></span> Execute Plan'
                        : '<span class="codicon codicon-chevron-right"></span> Continue Step';
                    approveBtn.addEventListener('click', () => { if (isPlan) this.approvePlan(); else this.continueStep(); });
                    planDiv.appendChild(approveBtn);

                    var reviseBtn = document.createElement('button');
                    reviseBtn.className = 'btn btn-sm';
                    reviseBtn.textContent = isPlan ? 'Revise Plan' : 'Pause / Revise';
                    reviseBtn.addEventListener('click', () => this.revisePlan());
                    planDiv.appendChild(reviseBtn);

                    div.appendChild(planDiv);
                    this._setPlanActionButton(true, isPlan);
                    this._setActivity('waiting', isPlan ? 'Waiting for plan approval...' : 'Waiting to continue...');
                }
            } else {
                div.remove();
            }
        }
        this._streamingDiv = null;

        const result = { text: fullText, toolCalls: finalToolCalls, stopReason: stopReason || 'stop' };
        // Carry through Google thought signatures from streaming
        if (this._streamThoughtSigs && this._streamThoughtSigs.length > 0) {
            result.thoughtSignatures = this._streamThoughtSigs;
            this._streamThoughtSigs = null;
        }
        return result;
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  RETRY WITH BACKOFF
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _isRetryable(status) {
        return [429, 500, 502, 503, 529].includes(status);
    },

    async _fetchWithRetry(url, headers, body, signal) {
        let lastError;
        for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
            try {
                const res = await fetch(url, {
                    method: 'POST', headers,
                    body: JSON.stringify(body),
                    signal
                });
                if (res.ok) return res;
                const status = res.status;
                const errText = await res.text();
                if (!this._isRetryable(status) || attempt === this.MAX_RETRIES - 1) {
                    throw new Error('HTTP ' + status + ': ' + errText.slice(0, 300));
                }
                lastError = new Error('HTTP ' + status);
                // Exponential backoff with jitter
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                addAIChatMessage('system', 'Rate limited (HTTP ' + status + '). Retrying in ' + Math.round(delay / 1000) + 's...');
                await new Promise(r => setTimeout(r, delay));
            } catch (e) {
                if (e.name === 'AbortError') throw e;
                if (attempt === this.MAX_RETRIES - 1) throw e;
                lastError = e;
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                addAIChatMessage('system', 'Network error. Retrying in ' + Math.round(delay / 1000) + 's...');
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastError || new Error('Max retries exceeded');
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  UI HELPERS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _showThinking() {
        const container = document.getElementById('ai-chat-messages');
        if (!container) return null;
        const div = document.createElement('div');
        div.className = 'ai-thinking';
        div.innerHTML = '<span class="ai-thinking-dot"></span><span class="ai-thinking-dot"></span><span class="ai-thinking-dot"></span>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    },

    _hideThinking(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
    },

    _showToolCall(name, args) {
        const container = document.getElementById('ai-chat-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'ai-msg tool-call';
        const argsStr = Object.entries(args || {}).map(([k, v]) => {
            const val = typeof v === 'string' ? (v.length > 80 ? v.slice(0, 80) + '...' : v) : JSON.stringify(v);
            return k + ': ' + val;
        }).join(', ');
        div.innerHTML =
            '<div class="tool-call-header" onclick="this.classList.toggle(\'expanded\');this.nextElementSibling.classList.toggle(\'open\')">' +
            '<span class="codicon codicon-chevron-right"></span> ' +
            '<span style="color:var(--accent2)">Tool:</span> ' + escHtml(name) +
            (argsStr ? ' <span style="color:var(--text-dim)">(' + escHtml(argsStr) + ')</span>' : '') +
            '</div>' +
            '<div class="tool-call-body"></div>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    },

    _showToolResult(div, result) {
        if (!div) return;
        const body = div.querySelector('.tool-call-body');
        if (body) {
            const truncated = result.length > 500 ? result.slice(0, 500) + '\n... (' + result.length + ' chars total)' : result;
            body.textContent = truncated;
        }
    },

    _setButtonState(busy) {
        this._busy = busy;
        const sendBtn = document.getElementById('ai-chat-send-btn');
        const stopBtn = document.getElementById('ai-chat-stop');
        if (sendBtn) {
            sendBtn.style.display = '';  // always visible
            if (busy) {
                sendBtn.innerHTML = '<span class="codicon codicon-loading codicon-modifier-spin"></span>';
                sendBtn.className = 'ai-input-send-btn busy';
                sendBtn.title = 'Athena is working...';
            } else {
                sendBtn.innerHTML = '<span class="codicon codicon-send"></span>';
                sendBtn.className = 'ai-input-send-btn';
                sendBtn.title = 'Send message';
            }
        }
        if (stopBtn) stopBtn.style.display = busy ? '' : 'none';
        // Reset input placeholder
        var input = document.getElementById('ai-chat-input');
        if (input) {
            input.placeholder = busy ? 'Athena is thinking...' : 'Ask Athena anything...';
            input.disabled = busy;
        }
    },

    _applyLimits() {
        const stepsEl = document.getElementById('ai-max-steps');
        const timeEl = document.getElementById('ai-max-time');
        if (stepsEl) this.MAX_ITERATIONS = Math.max(1, Math.min(200, parseInt(stepsEl.value) || 25));
        if (timeEl) this.MAX_TIME_MS = Math.max(60000, Math.min(1800000, (parseInt(timeEl.value) || 3) * 60000));
    },

    _updateStepCounter(step, max, tokens) {
        const el = document.getElementById('ai-step-counter');
        const tokEl = document.getElementById('ai-token-counter');
        if (el) {
            if (step <= 0 || max <= 0) {
                el.style.display = 'none';
                el.textContent = '';
            } else {
                el.style.display = '';
                el.textContent = 'Step ' + step + '/' + max;
                el.style.color = step > max * 0.8 ? 'var(--warning, orange)' : '';
            }
        }
        if (tokEl) {
            if (tokens > 0) {
                tokEl.style.display = '';
                const k = Math.round(tokens / 1000);
                tokEl.textContent = '~' + k + 'K tok';
                const budget = this._getTokenBudget();
                const pct = tokens / budget;
                tokEl.style.color = pct > 0.8 ? 'var(--error, #e74c3c)' : pct > 0.5 ? 'var(--warning, orange)' : 'var(--text-dim)';
                tokEl.title = '~' + k + 'K tokens used / ' + Math.round(budget / 1000) + 'K budget';
            } else if (step <= 0) {
                tokEl.style.display = 'none';
            }
        }
    },

    _askContinue(step, tokens) {
        return new Promise(resolve => {
            const container = document.getElementById('ai-chat-messages');
            if (!container) { resolve(false); return; }
            const div = document.createElement('div');
            div.className = 'ai-msg system';
            const tokStr = tokens > 0 ? ' (~' + Math.round(tokens / 1000) + 'K tokens used)' : '';
            div.innerHTML =
                '<div style="margin-bottom:6px">Reached ' + step + ' steps' + tokStr + '. Continue?</div>' +
                '<div style="display:flex;gap:6px">' +
                '<button class="btn btn-sm btn-primary" data-action="yes">Continue</button>' +
                '<button class="btn btn-sm" data-action="no">Stop</button>' +
                '</div>';
            div.querySelector('[data-action="yes"]').addEventListener('click', () => {
                div.innerHTML = '<span style="color:var(--text-dim);font-size:11px">Continuing...</span>';
                resolve(true);
            });
            div.querySelector('[data-action="no"]').addEventListener('click', () => {
                div.innerHTML = '<span style="color:var(--text-dim);font-size:11px">Stopped by user.</span>';
                resolve(false);
            });
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        });
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  ATTACHMENTS â€” Images and files
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
            el.innerHTML = '<span class="codicon codicon-file"></span> ' +
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  PLAN MODE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
            : 'Ask Athena anything...';
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  ONLINE STATUS INDICATOR
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _updateOnlineIndicator(state) {
        this._online = state;
        var dot = document.getElementById('ai-online-status');
        if (!dot) return;
        dot.className = 'ai-online-dot ' + (state === true ? 'online' : state === false ? 'offline' : 'unknown');
        dot.title = state === true ? 'API reachable' : state === false ? 'API unreachable (offline)' : 'Checking...';
    },

    _setActivity(state, title) {
        var dot = document.getElementById('ai-activity-indicator');
        var label = document.getElementById('ai-activity-label');
        if (dot) {
            dot.className = 'ai-activity-dot ' + state;
            dot.title = title || state;
        }
        if (label) label.textContent = (state === 'idle') ? '' : (title || '');
    },

    _setPlanActionButton(show, isPlan) {
        var btn = document.getElementById('ai-plan-execute-btn');
        if (!btn) return;
        if (!show) {
            btn.style.display = 'none';
            btn.classList.remove('step-mode');
            btn.innerHTML = '<span class="codicon codicon-play"></span> Execute Plan';
            btn.title = 'Execute pending plan';
            bindManagedAiListener(btn, 'click', 'athena-plan-action', () => this.approvePlan());
            return;
        }
        var planGate = isPlan !== false;
        btn.style.display = '';
        btn.classList.toggle('step-mode', !planGate);
        btn.innerHTML = planGate
            ? '<span class="codicon codicon-play"></span> Execute Plan'
            : '<span class="codicon codicon-chevron-right"></span> Continue Step';
        btn.title = planGate ? 'Execute pending plan' : 'Continue pending step';
        bindManagedAiListener(btn, 'click', 'athena-plan-action', () => {
            if (planGate) this.approvePlan();
            else this.continueStep();
        });
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  PLAN APPROVAL
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    approvePlan() {
        // Remove any existing plan approval buttons
        document.querySelectorAll('.ai-plan-approval').forEach(el => el.remove());
        this._setPlanActionButton(false);
        addAIChatMessage('system', 'Plan approved â€” executing...');
        this.sendMessage('Approved. Execute the plan now.');
    },

    continueStep() {
        document.querySelectorAll('.ai-plan-approval').forEach(el => el.remove());
        this._setPlanActionButton(false);
        addAIChatMessage('system', 'Continuing...');
        this.sendMessage('Yes, continue.');
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  MESSAGE RECOVERY
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    checkPendingMessage() {
        var pending = sessionStorage.getItem('forge:ai-pending-msg');
        if (!pending) return;
        sessionStorage.removeItem('forge:ai-pending-msg');
        var container = document.getElementById('ai-chat-messages');
        if (!container) return;
        var self = this;
        var div = document.createElement('div');
        div.className = 'ai-msg system';
        var preview = pending.length > 100 ? pending.slice(0, 100) + '...' : pending;
        div.innerHTML =
            '<div style="margin-bottom:6px">Previous message was interrupted: "' + (typeof escHtml === 'function' ? escHtml(preview) : preview) + '"</div>' +
            '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-sm btn-primary" data-action="resend">Resend</button>' +
            '<button class="btn btn-sm" data-action="dismiss">Dismiss</button>' +
            '</div>';
        div.querySelector('[data-action="resend"]').addEventListener('click', function () {
            div.innerHTML = '<span style="color:var(--text-dim);font-size:11px">Resending...</span>';
            self.sendMessage(pending);
        });
        div.querySelector('[data-action="dismiss"]').addEventListener('click', function () {
            div.remove();
        });
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  CHAT HISTORY PERSISTENCE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    _persistChatHistory() {
        try {
            var toSave = aiChatHistory.slice(-50);
            localStorage.setItem('forge:ai-chat-history', JSON.stringify(toSave));
            // Also auto-save to active conversation
            if (this._activeConvId && aiChatHistory.length > 0) {
                this._saveConversation(this._activeConvId, this._autoTitle(aiChatHistory), aiChatHistory);
            }
        } catch (e) { /* localStorage full or disabled â€” silently ignore */ }
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
        } catch (e) { /* corrupt data â€” ignore */ }
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  TOOL ARGUMENT VALIDATION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
            if (args[req] === undefined || args[req] === null || args[req] === '') {
                return 'Missing required argument "' + req + '" for tool ' + name + '.';
            }
        }
        // Coerce types where possible
        var paramKeys = Object.keys(def.params);
        for (var k = 0; k < paramKeys.length; k++) {
            var key = paramKeys[k];
            if (args[key] === undefined) continue;
            if (def.params[key].type === 'string' && typeof args[key] !== 'string') {
                args[key] = String(args[key]);
            }
        }
        return null; // valid
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  ABORT
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    abort() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        this._setPlanActionButton(false);
        this._autoApproveRemaining = false;
        // Clean up streaming div if active
        if (this._streamingDiv) {
            this._streamingDiv.classList.remove('streaming');
            this._streamingDiv = null;
        }
        this._pendingRedirect = null;
        this._setButtonState(false);
        this._updateStepCounter(0, 0, 0);
        this._setActivity('idle', 'Idle');
        addAIChatMessage('system', 'Stopped. Context preserved â€” send a message to continue or redirect.');
        // Focus input for quick redirect
        var input = document.getElementById('ai-chat-input');
        if (input) {
            input.focus();
            input.placeholder = 'Redirect Athena or continue...';
        }
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  CLEAR CHAT
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    clearChat() {
        aiChatHistory = [];
        this._workingMessages = [];
        this._readFiles.clear();
        this._sessionCheckpointed = false;
        this._lastToolCall = null;
        this._loopCount = 0;
        this._setPlanActionButton(false);
        this._autoApproveRemaining = false;
        localStorage.removeItem('forge:ai-chat-history');
        const container = document.getElementById('ai-chat-messages');
        if (container) container.innerHTML = '';
        addAIChatMessage('system', 'Chat cleared. Starting fresh.');
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  CHAT HISTORY â€” Multi-conversation management
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
            // Cap at max conversations â€” remove oldest
            while (list.length > this._MAX_CONVERSATIONS) {
                var old = list.pop();
                if (old) localStorage.removeItem('forge:ai-conv-' + old.id);
            }
            localStorage.setItem('forge:ai-conversations', JSON.stringify(list));
        } catch (e) { /* localStorage full â€” ignore */ }
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
            this._readFiles.clear();
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
                addAIChatMessage('system', '(Loaded conversation â€” ' + renderedCount + ' messages shown, ' + hiddenCount + ' tool transcript messages hidden)');
            } else {
                addAIChatMessage('system', '(Loaded conversation â€” ' + renderedCount + ' messages)');
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

    _timeAgo(ts) {
        if (!ts) return '';
        var diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
        return new Date(ts).toLocaleDateString();
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  MAIN SEND MESSAGE â€” The agentic loop
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    async sendMessage(userMsg) {
        const profile = this.getActiveProfile();
        const apiKey = this.getActiveApiKey();

        if (!profile || !profile.endpoint || !apiKey) {
            addAIChatMessage('system', 'Set up a provider and API key first. Click the gear icon or expand Configuration above.');
            return;
        }
        const modelId = this.getEffectiveModel();
        if (!this._isValidModelId(modelId)) {
            addAIChatMessage('system', 'Invalid model ID. Use only letters, numbers, ., _, :, /, @, and -.');
            return;
        }
        if (this._busy) {
            // Queue as redirect â€” will be injected at next tool boundary
            this._pendingRedirect = userMsg;
            addAIChatMessage('user', userMsg);
            addAIChatMessage('system', 'Redirect queued â€” will take effect after current step.');
            this._setActivity('working', 'Redirect pending...');
            return;
        }
        this._setActivity('working', 'Thinking...');
        this._setPlanActionButton(false);

        // Consume any pending attachment
        const attachment = this._consumeAttachment();

        // Display user message (with attachment indicator)
        if (attachment && attachment.type === 'image') {
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
        aiChatHistory.push({ role: 'user', content: userMsg + (attachment ? ' [attached: ' + attachment.name + ']' : '') });
        // Save pending message for recovery on network failure
        sessionStorage.setItem('forge:ai-pending-msg', userMsg);
        this._autoApproveRemaining = false;
        this._sessionCheckpointed = false;
        this._lastToolCall = null;
        this._loopCount = 0;
        this._setButtonState(true);
        this._abortController = new AbortController();
        this._apiFormat = null; // re-detect

        const fmt = this._detectFormat();
        const useStreaming = true; // All providers support streaming
        const apiUrl = this._getApiUrl(useStreaming);

        // Reuse full-fidelity working messages across turns for continuous conversation.
        // Only rebuild from scratch if there's no prior working state.
        const systemPrompt = this._buildSystemPrompt();
        let messages;
        if (this._workingMessages && this._workingMessages.length > 1) {
            // Update system prompt (always first message) and append new user message
            messages = this._workingMessages;
            messages[0] = { role: 'system', content: systemPrompt };
            messages.push(userApiMsg);
        } else {
            // First turn or after clearChat â€” build from display history
            messages = [
                { role: 'system', content: systemPrompt },
                ...aiChatHistory
            ];
            // If this is the first message and has an attachment, replace the last entry
            if (attachment && messages.length > 0) {
                messages[messages.length - 1] = userApiMsg;
            }
        }

        const startTime = Date.now();

        let totalSteps = 0;
        let stepLimit = this.MAX_ITERATIONS;
        let deadlineMs = startTime + this.MAX_TIME_MS;
        try {
            for (let i = 0; i < stepLimit; i++) {
                totalSteps = i + 1;
                const curTokens = this._estimateTokens(messages);
                this._updateStepCounter(totalSteps, stepLimit, curTokens);
                if (this._abortController?.signal.aborted) break;

                if (Date.now() > deadlineMs) {
                    const cont = await this._askContinue(totalSteps, curTokens);
                    if (!cont) break;
                    deadlineMs = Date.now() + this.MAX_TIME_MS; // reset deadline
                    stepLimit = i + 1 + this.MAX_ITERATIONS;    // extend step limit
                }

                // Context compaction if needed
                const tokens = curTokens;
                if (tokens > this._getTokenBudget()) {
                    const before = messages.length;
                    const compacted = this._compactMessages(messages);
                    messages.length = 0;
                    messages.push(...compacted);
                    addAIChatMessage('system', 'Context compacted (' + before + ' â†’ ' + messages.length + ' messages, ~' + Math.round(this._estimateTokens(messages) / 1000) + 'k tokens).');
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
                        data = await res.json();
                    } finally {
                        this._hideThinking(thinkingEl);
                    }
                    parsed = this._parseResponse(data);
                    if (parsed.text) addAIChatMessage('assistant', parsed.text);
                }

                // Add assistant message to working conversation
                messages.push(this._buildAssistantMessage(parsed));

                // No tool calls â†’ done
                if (parsed.toolCalls.length === 0) {
                    aiChatHistory.push({ role: 'assistant', content: parsed.text || '' });
                    break;
                }

                // Loop detection: same tool+args twice in a row
                const callSig = JSON.stringify(parsed.toolCalls.map(tc => [tc.name, tc.args]));
                if (callSig === this._lastToolCall) {
                    this._loopCount++;
                    if (this._loopCount >= 2) {
                        addAIChatMessage('system', 'Detected repeated tool calls. Breaking loop.');
                        aiChatHistory.push({ role: 'assistant', content: parsed.text || '(loop detected)' });
                        break;
                    }
                } else {
                    this._loopCount = 0;
                }
                this._lastToolCall = callSig;

                // Execute tool calls with validation
                const results = [];
                for (const tc of parsed.toolCalls) {
                    if (this._abortController?.signal.aborted) break;
                    const toolDiv = this._showToolCall(tc.name, tc.args);
                    const validationError = this._validateToolArgs(tc.name, tc.args);
                    var result;
                    if (validationError) {
                        result = 'Validation error: ' + validationError;
                    } else {
                        this._setActivity('working', 'Running ' + tc.name + '...');
                        result = await this._executeTool(tc.name, tc.args);
                    }
                    this._showToolResult(toolDiv, result);
                    results.push(result);
                }

                if (this._abortController?.signal.aborted) break;

                // Push tool results
                const toolMsgs = this._buildToolResultMessages(parsed.toolCalls, results);
                messages.push(...toolMsgs);

                // Persist to display history (summarized)
                aiChatHistory.push({ role: 'assistant', content: parsed.text || '(used tools: ' + parsed.toolCalls.map(tc => tc.name).join(', ') + ')' });
                aiChatHistory.push({
                    role: 'user',
                    content: parsed.toolCalls.map((tc, j) => '[Tool ' + tc.name + ']: ' + (results[j] || '').slice(0, 300)).join('\n'),
                    _hiddenFromChat: true
                });

                // Check for user redirect â€” inject course correction
                if (this._pendingRedirect) {
                    const redirect = this._pendingRedirect;
                    this._pendingRedirect = null;
                    messages.push({ role: 'user', content: '[USER REDIRECT]: ' + redirect + '\n\nIMPORTANT: The user wants to change direction. Stop what you were doing and follow this new instruction instead. Acknowledge the redirect briefly, then proceed with the new request.' });
                    aiChatHistory.push({ role: 'user', content: redirect });
                    addAIChatMessage('system', 'Redirect injected â€” Athena is changing course.');
                    this._setActivity('working', 'Redirecting...');
                    continue; // skip step limit check, go straight to next API call
                }

                // If about to hit step limit, ask to continue
                if (i + 1 >= stepLimit && !this._abortController?.signal.aborted) {
                    const curTokens = this._estimateTokens(messages);
                    const cont = await this._askContinue(totalSteps, curTokens);
                    if (cont) {
                        stepLimit = i + 1 + this.MAX_ITERATIONS;
                        deadlineMs = Date.now() + this.MAX_TIME_MS;
                    }
                    // if !cont, loop ends naturally
                }
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                this._setActivity('error', 'Error: ' + e.message);
                addAIChatMessage('system', 'Error: ' + e.message);
            }
        } finally {
            // Preserve full-fidelity messages for continuous conversation
            this._workingMessages = messages;
            this._autoApproveRemaining = false;
            this._setButtonState(false);
            this._abortController = null;
            this._setActivity('idle', 'Idle');
            this._updateStepCounter(0, 0, 0); // hide counter + tokens
            sessionStorage.removeItem('forge:ai-pending-msg');
            this._persistChatHistory();
        }
    }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  GLOBAL FUNCTIONS â€” Chat display, send, config
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function addAIChatMessage(role, content, attachment) {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    if (role === 'assistant') {
        var approvalPatterns = [
            'ready to execute this plan',
            'ready to execute this step',
            'shall i proceed',
            'should i continue',
            'ready to proceed',
            'does this plan look good',
            'want me to go ahead'
        ];
        var text = String(content || '');
        var needsApproval = approvalPatterns.some(function (p) {
            return text.toLowerCase().includes(p.toLowerCase());
        });

        // If this is a plan/step gate, strip the trailing plain-language prompt
        // and render a dedicated CTA button instead.
        var cleanedText = text;
        if (needsApproval) {
            approvalPatterns.forEach(function (p) {
                var esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cleanedText = cleanedText.replace(new RegExp('\\*\\*\\s*' + esc + '\\s*\\*\\*', 'ig'), '');
                cleanedText = cleanedText.replace(new RegExp(esc, 'ig'), '');
            });
            cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();
        }

        div.innerHTML = aiAgent._renderMarkdown(cleanedText || text);

        if (needsApproval) {
            var isPlan = /plan/i.test(text);
            var planDiv = document.createElement('div');
            planDiv.className = 'ai-plan-approval';

            var planLabel = document.createElement('div');
            planLabel.className = 'ai-plan-approval-title';
            planLabel.textContent = isPlan ? 'Plan ready for approval' : 'Step ready for approval';
            planDiv.appendChild(planLabel);

            var approveBtn = document.createElement('button');
            approveBtn.className = 'btn btn-sm btn-success ai-plan-primary';
            approveBtn.innerHTML = isPlan
                ? '<span class="codicon codicon-play"></span> Execute Plan'
                : '<span class="codicon codicon-chevron-right"></span> Continue Step';
            approveBtn.addEventListener('click', function () {
                if (isPlan) aiAgent.approvePlan();
                else aiAgent.continueStep();
            });
            planDiv.appendChild(approveBtn);

            var reviseBtn = document.createElement('button');
            reviseBtn.className = 'btn btn-sm';
            reviseBtn.textContent = isPlan ? 'Revise Plan' : 'Pause / Revise';
            reviseBtn.addEventListener('click', function () { aiAgent.revisePlan(); });
            planDiv.appendChild(reviseBtn);

            div.appendChild(planDiv);
            aiAgent._setPlanActionButton(true, isPlan);
            aiAgent._setActivity('waiting', isPlan ? 'Waiting for plan approval...' : 'Waiting to continue...');
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
        div.textContent = '[system] ' + content;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function sendAIMessage() {
    const input = document.getElementById('ai-chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    input.style.height = 'auto';
    aiAgent.sendMessage(msg);
}

function openAIAttachPicker() {
    var input = document.getElementById('ai-attach-input');
    if (input) input.click();
}

function bindManagedAiListener(el, type, key, handler, options) {
    if (!el || !type || !handler) return;
    const listenerKey = key || type;
    const store = el.__forgeManagedListeners || (el.__forgeManagedListeners = {});
    if (store[listenerKey]) {
        el.removeEventListener(type, store[listenerKey]);
    }
    store[listenerKey] = handler;
    el.addEventListener(type, handler, options);
}

function initAIComposer() {
    const input = document.getElementById('ai-chat-input');
    if (!input || input.dataset.aiComposerBound === '1') return;
    input.dataset.aiComposerBound = '1';
    const resize = function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    };
    bindManagedAiListener(input, 'input', 'ai-compose-resize', resize);
    resize();
}

function saveAgentConfig() { aiAgent.saveProfile(); }
function clearAgentConfig() { aiAgent.deleteProfile(); }
function openAIPendingDiff() { aiAgent.openPendingDiff(); }
function acceptAllAIPendingFromIDE() { aiAgent.acceptAllPending(); }
function approveAIPendingFromIDE() { aiAgent._resolvePendingApproval(true, 'ide'); }
function rejectAIPendingFromIDE() { aiAgent._resolvePendingApproval(false, 'ide'); }

// Expose on window so CSP bindings can resolve onclick="aiAgent.X()"
window.aiAgent = aiAgent;
initAIComposer();

// Paste handler for image attachments
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('ai-chat-input');
    if (chatInput) {
        chatInput.addEventListener('paste', (e) => aiAgent.handlePaste(e));
    }
});

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
});

// UI Helper Functions for Athena Panel
window.toggleAthenaConfig = function() {
    const panel = document.getElementById('ai-config-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    // Highlight config button when panel is open
    const btn = document.getElementById('athena-config-toggle');
    if (btn) btn.classList.toggle('active', panel.classList.contains('open'));
};

window.autoResizeAthenaInput = function(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
};


