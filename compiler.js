const compiler = {
    campfireShareUrl: 'https://flankspeed.sharepoint-mil.us.mcas-gov.us/sites/Prometheus/SitePages/campfire.aspx',
    firepitComponentId: '4b2ad7ba-a39b-49e8-90e3-10e08433578b',
    modernPageApplicationId: 'b6917cb1-93a0-4b97-a84d-7cf49975d4ec',
    sharePointDeployBusy: false,
    shippedAppsFolderName: 'Shipped Apps',
    shippedAppsMetadataFileName: 'ship-metadata.json',
    livePreviewLastUrl: '',
    livePreviewRefreshing: false,

    initLivePreviewUi() {
        const auto = document.getElementById('compiler-live-preview-auto');
        if (auto) {
            try {
                auto.checked = localStorage.getItem('forge:live-preview:auto') === '1';
            } catch (_) { }
        }
    },

    setLivePreviewStatus(message, tone = 'info') {
        const el = document.getElementById('compiler-live-preview-status');
        if (!el) return;
        el.className = `small text-${tone} mb-1`;
        el.textContent = String(message || '');
    },

    setLivePreviewUrl(url) {
        const el = document.getElementById('compiler-live-preview-url');
        if (!el) return;
        el.textContent = url ? String(url) : '';
    },

    getLivePreviewEntryFile() {
        if (loadFolder && typeof loadFolder._findPreferredAutoOpenFile === 'function') {
            const preferred = loadFolder._findPreferredAutoOpenFile();
            if (preferred && preferred.kind === 'file' && /\.html?$/i.test(String(preferred.name || ''))) {
                return preferred;
            }
        }
        return (loadFolder?.fileStructure || []).find(file =>
            file &&
            file.kind === 'file' &&
            /\.html?$/i.test(String(file.relativePath || file.name || ''))
        ) || null;
    },

    async refreshLivePreview(options = {}) {
        const opts = {
            skipSave: false,
            quiet: false,
            switchToCompiler: false,
            ...options
        };
        if (this.livePreviewRefreshing) return false;
        if (!loadFolder?.fileHandle) {
            this.setLivePreviewStatus('Load an app folder first.', 'warning');
            this.setLivePreviewUrl('');
            return false;
        }
        this.livePreviewRefreshing = true;
        try {
            if (opts.switchToCompiler) {
                const compilerTab = document.querySelector('#compiler-tab');
                if (compilerTab && window.bootstrap?.Tab) {
                    bootstrap.Tab.getOrCreateInstance(compilerTab).show();
                }
            }
            if (!opts.skipSave && window.editor && typeof editor.saveAll === 'function') {
                this.setLivePreviewStatus('Saving files before preview...', 'info');
                await editor.saveAll();
            }
            this.setLivePreviewStatus('Building runtime preview...', 'info');
            const artifact = await this.startCompilation({
                skipDownload: true,
                saveToShippedApps: false,
                skipHashLog: true,
                livePreview: true,
                shipTarget: document.querySelector('#sharepoint-compat-mode')?.checked ? 'sharepoint' : 'offline',
                shipReleaseType: this.getSelectedCompilerReleaseType ? this.getSelectedCompilerReleaseType() : 'feature'
            });
            if (!artifact || !artifact.finalHtml) {
                throw new Error('Preview build did not produce HTML.');
            }
            const frame = document.getElementById('compiler-live-preview-frame');
            if (!frame) throw new Error('Preview iframe is missing.');
            const entry = this.getLivePreviewEntryFile();
            this.livePreviewLastUrl = '';
            this.setLivePreviewUrl('Runtime preview uses Forge virtual localStorage/sessionStorage.');
            frame.removeAttribute('src');
            frame.setAttribute('srcdoc', artifact.finalHtml);
            if (!opts.quiet) {
                this.setLivePreviewStatus(`Previewing ${entry?.relativePath || entry?.name || artifact.outName} with virtual browser storage.`, 'success');
            }
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || 'Preview failed.');
            this.setLivePreviewStatus(message, 'danger');
            this.setLivePreviewUrl(this.livePreviewLastUrl || '');
            if (!opts.quiet) console.warn('Live preview failed:', error);
            return false;
        } finally {
            this.livePreviewRefreshing = false;
        }
    },

    // Patterns known to cause issues with strict CSP security headers
    // Each entry has: pattern (regex), name (human readable), reason, and remediation
    problematicPatterns: [
        {
            pattern: /cdn\.tailwindcss\.com/i,
            name: 'Tailwind CSS CDN (JIT)',
            reason: 'Tailwind\'s CDN uses a JavaScript-based JIT compiler that dynamically generates CSS in the browser. This requires script execution capabilities that are blocked by strict CSP security headers.',
            remediation: `To fix this, replace the Tailwind JIT script with a pre-built CSS file:

1. **Use a pre-built Tailwind CSS CDN (recommended):**
   In your index.html, find this line:
   <script src="https://cdn.tailwindcss.com"></script>

   Replace it with:
   <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">

   Note: This includes all Tailwind utilities (~3MB). You won't have JIT features, but all standard classes will work.

2. **Or disable security headers:**
   Uncheck "Add security headers" in Compiler settings before compiling.
   Your app will work, but won't have offline network protection.

3. **For custom Tailwind builds:**
   Use an online tool like https://play.tailwindcss.com to generate only the CSS you need, then save it as a local .css file in your project.`
        },
        {
            pattern: /unpkg\.com\/@tailwindcss\/browser/i,
            name: 'Tailwind Browser Build',
            reason: 'The Tailwind browser build dynamically compiles CSS in the browser, which requires script capabilities blocked by strict CSP.',
            remediation: `Replace the browser build with a pre-built CSS file:

In your index.html, replace the Tailwind browser script with:
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">

Or uncheck "Add security headers" if you need the dynamic features.`
        },
        {
            pattern: /<script[^>]*>[^<]*(?:eval|new\s+Function|document\.write)/i,
            name: 'Dynamic Code Execution',
            reason: 'This script uses eval(), new Function(), or document.write() which are blocked by strict CSP to prevent code injection attacks.',
            remediation: `Your code contains dynamic script execution that won't work with security headers.

Options:
1. **Ask your AI assistant to refactor:** Copy the relevant code and ask "Please refactor this to avoid using eval/new Function/document.write"

2. **Disable security headers:** Uncheck "Add security headers" if you trust this code and need it to work as-is.

Note: Dynamic code execution is often used by libraries. If this is from a third-party library, check if there's a "CSP-safe" or "strict" version available.`
        },
        {
            pattern: /cdn\.skypack\.dev|esm\.sh|jspm\.dev/i,
            name: 'ES Module CDN',
            reason: 'ES Module CDNs dynamically load JavaScript modules over the network, which conflicts with CSP connect-src restrictions.',
            remediation: `These CDNs load code dynamically and won't work with security headers.

Options:
1. **Find a regular CDN version:** Many libraries have traditional script versions on cdnjs.cloudflare.com or jsdelivr.net. Search for "[library name] cdn" and use a direct script tag instead.

2. **Download the library:** Visit the CDN URL in your browser, copy the JavaScript content, save it as a .js file in your project, then reference that local file.

3. **Disable security headers:** Uncheck "Add security headers" if dynamic loading is required.`
        },
        {
            // Match fetch() calls to external URLs (not local paths)
            pattern: /fetch\s*\(\s*['"`]https?:\/\//i,
            name: 'External API Fetch Request',
            reason: 'Your code uses fetch() to call an external API (https://...). With security headers enabled, network calls are blocked by default unless the destination is explicitly added to the connect-src allowlist.',
            remediation: `Your app tries to fetch data from an external server. This won't work in strict offline mode and will be blocked unless allowlisted in security headers.

Options:
1. **Pre-fetch the data:** If the API data is static or predictable, fetch it once, save it as a JSON file in your project, and import that instead.

2. **Create a data input feature:** Let users upload/paste the data they need (CSV, JSON file upload, or text paste area).

3. **Use the LLM JSON Pipeline pattern:** Add a "Generate Prompt" button that wraps app data in an AI prompt. Users paste into a chatbot, get JSON back, and paste it into your app.

4. **Allowlist specific API domains:** Keep security headers on and either enable "Allow Ask Sage API" and/or "Allow GenAI.mil API", or add approved API origins in the compiler's "Additional API allowlist (connect-src)" field.

5. **Disable security headers:** Uncheck "Add security headers" if you need unrestricted network access (least secure).`
        },
        {
            // Match XMLHttpRequest to external URLs
            pattern: /new\s+XMLHttpRequest[\s\S]{0,200}\.open\s*\(\s*['"`]\w+['"`]\s*,\s*['"`]https?:\/\//i,
            name: 'External XMLHttpRequest',
            reason: 'Your code uses XMLHttpRequest to connect to an external server. This is blocked by default unless the destination is in the connect-src allowlist.',
            remediation: `Same as fetch() - XMLHttpRequest calls to external URLs require explicit allowlisting when security headers are enabled.

Options:
1. **Pre-download the data** as a local JSON file
2. **Let users upload/paste data** instead of fetching it
3. **Allowlist specific API domains** in compiler settings while keeping security headers enabled (or use the Ask Sage/GenAI.mil checkboxes)
4. **Disable security headers** if unrestricted network access is required`
        },
        {
            pattern: /new\s+WebSocket\s*\(/i,
            name: 'WebSocket Connection',
            reason: 'Your code opens a WebSocket connection. This requires network access and will be blocked unless the destination is explicitly allowlisted in connect-src.',
            remediation: `WebSockets are for real-time server communication and won't work offline.

For offline apps:
1. **Remove WebSocket code** if the feature isn't essential
2. **Use polling with local storage** for pseudo-real-time updates between tabs
3. **Allowlist specific WebSocket/API domains** in compiler settings
4. **Disable security headers** if you need unrestricted live server connections`
        },
        {
            pattern: /new\s+EventSource\s*\(/i,
            name: 'Server-Sent Events (SSE)',
            reason: 'Your code uses Server-Sent Events (EventSource) which requires a persistent server connection. This will be blocked unless the destination is allowlisted in connect-src.',
            remediation: `SSE requires a server and won't work offline.

Options:
1. **Remove SSE code** if not essential for offline use
2. **Allowlist the SSE endpoint origin** in compiler settings (or use the Ask Sage/GenAI.mil checkboxes)
3. **Disable security headers** if you need unrestricted server push notifications`
        },
        {
            pattern: /navigator\s*\.\s*sendBeacon\s*\(/i,
            name: 'Navigator sendBeacon',
            reason: 'Your code uses navigator.sendBeacon() to send analytics or telemetry data. This makes network requests that are blocked by default unless allowlisted in connect-src.',
            remediation: `sendBeacon is typically used for analytics. For offline apps:

1. **Remove analytics code** - it can't work without network anyway
2. **Log to console only** for debugging purposes
3. **Allowlist telemetry endpoint origins** in compiler settings (or use the Ask Sage/GenAI.mil checkboxes)
4. **Disable security headers** if unrestricted telemetry is required`
        },
        {
            // Match APIs that typically require network
            pattern: /navigator\s*\.\s*(geolocation|bluetooth|usb|serial|hid)\./i,
            name: 'Hardware/Location API',
            reason: 'Your code uses hardware or location APIs. While these may work locally, some features may be restricted by the Permissions-Policy header.',
            remediation: `Hardware APIs (geolocation, bluetooth, USB, serial) are disabled by the Permissions-Policy header.

If you need these features:
1. **Disable security headers** to allow hardware access
2. Note: Geolocation may still work from cached position on some browsers

These APIs are blocked to prevent unexpected hardware access in offline/secure environments.`
        }
    ],

    // Check for problematic patterns and return findings
    checkForCspIssues(htmlContent) {
        const issues = [];
        for (const entry of this.problematicPatterns) {
            if (entry.pattern.test(htmlContent)) {
                issues.push({
                    name: entry.name,
                    reason: entry.reason,
                    remediation: entry.remediation
                });
            }
        }
        return issues;
    },

    checkForSharePointDynamicInlineHandlerIssues(entryHtmlContent, jsFiles = []) {
        const sources = [];
        const entryHtml = String(entryHtmlContent || '');
        let inlineScriptIndex = 0;
        entryHtml.replace(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (_match, code) => {
            inlineScriptIndex += 1;
            sources.push({
                label: `Entry HTML inline script #${inlineScriptIndex}`,
                content: String(code || '')
            });
            return _match;
        });
        for (const file of (Array.isArray(jsFiles) ? jsFiles : [])) {
            sources.push({
                label: String(file?.relativePath || file?.name || 'JavaScript file'),
                content: String(file?.content || '')
            });
        }

        const htmlInsertionPattern = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|srcdoc\b|template\s*\.\s*innerHTML|DOMParser\s*\(\)\s*\.parseFromString)\b/i;
        const inlineHandlerAttrPattern = /\bon[a-z][a-z0-9:_-]*\s*=/i;
        const inlineHandlerHtmlPattern = /<[^>\n\r]{0,400}\bon[a-z][a-z0-9:_-]*\s*=/i;
        const findings = [];

        const buildSnippet = (text, matchIndex) => {
            const source = String(text || '').replace(/\s+/g, ' ').trim();
            if (!source) return '';
            const safeIndex = Number.isInteger(matchIndex) && matchIndex >= 0 ? matchIndex : 0;
            const start = Math.max(0, safeIndex - 70);
            const end = Math.min(source.length, safeIndex + 150);
            const snippet = source.slice(start, end).trim();
            return snippet.length < source.length ? `...${snippet}...` : snippet;
        };

        for (const source of sources) {
            const text = String(source?.content || '');
            if (!text.trim()) continue;
            const inlineAttrMatch = inlineHandlerHtmlPattern.exec(text) || inlineHandlerAttrPattern.exec(text);
            if (!inlineAttrMatch) continue;
            const insertionMatch = htmlInsertionPattern.exec(text);
            if (!insertionMatch && !inlineHandlerHtmlPattern.test(text)) continue;
            const focusIndex = Math.min(
                inlineAttrMatch.index ?? Number.MAX_SAFE_INTEGER,
                insertionMatch?.index ?? Number.MAX_SAFE_INTEGER
            );
            findings.push({
                label: source.label,
                snippet: buildSnippet(text, Number.isFinite(focusIndex) ? focusIndex : (inlineAttrMatch.index || 0))
            });
        }

        if (!findings.length) return [];

        const evidenceLines = findings.slice(0, 4).map((item) => `- ${item.label}: ${item.snippet}`);
        if (findings.length > 4) {
            evidenceLines.push(`- ...and ${findings.length - 4} more matching source block(s).`);
        }

        return [{
            category: 'sharepoint-inline-handler',
            name: 'Dynamic HTML may reintroduce inline event handlers in SharePoint mode',
            reason: 'SharePoint mode rewrites inline handlers that already exist in the compiled HTML, but JavaScript-generated markup can still inject new onclick/oninput/onchange-style attributes at runtime.',
            remediation: [
                'Refactor any render path that builds HTML strings with inline event attributes.',
                'Generate plain markup without onclick/oninput/onchange/etc, then bind behavior with addEventListener after insertion.',
                '',
                'Likely sources:',
                ...evidenceLines
            ].join('\n'),
            evidence: evidenceLines.join('\n')
        }];
    },

    getCompatibilityWarningPresentation(issues) {
        const safeIssues = Array.isArray(issues) ? issues : [];
        const hasSharePointInlineHandlerIssue = safeIssues.some((issue) => issue?.category === 'sharepoint-inline-handler');
        const hasOtherIssue = safeIssues.some((issue) => issue?.category !== 'sharepoint-inline-handler');
        if (hasSharePointInlineHandlerIssue && hasOtherIssue) {
            return {
                title: 'Compilation Compatibility Warning',
                intro: 'The following patterns may break with the selected compiler settings, including SharePoint compatibility mode:'
            };
        }
        if (hasSharePointInlineHandlerIssue) {
            return {
                title: 'SharePoint Compatibility Warning',
                intro: 'The following patterns may break when compiling for SharePoint compatibility mode:'
            };
        }
        return {
            title: 'Security Headers Compatibility Warning',
            intro: 'The following resources in your project may not work correctly when security headers are enabled:'
        };
    },

    buildAiRemediationPrompt(issues) {
        const safeIssues = Array.isArray(issues) ? issues : [];
        const hasSharePointInlineHandlerIssue = safeIssues.some((issue) => issue?.category === 'sharepoint-inline-handler');
        const header = hasSharePointInlineHandlerIssue
            ? [
                'Remediate this app so it compiles and runs in Forge SharePoint compatibility mode.',
                'Remove inline HTML event handler attributes from any JavaScript-generated markup and replace them with addEventListener-based wiring.',
                'Provide concrete code changes and replacement snippets.'
            ].join('\n')
            : [
                'Remediate this app to compile and run with security headers enabled in Forge (Forge).',
                'Do not suggest disabling security headers.',
                'Provide concrete code changes and replacement snippets.'
            ].join('\n');

        const details = safeIssues.map((issue, idx) => {
            const title = `${idx + 1}. ${issue?.name || 'Issue'}`;
            const reason = `Why it breaks:\n${issue?.reason || 'No reason provided.'}`;
            const remediation = `Current remediation guidance:\n${issue?.remediation || 'No remediation provided.'}`;
            const evidence = issue?.evidence ? `Signals detected:\n${issue.evidence}` : '';
            return [title, reason, evidence, remediation].filter(Boolean).join('\n');
        }).join('\n\n');

        const deliverables = [
            'Return output in this format:',
            '1. Prioritized fix plan',
            '2. Updated complete files (do not just give snippets, divs, or leave out code.',
            '3. Validation checklist to confirm behavior after compile'
        ].join('\n');

        return `${header}\n\nDetected compatibility findings:\n${details}\n\n${deliverables}\n`;
    },

    // Show warning modal and return user's choice
    async showCspWarning(issues) {
        return new Promise((resolve) => {
            const presentation = this.getCompatibilityWarningPresentation(issues);
            // Create modal HTML
            const modalHtml = `
                <div class="modal fade" id="cspWarningModal" tabindex="-1" role="dialog" data-bs-backdrop="static">
                    <div class="modal-dialog modal-lg" role="document">
                        <div class="modal-content bg-dark text-light">
                            <div class="modal-header border-warning">
                                <h5 class="modal-title text-warning">⚠️ ${this.escapeHtml(presentation.title)}</h5>
                                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body">
                                <p>${this.escapeHtml(presentation.intro)}</p>
                                ${issues.map((issue, idx) => `
                                    <div class="alert alert-warning mb-3">
                                        <h6 class="alert-heading mb-1"><strong>${idx + 1}. ${issue.name}</strong></h6>
                                        <p class="mb-2 small">${issue.reason}</p>
                                        <details>
                                            <summary class="text-info" style="cursor:pointer;">Show remediation steps</summary>
                                            <pre class="mt-2 p-2 bg-dark text-light small" style="white-space:pre-wrap; border:1px solid #495057; border-radius:4px;">${issue.remediation}</pre>
                                        </details>
                                    </div>
                                `).join('')}
                                <p class="mt-3 mb-0"><strong>What would you like to do?</strong></p>
                            </div>
                            <div class="modal-footer border-secondary d-flex flex-wrap gap-2">
                                <button type="button" class="btn btn-secondary csp-warn-cancel">Cancel Compilation</button>
                                <button type="button" class="btn btn-info csp-warn-copy">Copy Remediation Prompt for AI</button>
                                <button type="button" class="btn btn-danger csp-warn-continue">Compile Anyway (may break)</button>
                                <span class="small text-info ms-auto csp-warn-copy-status"></span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Remove any existing modal
            const existingModal = document.getElementById('cspWarningModal');
            if (existingModal) existingModal.remove();

            // Add modal to page
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modalEl = document.getElementById('cspWarningModal');

            if (!modalEl) {
                console.error('Failed to create CSP warning modal');
                resolve({ action: 'cancel' });
                return;
            }

            const modal = new bootstrap.Modal(modalEl);

            // Handle button clicks using class selectors within the modal
            const cancelBtn = modalEl.querySelector('.csp-warn-cancel');
            const copyBtn = modalEl.querySelector('.csp-warn-copy');
            const continueBtn = modalEl.querySelector('.csp-warn-continue');
            const copyStatusEl = modalEl.querySelector('.csp-warn-copy-status');
            const remediationPrompt = this.buildAiRemediationPrompt(issues);

            const copyTextToClipboard = async (text) => {
                if (!text) return false;
                try {
                    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                        await navigator.clipboard.writeText(text);
                        return true;
                    }
                } catch { }
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
                    ta.remove();
                    return !!ok;
                } catch {
                    return false;
                }
            };

            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    modal.hide();
                    resolve({ action: 'cancel' });
                });
            }
            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    if (copyStatusEl) copyStatusEl.textContent = 'Copying...';
                    const copied = await copyTextToClipboard(remediationPrompt);
                    if (copyStatusEl) {
                        copyStatusEl.textContent = copied
                            ? 'Remediation prompt copied.'
                            : 'Copy failed. Try manual copy from warnings panel.';
                    }
                });
            }
            if (continueBtn) {
                continueBtn.addEventListener('click', () => {
                    modal.hide();
                    resolve({ action: 'continue' });
                });
            }

            // Handle modal close via X button
            modalEl.addEventListener('hidden.bs.modal', () => {
                resolve({ action: 'cancel' });
                modalEl.remove();
            }, { once: true });

            modal.show();
        });
    },

    showCompilerTab() {
        const compilerTab = document.querySelector('#compiler-tab');
        if (!compilerTab || !window.bootstrap || !bootstrap.Tab) return;
        bootstrap.Tab.getOrCreateInstance(compilerTab).show();
    },

    getSelectedShipReleaseType(preferredValue) {
        const selected = document.querySelector('input[name="ship-release-type"]:checked');
        const rawValue = preferredValue != null ? preferredValue : selected?.value;
        const value = String(rawValue || '').trim().toLowerCase();
        if (value === 'major' || value === 'bugfix') return value;
        return 'feature';
    },

    getSelectedCompilerReleaseType(preferredValue) {
        const selected = document.querySelector('input[name="compiler-release-type"]:checked');
        const rawValue = preferredValue != null ? preferredValue : selected?.value;
        const value = String(rawValue || '').trim().toLowerCase();
        if (value === 'major' || value === 'bugfix') return value;
        return 'feature';
    },

    getShipReleaseTypeLabel(releaseType) {
        switch (String(releaseType || '').trim().toLowerCase()) {
            case 'major':
                return 'Major update';
            case 'bugfix':
                return 'Bug fix';
            default:
                return 'Minor feature add';
        }
    },

    parseShipVersion(version) {
        const match = String(version || '').trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
        if (!match) return null;
        return {
            major: Number(match[1]),
            minor: Number(match[2]),
            patch: match[3] == null ? null : Number(match[3])
        };
    },

    formatShipVersion(version) {
        if (!version || !Number.isFinite(version.major) || !Number.isFinite(version.minor)) {
            return '1.0';
        }
        const major = Math.max(0, Math.trunc(version.major));
        const minor = Math.max(0, Math.trunc(version.minor));
        const patch = Number.isFinite(version.patch) ? Math.max(0, Math.trunc(version.patch)) : null;
        return patch != null ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
    },

    getInitialShipVersion() {
        return { major: 1, minor: 0, patch: null };
    },

    compareShipVersions(left, right) {
        const a = this.parseShipVersion(typeof left === 'string' ? left : this.formatShipVersion(left));
        const b = this.parseShipVersion(typeof right === 'string' ? right : this.formatShipVersion(right));
        if (!a && !b) return 0;
        if (!a) return -1;
        if (!b) return 1;
        if (a.major !== b.major) return a.major - b.major;
        if (a.minor !== b.minor) return a.minor - b.minor;
        return (a.patch ?? 0) - (b.patch ?? 0);
    },

    bumpShipVersion(previousVersion, releaseType) {
        const normalizedType = String(releaseType || '').trim().toLowerCase();
        const parsed = typeof previousVersion === 'string'
            ? this.parseShipVersion(previousVersion)
            : (previousVersion || null);
        if (!parsed) {
            return this.getInitialShipVersion();
        }

        if (normalizedType === 'major') {
            return {
                major: parsed.major + 1,
                minor: 0,
                patch: null
            };
        }
        if (normalizedType === 'bugfix') {
            return {
                major: parsed.major,
                minor: parsed.minor,
                patch: (parsed.patch ?? 0) + 1
            };
        }
        return {
            major: parsed.major,
            minor: parsed.minor + 1,
            patch: null
        };
    },

    extractShipVersionFromFilename(fileName) {
        const match = String(fileName || '').match(/\sv(\d+\.\d+(?:\.\d+)?)\.(?:html?|aspx)$/i);
        return match ? match[1] : null;
    },

    buildVersionedOutputName(fileName, version) {
        const rawName = String(fileName || 'compiled-app.html').trim() || 'compiled-app.html';
        const extMatch = rawName.match(/(\.(?:html?|aspx))$/i);
        const ext = extMatch ? extMatch[1] : '.html';
        let base = extMatch ? rawName.slice(0, extMatch.index) : rawName;
        base = base
            .replace(/\sv\d+\.\d+(?:\.\d+)?$/i, '')
            .replace(/-current$/i, '')
            .trim();
        if (!base) base = 'compiled-app';
        return `${base} v${String(version || '').trim()}${ext}`;
    },

    buildCurrentOutputName(fileName) {
        const rawName = String(fileName || 'compiled-app.html').trim() || 'compiled-app.html';
        const extMatch = rawName.match(/(\.(?:html?|aspx))$/i);
        const ext = extMatch ? extMatch[1] : '.html';
        let base = extMatch ? rawName.slice(0, extMatch.index) : rawName;
        base = base
            .replace(/\sv\d+\.\d+(?:\.\d+)?$/i, '')
            .replace(/-current$/i, '')
            .trim();
        if (!base) base = 'compiled-app';
        return `${base}-current${ext}`;
    },

    normalizeShipTarget(shipTarget) {
        const raw = String(shipTarget || 'offline').trim().toLowerCase();
        if (raw === 'sharepoint' || raw === 'firepit-sharepoint') return 'sharepoint';
        if (raw === 'legacy-sharepoint' || raw === 'sharepoint-legacy' || raw === 'intelshare') return 'legacy-sharepoint';
        if (raw === 'fusion-wiki-fullscreen' || raw === 'fusion-fullscreen' || raw === 'confluence-fullscreen' || raw === 'confluence-wiki-fullscreen') return 'fusion-wiki-fullscreen';
        if (raw === 'fusion' || raw === 'fusion-wiki' || raw === 'confluence' || raw === 'confluence-wiki') return 'fusion-wiki';
        return 'offline';
    },

    isSharePointShipTarget(shipTarget) {
        const normalized = this.normalizeShipTarget(shipTarget);
        return normalized === 'sharepoint' || normalized === 'legacy-sharepoint';
    },

    getShipTargetLabel(shipTarget) {
        const normalized = this.normalizeShipTarget(shipTarget);
        if (normalized === 'sharepoint') return 'SharePoint Firepit';
        if (normalized === 'legacy-sharepoint') return 'Legacy SharePoint';
        if (normalized === 'fusion-wiki-fullscreen') return 'Fusion Wiki Fullscreen';
        if (normalized === 'fusion-wiki') return 'Fusion Wiki';
        return 'Offline';
    },

    async copyTextToClipboard(text) {
        const value = String(text || '');
        if (!value) return false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch (_) { }
        try {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            const copied = document.execCommand('copy');
            textarea.remove();
            return !!copied;
        } catch (_) {
            return false;
        }
    },

    getLatestReleaseForTarget(releases, shipTarget) {
        const normalizedTarget = this.normalizeShipTarget(shipTarget);
        const safeReleases = Array.isArray(releases) ? releases : [];
        let latest = null;
        for (const release of safeReleases) {
            if (!release || this.normalizeShipTarget(release.shipTarget) !== normalizedTarget) continue;
            if (!this.parseShipVersion(release.version)) continue;
            if (!latest || this.compareShipVersions(release.version, latest.version) > 0) {
                latest = release;
            }
        }
        return latest;
    },

    async copyFileWithinDirectory(dirHandle, sourceName, targetName) {
        const sourceHandle = await dirHandle.getFileHandle(sourceName, { create: false });
        const sourceFile = await sourceHandle.getFile();
        const targetHandle = await dirHandle.getFileHandle(targetName, { create: true });
        const writable = await targetHandle.createWritable();
        await writable.write(sourceFile);
        await writable.close();
        return targetHandle;
    },

    async archiveExistingCurrentArtifactForTarget(dirHandle, outName, metadata, shipTarget) {
        const normalizedTarget = this.normalizeShipTarget(shipTarget);
        const latestRelease = this.getLatestReleaseForTarget(metadata?.releases, normalizedTarget);
        if (!latestRelease || !this.parseShipVersion(latestRelease.version)) {
            return {
                releases: Array.isArray(metadata?.releases) ? metadata.releases.slice() : []
            };
        }

        const currentName = this.buildCurrentOutputName(outName);
        const archivedName = this.buildVersionedOutputName(outName, latestRelease.version);
        const releases = Array.isArray(metadata?.releases) ? metadata.releases.map((release) => ({ ...release })) : [];
        let archivedCurrent = false;

        let currentExists = true;
        try {
            await dirHandle.getFileHandle(currentName, { create: false });
        } catch (error) {
            const name = String(error?.name || '');
            const msg = String(error?.message || '');
            const isMissing = name === 'NotFoundError' || /cannot find/i.test(msg);
            if (!isMissing) throw error;
            currentExists = false;
        }

        if (currentExists) {
            try {
                await dirHandle.getFileHandle(archivedName, { create: false });
                throw new Error(`Could not archive the previous ${this.getShipTargetLabel(normalizedTarget)} current build because "${archivedName}" already exists in ${this.shippedAppsFolderName}.`);
            } catch (error) {
                const name = String(error?.name || '');
                const msg = String(error?.message || '');
                const isMissing = name === 'NotFoundError' || /cannot find/i.test(msg);
                if (!isMissing) throw error;
            }

            await this.copyFileWithinDirectory(dirHandle, currentName, archivedName);
            await dirHandle.removeEntry(currentName);
            archivedCurrent = true;
        }

        if (archivedCurrent) {
            for (let i = releases.length - 1; i >= 0; i -= 1) {
                const release = releases[i];
                if (!release || this.normalizeShipTarget(release.shipTarget) !== normalizedTarget) continue;
                if (String(release.version || '').trim() !== String(latestRelease.version || '').trim()) continue;
                release.filename = archivedName;
                break;
            }
        }

        return { releases };
    },

    async getShippedAppsDirectory(create = false) {
        if (!loadFolder.fileHandle) {
            throw new Error('Please load a directory first.');
        }
        return await loadFolder.fileHandle.getDirectoryHandle(this.shippedAppsFolderName, { create: !!create });
    },

    async findLatestShipVersionInFolder(dirHandle) {
        if (!dirHandle) return null;
        let latest = null;
        for await (const entry of dirHandle.values()) {
            if (!entry || entry.kind !== 'file') continue;
            if (entry.name === this.shippedAppsMetadataFileName) continue;
            const candidate = this.extractShipVersionFromFilename(entry.name);
            if (!candidate) continue;
            if (!latest || this.compareShipVersions(candidate, latest) > 0) {
                latest = candidate;
            }
        }
        return latest;
    },

    async readShippedAppsMetadata() {
        let dirHandle = null;
        try {
            dirHandle = await this.getShippedAppsDirectory(false);
        } catch (_) {
            return {
                currentVersion: null,
                releases: [],
                dirHandle: null
            };
        }

        let parsed = null;
        try {
            const metadataHandle = await dirHandle.getFileHandle(this.shippedAppsMetadataFileName, { create: false });
            const raw = await (await metadataHandle.getFile()).text();
            parsed = JSON.parse(raw);
        } catch (_) { }

        const releases = Array.isArray(parsed?.releases)
            ? parsed.releases.filter((release) => release && typeof release.version === 'string')
            : [];
        let currentVersion = typeof parsed?.currentVersion === 'string' ? parsed.currentVersion.trim() : '';
        if (!this.parseShipVersion(currentVersion) && releases.length) {
            currentVersion = releases
                .map((release) => String(release.version || '').trim())
                .filter((version) => this.parseShipVersion(version))
                .sort((left, right) => this.compareShipVersions(left, right))
                .pop() || '';
        }
        if (!this.parseShipVersion(currentVersion)) {
            currentVersion = await this.findLatestShipVersionInFolder(dirHandle) || '';
        }
        return {
            currentVersion: currentVersion || null,
            releases,
            dirHandle
        };
    },

    async getNextShipVersionInfo(releaseType) {
        const metadata = await this.readShippedAppsMetadata();
        const previousVersion = metadata.currentVersion;
        const nextVersion = this.formatShipVersion(this.bumpShipVersion(previousVersion, releaseType));
        return {
            previousVersion,
            nextVersion,
            releaseType: this.getSelectedShipReleaseType(releaseType),
            metadata
        };
    },

    async refreshShipVersionPreview() {
        const previewEl = document.getElementById('ship-version-preview');
        if (!previewEl) return;
        if (!loadFolder.fileHandle) {
            previewEl.textContent = 'Load an app folder first to create a shipped version.';
            return;
        }
        const releaseType = this.getSelectedShipReleaseType();
        previewEl.textContent = 'Next shipped version: calculating...';
        try {
            const versionInfo = await this.getNextShipVersionInfo(releaseType);
            const prefix = versionInfo.previousVersion
                ? `Current shipped version: ${versionInfo.previousVersion}. `
                : 'No shipped versions yet. ';
            previewEl.textContent = `${prefix}Next ${this.getShipReleaseTypeLabel(releaseType).toLowerCase()}: ${versionInfo.nextVersion}`;
        } catch (error) {
            previewEl.textContent = `Could not calculate shipped version: ${error instanceof Error ? error.message : String(error || 'unknown error')}`;
        }
    },

    async refreshCompilerShipVersionPreview() {
        const previewEl = document.getElementById('compiler-ship-version-preview');
        if (!previewEl) return;
        const saveToShippedApps = !!document.getElementById('compiler-save-to-shipped-apps')?.checked;
        if (!saveToShippedApps) {
            previewEl.textContent = 'Compile will download the HTML file only because Shipped Apps saving is unchecked.';
            return;
        }
        if (!loadFolder.fileHandle) {
            previewEl.textContent = 'Load an app folder first to create a shipped version.';
            return;
        }
        const releaseType = this.getSelectedCompilerReleaseType();
        previewEl.textContent = 'Next shipped version: calculating...';
        try {
            const versionInfo = await this.getNextShipVersionInfo(releaseType);
            const prefix = versionInfo.previousVersion
                ? `Current shipped version: ${versionInfo.previousVersion}. `
                : 'No shipped versions yet. ';
            previewEl.textContent = `${prefix}Next ${this.getShipReleaseTypeLabel(releaseType).toLowerCase()}: ${versionInfo.nextVersion}`;
        } catch (error) {
            previewEl.textContent = `Could not calculate shipped version: ${error instanceof Error ? error.message : String(error || 'unknown error')}`;
        }
    },

    async saveCompiledArtifactToShippedApps({
        finalHtml,
        outName,
        hashHex,
        releaseType,
        shipTarget,
        copyToClipboard = false,
        shipSavedModalTitle = '',
        clipboardSuccessMessage = '',
        clipboardFailureMessage = '',
        deploymentInstructionsHtml = ''
    }) {
        const normalizedReleaseType = this.getSelectedShipReleaseType(releaseType);
        const normalizedShipTarget = this.normalizeShipTarget(shipTarget);
        const versionInfo = await this.getNextShipVersionInfo(normalizedReleaseType);
        const dirHandle = versionInfo.metadata.dirHandle || await this.getShippedAppsDirectory(true);
        const isSharePointTarget = this.isSharePointShipTarget(normalizedShipTarget);
        const outputName = isSharePointTarget
            ? this.buildCurrentOutputName(outName)
            : this.buildVersionedOutputName(outName, versionInfo.nextVersion);
        const archivedMetadata = isSharePointTarget
            ? await this.archiveExistingCurrentArtifactForTarget(dirHandle, outName, versionInfo.metadata, normalizedShipTarget)
            : { releases: Array.isArray(versionInfo.metadata.releases) ? versionInfo.metadata.releases.slice() : [] };

        try {
            await dirHandle.getFileHandle(outputName, { create: false });
            throw new Error(`A shipped file named "${outputName}" already exists in ${this.shippedAppsFolderName}.`);
        } catch (error) {
            const name = String(error?.name || '');
            const msg = String(error?.message || '');
            const isMissing = name === 'NotFoundError' || /cannot find/i.test(msg);
            if (!isMissing) throw error;
        }

        const fileHandle = await dirHandle.getFileHandle(outputName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(finalHtml);
        await writable.close();

        const shippedAt = new Date().toISOString();
        const metadata = {
            schemaVersion: 1,
            currentVersion: versionInfo.nextVersion,
            releases: [
                ...(Array.isArray(archivedMetadata.releases) ? archivedMetadata.releases : []),
                {
                    version: versionInfo.nextVersion,
                    releaseType: normalizedReleaseType,
                    releaseTypeLabel: this.getShipReleaseTypeLabel(normalizedReleaseType),
                    filename: outputName,
                    hash: hashHex,
                    shipTarget: normalizedShipTarget,
                    shippedAt
                }
            ]
        };
        const metadataHandle = await dirHandle.getFileHandle(this.shippedAppsMetadataFileName, { create: true });
        const metadataWritable = await metadataHandle.createWritable();
        await metadataWritable.write(JSON.stringify(metadata, null, 2));
        await metadataWritable.close();

        const clipboardCopied = copyToClipboard
            ? await this.copyTextToClipboard(finalHtml)
            : false;

        this.showShipSavedModal({
            outName: outputName,
            version: versionInfo.nextVersion,
            releaseType: normalizedReleaseType,
            shipTarget: normalizedShipTarget,
            title: shipSavedModalTitle,
            clipboardCopied,
            clipboardRequested: copyToClipboard,
            clipboardSuccessMessage,
            clipboardFailureMessage,
            deploymentInstructionsHtml
        });

        return {
            outName: outputName,
            version: versionInfo.nextVersion,
            shippedAt,
            clipboardCopied
        };
    },

    showShipSavedModal({
        outName,
        version,
        releaseType,
        shipTarget,
        title,
        clipboardCopied = false,
        clipboardRequested = false,
        clipboardSuccessMessage = '',
        clipboardFailureMessage = '',
        deploymentInstructionsHtml = ''
    }) {
        const modalEl = document.getElementById('ship-saved-modal');
        if (!modalEl || !window.bootstrap || !bootstrap.Modal) return;
        const rootName = String(loadFolder?.fileHandle?.name || '').trim() || 'your loaded app folder';
        const titleEl = document.getElementById('ship-saved-modal-label');
        const pathEl = document.getElementById('ship-saved-modal-path');
        const fileEl = document.getElementById('ship-saved-modal-file');
        const clipboardEl = document.getElementById('ship-saved-modal-clipboard');
        const instructionsEl = document.getElementById('ship-saved-modal-instructions');
        const detailsEl = document.getElementById('ship-saved-modal-details');
        const targetLabel = this.getShipTargetLabel(shipTarget);
        if (titleEl) {
            titleEl.textContent = String(title || '').trim() || 'Shipped App Saved';
        }
        if (pathEl) {
            pathEl.innerHTML = `Open your <code>${this.escapeHtml(rootName)}</code> folder, then open <code>${this.escapeHtml(this.shippedAppsFolderName)}</code>.`;
        }
        if (fileEl) {
            fileEl.innerHTML = `Saved file: <code>${this.escapeHtml(outName)}</code>`;
        }
        if (clipboardEl) {
            if (clipboardRequested) {
                const message = clipboardCopied
                    ? (clipboardSuccessMessage || 'The shipped code has been copied to your clipboard.')
                    : (clipboardFailureMessage || 'The shipped file was saved, but Forge could not copy it to your clipboard.');
                const statusClass = clipboardCopied ? 'alert-success' : 'alert-warning';
                clipboardEl.innerHTML = `<div class="alert ${statusClass} py-2 mb-3">${this.escapeHtml(message)}</div>`;
            } else {
                clipboardEl.innerHTML = '';
            }
        }
        if (instructionsEl) {
            instructionsEl.innerHTML = String(deploymentInstructionsHtml || '').trim();
        }
        if (detailsEl) {
            detailsEl.innerHTML = `Version <code>${this.escapeHtml(version)}</code> · ${this.escapeHtml(this.getShipReleaseTypeLabel(releaseType))} · ${this.escapeHtml(targetLabel)} target.<br>Forge does not show <code>${this.escapeHtml(this.shippedAppsFolderName)}</code> in the editor tree, so use your normal file browser to open that folder.`;
        }
        if (detailsEl) {
            detailsEl.innerHTML = `Version <code>${this.escapeHtml(version)}</code> | ${this.escapeHtml(this.getShipReleaseTypeLabel(releaseType))} | ${this.escapeHtml(targetLabel)} target.<br>Forge does not show <code>${this.escapeHtml(this.shippedAppsFolderName)}</code> in the editor tree, so use your normal file browser to open that folder.`;
        }
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    },

    randomGuid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
            const r = Math.random() * 16 | 0;
            const v = ch === 'x' ? r : ((r & 0x3) | 0x8);
            return v.toString(16);
        });
    },

    slugify(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\.(html?|aspx)$/i, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'app';
    },

    getRawSharePointPageContext() {
        const candidates = [];
        try {
            if (window._spPageContextInfo && typeof window._spPageContextInfo === 'object') {
                candidates.push(window._spPageContextInfo);
            }
        } catch (_) { }
        try {
            if (window.parent && window.parent !== window && window.parent._spPageContextInfo && typeof window.parent._spPageContextInfo === 'object') {
                candidates.push(window.parent._spPageContextInfo);
            }
        } catch (_) { }
        for (const candidate of candidates) {
            const webAbsoluteUrl = String(candidate?.webAbsoluteUrl || candidate?.siteAbsoluteUrl || '').trim();
            if (/^https?:\/\//i.test(webAbsoluteUrl)) {
                return candidate;
            }
        }
        return null;
    },

    isSharePointHosted() {
        return !!this.getRawSharePointPageContext();
    },

    canUseSharePointDeploy() {
        const context = this.getSharePointContext();
        if (!context) return false;
        if (!window.location || window.location.protocol === 'file:' || window.location.origin === 'null') {
            return false;
        }
        try {
            return new URL(context.webAbsoluteUrl).origin === window.location.origin;
        } catch {
            return false;
        }
    },

    getSharePointContext() {
        if (!this.isSharePointHosted()) return null;
        const info = this.getRawSharePointPageContext() || {};
        const fallbackAbsoluteUrl = String(info.webAbsoluteUrl || info.siteAbsoluteUrl || `${window.location.origin}`).replace(/\/+$/, '');
        let webServerRelativeUrl = String(info.webServerRelativeUrl || '').trim();
        if (!webServerRelativeUrl) {
            try {
                const parsed = new URL(fallbackAbsoluteUrl);
                webServerRelativeUrl = parsed.pathname || '/';
            } catch {
                webServerRelativeUrl = '/';
            }
        }
        webServerRelativeUrl = this.normalizeServerRelativePath(webServerRelativeUrl);
        const siteAbsoluteUrl = String(info.siteAbsoluteUrl || fallbackAbsoluteUrl).replace(/\/+$/, '');
        const siteServerRelativeUrl = (() => {
            const raw = String(info.siteServerRelativeUrl || '').trim();
            if (raw) return this.normalizeServerRelativePath(raw);
            try {
                const parsed = new URL(siteAbsoluteUrl);
                return this.normalizeServerRelativePath(parsed.pathname || '/');
            } catch {
                return webServerRelativeUrl;
            }
        })();
        return {
            webAbsoluteUrl: fallbackAbsoluteUrl,
            siteAbsoluteUrl,
            webServerRelativeUrl,
            siteServerRelativeUrl,
            sitePagesServerRelativeUrl: this.joinServerRelativePath(webServerRelativeUrl, 'SitePages')
        };
    },

    normalizeServerRelativePath(value) {
        let path = String(value || '').trim();
        if (!path) return '/';
        if (/^https?:\/\//i.test(path)) {
            try {
                path = new URL(path).pathname || '/';
            } catch {
                path = '/';
            }
        }
        path = path.replace(/\\/g, '/');
        path = path.replace(/[?#].*$/, '');
        path = path.replace(/\/+/g, '/');
        if (!path.startsWith('/')) path = `/${path}`;
        if (path.length > 1) path = path.replace(/\/+$/, '');
        return path || '/';
    },

    joinServerRelativePath(...parts) {
        const tokens = [];
        for (const part of parts) {
            const raw = String(part || '').trim();
            if (!raw) continue;
            const normalized = raw.replace(/\\/g, '/').split('/').filter(Boolean);
            tokens.push(...normalized);
        }
        return `/${tokens.join('/')}`.replace(/\/+/g, '/');
    },

    resolveSharePointAbsoluteUrl(context, value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        const bases = [
            context?.webAbsoluteUrl,
            context?.siteAbsoluteUrl,
            window?._spPageContextInfo?.webAbsoluteUrl,
            window?._spPageContextInfo?.siteAbsoluteUrl,
            window?.location?.href
        ].map(item => String(item || '').trim())
            .filter(item => /^https?:\/\//i.test(item));
        for (const base of bases) {
            try {
                return new URL(raw, base).toString();
            } catch (_) {
                // try next candidate
            }
        }
        throw new Error(`Could not resolve SharePoint URL for "${raw}" because no absolute SharePoint base URL was available.`);
    },

    encodeODataPathArg(value) {
        return encodeURIComponent(String(value || '').replace(/'/g, "''")).replace(/%2F/g, '/');
    },

    unwrapOData(payload) {
        if (payload && typeof payload === 'object' && payload.d) return payload.d;
        return payload;
    },

    extractSharePointError(payload, fallbackMessage) {
        const unwrapped = this.unwrapOData(payload);
        const message = unwrapped?.error?.message?.value
            || unwrapped?.error?.message
            || unwrapped?.odata?.error?.message?.value
            || unwrapped?.odata?.error?.message
            || fallbackMessage;
        return String(message || fallbackMessage || 'SharePoint request failed.');
    },

    async sharePointFetch(url, options = {}) {
        const {
            expectJson = true,
            fallbackError = 'SharePoint request failed.'
        } = options;
        const response = await fetch(url, {
            credentials: 'same-origin',
            ...options
        });
        let text = '';
        try {
            text = await response.text();
        } catch (_) {
            text = '';
        }
        let payload = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch {
                payload = text;
            }
        }
        if (!response.ok) {
            throw new Error(this.extractSharePointError(payload, `${fallbackError} (${response.status})`));
        }
        if (!expectJson) {
            return payload;
        }
        return this.unwrapOData(payload);
    },

    async getSharePointRequestDigest(webAbsoluteUrl) {
        const payload = await this.sharePointFetch(`${webAbsoluteUrl}/_api/contextinfo`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json;odata=verbose'
            },
            fallbackError: 'Unable to get SharePoint request digest.'
        });
        const digest = payload?.GetContextWebInformation?.FormDigestValue;
        if (!digest) {
            throw new Error('SharePoint did not return a request digest.');
        }
        return digest;
    },

    setSharePointDeployStatus(message, tone = 'secondary', extraHtml = '') {
        const targets = [
            document.getElementById('sharepoint-deploy-status'),
            document.getElementById('sharepoint-deploy-quick-status')
        ];
        for (const target of targets) {
            if (!target) continue;
            target.className = `small text-${tone}`;
            target.innerHTML = `${this.escapeHtml(message || '')}${extraHtml || ''}`;
        }
    },

    setSharePointDeployBusy(isBusy) {
        this.sharePointDeployBusy = !!isBusy;
        const buttons = [
            document.getElementById('deployToSharePointButton'),
            document.getElementById('deploy-sharepoint-btn')
        ];
        for (const button of buttons) {
            if (!button) continue;
            button.disabled = !!isBusy;
            const idleLabel = button.getAttribute('data-idle-label') || button.textContent || 'Deploy';
            if (!button.getAttribute('data-idle-label')) {
                button.setAttribute('data-idle-label', idleLabel);
            }
            button.textContent = isBusy ? 'Deploying...' : idleLabel;
        }
    },

    syncSharePointDeployUi() {
        const isSharePoint = this.canUseSharePointDeploy();
        const deployPanel = document.getElementById('sharepoint-deploy-panel');
        const deployQuickButton = document.getElementById('deploy-sharepoint-btn');
        const deployQuickStatus = document.getElementById('sharepoint-deploy-quick-status');
        if (deployPanel) deployPanel.classList.toggle('d-none', !isSharePoint);
        if (deployQuickButton) deployQuickButton.classList.toggle('d-none', !isSharePoint);
        if (deployQuickStatus) deployQuickStatus.classList.toggle('d-none', !isSharePoint);

        const sharePointSiteInput = document.getElementById('sharepoint-site-url');
        const deployFolderInput = document.getElementById('sharepoint-deploy-folder');
        const deployPageInput = document.getElementById('sharepoint-deploy-page-name');
        const context = isSharePoint ? this.getSharePointContext() : null;
        const legacyRadio = document.getElementById('sharepoint-deploy-mode-legacy');
        const firepitRadio = document.getElementById('sharepoint-deploy-mode-firepit');
        if (context && this.isLegacyIntelShareContext(context) && legacyRadio && !legacyRadio.dataset.autoSelected) {
            legacyRadio.checked = true;
            legacyRadio.dataset.autoSelected = '1';
        } else if (firepitRadio && !legacyRadio?.checked) {
            firepitRadio.checked = true;
        }
        if (context && sharePointSiteInput) {
            sharePointSiteInput.value = context.webAbsoluteUrl;
        }
        if (context && deployFolderInput && !String(deployFolderInput.value || '').trim()) {
            deployFolderInput.value = this.joinServerRelativePath(context.webServerRelativeUrl, 'SiteAssets', 'firepit-apps');
        }
        if (deployPageInput && !String(deployPageInput.value || '').trim()) {
            const compileName = document.getElementById('compile-filename');
            const fallbackName = (compileName && typeof compileName.value === 'string' && compileName.value.trim())
                ? compileName.value.trim()
                : String(loadFolder?.fileHandle?.name || 'app');
            deployPageInput.value = this.slugify(fallbackName);
        }

        if (isSharePoint) {
            this.refreshSharePointDeployModeUi();
        }
    },

    isLegacyIntelShareContext(context) {
        try {
            const host = new URL(context?.webAbsoluteUrl || window.location.href).hostname.toLowerCase();
            return host === 'intelshare.intelink.sgov.gov' || host === 'intelshare.intelink.gov';
        } catch (_) {
            return false;
        }
    },

    getSharePointDeployMode() {
        const selected = document.querySelector('input[name="sharepoint-deploy-mode"]:checked');
        const mode = String(selected?.value || '').trim().toLowerCase();
        return mode === 'legacy' ? 'legacy' : 'firepit';
    },

    refreshSharePointDeployModeUi() {
        const mode = this.getSharePointDeployMode();
        const folderGroup = document.getElementById('sharepoint-deploy-folder-group');
        const deployButton = document.getElementById('deployToSharePointButton');
        const quickButton = document.getElementById('deploy-sharepoint-btn');
        if (folderGroup) folderGroup.style.display = mode === 'legacy' ? 'none' : '';
        if (deployButton) {
            deployButton.textContent = mode === 'legacy' ? 'Deploy Legacy .aspx' : 'Deploy to SharePoint';
            deployButton.setAttribute('data-idle-label', deployButton.textContent);
        }
        if (quickButton) quickButton.title = mode === 'legacy'
            ? 'Compile and upload this app directly to SitePages as an .aspx page'
            : 'Compile, upload to this SharePoint site, and create a Firepit page';
        const status = mode === 'legacy'
            ? 'Legacy SharePoint mode selected. Deploy uploads the compiled app directly to SitePages as an .aspx file; Firepit is not used.'
            : 'SharePoint host detected. Deploy uploads the compiled HTML and provisions a Firepit page.';
        this.setSharePointDeployStatus(status, 'info');
    },

    getSharePointDeployConfig(compiledFileName) {
        const context = this.canUseSharePointDeploy() ? this.getSharePointContext() : null;
        if (!context) {
            throw new Error('SharePoint deployment is only available when this app is hosted same-origin in SharePoint.');
        }
        const folderInput = document.getElementById('sharepoint-deploy-folder');
        const pageInput = document.getElementById('sharepoint-deploy-page-name');
        const publishInput = document.getElementById('sharepoint-deploy-publish');
        const pageSlugRaw = String(pageInput?.value || '').trim() || this.slugify(compiledFileName);
        const pageSlug = this.slugify(pageSlugRaw);
        const pageTitle = pageSlug
            .split('-')
            .filter(Boolean)
            .map(token => token.charAt(0).toUpperCase() + token.slice(1))
            .join(' ') || 'Firepit App';
        const folderRaw = String(folderInput?.value || '').trim() || this.joinServerRelativePath(context.webServerRelativeUrl, 'SiteAssets', 'firepit-apps');
        const deployFolderServerRelativeUrl = this.normalizeServerRelativePath(
            folderRaw.startsWith('/')
                ? folderRaw
                : this.joinServerRelativePath(context.webServerRelativeUrl, folderRaw)
        );
        const deployMode = this.getSharePointDeployMode();
        return {
            context,
            deployMode,
            deployFolderServerRelativeUrl,
            pageSlug,
            pageTitle,
            pageFileName: `${pageSlug}.aspx`,
            publishPage: !!publishInput?.checked
        };
    },

    buildFirepitCanvasContent(fileUrl) {
        const controlId = this.randomGuid();
        const instanceId = this.randomGuid();
        const safeFileUrl = String(fileUrl || '');
        return JSON.stringify([
            {
                controlType: 3,
                id: controlId,
                position: {
                    zoneIndex: 1,
                    sectionIndex: 1,
                    sectionFactor: 12,
                    controlIndex: 1,
                    layoutIndex: 1
                },
                webPartId: this.firepitComponentId,
                addedFromPersistedData: true,
                reservedHeight: 1200,
                reservedWidth: 1920,
                webPartData: {
                    id: this.firepitComponentId,
                    instanceId,
                    title: 'Firepit',
                    description: 'Firepit: HTML Application Host',
                    dataVersion: '1.0',
                    properties: {
                        htmlFileUrl: safeFileUrl,
                        htmlCode: '',
                        fullScreen: true,
                        iframeHeight: '100vh',
                        sandboxMode: 'permissive',
                        lockDown: false
                    },
                    serverProcessedContent: {
                        htmlStrings: {},
                        searchablePlainTexts: {
                            htmlFileUrl: safeFileUrl
                        },
                        imageSources: {},
                        links: {}
                    }
                }
            }
        ]);
    },

    async ensureSharePointFolder(context, digest, serverRelativeUrl) {
        const normalizedTarget = this.normalizeServerRelativePath(serverRelativeUrl);
        const webRoot = this.normalizeServerRelativePath(context.webServerRelativeUrl);
        const rootTokens = webRoot === '/' ? [] : webRoot.split('/').filter(Boolean);
        const targetTokens = normalizedTarget.split('/').filter(Boolean);
        if (rootTokens.length && targetTokens.slice(0, rootTokens.length).join('/') !== rootTokens.join('/')) {
            throw new Error('Deploy folder must stay inside the current SharePoint web.');
        }
        let current = webRoot === '/' ? '/' : webRoot;
        for (let i = rootTokens.length; i < targetTokens.length; i++) {
            current = this.joinServerRelativePath(current, targetTokens[i]);
            const folderArg = this.encodeODataPathArg(current);
            try {
                await this.sharePointFetch(
                    `${context.webAbsoluteUrl}/_api/web/folders/add('${folderArg}')`,
                    {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json;odata=verbose',
                            'X-RequestDigest': digest
                        },
                        fallbackError: `Unable to create folder ${current}.`
                    }
                );
            } catch (error) {
                if (!/exist|already/i.test(String(error && error.message || ''))) {
                    throw error;
                }
            }
        }
        return normalizedTarget;
    },

    async uploadHtmlToSharePoint(context, digest, folderServerRelativeUrl, fileName, htmlText) {
        const folderArg = this.encodeODataPathArg(folderServerRelativeUrl);
        const fileArg = encodeURIComponent(String(fileName || '').replace(/'/g, "''"));
        const endpoint = `${context.webAbsoluteUrl}/_api/web/GetFolderByServerRelativeUrl('${folderArg}')/Files/add(url='${fileArg}',overwrite=true)`;
        const payload = await this.sharePointFetch(endpoint, {
            method: 'POST',
            headers: {
                'Accept': 'application/json;odata=verbose',
                'X-RequestDigest': digest,
                'Content-Type': 'text/html;charset=utf-8'
            },
            body: htmlText,
            fallbackError: `Unable to upload ${fileName} to SharePoint.`
        });
        const serverRelativeUrl = payload?.ServerRelativeUrl || payload?.serverRelativeUrl || this.joinServerRelativePath(folderServerRelativeUrl, fileName);
        return {
            serverRelativeUrl: this.normalizeServerRelativePath(serverRelativeUrl),
            absoluteUrl: this.resolveSharePointAbsoluteUrl(context, serverRelativeUrl)
        };
    },

    async createSharePointPageFile(context, digest, pageServerRelativeUrl) {
        const sitePagesArg = this.encodeODataPathArg(context.sitePagesServerRelativeUrl);
        const pageArg = this.encodeODataPathArg(pageServerRelativeUrl);
        return this.sharePointFetch(
            `${context.webAbsoluteUrl}/_api/web/GetFolderByServerRelativeUrl('${sitePagesArg}')/Files/AddTemplateFile(urlOfFile='${pageArg}',templateFileType=3)`,
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'X-RequestDigest': digest
                },
                fallbackError: `Unable to create page ${pageServerRelativeUrl}.`
            }
        );
    },

    async updateSharePointPageFields(context, digest, pageServerRelativeUrl, formValues) {
        const pageArg = this.encodeODataPathArg(pageServerRelativeUrl);
        const response = await this.sharePointFetch(
            `${context.webAbsoluteUrl}/_api/web/GetFileByServerRelativeUrl('${pageArg}')/ListItemAllFields/ValidateUpdateListItem()`,
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose',
                    'X-RequestDigest': digest
                },
                body: JSON.stringify({
                    formValues,
                    bNewDocumentUpdate: true
                }),
                fallbackError: `Unable to configure page ${pageServerRelativeUrl}.`
            }
        );
        const values = Array.isArray(response?.value) ? response.value : (Array.isArray(response) ? response : []);
        const failures = values.filter(item => item && (item.HasException || item.ErrorMessage));
        if (failures.length) {
            throw new Error(failures.map(item => `${item.FieldName}: ${item.ErrorMessage || 'Unknown error'}`).join('; '));
        }
        return values;
    },

    async tryPublishSharePointPage(context, digest, pageServerRelativeUrl) {
        const pageArg = this.encodeODataPathArg(pageServerRelativeUrl);
        const baseUrl = `${context.webAbsoluteUrl}/_api/web/GetFileByServerRelativeUrl('${pageArg}')`;
        try {
            await this.sharePointFetch(`${baseUrl}/CheckIn(comment='Published%20by%20Warfighter%20Coder%20Tool',checkintype=0)`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'X-RequestDigest': digest
                },
                fallbackError: 'Unable to check in SharePoint page.'
            });
        } catch (_) {
            // Check-in is not always required.
        }
        await this.sharePointFetch(`${baseUrl}/Publish(comment='Published%20by%20Warfighter%20Coder%20Tool')`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json;odata=verbose',
                'X-RequestDigest': digest
            },
            fallbackError: 'Unable to publish SharePoint page.'
        });
    },

    async provisionSharePointFirepitPage(artifact) {
        const deployConfig = this.getSharePointDeployConfig(artifact?.outName);
        const {
            context,
            deployFolderServerRelativeUrl,
            pageSlug,
            pageTitle,
            pageFileName,
            publishPage
        } = deployConfig;
        const digest = await this.getSharePointRequestDigest(context.webAbsoluteUrl);
        const pageServerRelativeUrl = this.joinServerRelativePath(context.sitePagesServerRelativeUrl, pageFileName);
        const canvasContent1 = this.buildFirepitCanvasContent(this.joinServerRelativePath(deployFolderServerRelativeUrl, artifact.outName));

        this.setSharePointDeployStatus('Creating SharePoint folder...', 'info');
        await this.ensureSharePointFolder(context, digest, deployFolderServerRelativeUrl);

        this.setSharePointDeployStatus('Uploading compiled HTML to SharePoint...', 'info');
        const uploadedFile = await this.uploadHtmlToSharePoint(
            context,
            digest,
            deployFolderServerRelativeUrl,
            artifact.outName,
            artifact.finalHtml
        );

        this.setSharePointDeployStatus('Creating modern page...', 'info');
        await this.createSharePointPageFile(context, digest, pageServerRelativeUrl);

        const appPageFields = [
            { FieldName: 'Title', FieldValue: pageTitle },
            { FieldName: 'ClientSideApplicationId', FieldValue: this.firepitComponentId },
            { FieldName: 'PageLayoutType', FieldValue: 'SingleWebPartAppPage' },
            { FieldName: 'CanvasContent1', FieldValue: canvasContent1 },
            { FieldName: 'LayoutWebpartsContent', FieldValue: '[]' }
        ];
        const articleFields = [
            { FieldName: 'Title', FieldValue: pageTitle },
            { FieldName: 'ClientSideApplicationId', FieldValue: this.modernPageApplicationId },
            { FieldName: 'PageLayoutType', FieldValue: 'Article' },
            { FieldName: 'CanvasContent1', FieldValue: canvasContent1 },
            { FieldName: 'LayoutWebpartsContent', FieldValue: '[]' }
        ];

        let usedFallback = false;
        try {
            this.setSharePointDeployStatus('Configuring Firepit app page...', 'info');
            await this.updateSharePointPageFields(context, digest, pageServerRelativeUrl, appPageFields);
        } catch (_) {
            usedFallback = true;
            this.setSharePointDeployStatus('App-page layout was rejected. Falling back to a single-webpart article page...', 'warning');
            await this.updateSharePointPageFields(context, digest, pageServerRelativeUrl, articleFields);
        }

        let publishError = null;
        if (publishPage) {
            try {
                this.setSharePointDeployStatus('Publishing SharePoint page...', 'info');
                await this.tryPublishSharePointPage(context, digest, pageServerRelativeUrl);
            } catch (error) {
                publishError = error instanceof Error ? error.message : String(error || 'Publish failed.');
            }
        }

        return {
            deployMode: 'firepit',
            pageTitle,
            pageSlug,
            usedFallback,
            publishError,
            uploadedFile,
            pageServerRelativeUrl,
            pageAbsoluteUrl: this.resolveSharePointAbsoluteUrl(context, pageServerRelativeUrl)
        };
    },

    async provisionLegacySharePointPage(artifact) {
        const deployConfig = this.getSharePointDeployConfig(artifact?.outName);
        const {
            context,
            pageSlug,
            pageTitle,
            pageFileName,
            publishPage
        } = deployConfig;
        const digest = await this.getSharePointRequestDigest(context.webAbsoluteUrl);
        const pageServerRelativeUrl = this.joinServerRelativePath(context.sitePagesServerRelativeUrl, pageFileName);

        this.setSharePointDeployStatus('Uploading legacy SharePoint .aspx page...', 'info');
        const uploadedFile = await this.uploadHtmlToSharePoint(
            context,
            digest,
            context.sitePagesServerRelativeUrl,
            pageFileName,
            artifact.finalHtml
        );

        let publishError = null;
        if (publishPage) {
            try {
                this.setSharePointDeployStatus('Publishing legacy SharePoint page...', 'info');
                await this.tryPublishSharePointPage(context, digest, pageServerRelativeUrl);
            } catch (error) {
                publishError = error instanceof Error ? error.message : String(error || 'Publish failed.');
            }
        }

        return {
            deployMode: 'legacy',
            pageTitle,
            pageSlug,
            usedFallback: false,
            publishError,
            uploadedFile,
            pageServerRelativeUrl,
            pageAbsoluteUrl: this.resolveSharePointAbsoluteUrl(context, pageServerRelativeUrl)
        };
    },

    async startSharePointDeployment(options = {}) {
        if (this.sharePointDeployBusy) return;
        if (!this.canUseSharePointDeploy()) {
            alert('SharePoint deployment is only available when this app is hosted same-origin in SharePoint.');
            return null;
        }
        const deployMode = this.getSharePointDeployMode();
        this.setSharePointDeployBusy(true);
        try {
            this.setSharePointDeployStatus(deployMode === 'legacy'
                ? 'Compiling app for legacy SharePoint .aspx deployment...'
                : 'Compiling app for SharePoint deployment...', 'info');
            const artifact = await this.startCompilation({
                skipDownload: true,
                showCampfireAfterDownload: false,
                ...options,
                forceNoSecurityHeaders: true,
                shipTarget: deployMode === 'legacy' ? 'legacy-sharepoint' : 'sharepoint'
            });
            if (!artifact) {
                this.setSharePointDeployStatus('Deployment cancelled before compile completed.', 'warning');
                return null;
            }
            const result = deployMode === 'legacy'
                ? await this.provisionLegacySharePointPage(artifact)
                : await this.provisionSharePointFirepitPage(artifact);
            const notes = [];
            if (result.usedFallback) {
                notes.push('SharePoint rejected the SingleWebPartAppPage layout, so this deploy used a normal modern page with one fullscreen Firepit web part.');
            }
            if (result.deployMode === 'legacy') {
                notes.push('Legacy deploy uploaded the compiled app directly to SitePages as an .aspx file. Firepit was not used.');
            }
            if (result.publishError) {
                notes.push(`Page publish did not complete automatically: ${result.publishError}`);
            }
            const extraHtml = [
                `<br><a href="${this.escapeHtml(result.pageAbsoluteUrl)}" target="_blank" rel="noopener noreferrer">Open page</a>`,
                ` · <a href="${this.escapeHtml(result.uploadedFile.absoluteUrl)}" target="_blank" rel="noopener noreferrer">Open uploaded HTML</a>`,
                notes.length ? `<br>${notes.map(note => this.escapeHtml(note)).join('<br>')}` : ''
            ].join('');
            this.setSharePointDeployStatus(`SharePoint deploy completed for ${result.pageTitle}.`, result.publishError ? 'warning' : 'success', extraHtml);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || 'SharePoint deploy failed.');
            this.setSharePointDeployStatus(`SharePoint deploy failed: ${message}`, 'danger');
            throw error;
        } finally {
            this.setSharePointDeployBusy(false);
        }
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    getHtmlDisplayPath(file) {
        const relativePath = String(file?.relativePath || file?.name || '').replace(/\\/g, '/');
        const rootName = String(loadFolder?.fileHandle?.name || '').trim();
        if (rootName && relativePath) return `${rootName}/${relativePath}`;
        return relativePath || String(file?.name || '');
    },

    chooseHtmlFileForCompilationPrompt(htmlFiles) {
        if (!Array.isArray(htmlFiles) || htmlFiles.length === 0) return null;
        if (htmlFiles.length === 1) return htmlFiles[0];

        const normalizePath = (value) => String(value || '')
            .replace(/\\/g, '/')
            .replace(/^\.?\//, '')
            .replace(/\/+/g, '/')
            .trim()
            .toLowerCase();

        const optionsText = htmlFiles.map((file, idx) =>
            `${idx + 1}. ${this.getHtmlDisplayPath(file)}`
        ).join('\n');

        const indexPos = htmlFiles.findIndex(file => String(file.name || '').toLowerCase() === 'index.html');
        const defaultChoice = String((indexPos >= 0 ? indexPos : 0) + 1);

        while (true) {
            const response = prompt(
                `Multiple HTML files found. Enter the number OR full file path of the file to compile:\n\n${optionsText}`,
                defaultChoice
            );

            if (response === null) return null;

            const trimmed = String(response).trim();
            if (!trimmed) {
                alert('Please enter a file number or full path.');
                continue;
            }

            const asNumber = Number(trimmed);
            if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= htmlFiles.length) {
                return htmlFiles[asNumber - 1];
            }

            const normalizedInput = normalizePath(trimmed);
            const matchedByPath = htmlFiles.find(file => {
                const relative = normalizePath(file.relativePath || file.name || '');
                const full = normalizePath(this.getHtmlDisplayPath(file));
                return normalizedInput === relative || normalizedInput === full;
            });
            if (matchedByPath) return matchedByPath;

            alert('Invalid choice. Enter one of the listed numbers or an exact full path from the list.');
        }
    },

    async chooseHtmlFileForCompilation(htmlFiles) {
        if (!Array.isArray(htmlFiles) || htmlFiles.length === 0) return null;
        if (htmlFiles.length === 1) return htmlFiles[0];

        const modalApi = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal : null;
        if (!modalApi) {
            return this.chooseHtmlFileForCompilationPrompt(htmlFiles);
        }

        const modalId = 'compileHtmlSelectionModal';
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        const indexPos = htmlFiles.findIndex(file => String(file.name || '').toLowerCase() === 'index.html');
        const defaultIndex = indexPos >= 0 ? indexPos : 0;
        const optionsHtml = htmlFiles.map((file, idx) => {
            const displayPath = this.escapeHtml(this.getHtmlDisplayPath(file));
            const relativePath = this.escapeHtml(String(file.relativePath || file.name || ''));
            const checked = idx === defaultIndex ? 'checked' : '';
            return `
                <label class="list-group-item list-group-item-action bg-dark text-light border-secondary d-flex align-items-start gap-2">
                    <input class="form-check-input mt-1" type="radio" name="compile-html-file-choice" value="${idx}" ${checked}>
                    <div class="w-100">
                        <div><code>${displayPath}</code></div>
                        <div class="small text-secondary">Relative path: ${relativePath}</div>
                    </div>
                </label>
            `;
        }).join('');

        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content bg-dark text-light border-secondary">
                        <div class="modal-header border-secondary">
                            <h5 class="modal-title">Choose HTML File to Compile</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-2">Multiple HTML files were found. Select the exact file to use as the compile entry point.</p>
                            <div class="list-group" style="max-height: 45vh; overflow: auto;">
                                ${optionsHtml}
                            </div>
                            <div class="small text-warning mt-2" data-role="validation" style="display: none;">
                                Select one file to continue.
                            </div>
                        </div>
                        <div class="modal-footer border-secondary">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" data-role="compile-selected">Compile Selected File</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return this.chooseHtmlFileForCompilationPrompt(htmlFiles);

        return new Promise((resolve) => {
            let selectedFile = null;
            const modal = new modalApi(modalEl);
            const compileBtn = modalEl.querySelector('[data-role="compile-selected"]');
            const validationEl = modalEl.querySelector('[data-role="validation"]');

            if (compileBtn) {
                compileBtn.addEventListener('click', () => {
                    const selected = modalEl.querySelector('input[name="compile-html-file-choice"]:checked');
                    if (!selected) {
                        if (validationEl) validationEl.style.display = 'block';
                        return;
                    }
                    const idx = Number(selected.value);
                    if (!Number.isInteger(idx) || idx < 0 || idx >= htmlFiles.length) {
                        if (validationEl) validationEl.style.display = 'block';
                        return;
                    }
                    selectedFile = htmlFiles[idx];
                    modal.hide();
                });
            }

            modalEl.querySelectorAll('input[name="compile-html-file-choice"]').forEach(input => {
                input.addEventListener('change', () => {
                    if (validationEl) validationEl.style.display = 'none';
                });
            });

            modalEl.addEventListener('hidden.bs.modal', () => {
                modalEl.remove();
                resolve(selectedFile);
            }, { once: true });

            modal.show();
        });
    },

    renderCspWarnings(issues) {
        if (!issues || issues.length === 0) return;
        const presentation = this.getCompatibilityWarningPresentation(issues);
        const warningHtml = `
            <div class="alert alert-warning mb-3">
                <h5 class="mb-2">${this.escapeHtml(presentation.title)}</h5>
                <p class="mb-2">${this.escapeHtml(presentation.intro)}</p>
                ${issues.map((issue, idx) => `
                    <div class="mb-2 p-2" style="border:1px solid #7a5f00; border-radius:4px; background:#2b2510;">
                        <div><strong>${idx + 1}. ${this.escapeHtml(issue.name)}</strong></div>
                        <div class="small">${this.escapeHtml(issue.reason)}</div>
                        <details class="mt-1">
                            <summary style="cursor:pointer;">Remediation</summary>
                            <pre class="mt-1 mb-0 p-2 small" style="white-space:pre-wrap; border:1px solid #495057; border-radius:4px;">${this.escapeHtml(issue.remediation)}</pre>
                        </details>
                    </div>
                `).join('')}
            </div>
        `;
        const resultsEl = document.querySelector('#compiler-results');
        if (resultsEl) {
            resultsEl.innerHTML = warningHtml + resultsEl.innerHTML;
        }
    },

    showCampfireShareModal() {
        const modalApi = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal : null;
        if (!modalApi) {
            alert(`Upload your app to Campfire so others can access and use it:\n${this.campfireShareUrl}`);
            return;
        }

        const modalId = 'campfireShareModal';
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        const safeUrl = this.escapeHtml(this.campfireShareUrl);
        const modalHtml = `
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content bg-dark text-light border-secondary">
                        <div class="modal-header border-secondary">
                            <h5 class="modal-title">Share Your App on Campfire</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-2">Your app download has started.</p>
                            <p class="mb-2">Please upload your app to Campfire so other people can access and use it.</p>
                            <p class="mb-0 small">
                                <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>
                            </p>
                        </div>
                        <div class="modal-footer border-secondary">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Maybe Later</button>
                            <a class="btn btn-success" href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open Campfire</a>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return;

        const modal = new modalApi(modalEl);
        modalEl.addEventListener('hidden.bs.modal', () => {
            modalEl.remove();
        }, { once: true });
        modal.show();
    },

    async startCompilation(options = {}) {
        if (!loadFolder.fileHandle) { return alert("Please load a directory first."); }

        const opts = {
            forceInlineCdnChecked: false,
            forceSecurityHeadersChecked: false,
            forceNoSecurityHeaders: false,
            navigateToCompilerOnWarning: false,
            navigateToCompilerOnMissing: false,
            showCampfireAfterDownload: false,
            skipDownload: false,
            skipHashLog: false,
            livePreview: false,
            saveToShippedApps: false,
            shipReleaseType: 'feature',
            shipTarget: 'offline',
            copyToClipboardAfterSave: false,
            shipSavedModalTitle: '',
            clipboardSuccessMessage: '',
            clipboardFailureMessage: '',
            deploymentInstructionsHtml: '',
            fusionBridgeMode: false,
            wrapFusionFullscreenIframe: false,
            ...options
        };

        if (opts.livePreview) {
            opts.skipDownload = true;
            opts.skipHashLog = true;
            opts.saveToShippedApps = false;
        }

        if (opts.saveToShippedApps) {
            opts.skipDownload = true;
        }

        if (opts.forceInlineCdnChecked) {
            const inlineCheckbox = document.querySelector('#inline-cdn');
            if (inlineCheckbox) inlineCheckbox.checked = true;
        }
        if (opts.forceSecurityHeadersChecked) {
            const securityCheckbox = document.querySelector('#add-security-headers');
            if (securityCheckbox) securityCheckbox.checked = true;
        }
        if (opts.forceNoSecurityHeaders) {
            const securityCheckbox = document.querySelector('#add-security-headers');
            if (securityCheckbox) securityCheckbox.checked = false;
            const spCompatCheckbox = document.querySelector('#sharepoint-compat-mode');
            if (spCompatCheckbox) spCompatCheckbox.checked = false;
        }

        // Options: read from optional checkboxes if present, otherwise default to true
        const inlineCDN = (document.querySelector('#inline-cdn')?.checked ?? true);
        const rewriteCssUrls = (document.querySelector('#rewrite-css-urls')?.checked ?? true);
        // Option flags to keep dev console and UI tester scripts; default to false (exclude)
        const includeDevconsole = (document.querySelector('#include-devconsole')?.checked ?? false);
        const includeTestRecorder = (document.querySelector('#include-test-recorder')?.checked ?? false);
	        // Security option: default to true (add security headers) - use let so we can modify if user chooses
	        let addSecurityHeaders = (document.querySelector('#add-security-headers')?.checked ?? true);
	        const apiAllowlistRaw = (document.querySelector('#security-connect-allowlist')?.value ?? '');
	        const sharePointCompatMode = (document.querySelector('#sharepoint-compat-mode')?.checked ?? false);
	        const allowCdnPulldowns = (document.querySelector('#allow-cdn-pulldowns')?.checked ?? false);
	        const cdnAllowlistRaw = (document.querySelector('#security-cdn-allowlist')?.value ?? '');
	        const allowAskSageApi = (document.querySelector('#allow-asksage-api')?.checked ?? false);
	        const allowGenAiMilApi = (document.querySelector('#allow-genaimil-api')?.checked ?? false);

        const parseConnectSrcAllowlist = (raw) => {
            const out = [];
            const seen = new Set();
            const add = (value) => {
                const v = String(value || '').trim();
                if (!v || seen.has(v)) return;
                seen.add(v);
                out.push(v);
            };
            const cleanHostToken = (value) => {
                let token = String(value || '').trim();
                token = token.replace(/^['"]|['"]$/g, '');
                token = token.replace(/^[a-z]+:\/\//i, '');
                token = token.split('/')[0];
                token = token.split('?')[0];
                token = token.split('#')[0];
                return token.trim();
            };
            const tokens = String(raw || '')
                .split(/[\r\n,;\s]+/)
                .map((t) => t.trim())
                .filter(Boolean);

            for (const tokenRaw of tokens) {
                const token = String(tokenRaw || '').trim().replace(/^['"]|['"]$/g, '');
                if (!token) continue;
                const lower = token.toLowerCase();
                if (lower === "'none'" || lower === 'none') continue;
                if (lower === "'self'" || lower === 'self') {
                    add("'self'");
                    continue;
                }
                if (/^https?:$/i.test(token)) {
                    add(lower);
                    continue;
                }
                if (/^https?:\/\//i.test(token)) {
                    try {
                        const parsed = new URL(token);
                        const protocol = parsed.protocol.toLowerCase();
                        if (protocol !== 'http:' && protocol !== 'https:') continue;
                        if (!parsed.host) continue;
                        add(`${protocol}//${parsed.host.toLowerCase()}`);
                    } catch {
                        // ignore malformed entries
                    }
                    continue;
                }
                const host = cleanHostToken(token).toLowerCase();
                if (!host) continue;
                if (!/^[a-z0-9.*-]+(?::\d+)?$/i.test(host)) continue;
                if (host.includes('*') && !host.startsWith('*.')) continue;
                add(`https://${host}`);
                add(`http://${host}`);
            }
            return out;
        };
	        const mergeUniqueAllowlist = (...lists) => {
	            const out = [];
	            const seen = new Set();
            for (const list of lists) {
                for (const raw of (Array.isArray(list) ? list : [])) {
                    const item = String(raw || '').trim();
                    if (!item || seen.has(item)) continue;
                    seen.add(item);
                    out.push(item);
                }
            }
	            return out;
	        };
	        const apiConnectSrcAllowlist = parseConnectSrcAllowlist([
	            apiAllowlistRaw,
	            ...(allowAskSageApi ? ['api.capra.flankspeed.us.navy.mil', 'api.genai.army.mil', 'api.genai.army.smil.mil'] : []),
	            ...(allowGenAiMilApi ? ['api.genai.mil'] : [])
	        ].join('\n'));
	        const cdnConnectSrcAllowlist = allowCdnPulldowns ? parseConnectSrcAllowlist(cdnAllowlistRaw) : [];
	        const normalizedShipTargetForCompile = this.normalizeShipTarget(opts.shipTarget);
	        const useFusionBridgeMode = !!opts.fusionBridgeMode || !!opts.wrapFusionFullscreenIframe || normalizedShipTargetForCompile === 'fusion-wiki' || normalizedShipTargetForCompile === 'fusion-wiki-fullscreen';
	        const useFusionFullscreenMode = !!opts.wrapFusionFullscreenIframe || normalizedShipTargetForCompile === 'fusion-wiki-fullscreen';
	        // SharePoint/SPFx compat mode simply disables security headers
	        if (sharePointCompatMode) {
	            addSecurityHeaders = false;
	        }
	        if (useFusionBridgeMode) {
	            addSecurityHeaders = true;
	        }
	        const useSharePointCompatMode = false;
	        const useSharePointInlineEventRewrite = false;
	        const sharePointOrigin = '';
	        const sharePointSiteUrl = '';
	        const fusionConnectSrcAllowlist = useFusionBridgeMode
	            ? ["'self'", 'https://api.capra.flankspeed.us.navy.mil', 'https://chat.capra.flankspeed.us.navy.mil']
	            : [];
	        const connectSrcAllowlist = useFusionBridgeMode
	            ? mergeUniqueAllowlist(fusionConnectSrcAllowlist)
	            : mergeUniqueAllowlist(apiConnectSrcAllowlist, cdnConnectSrcAllowlist);

        // Simple stable string hash for matching during decompile
        const hashString = (str) => {
            let h = 5381;
            for (let i = 0; i < str.length; i++) {
                h = ((h << 5) + h) ^ str.charCodeAt(i);
            }
            // convert to unsigned 32-bit and hex
            return (h >>> 0).toString(16).padStart(8, '0');
        };

        const toBase64 = (bytes) => {
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }
            return btoa(binary);
        };

        const files = { html: [], js: [], css: [], img: [], wasm: [] };
        for (const file of loadFolder.fileStructure) {
            // Only include real files (skip directories)
            if (file.kind !== 'file') continue;
            let ext = '';
            const dot = file.name.lastIndexOf('.');
            if (dot !== -1) ext = file.name.slice(dot + 1).toLowerCase();
            // Normalize common alternates
            if (ext === 'htm') ext = 'html';
            if (ext === 'mjs') ext = 'js';
            const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif']);
            if (ext === 'wasm') {
                files.wasm.push({
                    name: file.name,
                    content: null,
                    relativePath: file.relativePath,
                    entry: file.entry,
                    ext
                });
            } else if (files.hasOwnProperty(ext)) {
                files[ext].push({
                    name: file.name,
                    content: await loadFolder.getFileContent(file),
                    relativePath: file.relativePath,
                    entry: file.entry
                });
            } else if (imageExts.has(ext)) {
                files.img.push({
                    name: file.name,
                    // lazy-load image binary when needed; keep placeholder
                    content: null,
                    relativePath: file.relativePath,
                    entry: file.entry,
                    ext
                });
            }
        }

        const indexFile = await this.chooseHtmlFileForCompilation(files.html);
        if (!indexFile) {
            if (!files.html.length) {
                return alert("No HTML file found to compile.");
            }
            return;
        }

        // Check for CSP compatibility issues if security headers are enabled
        let cspIssues = [];
        let compatibilityIssues = [];
        if (addSecurityHeaders) {
            // Build combined content to check (HTML + all JS files since they may contain patterns)
            let contentToCheck = indexFile.content;
            for (const jsFile of files.js) {
                contentToCheck += '\n' + jsFile.content;
            }

            cspIssues = this.checkForCspIssues(contentToCheck);
        }
        compatibilityIssues = compatibilityIssues.concat(cspIssues);
        if (compatibilityIssues.length > 0) {
            if (opts.navigateToCompilerOnWarning) {
                this.showCompilerTab();
            }
            this.renderCspWarnings(compatibilityIssues);
            const userChoice = await this.showCspWarning(compatibilityIssues);

            switch (userChoice.action) {
                case 'cancel':
                    // User cancelled - abort compilation
                    return;
                case 'continue':
                    // User chose to continue anyway - proceed with compilation
                    break;
            }
        }

        let html = indexFile.content.split('\n');
        let foundLines = { js: [], css: [], img: [], wasm: [] };
        let missingLines = { js: [], css: [], img: [], wasm: [] };

        // Manifest describing original file structure and hashes for decompilation
        const manifest = {
            version: 1,
            project: loadFolder.fileHandle?.name || null,
            generated: new Date().toISOString(),
            index: indexFile?.name || 'index.html',
            files: [] // { kind: 'js'|'css', path: '...', external: bool, hash: 'hex' }
        };

        // Helpers for handling external URLs
        const getAttr = (line, attr) => {
            const m1 = line.match(new RegExp(attr + "\\s*=\\s*\"([^\"]*)\"", 'i'));
            if (m1) return m1[1];
            const m2 = line.match(new RegExp(attr + "\\s*=\\s*'([^']*)'", 'i'));
            return m2 ? m2[1] : null;
        };
        const isExternalUrl = (url) => /^(https?:)?\/\//i.test(url);
        const normalizeExternalUrl = (url) => {
            if (!url) return null;
            if (url.startsWith('//')) { return 'https:' + url; }
            return url;
        };
        const fetchText = async (url) => {
            try {
                const u = normalizeExternalUrl(url);
                if (!u) return null;
                const res = await fetch(u, { mode: 'cors' });
                if (!res.ok) return null;
                return await res.text();
            } catch (e) {
                return null;
            }
        };
        const extToMime = (ext) => {
            switch ((ext || '').toLowerCase()) {
                case 'png': return 'image/png';
                case 'jpg':
                case 'jpeg': return 'image/jpeg';
                case 'gif': return 'image/gif';
                case 'svg': return 'image/svg+xml';
                case 'webp': return 'image/webp';
                case 'ico': return 'image/x-icon';
                case 'bmp': return 'image/bmp';
                case 'avif': return 'image/avif';
                case 'wasm': return 'application/wasm';
                default: return 'application/octet-stream';
            }
        };
        const readFileAsBase64 = async (fileHandle) => {
            try {
                const file = await fileHandle.getFile();
                const buf = await file.arrayBuffer();
                let binary = '';
                const bytes = new Uint8Array(buf);
                const chunkSize = 0x8000;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                }
                return btoa(binary);
            } catch {
                return null;
            }
        };
        const rewriteCssUrlReferences = (cssText, baseUrl) => {
            if (!rewriteCssUrls) return cssText;
            let base;
            try { base = new URL(baseUrl, window.location.href); } catch { return cssText; }
            const replacer = (match, quote, rawUrl) => {
                const trimmed = rawUrl.trim();
                // Skip data URIs, fragments, absolute protocols, and about/blob
                if (/^(data:|#|https?:|file:|about:|blob:)/i.test(trimmed) || /^\/\//.test(trimmed)) {
                    return `url(${quote || ''}${trimmed}${quote || ''})`;
                }
                let resolved;
                try {
                    resolved = new URL(trimmed, base).href;
                } catch {
                    resolved = trimmed; // fallback
                }
                return `url(${quote || ''}${resolved}${quote || ''})`;
            };
            // url("...") or url('...') or url(...)
            return cssText.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, replacer);
        };
        // Sanitize inline JS so embedded script-tag text in strings/comments does not confuse
        // the HTML parser while preserving the JavaScript value/regex semantics.
        const sanitizeScriptContent = (code) => String(code || '')
            .replace(/<\/script/gi, '<\\/script')
            .replace(/<script/gi, '<\\x73cript');
        const rewriteWasmUrlConstructors = (code) => String(code || '').replace(
            /new\s+URL\s*\(\s*(['"])([^'"]+\.wasm(?:[?#][^'"]*)?)\1\s*,\s*import\.meta\.url\s*\)/gi,
            (_match, quote, wasmPath) => `${quote}${wasmPath}${quote}`
        );
        const buildInlineScriptTag = (code) => `<script>${sanitizeScriptContent(code)}</script>`;
        const buildInlinedScriptTag = (sourceTag, code) => {
            const attrs = (String(sourceTag || '').match(/<script\b([^>]*)>/i) || [])[1] || '';
            const typeAttr = (attrs.match(/\s+type\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i) || [])[0] || '';
            return `<script${typeAttr}>\n${sanitizeScriptContent(code)}\n</sc` + `ript>`;
        };
        const decodeUtf8B64 = (b64) => {
            const raw = atob(String(b64 || ''));
            try {
                return decodeURIComponent(escape(raw));
            } catch {
                return raw;
            }
        };
        const isJavaScriptScriptType = (openTag) => {
            const typeMatch = String(openTag || '').match(/\btype\s*=\s*(['"])(.*?)\1/i)
                || String(openTag || '').match(/\btype\s*=\s*([^\s>]+)/i);
            const rawType = String(typeMatch ? (typeMatch[2] || typeMatch[1] || '') : '').trim().toLowerCase();
            if (!rawType) return true;
            return rawType === 'text/javascript'
                || rawType === 'application/javascript'
                || rawType === 'text/ecmascript'
                || rawType === 'application/ecmascript';
        };
        const isEvalBlockedByCsp = (error) => {
            const message = String(error && error.message ? error.message : error || '').toLowerCase();
            return message.includes('unsafe-eval')
                || message.includes('evaluating a string as javascript violates')
                || (message.includes('content security policy') && message.includes('script-src'));
        };
        const canUseFunctionSyntaxCheck = (() => {
            try {
                // If the current page CSP forbids unsafe-eval, this throws immediately.
                new Function('');
                return true;
            } catch (error) {
                if (isEvalBlockedByCsp(error)) {
                    console.warn('Compiled artifact inline-script syntax validation disabled because the current CSP blocks Function()-based parsing.');
                    return false;
                }
                return true;
            }
        })();
        const collectInlineScriptValidationErrors = (htmlText, layerLabel) => {
            if (!canUseFunctionSyntaxCheck) {
                return [];
            }
            const out = [];
            let parsedScripts = [];
            try {
                if (typeof DOMParser === 'function') {
                    const doc = new DOMParser().parseFromString(String(htmlText || ''), 'text/html');
                    parsedScripts = Array.from(doc.querySelectorAll('script'));
                }
            } catch { }

            if (parsedScripts.length) {
                let scriptIndex = 0;
                for (const scriptEl of parsedScripts) {
                    if (!scriptEl || scriptEl.src) continue;
                    if (!isJavaScriptScriptType(scriptEl.outerHTML || '')) continue;
                    scriptIndex += 1;
                    const code = scriptEl.textContent || '';
                    try {
                        // Parse without executing so malformed generated scripts fail the build.
                        // We validate classic inline scripts only; module/importmap payloads are skipped above.
                        new Function(code);
                    } catch (error) {
                        const preview = String(code)
                            .replace(/\s+/g, ' ')
                            .trim()
                            .slice(0, 160);
                        out.push({
                            layer: layerLabel,
                            scriptIndex,
                            message: (error && error.message) ? error.message : String(error),
                            preview
                        });
                    }
                }
                return out;
            }

            const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
            let match;
            let scriptIndex = 0;
            while ((match = scriptRe.exec(String(htmlText || '')))) {
                const openTag = match[0].slice(0, match[0].indexOf('>') + 1);
                if (/\bsrc\s*=/i.test(openTag)) continue;
                if (!isJavaScriptScriptType(openTag)) continue;
                scriptIndex += 1;
                const code = match[2] || '';
                try {
                    new Function(code);
                } catch (error) {
                    const preview = String(code)
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 160);
                    out.push({
                        layer: layerLabel,
                        scriptIndex,
                        message: (error && error.message) ? error.message : String(error),
                        preview
                    });
                }
            }
            return out;
        };
        const collectCompiledArtifactValidationErrors = (compiledHtml) => {
            const htmlText = String(compiledHtml || '');
            const errors = [];
            const wrapperScriptErrors = collectInlineScriptValidationErrors(htmlText, 'Outer wrapper HTML');
            if (wrapperScriptErrors.length) errors.push(...wrapperScriptErrors);

            const childMatch = htmlText.match(/\bconst\s+CHILD_HTML_B64\s*=\s*(["'])([\s\S]*?)\1\s*;/);
            if (!childMatch) return errors;

            try {
                const childHtml = decodeUtf8B64(childMatch[2]);
                const childScriptErrors = collectInlineScriptValidationErrors(childHtml, 'Child srcdoc HTML');
                if (childScriptErrors.length) errors.push(...childScriptErrors);
            } catch (error) {
                errors.push({
                    layer: 'Child srcdoc HTML',
                    scriptIndex: 0,
                    message: `Unable to decode CHILD_HTML_B64: ${(error && error.message) ? error.message : String(error)}`,
                    preview: ''
                });
            }
            return errors;
        };
        const reportCompiledArtifactValidationFailure = (errors) => {
            const issues = Array.isArray(errors) ? errors : [];
            if (!issues.length) return false;
            const lines = issues.slice(0, 5).map((issue) => {
                const where = issue.scriptIndex ? `${issue.layer}, inline script #${issue.scriptIndex}` : issue.layer;
                const preview = issue.preview ? `\nPreview: ${issue.preview}` : '';
                return `- ${where}: ${issue.message}${preview}`;
            });
            const extra = issues.length > 5 ? `\n...and ${issues.length - 5} more issue(s).` : '';
            const message = `Compilation blocked because the generated artifact contains malformed inline JavaScript.\n\n${lines.join('\n')}${extra}\n\nThis usually means a packaging/injection step corrupted the wrapper or decoded child srcdoc payload.`;
            console.error('Compiled artifact validation failed:', issues);
            alert(message);
            return true;
        };

        // --- Robust local file resolution ---
        // Resolve linked assets relative to the selected HTML entrypoint directory first,
        // then fall back to basename matching.
        const normalizePath = (p) => (p || '')
            .replace(/\\/g, '/')
            .replace(/^\.\/+/, '')
            .replace(/\/+/g, '/')
            .replace(/\/$/, '');
        const getDirname = (p) => {
            const normalized = normalizePath(p);
            const idx = normalized.lastIndexOf('/');
            return idx === -1 ? '' : normalized.slice(0, idx);
        };
        const resolveRelativePath = (baseDir, refPath) => {
            const ref = String(refPath || '').trim();
            if (!ref) return '';
            // Keep scheme/protocol-relative references out of local resolution.
            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) || ref.startsWith('//')) return '';

            const isRootLike = ref.startsWith('/');
            const cleanRef = normalizePath(isRootLike ? ref.replace(/^\/+/, '') : ref);
            const outParts = [];

            if (!isRootLike) {
                const baseParts = normalizePath(baseDir).split('/').filter(Boolean);
                outParts.push(...baseParts);
            }

            for (const part of cleanRef.split('/')) {
                if (!part || part === '.') continue;
                if (part === '..') {
                    if (outParts.length) outParts.pop();
                    continue;
                }
                outParts.push(part);
            }
            return outParts.join('/');
        };
        const findLocal = (list, srcFull, baseName, entryDir = '') => {
            const srcNorm = normalizePath(srcFull || '');
            const base = (baseName || '').trim();
            const entryDirNorm = normalizePath(entryDir);

            // 1) Exact relativePath match when a path is provided.
            if (srcNorm) {
                const exactRel = list.find(f => normalizePath(f.relativePath) === srcNorm);
                if (exactRel) return exactRel;

                // 1b) Resolve relative to the selected HTML entrypoint directory.
                const resolvedRel = resolveRelativePath(entryDirNorm, srcNorm);
                if (resolvedRel) {
                    const resolvedMatch = list.find(f => normalizePath(f.relativePath) === resolvedRel);
                    if (resolvedMatch) return resolvedMatch;
                }
            }

            // 2) Exact basename match with entry directory preference.
            if (base) {
                const exactNameMatches = list.filter(f => f.name === base);
                if (exactNameMatches.length === 1) return exactNameMatches[0];
                if (exactNameMatches.length > 1) {
                    // Prefer same-directory match next to the selected HTML.
                    const preferredRel = resolveRelativePath(entryDirNorm, base);
                    const preferred = exactNameMatches.find(f => normalizePath(f.relativePath) === preferredRel);
                    if (preferred) return preferred;

                    // Otherwise prefer the closest file under the same entry directory subtree.
                    if (entryDirNorm) {
                        const subtreeMatches = exactNameMatches
                            .map(f => ({ file: f, rel: normalizePath(f.relativePath) }))
                            .filter(item => item.rel.startsWith(entryDirNorm + '/'))
                            .sort((a, b) => a.rel.length - b.rel.length);
                        if (subtreeMatches.length) return subtreeMatches[0].file;
                    }

                    return exactNameMatches[0];
                }

                // 3) Case-insensitive basename match as a last resort (for odd filesystems).
                const ciMatches = list.filter(f => String(f.name || '').toLowerCase() === base.toLowerCase());
                if (ciMatches.length === 1) return ciMatches[0];
                if (ciMatches.length > 1) {
                    const preferredRel = resolveRelativePath(entryDirNorm, base).toLowerCase();
                    const preferred = ciMatches.find(f => normalizePath(f.relativePath).toLowerCase() === preferredRel);
                    if (preferred) return preferred;
                    return ciMatches[0];
                }
            }

            // No match.
            return null;
        };

        const wasmAssets = [];
        for (const wasmFile of files.wasm) {
            const originalPath = wasmFile.relativePath || wasmFile.name;
            const base64 = wasmFile.entry ? await readFileAsBase64(wasmFile.entry) : null;
            if (base64) {
                wasmAssets.push({
                    name: wasmFile.name,
                    path: originalPath,
                    b64: base64
                });
                foundLines.wasm.push({ original: originalPath, replace: 'embedded WebAssembly asset' });
                manifest.files.push({ kind: 'wasm', path: originalPath, external: false, hash: hashString(base64) });
            } else {
                missingLines.wasm.push({ original: originalPath });
            }
        }
        // ----------------------------------------------------------------------
        const entryDir = getDirname(indexFile.relativePath || indexFile.name || '');

        // Helper: check if a tag is complete (has closing >)
        const isTagComplete = (str) => str.includes('>');

        // Helper: collect multi-line tag content starting from index i
        // Returns { tagContent: string, endIndex: number } where endIndex is the last line consumed
        const collectMultiLineTag = (lines, startIdx) => {
            let tagContent = lines[startIdx];
            let endIdx = startIdx;

            // If line already contains closing >, we're done
            if (isTagComplete(tagContent)) {
                return { tagContent, endIndex: endIdx };
            }

            // Otherwise, consume lines until we find the closing >
            for (let j = startIdx + 1; j < lines.length; j++) {
                tagContent += '\n' + lines[j];
                endIdx = j;
                if (isTagComplete(lines[j])) {
                    break;
                }
            }
            return { tagContent, endIndex: endIdx };
        };
        // Replace only the target tag inside a collected block, preserving any prefix/suffix
        // markup that shares the same line (for example: "<html><head>...<script src=...>").
        const replaceCollectedTag = (lines, startIdx, endIdx, tagName, replacementHtml) => {
            const block = lines.slice(startIdx, endIdx + 1).join('\n');
            const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
            const openMatch = block.match(openRe);

            if (!openMatch || typeof openMatch.index !== 'number') {
                lines[startIdx] = replacementHtml;
                for (let k = startIdx + 1; k <= endIdx; k++) lines[k] = '';
                return;
            }

            const openStart = openMatch.index;
            let tagEnd = openStart + openMatch[0].length;
            if (String(tagName || '').toLowerCase() === 'script') {
                const closeMatch = block.slice(tagEnd).match(/<\/script\s*>/i);
                if (closeMatch && typeof closeMatch.index === 'number') {
                    tagEnd += closeMatch.index + closeMatch[0].length;
                }
            }

            const prefix = block.slice(0, openStart);
            const suffix = block.slice(tagEnd);
            lines[startIdx] = `${prefix}${replacementHtml}${suffix}`;
            for (let k = startIdx + 1; k <= endIdx; k++) lines[k] = '';
        };

        for (let i = 0; i < html.length; i++) {
            let line = html[i];
            // Auto-comment out devconsole/test-recorder script includes unless explicitly included
            // Do this before any inlining logic runs
            try {
                if (line && line.includes('<scr' + 'ipt') && line.includes('src=')) {
                    const srcVal = getAttr(line, 'src') || '';
                    const srcLower = srcVal.toLowerCase();
                    const isDevconsoleTab = srcLower.includes('devconsoletab.js');
                    const isDevconsoleScript = srcLower.includes('devconsole.js'); // target only the runtime script
                    const isDevconsole = isDevconsoleScript && !isDevconsoleTab;
                    const isTestRecorder = srcLower.includes('testrecorder.js');
                    const isLegacyTest = srcLower.includes('simpletest') || srcLower.includes('unittest.js') || srcLower.includes('unittest.plan.js');
                    if ((isDevconsole && !includeDevconsole) || (isTestRecorder && !includeTestRecorder) || isLegacyTest) {
                        html[i] = `<!-- ${line.trim()} -->`;
                        continue;
                    }
                }
            } catch { }
            if (line.includes('<scr' + 'ipt') && line.includes('src=')) {
                // Handle multi-line script tags
                const { tagContent, endIndex } = collectMultiLineTag(html, i);
                const srcFull = getAttr(tagContent, 'src');
                const fileName = (srcFull || '').split('/').pop();

                let replaced = false;
                if (srcFull && isExternalUrl(srcFull) && inlineCDN) {
                    let cdnJs = await fetchText(srcFull);
                    if (cdnJs !== null) {
                        cdnJs = rewriteWasmUrlConstructors(cdnJs);
                        const safeContent = sanitizeScriptContent(cdnJs);
                        replaceCollectedTag(html, i, endIndex, 'script', buildInlinedScriptTag(tagContent, cdnJs));
                        foundLines.js.push({ original: tagContent.trim().replace(/\s+/g, ' '), replace: normalizeExternalUrl(srcFull) });
                        manifest.files.push({ kind: 'js', path: normalizeExternalUrl(srcFull), external: true, hash: hashString(safeContent) });
                        replaced = true;
                    } else {
                        missingLines.js.push({ original: tagContent.trim().replace(/\s+/g, ' ') });
                    }
                } else {
                    // FIXED: exact match logic (no .endsWith)
                    const jsFile = findLocal(files.js, srcFull, fileName, entryDir);
                    if (jsFile) {
                        const rewrittenJsContent = rewriteWasmUrlConstructors(jsFile.content);
                        const safeContent = sanitizeScriptContent(rewrittenJsContent);
                        replaceCollectedTag(html, i, endIndex, 'script', buildInlinedScriptTag(tagContent, rewrittenJsContent));
                        foundLines.js.push({ original: tagContent.trim().replace(/\s+/g, ' '), replace: jsFile.name });
                        // Prefer original attribute path if present; else use project relative path we captured
                        const originalPath = srcFull || jsFile.relativePath || jsFile.name;
                        manifest.files.push({ kind: 'js', path: originalPath, external: false, hash: hashString(safeContent) });
                        replaced = true;
                    } else {
                        // If inlineCDN is disabled or not found, leave line as-is and mark missing
                        missingLines.js.push({ original: tagContent.trim().replace(/\s+/g, ' ') });
                    }
                }
                // Skip to the end of the multi-line tag
                if (replaced) {
                    i = endIndex;
                }
            } else if (line.includes('<link') && line.includes('href=')) {
                // Handle multi-line link tags
                const { tagContent, endIndex } = collectMultiLineTag(html, i);
                const hrefFull = getAttr(tagContent, 'href');
                const fileName = (hrefFull || '').split('/').pop();

                let replaced = false;
                if (hrefFull && isExternalUrl(hrefFull) && inlineCDN) {
                    let cdnCss = await fetchText(hrefFull);
                    if (cdnCss !== null) {
                        // Rewrite relative url()s to absolute based on the stylesheet URL
                        cdnCss = rewriteCssUrlReferences(cdnCss, normalizeExternalUrl(hrefFull));
                        replaceCollectedTag(html, i, endIndex, 'link', `<style>\n${cdnCss}\n</style>`);
                        foundLines.css.push({ original: tagContent.trim().replace(/\s+/g, ' '), replace: normalizeExternalUrl(hrefFull) });
                        manifest.files.push({ kind: 'css', path: normalizeExternalUrl(hrefFull), external: true, hash: hashString(cdnCss) });
                        replaced = true;
                    } else {
                        missingLines.css.push({ original: tagContent.trim().replace(/\s+/g, ' ') });
                    }
                } else {
                    // FIXED: exact match logic (no .endsWith)
                    const cssFile = findLocal(files.css, hrefFull, fileName, entryDir);
                    if (cssFile) {
                        replaceCollectedTag(html, i, endIndex, 'link', `<style>\n${cssFile.content}\n</style>`);
                        foundLines.css.push({ original: tagContent.trim().replace(/\s+/g, ' '), replace: cssFile.name });
                        const originalPath = hrefFull || cssFile.relativePath || cssFile.name;
                        manifest.files.push({ kind: 'css', path: originalPath, external: false, hash: hashString(cssFile.content) });
                        replaced = true;
                    } else {
                        // If inlineCDN is disabled or not found, leave line as-is and mark missing
                        missingLines.css.push({ original: tagContent.trim().replace(/\s+/g, ' ') });
                    }
                }
                // Skip to the end of the multi-line tag
                if (replaced) {
                    i = endIndex;
                }
            } else if (line.includes('<img') && line.includes('src=')) {
                const srcFull = getAttr(line, 'src');
                const fileName = (srcFull || '').split('/').pop();
                if (!srcFull) continue;
                if (isExternalUrl(srcFull) || srcFull.startsWith('data:')) {
                    // External or already inlined; skip
                    continue;
                }
                const imgFile = findLocal(files.img, srcFull, fileName, entryDir);
                if (imgFile && imgFile.entry) {
                    const base64 = await readFileAsBase64(imgFile.entry);
                    if (base64) {
                        const mime = extToMime(imgFile.ext || imgFile.name.split('.').pop());
                        const dataUri = `data:${mime};base64,${base64}`;
                        const escapedSrc = srcFull.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const srcRegex = new RegExp(`(src\\s*=\\s*["'])${escapedSrc}(["'])`, 'i');
                        html[i] = line.replace(srcRegex, `$1${dataUri}$2`);
                        foundLines.img.push({ original: line.trim(), replace: imgFile.name });
                        const originalPath = srcFull || imgFile.relativePath || imgFile.name;
                        manifest.files.push({ kind: 'img', path: originalPath, external: false, hash: hashString(base64) });
                    } else {
                        missingLines.img.push({ original: line.trim() });
                    }
                } else {
                    missingLines.img.push({ original: line.trim() });
                }
            }
        }

        this.writeResults(foundLines, missingLines, { compatibilityIssues });

        const hasUnreplacedCssOrJs = (missingLines.js?.length > 0) || (missingLines.css?.length > 0);
        if (opts.navigateToCompilerOnMissing && hasUnreplacedCssOrJs) {
            this.showCompilerTab();
        }

        // Build simple CSP header with restrictive directives
        const buildCspContent = () => {
            // NOTE: connectSrcAllowlist is produced by parseConnectSrcAllowlist, which enforces
            // strict validation of each entry (e.g., allowed schemes/hosts and no CSP-breaking
            // characters). At this point we are only joining already-validated values.
            const connectSrcDirective = connectSrcAllowlist.length
                ? `connect-src ${connectSrcAllowlist.join(' ')}`
                : "connect-src 'none'";
            // SharePoint compat mode rewrites inline event handlers (onclick, etc.) into
            // data-forge-on* attributes and re-attaches them at runtime via new Function().
            // new Function() requires 'unsafe-eval' in the script-src directive.
            const scriptSrcTokens = ["script-src", "'unsafe-inline'"];
            if (useSharePointInlineEventRewrite) {
                scriptSrcTokens.push("'unsafe-eval'");
            } else if (wasmAssets.length) {
                scriptSrcTokens.push("'wasm-unsafe-eval'");
            }
            const scriptSrc = scriptSrcTokens.join(' ');
            const directives = [
                "default-src 'none'",
                scriptSrc,
                "style-src 'unsafe-inline'",
                "worker-src blob:",
                connectSrcDirective,
                "img-src data: blob:",
                "font-src data:",
                "media-src 'none'",
                "manifest-src 'none'",
                "form-action 'none'",
                "frame-src 'none'",
                "object-src 'none'",
            ];
            return directives.join('; ') + ';';
        };

        // Runtime hardening for non-deterministic link hints and manifest fetch behavior.
        // CSP does not consistently cover dns-prefetch across browsers.
        const buildLinkHintGuardScript = () => {
            return [
                '(function(){',
                '  try {',
                '    const allowed = new Set(["stylesheet","icon","shortcut","apple-touch-icon","apple-touch-icon-precomposed","mask-icon","canonical","license","help","author","search","alternate"]);',
                '    const normalize = (value) => (value || "").toLowerCase().split(/\\s+/).filter(Boolean);',
                '    const shouldNeutralize = (el) => {',
                '      if (!el || el.tagName !== "LINK") return false;',
                '      const relTokens = normalize(el.getAttribute("rel"));',
                '      if (relTokens.length === 0) return true;',
                '      return relTokens.some((token) => !allowed.has(token));',
                '    };',
                '    const neutralize = (el) => {',
                '      if (!shouldNeutralize(el)) return;',
                '      const originalRel = el.getAttribute("rel") || "";',
                '      el.setAttribute("data-wfc-blocked-rel", originalRel);',
                '      el.removeAttribute("href");',
                '      el.removeAttribute("rel");',
                '      if (el.parentNode) el.parentNode.removeChild(el);',
                '    };',
                '    document.querySelectorAll("link[rel]").forEach(neutralize);',
                '    const observer = new MutationObserver((mutations) => {',
                '      for (const mutation of mutations) {',
                '        if (mutation.type === "childList") {',
                '          mutation.addedNodes.forEach((node) => {',
                '            if (!node || node.nodeType !== 1) return;',
                '            if (node.matches && node.matches("link[rel]")) neutralize(node);',
                '            if (node.querySelectorAll) node.querySelectorAll("link[rel]").forEach(neutralize);',
                '          });',
                '          continue;',
                '        }',
                '        if (mutation.type === "attributes") neutralize(mutation.target);',
                '      }',
                '    });',
                '    const root = document.documentElement || document;',
                '    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["rel", "href"] });',
                '  } catch (error) {',
                '    console.warn("Forge link hint guard init failed:", error);',
                '  }',
                '})();'
            ].join('');
        };

        // Runtime query-string hardening for file:// and browser variants with limited CSP support.
        // Policy: Only allow query params on mailto: links for Outlook compose fields.
        // In SharePoint compatibility mode, allow query-bearing URLs only for the configured SharePoint site path.
        const buildQueryParamGuardScript = () => {
            return [
                '(function(){',
                '  try {',
                '    const MAILTO_ALLOWED = new Set(["subject","body","cc","bcc"]);',
                `    const SHAREPOINT_COMPAT = ${useSharePointCompatMode ? 'true' : 'false'};`,
                `    const SHAREPOINT_ORIGIN = ${JSON.stringify(useSharePointCompatMode ? sharePointOrigin : '')};`,
                `    const SHAREPOINT_SITE_URL = ${JSON.stringify(useSharePointCompatMode ? sharePointSiteUrl : '')};`,
                '    const currentDoc = new URL(location.href);',
                '    currentDoc.search = "";',
                '    currentDoc.hash = "";',
                '    const CURRENT_DOC_URL = currentDoc.toString();',
                '    const BLOCKED_NAV_ATTR = "data-forge-blocked-href";',
                '    let __forgeOpen0 = null;',
                '    const isMailto = (value) => /^\\s*mailto:/i.test(String(value || ""));',
                '    const resolveUrl = (value, baseHref) => new URL(String(value || ""), baseHref || document.baseURI || location.href);',
                '    const getManualOpenCandidate = (value, baseHref) => {',
                '      const raw = String(value || "").trim();',
                '      if (!raw || raw.charAt(0) === "#") return "";',
                '      try {',
                '        const parsed = resolveUrl(raw, baseHref);',
                '        const protocol = String(parsed.protocol || "").toLowerCase();',
                '        if (!["http:","https:"].includes(protocol)) return "";',
                '        const host = String(parsed.hostname || "").trim().toLowerCase();',
                '        if (!host || !host.split(".").every((label) => label && label.length <= 20)) return "";',
                '        parsed.username = "";',
                '        parsed.password = "";',
                '        parsed.search = "";',
                '        return parsed.toString();',
                '      } catch {',
                '        return "";',
                '      }',
                '    };',
                '    const normalizePath = (value) => {',
                '      let path = String(value || "/").trim();',
                '      if (!path.startsWith("/")) path = "/" + path;',
                '      path = path.replace(/\\/+/g, "/");',
                '      path = path.replace(/\\/+$/g, "");',
                '      return path || "/";',
                '    };',
                '    const SHAREPOINT_SITE_PATH = (() => {',
                '      if (!SHAREPOINT_COMPAT || !SHAREPOINT_ORIGIN) return "";',
                '      try {',
                '        if (!SHAREPOINT_SITE_URL) return "/";',
                '        return normalizePath(new URL(SHAREPOINT_SITE_URL, SHAREPOINT_ORIGIN).pathname || "/");',
                '      } catch {',
                '        return "/";',
                '      }',
                '    })();',
                '    const isSharePointAllowedUrl = (resolved) => {',
                '      if (!SHAREPOINT_COMPAT || !SHAREPOINT_ORIGIN || !resolved) return false;',
                '      try {',
                '        const origin = String(resolved.origin || "").toLowerCase();',
                '        if (origin !== String(SHAREPOINT_ORIGIN).toLowerCase()) return false;',
                '        const path = normalizePath(resolved.pathname || "/");',
                '        if (!SHAREPOINT_SITE_PATH || SHAREPOINT_SITE_PATH === "/") return true;',
                '        return path === SHAREPOINT_SITE_PATH || path.startsWith(SHAREPOINT_SITE_PATH + "/");',
                '      } catch {',
                '        return false;',
                '      }',
                '    };',
                '    const isSameDocumentTarget = (resolved) => {',
                '      try {',
                '        return resolved.origin === currentDoc.origin && resolved.pathname === currentDoc.pathname;',
                '      } catch {',
                '        return false;',
                '      }',
                '    };',
                '    const sanitizeMailto = (value) => {',
                '      try {',
                '        const parsed = new URL(String(value || ""));',
                '        const kept = new URLSearchParams();',
                '        for (const pair of parsed.searchParams.entries()) {',
                '          const key = String(pair[0] || "").toLowerCase();',
                '          if (MAILTO_ALLOWED.has(key)) kept.append(pair[0], pair[1]);',
                '        }',
                '        const q = kept.toString();',
                '        return "mailto:" + parsed.pathname + (q ? ("?" + q) : "");',
                '      } catch {',
                '        return "mailto:";',
                '      }',
                '    };',
                '    const updateBlockedNavAttr = (el, raw, baseHref, safe) => {',
                '      if (!el || el.tagName !== "A") return;',
                '      const manual = safe === "#" ? getManualOpenCandidate(raw, baseHref) : "";',
                '      if (manual) el.setAttribute(BLOCKED_NAV_ATTR, manual);',
                '      else el.removeAttribute(BLOCKED_NAV_ATTR);',
                '    };',
                '    const sanitizeEmbeddedUrl = (value, baseHref) => {',
                '      const raw = String(value || "");',
                '      if (!raw) return "about:blank";',
                '      if (/^\\s*javascript:/i.test(raw) || /^\\s*data:/i.test(raw)) return "about:blank";',
                '      try {',
                '        const parsed = resolveUrl(raw, baseHref);',
                '        parsed.search = "";',
                '        if (isSameDocumentTarget(parsed)) return parsed.toString();',
                '        return "about:blank";',
                '      } catch {',
                '        return "about:blank";',
                '      }',
                '    };',
                '    const sanitizeMetaRefreshContent = () => "";',
                '    const sanitizeNavigationUrl = (value, baseHref, mode) => {',
                '      const raw = String(value || "");',
                '      if (!raw) return raw;',
                '      if (raw.charAt(0) === "#") return raw;',
                '      if (isMailto(raw)) return sanitizeMailto(raw);',
                '      try {',
                '        const parsed = resolveUrl(raw, baseHref);',
                '        const protocol = String(parsed.protocol || "").toLowerCase();',
                '        if (["http:","https:"].includes(protocol)) {',
                '          const host = String(parsed.hostname || "").trim().toLowerCase();',
                '          if (!host || !host.split(".").every((label) => label && label.length <= 20)) {',
                '            return mode === "anchor" ? "#" : CURRENT_DOC_URL;',
                '          }',
                '        }',
                '        parsed.username = "";',
                '        parsed.password = "";',
                '        parsed.search = "";',
                '        if (isSharePointAllowedUrl(parsed)) return parsed.toString();',
                '        if (isSameDocumentTarget(parsed)) return parsed.toString();',
                '        if (mode === "anchor" || mode === "open") {',
                '          return parsed.toString();',
                '        }',
                '        return mode === "anchor" ? "#" : CURRENT_DOC_URL;',
                '      } catch {',
                '        return mode === "anchor" ? "#" : CURRENT_DOC_URL;',
                '      }',
                '    };',
                '    const sanitizeAnchorHref = (value, baseHref) => sanitizeNavigationUrl(value, baseHref, "anchor");',
                '    const neutralizeBaseHref = (baseEl) => {',
                '      if (!baseEl || baseEl.tagName !== "BASE") return;',
                '      const raw = baseEl.getAttribute("href");',
                '      if (!raw) return;',
                '      baseEl.setAttribute("data-forge-blocked-base", raw);',
                '      baseEl.removeAttribute("href");',
                '    };',
                '    const sanitizeSrcdocValue = (value) => {',
                '      const raw = String(value || "");',
                '      if (!raw) return "";',
                '      const hasNavPrimitives = /http-equiv\\s*=\\s*["\\\']?refresh|<base\\b|window\\s*\\.\\s*location|location\\s*\\.\\s*(href|assign|replace)|window\\s*\\.\\s*open/i.test(raw);',
                '      if (!hasNavPrimitives) return raw;',
                '      return "<!doctype html><meta charset=\\"utf-8\\"><title>Blocked</title>";',
                '    };',
                '    const maybeRouteExternalViaParent = (raw, baseHref) => {',
                '      const openFn = (window.__Forge_ISOLATED_BRIDGE_ACTIVE__ && typeof window.open === "function") ? window.open : __forgeOpen0;',
                '      if (typeof openFn !== "function") return false;',
                '      try {',
                '        const parsed = resolveUrl(raw, baseHref);',
                '        if (isSameDocumentTarget(parsed)) return false;',
                '        const candidate = getManualOpenCandidate(parsed.toString(), baseHref);',
                '        if (!candidate) return false;',
                '        openFn.call(window, candidate, "_blank", "noopener,noreferrer");',
                '        return true;',
                '      } catch {',
                '        if (isMailto(raw)) {',
                '          openFn.call(window, sanitizeMailto(raw), "_blank", "noopener,noreferrer");',
                '          return true;',
                '        }',
                '        const candidate = getManualOpenCandidate(raw, baseHref);',
                '        if (!candidate) return false;',
                '        openFn.call(window, candidate, "_blank", "noopener,noreferrer");',
                '        return true;',
                '      }',
                '    };',
                '    const isDownloadBypassHref = (el, raw) => {',
                '      if (!el || el.tagName !== "A") return false;',
                '      if (!el.hasAttribute("download")) return false;',
                '      const href = String(raw || "").trim();',
                '      return /^blob:/i.test(href) || /^data:/i.test(href);',
                '    };',
                '    const sanitizeAttribute = (el, attr) => {',
                '      if (!el || !el.getAttribute) return;',
                '      const raw = el.getAttribute(attr);',
                '      if (!raw) return;',
                '      if (attr === "href" && isDownloadBypassHref(el, raw)) return;',
                '      if (attr === "href" && el.tagName === "BASE") { neutralizeBaseHref(el); return; }',
                '      let safe = raw;',
                '      if (attr === "href" && el.tagName === "A") {',
                '        safe = sanitizeAnchorHref(raw, document.baseURI || location.href);',
                '        updateBlockedNavAttr(el, raw, document.baseURI || location.href, safe);',
                '      }',
                '      if (attr === "action" && el.tagName === "FORM") safe = sanitizeNavigationUrl(raw, document.baseURI || location.href, "form");',
                '      if (attr === "src" && (el.tagName === "IFRAME" || el.tagName === "FRAME" || el.tagName === "EMBED")) safe = sanitizeEmbeddedUrl(raw, document.baseURI || location.href);',
                '      if (attr === "data" && el.tagName === "OBJECT") safe = sanitizeEmbeddedUrl(raw, document.baseURI || location.href);',
                '      if (attr === "srcdoc" && (el.tagName === "IFRAME" || el.tagName === "FRAME")) safe = sanitizeSrcdocValue(raw);',
                '      if (attr === "http-equiv" && el.tagName === "META" && String(raw || "").toLowerCase() === "refresh") {',
                '        const currentContent = String(el.getAttribute("content") || "");',
                '        if (currentContent) el.setAttribute("data-forge-blocked-refresh", currentContent);',
                '        el.removeAttribute("http-equiv");',
                '        el.setAttribute("content", "");',
                '        return;',
                '      }',
                '      if (attr === "content" && el.tagName === "META") {',
                '        const equiv = String(el.getAttribute("http-equiv") || "").toLowerCase();',
                '        if (equiv === "refresh") {',
                '          el.setAttribute("data-forge-blocked-refresh", raw);',
                '          el.removeAttribute("http-equiv");',
                '          safe = sanitizeMetaRefreshContent(raw);',
                '        }',
                '      }',
                '      if (safe !== raw) el.setAttribute(attr, safe);',
                '    };',
                '    const isBlockedGetMethod = (form) => {',
                '      const method = String((form && (form.getAttribute("method") || form.method)) || "get").trim().toLowerCase();',
                '      return method === "" || method === "get";',
                '    };',
                '    const sanitizeFormBeforeSubmit = (form) => {',
                '      if (!form || form.tagName !== "FORM") return { blocked: false };',
                '      sanitizeAttribute(form, "action");',
                '      if (isBlockedGetMethod(form)) {',
                '        return { blocked: true, reason: "Blocked GET form submission by Forge runtime guard." };',
                '      }',
                '      return { blocked: false };',
                '    };',
                '    const sanitizeNode = (node) => {',
                '      if (!node || node.nodeType !== 1) return;',
                '      if (node.matches && node.matches("a[href]")) sanitizeAttribute(node, "href");',
                '      if (node.matches && node.matches("base[href]")) sanitizeAttribute(node, "href");',
                '      if (node.matches && node.matches("form[action]")) sanitizeAttribute(node, "action");',
                '      if (node.matches && node.matches("meta[http-equiv][content]")) sanitizeAttribute(node, "content");',
                '      if (node.matches && node.matches("iframe[src], frame[src], embed[src]")) sanitizeAttribute(node, "src");',
                '      if (node.matches && node.matches("object[data]")) sanitizeAttribute(node, "data");',
                '      if (node.matches && node.matches("iframe[srcdoc], frame[srcdoc]")) sanitizeAttribute(node, "srcdoc");',
                '      if (node.querySelectorAll) {',
                '        node.querySelectorAll("a[href]").forEach((a) => sanitizeAttribute(a, "href"));',
                '        node.querySelectorAll("base[href]").forEach((b) => sanitizeAttribute(b, "href"));',
                '        node.querySelectorAll("form[action]").forEach((f) => sanitizeAttribute(f, "action"));',
                '        node.querySelectorAll("meta[http-equiv][content]").forEach((m) => sanitizeAttribute(m, "content"));',
                '        node.querySelectorAll("iframe[src], frame[src], embed[src]").forEach((el) => sanitizeAttribute(el, "src"));',
                '        node.querySelectorAll("object[data]").forEach((o) => sanitizeAttribute(o, "data"));',
                '        node.querySelectorAll("iframe[srcdoc], frame[srcdoc]").forEach((el) => sanitizeAttribute(el, "srcdoc"));',
                '      }',
                '    };',
                '    sanitizeNode(document.documentElement || document);',
                '    const open0 = window.open;',
                '    __forgeOpen0 = open0;',
                '    if (typeof open0 === "function") {',
                '      window.open = function () {',
                '        return open0.apply(this, arguments);',
                '      };',
                '    }',
                '    try {',
                '      const lp = window.Location && window.Location.prototype;',
                '      if (lp && typeof lp.assign === "function") {',
                '        const assign0 = lp.assign;',
                '        lp.assign = function (url) {',
                '          const baseHref = this && this.href ? this.href : location.href;',
                '          const safeUrl = sanitizeNavigationUrl(url, baseHref, "location");',
                '          if (safeUrl === CURRENT_DOC_URL) maybeRouteExternalViaParent(url, baseHref);',
                '          return assign0.call(this, safeUrl);',
                '        };',
                '      }',
                '      if (lp && typeof lp.replace === "function") {',
                '        const replace0 = lp.replace;',
                '        lp.replace = function (url) {',
                '          const baseHref = this && this.href ? this.href : location.href;',
                '          const safeUrl = sanitizeNavigationUrl(url, baseHref, "location");',
                '          if (safeUrl === CURRENT_DOC_URL) maybeRouteExternalViaParent(url, baseHref);',
                '          return replace0.call(this, safeUrl);',
                '        };',
                '      }',
                '      const hrefDesc = lp ? Object.getOwnPropertyDescriptor(lp, "href") : null;',
                '      if (hrefDesc && typeof hrefDesc.set === "function" && typeof hrefDesc.get === "function") {',
                '        Object.defineProperty(lp, "href", {',
                '          configurable: true,',
                '          enumerable: hrefDesc.enumerable,',
                '          get: function () { return hrefDesc.get.call(this); },',
                '          set: function (value) {',
                '            const baseHref = this && this.href ? this.href : location.href;',
                '            const safeUrl = sanitizeNavigationUrl(value, baseHref, "location");',
                '            if (safeUrl === CURRENT_DOC_URL) maybeRouteExternalViaParent(value, baseHref);',
                '            return hrefDesc.set.call(this, safeUrl);',
                '          }',
                '        });',
                '      }',
                '    } catch (e) {}',
                '    if (history && typeof history.pushState === "function") {',
                '      const push0 = history.pushState.bind(history);',
                '      history.pushState = function (state, title, url) {',
                '        const safeUrl = (typeof url === "string" && url.length) ? sanitizeNavigationUrl(url, location.href, "history") : url;',
                '        return push0(state, title, safeUrl);',
                '      };',
                '    }',
                '    if (history && typeof history.replaceState === "function") {',
                '      const replaceState0 = history.replaceState.bind(history);',
                '      history.replaceState = function (state, title, url) {',
                '        const safeUrl = (typeof url === "string" && url.length) ? sanitizeNavigationUrl(url, location.href, "history") : url;',
                '        return replaceState0(state, title, safeUrl);',
                '      };',
                '    }',
                '    document.addEventListener("click", (event) => {',
                '      const target = event.target && event.target.closest ? event.target.closest("a[href]") : null;',
                '      if (target) {',
                '        const rawHref = target.getAttribute("href") || "";',
                '        if (isDownloadBypassHref(target, rawHref)) return;',
                '        sanitizeAttribute(target, "href");',
                '      }',
                '    }, true);',
                '    document.addEventListener("submit", (event) => {',
                '      const form = event.target;',
                '      if (!form || !form.matches || !form.matches("form")) return;',
                '      const result = sanitizeFormBeforeSubmit(form);',
                '      if (result.blocked) {',
                '        event.preventDefault();',
                '        event.stopImmediatePropagation();',
                '        console.warn(result.reason);',
                '      }',
                '    }, true);',
                '    const fp = window.HTMLFormElement && window.HTMLFormElement.prototype;',
                '    if (fp && typeof fp.submit === "function") {',
                '      const submit0 = fp.submit;',
                '      fp.submit = function () {',
                '        const result = sanitizeFormBeforeSubmit(this);',
                '        if (result.blocked) {',
                '          console.warn(result.reason);',
                '          return;',
                '        }',
                '        return submit0.call(this);',
                '      };',
                '    }',
                '    if (fp && typeof fp.requestSubmit === "function") {',
                '      const requestSubmit0 = fp.requestSubmit;',
                '      fp.requestSubmit = function (submitter) {',
                '        const result = sanitizeFormBeforeSubmit(this);',
                '        if (result.blocked) {',
                '          console.warn(result.reason);',
                '          return;',
                '        }',
                '        return requestSubmit0.call(this, submitter);',
                '      };',
                '    }',
                '    const observer = new MutationObserver((mutations) => {',
                '      for (const mutation of mutations) {',
                '        if (mutation.type === "childList") {',
                '          mutation.addedNodes.forEach((node) => sanitizeNode(node));',
                '          continue;',
                '        }',
                '        if (mutation.type === "attributes") sanitizeNode(mutation.target);',
                '      }',
                '    });',
                '    observer.observe(document.documentElement || document, {',
                '      subtree: true,',
                '      childList: true,',
                '      attributes: true,',
                '      attributeFilter: ["href", "action", "method", "src", "data", "srcdoc", "content", "http-equiv"]',
                '    });',
                '  } catch (error) {',
                '    console.warn("Forge query param guard init failed:", error);',
                '  }',
                '})();'
            ].join('');
        };

        const insertIntoHead = (htmlText, injected) => {
            const source = String(htmlText || '');
            const headMatch = source.match(/<head\b[^>]*>/i);
            if (headMatch && typeof headMatch.index === 'number') {
                const insertAt = headMatch.index + headMatch[0].length;
                return `${source.slice(0, insertAt)}\n${injected}${source.slice(insertAt)}`;
            }
            const htmlMatch = source.match(/<html\b[^>]*>/i);
            if (htmlMatch && typeof htmlMatch.index === 'number') {
                const insertAt = htmlMatch.index + htmlMatch[0].length;
                return `${source.slice(0, insertAt)}\n<head>\n${injected}\n</head>${source.slice(insertAt)}`;
            }
            const bodyMatch = source.match(/<body\b[^>]*>/i);
            if (bodyMatch && typeof bodyMatch.index === 'number') {
                return `<head>\n${injected}\n</head>\n${source}`;
            }
            return `<head>\n${injected}\n</head>\n${source}`;
        };

        // Add security headers to prevent network connections for offline security
	        const addSecurityMeta = (htmlLines) => {
	            const source = Array.isArray(htmlLines) ? htmlLines.join('\n') : String(htmlLines || '');
            const cspContent = buildCspContent();
            const linkHintGuardScript = buildLinkHintGuardScript();
            const queryParamGuardScript = buildQueryParamGuardScript();
            const includeQueryParamGuard = true;
	            const securityMetas = [
                useSharePointCompatMode
                    ? '    <!-- Security: SharePoint compatibility mode enabled (connect-src includes self + configured SharePoint origin) -->'
                    : (connectSrcAllowlist.length
                        ? '    <!-- Security: Restrict outbound network connections to explicit connect-src allowlist -->'
	                        : '    <!-- Security: Prevent outbound network connections -->'),
	                `    <meta http-equiv="Content-Security-Policy" content="${cspContent}">`,
	                '    <meta http-equiv="x-dns-prefetch-control" content="off">',
	                '    <meta http-equiv="X-Content-Type-Options" content="nosniff">',
	                '    <meta http-equiv="X-XSS-Protection" content="1; mode=block">',
	                '    <meta http-equiv="Referrer-Policy" content="no-referrer">',
	                '    <meta http-equiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), ambient-light-sensor=(), autoplay=(), encrypted-media=(), fullscreen=(), picture-in-picture=(), screen-wake-lock=()">',
	                `    ${buildInlineScriptTag(linkHintGuardScript)}`,
	                ''
	            ];
	            if (includeQueryParamGuard) {
	                securityMetas.splice(securityMetas.length - 2, 0, `    ${buildInlineScriptTag(queryParamGuardScript)}`);
	            }

	            return insertIntoHead(source, securityMetas.join('\n'));
        };

        const encodeUtf8B64 = (str) => {
            try {
                return btoa(unescape(encodeURIComponent(str)));
            } catch {
                return btoa(str);
            }
        };

        const buildWasmAssetRuntimeScript = () => {
            const payloadB64 = encodeUtf8B64(JSON.stringify(wasmAssets));
            return [
                '(function(){',
                '  try {',
                '    if (window.__FORGE_WASM_ASSET_RUNTIME__) return;',
                '    window.__FORGE_WASM_ASSET_RUNTIME__ = true;',
                `    const WASM_ASSETS_JSON_B64 = ${JSON.stringify(payloadB64)};`,
                '    const decodeUtf8B64 = (b64) => decodeURIComponent(escape(atob(String(b64 || ""))));',
                '    const assets = JSON.parse(decodeUtf8B64(WASM_ASSETS_JSON_B64));',
                '    const assetByKey = new Map();',
                '    const stripQueryHash = (value) => String(value || "").split(/[?#]/)[0];',
                '    const normalizePath = (value) => stripQueryHash(value).replace(/\\\\/g, "/").replace(/^\\.\\/+/, "").replace(/^\\/+/, "").replace(/\\/+/g, "/");',
                '    const basename = (value) => { const clean = normalizePath(value); const idx = clean.lastIndexOf("/"); return idx === -1 ? clean : clean.slice(idx + 1); };',
                '    const addAssetKey = (key, asset) => { const normalized = normalizePath(key); if (normalized && !assetByKey.has(normalized)) assetByKey.set(normalized, asset); };',
                '    for (const asset of assets) {',
                '      addAssetKey(asset.path, asset);',
                '      addAssetKey(asset.name, asset);',
                '      addAssetKey(basename(asset.path), asset);',
                '    }',
                '    const findAsset = (input) => {',
                '      const candidates = [];',
                '      const push = (value) => {',
                '        const raw = String(value || "");',
                '        if (!raw) return;',
                '        candidates.push(raw);',
                '        candidates.push(normalizePath(raw));',
                '        candidates.push(basename(raw));',
                '        try {',
                '          const parsed = new URL(raw, document.baseURI || location.href);',
                '          candidates.push(parsed.pathname);',
                '          candidates.push(normalizePath(parsed.pathname));',
                '          candidates.push(basename(parsed.pathname));',
                '        } catch {}',
                '      };',
                '      if (typeof Request !== "undefined" && input instanceof Request) push(input.url);',
                '      else if (input && typeof input === "object" && typeof input.url === "string") push(input.url);',
                '      else push(input);',
                '      for (const candidate of candidates) {',
                '        const normalizedCandidate = normalizePath(candidate);',
                '        const asset = assetByKey.get(normalizedCandidate);',
                '        if (asset) return asset;',
                '        for (const [key, keyedAsset] of assetByKey.entries()) {',
                '          if ((normalizedCandidate && key && normalizedCandidate.endsWith("/" + key)) || (normalizedCandidate && key && key.endsWith("/" + normalizedCandidate))) return keyedAsset;',
                '        }',
                '      }',
                '      return null;',
                '    };',
                '    const bytesFromAsset = (asset) => {',
                '      const raw = atob(String(asset && asset.b64 || ""));',
                '      const bytes = new Uint8Array(raw.length);',
                '      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);',
                '      return bytes;',
                '    };',
                '    const responseFromAsset = (asset) => new Response(bytesFromAsset(asset), {',
                '      status: 200,',
                '      headers: { "Content-Type": "application/wasm", "Content-Length": String(atob(String(asset.b64 || "")).length) }',
                '    });',
                '    window.__FORGE_WASM_ASSETS__ = assets.map((asset) => ({ name: asset.name, path: asset.path }));',
                '    const originalFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;',
                '    window.fetch = function(input, init) {',
                '      const asset = findAsset(input);',
                '      if (asset) return Promise.resolve(responseFromAsset(asset));',
                '      if (originalFetch) return originalFetch(input, init);',
                '      return Promise.reject(new TypeError("fetch is unavailable in this browser"));',
                '    };',
                '    if (typeof WebAssembly === "object" && WebAssembly) {',
                '      const originalCompileStreaming = WebAssembly.compileStreaming;',
                '      if (typeof originalCompileStreaming === "function") {',
                '        WebAssembly.compileStreaming = function(source) {',
                '          const asset = findAsset(source);',
                '          if (asset) return WebAssembly.compile(bytesFromAsset(asset));',
                '          return originalCompileStreaming.call(WebAssembly, source);',
                '        };',
                '      }',
                '      const originalInstantiateStreaming = WebAssembly.instantiateStreaming;',
                '      if (typeof originalInstantiateStreaming === "function") {',
                '        WebAssembly.instantiateStreaming = function(source, imports) {',
                '          const asset = findAsset(source);',
                '          if (asset) return WebAssembly.instantiate(bytesFromAsset(asset), imports);',
                '          return originalInstantiateStreaming.call(WebAssembly, source, imports);',
                '        };',
                '      }',
                '    }',
                '  } catch (error) {',
                '    console.warn("Forge WASM asset runtime failed:", error);',
                '  }',
                '})();'
            ].join('');
        };
        const bridgeToken = `forge-bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

        const buildChildBridgeBootstrapScript = () => {
            return [
                '(function(){',
                '  try {',
                '    const pending = new Map();',
                '    let seq = 0;',
	                '    const BRIDGE_NS = "__forgeBridgeReq";',
	                '    const RESP_NS = "__forgeBridgeResp";',
	                `    const BRIDGE_TOKEN = ${JSON.stringify(bridgeToken)};`,
	                `    const NETWORK_PERMISSION_GUARD = ${connectSrcAllowlist.length ? 'true' : 'false'};`,
	                `    const NETWORK_ALLOWLIST = ${JSON.stringify(connectSrcAllowlist)};`,
	                `    const CDN_QUERY_BLOCK_PATTERNS = ${JSON.stringify(cdnConnectSrcAllowlist)};`,
	                `    const SHAREPOINT_ORIGIN = ${JSON.stringify(useSharePointCompatMode ? sharePointOrigin : '')};`,
	                `    const SHAREPOINT_SITE_URL = ${JSON.stringify(useSharePointCompatMode ? sharePointSiteUrl : '')};`,
	                `    const SHAREPOINT_PARENT_PROXY = ${useSharePointCompatMode ? 'true' : 'false'};`,
	                `    const CONFLUENCE_PARENT_PROXY = ${useFusionBridgeMode ? 'true' : 'false'};`,
	                '    let networkPermissionState = NETWORK_PERMISSION_GUARD ? "unknown" : "granted";',
	                '    let networkPermissionPromise = null;',
	                '    let runtimeWarningHideTimer = null;',
	                '    let runtimeWarningFadeTimer = null;',
	                '    let runtimeWarningLastKey = "";',
	                '    let runtimeWarningLastAt = 0;',
	                '    const copyRuntimeWarningText = async (text) => {',
	                '      const value = String(text || "");',
	                '      if (!value) return false;',
	                '      try {',
	                '        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {',
	                '          await navigator.clipboard.writeText(value);',
	                '          return true;',
	                '        }',
	                '      } catch {}',
	                '      try {',
	                '        const ta = document.createElement("textarea");',
	                '        ta.value = value;',
	                '        ta.setAttribute("readonly", "readonly");',
	                '        ta.style.position = "fixed";',
	                '        ta.style.opacity = "0";',
	                '        ta.style.pointerEvents = "none";',
	                '        (document.body || document.documentElement).appendChild(ta);',
	                '        ta.focus();',
	                '        ta.select();',
	                '        const ok = document.execCommand("copy");',
	                '        ta.remove();',
	                '        return !!ok;',
	                '      } catch {}',
	                '      return false;',
	                '    };',
	                '    const createRuntimeWarningHost = () => {',
	                '      let host = document.getElementById("forge-runtime-network-warning");',
	                '      if (host) return host;',
	                '      host = document.createElement("div");',
	                '      host.id = "forge-runtime-network-warning";',
	                '      host.setAttribute("role", "alert");',
	                '      host.setAttribute("aria-live", "polite");',
	                '      host.style.position = "fixed";',
	                '      host.style.top = "12px";',
	                '      host.style.right = "12px";',
	                '      host.style.width = "min(360px, calc(100vw - 24px))";',
	                '      host.style.maxWidth = "calc(100vw - 24px)";',
	                '      host.style.zIndex = "2147483647";',
	                '      host.style.pointerEvents = "auto";',
	                '      host.style.fontFamily = "system-ui, sans-serif";',
	                '      host.style.background = "linear-gradient(180deg, #b91c1c 0%, #7f1d1d 100%)";',
	                '      host.style.color = "#ffffff";',
	                '      host.style.border = "1px solid rgba(255,255,255,0.16)";',
	                '      host.style.borderRadius = "12px";',
	                '      host.style.boxShadow = "0 16px 40px rgba(0,0,0,0.32)";',
	                '      host.style.padding = "12px";',
	                '      host.style.fontSize = "12px";',
	                '      host.style.lineHeight = "1.35";',
	                '      host.style.opacity = "0";',
	                '      host.style.transform = "translateY(-8px)";',
	                '      host.style.transition = "opacity 180ms ease, transform 180ms ease";',
	                '      host.style.display = "grid";',
	                '      host.style.gap = "8px";',
	                '      const title = document.createElement("div");',
	                '      title.textContent = "Network request blocked";',
	                '      title.style.fontSize = "12px";',
	                '      title.style.fontWeight = "700";',
	                '      title.style.letterSpacing = "0.01em";',
	                '      const message = document.createElement("div");',
	                '      message.style.fontSize = "12px";',
	                '      message.style.wordBreak = "break-word";',
	                '      const actions = document.createElement("div");',
	                '      actions.style.display = "flex";',
	                '      actions.style.alignItems = "center";',
	                '      actions.style.justifyContent = "space-between";',
	                '      actions.style.gap = "8px";',
	                '      const hint = document.createElement("div");',
	                '      hint.textContent = "Copied request details are safe to paste into a bug report.";',
	                '      hint.style.fontSize = "11px";',
	                '      hint.style.color = "rgba(255,255,255,0.82)";',
	                '      hint.style.flex = "1 1 auto";',
	                '      const button = document.createElement("button");',
	                '      button.type = "button";',
	                '      button.textContent = "Copy details";',
	                '      button.style.border = "1px solid rgba(255,255,255,0.2)";',
	                '      button.style.background = "rgba(255,255,255,0.14)";',
	                '      button.style.color = "#ffffff";',
	                '      button.style.borderRadius = "999px";',
	                '      button.style.padding = "6px 10px";',
	                '      button.style.font = "inherit";',
	                '      button.style.fontWeight = "700";',
	                '      button.style.cursor = "pointer";',
	                '      button.style.whiteSpace = "nowrap";',
	                '      button.addEventListener("click", async () => {',
	                '        const payload = host.__forgeWarningCopyText || "";',
	                '        const original = button.textContent;',
	                '        const ok = await copyRuntimeWarningText(payload);',
	                '        button.textContent = ok ? "Copied" : "Copy failed";',
	                '        setTimeout(() => { button.textContent = original; }, 1200);',
	                '      });',
	                '      actions.appendChild(hint);',
	                '      actions.appendChild(button);',
	                '      host.appendChild(title);',
	                '      host.appendChild(message);',
	                '      host.appendChild(actions);',
	                '      host.__forgeWarningMessageEl = message;',
	                '      host.__forgeWarningButtonEl = button;',
	                '      const mount = document.body || document.documentElement;',
	                '      if (mount) mount.appendChild(host);',
	                '      return host;',
	                '    };',
	                '    const hideRuntimeWarning = () => {',
	                '      const host = document.getElementById("forge-runtime-network-warning");',
	                '      if (!host) return;',
	                '      host.style.opacity = "0";',
	                '      host.style.transform = "translateY(-8px)";',
	                '      setTimeout(() => {',
	                '        const current = document.getElementById("forge-runtime-network-warning");',
	                '        if (current && current.style.opacity === "0") current.hidden = true;',
	                '      }, 220);',
	                '    };',
	                '    const dispatchRuntimeNetworkWarning = (detail) => {',
	                '      try {',
	                '        const kind = String((detail && detail.kind) || "request");',
	                '        const reason = String((detail && detail.reason) || "Blocked outbound request by Forge runtime guard.");',
	                '        const rawUrl = String((detail && detail.url) || "").trim();',
	                '        let target = rawUrl;',
	                '        try {',
	                '          const parsed = new URL(rawUrl, document.baseURI || location.href);',
	                '          if (parsed.origin && parsed.origin !== "null") target = parsed.origin;',
	                '        } catch {}',
	                '        const message = "Blocked outbound " + kind + (target ? (" to " + target) : "") + ". " + reason;',
	                '        const dedupeKey = kind + "|" + target + "|" + reason;',
	                '        const now = Date.now();',
	                '        if (runtimeWarningLastKey === dedupeKey && (now - runtimeWarningLastAt) < 2500) return;',
	                '        runtimeWarningLastKey = dedupeKey;',
	                '        runtimeWarningLastAt = now;',
	                '        const host = createRuntimeWarningHost();',
	                '        if (host) {',
	                '          const copyLines = [',
	                '            "Forge blocked a network request.",',
	                '            "Kind: " + kind,',
	                '            "URL: " + (rawUrl || "(empty)"),',
	                '            "Reason: " + reason,',
	                '            "Time: " + new Date(now).toISOString()',
	                '          ];',
	                '          host.__forgeWarningCopyText = copyLines.join("\\n");',
	                '          if (host.__forgeWarningMessageEl) host.__forgeWarningMessageEl.textContent = target ? (target + " - " + reason) : reason;',
	                '          host.hidden = false;',
	                '          host.style.opacity = "1";',
	                '          host.style.transform = "translateY(0)";',
	                '        }',
	                '        if (runtimeWarningHideTimer) clearTimeout(runtimeWarningHideTimer);',
	                '        if (runtimeWarningFadeTimer) clearTimeout(runtimeWarningFadeTimer);',
	                '        runtimeWarningHideTimer = setTimeout(() => {',
	                '          hideRuntimeWarning();',
	                '        }, 2600);',
	                '        runtimeWarningFadeTimer = setTimeout(() => {',
	                '          const current = document.getElementById("forge-runtime-network-warning");',
	                '          if (current && current.style.opacity === "0") current.hidden = true;',
	                '        }, 2900);',
	                '        try {',
	                '          window.dispatchEvent(new CustomEvent("forge:network-warning", { detail: { kind, url: rawUrl, reason, message, blocked: true, timestamp: now } }));',
	                '        } catch {}',
	                '        try { console.warn(message); } catch {}',
	                '      } catch {}',
	                '    };',
	                '    const makeBlockedNetworkError = (kind, url, reason) => {',
	                '      dispatchRuntimeNetworkWarning({ kind, url, reason });',
	                '      return new Error(reason);',
	                '    };',
                '    const callParent = (action, payload) => {',
                '      const id = ++seq;',
                '      return new Promise((resolve, reject) => {',
                '        pending.set(id, { resolve, reject });',
                '        parent.postMessage({ [BRIDGE_NS]: true, token: BRIDGE_TOKEN, id, action, payload }, "*");',
                '        setTimeout(() => {',
                '          if (!pending.has(id)) return;',
                '          pending.delete(id);',
                '          reject(new Error("Bridge timeout for " + action));',
                '        }, 120000);',
                '      });',
                '    };',
                '    window.addEventListener("message", (event) => {',
                '      const msg = event && event.data ? event.data : null;',
                '      if (!msg || !msg[RESP_NS] || msg.token !== BRIDGE_TOKEN) return;',
                '      const slot = pending.get(msg.id);',
                '      if (!slot) return;',
                '      pending.delete(msg.id);',
                '      if (msg.ok) slot.resolve(msg.result);',
                '      else {',
                '        const err = new Error((msg && msg.error) ? msg.error : "Bridge call failed");',
                '        if (msg && msg.errorName) err.name = msg.errorName;',
                '        slot.reject(err);',
                '      }',
                '    });',
                '    const STORAGE_SEED = (window.__Forge_STORAGE_SEED__ && typeof window.__Forge_STORAGE_SEED__ === "object") ? window.__Forge_STORAGE_SEED__ : { local: {}, session: {} };',
                '    const makeStorageShim = (scope) => {',
                '      const seed = STORAGE_SEED && STORAGE_SEED[scope] && typeof STORAGE_SEED[scope] === "object" ? STORAGE_SEED[scope] : {};',
                '      const map = new Map();',
                '      Object.keys(seed).forEach((key) => {',
                '        const value = seed[key];',
                '        map.set(String(key), value == null ? "" : String(value));',
                '      });',
                '      const persist = (op, key, value) => {',
                '        callParent("storage_mutate", { scope, op, key, value }).catch(() => {});',
                '      };',
                '      const shim = {',
                '        getItem: (key) => {',
                '          const normalized = String(key);',
                '          return map.has(normalized) ? map.get(normalized) : null;',
                '        },',
                '        setItem: (key, value) => {',
                '          const normalized = String(key);',
                '          const nextValue = value == null ? "" : String(value);',
                '          map.set(normalized, nextValue);',
                '          persist("set", normalized, nextValue);',
                '        },',
                '        removeItem: (key) => {',
                '          const normalized = String(key);',
                '          map.delete(normalized);',
                '          persist("remove", normalized, null);',
                '        },',
                '        clear: () => {',
                '          map.clear();',
                '          persist("clear", null, null);',
                '        },',
                '        key: (index) => {',
                '          const i = Number(index);',
                '          if (!Number.isInteger(i) || i < 0 || i >= map.size) return null;',
                '          return Array.from(map.keys())[i] || null;',
                '        }',
                '      };',
                '      Object.defineProperty(shim, "length", { enumerable: true, configurable: false, get: () => map.size });',
                '      return shim;',
                '    };',
                '    const installStorageShim = (name, scope) => {',
                '      const shim = makeStorageShim(scope);',
                '      if (scope === "local") window.__Forge_LOCAL_STORAGE__ = shim;',
                '      else window.__Forge_SESSION_STORAGE__ = shim;',
                '      let installed = false;',
                '      try {',
                '        Object.defineProperty(window, name, { configurable: true, enumerable: true, get: () => shim });',
                '        installed = true;',
                '      } catch {}',
                '      if (!installed) {',
                '        try {',
                '          Object.defineProperty(Window.prototype, name, { configurable: true, enumerable: true, get: () => shim });',
                '          installed = true;',
                '        } catch {}',
                '      }',
                '      if (!installed && typeof window.__defineGetter__ === "function") {',
                '        try {',
                '          window.__defineGetter__(name, () => shim);',
                '          installed = true;',
                '        } catch {}',
                '      }',
                '      return shim;',
                '    };',
	                '    installStorageShim("localStorage", "local");',
	                '    installStorageShim("sessionStorage", "session");',
	                '    const seedSharePointContext = () => {',
	                '      try {',
	                '        const existing = (window._spPageContextInfo && typeof window._spPageContextInfo === "object") ? window._spPageContextInfo : {};',
	                '        let candidate = null;',
	                '        try {',
	                '          if (window.parent && window.parent !== window && window.parent._spPageContextInfo && typeof window.parent._spPageContextInfo === "object") {',
	                '            candidate = window.parent._spPageContextInfo;',
	                '          }',
	                '        } catch {}',
	                '        if (!candidate && SHAREPOINT_SITE_URL) {',
	                '          candidate = { webAbsoluteUrl: SHAREPOINT_SITE_URL, siteAbsoluteUrl: SHAREPOINT_SITE_URL };',
	                '        }',
	                '        if (!candidate) return;',
	                '        const merged = Object.assign({}, existing, candidate);',
	                '        if (!merged.webAbsoluteUrl && SHAREPOINT_SITE_URL) merged.webAbsoluteUrl = SHAREPOINT_SITE_URL;',
	                '        if (!merged.siteAbsoluteUrl && SHAREPOINT_SITE_URL) merged.siteAbsoluteUrl = SHAREPOINT_SITE_URL;',
	                '        window._spPageContextInfo = merged;',
	                '        try { window.eval("var _spPageContextInfo = window._spPageContextInfo;"); } catch {}',
	                '      } catch {}',
	                '    };',
	                '    seedSharePointContext();',
	                '    callParent("get_sharepoint_context", {}).then((ctx) => {',
	                '      if (!ctx || typeof ctx !== "object") return;',
	                '      try {',
	                '        const merged = Object.assign({}, (window._spPageContextInfo && typeof window._spPageContextInfo === "object") ? window._spPageContextInfo : {}, ctx);',
	                '        if (!merged.webAbsoluteUrl && SHAREPOINT_SITE_URL) merged.webAbsoluteUrl = SHAREPOINT_SITE_URL;',
	                '        if (!merged.siteAbsoluteUrl && SHAREPOINT_SITE_URL) merged.siteAbsoluteUrl = SHAREPOINT_SITE_URL;',
	                '        window._spPageContextInfo = merged;',
	                '        try { window.eval("var _spPageContextInfo = window._spPageContextInfo;"); } catch {}',
	                '      } catch {}',
	                '    }).catch(() => {});',
	                '    try { delete window.__Forge_STORAGE_SEED__; } catch {}',
                '    const normalizePattern = (value) => String(value || "").trim().toLowerCase().replace(/\\/$/, "");',
                '    const getConfluenceBridgeBaseUrl = () => {',
                '      if (!CONFLUENCE_PARENT_PROXY) return "";',
                '      try {',
                '        const ctx = window.__Forge_CONFLUENCE_CONTEXT__;',
                '        if (ctx && typeof ctx.baseUrl === "string" && ctx.baseUrl) return ctx.baseUrl;',
                '      } catch {}',
                '      try {',
                '        const meta = document.querySelector(\'meta[name="ajs-base-url"], meta[id="ajs-base-url"]\');',
                '        const value = meta ? (meta.getAttribute("content") || meta.getAttribute("value") || "") : "";',
                '        if (value) return value;',
                '      } catch {}',
                '      return "";',
                '    };',
                '    const installConfluenceApiShims = () => {',
                '      if (!CONFLUENCE_PARENT_PROXY) return;',
                '      const getCtx = () => {',
                '        try { return window.__Forge_CONFLUENCE_CONTEXT__ || {}; } catch { return {}; }',
                '      };',
                '      const getMetaValue = (name) => {',
                '        const ctx = getCtx();',
                '        const key = String(name || "");',
                '        const map = {',
                '          "ajs-page-id": ctx.pageId || ctx.contentId || "",',
                '          "ajs-content-id": ctx.contentId || ctx.pageId || "",',
                '          "ajs-base-url": ctx.baseUrl || getConfluenceBridgeBaseUrl(),',
                '          "ajs-remote-user": ctx.username || "",',
                '          "ajs-current-user-fullname": ctx.username || "",',
                '          "ajs-remote-user-key": ctx.userKey || "",',
                '          "ajs-atl-token": ctx.token || "",',
                '          "atlassian-token": ctx.token || ""',
                '        };',
                '        return map[key] || "";',
                '      };',
                '      try {',
                '        const existingAjs = window.AJS && typeof window.AJS === "object" ? window.AJS : {};',
                '        const existingMeta = existingAjs.Meta && typeof existingAjs.Meta === "object" ? existingAjs.Meta : {};',
                '        existingAjs.Meta = Object.assign({}, existingMeta, { get: function(name) { return getMetaValue(name); } });',
                '        window.AJS = existingAjs;',
                '      } catch {}',
                '      const requestViaFetch = async (request) => {',
                '        const opts = typeof request === "string" ? { url: request } : Object.assign({}, request || {});',
                '        const url = String(opts.url || opts.uri || "").trim();',
                '        if (!url) throw new Error("AP.request missing url.");',
                '        const baseUrl = getConfluenceBridgeBaseUrl();',
                '        const resolved = /^https?:\\/\\//i.test(url) ? url : ((baseUrl || "") + (url.charAt(0) === "/" ? url : "/" + url));',
                '        const method = String(opts.method || opts.type || "GET").toUpperCase();',
                '        const headers = Object.assign({}, opts.headers || {});',
                '        if (opts.contentType && !headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = opts.contentType;',
                '        if (!headers.Accept && !headers.accept) headers.Accept = "application/json";',
                '        const init = { method: method, credentials: "same-origin", headers: headers };',
                '        if (opts.data != null && method !== "GET" && method !== "HEAD") init.body = typeof opts.data === "string" ? opts.data : JSON.stringify(opts.data);',
                '        const response = await window.fetch(resolved, init);',
                '        const text = await response.text();',
                '        if (!response.ok) {',
                '          const err = new Error("Confluence request failed with HTTP " + response.status + ".");',
                '          err.status = response.status;',
                '          err.responseText = text;',
                '          throw err;',
                '        }',
                '        return text;',
                '      };',
                '      const ap = window.AP && typeof window.AP === "object" ? window.AP : {};',
                '      ap.request = function(options) {',
                '        const promise = requestViaFetch(options);',
                '        promise.then(function(text) {',
                '          if (options && typeof options.success === "function") options.success(text);',
                '        }).catch(function(error) {',
                '          if (options && typeof options.error === "function") options.error(error);',
                '        });',
                '        return promise;',
                '      };',
                '      window.AP = ap;',
                '      try {',
                '        let currentAp = ap;',
                '        const requestShim = ap.request;',
                '        Object.defineProperty(window, "AP", {',
                '          configurable: true,',
                '          get: function() { return currentAp; },',
                '          set: function(next) {',
                '            currentAp = next && typeof next === "object" ? next : {};',
                '            currentAp.request = requestShim;',
                '          }',
                '        });',
                '      } catch {}',
                '    };',
                '    installConfluenceApiShims();',
                '    const originMatchesPattern = (origin, pattern) => {',
                '      const o = normalizePattern(origin);',
                '      const p = normalizePattern(pattern);',
                '      if (!o || !p) return false;',
                '      if (p === "\'self\'" || p === "self") {',
                '        if (CONFLUENCE_PARENT_PROXY) {',
                '          try {',
                '            const baseUrl = getConfluenceBridgeBaseUrl();',
                '            if (baseUrl && o === normalizePattern(new URL(baseUrl, location.href).origin)) return true;',
                '          } catch {}',
                '        }',
                '        try {',
                '          return o === normalizePattern(new URL(location.href).origin);',
                '        } catch {',
                '          return false;',
                '        }',
                '      }',
                '      if (o === p) return true;',
                '      let protocol = "";',
                '      let suffix = "";',
                '      if (p.startsWith("http://*.")) {',
                '        protocol = "http:";',
                '        suffix = p.slice("http://*.".length);',
                '      } else if (p.startsWith("https://*.")) {',
                '        protocol = "https:";',
                '        suffix = p.slice("https://*.".length);',
                '      } else {',
                '        return false;',
                '      }',
                '      try {',
                '        const parsedOrigin = new URL(o);',
                '        if (parsedOrigin.protocol !== protocol) return false;',
                '        const host = String(parsedOrigin.hostname || "").toLowerCase();',
                '        return !!suffix && host.length > suffix.length && host.endsWith("." + suffix);',
                '      } catch {',
                '        return false;',
                '      }',
                '    };',
	                '    const isAllowlistedOrigin = (origin) => {',
	                '      if (!NETWORK_ALLOWLIST.length) return false;',
	                '      return NETWORK_ALLOWLIST.some((pattern) => originMatchesPattern(origin, pattern));',
	                '    };',
	                '    const getNetworkUrlPolicy = (value) => {',
	                '      const policy = { normalized: "", blockedReason: "" };',
	                '      if (value == null) return policy;',
	                '      try {',
	                '        const parsed = new URL(String(value), document.baseURI || location.href);',
	                '        const protocol = String(parsed.protocol || "").toLowerCase();',
	                '        if (!["http:","https:","ws:","wss:"].includes(protocol)) return policy;',
	                '        const origin = parsed.origin;',
	                '        if (NETWORK_PERMISSION_GUARD && !isAllowlistedOrigin(origin)) {',
	                '          policy.blockedReason = "Origin is not allowlisted in connect-src: " + origin;',
	                '          return policy;',
	                '        }',
	                '        const blocksCdnQuery = CDN_QUERY_BLOCK_PATTERNS.some((pattern) => originMatchesPattern(origin, pattern));',
	                '        if (blocksCdnQuery && (parsed.search || parsed.hash)) {',
	                '          policy.blockedReason = "Query params and fragments are blocked for allowlisted CDN origins: " + origin;',
	                '          return policy;',
	                '        }',
	                '        policy.normalized = parsed.toString();',
	                '        return policy;',
	                '      } catch {',
	                '        return policy;',
	                '      }',
	                '    };',
	                '    const isSharePointRequest = (value) => {',
	                '      if (!SHAREPOINT_ORIGIN) return false;',
	                '      const raw = String(value || "").trim();',
	                '      if (!raw) return false;',
	                '      try {',
	                '        const parsed = new URL(raw, document.baseURI || location.href);',
	                '        return normalizePattern(parsed.origin) === normalizePattern(SHAREPOINT_ORIGIN);',
	                '      } catch {',
	                '        return raw.startsWith("/");',
	                '      }',
	                '    };',
	                '    const canUseSharePointParentProxy = (value) => SHAREPOINT_PARENT_PROXY && isSharePointRequest(value);',
	                '    const isConfluenceRequest = (value) => {',
	                '      if (!CONFLUENCE_PARENT_PROXY) return false;',
	                '      const raw = String(value || "").trim();',
	                '      if (!raw) return false;',
	                '      const baseUrl = getConfluenceBridgeBaseUrl();',
	                '      if (!baseUrl) return raw.startsWith("/");',
	                '      try {',
	                '        const parsed = new URL(raw, baseUrl);',
	                '        const base = new URL(baseUrl, location.href);',
	                '        return normalizePattern(parsed.origin) === normalizePattern(base.origin);',
	                '      } catch {',
	                '        return raw.startsWith("/");',
	                '      }',
	                '    };',
	                '    const canUseConfluenceParentProxy = (value) => CONFLUENCE_PARENT_PROXY && isConfluenceRequest(value);',
	                '    const headersToEntries = (headersLike) => {',
	                '      try {',
	                '        if (!headersLike) return [];',
	                '        if (Array.isArray(headersLike)) return headersLike.filter((pair) => Array.isArray(pair) && pair.length >= 2).map((pair) => [String(pair[0]), String(pair[1])]);',
	                '        if (typeof Headers !== "undefined" && headersLike instanceof Headers) return Array.from(headersLike.entries());',
	                '        if (typeof headersLike === "object") return Object.entries(headersLike).map((pair) => [String(pair[0]), String(pair[1])]);',
	                '      } catch {}',
	                '      return [];',
	                '    };',
	                '    const mergeHeaderEntries = (...lists) => {',
	                '      const out = new Map();',
	                '      for (const list of lists) {',
	                '        for (const pair of list || []) {',
	                '          if (!Array.isArray(pair) || pair.length < 2) continue;',
	                '          const key = String(pair[0] || "");',
	                '          if (!key) continue;',
	                '          out.set(key.toLowerCase(), [key, String(pair[1] == null ? "" : pair[1])]);',
	                '        }',
	                '      }',
	                '      return Array.from(out.values());',
	                '    };',
	                '    const bodyToProxyText = async (body) => {',
	                '      if (body == null) return null;',
	                '      if (typeof body === "string") return body;',
	                '      if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();',
	                '      if (typeof FormData !== "undefined" && body instanceof FormData) {',
	                '        const params = new URLSearchParams();',
	                '        for (const pair of body.entries()) {',
	                '          const key = String(pair[0] || "");',
	                '          const value = pair[1];',
	                '          if (typeof value !== "string") throw new Error("Unsupported FormData value type for SharePoint proxy fetch.");',
	                '          params.append(key, value);',
	                '        }',
	                '        return params.toString();',
	                '      }',
	                '      if (typeof Blob !== "undefined" && body instanceof Blob) return await body.text();',
	                '      if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));',
	                '      if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(body)) {',
	                '        return new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));',
	                '      }',
	                '      return String(body);',
	                '    };',
	                '    const buildProxyFetchPayload = async (input, init, normalizedUrl) => {',
	                '      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();',
	                '      const inputHeaders = headersToEntries(input && input.headers ? input.headers : null);',
	                '      const initHeaders = headersToEntries(init && init.headers ? init.headers : null);',
	                '      const headers = mergeHeaderEntries(inputHeaders, initHeaders);',
	                '      const hasInitBody = !!(init && Object.prototype.hasOwnProperty.call(init, "body"));',
	                '      const bodySource = hasInitBody ? init.body : null;',
	                '      const bodyText = (method === "GET" || method === "HEAD") ? null : await bodyToProxyText(bodySource);',
	                '      const credentials = String((init && init.credentials) || (input && input.credentials) || "include");',
	                '      return { url: normalizedUrl, method, headers, bodyText, credentials };',
	                '    };',
	                '    const buildProxyFetchResponse = (result) => {',
	                '      const statusNum = Number(result && result.status);',
	                '      const status = Number.isFinite(statusNum) ? statusNum : 200;',
	                '      const headers = new Headers(Array.isArray(result && result.headers) ? result.headers : []);',
	                '      const bodyText = typeof (result && result.bodyText) === "string" ? result.bodyText : "";',
	                '      return new Response(bodyText, { status, statusText: String((result && result.statusText) || ""), headers });',
	                '    };',
	                '    const ensureNetworkPermission = async (kind, urlValue) => {',
	                '      if (isSharePointRequest(urlValue)) return true;',
	                '      if (isConfluenceRequest(urlValue)) return true;',
	                '      if (!NETWORK_PERMISSION_GUARD) return true;',
	                '      if (networkPermissionState === "granted") return true;',
	                '      if (networkPermissionState === "denied") throw makeBlockedNetworkError(kind, urlValue, "Outbound API permission denied by user.");',
                '      if (networkPermissionPromise) return await networkPermissionPromise;',
                '      const policy = getNetworkUrlPolicy(urlValue);',
                '      if (policy.blockedReason) throw makeBlockedNetworkError(kind, policy.normalized || urlValue, policy.blockedReason);',
                '      const url = policy.normalized;',
                '      networkPermissionPromise = callParent("request_network_permission", { kind, url })',
                '        .then(() => { networkPermissionState = "granted"; return true; })',
                '        .catch((error) => {',
                '          networkPermissionState = "denied";',
                '          const reason = error && error.message ? String(error.message) : "Outbound API permission denied by user.";',
                '          throw makeBlockedNetworkError(kind, url, reason);',
                '        })',
                '        .finally(() => { networkPermissionPromise = null; });',
                '      return await networkPermissionPromise;',
                '    };',
                '    const beginNetworkPermissionRequest = (kind, urlValue) => {',
                '      if (!NETWORK_PERMISSION_GUARD) return;',
                '      if (networkPermissionState !== "unknown") return;',
                '      if (networkPermissionPromise) return;',
                '      ensureNetworkPermission(kind, urlValue).catch(() => {});',
                '    };',
                '    window.__Forge_REQUEST_NETWORK_PERMISSION__ = () => ensureNetworkPermission("manual", "");',
                '    const makeWritableProxy = (writerId) => ({',
                '      write: async (data) => callParent("fs_writer_write", { writerId, data }),',
                '      seek: async (position) => callParent("fs_writer_seek", { writerId, position }),',
                '      truncate: async (size) => callParent("fs_writer_truncate", { writerId, size }),',
                '      close: async () => callParent("fs_writer_close", { writerId }),',
                '      abort: async () => callParent("fs_writer_abort", { writerId })',
                '    });',
                '    const materializeHandle = (desc) => {',
                '      if (!desc || !desc.kind || !desc.id) return null;',
                '      if (desc.kind === "file") {',
                '        return {',
                '          kind: "file",',
                '          name: desc.name || "",',
                '          __forgeHandleId: desc.id,',
                '          getFile: async () => callParent("fs_get_file", { id: desc.id }),',
                '          createWritable: async (options) => {',
                '            const r = await callParent("fs_create_writable", { id: desc.id, options });',
                '            return makeWritableProxy(r.writerId);',
                '          },',
                '          queryPermission: async (options) => callParent("fs_query_permission", { id: desc.id, options }),',
                '          requestPermission: async (options) => callParent("fs_request_permission", { id: desc.id, options }),',
                '          isSameEntry: async (other) => callParent("fs_is_same_entry", { id: desc.id, otherId: other && other.__forgeHandleId ? other.__forgeHandleId : null })',
                '        };',
                '      }',
                '      return {',
                '        kind: "directory",',
                '        name: desc.name || "",',
                '        __forgeHandleId: desc.id,',
                '        queryPermission: async (options) => callParent("fs_query_permission", { id: desc.id, options }),',
                '        requestPermission: async (options) => callParent("fs_request_permission", { id: desc.id, options }),',
                '        isSameEntry: async (other) => callParent("fs_is_same_entry", { id: desc.id, otherId: other && other.__forgeHandleId ? other.__forgeHandleId : null }),',
                '        getFileHandle: async (name, options) => materializeHandle(await callParent("fs_get_file_handle", { id: desc.id, name, options })),',
                '        getDirectoryHandle: async (name, options) => materializeHandle(await callParent("fs_get_directory_handle", { id: desc.id, name, options })),',
                '        removeEntry: async (name, options) => callParent("fs_remove_entry", { id: desc.id, name, options }),',
                '        resolve: async (possibleDescendant) => callParent("fs_resolve", { id: desc.id, otherId: possibleDescendant && possibleDescendant.__forgeHandleId ? possibleDescendant.__forgeHandleId : null }),',
                '        entries: async function* () {',
                '          const list = await callParent("fs_entries", { id: desc.id });',
                '          for (const item of list) {',
                '            yield [item.name, materializeHandle(item)];',
                '          }',
                '        },',
                '        values: async function* () {',
                '          const list = await callParent("fs_entries", { id: desc.id });',
                '          for (const item of list) {',
                '            yield materializeHandle(item);',
                '          }',
                '        },',
                '        keys: async function* () {',
                '          const list = await callParent("fs_entries", { id: desc.id });',
                '          for (const item of list) {',
                '            yield item.name;',
                '          }',
                '        },',
                '        [Symbol.asyncIterator]: async function* () {',
                '          const list = await callParent("fs_entries", { id: desc.id });',
                '          for (const item of list) {',
                '            yield [item.name, materializeHandle(item)];',
                '          }',
                '        }',
                '      };',
                '    };',
                '    const sanitizeAndOpen = (url, target, features) => {',
                '      callParent("open_url", { url, target, features }).catch(() => {});',
                '      return null;',
                '    };',
                '    window.open = function(url, target, features){',
                '      return sanitizeAndOpen(url, target, features);',
                '    };',
	                '    if (typeof window.fetch === "function") {',
	                '      const fetch0 = window.fetch.bind(window);',
	                '      window.fetch = async function(input, init){',
	                '        let candidate = "";',
	                '        try {',
	                '          if (typeof input === "string" || input instanceof URL) candidate = String(input);',
	                '          else if (input && typeof input.url === "string") candidate = input.url;',
	                '        } catch {}',
	                '        const policy = getNetworkUrlPolicy(candidate);',
	                '        if (policy.blockedReason) throw makeBlockedNetworkError("fetch", policy.normalized || candidate, policy.blockedReason);',
	                '        if (policy.normalized) await ensureNetworkPermission("fetch", policy.normalized);',
	                '        if (policy.normalized && (canUseSharePointParentProxy(policy.normalized) || canUseConfluenceParentProxy(policy.normalized))) {',
	                '          const payload = await buildProxyFetchPayload(input, init, policy.normalized);',
	                '          const proxyResult = await callParent("proxy_fetch", payload);',
	                '          return buildProxyFetchResponse(proxyResult);',
	                '        }',
	                '        return fetch0.apply(this, arguments);',
	                '      };',
	                '    }',
                '    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {',
                '      const xhrMeta = new WeakMap();',
                '      const proto = window.XMLHttpRequest.prototype;',
                '      const open0 = proto.open;',
                '      const send0 = proto.send;',
	                '      proto.open = function(method, url, async){',
	                '        const policy = getNetworkUrlPolicy(url);',
	                '        xhrMeta.set(this, { url: policy.normalized, rawUrl: String(url == null ? "" : url), blockedReason: policy.blockedReason, guarded: !!policy.normalized, async: async !== false });',
	                '        return open0.apply(this, arguments);',
	                '      };',
	                '      proto.send = function(body){',
	                '        const meta = xhrMeta.get(this);',
	                '        if (meta && meta.blockedReason) {',
	                '          const reasonErr = makeBlockedNetworkError("xmlhttprequest", meta.url || meta.rawUrl, meta.blockedReason);',
	                '          try { if (typeof this.onerror === "function") this.onerror(reasonErr); } catch {}',
	                '          try { this.dispatchEvent(new Event("error")); } catch {}',
	                '          return;',
	                '        }',
	                '        if (!meta || !meta.guarded) return send0.apply(this, arguments);',
	                '        if (networkPermissionState === "granted") return send0.apply(this, arguments);',
                '        if (meta.async === false) throw new Error("Outbound API permission required before synchronous XMLHttpRequest.");',
                '        const xhr = this;',
                '        const args = arguments;',
                '        ensureNetworkPermission("xmlhttprequest", meta.url).then(() => {',
                '          send0.apply(xhr, args);',
                '        }).catch(() => {',
                '          try { if (typeof xhr.onerror === "function") xhr.onerror(new Error("Outbound API permission denied by user.")); } catch {}',
                '          try { xhr.dispatchEvent(new Event("error")); } catch {}',
                '        });',
                '      };',
                '    }',
	                '    if (typeof window.WebSocket === "function") {',
	                '      const WebSocket0 = window.WebSocket;',
	                '      window.WebSocket = function(url, protocols){',
	                '        const policy = getNetworkUrlPolicy(url);',
	                '        if (policy.blockedReason) throw makeBlockedNetworkError("websocket", policy.normalized || url, policy.blockedReason);',
	                '        const normalized = policy.normalized;',
	                '        if (normalized && networkPermissionState === "denied") throw makeBlockedNetworkError("websocket", normalized, "Outbound API permission denied by user.");',
	                '        if (normalized && networkPermissionState !== "granted") {',
	                '          beginNetworkPermissionRequest("websocket", normalized);',
	                '          throw new Error("Outbound API permission prompt required before WebSocket connection.");',
                '        }',
                '        return arguments.length > 1 ? new WebSocket0(url, protocols) : new WebSocket0(url);',
                '      };',
                '      window.WebSocket.prototype = WebSocket0.prototype;',
                '      try { Object.setPrototypeOf(window.WebSocket, WebSocket0); } catch {}',
                '    }',
	                '    if (typeof window.EventSource === "function") {',
	                '      const EventSource0 = window.EventSource;',
	                '      window.EventSource = function(url, config){',
	                '        const policy = getNetworkUrlPolicy(url);',
	                '        if (policy.blockedReason) throw makeBlockedNetworkError("eventsource", policy.normalized || url, policy.blockedReason);',
	                '        const normalized = policy.normalized;',
	                '        if (normalized && networkPermissionState === "denied") throw makeBlockedNetworkError("eventsource", normalized, "Outbound API permission denied by user.");',
	                '        if (normalized && networkPermissionState !== "granted") {',
	                '          beginNetworkPermissionRequest("eventsource", normalized);',
	                '          throw new Error("Outbound API permission prompt required before EventSource connection.");',
                '        }',
                '        return arguments.length > 1 ? new EventSource0(url, config) : new EventSource0(url);',
                '      };',
                '      window.EventSource.prototype = EventSource0.prototype;',
                '      try { Object.setPrototypeOf(window.EventSource, EventSource0); } catch {}',
                '    }',
                '    if (navigator && typeof navigator.sendBeacon === "function") {',
                '      const sendBeacon0 = navigator.sendBeacon.bind(navigator);',
                '      navigator.sendBeacon = function(url, data){',
                '        const policy = getNetworkUrlPolicy(url);',
                '        if (policy.blockedReason) {',
	                '          dispatchRuntimeNetworkWarning({ kind: "sendbeacon", url: policy.normalized || url, reason: policy.blockedReason });',
	                '          return false;',
	                '        }',
	                '        const normalized = policy.normalized;',
	                '        if (normalized && networkPermissionState === "denied") {',
	                '          dispatchRuntimeNetworkWarning({ kind: "sendbeacon", url: normalized, reason: "Outbound API permission denied by user." });',
	                '          return false;',
	                '        }',
	                '        if (normalized && networkPermissionState !== "granted") {',
                '          beginNetworkPermissionRequest("sendbeacon", normalized);',
                '          return false;',
                '        }',
                '        return sendBeacon0(url, data);',
                '      };',
                '    }',
                '    const installPicker = (name, action, many) => {',
                '      window[name] = async (options) => {',
                '        const result = await callParent(action, { options });',
                '        if (many) return Array.isArray(result) ? result.map(materializeHandle) : [];',
                '        return materializeHandle(result);',
                '      };',
                '    };',
                '    const installClipboardBridge = () => {',
                '      const clipboardShim = {',
                '        writeText: async (text) => {',
                '          const result = await callParent("clipboard_write_text", { text });',
                '          if (!result || !result.copied) throw new Error("Clipboard write failed.");',
                '        }',
                '      };',
                '      let patched = false;',
                '      try {',
                '        if (navigator.clipboard && typeof navigator.clipboard === "object") {',
                '          Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, enumerable: true, writable: true, value: clipboardShim.writeText });',
                '          patched = true;',
                '        }',
                '      } catch {}',
                '      const getter = () => clipboardShim;',
                '      if (patched) return;',
                '      try {',
                '        Object.defineProperty(navigator, "clipboard", { configurable: true, enumerable: true, get: getter });',
                '        patched = true;',
                '      } catch {}',
                '      if (patched) return;',
                '      try {',
                '        if (typeof Navigator !== "undefined" && Navigator.prototype) {',
                '          Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, enumerable: true, get: getter });',
                '        }',
                '      } catch {}',
                '    };',
                '    installClipboardBridge();',
                '    installPicker("showOpenFilePicker", "show_open_file_picker", true);',
                '    installPicker("showSaveFilePicker", "show_save_file_picker", false);',
                '    installPicker("showDirectoryPicker", "show_directory_picker", false);',
                '    document.addEventListener("click", (event) => {',
                '      const a = event.target && event.target.closest ? event.target.closest("a[href]") : null;',
                '      if (!a) return;',
                '      const raw = a.getAttribute("href") || "";',
                '      const blockedRaw = a.getAttribute("data-forge-blocked-href") || "";',
                '      const candidate = blockedRaw || raw;',
                '      if (!candidate || candidate.startsWith("#")) return;',
                '      if (a.hasAttribute("download") && (/^\\s*blob:/i.test(raw) || /^\\s*data:/i.test(raw))) return;',
                '      let resolved = null;',
                '      try { resolved = new URL(candidate, location.href); } catch { return; }',
                '      const isMailto = resolved.protocol === "mailto:";',
                '      const isExternal = resolved.origin !== location.origin || resolved.pathname !== location.pathname;',
                '      const target = String(a.getAttribute("target") || "").toLowerCase();',
                '      if (!blockedRaw && !isMailto && !isExternal && target !== "_blank") return;',
                '      event.preventDefault();',
                '      event.stopImmediatePropagation();',
                '      sanitizeAndOpen(candidate, a.getAttribute("target") || "_blank", "noopener,noreferrer");',
                '    }, true);',
                '    window.__Forge_ISOLATED_BRIDGE_ACTIVE__ = true;',
                '  } catch (error) {',
                '    console.warn("Forge child bridge bootstrap failed:", error);',
                '  }',
                '})();'
            ].join('');
        };

        const injectInlineScriptIntoHead = (docHtml, scriptCode) => {
            const headMatch = docHtml.match(/<head\b[^>]*>/i);
            if (headMatch) {
                return docHtml.replace(headMatch[0], `${headMatch[0]}\n${buildInlineScriptTag(scriptCode)}`);
            }
            return `<!doctype html><html><head>${buildInlineScriptTag(scriptCode)}</head><body>${docHtml}</body></html>`;
        };

        const buildSharePointInlineEventListenerBootstrapScript = () => {
            return [
                '(function(){',
                '  try {',
                '    if (window.__Forge_SHAREPOINT_INLINE_EVENT_BOOTSTRAP__) return;',
                '    window.__Forge_SHAREPOINT_INLINE_EVENT_BOOTSTRAP__ = true;',
                '    const DATA_PREFIX = "data-forge-on";',
                '    const handlerCache = new Map();',
                '    const attachedByElement = new WeakMap();',
                '    const getEventName = (attrName) => {',
                '      const name = String(attrName || "").toLowerCase();',
                '      if (name.startsWith(DATA_PREFIX)) return name.slice(DATA_PREFIX.length);',
                '      if (name.startsWith("on")) return name.slice(2);',
                '      return "";',
                '    };',
                '    const isConvertibleAttr = (attrName) => {',
                '      const name = String(attrName || "").toLowerCase();',
                '      if (name.startsWith(DATA_PREFIX)) return true;',
                '      return /^on[a-z][a-z0-9:_-]*$/i.test(name);',
                '    };',
                '    const getListener = (eventName, code) => {',
                '      const cacheKey = eventName + "\\n" + code;',
                '      if (handlerCache.has(cacheKey)) return handlerCache.get(cacheKey);',
                '      const compiled = new Function("event", String(code || ""));',
                '      const listener = function(event){',
                '        const result = compiled.call(this, event);',
                '        if (result === false && event) {',
                '          if (typeof event.preventDefault === "function") event.preventDefault();',
                '          try { event.returnValue = false; } catch {}',
                '        }',
                '        return result;',
                '      };',
                '      handlerCache.set(cacheKey, listener);',
                '      return listener;',
                '    };',
                '    const attachFromAttr = (el, attrName) => {',
                '      if (!el || el.nodeType !== 1 || !isConvertibleAttr(attrName)) return;',
                '      const eventName = getEventName(attrName);',
                '      const rawCode = el.getAttribute(attrName);',
                '      if (rawCode == null) return;',
                '      const code = String(rawCode);',
                '      el.removeAttribute(attrName);',
                '      if (!eventName || !code.trim()) return;',
                '      let attached = attachedByElement.get(el);',
                '      if (!attached) {',
                '        attached = new Set();',
                '        attachedByElement.set(el, attached);',
                '      }',
                '      const attachedKey = eventName + "\\n" + code;',
                '      if (attached.has(attachedKey)) return;',
                '      el.addEventListener(eventName, getListener(eventName, code));',
                '      attached.add(attachedKey);',
                '    };',
                '    const scanNode = (node) => {',
                '      if (!node || node.nodeType !== 1) return;',
                '      const visit = (el) => {',
                '        if (!el || !el.getAttributeNames) return;',
                '        const attrNames = el.getAttributeNames();',
                '        for (const attrName of attrNames) {',
                '          if (isConvertibleAttr(attrName)) attachFromAttr(el, attrName);',
                '        }',
                '      };',
                '      visit(node);',
                '      if (node.querySelectorAll) node.querySelectorAll("*").forEach(visit);',
                '    };',
                '    scanNode(document.documentElement || document.body || document);',
                '    const root = document.documentElement || document.body || document;',
                '    const observer = new MutationObserver((mutations) => {',
                '      for (const mutation of mutations) {',
                '        if (mutation.type === "attributes") {',
                '          attachFromAttr(mutation.target, mutation.attributeName || "");',
                '          continue;',
                '        }',
                '        for (const node of mutation.addedNodes) scanNode(node);',
                '      }',
                '    });',
                '    observer.observe(root, { subtree: true, childList: true, attributes: true });',
                '  } catch (error) {',
                '    console.warn("Forge SharePoint inline event bootstrap failed:", error);',
                '  }',
                '})();'
            ].join('');
        };

        const serializeHtmlDocument = (doc, fallbackDoctype = '') => {
            const safeFallbackDoctype = String(fallbackDoctype || '').trim();
            const doctype = (() => {
                if (doc && doc.doctype) {
                    const name = doc.doctype.name || 'html';
                    if (doc.doctype.publicId) {
                        const systemPart = doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : '';
                        return `<!DOCTYPE ${name} PUBLIC "${doc.doctype.publicId}"${systemPart}>`;
                    }
                    if (doc.doctype.systemId) {
                        return `<!DOCTYPE ${name} SYSTEM "${doc.doctype.systemId}">`;
                    }
                    return `<!DOCTYPE ${name}>`;
                }
                return safeFallbackDoctype;
            })();
            const htmlEl = doc?.documentElement;
            const htmlText = htmlEl ? htmlEl.outerHTML : '';
            if (!htmlText) return String(doc || '');
            return doctype ? `${doctype}\n${htmlText}` : htmlText;
        };

        const rewriteInlineEventHandlersForSharePoint = (docHtml) => {
            const source = String(docHtml || '');
            if (!useSharePointInlineEventRewrite || !source) return source;
            const bootstrapScript = buildSharePointInlineEventListenerBootstrapScript();
            const doctypeMatch = source.match(/^\s*<!doctype[^>]*>/i);
            const sourceDoctype = doctypeMatch ? doctypeMatch[0] : '';
            try {
                if (typeof DOMParser !== 'function') {
                    return injectInlineScriptIntoHead(source, bootstrapScript);
                }
                const doc = new DOMParser().parseFromString(source, 'text/html');
                const elements = Array.from(doc.querySelectorAll('*'));
                for (const el of elements) {
                    const attrs = Array.from(el.attributes || []);
                    for (const attr of attrs) {
                        const attrName = String(attr?.name || '');
                        if (!/^on[a-z][a-z0-9:_-]*$/i.test(attrName)) continue;
                        const dataAttrName = `data-forge-${attrName.toLowerCase()}`;
                        const value = attr.value == null ? '' : String(attr.value);
                        el.setAttribute(dataAttrName, value);
                        el.removeAttribute(attrName);
                    }
                }
                const rewritten = serializeHtmlDocument(doc, sourceDoctype);
                return injectInlineScriptIntoHead(rewritten, bootstrapScript);
            } catch (error) {
                console.warn('SharePoint inline event rewrite fallback:', error);
                return injectInlineScriptIntoHead(source, bootstrapScript);
            }
        };

        const extractHtmlTitle = (docHtml) => {
            const htmlText = String(docHtml || '')
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
            const match = htmlText.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
            if (!match) return '';
            return String(match[1] || '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const escapeHtml = (text) => String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

	        const buildParentBridgeShellHtml = (childHtml) => {
	            const childHtmlB64 = encodeUtf8B64(childHtml);
	            const extractedTitle = extractHtmlTitle(childHtml);
	            const shellTitle = extractedTitle || 'Forge Isolated Runtime Shell';
            const childSandboxAttr = (useSharePointCompatMode || useFusionBridgeMode)
	                ? 'allow-scripts allow-forms allow-modals allow-downloads allow-same-origin allow-popups allow-popups-to-escape-sandbox'
	                : 'allow-scripts allow-forms allow-modals allow-downloads';
            const childAllowAttr = 'clipboard-read *; clipboard-write *';
	            const shellRootCss = useFusionFullscreenMode
	                ? '    #forge-secure-shell-root { position: fixed; inset: 0; z-index: 2147483000; width: 100vw; max-width: 100vw; height: 100vh; height: 100dvh; min-height: 0; margin: 0; padding: 0; overflow: hidden; border: 0; background: #fff; }'
	                : useFusionBridgeMode
	                    ? '    #forge-secure-shell-root { width: 100%; max-width: 100%; height: 82vh; min-height: 720px; margin: 0; padding: 0; overflow: hidden; border: 0; background: #fff; }'
	                    : '    #forge-secure-shell-root { width: 100%; height: 100%; }';
	            const fusionFullscreenCss = useFusionFullscreenMode ? [
	                '    body:has(#forge-secure-shell-root) #main-content, body.forge-fusion-confluence-fullscreen #main-content, body:has(#forge-secure-shell-root) .wiki-content, body.forge-fusion-confluence-fullscreen .wiki-content, body:has(#forge-secure-shell-root) .pageSection, body.forge-fusion-confluence-fullscreen .pageSection, body:has(#forge-secure-shell-root) .plugin_pagetree_children_content, body.forge-fusion-confluence-fullscreen .plugin_pagetree_children_content, body:has(#forge-secure-shell-root) .conf-macro, body.forge-fusion-confluence-fullscreen .conf-macro, body:has(#forge-secure-shell-root) .html-macro, body.forge-fusion-confluence-fullscreen .html-macro, body:has(#forge-secure-shell-root) .output-block { max-width: none !important; }',
	                '    body:has(#forge-secure-shell-root) #main-content, body.forge-fusion-confluence-fullscreen #main-content, body:has(#forge-secure-shell-root) .wiki-content { padding-left: 0 !important; padding-right: 0 !important; }',
	                '    html.forge-fusion-confluence-fullscreen, html.forge-fusion-confluence-fullscreen body, body.forge-fusion-confluence-fullscreen { overflow: hidden !important; }',
	                '    body.forge-fusion-confluence-fullscreen .wiki-content, body.forge-fusion-confluence-fullscreen #content, body.forge-fusion-confluence-fullscreen #main { padding-left: 0 !important; padding-right: 0 !important; }',
	                '    body.forge-fusion-confluence-fullscreen .ia-fixed-sidebar, body.forge-fusion-confluence-fullscreen .ia-splitter-left, body.forge-fusion-confluence-fullscreen .acs-side-bar { display: none !important; visibility: hidden !important; }',
	                '    body.forge-fusion-confluence-fullscreen.theme-default .ia-splitter #main, body.forge-fusion-confluence-fullscreen .ia-splitter #main, body.forge-fusion-confluence-fullscreen #main { margin-left: 0 !important; width: 100% !important; }',
	                '    body.forge-fusion-confluence-fullscreen #breadcrumb-section, body.forge-fusion-confluence-fullscreen #title-heading, body.forge-fusion-confluence-fullscreen #comments-section, body.forge-fusion-confluence-fullscreen #likes-section, body.forge-fusion-confluence-fullscreen #labels-section, body.forge-fusion-confluence-fullscreen #footer { display: none !important; }'
	            ] : [];
	            const parentScript = [
	                '(function(){',
	                '  try {',
	                `    const CHILD_HTML_B64 = ${JSON.stringify(childHtmlB64)};`,
	                `    const BRIDGE_TOKEN = ${JSON.stringify(bridgeToken)};`,
	                `    const NETWORK_ALLOWLIST = ${JSON.stringify(connectSrcAllowlist)};`,
	                `    const SHAREPOINT_SITE_URL = ${JSON.stringify(useSharePointCompatMode ? sharePointSiteUrl : '')};`,
	                `    const CONFLUENCE_PARENT_PROXY = ${useFusionBridgeMode ? 'true' : 'false'};`,
	                `    const FUSION_FULLSCREEN = ${useFusionFullscreenMode ? 'true' : 'false'};`,
	                '    const frame = document.getElementById("forge-secure-app-frame");',
	                '    if (!frame) return;',
	                '    if (FUSION_FULLSCREEN) {',
	                '      if (document.documentElement) document.documentElement.classList.add("forge-fusion-confluence-fullscreen");',
	                '      if (document.body) document.body.classList.add("forge-fusion-confluence-fullscreen");',
	                '    }',
                '    try { frame.setAttribute("allow", "clipboard-read *; clipboard-write *"); } catch {}',
                '    const gesturePanel = document.getElementById("forge-gesture-panel");',
                '    const gestureMessage = document.getElementById("forge-gesture-message");',
                '    const gestureContinueBtn = document.getElementById("forge-gesture-continue");',
                '    const gestureCancelBtn = document.getElementById("forge-gesture-cancel");',
	                '    let gesturePending = false;',
	                '    let networkPermissionState = NETWORK_ALLOWLIST.length ? "unknown" : "granted";',
	                '    const decodeB64Utf8 = (b64) => decodeURIComponent(escape(atob(b64)));',
	                '    const buildInlineScriptTag = (code) => "<script>" + String(code || "").replace(/<\\/script/gi, "<\\\\/script") + "</" + "script>";',
	                '    const MAILTO_ALLOWED = new Set(["subject","body","cc","bcc"]);',
	                '    const handleById = new Map();',
                '    const handleIdByObj = new WeakMap();',
                '    const writerById = new Map();',
                '    const makeMemoryStorage = () => {',
                '      const map = new Map();',
                '      return {',
                '        getItem: (key) => {',
                '          const normalized = String(key);',
                '          return map.has(normalized) ? map.get(normalized) : null;',
                '        },',
                '        setItem: (key, value) => {',
                '          map.set(String(key), value == null ? "" : String(value));',
                '        },',
                '        removeItem: (key) => {',
                '          map.delete(String(key));',
                '        },',
                '        clear: () => {',
                '          map.clear();',
                '        },',
                '        key: (index) => {',
                '          const i = Number(index);',
                '          if (!Number.isInteger(i) || i < 0 || i >= map.size) return null;',
                '          return Array.from(map.keys())[i] || null;',
                '        },',
                '        get length() {',
                '          return map.size;',
                '        }',
                '      };',
                '    };',
                '    const memoryStorageByScope = { local: makeMemoryStorage(), session: makeMemoryStorage() };',
                '    const normalizeStorageScope = (scope) => (String(scope || "local").toLowerCase() === "session" ? "session" : "local");',
                '    const getStorageArea = (scope) => {',
                '      const normalized = normalizeStorageScope(scope);',
                '      const prop = normalized === "session" ? "sessionStorage" : "localStorage";',
                '      try {',
                '        const nativeArea = window[prop];',
                '        if (nativeArea && typeof nativeArea.getItem === "function" && typeof nativeArea.setItem === "function") return nativeArea;',
                '      } catch {}',
                '      return memoryStorageByScope[normalized];',
                '    };',
                '    const snapshotStorage = (scope) => {',
                '      const area = getStorageArea(scope);',
                '      const out = {};',
                '      const len = Number(area.length) || 0;',
                '      for (let i = 0; i < len; i += 1) {',
                '        const key = area.key(i);',
                '        if (typeof key !== "string") continue;',
                '        const value = area.getItem(key);',
                '        out[key] = value == null ? "" : String(value);',
                '      }',
                '      return out;',
                '    };',
	                '    const injectStorageSeed = (htmlText) => {',
	                '      const seed = { local: snapshotStorage("local"), session: snapshotStorage("session") };',
	                '      const payload = JSON.stringify(seed).replace(/</g, "\\\\u003c");',
	                '      const seedScript = buildInlineScriptTag("window.__Forge_STORAGE_SEED__=" + payload + ";");',
	                '      const headMatch = htmlText.match(/<head\\b[^>]*>/i);',
	                '      if (headMatch) return htmlText.replace(headMatch[0], headMatch[0] + "\\n" + seedScript);',
	                '      return "<!doctype html><html><head>" + seedScript + "</head><body>" + htmlText + "</body></html>";',
	                '    };',
	                '    const injectSharePointContextSeed = (htmlText) => {',
	                '      let seed = null;',
	                '      try {',
	                '        if (window._spPageContextInfo && typeof window._spPageContextInfo === "object") {',
	                '          seed = Object.assign({}, window._spPageContextInfo);',
	                '        }',
	                '      } catch {}',
	                '      if (!seed) seed = {};',
	                '      if (!seed.webAbsoluteUrl && SHAREPOINT_SITE_URL) seed.webAbsoluteUrl = SHAREPOINT_SITE_URL;',
	                '      if (!seed.siteAbsoluteUrl && SHAREPOINT_SITE_URL) seed.siteAbsoluteUrl = SHAREPOINT_SITE_URL;',
	                '      if (!seed.webAbsoluteUrl) return htmlText;',
	                '      const payload = JSON.stringify(seed).replace(/</g, "\\\\u003c");',
	                '      const seedScript = buildInlineScriptTag("var _spPageContextInfo=Object.assign({},window._spPageContextInfo||{}, " + payload + ");window._spPageContextInfo=_spPageContextInfo;");',
	                '      const headMatch = htmlText.match(/<head\\b[^>]*>/i);',
	                '      if (headMatch) return htmlText.replace(headMatch[0], headMatch[0] + "\\n" + seedScript);',
	                '      return "<!doctype html><html><head>" + seedScript + "</head><body>" + htmlText + "</body></html>";',
	                '    };',
	                '    const getConfluenceMetaValue = (name) => {',
	                '      try {',
	                '        if (window.AJS && window.AJS.Meta && typeof window.AJS.Meta.get === "function") {',
	                '          const fromAjs = window.AJS.Meta.get(name);',
	                '          if (fromAjs) return String(fromAjs);',
	                '        }',
	                '      } catch {}',
	                '      try {',
	                '        const escaped = String(name || "").replace(/"/g, "\\\\\\"");',
	                '        const node = document.querySelector(\'meta[name="\' + escaped + \'"], meta[id="\' + escaped + \'"]\');',
	                '        if (node) return String(node.getAttribute("content") || node.getAttribute("value") || "");',
	                '      } catch {}',
	                '      return "";',
	                '    };',
	                '    const getConfluenceContextSeed = () => {',
	                '      if (!CONFLUENCE_PARENT_PROXY) return null;',
	                '      return {',
	                '        pageId: getConfluenceMetaValue("ajs-page-id") || getConfluenceMetaValue("ajs-content-id"),',
	                '        contentId: getConfluenceMetaValue("ajs-content-id") || getConfluenceMetaValue("ajs-page-id"),',
	                '        baseUrl: getConfluenceMetaValue("ajs-base-url") || location.origin,',
	                '        username: getConfluenceMetaValue("ajs-remote-user") || getConfluenceMetaValue("ajs-current-user-fullname"),',
	                '        userKey: getConfluenceMetaValue("ajs-remote-user-key"),',
	                '        token: getConfluenceMetaValue("ajs-atl-token") || getConfluenceMetaValue("atlassian-token")',
	                '      };',
	                '    };',
	                '    const injectConfluenceContextSeed = (htmlText) => {',
	                '      const seed = getConfluenceContextSeed();',
	                '      if (!seed) return htmlText;',
	                '      const payload = JSON.stringify(seed).replace(/</g, "\\\\u003c");',
	                '      const seedScript = buildInlineScriptTag(',
	                '        "window.__Forge_CONFLUENCE_CONTEXT__=" + payload + ";" +',
	                '        "(function(){var s=window.__Forge_CONFLUENCE_CONTEXT__||{};var map={\\"ajs-page-id\\":s.pageId,\\"ajs-content-id\\":s.contentId,\\"ajs-base-url\\":s.baseUrl,\\"ajs-remote-user\\":s.username,\\"ajs-current-user-fullname\\":s.username,\\"ajs-remote-user-key\\":s.userKey,\\"ajs-atl-token\\":s.token,\\"atlassian-token\\":s.token};Object.keys(map).forEach(function(name){var value=map[name];if(!value)return;var selector=\\\"meta[name=\\\\\\\"\\\"+name+\\\"\\\\\\\"],meta[id=\\\\\\\"\\\"+name+\\\"\\\\\\\"]\\\";if(document.querySelector(selector))return;var meta=document.createElement(\\\"meta\\\");meta.setAttribute(\\\"name\\\",name);meta.setAttribute(\\\"content\\\",String(value));(document.head||document.documentElement).appendChild(meta);});})();"',
	                '      );',
	                '      const headMatch = htmlText.match(/<head\\b[^>]*>/i);',
	                '      if (headMatch) return htmlText.replace(headMatch[0], headMatch[0] + "\\n" + seedScript);',
	                '      return "<!doctype html><html><head>" + seedScript + "</head><body>" + htmlText + "</body></html>";',
	                '    };',
                '    let nextHandleId = 1;',
                '    let nextWriterId = 1;',
                '    const ensureHandleId = (handle) => {',
                '      if (!handle) throw new Error("Missing file system handle.");',
                '      const existing = handleIdByObj.get(handle);',
                '      if (existing) return existing;',
                '      const id = nextHandleId++;',
                '      handleIdByObj.set(handle, id);',
                '      handleById.set(id, handle);',
                '      return id;',
                '    };',
                '    const getHandle = (id) => {',
                '      const h = handleById.get(Number(id));',
                '      if (!h) throw new Error("Unknown handle id: " + id);',
                '      return h;',
                '    };',
                '    const getWriter = (id) => {',
                '      const w = writerById.get(Number(id));',
                '      if (!w) throw new Error("Unknown writer id: " + id);',
                '      return w;',
                '    };',
                '    const serializeHandle = (handle) => ({',
                '      id: ensureHandleId(handle),',
                '      kind: handle.kind,',
                '      name: handle.name || ""',
                '    });',
                '    const sanitizeMailto = (value) => {',
                '      try {',
                '        const parsed = new URL(String(value || ""));',
                '        const kept = new URLSearchParams();',
                '        for (const pair of parsed.searchParams.entries()) {',
                '          const key = String(pair[0] || "").toLowerCase();',
                '          if (MAILTO_ALLOWED.has(key)) kept.append(pair[0], pair[1]);',
                '        }',
                '        const q = kept.toString();',
                '        return "mailto:" + parsed.pathname + (q ? ("?" + q) : "");',
                '      } catch { return "mailto:"; }',
                '    };',
                '    const normalizeOpenPath = (value) => {',
                '      let path = String(value || "/").trim();',
                '      if (!path.startsWith("/")) path = "/" + path;',
                '      path = path.replace(/\\/+/g, "/");',
                '      path = path.replace(/\\/+$/g, "");',
                '      return path || "/";',
                '    };',
                '    const SHAREPOINT_SITE_PATH = (() => {',
                '      if (!SHAREPOINT_SITE_URL) return "";',
                '      try {',
                '        return normalizeOpenPath(new URL(SHAREPOINT_SITE_URL, location.href).pathname || "/");',
                '      } catch {',
                '        return "";',
                '      }',
                '    })();',
                '    const isSharePointOpenAllowed = (parsed) => {',
                '      if (!parsed || !SHAREPOINT_SITE_URL) return false;',
                '      try {',
                '        const siteUrl = new URL(SHAREPOINT_SITE_URL, location.href);',
                '        if (normalizeAllowPattern(parsed.origin) !== normalizeAllowPattern(siteUrl.origin)) return false;',
                '        const path = normalizeOpenPath(parsed.pathname || "/");',
                '        if (!SHAREPOINT_SITE_PATH || SHAREPOINT_SITE_PATH === "/") return true;',
                '        return path === SHAREPOINT_SITE_PATH || path.startsWith(SHAREPOINT_SITE_PATH + "/");',
                '      } catch {',
                '        return false;',
                '      }',
                '    };',
                '    const isTrustedNavigationHostname = (hostname) => {',
                '      const host = String(hostname || "").toLowerCase();',
                '      if (!host) return false;',
                '      if (host === "api.capra.flankspeed.us.navy.mil" || host === "api.genai.army.mil" || host === "api.genai.army.smil.mil") return true;',
                '      return host === "genai.mil" || host.endsWith(".genai.mil");',
                '    };',
                '    const truncateForPrompt = (value, maxLen) => {',
                '      const raw = String(value || "").trim();',
                '      if (!raw) return "";',
                '      const limit = Number.isFinite(maxLen) && maxLen > 8 ? Math.floor(maxLen) : 120;',
                '      return raw.length > limit ? (raw.slice(0, limit - 3) + "...") : raw;',
                '    };',
                '    const inspectExternalNavigation = (parsed) => {',
                '      const pathTail = String((parsed && parsed.pathname) || "").replace(/^\\/+/, "");',
                '      const hashTail = String((parsed && parsed.hash) || "").replace(/^#/, "");',
                '      const segments = pathTail.split("/").filter(Boolean);',
                '      let longestSegment = 0;',
                '      for (const segment of segments) {',
                '        if (segment.length > longestSegment) longestSegment = segment.length;',
                '      }',
                '      const encodedCount = (pathTail.match(/%[0-9a-f]{2}/gi) || []).length + (hashTail.match(/%[0-9a-f]{2}/gi) || []).length;',
                '      const densePath = /[A-Za-z0-9_-]{72,}/.test(pathTail) || /[A-Za-z0-9_-]{72,}/.test(hashTail);',
                '      const largeAfterSlash = pathTail.length >= 96 || longestSegment >= 72 || hashTail.length >= 80 || encodedCount >= 16 || densePath;',
                '      const previewSource = pathTail || hashTail || "/";',
                '      const warning = largeAfterSlash ? "Warning: this URL contains an unusually large path or fragment after the slash. That can carry copied data off-site." : "";',
                '      return {',
                '        largeAfterSlash,',
                '        pathTail,',
                '        hashTail,',
                '        preview: truncateForPrompt(previewSource, 120),',
                '        warning',
                '      };',
                '    };',
                '    const describeNavigationTarget = (parsed) => {',
                '      if (!parsed) return "external destination";',
                '      try {',
                '        if (parsed.origin && parsed.origin !== "null") return parsed.origin;',
                '      } catch {}',
                '      const protocol = String((parsed && parsed.protocol) || "").toLowerCase();',
                '      if (protocol === "file:") return "file://";',
                '      return protocol || "external destination";',
                '    };',
                '    const analyzeOpenUrl = (value) => {',
                '      const raw = String(value || "").trim();',
                '      const out = { safeUrl: "", blockedUrl: "", blockedReason: "", requiresApproval: false, approvalMessage: "", approvalTarget: "", approvalPathPreview: "", approvalWarning: "" };',
                '      if (!raw) return out;',
                '      if (/^javascript:/i.test(raw) || /^data:/i.test(raw)) {',
                '        out.blockedReason = "Blocked unsafe URL by Forge runtime guard.";',
                '        return out;',
                '      }',
                '      if (/^[a-z][a-z0-9+.-]*:\\/\\/[^/?#]*@/i.test(raw)) {',
                '        out.blockedReason = "Blocked credential-bearing URL by Forge runtime guard.";',
                '        return out;',
                '      }',
                '      if (/^mailto:/i.test(raw)) {',
                '        out.safeUrl = sanitizeMailto(raw);',
                '        return out;',
                '      }',
                '      try {',
                '        const parsed = new URL(raw, location.href);',
                '        const protocol = String(parsed.protocol || "").toLowerCase();',
                '        if (!["http:","https:","file:"].includes(protocol)) {',
                '          out.blockedReason = "Blocked unsupported URL scheme by Forge runtime guard.";',
                '          return out;',
                '        }',
                '        if (["http:","https:"].includes(protocol)) {',
                '          const host = String(parsed.hostname || "").trim().toLowerCase();',
                '          if (!host || !host.split(".").every((label) => label && label.length <= 20)) {',
                '            out.blockedReason = "Blocked link because a hostname label exceeds 20 characters.";',
                '            return out;',
                '          }',
                '        }',
                '        parsed.username = "";',
                '        parsed.password = "";',
                '        parsed.search = "";',
                '        const sameCurrentDoc = (() => {',
                '          try {',
                '            const sameOrigin = parsed.origin === location.origin || (parsed.protocol === "file:" && location.protocol === "file:");',
                '            return sameOrigin && parsed.pathname === location.pathname;',
                '          } catch {',
                '            return false;',
                '          }',
                '        })();',
                '        if (sameCurrentDoc) {',
                '          out.safeUrl = parsed.toString();',
                '          return out;',
                '        }',
                '        if (isSharePointOpenAllowed(parsed)) {',
                '          out.safeUrl = parsed.toString();',
                '          return out;',
                '        }',
                '        const navigationInfo = inspectExternalNavigation(parsed);',
                '        out.requiresApproval = true;',
                '        out.approvalTarget = describeNavigationTarget(parsed);',
                '        out.approvalPathPreview = navigationInfo.preview;',
                '        out.approvalWarning = navigationInfo.warning;',
                '        out.approvalMessage = "Allow off-origin navigation to " + out.approvalTarget + "?";',
                '        if (out.approvalPathPreview && out.approvalPathPreview !== "/") out.approvalMessage += " Path after slash: " + out.approvalPathPreview + ".";',
                '        if (out.approvalWarning) out.approvalMessage += " " + out.approvalWarning;',
                '        out.safeUrl = parsed.toString();',
                '        return out;',
                '      } catch {',
	                '        out.blockedReason = "Blocked invalid external link by Forge runtime guard.";',
	                '        return out;',
	                '      }',
	                '    };',
	                '    const sanitizeOpenUrl = (value) => analyzeOpenUrl(value).safeUrl;',
	                '    const getSharePointContextSeed = () => {',
	                '      let seed = null;',
	                '      try {',
	                '        if (window._spPageContextInfo && typeof window._spPageContextInfo === "object") seed = Object.assign({}, window._spPageContextInfo);',
	                '      } catch {}',
	                '      if (!seed) seed = {};',
	                '      if (!seed.webAbsoluteUrl && SHAREPOINT_SITE_URL) seed.webAbsoluteUrl = SHAREPOINT_SITE_URL;',
	                '      if (!seed.siteAbsoluteUrl && SHAREPOINT_SITE_URL) seed.siteAbsoluteUrl = SHAREPOINT_SITE_URL;',
	                '      return seed;',
	                '    };',
	                '    const normalizeAllowPattern = (value) => String(value || "").trim().toLowerCase().replace(/\\/$/, "");',
	                '    const parentOriginMatchesPattern = (origin, pattern) => {',
	                '      const o = normalizeAllowPattern(origin);',
	                '      const p = normalizeAllowPattern(pattern);',
	                '      if (!o || !p) return false;',
	                '      if (p === "\'self\'" || p === "self") {',
	                '        try {',
	                '          return o === normalizeAllowPattern(new URL(location.href).origin);',
	                '        } catch {',
	                '          return false;',
	                '        }',
	                '      }',
	                '      if (o === p) return true;',
	                '      let protocol = "";',
	                '      let suffix = "";',
	                '      if (p.startsWith("http://*.")) {',
	                '        protocol = "http:";',
	                '        suffix = p.slice("http://*.".length);',
	                '      } else if (p.startsWith("https://*.")) {',
	                '        protocol = "https:";',
	                '        suffix = p.slice("https://*.".length);',
	                '      } else {',
	                '        return false;',
	                '      }',
	                '      try {',
	                '        const parsed = new URL(o);',
	                '        if (parsed.protocol !== protocol) return false;',
	                '        const host = String(parsed.hostname || "").toLowerCase();',
	                '        return !!suffix && host.length > suffix.length && host.endsWith("." + suffix);',
	                '      } catch {',
	                '        return false;',
	                '      }',
	                '    };',
	                '    const isBridgeOriginAllowlisted = (origin) => {',
	                '      if (!NETWORK_ALLOWLIST.length) return false;',
	                '      return NETWORK_ALLOWLIST.some((pattern) => parentOriginMatchesPattern(origin, pattern));',
	                '    };',
	                '    const resolveBridgeNetworkUrl = (value) => {',
	                '      try {',
	                '        return new URL(String(value || ""), location.href);',
	                '      } catch {',
	                '        return null;',
	                '      }',
	                '    };',
	                '    const needsUserGesture = (error) => {',
	                '      const name = String((error && error.name) || "").toLowerCase();',
	                '      const msg = String((error && error.message) || error || "").toLowerCase();',
	                '      return name === "notallowederror" || msg.includes("user activation") || msg.includes("gesture") || msg.includes("popup blocked") || msg.includes("permission denied");',
	                '    };',
                '    const runWithGesture = async (label, fn, forcePrompt) => {',
                '      if (!forcePrompt) {',
                '        try {',
                '          return await fn();',
                '        } catch (error) {',
                '          if (!needsUserGesture(error) || !gesturePanel || !gestureMessage || !gestureContinueBtn || !gestureCancelBtn) throw error;',
                '        }',
                '      }',
                '      return await new Promise((resolve, reject) => {',
                '        if (gesturePending) {',
                '          reject(new Error("Another gesture-gated request is already pending."));',
                '          return;',
                '        }',
                '        gesturePending = true;',
                '        const cleanup = () => {',
                '          gesturePanel.hidden = true;',
                '          gestureContinueBtn.disabled = false;',
                '          gestureCancelBtn.disabled = false;',
                '          gestureContinueBtn.removeEventListener("click", onContinue);',
                '          gestureCancelBtn.removeEventListener("click", onCancel);',
                '          gesturePending = false;',
                '        };',
                '        const onCancel = () => {',
                '          cleanup();',
                '          reject(new Error("User cancelled required gesture."));',
                '        };',
                '        const onContinue = async () => {',
                '          gestureContinueBtn.disabled = true;',
                '          gestureCancelBtn.disabled = true;',
                '          try {',
                '            const result = await fn();',
                '            cleanup();',
                '            resolve(result);',
                '          } catch (err) {',
                '            cleanup();',
                '            reject(err);',
                '          }',
                '        };',
                '        gestureMessage.textContent = label || "Click Continue to proceed.";',
                '        gesturePanel.hidden = false;',
                '        gestureContinueBtn.addEventListener("click", onContinue);',
                '        gestureCancelBtn.addEventListener("click", onCancel);',
                '      });',
                '    };',
                '    const requestNavigationApproval = async (decision) => {',
                '      if (!decision || !decision.requiresApproval) return true;',
                '      const label = String(decision.approvalMessage || ("Allow off-origin navigation to " + String(decision.approvalTarget || "external destination") + "?"));',
                '      await runWithGesture(label, async () => true, true);',
                '      return true;',
                '    };',
                '    const offerManualUrlCopy = async (url, reason) => {',
                '      const raw = String(url || "").trim();',
                '      if (!raw) return { offered: false };',
                '      const label = reason || "Blocked external link. Copy the URL and open it manually in a new tab if you trust it.";',
                '      await runWithGesture(label, async () => {',
                '        window.prompt(label, raw);',
                '        return true;',
                '      }, true);',
                '      return { offered: true };',
                '    };',
                '    const copyTextToClipboard = async (text) => {',
                '      const raw = text == null ? "" : String(text);',
                '      if (!raw) return true;',
                '      try {',
                '        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {',
                '          await navigator.clipboard.writeText(raw);',
                '          return true;',
                '        }',
                '      } catch {}',
                '      try {',
                '        const ta = document.createElement("textarea");',
                '        ta.value = raw;',
                '        ta.setAttribute("readonly", "");',
                '        ta.style.position = "fixed";',
                '        ta.style.left = "-9999px";',
                '        ta.style.top = "0";',
                '        document.body.appendChild(ta);',
                '        ta.select();',
                '        ta.setSelectionRange(0, ta.value.length);',
                '        const ok = document.execCommand("copy");',
                '        ta.remove();',
                '        return !!ok;',
                '      } catch {',
                '        return false;',
                '      }',
                '    };',
                '    const sendResponse = (targetWindow, id, ok, result, error, errorName) => {',
                '      if (!targetWindow || typeof targetWindow.postMessage !== "function") return;',
                '      targetWindow.postMessage({ __forgeBridgeResp: true, token: BRIDGE_TOKEN, id, ok, result, error, errorName }, "*");',
                '    };',
	                '    const actionMap = {',
	                '      get_sharepoint_context: async () => {',
	                '        return getSharePointContextSeed();',
	                '      },',
	                '      request_network_permission: async ({ kind, url }) => {',
	                '        if (networkPermissionState === "granted") return { granted: true, cached: true };',
	                '        if (networkPermissionState === "denied") throw new Error("Outbound API permission denied by user.");',
	                '        const summary = NETWORK_ALLOWLIST.length ? ("Allowed origins: " + NETWORK_ALLOWLIST.join(", ")) : "No API origins configured.";',
                '        const hint = url ? (" Attempted: " + String(url)) : "";',
                '        try {',
                '          await runWithGesture("Allow outbound API access for this app? " + summary + hint, async () => true, true);',
                '          networkPermissionState = "granted";',
                '          return { granted: true, cached: false };',
                '        } catch (error) {',
	                '          networkPermissionState = "denied";',
	                '          throw error;',
	                '        }',
	                '      },',
	                '      proxy_fetch: async ({ url, method, headers, bodyText, credentials }) => {',
	                '        const parsed = resolveBridgeNetworkUrl(url);',
	                '        if (!parsed) throw new Error("Invalid proxy_fetch URL.");',
	                '        const protocol = String(parsed.protocol || "").toLowerCase();',
	                '        if (!["http:","https:"].includes(protocol)) throw new Error("proxy_fetch only supports http/https URLs.");',
	                '        if (!isBridgeOriginAllowlisted(parsed.origin)) throw new Error("Blocked outbound origin (not allowlisted): " + parsed.origin);',
	                '        const headerObj = {};',
	                '        const headerPairs = Array.isArray(headers) ? headers : [];',
	                '        for (const pair of headerPairs) {',
	                '          if (!Array.isArray(pair) || pair.length < 2) continue;',
	                '          const key = String(pair[0] || "").trim();',
	                '          if (!key) continue;',
	                '          headerObj[key] = String(pair[1] == null ? "" : pair[1]);',
	                '        }',
	                '        const reqMethod = String(method || "GET").toUpperCase();',
	                '        const reqInit = { method: reqMethod, headers: headerObj, credentials: credentials === "omit" ? "omit" : "include" };',
	                '        if (bodyText != null && reqMethod !== "GET" && reqMethod !== "HEAD") reqInit.body = String(bodyText);',
	                '        const response = await fetch(parsed.toString(), reqInit);',
	                '        const responseText = await response.text();',
	                '        return {',
	                '          status: response.status,',
	                '          statusText: response.statusText || "",',
	                '          headers: Array.from(response.headers.entries()),',
	                '          bodyText: responseText,',
	                '          url: response.url || parsed.toString()',
	                '        };',
	                '      },',
	                '      open_url: async ({ url, target, features }) => {',
	                '        const decision = analyzeOpenUrl(url);',
	                '        const safe = decision.safeUrl;',
	                '        if (!safe) {',
                    '          if (decision.blockedUrl) {',
                    '            try {',
                    '              await offerManualUrlCopy(decision.blockedUrl, decision.blockedReason);',
                    '            } catch {}',
                    '          }',
                    '          return { opened: false, blocked: true, reason: decision.blockedReason || "Blocked external link by Forge runtime guard.", url: decision.blockedUrl || "" };',
                    '        }',
                '        if (decision.requiresApproval) {',
                '          try {',
                '            await requestNavigationApproval(decision);',
                '          } catch (error) {',
                '            return { opened: false, blocked: true, reason: String((error && error.message) || error || "User cancelled off-origin navigation."), url: safe };',
                '          }',
                '        }',
                '        const attemptOpen = () => {',
                '          const popup = window.open(safe, target || "_blank", features || "noopener,noreferrer");',
                '          if (!popup) throw new Error("Popup blocked: user gesture required.");',
                '          return true;',
                '        };',
                '        try {',
                '          const opened = attemptOpen();',
                '          return { opened: !!opened, url: safe };',
                '        } catch (error) {',
                '          return { opened: false, blocked: true, reason: String((error && error.message) || error || "Popup blocked while opening sanitized link."), url: safe };',
                '        }',
                '      },',
                '      clipboard_write_text: async ({ text }) => {',
                '        return { copied: await copyTextToClipboard(text) };',
                '      },',
                '      show_open_file_picker: async ({ options }) => {',
                '        if (typeof window.showOpenFilePicker !== "function") throw new Error("showOpenFilePicker unavailable in host.");',
                '        const handles = await runWithGesture("Select file(s) for the isolated app", () => window.showOpenFilePicker(options || {}), true);',
                '        return handles.map(serializeHandle);',
                '      },',
                '      show_save_file_picker: async ({ options }) => {',
                '        if (typeof window.showSaveFilePicker !== "function") throw new Error("showSaveFilePicker unavailable in host.");',
                '        return serializeHandle(await runWithGesture("Choose where to save file changes", () => window.showSaveFilePicker(options || {}), true));',
                '      },',
                '      show_directory_picker: async ({ options }) => {',
                '        if (typeof window.showDirectoryPicker !== "function") throw new Error("showDirectoryPicker unavailable in host.");',
                '        return serializeHandle(await runWithGesture("Select a directory for isolated app access", () => window.showDirectoryPicker(options || {}), true));',
                '      },',
                '      fs_get_file: async ({ id }) => {',
                '        const handle = getHandle(id);',
                '        return await handle.getFile();',
                '      },',
                '      fs_create_writable: async ({ id, options }) => {',
                '        const handle = getHandle(id);',
                '        const writer = await handle.createWritable(options || {});',
                '        const writerId = nextWriterId++;',
                '        writerById.set(writerId, writer);',
                '        return { writerId };',
                '      },',
                '      fs_writer_write: async ({ writerId, data }) => {',
                '        await getWriter(writerId).write(data);',
                '        return true;',
                '      },',
                '      fs_writer_seek: async ({ writerId, position }) => {',
                '        await getWriter(writerId).seek(position);',
                '        return true;',
                '      },',
                '      fs_writer_truncate: async ({ writerId, size }) => {',
                '        await getWriter(writerId).truncate(size);',
                '        return true;',
                '      },',
                '      fs_writer_close: async ({ writerId }) => {',
                '        const writer = getWriter(writerId);',
                '        await writer.close();',
                '        writerById.delete(Number(writerId));',
                '        return true;',
                '      },',
                '      fs_writer_abort: async ({ writerId }) => {',
                '        const writer = getWriter(writerId);',
                '        if (typeof writer.abort === "function") await writer.abort();',
                '        else await writer.close();',
                '        writerById.delete(Number(writerId));',
                '        return true;',
                '      },',
                '      fs_query_permission: async ({ id, options }) => {',
                '        const handle = getHandle(id);',
                '        return typeof handle.queryPermission === "function" ? await handle.queryPermission(options || {}) : "granted";',
                '      },',
                '      fs_request_permission: async ({ id, options }) => {',
                '        const handle = getHandle(id);',
                '        if (typeof handle.requestPermission !== "function") return "granted";',
                '        let state = await handle.requestPermission(options || {});',
                '        if (state === "granted") return state;',
                '        try {',
                '          state = await runWithGesture("Grant file access permission to isolated app", async () => {',
                '            const retry = await handle.requestPermission(options || {});',
                '            if (retry !== "granted") throw new DOMException("Permission denied", "NotAllowedError");',
                '            return retry;',
                '          }, true);',
                '          return state;',
                '        } catch {',
                '          return "denied";',
                '        }',
                '      },',
                '      fs_get_file_handle: async ({ id, name, options }) => serializeHandle(await getHandle(id).getFileHandle(name, options || {})),',
                '      fs_get_directory_handle: async ({ id, name, options }) => serializeHandle(await getHandle(id).getDirectoryHandle(name, options || {})),',
                '      fs_remove_entry: async ({ id, name, options }) => {',
                '        await getHandle(id).removeEntry(name, options || {});',
                '        return true;',
                '      },',
                '      fs_resolve: async ({ id, otherId }) => {',
                '        const base = getHandle(id);',
                '        if (!otherId) return null;',
                '        return await base.resolve(getHandle(otherId));',
                '      },',
                '      fs_entries: async ({ id }) => {',
                '        const dir = getHandle(id);',
                '        const out = [];',
                '        let count = 0;',
                '        for await (const item of dir.values()) {',
                '          out.push(serializeHandle(item));',
                '          count += 1;',
                '          if (count >= 2000) break;',
                '        }',
                '        return out;',
                '      },',
                '      fs_is_same_entry: async ({ id, otherId }) => {',
                '        const left = getHandle(id);',
                '        const right = otherId ? getHandle(otherId) : null;',
                '        if (!right || typeof left.isSameEntry !== "function") return false;',
                '        return await left.isSameEntry(right);',
                '      },',
                '      storage_mutate: async ({ scope, op, key, value }) => {',
                '        const area = getStorageArea(scope);',
                '        const action = String(op || "").toLowerCase();',
                '        if (action === "set") {',
                '          area.setItem(String(key), value == null ? "" : String(value));',
                '          return true;',
                '        }',
                '        if (action === "remove") {',
                '          area.removeItem(String(key));',
                '          return true;',
                '        }',
                '        if (action === "clear") {',
                '          area.clear();',
                '          return true;',
                '        }',
                '        throw new Error("Unknown storage mutation op: " + action);',
                '      }',
                '    };',
                '    window.addEventListener("message", async (event) => {',
                '      const msg = event && event.data ? event.data : null;',
                '      if (!msg || !msg.__forgeBridgeReq) return;',
                '      if (msg.token !== BRIDGE_TOKEN) return;',
                '      if (!event.source) return;',
                '      if (frame.contentWindow && event.source !== frame.contentWindow) return;',
                '      const action = msg.action;',
                '      const handler = actionMap[action];',
                '      if (!handler) {',
                '        sendResponse(event.source, msg.id, false, null, "Unknown bridge action: " + action, "Error");',
                '        return;',
                '      }',
                '      try {',
                '        const result = await handler(msg.payload || {});',
                '        sendResponse(event.source, msg.id, true, result, null, null);',
                '      } catch (error) {',
                '        sendResponse(event.source, msg.id, false, null, (error && error.message) ? error.message : String(error), (error && error.name) ? error.name : "Error");',
                '      }',
                '    });',
                '    const propagateHostNonce = (htmlText) => {',
                '      const nonce = window.__firepitCspNonce;',
                '      if (!nonce || typeof nonce !== "string") return htmlText;',
                '      try {',
                '        const parser = new DOMParser();',
                '        const doc = parser.parseFromString(htmlText, "text/html");',
                '        let modified = false;',
                '        doc.querySelectorAll("script").forEach(function(el) { if (!el.hasAttribute("nonce")) { el.setAttribute("nonce", nonce); modified = true; } });',
                '        doc.querySelectorAll("style").forEach(function(el) { if (!el.hasAttribute("nonce")) { el.setAttribute("nonce", nonce); modified = true; } });',
                '        if (!modified) return htmlText;',
                '        var dtStr = (/^\\s*<!doctype/i).test(htmlText) ? "<!DOCTYPE html>" : "";',
                '        return dtStr + doc.documentElement.outerHTML;',
                '      } catch (e) {',
                '        console.warn("Forge: DOMParser nonce injection failed:", e);',
                '        return htmlText;',
                '      }',
                '    };',
                '    const childHtmlWithSeed = injectConfluenceContextSeed(injectSharePointContextSeed(injectStorageSeed(decodeB64Utf8(CHILD_HTML_B64))));',
                '    frame.srcdoc = propagateHostNonce(childHtmlWithSeed);',
                '  } catch (error) {',
                '    console.error("Forge parent bridge shell init failed:", error);',
                '  }',
                '})();'
            ].join('');
            const shellStyleLines = [
                '  <style>',
                ...(useFusionBridgeMode ? [] : ['    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #fff; }']),
                shellRootCss,
                '    #forge-secure-app-frame { width: 100%; height: 100%; border: 0; display: block; background: #fff; }',
	                ...fusionFullscreenCss,
                '    #forge-gesture-panel { position: fixed; inset: 0; background: rgba(8, 18, 28, 0.52); display: flex; align-items: center; justify-content: center; z-index: 999999; }',
                '    #forge-gesture-panel[hidden] { display: none; }',
                '    #forge-gesture-card { width: min(520px, calc(100vw - 24px)); background: #ffffff; border: 1px solid #c9d6e3; border-radius: 10px; padding: 14px; font-family: Segoe UI, Tahoma, Arial, sans-serif; color: #1b2734; }',
                '    #forge-gesture-card h2 { margin: 0 0 8px; font-size: 18px; }',
                '    #forge-gesture-card p { margin: 0 0 12px; font-size: 14px; line-height: 1.4; }',
                '    #forge-gesture-actions { display: flex; gap: 8px; justify-content: flex-end; }',
                '    #forge-gesture-continue, #forge-gesture-cancel { border: 0; border-radius: 8px; padding: 8px 12px; font-weight: 600; cursor: pointer; }',
                '    #forge-gesture-continue { background: #0054a6; color: #fff; }',
                '    #forge-gesture-cancel { background: #51687a; color: #fff; }',
                '  </style>'
            ];
            const shellBodyLines = [
	                '  <div id="forge-secure-shell-root">',
	                `    <iframe id="forge-secure-app-frame" sandbox="${childSandboxAttr}" allow="${childAllowAttr}"></iframe>`,
	                '  </div>',
                '  <div id="forge-gesture-panel" hidden>',
                '    <div id="forge-gesture-card">',
                '      <h2>Action Requires Approval</h2>',
                '      <p id="forge-gesture-message">Click Continue to proceed.</p>',
                '      <div id="forge-gesture-actions">',
                '        <button id="forge-gesture-continue" type="button">Continue</button>',
                '        <button id="forge-gesture-cancel" type="button">Cancel</button>',
                '      </div>',
                '    </div>',
                '  </div>',
                `  ${buildInlineScriptTag(parentScript)}`
            ];
            if (useFusionBridgeMode) {
                return [
                    '<div class="forge-fusion-bridge-macro">',
                    ...shellStyleLines.map((line) => line.replace(/^  /, '')),
                    ...shellBodyLines.map((line) => line.replace(/^  /, '')),
                    '</div>'
                ].join('\n');
            }
            return [
                '<!doctype html>',
                '<html lang="en">',
                '<head>',
                '  <meta charset="utf-8">',
                '  <meta name="viewport" content="width=device-width, initial-scale=1">',
                `  <title>${escapeHtml(shellTitle)}</title>`,
                ...shellStyleLines,
                '</head>',
                '<body>',
                ...shellBodyLines,
                '</body>',
                '</html>'
            ].join('\n');
        };

        if (wasmAssets.length) {
            const wasmRuntimeScript = buildWasmAssetRuntimeScript();
            const wasmRuntimeTag = buildInlineScriptTag(wasmRuntimeScript);
            const source = Array.isArray(html) ? html.join('\n') : String(html || '');
            html = insertIntoHead(source, wasmRuntimeTag);
        }

        // Apply security headers to the HTML if enabled
        if (addSecurityHeaders) {
            html = addSecurityMeta(html);
        }

        // Optional minification
        const minifyFlag = (document.querySelector('#minify-output')?.checked ?? false);
        const minifyHtml = (s) => {
            try {
                // Preserve manifest header if present
                const headerMatch = s.match(/^<!--WFC-MANIFEST:[\s\S]*?-->/);
                const headerKeep = headerMatch ? headerMatch[0] + '\n' : '';
                let body = headerMatch ? s.slice(headerKeep.length) : s;

                const preserveTags = ['script', 'style', 'pre', 'textarea'];
                const openRe = /<\s*(script|style|pre|textarea)\b[^>]*>/i;

                const cssMinify = (css) => {
                    try {
                        // Remove comments
                        css = css.replace(/\/\*[\s\S]*?\*\//g, '');
                        // Remove whitespace around symbols
                        css = css.replace(/\s*([{}:;,>])\s*/g, '$1');
                        // Remove trailing semicolons in blocks
                        css = css.replace(/;\}/g, '}');
                        // Collapse whitespace
                        css = css.replace(/\s+/g, ' ');
                        return css.trim();
                    } catch { return css; }
                };

                const jsMinify = (code) => {
                    try {
                        let out = '';
                        let i = 0;
                        const n = code.length;
                        let inSQ = false, inDQ = false, inTQ = false; // ', ", `
                        let inLC = false, inBC = false; // //, /* */
                        let inRX = false; // regex literal
                        let inClass = false; // regex char class [...]
                        let prevNonSpace = ''; // previous non-whitespace, non-comment char

                        const isWS = (ch) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f';
                        const isLineBreak = (ch) => ch === '\n' || ch === '\r';
                        const mayPrecedeRegex = (ch) => {
                            return (!ch) || /[({[=:,;!%^&|?~<>+\-*/]/.test(ch);
                        };

                        while (i < n) {
                            const ch = code[i];
                            const next = i + 1 < n ? code[i + 1] : '';

                            // Disable stripping of line comments to avoid corrupting URLs like https://
                            if (inLC) {
                                // Should never enter since we no longer set inLC
                                out += ch; prevNonSpace = ch; i++; continue;
                            }
                            if (inBC) { // block comment
                                if (ch === '*' && next === '/') { inBC = false; i += 2; continue; }
                                i++; continue;
                            }
                            if (inSQ) {
                                if (ch === '\\') {
                                    out += ch;
                                    if (i + 1 < n) { out += code[i + 1]; i += 2; } else { i += 1; }
                                    prevNonSpace = ch;
                                    continue;
                                }
                                out += ch; prevNonSpace = ch;
                                if (ch === "'") { inSQ = false; }
                                i++; continue;
                            }
                            if (inDQ) {
                                if (ch === '\\') {
                                    out += ch;
                                    if (i + 1 < n) { out += code[i + 1]; i += 2; } else { i += 1; }
                                    prevNonSpace = ch;
                                    continue;
                                }
                                out += ch; prevNonSpace = ch;
                                if (ch === '"') { inDQ = false; }
                                i++; continue;
                            }
                            if (inTQ) { // template literal
                                if (ch === '\\') {
                                    out += ch;
                                    if (i + 1 < n) { out += code[i + 1]; i += 2; } else { i += 1; }
                                    prevNonSpace = ch;
                                    continue;
                                }
                                out += ch; prevNonSpace = ch;
                                if (ch === '`') { inTQ = false; i++; continue; }
                                i++; continue;
                            }
                            if (inRX) {
                                if (ch === '\\') {
                                    out += ch;
                                    if (i + 1 < n) { out += code[i + 1]; i += 2; } else { i += 1; }
                                    prevNonSpace = ch;
                                    continue;
                                }
                                out += ch; prevNonSpace = ch;
                                if (ch === '[') { inClass = true; i++; continue; }
                                if (inClass && ch === ']') { inClass = false; i++; continue; }
                                if (ch === '/' && !inClass) { // end of regex
                                    inRX = false;
                                }
                                i++; continue;
                            }

                            // Not in any string/comment/regex
                            if (ch === "'") { inSQ = true; out += ch; prevNonSpace = ch; i++; continue; }
                            if (ch === '"') { inDQ = true; out += ch; prevNonSpace = ch; i++; continue; }
                            if (ch === '`') { inTQ = true; out += ch; prevNonSpace = ch; i++; continue; }

                            // detect block comments only
                            if (ch === '/' && next === '*') { inBC = true; i += 2; continue; }

                            // detect regex literal start
                            if (ch === '/' && mayPrecedeRegex(prevNonSpace)) {
                                inRX = true; out += ch; prevNonSpace = ch; i++; continue;
                            }

                            if (isWS(ch)) {
                                // collapse multiple spaces/tabs into one space
                                if (out.length && out[out.length - 1] !== ' ' && !isLineBreak(out[out.length - 1])) {
                                    out += ' ';
                                    prevNonSpace = ' ';
                                }
                                i++;
                                continue;
                            }

                            out += ch;
                            if (!/\s/.test(ch)) prevNonSpace = ch;
                            i++;
                        }

                        return out;
                    } catch { return code; }
                };

                const minifyOutside = (chunk) => {
                    if (!chunk) return '';
                    // Remove HTML comments outside preserved blocks, but keep manifest if any slipped here
                    chunk = chunk.replace(/<!--(?!WFC-MANIFEST:)[\s\S]*?-->/g, '');
                    // Collapse whitespace between tags only
                    chunk = chunk.replace(/>\s+</g, '><');
                    // Trim boundaries
                    return chunk.trim();
                };

                let out = '';
                let i = 0;
                while (i < body.length) {
                    const m = body.slice(i).match(openRe);
                    if (!m) {
                        out += minifyOutside(body.slice(i));
                        break;
                    }
                    const openIdx = i + m.index;
                    const tag = m[1].toLowerCase();
                    const openTag = m[0];
                    // Minify segment before preserved tag
                    out += minifyOutside(body.slice(i, openIdx));
                    out += openTag; // keep opening tag as-is

                    // Find closing tag for this block
                    const closeRe = new RegExp(`<\\s*/\\s*${tag}\\s*>`, 'i');
                    const afterOpenIdx = openIdx + openTag.length;
                    const rest = body.slice(afterOpenIdx);
                    const closeMatch = rest.match(closeRe);
                    if (!closeMatch) {
                        // No closing tag; append remainder untouched
                        out += rest;
                        i = body.length;
                        break;
                    }
                    const inner = rest.slice(0, closeMatch.index);
                    const closeTag = closeMatch[0];
                    if (tag === 'style') {
                        out += cssMinify(inner) + closeTag;
                    } else if (tag === 'script') {
                        out += jsMinify(inner) + closeTag;
                    } else {
                        // Keep inner content untouched for script/pre/textarea
                        out += inner + closeTag;
                    }
                    i = afterOpenIdx + closeMatch.index + closeTag.length;
                }

                return headerKeep + out;
            } catch { return s; }
        };

        const rawCompiledSource = Array.isArray(html) ? html.join('\n') : String(html || '');
        // Strip the unshipped development banner before compiling
        // Built via concatenation so the regex doesn't match itself when WCT compiles itself
        const _bannerTag = 'WCT-UNSHIPPED-' + 'BANNER';
        const _bannerStripRe = new RegExp('\\n?<!-- ' + _bannerTag + ':START -->[\\s\\S]*?<!-- ' + _bannerTag + ':END -->\\n?', 'g');
        const strippedSource = (typeof editor !== 'undefined' && editor.stripUnshippedBanner)
            ? editor.stripUnshippedBanner(rawCompiledSource)
            : rawCompiledSource.replace(_bannerStripRe, '');
        const baseCompiledSource = rewriteInlineEventHandlersForSharePoint(strippedSource);
        const buildCompiledBody = (useMinifiedVersion) => {
            let body = baseCompiledSource;
            if (useMinifiedVersion) {
                body = minifyHtml(body);
            }
            if (addSecurityHeaders) {
                const childBridgeBootstrapScript = buildChildBridgeBootstrapScript();
                const bridgedChildHtml = injectInlineScriptIntoHead(body, childBridgeBootstrapScript);
                body = buildParentBridgeShellHtml(bridgedChildHtml);
            }
            return body;
        };

        let compiledBody = buildCompiledBody(minifyFlag);

        // Prepend manifest annotation as an HTML comment containing base64 JSON
        const manifestJson = JSON.stringify(manifest);
        const manifestB64 = (function (str) {
            try {
                return btoa(unescape(encodeURIComponent(str)));
            } catch (e) {
                // Fallback for environments without unescape
                return btoa(str);
            }
        })(manifestJson);
        const header = `<!--WFC-MANIFEST:${manifestB64}-->`;
        let finalHtml = `${header}\n${compiledBody}`;
        let validationErrors = collectCompiledArtifactValidationErrors(finalHtml);
        if (validationErrors.length && minifyFlag) {
            const fallbackBody = buildCompiledBody(false);
            const fallbackFinalHtml = `${header}\n${fallbackBody}`;
            const fallbackValidationErrors = collectCompiledArtifactValidationErrors(fallbackFinalHtml);
            if (!fallbackValidationErrors.length) {
                compiledBody = fallbackBody;
                finalHtml = fallbackFinalHtml;
                validationErrors = [];
                try {
                    alert('Minified output produced malformed inline JavaScript for this app. Forge shipped a non-minified build instead.');
                } catch (_) { }
            }
        }
        if (reportCompiledArtifactValidationFailure(validationErrors)) {
            return;
        }

        const blob = new Blob([finalHtml], { type: "text/html;charset=utf-8" });

        // Determine output filename from user input, defaulting to folder name
        const normalizedShipTarget = this.normalizeShipTarget(opts.shipTarget);
        const inputEl = document.querySelector('#compile-filename');
        let rawName = (inputEl && typeof inputEl.value === 'string') ? inputEl.value.trim() : '';
        if (!rawName) {
            rawName = (loadFolder.fileHandle && loadFolder.fileHandle.name) ? loadFolder.fileHandle.name : 'compiled-app';
        }
        // Sanitize for filesystem safety
        rawName = rawName.replace(/[\\/:*?"<>|]+/g, '_').trim();
        if (!rawName) rawName = 'compiled-app';
        // Append SharePoint suffix when shipping for SharePoint
        if (opts.forceNoSecurityHeaders) {
            const suffix = normalizedShipTarget === 'legacy-sharepoint'
                ? ' - Legacy Sharepoint'
                : normalizedShipTarget === 'fusion-wiki'
                    ? ' - Fusion Wiki'
                    : normalizedShipTarget === 'fusion-wiki-fullscreen'
                        ? ' - Fusion Wiki Fullscreen'
                : ' - Only Secure in FS Sharepoint';
            const extMatch = rawName.match(/\.(?:html?|aspx)$/i);
            if (extMatch) {
                rawName = rawName.slice(0, extMatch.index) + suffix + extMatch[0];
            } else {
                rawName = rawName + suffix;
            }
        }
        if (normalizedShipTarget === 'legacy-sharepoint') {
            rawName = rawName.replace(/\.(?:html?|aspx)$/i, '') + '.aspx';
        }
        const baseOutName = (/\.(?:html?|aspx)$/i).test(rawName) ? rawName : (rawName + '.html');

        // Compute and persist SHA-256 hash log in project root
        const sha256Hex = async (str) => {
            const enc = new TextEncoder();
            const data = enc.encode(str);
            const digest = await crypto.subtle.digest('SHA-256', data);
            const arr = Array.from(new Uint8Array(digest));
            return arr.map(b => b.toString(16).padStart(2, '0')).join('');
        };
        const hashHex = await sha256Hex(finalHtml);
        let outName = baseOutName;

        if (opts.saveToShippedApps) {
            try {
                const shipResult = await this.saveCompiledArtifactToShippedApps({
                    finalHtml,
                    outName: baseOutName,
                    hashHex,
                    releaseType: opts.shipReleaseType,
                    shipTarget: opts.shipTarget,
                    copyToClipboard: opts.copyToClipboardAfterSave,
                    shipSavedModalTitle: opts.shipSavedModalTitle,
                    clipboardSuccessMessage: opts.clipboardSuccessMessage,
                    clipboardFailureMessage: opts.clipboardFailureMessage,
                    deploymentInstructionsHtml: opts.deploymentInstructionsHtml
                });
                outName = shipResult.outName;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || 'Could not save shipped build.');
                alert(message);
                return;
            }
        }

        // Keep last compiled output in memory for other tabs (e.g., split bookmarklet embedding).
        this.lastCompiledHtml = finalHtml;
        this.lastCompiledName = outName;
        this.lastCompiledAt = new Date().toISOString();

        if (!opts.skipDownload) {
            saveAs(blob, outName);
            if (opts.showCampfireAfterDownload) {
                setTimeout(() => this.showCampfireShareModal(), 250);
            }
        }

        if (!opts.skipHashLog) try {
            const root = loadFolder.fileHandle;
            let logHandle = await root.getFileHandle('compiled-hashes.csv', { create: true });
            let existing = '';
            try { existing = await (await logHandle.getFile()).text(); } catch { existing = ''; }
            const ts = new Date().toISOString();
            const line = `${ts},${outName},${hashHex}\n`;
            const writable = await logHandle.createWritable();
            await writable.write(existing + line);
            await writable.close();
            // Show hash to user
            const hashInfo = document.createElement('div');
            hashInfo.className = 'mt-2';
            const infoText = document.createElement('small');
            infoText.classList.add('text-info');
            infoText.append('SHA-256: ');
            const hashCode = document.createElement('code');
            hashCode.textContent = hashHex;
            infoText.appendChild(hashCode);
            infoText.append(' (logged in compiled-hashes.csv)');
            hashInfo.appendChild(infoText);
            const resultsContainer = document.querySelector('#compiler-results');
            resultsContainer?.prepend(hashInfo);
        } catch (e) {
            console.warn('Could not write compiled-hashes.csv:', e);
        }
        return {
            finalHtml,
            compiledBody,
            blob,
            outName,
            hashHex
        };
    },

    extractFileName: (line, regex) => (line.match(regex) || [])[1]?.split('/').pop() || null,

    writeResults(found, missing, extra = {}) {
        let html = "";
        const compatibilityIssues = extra?.compatibilityIssues || [];
        if (compatibilityIssues.length > 0) {
            const presentation = this.getCompatibilityWarningPresentation(compatibilityIssues);
            html += `
                <div class="alert alert-warning">
                    <h5 class="mb-2">${this.escapeHtml(presentation.title)}</h5>
                    <p class="mb-2">${this.escapeHtml(presentation.intro)}</p>
                    ${compatibilityIssues.map((issue, idx) => `
                        <div class="mb-2 p-2" style="border:1px solid #7a5f00; border-radius:4px; background:#2b2510;">
                            <div><strong>${idx + 1}. ${this.escapeHtml(issue.name)}</strong></div>
                            <div class="small">${this.escapeHtml(issue.reason)}</div>
                            <details class="mt-1">
                                <summary style="cursor:pointer;">Remediation</summary>
                                <pre class="mt-1 mb-0 p-2 small" style="white-space:pre-wrap; border:1px solid #495057; border-radius:4px;">${this.escapeHtml(issue.remediation)}</pre>
                            </details>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        html += "<h4>Compilation Report:</h4>";
        const createTable = (title, lines, showReplace) => {
            let table = `<h5>${title}</h5><table class="table table-bordered table-dark table-sm"><thead><tr><th>#</th><th>Original Line</th>`;
            if (showReplace) table += "<th>Replacement File</th>";
            table += "</tr></thead><tbody>";
            lines.forEach((line, i) => {
                table += `<tr><td>${i + 1}</td><td>${line.original.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`;
                if (showReplace) table += `<td>${line.replace}</td>`;
                table += "</tr>";
            });
            return table + "</tbody></table>";
        };
        html += createTable("Altered Javascript Lines", found.js, true);
        html += createTable("Unaltered Javascript Lines", missing.js, false);
        html += createTable("Altered CSS Lines", found.css, true);
        html += createTable("Unaltered CSS Lines", missing.css, false);
        if ((found.img && found.img.length) || (missing.img && missing.img.length)) {
            html += createTable("Altered IMG Lines", found.img, true);
            html += createTable("Unaltered IMG Lines", missing.img, false);
        }
        if ((found.wasm && found.wasm.length) || (missing.wasm && missing.wasm.length)) {
            html += createTable("Packaged WASM Assets", found.wasm || [], true);
            html += createTable("Unpackaged WASM Assets", missing.wasm || [], false);
        }
        $("#compiler-results").html(html);
    }
};

// Verify uploaded HTML against logged hashes
compiler.verifyUploadedHash = async function () {
    try {
        const input = document.querySelector('#hash-verify-file');
        const resultEl = document.querySelector('#hash-verify-result');
        if (!input || !input.files || !input.files[0]) {
            alert('Please choose an HTML file to verify.');
            return;
        }
        const file = input.files[0];
        const text = await file.text();
        const enc = new TextEncoder();
        const data = enc.encode(text);
        const digest = await crypto.subtle.digest('SHA-256', data);
        const arr = Array.from(new Uint8Array(digest));
        const hashHex = arr.map(b => b.toString(16).padStart(2, '0')).join('');

        // Read log from project root
        let logText = '';
        try {
            const handle = await loadFolder.fileHandle.getFileHandle('compiled-hashes.csv', { create: false });
            logText = await (await handle.getFile()).text();
        } catch {
            logText = '';
        }
        const lines = logText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const matches = lines.filter(l => l.split(',').slice(-1)[0] === hashHex);
        if (resultEl) {
            resultEl.replaceChildren();
            const statusSpan = document.createElement('span');
            const hashSmall = document.createElement('small');
            const hashCode = document.createElement('code');
            hashCode.textContent = hashHex;
            hashSmall.append('SHA-256: ');
            hashSmall.appendChild(hashCode);

            if (matches.length > 0) {
                statusSpan.classList.add('text-success');
                statusSpan.textContent = 'Match found.';
                const entriesSmall = document.createElement('small');
                const entriesCode = document.createElement('code');
                entriesCode.textContent = matches.join(' | ');
                entriesSmall.append('Entries: ');
                entriesSmall.appendChild(entriesCode);
                resultEl.append(statusSpan, document.createTextNode(' '), hashSmall, document.createElement('br'), entriesSmall);
            } else {
                statusSpan.classList.add('text-danger');
                statusSpan.textContent = 'No match in compiled-hashes.csv';
                resultEl.append(statusSpan, document.createTextNode(' '), hashSmall);
            }
        }
    } catch (e) {
        console.error('Verification failed:', e);
        alert('Verification failed: ' + (e.message || e));
    }
};
