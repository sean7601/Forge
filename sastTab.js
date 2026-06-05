const sastTab = {
    _setSafeContent(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
        el.replaceChildren(frag);
    },
    init() {
        const pane = document.getElementById('sast');
        if (!pane) return;
        this._setSafeContent(pane, this.renderBase());
        this.bind();
    },

    renderBase() {
        return `
            <h3>JavaScript SAST Scanner</h3>
            <p>Scan loaded project files for common JavaScript security vulnerabilities.</p>
            <button class="btn btn-primary btn-sm" id="sast-run">Run Scan</button>
            <div id="sast-scan-status" class="small mt-2"></div>
            <div class="row mt-2">
              <div class="col-md-5">
                <h6>Issues by Category</h6>
                <canvas id="sast-chart" width="240" height="240" style="background:#12181d; border:1px solid #27313a; border-radius:4px; cursor:pointer;"></canvas>
                <div id="sast-filter-info" class="small mt-2"></div>
                <div id="sast-chart-legend" class="small mt-2" style="max-height:18vh; overflow:auto;"></div>
                <div class="mt-2">
                  <button class="btn btn-sm btn-outline-secondary" id="sast-clear-filter">Clear Filter</button>
                </div>
              </div>
              <div class="col-md-7">
                <div class="d-flex justify-content-between align-items-center">
                  <h6 class="m-0">Findings</h6>
                  <div>
                    <button class="btn btn-sm btn-outline-secondary" id="sast-expand-all">Expand All</button>
                    <button class="btn btn-sm btn-outline-secondary" id="sast-collapse-all">Collapse All</button>
                  </div>
                </div>
                <div id="sast-results" style="max-height:40vh; overflow:auto; margin-top:10px; font-size:0.8rem;"></div>
              </div>
            </div>
            <hr/>
            <h6>LLM Fix Prompt</h6>
            <div class="small text-muted">After a scan, generate a ready-to-copy prompt to fix the issues.</div>
            <div class="mb-2">
                <button class="btn btn-sm btn-info" id="sast-make-fix-prompt">Generate Fix Prompt</button>
                <button class="btn btn-sm btn-outline-secondary" id="sast-copy-fix-prompt">Copy Prompt</button>
            </div>
            <textarea id="sast-fix-prompt" class="form-control" rows="10" placeholder="Run a scan, then click Generate Fix Prompt..." readonly></textarea>
        `;
    },

    bind() {
        document.getElementById('sast-run').addEventListener('click', () => this.runScan());
        const makeBtn = document.getElementById('sast-make-fix-prompt');
        if (makeBtn) makeBtn.addEventListener('click', () => this.generateFixPrompt());
        const copyBtn = document.getElementById('sast-copy-fix-prompt');
        if (copyBtn) copyBtn.addEventListener('click', () => this.copyFixPrompt());

        // Chart + filtering + expand/collapse
        const canvas = document.getElementById('sast-chart');
        if (canvas) canvas.addEventListener('click', (e) => this.onChartClick(e));
        const clearBtn = document.getElementById('sast-clear-filter');
        if (clearBtn) clearBtn.addEventListener('click', () => { this.ruleFilter = null; this.render(); });
        const exp = document.getElementById('sast-expand-all');
        if (exp) exp.addEventListener('click', () => this.toggleAllDrawers(true));
        const col = document.getElementById('sast-collapse-all');
        if (col) col.addEventListener('click', () => this.toggleAllDrawers(false));
    },

    async runScan() {
        if (!loadFolder.fileHandle) { alert('Load a directory first.'); return; }
        const status = document.getElementById('sast-scan-status');
        const resultsBox = document.getElementById('sast-results');
        status.textContent = 'Scanning...';
        resultsBox.textContent = '';
        const patterns = this.getPatterns();
        const findings = [];
        for (const file of loadFolder.fileStructure) {
            if (file.kind !== 'file' || !file.name.toLowerCase().endsWith('.js')) continue;
            try {
                const text = await loadFolder.getFileContent(file);
                const lines = text.split(/\r?\n/);
                patterns.forEach(p => {
                    for (let i = 0; i < lines.length; i++) {
                        if (p.regex.test(lines[i])) {
                            findings.push({
                                rule: p.rule,
                                explanation: p.explanation || this.getDefaultExplanation(p.rule),
                                path: file.relativePath,
                                line: i + 1,
                                excerpt: lines[i].trim().slice(0, 200)
                            });
                            p.regex.lastIndex = 0;
                        }
                    }
                });
            } catch (e) { /* ignore */ }
        }
        this.lastFindings = findings;
        if (!findings.length) {
            status.textContent = 'Scan complete: no issues found.';
            this.render();
            return;
        }
        status.textContent = `Scan complete: ${findings.length} potential issue(s).`;
        this.render();
    },

    getPatterns() {
        return [
            {
                rule: 'eval() usage',
                explanation: 'Allows execution of arbitrary strings as code. If input can influence the string, it enables code injection/XSS and breaks CSP.',
                regex: /\beval\s*\(/
            },
            {
                rule: 'Function constructor',
                explanation: 'Equivalent risk to eval(); compiles a string into executable code, enabling injection and bypassing security policies.',
                regex: /new\s+Function\s*\(/
            },
            {
                rule: 'innerHTML assignment',
                explanation: 'Injects HTML that can execute scripts if the content is attacker-controlled; prefer textContent or a sanitizer (e.g., DOMPurify).',
                regex: /\.innerHTML\s*=\s*/
            },
            {
                rule: 'document.write',
                explanation: 'Writes raw HTML into the DOM; dangerous when combined with dynamic strings and can break document loading.',
                regex: /document\.write\s*\(/
            },
            {
                rule: 'setTimeout string arg',
                explanation: 'Passing a string causes implicit eval, executing constructed code; pass a function instead.',
                regex: /setTimeout\s*\(\s*['"]/ 
            },
            {
                rule: 'setInterval string arg',
                explanation: 'Passing a string causes implicit eval and code injection risks; pass a function instead.',
                regex: /setInterval\s*\(\s*['"]/ 
            }
        ];
    },

    clearTransient() {
        const status = document.getElementById('sast-scan-status');
        const results = document.getElementById('sast-results');
        if (status) status.textContent = '';
        if (results) results.textContent = '';
        const fixTa = document.getElementById('sast-fix-prompt');
        if (fixTa) fixTa.value = '';
        const fi = document.getElementById('sast-filter-info');
        if (fi) fi.textContent = '';
        const lg = document.getElementById('sast-chart-legend');
        if (lg) lg.textContent = '';
    },

    escapeHtml(str = '') {
        return str.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    },

    getDefaultExplanation(rule = '') {
        const r = rule.toLowerCase();
        if (r.includes('eval')) return 'Executes strings as code, enabling injection; avoid and replace with safe alternatives.';
        if (r.includes('function constructor')) return 'Compiles strings into code (eval-like). Use normal functions or safe parsing.';
        if (r.includes('innerhtml')) return 'Dangerous HTML injection sink; use textContent or sanitize first.';
        if (r.includes('document.write')) return 'Raw DOM injection during parse phase; avoid and use DOM APIs safely.';
        if (r.includes('settimeout')) return 'String argument is implicitly evaled; pass a function callback.';
        if (r.includes('setinterval')) return 'String argument is implicitly evaled; pass a function callback.';
        return 'Potential unsafe pattern. Review and replace with a safer alternative.';
    },

    generateFixPrompt() {
        const findings = this.lastFindings || [];
        const ta = document.getElementById('sast-fix-prompt');
        if (!ta) return;
        if (!findings.length) {
            ta.value = 'No findings available. Run a scan first.';
            return;
        }
        const byFile = new Map();
        for (const f of findings) {
            const key = f.path;
            if (!byFile.has(key)) byFile.set(key, []);
            byFile.get(key).push(f);
        }
        const lines = [];
        lines.push('You are a secure code assistant. Propose minimal, safe patches to resolve the following JavaScript security issues in a static, offline web app (no server, no build tooling).');
        lines.push('Rules:');
        lines.push('- Do not change behavior beyond what is necessary for security.');
        lines.push('- Avoid eval-like behavior and unsafe HTML sinks.');
        lines.push('- Prefer concrete line-level edits.');
        lines.push('- Output entire file contents for easy copy/pasting. You can do one file at a time if needed.');
        lines.push('');
        lines.push('Issues to fix:');
        for (const [path, arr] of byFile.entries()) {
            lines.push(`\nFile: ${path}`);
            for (const f of arr) {
                lines.push(`- ${f.rule} at line ${f.line}`);
                if (f.explanation) lines.push(`  Why: ${f.explanation}`);
                if (f.excerpt) lines.push(`  Snippet: ${f.excerpt}`);
            }
        }
        lines.push('\nOutput format:');
        lines.push('For each file:');
        lines.push('1) Brief rationale');
        lines.push("2) Entire new file content enclosed in triple backticks with filename, e.g.:");
        lines.push('\nConstraints: The app runs from file://, uses only vanilla JS/HTML/CSS, and must avoid introducing XSS or dynamic code execution.');
        ta.value = lines.join('\n');
        ta.scrollTop = 0;
    },

    copyFixPrompt() {
        const ta = document.getElementById('sast-fix-prompt');
        if (!ta || !ta.value) { alert('Generate the fix prompt first.'); return; }
        navigator.clipboard.writeText(ta.value).then(() => {
            const old = ta.placeholder;
            ta.placeholder = 'Copied to clipboard';
            setTimeout(() => { ta.placeholder = old; }, 1200);
        }).catch(e => alert('Copy failed: ' + e.message));
    },

    // --- Rendering helpers ---
    render() {
        this.renderResults();
        this.renderChart();
    },

    renderResults() {
        const box = document.getElementById('sast-results');
        if (!box) return;
        const list = (this.lastFindings || []).filter(f => !this.ruleFilter || f.rule === this.ruleFilter);
        if (!list.length) {
            box.replaceChildren();
            const em = document.createElement('em');
            em.className = 'text-muted';
            em.textContent = 'No findings to display.';
            box.appendChild(em);
            return;
        }
        // group by file
        const groups = new Map();
        for (const f of list) {
            if (!groups.has(f.path)) groups.set(f.path, []);
            groups.get(f.path).push(f);
        }
        const paths = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b));
        const esc = (s)=>this.escapeHtml(String(s||''));
        const rows = [];
        for (const p of paths) {
            const issues = groups.get(p).sort((a,b)=>a.line-b.line || a.rule.localeCompare(b.rule));
            const detailsId = 'det-' + Math.random().toString(36).slice(2);
            rows.push(`
                <details class="sast-file" id="${detailsId}" style="border:1px solid #27313a; border-radius:4px; margin-bottom:8px; background:#141a1f;">
                    <summary class="sast-summary"><span class="sast-summary-path">${esc(p)}</span><span class="sast-summary-count">(${issues.length})</span></summary>
                    <div style="padding:6px 10px;">
                        ${issues.map(f=>`
                            <div style="border-top:1px solid #1f2730; padding:6px 0;">
                                <div>[${esc(f.rule)}] <strong>${esc(p)}:${f.line}</strong> — ${esc(f.excerpt)}</div>
                                <div style="font-size:0.75rem; opacity:0.9; margin-top:2px;"><em>Why this is an issue:</em> ${esc(f.explanation)}</div>
                            </div>`).join('')}
                    </div>
                </details>
            `);
        }
        this._setSafeContent(box, rows.join(''));

        // Update filter label
        const fi = document.getElementById('sast-filter-info');
        if (fi) fi.textContent = this.ruleFilter ? `Filter: ${this.ruleFilter}` : 'Filter: (none)';
    },

    toggleAllDrawers(open) {
        document.querySelectorAll('#sast-results details.sast-file').forEach(d => d.open = !!open);
    },

    // --- Chart ---
    renderChart() {
        const canvas = document.getElementById('sast-chart');
        const legend = document.getElementById('sast-chart-legend');
        if (!canvas || !legend) return;
        const findings = this.lastFindings || [];
        const counts = {};
        for (const f of findings) counts[f.rule] = (counts[f.rule]||0) + 1;
        const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
        // Draw
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width, canvas.height);
        const total = entries.reduce((s, [,c])=>s+c, 0) || 0;
        const cx = canvas.width/2, cy = canvas.height/2, r = Math.min(cx, cy) - 8;
        let start = -Math.PI/2; // start at top
        this._chartSlices = [];
        if (!total) {
            // draw empty ring
            ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.strokeStyle = '#2a3640'; ctx.lineWidth = 12; ctx.stroke();
            legend.replaceChildren();
            const em = document.createElement('em');
            em.className = 'text-muted';
            em.textContent = 'No data';
            legend.appendChild(em);
            return;
        }
        for (const [rule, count] of entries) {
            const frac = count/total;
            const end = start + frac * Math.PI * 2;
            const color = this.colorFor(rule);
            // slice
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, start, end);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.globalAlpha = this.ruleFilter && this.ruleFilter !== rule ? 0.35 : 0.9;
            ctx.fill();
            ctx.globalAlpha = 1;
            // border
            ctx.strokeStyle = '#0f1418';
            ctx.lineWidth = 1;
            ctx.stroke();
            this._chartSlices.push({rule, start, end, color});
            start = end;
        }
        // Inner hole for donut effect
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(cx,cy,r*0.55,0,Math.PI*2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // Legend
        this._setSafeContent(legend, entries.map(([rule,count])=>{
            const color = this.colorFor(rule);
            const active = !this.ruleFilter || this.ruleFilter===rule;
            const opacity = active ? 1 : 0.5;
            const box = `<span style="display:inline-block;width:10px;height:10px;background:${color};border:1px solid #0f1418;margin-right:6px;opacity:${opacity}"></span>`;
            return `<div style="display:flex;align-items:center;gap:6px;">${box}<span>${this.escapeHtml(rule)} (${count})</span></div>`;
        }).join(''));
    },

    onChartClick(evt) {
        if (!this._chartSlices || !this._chartSlices.length) return;
        const canvas = evt.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const cx = canvas.width/2, cy = canvas.height/2;
        const dx = x - cx, dy = y - cy;
        const r = Math.sqrt(dx*dx + dy*dy);
        const outer = Math.min(cx, cy) - 8;
        const inner = outer*0.55;
        if (r < inner || r > outer) return; // outside ring
        let angle = Math.atan2(dy, dx); // -PI..PI, 0 at +x
        angle = angle < -Math.PI/2 ? angle + Math.PI*2 : angle; // align with start offset
        // convert to our coordinate where start was -PI/2
        const a = angle;
        // find slice that contains angle
        for (const s of this._chartSlices) {
            if (a >= s.start && a <= s.end) {
                this.ruleFilter = (this.ruleFilter === s.rule) ? null : s.rule;
                this.render();
                return;
            }
        }
    },

    _colorCache: new Map(),
    colorFor(key) {
        if (this._colorCache.has(key)) return this._colorCache.get(key);
        const palette = ['#4fc3f7','#9575cd','#4db6ac','#ffb74d','#e57373','#81c784','#ba68c8','#7986cb','#ffd54f','#4dd0e1'];
        const hash = Array.from(key).reduce((h,c)=>((h<<5)-h)+c.charCodeAt(0),0);
        const idx = Math.abs(hash) % palette.length;
        const color = palette[idx];
        this._colorCache.set(key, color);
        return color;
    }
};
