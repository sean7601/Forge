/* ===== Forge v2 — Tools: Compiler, Decompiler, SAST, Security, LLM, etc. ===== */

function sanitizeOutputFilename(input, fallbackBase, extWithDot) {
    const ext = extWithDot || '';
    const fallback = String(fallbackBase || 'output').replace(/[\\/:*?"<>|\x00-\x1F]/g, '').trim() || 'output';
    let base = String(input || '').trim();
    if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) {
        base = base.slice(0, -ext.length);
    }
    if (!base) base = fallback;
    base = base.replace(/[\\/:*?"<>|\x00-\x1F]/g, '').trim();
    if (!base) base = fallback;
    return ext ? base + ext : base;
}

function sanitizeJsIdentifier(input, fallback) {
    const fb = String(fallback || 'Value').replace(/[^\w$]/g, '') || 'Value';
    let value = String(input || '').trim();
    if (!value) return fb;
    value = value.replace(/[^\w$]/g, '_');
    if (!/^[A-Za-z_$]/.test(value)) value = '_' + value;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(value)) {
        value = value.slice(0, 128).replace(/[^A-Za-z0-9_$]/g, '_');
        if (!/^[A-Za-z_$]/.test(value)) value = '_' + value;
    }
    return value || fb;
}

// ========================================================================
// COMPILER — Bundles multi-file project into single HTML
// ========================================================================
const compiler = {
    lastCompiledHtml: null,
    lastCompiledName: null,

    problematicPatterns: [
        { pattern: /cdn\.tailwindcss\.com/i, name: 'Tailwind CSS CDN (JIT)', reason: 'Tailwind CDN uses a JS-based JIT compiler that is blocked by strict CSP.', remediation: 'Replace with pre-built CSS: <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">' },
        { pattern: /unpkg\.com\/@tailwindcss\/browser/i, name: 'Tailwind Browser Build', reason: 'Dynamic CSS compilation blocked by CSP.', remediation: 'Replace with pre-built Tailwind CSS.' },
        { pattern: /<script[^>]*>[^<]*(?:eval|new\s+Function|document\.write)/i, name: 'Dynamic Code Execution', reason: 'eval(), new Function(), document.write() blocked by CSP.', remediation: 'Refactor to avoid dynamic code execution or disable security headers.' },
        { pattern: /cdn\.skypack\.dev|esm\.sh|jspm\.dev/i, name: 'ES Module CDN', reason: 'Dynamic module loading conflicts with CSP.', remediation: 'Use traditional CDN script tags or local files.' },
        { pattern: /fetch\s*\(\s*['"`]https?:\/\//i, name: 'External API Fetch', reason: 'Blocked by connect-src: none CSP.', remediation: 'Pre-fetch data as local JSON or use data import/paste workflow.' },
        { pattern: /new\s+XMLHttpRequest[\s\S]{0,200}\.open\s*\(\s*['"`]\w+['"`]\s*,\s*['"`]https?:\/\//i, name: 'External XMLHttpRequest', reason: 'Blocked by connect-src CSP.', remediation: 'Pre-download data as local files.' },
        { pattern: /new\s+WebSocket\s*\(/i, name: 'WebSocket', reason: 'Requires network, blocked by CSP.', remediation: 'Remove or disable security headers.' },
        { pattern: /new\s+EventSource\s*\(/i, name: 'Server-Sent Events', reason: 'Requires server, blocked by CSP.', remediation: 'Remove or disable security headers.' },
        { pattern: /navigator\s*\.\s*sendBeacon\s*\(/i, name: 'sendBeacon', reason: 'Network analytics blocked by CSP.', remediation: 'Remove analytics code.' },
        { pattern: /navigator\s*\.\s*(geolocation|bluetooth|usb|serial|hid)\./i, name: 'Hardware/Location API', reason: 'Restricted by Permissions-Policy header.', remediation: 'Disable security headers to allow hardware access.' }
    ],

    checkForCspIssues(htmlContent) {
        const issues = [];
        for (const entry of this.problematicPatterns) {
            if (entry.pattern.test(htmlContent)) {
                issues.push({ name: entry.name, reason: entry.reason, remediation: entry.remediation });
            }
        }
        return issues;
    },

    async startCompilation() {
        if (!dirHandle) { alert('Load a directory first.'); return; }
        const addSecurityHeaders = document.getElementById('opt-security')?.checked ?? true;
        const inlineCDN = document.getElementById('opt-inline-cdn')?.checked ?? true;
        const minifyFlag = document.getElementById('opt-minify')?.checked ?? false;
        const includeDevconsole = document.getElementById('opt-devconsole')?.checked ?? false;
        const includeTestRecorder = document.getElementById('opt-testrecorder')?.checked ?? false;

        const status = document.getElementById('compiler-status');
        status.innerHTML = '<p style="color:var(--accent)">Compiling...</p>';

        const hashString = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i); return (h >>> 0).toString(16).padStart(8, '0'); };
        const getAttr = (line, attr) => { const m1 = line.match(new RegExp(attr + '\\s*=\\s*"([^"]*)"', 'i')); if (m1) return m1[1]; const m2 = line.match(new RegExp(attr + "\\s*=\\s*'([^']*)'", 'i')); return m2 ? m2[1] : null; };
        const isExternalUrl = (url) => /^(https?:)?\/\//i.test(url);
        const sanitizeScriptContent = (code) => code.replace(/<\/script/gi, '<\\/script');
        const normalizePath = (p) => (p || '').replace(/\\/g, '/').replace(/^\.\/+/, '');

        // Collect files by type
        const files = { html: [], js: [], css: [], img: [] };
        const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif']);
        for (const [path, handle] of Object.entries(fileHandles)) {
            const name = path.split('/').pop();
            let ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
            if (ext === 'htm') ext = 'html';
            if (ext === 'mjs') ext = 'js';
            const content = await readFileContent(path);
            if (files.hasOwnProperty(ext)) {
                files[ext].push({ name, content, relativePath: path, entry: handle });
            } else if (imageExts.has(ext)) {
                files.img.push({ name, content: null, relativePath: path, entry: handle, ext });
            }
        }

        // Choose HTML entry point
        let indexFile = files.html.find(f => f.name.toLowerCase() === 'index.html') || files.html[0];
        if (!indexFile) { status.innerHTML = '<p style="color:var(--error)">No HTML file found!</p>'; return; }
        if (files.html.length > 1) {
            const choice = prompt('Multiple HTML files found. Enter number:\n' + files.html.map((f, i) => (i + 1) + '. ' + f.relativePath).join('\n'), '1');
            if (!choice) return;
            indexFile = files.html[parseInt(choice) - 1] || indexFile;
        }

        // Check CSP issues
        let useSecurityHeaders = addSecurityHeaders;
        if (useSecurityHeaders) {
            let contentToCheck = indexFile.content;
            files.js.forEach(f => contentToCheck += '\n' + f.content);
            const issues = this.checkForCspIssues(contentToCheck);
            if (issues.length > 0) {
                const action = confirm('CSP compatibility issues found:\n\n' + issues.map(i => '- ' + i.name + ': ' + i.reason).join('\n') + '\n\nClick OK to compile without security headers, or Cancel to abort.');
                if (!action) return;
                useSecurityHeaders = false;
            }
        }

        const manifest = { version: 1, project: dirHandle.name, generated: new Date().toISOString(), index: indexFile.name, files: [] };
        let html = indexFile.content.split('\n');
        const foundLines = { js: [], css: [], img: [] };
        const missingLines = { js: [], css: [], img: [] };

        const findLocal = (list, srcFull, baseName) => {
            const srcNorm = normalizePath(srcFull || '');
            if (srcNorm) { const exact = list.find(f => normalizePath(f.relativePath) === srcNorm); if (exact) return exact; }
            if (baseName) { const exact = list.find(f => f.name === baseName); if (exact) return exact; }
            return null;
        };

        const fetchText = async (url) => {
            try {
                const u = url.startsWith('//') ? 'https:' + url : url;
                const res = await fetch(u, { mode: 'cors' });
                return res.ok ? await res.text() : null;
            } catch { return null; }
        };

        // Process each line
        for (let i = 0; i < html.length; i++) {
            let line = html[i];
            if (line.includes('<scr' + 'ipt') && line.includes('src=')) {
                const srcVal = getAttr(line, 'src') || '';
                const srcLower = srcVal.toLowerCase();
                if ((srcLower.includes('devconsole.js') && !srcLower.includes('devconsoletab.js') && !includeDevconsole) || (srcLower.includes('testrecorder.js') && !includeTestRecorder)) {
                    html[i] = '<!-- ' + line.trim() + ' -->';
                    continue;
                }
            }
            if (line.includes('<scr' + 'ipt') && line.includes('src=')) {
                const srcFull = getAttr(line, 'src');
                const fileName = (srcFull || '').split('/').pop();
                if (srcFull && isExternalUrl(srcFull) && inlineCDN) {
                    const cdnJs = await fetchText(srcFull);
                    if (cdnJs !== null) {
                        html[i] = '<script>\n' + sanitizeScriptContent(cdnJs) + '\n<\/script>';
                        foundLines.js.push({ original: line.trim(), replace: srcFull });
                        manifest.files.push({ kind: 'js', path: srcFull, external: true, hash: hashString(cdnJs) });
                    } else { missingLines.js.push({ original: line.trim() }); }
                } else {
                    const jsFile = findLocal(files.js, srcFull, fileName);
                    if (jsFile) {
                        html[i] = '<script>\n' + sanitizeScriptContent(jsFile.content) + '\n<\/script>';
                        foundLines.js.push({ original: line.trim(), replace: jsFile.name });
                        manifest.files.push({ kind: 'js', path: srcFull || jsFile.relativePath, external: false, hash: hashString(jsFile.content) });
                    } else { missingLines.js.push({ original: line.trim() }); }
                }
            } else if (line.includes('<link') && line.includes('href=')) {
                const hrefFull = getAttr(line, 'href');
                const fileName = (hrefFull || '').split('/').pop();
                if (hrefFull && isExternalUrl(hrefFull) && inlineCDN) {
                    const cdnCss = await fetchText(hrefFull);
                    if (cdnCss !== null) {
                        html[i] = '<style>\n' + cdnCss + '\n</style>';
                        foundLines.css.push({ original: line.trim(), replace: hrefFull });
                        manifest.files.push({ kind: 'css', path: hrefFull, external: true, hash: hashString(cdnCss) });
                    } else { missingLines.css.push({ original: line.trim() }); }
                } else {
                    const cssFile = findLocal(files.css, hrefFull, fileName);
                    if (cssFile) {
                        html[i] = '<style>\n' + cssFile.content + '\n</style>';
                        foundLines.css.push({ original: line.trim(), replace: cssFile.name });
                        manifest.files.push({ kind: 'css', path: hrefFull || cssFile.relativePath, external: false, hash: hashString(cssFile.content) });
                    } else { missingLines.css.push({ original: line.trim() }); }
                }
            } else if (line.includes('<img') && line.includes('src=')) {
                const srcFull = getAttr(line, 'src');
                if (srcFull && !isExternalUrl(srcFull) && !srcFull.startsWith('data:')) {
                    const fileName = srcFull.split('/').pop();
                    const imgFile = findLocal(files.img, srcFull, fileName);
                    if (imgFile && imgFile.entry) {
                        try {
                            const file = await imgFile.entry.getFile();
                            const buf = await file.arrayBuffer();
                            const bytes = new Uint8Array(buf);
                            let binary = ''; for (let j = 0; j < bytes.length; j += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
                            const b64 = btoa(binary);
                            const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon' };
                            const mime = mimeMap[imgFile.ext] || 'application/octet-stream';
                            const esc = srcFull.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            html[i] = line.replace(new RegExp('(src\\s*=\\s*["\'])' + esc + '(["\'])', 'i'), '$1data:' + mime + ';base64,' + b64 + '$2');
                            foundLines.img.push({ original: line.trim(), replace: imgFile.name });
                        } catch { missingLines.img.push({ original: line.trim() }); }
                    }
                }
            }
        }

        // Add security headers
        if (useSecurityHeaders) {
            const headIdx = html.findIndex(l => /<head\b/i.test(l));
            if (headIdx !== -1) {
                html.splice(headIdx + 1, 0,
                    '    <!-- Security: Prevent outbound network connections -->',
                    '    <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; worker-src blob:; connect-src \'none\'; img-src data: blob:; media-src \'none\'; form-action \'none\'; frame-src \'none\'; object-src \'none\';">',
                    '    <meta http-equiv="X-Content-Type-Options" content="nosniff">',
                    '    <meta http-equiv="Referrer-Policy" content="no-referrer">',
                    ''
                );
            }
        }

        let compiledBody = html.join('\n');
        const manifestB64 = btoa(unescape(encodeURIComponent(JSON.stringify(manifest))));
        const finalHtml = '<!--WFC-MANIFEST:' + manifestB64 + '-->\n' + compiledBody;

        this.lastCompiledHtml = finalHtml;
        const blob = new Blob([finalHtml], { type: 'text/html;charset=utf-8' });
        const rawName = document.getElementById('compile-filename')?.value || '';
        const outName = sanitizeOutputFilename(rawName, dirHandle.name || 'compiled-app', '.html');
        this.lastCompiledName = outName;
        saveAs(blob, outName);

        // Prompt user to share on Campfire
        setTimeout(() => {
            const modal = document.getElementById('campfire-modal');
            if (modal) modal.classList.add('show');
        }, 300);

        // SHA-256 hash + log
        try {
            const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(finalHtml));
            const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
            const logHandle = await dirHandle.getFileHandle('compiled-hashes.csv', { create: true });
            let existing = ''; try { existing = await (await logHandle.getFile()).text(); } catch { }
            await writeFileToHandle(logHandle, existing + new Date().toISOString() + ',' + outName + ',' + hashHex + '\n');
            status.innerHTML = '<p style="color:var(--success)">Compiled! (' + Math.round(blob.size / 1024) + ' KB)</p><p style="font-size:11px;color:var(--text-dim)">SHA-256: <code>' + hashHex + '</code></p>';
        } catch {
            status.innerHTML = '<p style="color:var(--success)">Compiled! (' + Math.round(blob.size / 1024) + ' KB)</p>';
        }

        // Compilation report
        let report = '<h4 style="margin-top:12px;color:#dce8ff">Compilation Report</h4>';
        const makeTable = (title, lines, showReplace) => {
            if (!lines.length) return '';
            let t = '<p style="margin:8px 0 4px;color:var(--text-dim);font-size:11px">' + title + ' (' + lines.length + ')</p><table class="report-table"><tr><th>#</th><th>Original</th>' + (showReplace ? '<th>Replaced</th>' : '') + '</tr>';
            lines.forEach((l, i) => { t += '<tr><td>' + (i + 1) + '</td><td>' + escHtml(l.original) + '</td>' + (showReplace ? '<td>' + escHtml(l.replace) + '</td>' : '') + '</tr>'; });
            return t + '</table>';
        };
        report += makeTable('Inlined JS', foundLines.js, true);
        report += makeTable('Unresolved JS', missingLines.js, false);
        report += makeTable('Inlined CSS', foundLines.css, true);
        report += makeTable('Unresolved CSS', missingLines.css, false);
        report += makeTable('Inlined Images', foundLines.img, true);
        status.innerHTML += report;
    }
};

// ========================================================================
// DECOMPILER — Extracts files from compiled HTML
// ========================================================================
const decompiler = {
    parseManifest(compiledText) {
        const m = compiledText.match(/<!--WFC-MANIFEST:([^>]*)-->/);
        if (!m) return null;
        try { return JSON.parse(decodeURIComponent(escape(atob(m[1].trim())))); }
        catch { try { return JSON.parse(atob(m[1].trim())); } catch { return null; } }
    },
    _hashString(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i); return (h >>> 0).toString(16).padStart(8, '0'); },
    _normalizeInline(text) { let t = text || ''; if (t.startsWith('\n')) t = t.slice(1); if (t.endsWith('\n')) t = t.slice(0, -1); return t; },
    _stripSecurityFeatures(html) {
        let c = html;
        c = c.replace(/\s*<!--\s*Security:.*?-->\s*/gi, '');
        c = c.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/gi, '');
        c = c.replace(/\s*<meta\s+http-equiv="X-Content-Type-Options"[^>]*>\s*/gi, '');
        c = c.replace(/\s*<meta\s+http-equiv="Referrer-Policy"[^>]*>\s*/gi, '');
        c = c.replace(/\s*<meta\s+http-equiv="Permissions-Policy"[^>]*>\s*/gi, '');
        c = c.replace(/\n\s*\n\s*\n/g, '\n\n');
        return c;
    },
    async decompile(compiledText) {
        const manifest = this.parseManifest(compiledText);
        if (!manifest) throw new Error('No WFC manifest found.');
        const source = this._stripSecurityFeatures(compiledText.replace(/<!--WFC-MANIFEST:[\s\S]*?-->/, ''));
        const scriptBlocks = []; let sm;
        const sre = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
        while ((sm = sre.exec(source)) !== null) { if (!/\bsrc\s*=/i.test(sm[1])) scriptBlocks.push(sm[2]); }
        const styleBlocks = []; const stre = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
        while ((sm = stre.exec(source)) !== null) styleBlocks.push(sm[1]);

        const scriptMap = new Map(); scriptBlocks.forEach(raw => { const n = this._normalizeInline(raw); const h = this._hashString(n); if (!scriptMap.has(h)) scriptMap.set(h, []); scriptMap.get(h).push({ text: n }); });
        const styleMap = new Map(); styleBlocks.forEach(raw => { const n = this._normalizeInline(raw); const h = this._hashString(n); if (!styleMap.has(h)) styleMap.set(h, []); styleMap.get(h).push({ text: n }); });

        const outFiles = [];
        for (const entry of manifest.files || []) {
            if (entry.external) { outFiles.push({ path: entry.path, content: null, kind: entry.kind, external: true }); continue; }
            const map = entry.kind === 'js' ? scriptMap : styleMap;
            const list = map.get(entry.hash) || [];
            const item = list.shift();
            outFiles.push({ path: entry.path, content: item ? item.text : '', kind: entry.kind, external: false, missing: !item });
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(source, 'text/html');
        for (const entry of manifest.files || []) {
            if (entry.kind === 'js') {
                const el = Array.from(doc.querySelectorAll('script:not([src])')).find(s => this._hashString(this._normalizeInline(s.textContent)) === entry.hash);
                if (el) { const r = doc.createElement('script'); r.setAttribute('src', entry.path); el.replaceWith(r); }
            } else if (entry.kind === 'css') {
                const el = Array.from(doc.querySelectorAll('style')).find(s => this._hashString(this._normalizeInline(s.textContent)) === entry.hash);
                if (el) { const r = doc.createElement('link'); r.setAttribute('rel', 'stylesheet'); r.setAttribute('href', entry.path); el.replaceWith(r); }
            }
        }
        const indexHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        return { manifest, files: outFiles, indexHtml };
    },
    async writeOutputToDirectory(output, dir) {
        for (const f of output.files) {
            if (f.external) continue;
            const parts = f.path.replace(/^\/+/, '').split('/');
            const name = parts.pop() || '_';
            let parent = dir;
            for (const p of parts) parent = await parent.getDirectoryHandle(p, { create: true });
            const fh = await parent.getFileHandle(name, { create: true });
            await writeFileToHandle(fh, f.content || '');
        }
        const idxName = output.manifest.index || 'index.html';
        const fh = await dir.getFileHandle(idxName, { create: true });
        await writeFileToHandle(fh, output.indexHtml);
    }
};

// ========================================================================
// SAST SCANNER
// ========================================================================
const sastScanner = {
    patterns: [
        { regex: /\beval\s*\(/g, name: 'eval() usage', severity: 'Critical', desc: 'Code injection risk - eval executes arbitrary code' },
        { regex: /new\s+Function\s*\(/g, name: 'Function constructor', severity: 'Critical', desc: 'Dynamic code execution similar to eval' },
        { regex: /\.innerHTML\s*=/g, name: 'innerHTML assignment', severity: 'High', desc: 'Potential XSS - unsanitized HTML insertion' },
        { regex: /document\.write\s*\(/g, name: 'document.write()', severity: 'High', desc: 'XSS risk and blocks page rendering' },
        { regex: /setTimeout\s*\(\s*['"`]/g, name: 'setTimeout with string', severity: 'High', desc: 'Implicit eval - pass function instead of string' },
        { regex: /setInterval\s*\(\s*['"`]/g, name: 'setInterval with string', severity: 'High', desc: 'Implicit eval - pass function instead of string' },
        { regex: /(password|secret|apikey|api_key|token)\s*[:=]\s*['"]/gi, name: 'Hardcoded credentials', severity: 'Critical', desc: 'Sensitive data should not be in source code' },
        { regex: /http:\/\//g, name: 'Insecure HTTP URL', severity: 'Medium', desc: 'Use HTTPS for secure connections' },
        { regex: /\.exec\s*\(/g, name: 'exec() call', severity: 'Medium', desc: 'Potential code injection via regex exec' }
    ],
    async runScan() {
        if (!dirHandle) { alert('Load a directory first.'); return []; }
        const issues = [];
        for (const [path, handle] of Object.entries(fileHandles)) {
            const ext = path.split('.').pop().toLowerCase();
            if (!['js', 'mjs', 'html', 'htm'].includes(ext)) continue;
            try {
                const text = await readFileContent(path);
                const lines = text.split('\n');
                lines.forEach((line, i) => {
                    this.patterns.forEach(p => {
                        p.regex.lastIndex = 0;
                        if (p.regex.test(line)) {
                            issues.push({ path, line: i + 1, name: p.name, severity: p.severity, desc: p.desc, code: line.trim().substring(0, 120) });
                        }
                    });
                });
            } catch { }
        }
        return issues;
    },
    renderChart(canvas, issues) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const counts = {};
        issues.forEach(i => { counts[i.name] = (counts[i.name] || 0) + 1; });
        const labels = Object.keys(counts);
        const values = Object.values(counts);
        const total = values.reduce((a, b) => a + b, 0);
        const colors = ['#e74c3c', '#f39c12', '#3498db', '#2ecc71', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6', '#34495e'];
        let startAngle = 0;
        const cx = canvas.width / 2, cy = canvas.height / 2, r = Math.min(cx, cy) - 10;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        labels.forEach((label, i) => {
            const sliceAngle = (values[i] / total) * 2 * Math.PI;
            ctx.beginPath(); ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
            ctx.fillStyle = colors[i % colors.length]; ctx.fill();
            startAngle += sliceAngle;
        });
        return labels.map((l, i) => ({ label: l, count: values[i], color: colors[i % colors.length] }));
    },
    generateFixPrompt(issues) {
        if (!issues.length) return '';
        let prompt = 'Please fix the following security issues found by SAST scanning:\n\n';
        issues.forEach((iss, i) => {
            prompt += (i + 1) + '. [' + iss.severity + '] ' + iss.name + ' in ' + iss.path + ':' + iss.line + '\n   Code: ' + iss.code + '\n   Issue: ' + iss.desc + '\n\n';
        });
        prompt += 'For each issue, provide the corrected code. Use secure alternatives (e.g., textContent instead of innerHTML, function references instead of eval).';
        return prompt;
    }
};

// ========================================================================
// SECURITY REVIEWER + SBOM
// ========================================================================
const securityReviewer = {
    async generateSBOM() {
        const components = [];
        for (const [path, handle] of Object.entries(fileHandles)) {
            if (!path.match(/\.html?$/i)) continue;
            const text = await readFileContent(path);
            const scriptRe = /<script[^>]*src=["']([^"']+)["'][^>]*>/gi;
            const linkRe = /<link[^>]*href=["']([^"']+)["'][^>]*>/gi;
            let m;
            while ((m = scriptRe.exec(text)) !== null) {
                if (/^https?:\/\//i.test(m[1])) {
                    const url = m[1];
                    const parts = url.split('/');
                    const name = parts.pop().replace(/\.min\.js$|\.js$/, '') || 'unknown';
                    components.push({ type: 'javascript', name, version: 'CDN', source: 'cdn', url, license: 'Unknown' });
                }
            }
            while ((m = linkRe.exec(text)) !== null) {
                if (/^https?:\/\//i.test(m[1]) && /\.css/i.test(m[1])) {
                    const url = m[1];
                    const parts = url.split('/');
                    const name = parts.pop().replace(/\.min\.css$|\.css$/, '') || 'unknown';
                    components.push({ type: 'css', name, version: 'CDN', source: 'cdn', url, license: 'Unknown' });
                }
            }
        }
        if (fileHandles['package.json']) {
            try {
                const text = await readFileContent('package.json');
                const pkg = JSON.parse(text);
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                for (const [name, ver] of Object.entries(deps)) {
                    components.push({ type: 'npm-package', name, version: ver, source: 'package.json', license: 'Unknown' });
                }
            } catch { }
        }
        return components;
    },
    generateSTIGPrompt() {
        return `You are a cybersecurity expert specializing in DoD Application Security & Development (ASD) STIG compliance.

Assess the following web application code against these STIG controls:
- V-222602: Application must not store unnecessary data
- V-222609: Application must not be vulnerable to XML/XSS attacks
- V-222612: Application must protect cookies
- V-222620: Application must validate all input
- V-222627: Application must implement CSP
- V-222642: Application must not contain hard-coded credentials

For each control, provide:
1. Finding status: Not A Finding / Open / Not Applicable
2. Evidence from the code
3. Recommended remediation if Open

Provide your assessment in a structured format.`;
    },
    async generateSecurityReport(sastIssues, sbomData) {
        let report = '<div style="font-family:var(--font-code);font-size:12px">';
        report += '<h3 style="color:var(--accent);border-bottom:1px solid var(--border);padding-bottom:6px">SECURITY IMPLEMENTATION SUMMARY</h3>';
        report += '<p><strong>Project:</strong> ' + escHtml(dirHandle?.name || 'Unknown') + '</p>';
        report += '<p><strong>Generated:</strong> ' + new Date().toISOString() + '</p>';
        report += '<h4 style="color:var(--accent2);margin-top:16px">Security Architecture</h4>';
        report += '<ul><li>Content Security Policy (CSP) injection via compiler</li>';
        report += '<li>X-Content-Type-Options: nosniff</li>';
        report += '<li>Referrer-Policy: no-referrer</li>';
        report += '<li>Offline-first design (no external network dependencies)</li></ul>';
        if (sastIssues && sastIssues.length) {
            report += '<h4 style="color:var(--severity-high);margin-top:16px">SAST Findings (' + sastIssues.length + ')</h4>';
            const critical = sastIssues.filter(i => i.severity === 'Critical').length;
            const high = sastIssues.filter(i => i.severity === 'High').length;
            const medium = sastIssues.filter(i => i.severity === 'Medium').length;
            report += '<p>Critical: ' + critical + ' | High: ' + high + ' | Medium: ' + medium + '</p>';
        } else {
            report += '<h4 style="color:var(--success);margin-top:16px">SAST: No Issues Found</h4>';
        }
        if (sbomData && sbomData.length) {
            report += '<h4 style="color:var(--accent);margin-top:16px">Software Bill of Materials (' + sbomData.length + ' components)</h4>';
            report += '<table class="report-table"><tr><th>Name</th><th>Type</th><th>Version</th><th>Source</th></tr>';
            sbomData.forEach(c => {
                report += '<tr><td>' + escHtml(c.name) + '</td><td>' + escHtml(c.type) + '</td><td>' + escHtml(c.version) + '</td><td>' + escHtml(c.source) + '</td></tr>';
            });
            report += '</table>';
        }
        report += '</div>';
        return report;
    },
    exportSBOMJson(sbomData) {
        const cyclonedx = {
            bomFormat: 'CycloneDX', specVersion: '1.4', version: 1,
            metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: 'Forge', name: 'Forge', version: '2.0' }] },
            components: sbomData.map(c => ({ type: c.type === 'npm-package' ? 'library' : 'framework', name: c.name, version: c.version, purl: c.url || '' }))
        };
        const blob = new Blob([JSON.stringify(cyclonedx, null, 2)], { type: 'application/json' });
        saveAs(blob, (dirHandle?.name || 'project') + '-sbom.json');
    }
};

// ========================================================================
// LLM FORMATTER
// ========================================================================
const llmFormatter = {
    async generateContext() {
        if (!dirHandle) { alert('Load a directory first.'); return; }
        const htmlFiles = Object.keys(fileHandles).filter(p => /\.html?$/i.test(p));
        const entryPath = htmlFiles.find(p => p.split('/').pop().toLowerCase() === 'index.html') || htmlFiles[0];
        let allPaths = Object.keys(fileHandles);
        allPaths = allPaths.filter(p => {
            const name = p.split('/').pop().toLowerCase();
            return name !== 'devconsole.js' && name !== 'testrecorder.js' && name !== 'compiled-hashes.csv';
        });
        let output = '';
        for (const path of allPaths) {
            try {
                const text = await readFileContent(path);
                output += '=== ' + path + ' ===\n' + text + '\n\n';
            } catch { }
        }
        return output;
    },
    estimateTokenCount(text) { return Math.round((text || '').length / 4); },
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
};

// ========================================================================
// AI HELPER PROMPT TEMPLATES
// ========================================================================
const aiHelper = {
    templates: {
        1: `You are a classic Jobs To Be Done (JTBD) interviewer helping me discover what software should solve.

Your interview goal:
- Surface the real situations that cause people to seek progress.
- Capture the four forces for each promising job:
  - Push of the current situation
  - Pull of a better future
  - Anxiety about switching or trying something new
  - Habit/inertia keeping the current behavior in place
- Produce exactly 3 clear JTBD statements in this format:
  - When <specific situation/trigger>, I want to <progress desired>, so I can <ultimate outcome>.
- For each job, produce exactly 5 practical tool ideas that fit the required form factor.

Required tool form factor:
- Tools must be static/offline-capable HTML apps.
- Use vanilla JavaScript.
- Persistence must work through downloaded/uploaded JSON files, the File System Access API where appropriate, or SharePoint list integration.
- Do not propose tools that require a server, always-on internet, a cloud database, accounts, or a build pipeline.

Interview rules:
1. Start from zero context. Assume I have not explained the problem yet.
2. Ask exactly one question per reply.
3. Keep questions short, plain, and specific.
4. Ask for real past moments, not opinions about hypothetical features.
5. Probe in this order unless already answered:
   - recent specific situation
   - trigger or first moment of struggle
   - current workaround
   - push/frustrations with the current way
   - pull/what better would look like
   - anxieties/risks with changing
   - habits/inertia keeping the current way alive
   - constraints, environment, data sources, and sharing needs
6. Do not suggest features or tools during the interview.
7. If an answer is vague, ask one concrete follow-up about a specific recent example.
8. Stop once you have enough signal for 3 candidate jobs, usually after 6-8 total questions.
9. Never ask me to repeat the whole story.

After each answer:
- Briefly acknowledge what you learned in one sentence.
- Ask the single best next unanswered JTBD interview question.

When you have enough information, stop asking questions and output only:

Interview Summary:
- 3-5 bullets summarizing the concrete situations, current workarounds, constraints, and desired progress.

Four Forces:
- Push:
  - ...
- Pull:
  - ...
- Anxiety:
  - ...
- Habit:
  - ...

Jobs:
1. When ..., I want to ..., so I can ...
2. When ..., I want to ..., so I can ...
3. When ..., I want to ..., so I can ...

Tools For Job 1:
- Tool 1 Name - Static/offline HTML app concept; data stored with JSON files or SharePoint lists; why it fits this job.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Tools For Job 2:
- Tool 1 Name - Static/offline HTML app concept; data stored with JSON files or SharePoint lists; why it fits this job.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Tools For Job 3:
- Tool 1 Name - Static/offline HTML app concept; data stored with JSON files or SharePoint lists; why it fits this job.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Start the interview from this seed topic:
{context}`,
        2: `You are a Jobs To Be Done (JTBD) product strategist. A user will paste a short JTBD interview summary. Using only the provided summary, do the following:

1. Extract exactly 3 Jobs To Be Done.
2. Phrase each job as: "When <specific situation/trigger>, I want to <progress desired>, so I can <ultimate outcome>."
3. For each job, list exactly 5 distinct tool ideas.
4. Tool ideas must fit this form factor:
   - static/offline-capable HTML app
   - vanilla JavaScript
   - persistence through downloaded/uploaded JSON files, the File System Access API where appropriate, or SharePoint list integration
   - no required server, cloud database, always-on internet, accounts, or build pipeline
5. Each tool idea must include a one-line name, a 1-2 sentence description, and why it helps the job.
6. Keep everything concise and scannable.
7. IMPORTANT: Assume the AI does not remember earlier steps. This output must stand alone.

Input Interview Summary:
{context}

Output format:
Jobs:
1. When ..., I want to ..., so I can ...
2. When ..., I want to ..., so I can ...
3. When ..., I want to ..., so I can ...

Tools For Job 1:
- Tool 1 Name - description; JSON file or SharePoint persistence approach; why it helps.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Tools For Job 2:
- Tool 1 Name - description; JSON file or SharePoint persistence approach; why it helps.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Tools For Job 3:
- Tool 1 Name - description; JSON file or SharePoint persistence approach; why it helps.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...`,
        3: 'You are a lean experimentation coach. Produce an MVP ladder of 5 versions with increasing scope for:\n- Each MVP: Name, Hypothesis, User Action(s), Signal, Build Scope\n- MVP 1 = almost trivial, MVP 5 = full core promise\n\nJob + Tool Idea:\n{context}',
        4: 'You are a full-stack architect. Outline 3 technical approaches for a static web app. Focus on vanilla JS, offline-capable. No frameworks like React/Vue.\nHighlight pros/cons and offline constraints.\n\nSolution concept:\n{context}',
        5: 'Build this app:\n\n{context}\n\nRequirements:\n1) Vanilla JS only, CDN for development ok\n2) Single HTML file (or 1 HTML + 1 CSS + 1 JS max)\n3) Start with architecture.txt\n4) Generate COMPLETE code, no placeholders\n5) No UI frameworks (React, Vue, etc.)',
        6: 'Add JSON save/load to my app. Download all data as JSON, upload to restore.\n\nWhat to save: {context}\n\nRequirements: vanilla JS, date in filename, success/error messages.\nProvide COMPLETE file content.',
        7: 'Add CSV/Excel import to my app. Accept .csv, .xlsx, .xls. Show preview before importing.\n\nSpreadsheet format: {context}\n\nUse SheetJS library. Provide COMPLETE file content.',
        8: 'Add document export (Word/PPT/PDF) to my app.\n\nExport format: {context}\n\nUse: docx@8.2.3, pptxgenjs@3.12.0, jspdf@2.5.1 CDN libraries.\nProvide COMPLETE file content.',
        9: 'Add OCR (image text extraction) to my app using Tesseract.js.\n\nImage types: {context}\n\nShow preview, progress bar, editable text output, copy button.\nProvide COMPLETE file content.',
        10: 'Add LLM-powered data analysis: Generate AI Prompt -> user pastes into chatbot -> paste JSON back -> visualize results.\n\nData/insights: {context}\n\nProvide COMPLETE file content.',
        11: `Add SharePoint list integration for data persistence to my existing HTML/JavaScript app. The app will be hosted inside SharePoint (via an HTML File Viewer web part or similar iframe-based approach).

My app-specific data model / target SharePoint details:
{context}

Use the following as the implementation brief whenever you integrate this app with SharePoint.

SharePoint Integration Notes for This App
=========================================

Environment
-----------
- Ask me for the exact SharePoint site URL if it is not already provided.
- Do not invent or reuse a site URL from another app.
- The app may be hosted inside SharePoint through an HTML File Viewer web part or another iframe-based surface.
- In that scenario, \`window.location\` may be \`about:srcdoc\` and cannot be trusted as the site URL.

SharePoint list naming
----------------------
- Choose a list title that clearly matches this app, such as \`<Short App Name> Data\` or \`<Short App Name> Items\`.
- Derive \`<Short App Name>\` from the actual app name, heading, file name, or user-provided context.
- Do not use generic, stale, or unrelated list names from previous apps.
- If the app name is unclear, propose one simple list title and mark it as a value to confirm.
- Keep the configured list title centralized in one runtime config object.

Simple list schema rule
-----------------------
- Keep the SharePoint list schema intentionally small.
- Prefer one app data list unless the app truly has separate independent record types.
- Start with SharePoint's built-in fields:
  - \`Title\`
  - \`Created\`
  - \`Modified\`
  - \`Author\`
  - \`Editor\`
- Add only these default custom columns:
  - \`ItemType\` - Single line of text, optional category such as task, note, event, setting, or record.
  - \`DataJson\` - Multiple lines of text, Plain Text, stores the full app record as JSON.
- Add extra custom columns only when the app needs SharePoint-side filtering, sorting, views, or reporting.
- Avoid wide schemas. Do not create a column for every property in the JavaScript object.
- Keep the recommended schema to 2-5 custom columns total unless there is a clear app-specific reason.
- Use short, readable column names that match the app domain.
- Use Plain Text, not Rich Text, for any field that stores freeform app content or JSON.

Optional extra columns
----------------------
Only add these if the app clearly needs them:
- \`Status\` - Choice, only if records have a visible workflow state.
- \`DueDate\` or another app-specific date - Date and Time, only if users sort/filter by date.
- \`Owner\` - Person or Single line of text, only if assignment is part of the app.
- One app-specific lookup/filter key, only if the UI needs fast filtering without parsing JSON.

Do not add columns just because data exists in the app. If the field is only used by the app after load, store it inside \`DataJson\`.

What the app is
---------------
- This is a single-page app.
- It should not navigate between pages for normal in-app view changes.
- It should swap views by updating DOM content with JavaScript.
- Inside SharePoint, app buttons must not behave like form submit buttons.

Critical UI behavior requirements
---------------------------------
- Do not rely on URL/hash routing for view changes unless there is a strong reason.
- Prefer in-memory view state, for example:
  - \`{ name: 'home' }\`
  - \`{ name: 'list' }\`
  - \`{ name: 'detail', id: 1 }\`
  - \`{ name: 'settings' }\`
- All generated buttons in the app must explicitly use:
  - \`type="button"\`
- Remove any existing inline event handler attributes anywhere in the app, for example:
  - \`onclick\`
  - \`onchange\`
  - \`oninput\`
  - \`onsubmit\`
- Replace inline handlers with JavaScript-bound listeners, preferably delegated listeners via \`addEventListener(...)\`.
- Do not introduce new inline event handlers in generated HTML or HTML strings.
- Delegated click handlers inside the app should call:
  - \`event.preventDefault()\`
  - \`event.stopPropagation()\`
- Reason:
  - Inside SharePoint, plain \`<button>\` elements can trigger host-page form submission/postback behavior.
  - Inline event handler attributes can also break in SharePoint-hosted app surfaces.

SharePoint naming detail
------------------------
SharePoint list/library titles and URLs are not always the same.

Do not assume:
- library title == library URL
- folder name == library name
- list title == what appears in a page URL

Always verify:
- exact site absolute URL
- exact list title
- exact document library title, if files are used
- exact folder server-relative path, if files are used

File storage assumptions
------------------------
- Only add document/file integration if this app actually stores uploaded files.
- If the app stores files, prefer a folder inside the standard document library instead of creating a new library.
- Verify the library title and folder path separately.
- Read document items from the library and filter to the folder using \`FileDirRef\`.
- Upload new files with \`GetFolderByServerRelativeUrl\`.
- Do not add custom library columns unless the app needs them for visible SharePoint views or filtering.

Correct SharePoint REST patterns for this app
---------------------------------------------
Always use:
- \`credentials: 'include'\`

Accept header:
- \`Accept: application/json;odata=verbose\`

Request digest:
- Required for POST/MERGE/DELETE
- Retrieve from:
  - \`/_api/contextinfo\`
- Cache for about 15 minutes, or slightly less than the server timeout

GET examples
------------
Load app data list items:
- \`/_api/web/lists/getbytitle('<APP_DATA_LIST_TITLE>')/items?$select=Id,Title,ItemType,DataJson,Created,Modified&$orderby=Modified desc&$top=5000\`

Load documents from a library folder, only if the app uses files:
- \`/_api/web/lists/getbytitle('<DOCUMENT_LIBRARY_TITLE>')/items?$select=Id,FileLeafRef,FileRef,FileDirRef,Created,Modified,FSObjType&$filter=FSObjType eq 0 and FileDirRef eq '<DOCUMENT_FOLDER_SERVER_RELATIVE_PATH>'&$orderby=Modified desc&$top=5000\`

POST create example
-------------------
- URL:
  - \`/_api/web/lists/getbytitle('<APP_DATA_LIST_TITLE>')/items\`
- Headers:
  - \`X-RequestDigest\`
- Body should include:
  - \`Title\`
  - \`ItemType\`, if used
  - \`DataJson\`
- Note:
  - do not hardcode the entity type if avoidable
  - fetch \`ListItemEntityTypeFullName\` dynamically from list metadata

MERGE update example
--------------------
- URL:
  - \`/_api/web/lists/getbytitle('<APP_DATA_LIST_TITLE>')/items(ID)\`
- Headers:
  - \`X-RequestDigest\`
  - \`IF-MATCH: *\`
  - \`X-HTTP-Method: MERGE\`

Document upload example, only if the app uses files
---------------------------------------------------
- URL pattern:
  - \`/_api/web/GetFolderByServerRelativeUrl('<DOCUMENT_FOLDER_SERVER_RELATIVE_PATH>')/Files/add(url='filename.ext',overwrite=false)\`
- Use raw binary body.
- Include request digest.

Iframe/site detection requirements
----------------------------------
When running inside SharePoint iframe-like containers:
- \`window.location\` may be \`about:srcdoc\`
- use fallback logic in this order:
  1. \`_spPageContextInfo.webAbsoluteUrl\`
  2. \`window.parent.location.href\` inside \`try/catch\`
  3. \`document.referrer\`
  4. configured fallback site URL

When deriving the site URL:
- accept SharePoint hostnames by checking if hostname includes:
  - \`sharepoint\`
- support paths like:
  - \`/sites/...\`
  - \`/teams/...\`
- stop the site path before segments such as:
  - \`_layouts\`
  - \`SitePages\`
  - \`Lists\`
  - \`Shared Documents\`
  - \`SiteAssets\`
  - \`Forms\`
  - \`Documents\`

Pagination rules
----------------
- SharePoint commonly returns partial result sets.
- Use \`$top=5000\`.
- Follow \`d.__next\` until exhausted.

Known failure cases to avoid
----------------------------
1. Wrong site root
- Symptom:
  - list requests 404
- Fix:
  - use the full site URL, including the \`/sites/...\` or \`/teams/...\` path.

2. Wrong list title
- Symptom:
  - SharePoint says the list does not exist.
- Fix:
  - point the app at the actual list title, not the page URL or an old example name.

3. Wrong library title
- Symptom:
  - SharePoint says the document library does not exist.
- Fix:
  - use the actual library title for \`getbytitle(...)\` and the actual server-relative folder path for \`FileDirRef\`.

4. Folder vs library confusion
- Symptom:
  - documents do not appear or uploads go to the wrong place.
- Fix:
  - read from the document library list items, filter by \`FileDirRef\`, and upload with \`GetFolderByServerRelativeUrl\`.

5. SPA controls resetting inside SharePoint
- Symptom:
  - a button appears to work, the page flashes, then the app resets.
- Fix:
  - all app buttons must be \`type="button"\`
  - delegated click handlers must call \`preventDefault\` and \`stopPropagation\`
  - prefer in-memory view switching over URL navigation

6. Local-only behavior not matching SharePoint behavior
- Symptom:
  - works from \`file://\`
  - fails when hosted in SharePoint
- Fix:
  - validate UI interactions inside the actual SharePoint host.

Recommended code organization
-----------------------------
Prefer splitting the app into:
- \`index.html\`
  - shell only
- \`app.css\`
  - layout and component styling
- \`sharepoint.js\`
  - config, site detection, REST helpers, request digest, list access, optional file access
- \`app.js\`
  - view state, DOM rendering, event delegation, action handlers

Reason:
- easier debugging
- easier reuse
- easier to swap data layer without touching view code

Recommended runtime config block
--------------------------------
Keep the following values centralized in one place:
- site URL
- app data list title
- app data list item entity type
- request digest TTL
- document library title, only if files are used
- document folder server-relative path, only if files are used

Example config shape:
- \`siteUrl: '<SHAREPOINT_SITE_URL>'\`
- \`dataListTitle: '<APP_DATA_LIST_TITLE>'\`
- \`dataListEntityType: null\`
- \`requestDigestTtlMs: 14 * 60 * 1000\`
- \`documentLibraryTitle: '<DOCUMENT_LIBRARY_TITLE>'\`
- \`documentFolderPath: '<DOCUMENT_FOLDER_SERVER_RELATIVE_PATH>'\`

Implementation checklist
------------------------
1. Confirm the SharePoint site absolute URL.
2. Choose or confirm an app-specific data list title.
3. Keep the list schema simple: \`Title\`, \`ItemType\`, and \`DataJson\` are usually enough.
4. Add extra columns only for fields that need SharePoint-side filtering, sorting, views, or reporting.
5. Confirm the exact document library title and folder path only if files are used.
6. Verify the folder exists before testing upload, if files are used.
7. Verify all app buttons are \`type="button"\`.
8. Verify clicks do not submit the host SharePoint form.
9. Test inside SharePoint, not just from local files.
10. If a 404 mentions a list title, re-check title vs URL naming.
11. If documents do not load, re-check library title vs folder path.

Implementation instructions for you:
- Preserve existing app behavior and styling unless SharePoint integration requires a deliberate UI adjustment.
- Do not invent exact SharePoint titles, folder paths, or field internal names if they are missing; ask me for them or clearly mark them as values to confirm.
- Do not reuse stale list names, folder names, or field names from unrelated apps.
- Generate an app-specific list title based on this app, and use that same title consistently in config, REST calls, and setup instructions.
- Keep the SharePoint list nice and simple. Avoid large schemas and unnecessary columns.
- For create/update/delete operations, use SharePoint REST with \`credentials: 'include'\`, the verbose JSON accept header, and request-digest handling.
- For list-item entity type names, fetch list metadata dynamically when practical instead of hardcoding.
- For document reads, treat the folder as a filtered subset of the document library, not as a separate library.
- For view changes in the SPA, prefer in-memory state and DOM replacement, not full navigation.
- Ensure every app button is \`type="button"\` and delegated click handlers call both \`preventDefault()\` and \`stopPropagation()\`.
- Follow pagination until exhausted.

Please provide:
1. The COMPLETE file content with the new functionality integrated. Do NOT provide snippets.
2. A short SharePoint setup section with the app-specific list title and a simple column list.
3. Document library and folder instructions only if the app actually uses uploaded files.
4. Any configuration values I must update before deployment.

NOTE: If you do not already have my app code, ask me to share it first before writing code.`,
        18: `My app already has working SharePoint list integration. Now add simple live updates via polling on top of that existing SharePoint data layer.

Relevant app code / current data flow:
{context}

This is a follow-up prompt to use AFTER the base SharePoint list integration is already implemented.

Requirements:
- Do not redesign the whole SharePoint integration from scratch.
- Reuse the existing SharePoint REST helpers, config, request-digest handling, and state model where practical.
- Keep the implementation simple, clean, and scalable for a browser-hosted SharePoint app.
- Use polling only. Do not introduce sockets, SignalR, webhooks, server push, or backend services.
- Prefer one polling controller/service with:
  - one active timer at a time
  - one in-flight poll at a time
  - polling logic separated from rendering logic
- Prefer \`setTimeout\` polling instead of \`setInterval\` so the next cycle starts only after the current one completes.
- Default behavior:
  - poll every \`15-30\` seconds while the tab is visible
  - slow down substantially when the tab is hidden, for example \`60-120\` seconds
  - temporarily back off after repeated errors
- Do not poll while:
  - initial load is still running
  - a write/update/upload/delete request is in flight
  - another poll is already running
- Prefer lightweight change detection:
  - track a \`lastSync\`, \`lastSeenModified\`, or equivalent watermark
  - request only fields needed for change detection before expensive rerenders when practical
  - rerender only when data actually changed
- Prefer incremental reconciliation:
  - merge changed SharePoint items/documents into in-memory state
  - avoid full DOM rebuilds if only a subset of records changed
  - if delete detection is difficult, use occasional slower full reconciliation instead of making the normal path complicated
- Keep conflict handling simple:
  - SharePoint is the source of truth after successful writes
  - after create/update/delete, trigger a targeted refresh or reset the sync watermark
  - avoid elaborate optimistic concurrency systems unless clearly necessary
- UI guidance:
  - add a small unobtrusive sync status such as \`Syncing...\`, \`Updated just now\`, or \`Retrying...\`
  - do not use modal dialogs for routine polling events
- Keep all existing SharePoint compatibility constraints:
  - no inline event handlers
  - buttons should remain \`type="button"\`
  - delegated handlers should still use \`preventDefault()\` and \`stopPropagation()\` where appropriate

Please provide:
1. The COMPLETE file content for every changed file. Do NOT provide snippets.
2. A short explanation of the polling design.
3. Any config values I should tune, such as polling interval or backoff.

NOTE: If you do not already have my app code, ask me to share it first before writing code.`
    },
    generate(step, context) {
        const tmpl = this.templates[step];
        if (!tmpl) return '';
        return tmpl.replace('{context}', context || '(no additional context)');
    }
};

// ========================================================================
// DEV CONSOLE
// ========================================================================
const devConsole = {
    getCode() {
        return `/* Dev Console - passive log viewer (no eval) */
(function(){
  if (window.__wctDevConsoleLoaded) return;
  window.__wctDevConsoleLoaded = true;

  const root = document.createElement('div');
  root.id = 'dev-console-float';
  root.innerHTML =
    '<div id="dc-panel" style="position:fixed;bottom:10px;right:10px;z-index:99999;background:#1e1e2e;border:1px solid #333;border-radius:8px;width:380px;max-height:320px;overflow:auto;padding:8px;font-family:monospace;font-size:12px;color:#e2e8f0;display:none">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><strong>Dev Console</strong><button id="dc-clear" style="background:#2a2a3a;color:#e2e8f0;border:1px solid #444;border-radius:4px;padding:2px 6px;cursor:pointer">Clear</button></div>' +
      '<div id="dc-log" style="white-space:pre-wrap;line-height:1.35"></div>' +
    '</div>' +
    '<button id="dc-toggle" style="position:fixed;bottom:10px;right:10px;z-index:99999;background:#d4a843;color:#1a1a2e;border:none;border-radius:50%;width:40px;height:40px;cursor:pointer;font-size:18px">C</button>';
  document.body.appendChild(root);

  const panel = document.getElementById('dc-panel');
  const log = document.getElementById('dc-log');
  const toggle = document.getElementById('dc-toggle');
  const clear = document.getElementById('dc-clear');

  const format = (v) => {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  const append = (value, isError) => {
    if (!log) return;
    const row = document.createElement('div');
    if (isError) row.style.color = '#e74c3c';
    row.textContent = value;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  };

  toggle.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  clear.addEventListener('click', () => {
    log.textContent = '';
  });

  const origLog = console.log.bind(console);
  console.log = function () {
    origLog.apply(console, arguments);
    append(Array.from(arguments).map(format).join(' '), false);
  };

  const origError = console.error.bind(console);
  console.error = function () {
    origError.apply(console, arguments);
    append(Array.from(arguments).map(format).join(' '), true);
  };

  window.addEventListener('error', (ev) => {
    append(ev.message || 'Script error', true);
  });
})();`;
    },
    async integrate() {
        if (!dirHandle) { alert('Load a directory first.'); return; }
        try {
            await writeNewFile('devconsole.js', this.getCode());
            return true;
        } catch (e) { console.error(e); return false; }
    },
    checkStatus() { return !!fileHandles['devconsole.js']; }
};

// ========================================================================
// TEST RECORDER
// ========================================================================
const testRecorder = {
    getCode() {
        return `/* Test Recorder - Ctrl+Alt+R to toggle recording */
(function(){let recording=false,steps=[],startTime=0;
document.addEventListener('keydown',function(e){if(e.ctrlKey&&e.altKey&&e.key==='r'){recording=!recording;if(recording){steps=[];startTime=Date.now();console.log('[TestRecorder] Recording started')}else{console.log('[TestRecorder] Recording stopped. '+steps.length+' steps recorded.');const blob=new Blob([JSON.stringify({name:'recorded-test',steps:steps},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='test-scenario.json';a.click()}}});
document.addEventListener('click',function(e){if(!recording)return;const sel=e.target.id?'#'+e.target.id:e.target.className?'.'+e.target.className.split(' ')[0]:e.target.tagName.toLowerCase();steps.push({type:'click',selector:sel,delayMs:Date.now()-startTime})},true);
document.addEventListener('input',function(e){if(!recording)return;const sel=e.target.id?'#'+e.target.id:e.target.name?'[name='+e.target.name+']':e.target.tagName.toLowerCase();steps.push({type:'input',selector:sel,value:e.target.value,delayMs:Date.now()-startTime})},true)})();`;
    },
    async integrate() {
        if (!dirHandle) { alert('Load a directory first.'); return; }
        try {
            await writeNewFile('testRecorder.js', this.getCode());
            return true;
        } catch (e) { console.error(e); return false; }
    },
    checkStatus() { return !!fileHandles['testRecorder.js']; }
};

// ========================================================================
// MATH & LOGIC TESTER
// ========================================================================
const mathTester = {
    async generatePrompt(selectedPaths) {
        let code = '';
        for (const path of selectedPaths) {
            const text = await readFileContent(path);
            code += '=== ' + path + ' ===\n' + text + '\n\n';
        }
        return `You are a software quality engineer. Audit the mathematical and logical correctness of the following code.

For each calculation or logical operation found, provide:

1. **Plain Language Math Explanation**: What is the code trying to compute? State the goal, the formula/algorithm, and the overall workflow.

2. **Validity & Assumptions Assessment**: Is the math correct? What edge cases could break it? What assumptions are made? Are there rounding/precision pitfalls?

3. **Manual "Napkin Math" Test Cases**: Provide 3 test cases at different complexity levels:
   - Simple: basic inputs with obvious expected output
   - Moderate: realistic inputs
   - Complex: edge cases or stress-test values
   For each, show the input, expected output, and how you computed it by hand.

4. **JSON Test Payload** (if applicable): Provide a JSON object that could be used to programmatically test the calculations.

Code to audit:

${code}`;
    }
};

// ========================================================================
// SHAREDRIVE-NOSQL
// ========================================================================
const sharedriveNosql = {
    getCode() {
        return `/* ShareDrive-NoSQL - File-based JSON database using File System Access API */
const ShareDriveDB = {
    _dirHandle: null,
    async open() {
        this._dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        return this;
    },
    async read(collection) {
        try {
            const fh = await this._dirHandle.getFileHandle(collection + '.json', { create: false });
            const file = await fh.getFile();
            return JSON.parse(await file.text());
        } catch { return []; }
    },
    async write(collection, data) {
        const fh = await this._dirHandle.getFileHandle(collection + '.json', { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(data, null, 2));
        await w.close();
    },
    async append(collection, record) {
        const data = await this.read(collection);
        record._id = record._id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        record._ts = new Date().toISOString();
        data.push(record);
        await this.write(collection, data);
        return record;
    },
    async find(collection, predicate) {
        const data = await this.read(collection);
        return typeof predicate === 'function' ? data.filter(predicate) : data;
    },
    async remove(collection, predicate) {
        const data = await this.read(collection);
        const kept = data.filter(r => !predicate(r));
        await this.write(collection, kept);
        return data.length - kept.length;
    }
};`;
    },
    async integrate() {
        if (!dirHandle) { alert('Load a directory first.'); return; }
        try {
            await writeNewFile('sharedrive-nosql.js', this.getCode());
            return true;
        } catch (e) { console.error(e); return false; }
    },
    checkStatus() { return !!fileHandles['sharedrive-nosql.js']; }
};

// ========================================================================
// LEAFLET MAP TOOL
// ========================================================================
const leafletMap = {
    async convertAndSave(fileInput, varName, outFile) {
        if (!dirHandle) { alert('Load a directory first.'); return; }
        const file = fileInput.files[0];
        if (!file) { alert('Select a GeoJSON file.'); return; }
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            if (!json.type || !['FeatureCollection', 'Feature', 'GeometryCollection'].includes(json.type)) {
                alert('Not a valid GeoJSON file.'); return;
            }
            const js = 'window.' + (varName || 'WorldGeoJSON') + ' = ' + JSON.stringify(json) + ';';
            await writeNewFile(outFile || 'world-geojson.js', js);
            return true;
        } catch (e) { alert('Error: ' + e.message); return false; }
    },
    getSnippet(varName) {
        return `<!-- Leaflet CSS -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script src="${varName || 'world-geojson'}.js"><\/script>

<div id="map" style="width:100%;height:500px"></div>
<script>
const map = L.map('map').setView([20, 0], 2);
L.geoJSON(window.${varName || 'WorldGeoJSON'}, {
    style: { color: '#3794ff', weight: 1, fillOpacity: 0.15 },
    onEachFeature: (feature, layer) => {
        if (feature.properties && feature.properties.name) {
            layer.bindTooltip(feature.properties.name);
        }
    }
}).addTo(map);
<\/script>`;
    }
};

// ========================================================================
// TOOL MODAL RENDERER
// ========================================================================
function openTool(name) {
    const modal = document.getElementById('tool-modal');
    const content = document.getElementById('tool-modal-content');
    const closeBtn = '<div style="margin-top:16px;text-align:right"><button class="btn" onclick="closeModal(\'tool-modal\')">Close</button></div>';

    const tools = {
        'llm-context': () => {
            content.innerHTML = '<h3>LLM Context Generator</h3><p>Generates a concatenated view of your project files for pasting into AI chatbots.</p><p style="color:var(--text-dim);font-size:11px">Excludes: devconsole.js, testRecorder.js, compiled-hashes.csv</p><button class="btn btn-primary" onclick="doGenerateLLMContext()">Generate & Copy Context</button><div id="llm-output" style="margin-top:12px"></div>' + closeBtn;
        },
        'dev-console': () => {
            const exists = devConsole.checkStatus();
            content.innerHTML = '<h3>Dev Console</h3><p>Inject a floating debug console into your project. Captures console.log, console.error, and window.onerror.</p><p>Status: ' + (exists ? '<span style="color:var(--success)">devconsole.js found</span>' : '<span style="color:var(--text-dim)">Not integrated</span>') + '</p><button class="btn btn-primary" onclick="doIntegrateDevConsole()">' + (exists ? 'Update' : 'Add') + ' devconsole.js</button><div id="devconsole-status" style="margin-top:8px"></div><p style="margin-top:12px;font-size:12px;color:var(--text-dim)">After adding, include <code>&lt;script src="devconsole.js"&gt;&lt;/script&gt;</code> before &lt;/body&gt;</p>' + closeBtn;
        },
        'sharedrive': () => {
            const exists = sharedriveNosql.checkStatus();
            content.innerHTML = '<h3>ShareDrive-NoSQL</h3><p>File-based JSON database using File System Access API. Read/write JSON to shared folders for multi-user data access.</p><p>Status: ' + (exists ? '<span style="color:var(--success)">sharedrive-nosql.js found</span>' : '<span style="color:var(--text-dim)">Not integrated</span>') + '</p><button class="btn btn-primary" onclick="doIntegrateShareDrive()">' + (exists ? 'Update' : 'Add') + ' sharedrive-nosql.js</button><div id="sharedrive-status" style="margin-top:8px"></div><div style="margin-top:12px;font-size:12px;color:var(--text-dim)"><strong>Quickstart:</strong><pre style="background:var(--bg-input);padding:8px;border-radius:4px;margin-top:4px;font-size:11px">const db = ShareDriveDB;\nawait db.open();  // user picks folder\nawait db.write("users", [{name:"Alice"}]);\nconst users = await db.read("users");\nawait db.append("users", {name:"Bob"});</pre></div>' + closeBtn;
        },
        'leaflet': () => {
            content.innerHTML = '<h3>Leaflet Map Tool</h3><p>Convert GeoJSON to an offline-friendly JavaScript variable and generate Leaflet integration code.</p><label>GeoJSON File</label><input type="file" accept=".json,.geojson" id="leaflet-file-input"><label>Variable Name</label><input type="text" class="search-input" id="leaflet-var-name" value="WorldGeoJSON" style="margin-bottom:6px"><label>Output Filename</label><input type="text" class="search-input" id="leaflet-out-file" value="world-geojson.js" style="margin-bottom:8px"><button class="btn btn-primary" onclick="doLeafletConvert()">Convert & Save</button><div id="leaflet-status" style="margin-top:8px"></div><div style="margin-top:12px"><h4 style="font-size:13px;color:#dce8ff">Integration Snippet</h4><pre id="leaflet-snippet" style="background:var(--bg-input);padding:8px;border-radius:4px;font-size:11px;overflow-x:auto">' + escHtml(leafletMap.getSnippet('WorldGeoJSON')) + '</pre></div>' + closeBtn;
        },
        'sast': () => {
            content.innerHTML = '<h3>SAST Scanner</h3><p>Scan project files for common security vulnerabilities.</p><button class="btn btn-primary" onclick="doRunSAST()">Run Scan</button><div id="sast-results" style="margin-top:12px"></div>' + closeBtn;
        },
        'security': () => {
            content.innerHTML = '<h3>Security Reviewer</h3><p>STIG compliance assessment, security report generation, and SBOM export.</p><div style="display:flex;gap:8px;margin:12px 0"><button class="btn btn-primary" onclick="doSecurityReview()">Generate Report</button><button class="btn" onclick="doExportSBOM()">Export SBOM (JSON)</button></div><div style="margin:8px 0"><button class="btn btn-sm" onclick="doGenerateSTIGPrompt()">Copy STIG Audit Prompt</button></div><div id="security-results" style="margin-top:12px"></div>' + closeBtn;
        },
        'test-recorder': () => {
            const exists = testRecorder.checkStatus();
            content.innerHTML = '<h3>Test Recorder</h3><p>Record user interactions (clicks, inputs) and export as JSON test scenarios. Use Ctrl+Alt+R to toggle recording.</p><p>Status: ' + (exists ? '<span style="color:var(--success)">testRecorder.js found</span>' : '<span style="color:var(--text-dim)">Not integrated</span>') + '</p><button class="btn btn-primary" onclick="doIntegrateTestRecorder()">' + (exists ? 'Update' : 'Add') + ' testRecorder.js</button><div id="test-recorder-status" style="margin-top:8px"></div><div style="margin-top:12px;font-size:12px;color:var(--text-dim)"><strong>Scenario Format:</strong><pre style="background:var(--bg-input);padding:8px;border-radius:4px;margin-top:4px;font-size:11px">{\n  "name": "my-test",\n  "steps": [\n    {"type":"click","selector":"#btn","delayMs":0},\n    {"type":"input","selector":"#name","value":"Alice","delayMs":320}\n  ]\n}</pre></div>' + closeBtn;
        },
        'math-tester': () => {
            const allFiles = Object.keys(fileHandles).filter(p => /\.(js|mjs|json|html|css|txt|md)$/i.test(p));
            let checkboxes = allFiles.map(p => '<label style="display:block;font-size:12px;padding:2px 0"><input type="checkbox" class="math-file-cb" value="' + escHtml(p) + '" checked> ' + escHtml(p) + '</label>').join('');
            content.innerHTML = '<h3>Math & Logic Tester</h3><p>Generate a comprehensive audit prompt for mathematical and logical correctness.</p><div style="margin:8px 0"><button class="btn btn-sm" onclick="document.querySelectorAll(\'.math-file-cb\').forEach(c=>c.checked=true)">Select All</button> <button class="btn btn-sm" onclick="document.querySelectorAll(\'.math-file-cb\').forEach(c=>c.checked=false)">Deselect All</button></div><div style="max-height:200px;overflow-y:auto;border:1px solid var(--border-subtle);border-radius:6px;padding:6px;margin-bottom:8px">' + (checkboxes || '<p style="color:var(--text-dim)">Load a directory first.</p>') + '</div><button class="btn btn-primary" onclick="doMathTest()">Generate & Copy Prompt</button><div id="math-result" style="margin-top:8px"></div>' + closeBtn;
        },
        'compiler': () => {
            content.innerHTML = '<h3>HTML Compiler</h3><p>Bundle your multi-file project into a single standalone HTML file with security headers and manifest.</p><label>Output Filename</label><input type="text" class="search-input" id="compile-filename" placeholder="' + escHtml(dirHandle?.name || 'compiled-app') + '" style="margin-bottom:8px"><div style="margin:12px 0"><label><input type="checkbox" id="opt-minify"> Minify output</label><br><label><input type="checkbox" id="opt-inline-cdn" checked> Inline CDN resources</label><br><label><input type="checkbox" id="opt-security" checked> Add security headers (CSP, X-Content-Type-Options)</label><br><label><input type="checkbox" id="opt-devconsole"> Include devconsole.js</label><br><label><input type="checkbox" id="opt-testrecorder"> Include testRecorder.js</label></div><button class="btn btn-primary" onclick="compiler.startCompilation()">Compile Project</button><div id="compiler-status" style="margin-top:12px"></div>' + closeBtn;
        },
        'decompiler': () => {
            content.innerHTML = '<h3>Decompiler</h3><p>Extract original source files from a compiled Forge HTML file using the embedded manifest.</p><label>Compiled HTML File</label><input type="file" accept=".html,.htm" id="decompile-input" style="margin-bottom:8px"><div style="display:flex;gap:8px"><button class="btn btn-primary" onclick="doDecompileAnalyze()">Analyze</button><button class="btn" id="decompile-write-btn" disabled onclick="doDecompileWrite()">Write Files to Folder</button></div><div id="decompile-results" style="margin-top:12px"></div>' + closeBtn;
        },
    };

    if (tools[name]) {
        tools[name]();
        modal.classList.add('show');
    }
}

// ========================================================================
// TOOL ACTION HANDLERS
// ========================================================================
let lastDecompileOutput = null;

async function doGenerateLLMContext() {
    const output = await llmFormatter.generateContext();
    const chars = output.length;
    const tokens = llmFormatter.estimateTokenCount(output);
    const size = llmFormatter.formatFileSize(chars);
    navigator.clipboard.writeText(output).then(() => {
        document.getElementById('llm-output').innerHTML = '<p style="color:var(--success)">Copied to clipboard!</p><p style="font-size:12px;color:var(--text-dim)">' + chars.toLocaleString() + ' chars | ' + size + ' | ~' + tokens.toLocaleString() + ' tokens | ' + Object.keys(fileHandles).length + ' files</p>';
    });
}

async function doIntegrateDevConsole() {
    const ok = await devConsole.integrate();
    document.getElementById('devconsole-status').innerHTML = ok ? '<span style="color:var(--success)">devconsole.js created/updated.</span>' : '<span style="color:var(--error)">Failed.</span>';
}

async function doIntegrateTestRecorder() {
    const ok = await testRecorder.integrate();
    document.getElementById('test-recorder-status').innerHTML = ok ? '<span style="color:var(--success)">testRecorder.js created/updated.</span>' : '<span style="color:var(--error)">Failed.</span>';
}

async function doIntegrateShareDrive() {
    const ok = await sharedriveNosql.integrate();
    document.getElementById('sharedrive-status').innerHTML = ok ? '<span style="color:var(--success)">sharedrive-nosql.js created/updated.</span>' : '<span style="color:var(--error)">Failed.</span>';
}

async function doLeafletConvert() {
    const input = document.getElementById('leaflet-file-input');
    const varField = document.getElementById('leaflet-var-name');
    const outField = document.getElementById('leaflet-out-file');
    const varName = sanitizeJsIdentifier(varField?.value, 'WorldGeoJSON');
    const outFile = sanitizeOutputFilename(outField?.value, 'world-geojson', '.js');
    if (varField) varField.value = varName;
    if (outField) outField.value = outFile;
    const ok = await leafletMap.convertAndSave(input, varName, outFile);
    document.getElementById('leaflet-status').innerHTML = ok ? '<span style="color:var(--success)">Saved ' + escHtml(outFile) + '!</span>' : '';
    document.getElementById('leaflet-snippet').textContent = leafletMap.getSnippet(varName);
}

async function doRunSAST() {
    const results = document.getElementById('sast-results');
    results.innerHTML = '<p style="color:var(--accent)">Scanning...</p>';
    const issues = await sastScanner.runScan();
    if (!issues.length) { results.innerHTML = '<p style="color:var(--success)">No issues found!</p>'; return; }
    let html = '<div class="sast-chart-container"><canvas id="sast-chart" width="180" height="180"></canvas><div class="sast-legend" id="sast-legend"></div></div>';
    html += '<div style="margin:8px 0"><strong>' + issues.length + ' finding(s)</strong></div>';
    issues.forEach((iss, i) => {
        html += '<div class="sast-finding"><span class="severity severity-' + iss.severity.toLowerCase() + '">[' + iss.severity + ']</span> <strong>' + escHtml(iss.name) + '</strong> in <span style="color:#8ab4ff">' + escHtml(iss.path) + ':' + iss.line + '</span><br><code>' + escHtml(iss.code) + '</code><br><small style="color:var(--text-dim)">' + escHtml(iss.desc) + '</small></div>';
    });
    html += '<div style="margin-top:12px"><button class="btn btn-sm" onclick="doSASTFixPrompt()">Copy Fix Prompt for AI</button></div><div id="sast-fix-status" style="margin-top:4px"></div>';
    results.innerHTML = html;
    setTimeout(() => {
        const canvas = document.getElementById('sast-chart');
        const legendData = sastScanner.renderChart(canvas, issues);
        const legend = document.getElementById('sast-legend');
        if (legend && legendData) {
            legend.innerHTML = legendData.map(d => '<div class="sast-legend-item"><div class="sast-legend-swatch" style="background:' + d.color + '"></div>' + escHtml(d.label) + ' (' + d.count + ')</div>').join('');
        }
    }, 50);
    window._lastSASTIssues = issues;
}

function doSASTFixPrompt() {
    const prompt = sastScanner.generateFixPrompt(window._lastSASTIssues || []);
    navigator.clipboard.writeText(prompt).then(() => {
        document.getElementById('sast-fix-status').innerHTML = '<span style="color:var(--success)">Fix prompt copied!</span>';
    });
}

async function doSecurityReview() {
    const results = document.getElementById('security-results');
    results.innerHTML = '<p style="color:var(--accent)">Generating report...</p>';
    const issues = await sastScanner.runScan();
    const sbom = await securityReviewer.generateSBOM();
    const report = await securityReviewer.generateSecurityReport(issues, sbom);
    results.innerHTML = report;
}

async function doExportSBOM() {
    const sbom = await securityReviewer.generateSBOM();
    securityReviewer.exportSBOMJson(sbom);
}

function doGenerateSTIGPrompt() {
    navigator.clipboard.writeText(securityReviewer.generateSTIGPrompt()).then(() => {
        alert('STIG audit prompt copied to clipboard. Paste into an AI chatbot along with your code.');
    });
}

async function doMathTest() {
    const selected = Array.from(document.querySelectorAll('.math-file-cb:checked')).map(c => c.value);
    if (!selected.length) { alert('Select at least one file.'); return; }
    const prompt = await mathTester.generatePrompt(selected);
    navigator.clipboard.writeText(prompt).then(() => {
        document.getElementById('math-result').innerHTML = '<p style="color:var(--success)">Audit prompt copied! (' + selected.length + ' files, ~' + Math.round(prompt.length / 4) + ' tokens)</p>';
    });
}

async function doDecompileAnalyze() {
    const input = document.getElementById('decompile-input');
    const file = input?.files?.[0];
    if (!file) { alert('Choose a compiled HTML file.'); return; }
    const text = await file.text();
    try {
        lastDecompileOutput = await decompiler.decompile(text);
        const results = document.getElementById('decompile-results');
        results.innerHTML = '<p><strong>Project:</strong> ' + escHtml(lastDecompileOutput.manifest.project || 'Unknown') + '</p>';
        results.innerHTML += '<p><strong>Files recovered:</strong></p><ul>' + lastDecompileOutput.files.map(f => '<li><code>' + escHtml(f.kind) + '</code> - <code>' + escHtml(f.path) + '</code>' + (f.external ? ' (external)' : '') + (f.missing ? ' <span style="color:var(--error)">(missing)</span>' : '') + '</li>').join('') + '</ul>';
        document.getElementById('decompile-write-btn').disabled = false;
    } catch (e) {
        document.getElementById('decompile-results').innerHTML = '<p style="color:var(--error)">Error: ' + escHtml(e.message) + '</p>';
    }
}

async function doDecompileWrite() {
    if (!lastDecompileOutput) return;
    try {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        await decompiler.writeOutputToDirectory(lastDecompileOutput, dir);
        alert('Files written successfully!');
    } catch (e) {
        alert('Failed: ' + e.message);
    }
}

// ========================================================================
// PLAN PANEL — Prompt Step Modal
// ========================================================================
function openPromptStep(n) {
    const descs = {
        1: 'Generate a prompt to make the AI interview YOU to uncover real requirements (Jobs to be Done).',
        2: 'Paste a JTBD interview summary. Output: 3-5 Jobs + 5 tool ideas per job.',
        3: 'Paste ONE job + tool idea. Output: 5 MVPs of increasing complexity.',
        4: 'Paste refined solution concept. Output: 3 technical approaches with pros & cons.',
        5: 'Paste final app description. Output: Build-ready prompt.',
        6: 'Add JSON save/load buttons for data persistence via file download/upload.',
        7: 'Add CSV/Excel file upload and data import capability.',
        8: 'Add export to Word, PowerPoint, or PDF documents.',
        9: 'Add OCR to extract text from uploaded images using Tesseract.js.',
        10: 'Add LLM-powered data analysis pipeline.',
        11: 'Add SharePoint list integration for data persistence.',
        18: 'Add simple polling-based live updates after SharePoint list integration already exists.'
    };
    const content = '<h3>Step ' + n + '</h3><p>' + descs[n] + '</p><label>Your context:</label><textarea class="search-input" rows="4" id="prompt-ctx" placeholder="Describe your specific needs..."></textarea><button class="btn btn-primary" style="margin-top:8px" onclick="generatePrompt(' + n + ')">Generate & Copy Prompt</button><div id="prompt-output" style="margin-top:12px;font-family:var(--font-code);font-size:12px;white-space:pre-wrap;background:var(--bg-editor);padding:12px;border-radius:6px;max-height:300px;overflow:auto"></div>';
    document.getElementById('tool-modal-content').innerHTML = content + '<div style="margin-top:16px;text-align:right"><button class="btn" onclick="closeModal(\'tool-modal\')">Close</button></div>';
    document.getElementById('tool-modal').classList.add('show');
}

function generatePrompt(n) {
    const ctx = document.getElementById('prompt-ctx').value || '(no additional context)';
    const prompt = aiHelper.generate(n, ctx);
    navigator.clipboard.writeText(prompt);
    document.getElementById('prompt-output').textContent = 'Copied to clipboard!\n\n' + prompt;
}
