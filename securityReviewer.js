/* securityReviewer.js
 * Adds a Security Reviewer tab that:
 * 1. Lets user build the ASD STIG prompt with current repo code concatenated (filtered options)
 * 2. Provides a textarea for pasting LLM JSON output & renders a rich report + allow saving
 * 3. Offers a lightweight static analyzer to pre-populate evidence hints (optional)
 */

const securityReviewer = {
    _setSafeContent(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
        el.replaceChildren(frag);
    },
    state: {
        lastScan: null,
        jsonResult: null,
        autoSelect: true,
        lastSBOM: null
    },
    _delegatedBound: false,

    init() {
        const pane = document.getElementById('security-reviewer');
        if (!pane) return;
        this._setSafeContent(pane, this.renderBase());
        this.bind();
    },

    onProjectLoaded() {
        // If tab already initialized, refresh file list (checkboxes)
        if (document.getElementById('sec-files')) {
            this.populateFileList();
        }
    },

    clearTransient() {
        // Keep pasted JSON & scan results; transient clearing could be minimal for performance
        // Could add logic later if needed
    },

    renderBase() {
        return `
            <h3>ASD STIG Security Reviewer</h3>
            <p>Generate a structured security review prompt, scan your static project for potential evidence, and format an LLM's JSON response into a readable guide.</p>
            <div class="row">
                <div class="col-md-5">
                    <h5 class="text-info">1. Select Files for Prompt Context</h5>
                    <div id="sec-file-controls" class="mb-2">
                        <button class="btn btn-sm btn-outline-secondary" id="sec-select-all">Select All</button>
                        <button class="btn btn-sm btn-outline-secondary" id="sec-select-none">Select None</button>
                        <button class="btn btn-sm btn-outline-secondary" id="sec-refresh-files">Refresh</button>
                    </div>
                    <div id="sec-files" style="max-height:40vh; overflow:auto; border:1px solid #444; border-radius:4px; padding:6px; background:#1e252b; font-size:0.8rem;"></div>
                    <div class="form-check mt-2">
                        <input class="form-check-input" type="checkbox" id="sec-auto-trim" checked />
                        <label class="form-check-label" for="sec-auto-trim">Trim excessively long/minified lines</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="sec-include-readme" checked />
                        <label class="form-check-label" for="sec-include-readme">Prioritize README / docs at top</label>
                    </div>
                    <button class="btn btn-primary btn-sm mt-2" id="sec-generate-prompt">Generate Prompt</button>
                    <button class="btn btn-secondary btn-sm mt-2 ml-1" id="sec-run-scan">Run Local Scan</button>
                    <div id="sec-scan-status" class="small text-muted mt-1"></div>
                </div>
                <div class="col-md-7">
                    <h5 class="text-info">2. Prompt Output</h5>
                    <textarea id="sec-prompt-out" class="form-control mb-2" rows="14" placeholder="Prompt will appear here..." readonly></textarea>
                    <div>
                        <button class="btn btn-sm btn-info" id="sec-copy-prompt">Copy Prompt</button>
                    </div>
                    <hr/>
                    <h5 class="text-info">3. Paste LLM JSON Result</h5>
                    <textarea id="sec-json-in" class="form-control" rows="10" placeholder='Paste the LLM JSON object result here...'></textarea>
                    <div class="mt-2">
                        <button class="btn btn-sm btn-success" id="sec-parse-json">Parse & Render</button>
                        <button class="btn btn-sm btn-outline-danger ml-1" id="sec-clear-json">Clear</button>
                        <button class="btn btn-sm btn-outline-secondary ml-1" id="sec-download-json" disabled>Download JSON</button>
                        <button class="btn btn-sm btn-outline-secondary ml-1" id="sec-export-html" disabled>Export HTML Report</button>
                    </div>
                </div>
            </div>
            <hr/>
            <h5 class="text-info">4. Security Implementation Summary (SIS)</h5>
            <p class="small text-muted">Generate formal RMF Security Implementation Summary documentation based on application configuration and security assessments.</p>
            <div class="row mb-3">
                <div class="col-md-6">
                    <div class="form-group">
                        <label for="sis-system-name">System Name:</label>
                        <input type="text" id="sis-system-name" class="form-control form-control-sm" placeholder="e.g., Warfighter Application Tool">
                    </div>
                    <div class="form-group">
                        <label for="sis-version">Version:</label>
                        <input type="text" id="sis-version" class="form-control form-control-sm" placeholder="e.g., 1.0.0">
                    </div>
                    <div class="form-group">
                        <label for="sis-classification">Classification:</label>
                        <select id="sis-classification" class="form-control form-control-sm">
                            <option value="UNCLASSIFIED">UNCLASSIFIED</option>
                            <option value="CUI">CUI</option>
                            <option value="CONFIDENTIAL">CONFIDENTIAL</option>
                            <option value="SECRET">SECRET</option>
                        </select>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="form-group">
                        <label for="sis-organization">Organization:</label>
                        <input type="text" id="sis-organization" class="form-control form-control-sm" placeholder="e.g., DOD Component">
                    </div>
                    <div class="form-group">
                        <label for="sis-authorizing-official">Authorizing Official:</label>
                        <input type="text" id="sis-authorizing-official" class="form-control form-control-sm" placeholder="Name and Title">
                    </div>
                    <div class="form-group">
                        <label for="sis-environment">Environment:</label>
                        <select id="sis-environment" class="form-control form-control-sm">
                            <option value="Air-Gapped">Air-Gapped</option>
                            <option value="Isolated Network">Isolated Network</option>
                            <option value="Standard Network">Standard Network</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="mb-2">
                <button class="btn btn-primary btn-sm" id="sec-generate-sis">Generate SIS Document</button>
                <button class="btn btn-secondary btn-sm ml-1" id="sec-export-sis" disabled>Export SIS</button>
                <button class="btn btn-info btn-sm ml-1" id="sec-export-sbom" disabled>Export SBOM (JSON)</button>
            </div>
            <div id="sec-sis-output" style="min-height:100px; border:1px solid #444; border-radius:4px; padding:10px; background:#192026; display:none;"></div>
            <hr/>
            <h5 class="text-info">5. Rendered Report</h5>
            <div id="sec-rendered" style="min-height:150px; border:1px solid #444; border-radius:4px; padding:10px; background:#192026;"></div>
        `;
    },

    bind() {
        this.populateFileList();
        document.getElementById('sec-refresh-files').addEventListener('click', () => this.populateFileList());
        document.getElementById('sec-select-all').addEventListener('click', () => this.toggleAll(true));
        document.getElementById('sec-select-none').addEventListener('click', () => this.toggleAll(false));
        document.getElementById('sec-generate-prompt').addEventListener('click', () => this.generatePrompt());
        document.getElementById('sec-copy-prompt').addEventListener('click', () => this.copyPrompt());
        document.getElementById('sec-run-scan').addEventListener('click', () => this.runScan());
        document.getElementById('sec-parse-json').addEventListener('click', () => this.parseJson());
        document.getElementById('sec-clear-json').addEventListener('click', () => this.clearJson());
        document.getElementById('sec-download-json').addEventListener('click', () => this.downloadJson());
        document.getElementById('sec-export-html').addEventListener('click', () => this.exportHtml());
        document.getElementById('sec-generate-sis').addEventListener('click', () => this.generateSIS());
        document.getElementById('sec-export-sis').addEventListener('click', () => this.exportSIS());
        document.getElementById('sec-export-sbom').addEventListener('click', () => this.exportSBOMJson());

        // Delegated copy handler (once) for remediation prompts
        if (!this._delegatedBound) {
            document.addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest('.sec-copy-rem');
                if (!btn) return;
                const id = btn.getAttribute('data-copy-target');
                if (!id) return;
                const pre = document.getElementById(id);
                if (!pre) {
                    // Graceful fallback (no alert spam)
                    const old = btn.textContent;
                    btn.textContent = 'Not found';
                    setTimeout(()=>{ btn.textContent = old; }, 1200);
                    return;
                }
                try {
                    navigator.clipboard.writeText(pre.textContent).then(()=>{
                        const old = btn.textContent;
                        btn.textContent = 'Copied!';
                        setTimeout(()=>{ btn.textContent = old; }, 1200);
                    }).catch(err => {
                        const old = btn.textContent;
                        btn.textContent = 'Denied';
                        console.warn('Clipboard denied:', err);
                        setTimeout(()=>{ btn.textContent = old; }, 1400);
                    });
                } catch(err) {
                    console.warn('Copy handler error', err);
                }
            });
            this._delegatedBound = true;
        }
    },

    populateFileList() {
        const box = document.getElementById('sec-files');
        if (!loadFolder.fileHandle) {
            box.replaceChildren();
            const em = document.createElement('em');
            em.textContent = 'Load a directory first.';
            box.appendChild(em);
            return;
        }
        const exts = ['js','html','css','json','md','txt'];
        const files = loadFolder.fileStructure.filter(f => f.kind==='file' && exts.includes((f.type||'').toLowerCase()));
        files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
        this._setSafeContent(box, files.map(f => {
            const id = 'sec-file-' + f.uuid;
            return `<div><label style='cursor:pointer;'><input type='checkbox' data-uuid='${f.uuid}' checked id='${id}' /> <span>${this.escapeHtml(f.relativePath)}</span></label></div>`;
        }).join(''));
    },

    toggleAll(state) {
        document.querySelectorAll('#sec-files input[type="checkbox"]').forEach(cb => cb.checked = state);
    },

    async generatePrompt() {
        if (!loadFolder.fileHandle) { alert('Load a directory first.'); return; }
        const selected = Array.from(document.querySelectorAll('#sec-files input[type="checkbox"]:checked'));
        if (!selected.length) { alert('Select at least one file.'); return; }
        const includeReadme = document.getElementById('sec-include-readme').checked;
        const trim = document.getElementById('sec-auto-trim').checked;
        const lines = [];

        // Base prompt (provided by user spec)
        const basePrompt = this.getBasePrompt();
        lines.push(basePrompt.trim());
        lines.push('\n\n===== CODEBASE FILES START =====');

        // Gather file contents
        const fileMap = new Map();
        for (const cb of selected) {
            const uuid = cb.getAttribute('data-uuid');
            const file = loadFolder.fileStructure.find(f => f.uuid===uuid);
            if (!file) continue;
            const content = await loadFolder.getFileContent(file);
            fileMap.set(file.relativePath, content);
        }

        // Promote README-like files first if option selected
        const ordered = Array.from(fileMap.entries());
        if (includeReadme) {
            ordered.sort((a,b)=>{
                const ar = /readme|security|hardening|config/i.test(a[0]) ? 0 : 1;
                const br = /readme|security|hardening|config/i.test(b[0]) ? 0 : 1;
                if (ar!==br) return ar-br;
                return a[0].localeCompare(b[0]);
            });
        } else {
            ordered.sort((a,b)=>a[0].localeCompare(b[0]));
        }

        for (const [path, content] of ordered) {
            lines.push(`\n----- FILE: ${path} -----`);
            const processed = trim ? this.trimContent(content) : content;
            lines.push(processed);
        }
        lines.push('\n===== CODEBASE FILES END =====');

        const out = lines.join('\n');
        const ta = document.getElementById('sec-prompt-out');
        ta.value = out;
        ta.scrollTop = 0;
    },

    getBasePrompt() {
        // Strictly reuse provided PROMPT block with minimal formatting adjustments
        return `You are a security reviewer. Audit the provided offline, static HTML/CSS/JS codebase against the Application Security & Development STIG controls listed below.
Assume: No server, no accounts/sessions, no network calls are required. Everything runs client-side.

Scope — Controls to Assess (exact IDs)

Data handling

V-222388 — Clear temporary storage and cookies when the session is terminated (scope this to sensitive credential/authentication data, not all browser storage).

V-222601 — Do not store sensitive information in hidden fields.

V-222642 — No embedded authentication data or secrets in code.

Input handling / XSS

V-222602 — Protect from XSS (incl. DOM-based).

V-222606 — Validate all input & handle canonical representation.

Mobile code (client-side)

V-222665 — Do not use unapproved/uncategorized mobile code; JavaScript is allowed, ActiveX/Flash/etc. are not.

Process / hygiene for static apps

V-222627 — Use vendor/industry guidance when no STIG exists (applies to third-party JS/libs).

V-222614 — Keep security-relevant software updates and patches current (third-party JS/libs).

What you’re given

Full repository tree and file contents (HTML, CSS, JS, README/SECURITY docs, build notes).

If present: lockfiles (e.g., package-lock.json), CDN script tags, versions in comments.

Your tasks (do all)

Search & Evidence Gathering

Identify exact file paths and line ranges that show compliance or violations.

Prefer static analysis; do not invent behavior that isn’t evident in the files.

Decide Applicability

If a control’s situation never arises (e.g., no storage used), mark Not Applicable (N/A) and explain why.

Assess Compliance

For each applicable control, return Compliant / Non-Compliant / Partially Compliant / Unable to Determine.

Always include concrete evidence (snippets + locations) and risk.

Recommend Remediation

Provide minimal, safe code changes (exact snippets) and where to place them.

For library updates, propose a version and why (e.g., known CVE, EOL).

Summarize

Give a prioritized fix list (highest risk/least effort first).

Heuristics per Control (what to look for)
V-222388 (clear sensitive credential/auth storage/cookies on end)

Look for use of localStorage, sessionStorage, IndexedDB, document.cookie.

Evidence of targeted clearing on exit/explicit Close/Logout for sensitive credential/authentication data only (for example token/session/auth/password/API-key related keys and cookies).

Violation examples: credential/auth artifacts stored in browser storage with no targeted clearing path.

Do NOT require clearing all localStorage/sessionStorage if non-sensitive preferences are present (theme, UI settings, cached non-sensitive app state).

Remedy: implement selective key removal for sensitive credential/auth data and call it on exit/user action.

V-222601 (no sensitive info in hidden fields)

Scan for <input type="hidden"> and DOM-created hidden inputs.

Flag if values include keys, tokens, emails, PII, user identifiers, classification markings, or config secrets.

Remedy: remove; store only non-sensitive identifiers; compute at runtime.

V-222642 (no embedded auth/secrets)

Secret patterns: apiKey, secret, token, bearer, Authorization, password, clientId/clientSecret.

Regex hints: AKIA[0-9A-Z]{16}, AIza[0-9A-Za-z_-]{35}, ghp_[A-Za-z0-9]{36,}, xox[baprs]-.

Also search .env, comments, and minified assets; check <script src> querystrings.

Remedy: remove hardcoded secrets; use offline mock data; if unavoidable, gate with user-provided file input at runtime.

V-222602 (XSS)

Flag unsafe sinks: innerHTML, outerHTML, document.write, insertAdjacentHTML, dangerouslySetInnerHTML, <iframe srcdoc>.

Check if inputs/URL fragments/LocalStorage values are inserted into DOM without sanitization.

**IMPORTANT - Compilation Security Features (Current Behavior)**: You are reviewing SOURCE CODE before compilation. When "Add security headers" is enabled, Forge currently adds:

1. **Restrictive CSP/meta policies**:
   - "default-src 'none'"
   - "connect-src 'none'" by default (or explicit allowlisted origins if configured in compiler settings)
   - "form-action 'none'"
   - "frame-src 'none'"
   - "object-src 'none'"
   - "manifest-src 'none'"
   - "script-src 'unsafe-inline'"
   - "style-src 'unsafe-inline'"

2. **Runtime navigation hardening scripts**:
   - Sanitizes href/action/src/srcdoc/meta-refresh and neutralizes risky <link rel> hints
   - Blocks GET form submissions and strips query strings from navigations
   - Strips URL paths for sanitized external-open flows
   - Requires explicit user approval before first outbound API call when connect-src allowlist is configured

3. **Isolated runtime shell (when security headers are on)**:
   - Runs app inside sandboxed iframe
   - Mediates sensitive host actions through a parent bridge (open URL, file picker APIs)

**Do NOT assume protections that are not currently implemented**:
- No automatic Trusted Types enforcement
- No automatic DOMPurify policy injection
- No CSP script/style hash allow-list enforcement
- No guaranteed automatic rewrite of inline event handlers

**How to Assess Source Code**:

1. **For innerHTML/outerHTML/insertAdjacentHTML usage**:
   - If untrusted data can reach sink without sanitizer/encoding, mark NON-COMPLIANT or PARTIALLY COMPLIANT.
   - Do not mark compliant solely because compile hardening is enabled.

2. **For inline event handlers**:
   - Treat inline handlers as increased XSS risk and maintainability risk.
   - Recommend migration to explicit addEventListener with named functions.

3. **For network requests**:
   - "connect-src 'none'" blocks fetch/XHR/WebSocket/EventSource by default in hardened builds; explicitly allowlisted origins are exceptions.
   - Mark NON-COMPLIANT if core app behavior depends on network access and no secure offline fallback exists.

4. **For style injection**:
   - Because "style-src 'unsafe-inline'" is used, evaluate style sinks directly.
   - If untrusted input is concatenated into style strings/attributes, mark as risk and recommend refactor.

**Remedy Recommendations**:
- Replace unsafe DOM sinks with safe APIs (textContent, createElement, explicit attribute setting) or explicit sanitizer usage in app code.
- Move inline handlers into external functions and bind via addEventListener.
- Refactor dynamic style string construction to class toggles/CSS variables where possible.

V-222606 (validate/canonicalize input)

If any user input/files are processed: normalize (trim, lower/upper case, decode once), then whitelist-validate type/length/pattern.

Remedy: centralize validateInput(value, schema) plus normalization step; reject on failure.

V-222665 (mobile code)

Forbid: ActiveX, Flash, Java applets, VBScript, Silverlight, old plug-ins.

Red flags: <object>, <embed>, <applet>, ActiveXObject, .swf, .xap, classid=.

Remedy: use plain JS/HTML5 only.

V-222627 (use vendor guidance if no STIG)

For each third-party lib (CDN or bundled), link to vendor hardening notes or docs; ensure recommended secure configs are used.

Remedy: add doc references; disable risky defaults.

V-222614 (keep updates/patches current)

Identify third-party scripts: <script src="...cdn...">, versioned filenames, comments.

Check for SRI attributes on CDN tags; recommend adding if missing.

Propose updating clearly outdated libs (e.g., jQuery 1.x/2.x, old CodeMirror/Bootstrap) with minimal-risk newer versions.

Output format (strict JSON)

Return a single JSON object with:

{
  "summary": {
    "overall_status": "Compliant | Partially Compliant | Non-Compliant | Mixed | Unable to Determine",
    "high_risk_findings": ["<control_id> - short title", "..."],
    "quick_wins": ["<action>", "..."]
  },
  "controls": [
    {
      "control_id": "V-222388",
      "title": "Clear sensitive credential storage/cookies on termination",
      "applicability": "Applicable | Not Applicable",
      "status": "Compliant | Partially Compliant | Non-Compliant | Unable to Determine",
      "evidence": [
        {"path": "src/app.js", "lines": "120-158", "snippet": "window.addEventListener('pagehide', ..."}
      ],
      "risk": "Why this matters in this app",
            "remediation": {
                "fix_summary": "One-sentence description of the needed change.",
                "remediation_prompt": "Standalone AI prompt developers can use (with codebase) to generate ONLY the secure patch for this control; restate violation, desired secure outcome, constraints (static offline app, no server), and enumerate exact file paths & line ranges to modify.",
                "steps": [
                    "Add onbeforeunload/pagehide or explicit logout handler to clear sensitive credential keys only",
                    "Replace innerHTML with textContent in file X"
                ],
                "code_example": {
                    "path": "js/security.js",
                    "language": "javascript",
                    "content": "const SENSITIVE_KEY=/token|auth|session|jwt|bearer|secret|apikey|password/i;window.addEventListener('pagehide',()=>{try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i)||'';if(SENSITIVE_KEY.test(k))localStorage.removeItem(k);}for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i)||'';if(SENSITIVE_KEY.test(k))sessionStorage.removeItem(k);}document.cookie.split(';').map(c=>c.trim().split('=')[0]).filter(name=>SENSITIVE_KEY.test(name)).forEach(name=>{document.cookie=name+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';});}catch(e){}});"
                }
            }
    }
    // ... one object per control in the same structure
  ]
}

Reporting rules

Cite exact locations for every claim (path + line range + short snippet).

Prefer N/A over guessing. Use Unable to Determine if minified or missing sources hide evidence.

Keep remediation minimal, concrete, and safe for an offline static app.

If recommending a library update, name the current version (if visible) and a safe target, and note SRI addition for CDN tags.

Scoring rubric

Compliant: explicit safe implementation present.

Partially: some flows safe, others not; or missing edge handling.

Non-Compliant: risky pattern present or a required control absent.

N/A: the situation never occurs in this app.

Unable to Determine: evidence obscured (e.g., minified vendor bundle, no source).`;
    },

    trimContent(text) {
        // Remove very long lines (likely minified) by truncating
        const MAX = 240; // per line
        return text.split(/\r?\n/).map(l => l.length>MAX ? l.slice(0,MAX)+` /* trimmed ${l.length-MAX} chars */` : l).join('\n');
    },

    async runScan() {
        if (!loadFolder.fileHandle) { alert('Load a directory first.'); return; }
        const status = document.getElementById('sec-scan-status');
        status.textContent = 'Scanning...';
        const patterns = this.getScanPatterns();
        const findings = [];
        for (const file of loadFolder.fileStructure) {
            if (file.kind !== 'file') continue;
            try {
                const text = await loadFolder.getFileContent(file);
                const lines = text.split(/\r?\n/);
                patterns.forEach(p => {
                    for (let i=0;i<lines.length;i++) {
                        if (p.regex.test(lines[i])) {
                            findings.push({ control: p.control, note: p.note, path: file.relativePath, line: i+1, excerpt: lines[i].trim().slice(0,250) });
                            p.regex.lastIndex = 0; // reset if global
                        }
                    }
                });
            } catch(e){/* ignore */}
        }
        this.state.lastScan = findings;
        status.textContent = findings.length ? `Scan complete: ${findings.length} potential evidence lines.` : 'Scan complete: no notable patterns.';
        if (findings.length) {
            // Append a helper section under rendered div
            const rendered = document.getElementById('sec-rendered');
            const html = `<div class='mt-2'><h6>Local Scan Hints (${findings.length})</h6>` + findings.slice(0,200).map(f=>`<div style='font-size:0.75rem; border-bottom:1px solid #233;'>[${this.escapeHtml(f.control)}] <strong>${this.escapeHtml(f.path)}:${f.line}</strong> — ${this.escapeHtml(f.excerpt)}</div>`).join('') + (findings.length>200?`<div>... truncated ...</div>`:'') + `</div>`;
            rendered.insertAdjacentHTML('beforeend', html);
        }
    },

    getScanPatterns() {
        return [
            { control:'V-222642', note:'Possible secret-like token', regex:/(api[_-]?key|secret|token|bearer|password|client(id|secret))/i },
            { control:'V-222602', note:'Potential unsafe HTML sink', regex:/(innerHTML|outerHTML|insertAdjacentHTML|document\.write)/ },
            { control:'V-222388', note:'Storage usage', regex:/(localStorage|sessionStorage|indexedDB|document\.cookie)/ },
            { control:'V-222665', note:'Legacy plugin/embed', regex:/(<object|<embed|<applet|ActiveXObject)/i },
            { control:'V-222601', note:'Hidden input', regex:/<input[^>]+type\s*=\s*['"]hidden['"]/i },
            { control:'V-222600', note:'Console logging (review for data exposure)', regex:/console\.(log|error|warn)/ }
        ];
    },

    parseJson() {
        const raw = document.getElementById('sec-json-in').value.trim();
        if (!raw) { alert('Paste JSON first.'); return; }
        try {
            const obj = JSON.parse(raw);
            this.state.jsonResult = obj;
            this.renderJson(obj);
            document.getElementById('sec-download-json').disabled = false;
            document.getElementById('sec-export-html').disabled = false;
        } catch (e) {
            alert('Invalid JSON: ' + e.message);
        }
    },

    clearJson() {
        document.getElementById('sec-json-in').value='';
        this.state.jsonResult = null;
        document.getElementById('sec-rendered').textContent='';
        document.getElementById('sec-download-json').disabled = true;
        document.getElementById('sec-export-html').disabled = true;
    },

    renderJson(obj) {
        const container = document.getElementById('sec-rendered');
        if (!obj || typeof obj !== 'object') {
            container.replaceChildren();
            const em = document.createElement('em');
            em.textContent = 'No JSON parsed.';
            container.appendChild(em);
            return;
        }
        const controls = Array.isArray(obj.controls) ? obj.controls : [];
        const summary = obj.summary || {};
        const esc = this.escapeHtml;
        let html = '';
        html += `<div class='mb-3'>` +
            `<h5>Summary</h5>` +
            `<div><strong>Overall:</strong> ${esc(summary.overall_status||'')}</div>` +
            this.renderListBlock('High Risk Findings', summary.high_risk_findings, esc) +
            this.renderListBlock('Quick Wins', summary.quick_wins, esc) +
            `</div>`;
        html += `<div><h5>Controls (${controls.length})</h5>`;
        controls.forEach(c => {
            html += `<div style='border:1px solid #2d3238; background:#1f252a; padding:8px; margin-bottom:8px; border-radius:4px;'>`+
                `<div style='font-size:0.9rem;'><strong>${esc(c.control_id||'')}</strong> – ${esc(c.title||'')}</div>`+
                `<div style='font-size:0.75rem; opacity:0.8;'>Applicability: ${esc(c.applicability||'')} | Status: <span class='${this.statusClass(c.status)}'>${esc(c.status||'')}</span></div>`+
                (c.risk?`<div style='margin-top:4px; font-size:0.8rem;'><em>Risk:</em> ${esc(c.risk)}</div>`:'')+
                this.renderEvidence(c.evidence, esc)+
                this.renderRemediation(c.remediation, esc)+
                `</div>`;
        });
        html += '</div>';
    this._setSafeContent(container, html);
    },

    renderListBlock(title, arr, esc) {
        if (!Array.isArray(arr) || !arr.length) return '';
        return `<div style='margin-top:4px;'><strong>${esc(title)}:</strong><ul style='margin:4px 0 4px 18px; padding:0;'>` + arr.map(i=>`<li style='font-size:0.75rem;'>${esc(i)}</li>`).join('') + '</ul></div>';
    },

    renderEvidence(evd, esc) {
        if (!Array.isArray(evd) || !evd.length) return '';
        return `<details style='margin-top:4px;'>`+
            `<summary style='cursor:pointer; font-size:0.75rem;'>Evidence (${evd.length})</summary>`+
            evd.slice(0,60).map(e=>`<div style='font-size:0.7rem; border-top:1px solid #2a3138; padding:2px 0;'>`+
                `<code>${esc(e.path||'')} ${esc(e.lines||'')}</code><br/>${esc(e.snippet||'')}`+
            `</div>`).join('') + (evd.length>60?`<div style='font-size:0.7rem;'>... truncated ...</div>`:'') +
            `</details>`;
    },

    renderRemediation(rem, esc) {
        if (!rem || typeof rem !== 'object') return '';
        const steps = Array.isArray(rem.steps) ? rem.steps : [];
        const code = rem.code_example;
        const fixSummary = rem.fix_summary ? `<div style='font-size:0.7rem; margin:4px 0;'><strong>Fix Summary:</strong> ${esc(rem.fix_summary)}</div>` : '';
        let promptBlock = '';
        if (rem.remediation_prompt) {
            const pid = 'rp-' + Math.random().toString(36).slice(2);
            promptBlock = `<div style='margin:6px 0; padding:6px; background:#232f3a; border:1px solid #32424f; border-radius:4px;'>`+
                `<div style='display:flex; justify-content:space-between; align-items:center; font-size:0.7rem; margin-bottom:4px;'><strong>Remediation Prompt</strong> <button data-copy-target='${pid}' class='btn btn-sm btn-outline-info py-0 px-2 sec-copy-rem'>Copy</button></div>`+
                `<pre id='${pid}' style='background:#1a2229; color:#d3e3ef; padding:6px; font-size:0.6rem; line-height:1.2; max-height:180px; overflow:auto; border:1px solid #2d3b46; border-radius:4px; white-space:pre-wrap;'>${esc(rem.remediation_prompt)}</pre>`+
                `</div>`;
        }
        let out = `<details style='margin-top:4px;'>`+
            `<summary style='cursor:pointer; font-size:0.75rem; color:#8bd3ff;'>Remediation</summary>`+
            fixSummary +
            promptBlock;
        if (steps.length) out += `<div style='font-size:0.7rem; margin-top:4px;'><strong>Steps:</strong><ul style='margin:4px 0 4px 18px; padding:0; list-style:disc;'>${steps.map(s=>`<li style='margin-bottom:2px;'>${esc(s)}</li>`).join('')}</ul></div>`;
        if (code && code.content) out += `<div style='margin-top:4px; font-size:0.7rem;'><strong>Code Example:</strong><pre style='background:#232f3a; color:#e8f4fb; padding:6px; font-size:0.6rem; line-height:1.25; overflow:auto; border:1px solid #32424f; border-radius:4px;'>${esc(code.content)}</pre></div>`;
        out += `</details>`;
        return out;
    },

    statusClass(status) {
        if (!status) return '';
        const s = status.toLowerCase();
        if (s.includes('non')) return 'text-danger';
        if (s.includes('partial')) return 'text-warning';
        if (s.includes('compliant')) return 'text-success';
        if (s.includes('unable')) return 'text-muted';
        return '';
    },

    copyPrompt() {
        const ta = document.getElementById('sec-prompt-out');
        if (!ta.value) { alert('Generate the prompt first.'); return; }
        navigator.clipboard.writeText(ta.value).then(()=>{
            this.flash(ta, 'Copied');
        }).catch(e=>alert('Copy failed: '+e.message));
    },

    downloadJson() {
        if (!this.state.jsonResult) return;
        const blob = new Blob([JSON.stringify(this.state.jsonResult, null, 2)], { type:'application/json' });
        this.saveBlob(blob, 'security-review.json');
    },

    exportHtml() {
        if (!this.state.jsonResult) return;
        const container = document.getElementById('sec-rendered');
        const htmlDoc = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>Security Review Report</title><style>body{font-family:Arial,sans-serif;background:#111;color:#eee;padding:20px;} code,pre{font-family:ui-monospace,monospace;} a{text-decoration:none;color:#4fa3ff;} .text-danger{color:#f44336;} .text-warning{color:#ffc107;} .text-success{color:#4caf50;} .text-muted{color:#607d8b;} summary{outline:none;}</style></head><body>${container.innerHTML}</body></html>`;
        const blob = new Blob([htmlDoc], { type:'text/html' });
        this.saveBlob(blob, 'security-review-report.html');
    },

    saveBlob(blob, filename) {
        if (window.saveAs) {
            saveAs(blob, filename);
        } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
        }
    },

    flash(el, msg) {
        const orig = el.getAttribute('data-orig-placeholder') || el.placeholder;
        el.setAttribute('data-orig-placeholder', orig);
        el.placeholder = msg;
        setTimeout(()=>{ el.placeholder = orig; }, 1200);
    },

    escapeHtml(str='') { return str.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); },

    // Software Bill of Materials (SBOM) Generator
    async generateSBOM() {
        const sbom = {
            metadata: {
                timestamp: new Date().toISOString(),
                format: 'CycloneDX-like',
                version: '1.0'
            },
            components: [],
            dependencies: []
        };

        // Analyze HTML file for CDN dependencies
        const htmlDependencies = await this.extractHTMLDependencies();
        sbom.components.push(...htmlDependencies);

        // Analyze package.json if available
        const packageDependencies = await this.extractPackageJsonDependencies();
        if (packageDependencies.length > 0) {
            sbom.components.push(...packageDependencies);
        }

        // Analyze JavaScript files for imports/requires
        const codeDependencies = await this.extractCodeDependencies();
        sbom.components.push(...codeDependencies);

        // Detect framework/library usage through code analysis
        const detectedLibraries = await this.detectLibraryUsage();
        sbom.components.push(...detectedLibraries);

        // Remove duplicates
        sbom.components = this.deduplicateComponents(sbom.components);

        // Calculate risk scores
        sbom.components = sbom.components.map(comp => ({
            ...comp,
            riskScore: this.calculateComponentRisk(comp)
        }));

        return sbom;
    },

    async extractHTMLDependencies() {
        const components = [];
        
        // Find HTML files
        const htmlFiles = loadFolder.fileStructure.filter(f => 
            f.kind === 'file' && (f.name.endsWith('.html') || f.name.endsWith('.htm'))
        );

        for (const file of htmlFiles) {
            try {
                const content = await loadFolder.getFileContent(file);
                
                // Extract script tags with src
                const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
                let match;
                while ((match = scriptRegex.exec(content)) !== null) {
                    const src = match[1];
                    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
                        const component = this.parseURLDependency(src, 'javascript');
                        if (component) components.push(component);
                    }
                }

                // Extract link tags (CSS)
                const linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/gi;
                while ((match = linkRegex.exec(content)) !== null) {
                    const href = match[1];
                    if ((href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) && 
                        (match[0].includes('stylesheet') || href.endsWith('.css'))) {
                        const component = this.parseURLDependency(href, 'css');
                        if (component) components.push(component);
                    }
                }
            } catch (e) {
                console.warn('Error reading HTML file:', file.name, e);
            }
        }

        return components;
    },

    parseURLDependency(url, type) {
        // Normalize URL
        if (url.startsWith('//')) url = 'https:' + url;
        
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            
            // Extract library name and version from common CDN patterns
            let name = 'unknown';
            let version = 'unknown';
            let supplier = urlObj.hostname;

            // Common CDN patterns
            // cdnjs.cloudflare.com/ajax/libs/LIBRARY/VERSION/file.js
            if (urlObj.hostname.includes('cdnjs.cloudflare.com')) {
                const parts = pathname.split('/');
                if (parts.length >= 5 && parts[1] === 'ajax' && parts[2] === 'libs') {
                    name = parts[3];
                    version = parts[4];
                }
            }
            // cdn.jsdelivr.net/npm/LIBRARY@VERSION/file.js
            else if (urlObj.hostname.includes('jsdelivr.net')) {
                const npmMatch = pathname.match(/\/npm\/([^@\/]+)@?([^\/]*)/);
                if (npmMatch) {
                    name = npmMatch[1];
                    version = npmMatch[2] || 'latest';
                }
            }
            // unpkg.com/LIBRARY@VERSION/file.js
            else if (urlObj.hostname.includes('unpkg.com')) {
                const unpkgMatch = pathname.match(/\/([^@\/]+)@?([^\/]*)/);
                if (unpkgMatch) {
                    name = unpkgMatch[1];
                    version = unpkgMatch[2] || 'latest';
                }
            }
            // code.jquery.com/jquery-VERSION.min.js
            else if (urlObj.hostname.includes('jquery.com')) {
                name = 'jquery';
                const versionMatch = filename.match(/jquery-([0-9.]+)/);
                if (versionMatch) version = versionMatch[1];
            }

            return {
                type: type,
                name: name,
                version: version,
                supplier: supplier,
                source: 'cdn',
                url: url,
                license: 'Unknown',
                description: `External ${type} library loaded from CDN`
            };
        } catch (e) {
            console.warn('Error parsing URL dependency:', url, e);
            return null;
        }
    },

    async extractPackageJsonDependencies() {
        const components = [];
        
        // Look for package.json
        const packageJson = loadFolder.fileStructure.find(f => 
            f.kind === 'file' && f.name === 'package.json'
        );

        if (packageJson) {
            try {
                const content = await loadFolder.getFileContent(packageJson);
                const parsed = JSON.parse(content);
                
                // Process dependencies
                const deps = { ...parsed.dependencies, ...parsed.devDependencies };
                for (const [name, versionSpec] of Object.entries(deps)) {
                    components.push({
                        type: 'npm-package',
                        name: name,
                        version: versionSpec.replace(/[\^~]/g, ''), // Remove semver operators
                        supplier: 'npm',
                        source: 'package.json',
                        license: 'Unknown',
                        description: 'NPM package dependency'
                    });
                }
            } catch (e) {
                console.warn('Error parsing package.json:', e);
            }
        }

        return components;
    },

    async extractCodeDependencies() {
        const components = [];
        const imports = new Set();
        
        // Analyze JavaScript files
        const jsFiles = loadFolder.fileStructure.filter(f => 
            f.kind === 'file' && f.name.endsWith('.js')
        );

        for (const file of jsFiles) {
            try {
                const content = await loadFolder.getFileContent(file);
                
                // ES6 imports: import X from 'library'
                const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
                let match;
                while ((match = importRegex.exec(content)) !== null) {
                    const lib = match[1];
                    if (!lib.startsWith('.') && !lib.startsWith('/')) {
                        imports.add(lib);
                    }
                }

                // CommonJS: require('library')
                const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
                while ((match = requireRegex.exec(content)) !== null) {
                    const lib = match[1];
                    if (!lib.startsWith('.') && !lib.startsWith('/')) {
                        imports.add(lib);
                    }
                }
            } catch (e) {
                console.warn('Error reading JS file:', file.name, e);
            }
        }

        // Convert imports to components
        for (const lib of imports) {
            components.push({
                type: 'javascript-library',
                name: lib,
                version: 'Unknown',
                supplier: 'Unknown',
                source: 'code-analysis',
                license: 'Unknown',
                description: 'Library referenced in code'
            });
        }

        return components;
    },

    async detectLibraryUsage() {
        const components = [];
        const patterns = {
            'jQuery': /\$\s*\(|jQuery\s*\(/,
            'Lodash': /_\./,
            'Moment': /moment\(/,
            'Axios': /axios\./,
            'D3': /d3\./,
            'Three.js': /THREE\./,
            'Chart.js': /new\s+Chart\(/,
            'Bootstrap': /bootstrap|\.modal\(|\.tooltip\(/,
            'CodeMirror': /CodeMirror\./,
            'Leaflet': /L\.|leaflet/i
        };

        const jsFiles = loadFolder.fileStructure.filter(f => 
            f.kind === 'file' && (f.name.endsWith('.js') || f.name.endsWith('.html'))
        );

        const detected = new Set();

        for (const file of jsFiles) {
            try {
                const content = await loadFolder.getFileContent(file);
                
                for (const [library, pattern] of Object.entries(patterns)) {
                    if (pattern.test(content) && !detected.has(library)) {
                        detected.add(library);
                        components.push({
                            type: 'detected-library',
                            name: library,
                            version: 'Detected in code',
                            supplier: 'Unknown',
                            source: 'pattern-detection',
                            license: 'Unknown',
                            description: 'Library detected through code pattern analysis'
                        });
                    }
                }
            } catch (e) {
                console.warn('Error detecting library usage:', file.name, e);
            }
        }

        return components;
    },

    deduplicateComponents(components) {
        const seen = new Map();
        const result = [];

        for (const comp of components) {
            const key = `${comp.name}-${comp.version}`;
            if (!seen.has(key)) {
                seen.set(key, comp);
                result.push(comp);
            } else {
                // Merge information from duplicate entries
                const existing = seen.get(key);
                if (comp.version !== 'Unknown' && existing.version === 'Unknown') {
                    existing.version = comp.version;
                }
                if (comp.license !== 'Unknown' && existing.license === 'Unknown') {
                    existing.license = comp.license;
                }
            }
        }

        return result;
    },

    calculateComponentRisk(component) {
        let risk = 0;
        
        // External CDN = higher risk
        if (component.source === 'cdn') risk += 3;
        
        // Unknown version = risk
        if (component.version === 'Unknown' || component.version === 'latest') risk += 2;
        
        // Unknown license = compliance risk
        if (component.license === 'Unknown') risk += 1;
        
        // Detected but not explicitly declared = risk
        if (component.source === 'pattern-detection') risk += 2;

        // Risk levels: 0-2=Low, 3-5=Medium, 6+=High
        if (risk <= 2) return 'Low';
        if (risk <= 5) return 'Medium';
        return 'High';
    },

    // Security Implementation Summary (SIS) Generator
    async generateSIS() {
        try {
            // Collect system information
            const systemInfo = {
                name: document.getElementById('sis-system-name').value.trim() || 'Warfighter Coder Application',
                version: document.getElementById('sis-version').value.trim() || '1.0.0',
                classification: document.getElementById('sis-classification').value,
                organization: document.getElementById('sis-organization').value.trim() || 'DOD Component',
                authorizingOfficial: document.getElementById('sis-authorizing-official').value.trim() || 'TBD',
                environment: document.getElementById('sis-environment').value
            };

            // Collect security configuration data
            const securityConfig = this.collectSecurityConfiguration();
            
            // Get SAST results if available
            const sastResults = this.getSASTResults();
            
            // Get STIG assessment results if available
            const stigResults = this.getSTIGResults();

            // Generate SBOM (Software Bill of Materials)
            const sbomData = await this.generateSBOM();
            this.state.lastSBOM = sbomData; // Store for export

            // Generate the SIS document
            const sisDocument = this.generateSISDocument(systemInfo, securityConfig, sastResults, stigResults, sbomData);
            
            // Display the SIS
            const outputDiv = document.getElementById('sec-sis-output');
            this._setSafeContent(outputDiv, sisDocument);
            outputDiv.style.display = 'block';
            
            // Enable export buttons
            document.getElementById('sec-export-sis').disabled = false;
            document.getElementById('sec-export-sbom').disabled = false;
            
            this.flash(document.getElementById('sec-generate-sis'), 'SIS Generated!');
        } catch (error) {
            console.error('SIS Generation Error:', error);
            alert('Error generating SIS: ' + error.message);
        }
    },

    collectSecurityConfiguration() {
        const config = {};
        
        // Check compiler security settings
        config.cspHeaders = document.querySelector('#add-security-headers')?.checked ?? true;
        // Inline handler rewrite pipeline is not currently injected by compiler output.
        config.rewriteHandlers = false;
        config.cdnInlining = document.querySelector('#inline-cdn')?.checked ?? true;
        config.debugRemoval = !document.querySelector('#include-devconsole')?.checked ?? true;
        config.testingRemoval = !document.querySelector('#include-test-recorder')?.checked ?? true;
        config.minification = document.querySelector('#minify-output')?.checked ?? false;
        config.trustedTypes = false;
        config.inlineHandlerInterceptor = false;
        
        // Security features enabled
        config.features = {
            sastScanning: typeof sastTab !== 'undefined',
            stigCompliance: true,
            integrityVerification: true,
            airGappedOperation: true,
            fileSystemAPI: true,
            sandboxedPreview: true,
            trustedTypesEnforcement: config.trustedTypes,
            inlineHandlerConversion: config.inlineHandlerInterceptor
        };

        return config;
    },

    getSASTResults() {
        // Get SAST results from sastTab if available
        if (typeof sastTab !== 'undefined' && sastTab.lastFindings) {
            const findings = sastTab.lastFindings || [];
            const summary = {
                totalFindings: findings.length,
                highRisk: findings.filter(f => f.rule && (f.rule.includes('eval') || f.rule.includes('Function constructor'))).length,
                mediumRisk: findings.filter(f => f.rule && (f.rule.includes('innerHTML') || f.rule.includes('document.write'))).length,
                lowRisk: findings.filter(f => f.rule && (f.rule.includes('setTimeout') || f.rule.includes('setInterval'))).length,
                findings: findings.slice(0, 10) // Limit to top 10 for summary
            };
            return summary;
        }
        return null;
    },

    getSTIGResults() {
        // Get STIG results from security reviewer state
        if (this.state.jsonResult) {
            const result = this.state.jsonResult;
            return {
                overallStatus: result.summary?.overall_status || 'Not Assessed',
                highRiskFindings: result.summary?.high_risk_findings || [],
                quickWins: result.summary?.quick_wins || [],
                controls: result.controls || [],
                lastAssessment: new Date().toISOString().split('T')[0]
            };
        }
        return null;
    },

    generateSISDocument(systemInfo, securityConfig, sastResults, stigResults, sbomData) {
        const currentDate = new Date().toLocaleDateString('en-US');
        const currentDateTime = new Date().toLocaleString('en-US');
        
        return `
        <div class="sis-document" style="font-family: Arial, sans-serif; line-height: 1.4; color: #e8e8e8;">
            <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #444; padding-bottom: 20px;">
                <h1 style="color: #4fa3ff; margin: 0;">SECURITY IMPLEMENTATION SUMMARY</h1>
                <h2 style="color: #ccc; margin: 10px 0;">${this.escapeHtml(systemInfo.name)}</h2>
                <p style="margin: 5px 0;"><strong>Classification:</strong> ${systemInfo.classification}</p>
                <p style="margin: 5px 0;"><strong>Version:</strong> ${this.escapeHtml(systemInfo.version)}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${currentDate}</p>
            </div>

            <div style="margin-bottom: 25px;">
                <h3 style="color: #4fa3ff; border-bottom: 1px solid #444; padding-bottom: 5px;">1. SYSTEM OVERVIEW</h3>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                    <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold; width: 200px;">System Name:</td>
                        <td style="padding: 8px; border: 1px solid #444;">${this.escapeHtml(systemInfo.name)}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Version:</td>
                        <td style="padding: 8px; border: 1px solid #444;">${this.escapeHtml(systemInfo.version)}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Organization:</td>
                        <td style="padding: 8px; border: 1px solid #444;">${this.escapeHtml(systemInfo.organization)}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Environment:</td>
                        <td style="padding: 8px; border: 1px solid #444;">${systemInfo.environment}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Authorizing Official:</td>
                        <td style="padding: 8px; border: 1px solid #444;">${this.escapeHtml(systemInfo.authorizingOfficial)}</td></tr>
                    <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Classification:</td>
                        <td style="padding: 8px; border: 1px solid #444;">${systemInfo.classification}</td></tr>
                </table>
            </div>

            <div style="margin-bottom: 25px;">
                <h3 style="color: #4fa3ff; border-bottom: 1px solid #444; padding-bottom: 5px;">2. SECURITY ARCHITECTURE</h3>
                <h4 style="color: #ffc107; margin-top: 15px;">2.1 Security Model</h4>
                <p><strong>Defense Strategy:</strong> Multi-layered defense with air-gapped operation capability</p>
                <p><strong>Threat Model:</strong> Protection against code injection, supply chain attacks, data exfiltration, and unauthorized network access</p>
                <h4 style="color: #ffc107; margin-top: 15px;">2.2 Security Features Implemented</h4>
                <ul style="margin-left: 20px;">
                    <li><strong>Deterministic Content Security Policy:</strong> ${securityConfig.cspHeaders ? 'ENABLED' : 'DISABLED'} - Default-deny directives are injected (connect-src defaults to 'none' unless explicitly allowlisted), plus frame-src 'none', object-src 'none', form-action 'none', and manifest-src 'none'. Script/style execution currently uses 'unsafe-inline'.</li>
                    <li><strong>Runtime URL/Form/Link Hardening:</strong> ${securityConfig.cspHeaders ? 'ENABLED' : 'DISABLED'} - Runtime guards sanitize navigation targets, neutralize risky link hints, sanitize embed/meta-refresh/base usage, and block GET form submissions.</li>
                    <li><strong>Isolated Runtime Shell:</strong> ${securityConfig.cspHeaders ? 'ENABLED' : 'DISABLED'} - Compiled app runs in a sandboxed iframe with a mediated parent bridge for sensitive host interactions.</li>
                    <li><strong>Bridge Gesture Gating:</strong> ${securityConfig.cspHeaders ? 'ENABLED' : 'DISABLED'} - File picker and permission-sensitive bridge actions require explicit user interaction.</li>
                    <li><strong>Supply Chain Protection:</strong> ${securityConfig.cdnInlining ? 'ENABLED' : 'DISABLED'} - External CDN JavaScript/CSS is optionally inlined, preventing runtime fetches and locking dependencies to known content.</li>
                    <li><strong>Asset Containment:</strong> ALWAYS ON - Local images are converted to data URIs, neutralizing path manipulation and blocking mixed-content fetches.</li>
                    <li><strong>Debug Surface Reduction:</strong> ${securityConfig.debugRemoval ? 'ENABLED' : 'DISABLED'} - Dev console and UI tester assets are excluded by default for production builds.</li>
                    <li><strong>Static Analysis (SAST):</strong> ${securityConfig.features.sastScanning ? 'AVAILABLE' : 'NOT AVAILABLE'} - Integrated scanner highlights risky sinks and patterns before compilation.</li>
                    <li><strong>STIG Compliance Toolkit:</strong> ${securityConfig.features.stigCompliance ? 'AVAILABLE' : 'NOT AVAILABLE'} - Guided ASD STIG prompt generation and evidence collection.</li>
                    <li><strong>Cryptographic Integrity:</strong> ${securityConfig.features.integrityVerification ? 'ENABLED' : 'DISABLED'} - SHA-256 hashing and manifest metadata support chain-of-custody validation.</li>
                    <li><strong>Air-Gapped Operation:</strong> ${securityConfig.features.airGappedOperation ? 'SUPPORTED' : 'NOT AVAILABLE'} - Builds include everything needed to execute offline with zero network access.</li>
                </ul>
                <h4 style="color: #ffc107; margin-top: 15px;">2.3 Inherent Security Safeguards for Generated Apps</h4>
                <ul style="margin-left: 20px;">
                    <li><strong>Build Manifest Metadata:</strong> Every compiled artifact carries machine-readable manifest metadata for decompilation/audit workflows.</li>
                    <li><strong>URL and Navigation Sanitization:</strong> Runtime guards sanitize/normalize navigation URLs, strip query strings, strip external URL paths in open flows, and block dangerous URL schemes.</li>
                    <li><strong>Link-Hint Neutralization:</strong> Runtime logic removes or neutralizes risky link-rel hints with inconsistent browser CSP enforcement behavior.</li>
                    <li><strong>Form Exfiltration Controls:</strong> Runtime logic sanitizes form actions and blocks GET submissions that leak data in URL parameters.</li>
                    <li><strong>Embedded Content Controls:</strong> Runtime logic sanitizes iframe/frame/embed/object targets and neutralizes meta refresh/base-href abuse patterns.</li>
                    <li><strong>MutationObserver Safety Net:</strong> Runtime observers re-sanitize newly inserted or mutated nodes/attributes relevant to navigation and embedding.</li>
                    <li><strong>Bridge Integrity Checks:</strong> Parent/child bridge messages are namespace/token validated and restricted to the expected iframe source window.</li>
                    <li><strong>Security Metadata Propagation:</strong> Compiled artifacts include manifest and build-time metadata to support downstream auditing.</li>
                    <li><strong>One-Click Verification:</strong> A verification utility recomputes build hashes against <code>compiled-hashes.csv</code>, ensuring fielded copies match the original build.</li>
                    <li><strong>Optional HTML Minification:</strong> Controlled minification reduces output size while preserving runtime behavior.</li>
                    <li><strong>Runtime Anti-Framing:</strong> Compiled applications execute in a sandboxed iframe runtime shell.</li>
                    <li><strong>Permissions Policy Baseline:</strong> Sensitive browser APIs (camera, microphone, sensors, USB, etc.) are explicitly disabled unless re-enabled by design.</li>
                </ul>
            </div>

            ${sastResults ? this.generateSASTSection(sastResults) : ''}
            ${stigResults ? this.generateSTIGSection(stigResults) : ''}

            <div style="margin-bottom: 25px;">
                <h3 style="color: #4fa3ff; border-bottom: 1px solid #444; padding-bottom: 5px;">3. SECURITY CONTROLS IMPLEMENTATION</h3>
                
                <h4 style="color: #ffc107; margin-top: 15px;">3.1 Network Security Controls</h4>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                    <thead>
                        <tr style="background: #2a2a2a;">
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Control</th>
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Status</th>
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Implementation</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Network Isolation</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">✓ IMPLEMENTED</span></td>
                            <td style="padding: 8px; border: 1px solid #444;">CSP connect-src defaults to 'none' (or allows only explicit allowlisted API origins)</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">External Resource Control</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">✓ IMPLEMENTED</span></td>
                            <td style="padding: 8px; border: 1px solid #444;">CDN dependencies inlined during compilation</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Frame Protection</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">✓ IMPLEMENTED</span></td>
                            <td style="padding: 8px; border: 1px solid #444;">Runtime anti-framing guard blocks embedding attempts</td>
                        </tr>
                    </tbody>
                </table>

                <h4 style="color: #ffc107; margin-top: 15px;">3.2 Application Security Controls</h4>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                    <thead>
                        <tr style="background: #2a2a2a;">
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Control</th>
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Status</th>
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Implementation</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">XSS Protection</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">✓ IMPLEMENTED</span></td>
                            <td style="padding: 8px; border: 1px solid #444;">CSP script-src policy + SAST scanning</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Content Type Protection</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">✓ IMPLEMENTED</span></td>
                            <td style="padding: 8px; border: 1px solid #444;">X-Content-Type-Options: nosniff header</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Script Injection Prevention</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">✓ IMPLEMENTED</span></td>
                            <td style="padding: 8px; border: 1px solid #444;">Script content sanitization during compilation</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Integrity Verification</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">✓ IMPLEMENTED</span></td>
                            <td style="padding: 8px; border: 1px solid #444;">SHA-256 hashing with verification system</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="margin-bottom: 25px;">
                <h3 style="color: #4fa3ff; border-bottom: 1px solid #444; padding-bottom: 5px;">4. RISK ASSESSMENT SUMMARY</h3>
                <h4 style="color: #ffc107; margin-top: 15px;">4.1 Risk Mitigation Status</h4>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                    <thead>
                        <tr style="background: #2a2a2a;">
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Risk Category</th>
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Risk Level</th>
                            <th style="padding: 8px; border: 1px solid #444; text-align: left;">Mitigation Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Code Injection (XSS)</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #ff9800;">MEDIUM</span></td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">MITIGATED</span> - CSP + SAST scanning</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Supply Chain Attack</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #f44336;">HIGH</span></td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">MITIGATED</span> - CDN inlining + integrity verification</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Data Exfiltration</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #f44336;">HIGH</span></td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">MITIGATED</span> - Network connections blocked</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #444;">Information Disclosure</td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">LOW</span></td>
                            <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">MITIGATED</span> - Debug code removal</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            ${sbomData ? this.generateSBOMSection(sbomData) : ''}

            <div style="margin-bottom: 25px;">
                <h3 style="color: #4fa3ff; border-bottom: 1px solid #444; padding-bottom: 5px;">${sbomData ? '6' : '5'}. COMPLIANCE STATUS</h3>
                <p><strong>Framework Compliance:</strong></p>
                <ul style="margin-left: 20px;">
                    <li><strong>NIST SP 800-53:</strong> Partial compliance with relevant controls for air-gapped systems</li>
                    <li><strong>DoD ASD STIG:</strong> ${stigResults ? stigResults.overallStatus : 'Assessment Pending'}</li>
                    <li><strong>OWASP ASVS:</strong> Level 1 compliance for web application security</li>
                </ul>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #444; text-align: center;">
                <p style="color: #888; font-size: 0.9em;">
                    <strong>Document Classification:</strong> ${systemInfo.classification}<br>
                    <strong>Generated:</strong> ${currentDateTime}<br>
                    <strong>Generated by:</strong> Warfighter Coder Security Implementation Summary Tool v1.0
                </p>
            </div>
        </div>
        `;
    },

    generateSASTSection(sastResults) {
        return `
        <div style="margin-bottom: 25px;">
            <h3 style="color: #4fa3ff; border-bottom: 1px solid #444; padding-bottom: 5px;">STATIC ANALYSIS (SAST) RESULTS</h3>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold; width: 200px;">Total Findings:</td>
                    <td style="padding: 8px; border: 1px solid #444;">${sastResults.totalFindings}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">High Risk:</td>
                    <td style="padding: 8px; border: 1px solid #444;"><span style="color: ${sastResults.highRisk > 0 ? '#f44336' : '#4caf50'};">${sastResults.highRisk}</span></td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Medium Risk:</td>
                    <td style="padding: 8px; border: 1px solid #444;"><span style="color: ${sastResults.mediumRisk > 0 ? '#ff9800' : '#4caf50'};">${sastResults.mediumRisk}</span></td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Low Risk:</td>
                    <td style="padding: 8px; border: 1px solid #444;"><span style="color: ${sastResults.lowRisk > 0 ? '#ffc107' : '#4caf50'};">${sastResults.lowRisk}</span></td></tr>
            </table>
            
            ${sastResults.findings.length > 0 ? `
            <h4 style="color: #ffc107; margin-top: 15px;">Top Security Findings:</h4>
            <ul style="margin-left: 20px;">
                ${sastResults.findings.map(finding => 
                    `<li><strong>${this.escapeHtml(finding.rule)}</strong> in ${this.escapeHtml(finding.path)}:${finding.line}</li>`
                ).join('')}
            </ul>
            ` : '<p style="color: #4caf50; margin-top: 15px;">✓ No security vulnerabilities detected</p>'}
        </div>
        `;
    },

    generateSTIGSection(stigResults) {
        return `
        <div style="margin-bottom: 25px;">
            <h3 style="color: #4fa3ff; border-bottom: 1px solid #444; padding-bottom: 5px;">STIG COMPLIANCE ASSESSMENT</h3>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold; width: 200px;">Overall Status:</td>
                    <td style="padding: 8px; border: 1px solid #444;">
                        <span style="color: ${this.getStatusColor(stigResults.overallStatus)};">${stigResults.overallStatus}</span>
                    </td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Controls Assessed:</td>
                    <td style="padding: 8px; border: 1px solid #444;">${stigResults.controls.length}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">High Risk Findings:</td>
                    <td style="padding: 8px; border: 1px solid #444;">${stigResults.highRiskFindings.length}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Last Assessment:</td>
                    <td style="padding: 8px; border: 1px solid #444;">${stigResults.lastAssessment}</td></tr>
            </table>
            
            ${stigResults.highRiskFindings.length > 0 ? `
            <h4 style="color: #ffc107; margin-top: 15px;">High Risk Findings:</h4>
            <ul style="margin-left: 20px;">
                ${stigResults.highRiskFindings.map(finding => 
                    `<li style="color: #f44336;">${this.escapeHtml(finding)}</li>`
                ).join('')}
            </ul>
            ` : '<p style="color: #4caf50; margin-top: 15px;">✓ No high-risk STIG findings identified</p>'}
            
            ${stigResults.quickWins.length > 0 ? `
            <h4 style="color: #ffc107; margin-top: 15px;">Recommended Quick Wins:</h4>
            <ul style="margin-left: 20px;">
                ${stigResults.quickWins.map(win => 
                    `<li style="color: #4fa3ff;">${this.escapeHtml(win)}</li>`
                ).join('')}
            </ul>
            ` : ''}
        </div>
        `;
    },

    generateSBOMSection(sbomData) {
        const components = sbomData.components || [];
        const totalComponents = components.length;
        const highRisk = components.filter(c => c.riskScore === 'High').length;
        const mediumRisk = components.filter(c => c.riskScore === 'Medium').length;
        const lowRisk = components.filter(c => c.riskScore === 'Low').length;
        
        // Group components by type
        const byType = {};
        components.forEach(comp => {
            if (!byType[comp.type]) byType[comp.type] = [];
            byType[comp.type].push(comp);
        });

        return `
        <div style="margin-bottom: 25px;">
            <h3 style="color: #4fa3ff; border-bottom: 1px solid #444; padding-bottom: 5px;">5. SOFTWARE BILL OF MATERIALS (SBOM)</h3>
            
            <h4 style="color: #ffc107; margin-top: 15px;">5.1 Component Summary</h4>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold; width: 200px;">Total Components:</td>
                    <td style="padding: 8px; border: 1px solid #444;">${totalComponents}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">High Risk Components:</td>
                    <td style="padding: 8px; border: 1px solid #444;"><span style="color: ${highRisk > 0 ? '#f44336' : '#4caf50'};">${highRisk}</span></td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Medium Risk Components:</td>
                    <td style="padding: 8px; border: 1px solid #444;"><span style="color: ${mediumRisk > 0 ? '#ff9800' : '#4caf50'};">${mediumRisk}</span></td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">Low Risk Components:</td>
                    <td style="padding: 8px; border: 1px solid #444;"><span style="color: #4caf50;">${lowRisk}</span></td></tr>
                <tr><td style="padding: 8px; border: 1px solid #444; background: #2a2a2a; font-weight: bold;">SBOM Generated:</td>
                    <td style="padding: 8px; border: 1px solid #444;">${sbomData.metadata.timestamp.split('T')[0]}</td></tr>
            </table>

            <h4 style="color: #ffc107; margin-top: 15px;">5.2 Component Inventory</h4>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.85em;">
                <thead>
                    <tr style="background: #2a2a2a;">
                        <th style="padding: 6px; border: 1px solid #444; text-align: left;">Component</th>
                        <th style="padding: 6px; border: 1px solid #444; text-align: left;">Version</th>
                        <th style="padding: 6px; border: 1px solid #444; text-align: left;">Type</th>
                        <th style="padding: 6px; border: 1px solid #444; text-align: left;">Source</th>
                        <th style="padding: 6px; border: 1px solid #444; text-align: left;">Risk</th>
                    </tr>
                </thead>
                <tbody>
                    ${components.slice(0, 20).map(comp => `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #444;"><strong>${this.escapeHtml(comp.name)}</strong></td>
                        <td style="padding: 6px; border: 1px solid #444;">${this.escapeHtml(comp.version)}</td>
                        <td style="padding: 6px; border: 1px solid #444;">${this.escapeHtml(comp.type)}</td>
                        <td style="padding: 6px; border: 1px solid #444;">${this.escapeHtml(comp.source)}</td>
                        <td style="padding: 6px; border: 1px solid #444;">
                            <span style="color: ${this.getRiskColor(comp.riskScore)};">${comp.riskScore}</span>
                        </td>
                    </tr>
                    `).join('')}
                    ${components.length > 20 ? `
                    <tr>
                        <td colspan="5" style="padding: 6px; border: 1px solid #444; text-align: center; font-style: italic; color: #888;">
                            ... and ${components.length - 20} more components (full SBOM available separately)
                        </td>
                    </tr>
                    ` : ''}
                </tbody>
            </table>

            ${Object.keys(byType).length > 0 ? `
            <h4 style="color: #ffc107; margin-top: 15px;">5.3 Components by Type</h4>
            <ul style="margin-left: 20px;">
                ${Object.entries(byType).map(([type, comps]) => 
                    `<li><strong>${this.escapeHtml(type)}:</strong> ${comps.length} component(s)</li>`
                ).join('')}
            </ul>
            ` : ''}

            ${highRisk > 0 ? `
            <h4 style="color: #f44336; margin-top: 15px;">5.4 High-Risk Components Requiring Review</h4>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.85em;">
                <thead>
                    <tr style="background: #2a2a2a;">
                        <th style="padding: 6px; border: 1px solid #444; text-align: left;">Component</th>
                        <th style="padding: 6px; border: 1px solid #444; text-align: left;">Version</th>
                        <th style="padding: 6px; border: 1px solid #444; text-align: left;">Risk Factors</th>
                    </tr>
                </thead>
                <tbody>
                    ${components.filter(c => c.riskScore === 'High').map(comp => `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #444;"><strong>${this.escapeHtml(comp.name)}</strong></td>
                        <td style="padding: 6px; border: 1px solid #444;">${this.escapeHtml(comp.version)}</td>
                        <td style="padding: 6px; border: 1px solid #444;">
                            ${comp.source === 'cdn' ? '• External CDN source<br>' : ''}
                            ${comp.version === 'Unknown' || comp.version === 'latest' ? '• Unknown/latest version<br>' : ''}
                            ${comp.source === 'pattern-detection' ? '• Not explicitly declared<br>' : ''}
                            ${comp.license === 'Unknown' ? '• Unknown license' : ''}
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
            ` : '<p style="color: #4caf50; margin-top: 15px;">✓ No high-risk components identified</p>'}

        </div>
        `;
    },

    getRiskColor(risk) {
        switch (risk) {
            case 'High': return '#f44336';
            case 'Medium': return '#ff9800';
            case 'Low': return '#4caf50';
            default: return '#888';
        }
    },

    getStatusColor(status) {
        switch (status?.toLowerCase()) {
            case 'compliant': return '#4caf50';
            case 'partially compliant': return '#ff9800';
            case 'non-compliant': return '#f44336';
            case 'not assessed': return '#888';
            default: return '#888';
        }
    },

    exportSIS() {
        const sisOutput = document.getElementById('sec-sis-output');
        if (!sisOutput || sisOutput.style.display === 'none') {
            alert('Please generate SIS document first.');
            return;
        }

        const systemName = document.getElementById('sis-system-name').value.trim() || 'Warfighter_Coder_Application';
        const version = document.getElementById('sis-version').value.trim() || '1.0.0';
        const safeSystemName = systemName.replace(/[^a-zA-Z0-9_-]/g, '_');
        
        const currentDate = new Date().toISOString().split('T')[0];
        const filename = `SIS_${safeSystemName}_v${version}_${currentDate}.html`;

        const fullDocument = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Security Implementation Summary - ${systemName}</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    margin: 40px; 
                    background-color: #1a1a1a; 
                    color: #e8e8e8; 
                    line-height: 1.6; 
                }
                @media print {
                    body { background-color: white; color: black; }
                    .sis-document { color: black !important; }
                    .sis-document * { color: black !important; }
                }
                .no-print { display: none; }
            </style>
        </head>
        <body>
            <div class="no-print" style="position: fixed; top: 20px; right: 20px; z-index: 1000;">
                <button id="sis-print-btn" style="padding: 10px 20px; background: #4fa3ff; color: white; border: none; border-radius: 4px; cursor: pointer;">Print/Save PDF</button>
            </div>
            <script>
                (function(){
                    var btn = document.getElementById('sis-print-btn');
                    if (btn) {
                        btn.addEventListener('click', function(){ window.print(); });
                    }
                })();
            </script>
            ${sisOutput.innerHTML}
        </body>
        </html>
        `;

        const blob = new Blob([fullDocument], { type: 'text/html;charset=utf-8' });
        this.saveBlob(blob, filename);
    },

    exportSBOMJson() {
        if (!this.state.lastSBOM) {
            alert('Please generate SIS document first to create SBOM.');
            return;
        }

        const systemName = document.getElementById('sis-system-name').value.trim() || 'Warfighter_Coder_Application';
        const version = document.getElementById('sis-version').value.trim() || '1.0.0';
        const safeSystemName = systemName.replace(/[^a-zA-Z0-9_-]/g, '_');
        
        const currentDate = new Date().toISOString().split('T')[0];
        const filename = `SBOM_${safeSystemName}_v${version}_${currentDate}.json`;

        // Create CycloneDX-style SBOM structure
        const sbomExport = {
            bomFormat: 'CycloneDX',
            specVersion: '1.4',
            serialNumber: `urn:uuid:${this.generateUUID()}`,
            version: 1,
            metadata: {
                timestamp: new Date().toISOString(),
                tools: [{
                    vendor: 'Warfighter Coder',
                    name: 'Security Reviewer SBOM Generator',
                    version: '1.0.0'
                }],
                component: {
                    type: 'application',
                    name: systemName,
                    version: version,
                    description: 'Application developed with Warfighter Coder'
                }
            },
            components: this.state.lastSBOM.components.map(comp => ({
                type: this.mapComponentTypeToCycloneDX(comp.type),
                name: comp.name,
                version: comp.version,
                supplier: {
                    name: comp.supplier || 'Unknown'
                },
                description: comp.description,
                externalReferences: comp.url ? [{
                    type: 'distribution',
                    url: comp.url
                }] : [],
                properties: [{
                    name: 'source',
                    value: comp.source
                }, {
                    name: 'riskScore',
                    value: comp.riskScore
                }]
            }))
        };

        const blob = new Blob([JSON.stringify(sbomExport, null, 2)], { type: 'application/json' });
        this.saveBlob(blob, filename);
    },

    generateUUID() {
        // Simple UUID v4 generator
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    mapComponentTypeToCycloneDX(type) {
        const typeMap = {
            'javascript': 'library',
            'css': 'library',
            'npm-package': 'library',
            'javascript-library': 'library',
            'detected-library': 'library'
        };
        return typeMap[type] || 'library';
    }
};

