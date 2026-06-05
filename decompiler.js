const decompiler = {
    // Decode manifest header from compiled HTML text
    parseManifest(compiledText) {
        const m = compiledText.match(/<!--WFC-MANIFEST:([^>]*)-->/);
        if (!m) return null;
        try {
            const b64 = m[1].trim();
            const json = decodeURIComponent(escape(atob(b64)));
            const manifest = JSON.parse(json);
            return manifest;
        } catch (e) {
            try {
                // Fallback if escape/encodeURIComponent isn't available for whatever reason
                const manifest = JSON.parse(atob(m[1].trim()));
                return manifest;
            } catch (e2) {
                console.error('Failed to parse WFC manifest:', e2);
                return null;
            }
        }
    },

    // Same hash as compiler for reliably matching blocks
    _hashString(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) ^ str.charCodeAt(i);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    },

    // Normalize inline content to match compiler hashing
    _normalizeInline(text) {
        if (text == null) return '';
        let t = text;
        // Compiler wraps content with a leading and trailing single \n
        if (t.startsWith('\n')) t = t.slice(1);
        if (t.endsWith('\n')) t = t.slice(0, -1);
        return t;
    },

    _decodeUtf8B64(b64) {
        const raw = atob(String(b64 || ''));
        try {
            return decodeURIComponent(escape(raw));
        } catch {
            return raw;
        }
    },

    _extractWasmAssets(compiledText) {
        const sources = [String(compiledText || '')];
        const childMatch = sources[0].match(/\bconst\s+CHILD_HTML_B64\s*=\s*(["'])([\s\S]*?)\1\s*;/);
        if (childMatch) {
            try {
                sources.push(this._decodeUtf8B64(childMatch[2]));
            } catch (error) {
                console.warn('Could not decode child HTML while extracting WASM assets:', error);
            }
        }

        const assetsByPath = new Map();
        for (const source of sources) {
            const re = /\bWASM_ASSETS_JSON_B64\s*=\s*(["'])([^"']+)\1/g;
            let match;
            while ((match = re.exec(source)) !== null) {
                try {
                    const assets = JSON.parse(this._decodeUtf8B64(match[2]));
                    if (!Array.isArray(assets)) continue;
                    for (const asset of assets) {
                        if (!asset || !asset.b64) continue;
                        const path = String(asset.path || asset.name || '').trim();
                        const name = String(asset.name || '').trim();
                        if (path) assetsByPath.set(path, asset);
                        if (name && !assetsByPath.has(name)) assetsByPath.set(name, asset);
                    }
                } catch (error) {
                    console.warn('Could not parse embedded WASM assets:', error);
                }
            }
        }
        return assetsByPath;
    },

    // Strip security headers and scripts added by the compiler
    _stripSecurityFeatures(html) {
        let cleaned = html;

        // Remove all security-related meta tags (CSP, X-Content-Type-Options, etc.)
        cleaned = cleaned.replace(/\s*<!--\s*Security:.*?-->\s*/gi, '');
        cleaned = cleaned.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/gi, '');
        cleaned = cleaned.replace(/\s*<meta\s+http-equiv="X-Content-Type-Options"[^>]*>\s*/gi, '');
        cleaned = cleaned.replace(/\s*<meta\s+http-equiv="X-XSS-Protection"[^>]*>\s*/gi, '');
        cleaned = cleaned.replace(/\s*<meta\s+http-equiv="Referrer-Policy"[^>]*>\s*/gi, '');
        cleaned = cleaned.replace(/\s*<meta\s+http-equiv="Permissions-Policy"[^>]*>\s*/gi, '');

        // Remove DOMPurify library script
        cleaned = cleaned.replace(/\s*<!--\s*DOMPurify Library\s*-->\s*/gi, '');
        cleaned = cleaned.replace(/<script[^>]*>\s*\/\*![\s\S]*?DOMPurify[\s\S]*?<\/script>\s*/gi, '');

        // Remove Trusted Types policy comment and script
        cleaned = cleaned.replace(/\s*<!--\s*Trusted Types Policy\s*-->\s*/gi, '');
        cleaned = cleaned.replace(/<script[^>]*>\s*if\s*\(\s*window\.trustedTypes\s*&&\s*trustedTypes\.createPolicy\s*\)\s*\{[\s\S]*?<\/script>\s*/gi, '');

        // Remove inline handler interceptor script
        cleaned = cleaned.replace(/<script[^>]*>\s*\(function\(\)\s*\{\s*['"]use strict['"];\s*const EVENT_HANDLERS\s*=[\s\S]*?<\/script>\s*/gi, '');

        // Remove Forge WASM asset runtime from reconstructed index.html.
        cleaned = cleaned.replace(/\s*<script[^>]*>[\s\S]*?\bWASM_ASSETS_JSON_B64\b[\s\S]*?<\/script>\s*/gi, '');

        // Remove inline style interceptor comment and script
        // This needs to handle HTML comments before the script tag and whitespace
        cleaned = cleaned.replace(/\s*<!--\s*Inline Style Attribute Monitor.*?-->\s*/gi, '');
        cleaned = cleaned.replace(/<script[^>]*>\s*\(function\(\)\s*\{\s*['"]use strict['"];\s*(\/\/\s*Get reference to Trusted Types policy|let wfcPolicy)[\s\S]*?<\/script>\s*/gi, '');

        // Remove any extra blank lines created by removal
        cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');

        return cleaned;
    },

    // Returns { manifest, files: [{path, content, kind, external}], indexHtml }
    async decompile(compiledText) {
        const manifest = this.parseManifest(compiledText);
        if (!manifest) throw new Error('No WFC manifest found in file header.');

        // Remove the manifest header from the source before parsing/rewriting
        const sourceNoManifest = compiledText.replace(/<!--WFC-MANIFEST:[\s\S]*?-->/, '');
        const wasmAssetsByPath = this._extractWasmAssets(sourceNoManifest);

        // Build maps of inline script/style blocks from the original compiled HTML
        // (do this BEFORE removing compiler-inserted security scripts so we can still
        //  locate the original application code by hash)
        const scriptBlocks = [];
        try {
            const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
            let m;
            while ((m = scriptTagRegex.exec(sourceNoManifest)) !== null) {
                const attrs = m[1] || '';
                const body = m[2] || '';
                // Skip external scripts
                if (/\bsrc\s*=\s*/i.test(attrs)) continue;
                scriptBlocks.push(body);
            }
        } catch (e) {
            console.warn('Error collecting inline script blocks for mapping:', e);
        }

        const styleBlocks = [];
        try {
            const styleTagRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
            let sm;
            while ((sm = styleTagRegex.exec(sourceNoManifest)) !== null) {
                styleBlocks.push(sm[1] || '');
            }
        } catch (e) {
            console.warn('Error collecting inline style blocks for mapping:', e);
        }

        // Strip out security headers and scripts added by compiler for the reconstructed index.html
        let source = this._stripSecurityFeatures(sourceNoManifest);

        // Parse DOM of compiled HTML (cleaned for output)
        const parser = new DOMParser();
        const doc = parser.parseFromString(source, 'text/html');

        const restoreMigratedHandlers = () => {
            const migrations = manifest.security?.migratedHandlers;
            if (!Array.isArray(migrations) || migrations.length === 0) return;

            const handlerMap = new Map();
            for (const entry of migrations) {
                if (!entry || !entry.event || !entry.id) continue;
                const key = `${entry.event}:${entry.id}`;
                handlerMap.set(key, entry.code ?? '');
            }

            const elements = doc.getElementsByTagName('*');
            for (const el of elements) {
                if (!el || !el.attributes) continue;
                const toRemove = [];
                for (const attr of Array.from(el.attributes)) {
                    const name = attr?.name || '';
                    if (!name.startsWith('data-wfc-handler-')) continue;
                    const eventName = name.replace('data-wfc-handler-', '').trim();
                    const id = attr.value || '';
                    const key = `${eventName}:${id}`;
                    if (handlerMap.has(key)) {
                        const code = handlerMap.get(key);
                        el.setAttribute(`on${eventName}`, code);
                    }
                    toRemove.push(name);
                }
                toRemove.forEach(attrName => el.removeAttribute(attrName));
            }

            doc.querySelectorAll('script[data-wfc-handler-bootstrap="true"]').forEach(el => el.remove());
        };

        restoreMigratedHandlers();

        // Collect inline <script> and <style> blocks by hash using the original compiled HTML
        // This ensures we can find application code even if the compiler injected additional
        // security-related scripts that would otherwise be stripped.
        const scriptMap = new Map();
        for (const raw of scriptBlocks) {
            const normalized = this._normalizeInline(raw);
            const variants = [normalized, normalized.replace(/\r\n/g, '\n')];
            for (const v of variants) {
                const h = this._hashString(v);
                if (!scriptMap.has(h)) scriptMap.set(h, []);
                scriptMap.get(h).push({ text: v });
            }
        }

        const styleMap = new Map();
        for (const raw of styleBlocks) {
            const normalized = this._normalizeInline(raw);
            const variants = [normalized, normalized.replace(/\r\n/g, '\n')];
            for (const v of variants) {
                const h = this._hashString(v);
                if (!styleMap.has(h)) styleMap.set(h, []);
                styleMap.get(h).push({ text: v });
            }
        }

        // Extract files by matching hash
        const outFiles = [];
        for (const entry of manifest.files || []) {
            if (entry.external) {
                outFiles.push({ path: entry.path, content: null, kind: entry.kind, external: true });
                continue;
            }
            if (entry.kind === 'wasm') {
                const asset = wasmAssetsByPath.get(entry.path) || wasmAssetsByPath.get(String(entry.path || '').split('/').pop());
                if (asset && asset.b64) {
                    outFiles.push({ path: entry.path, content: asset.b64, contentEncoding: 'base64', kind: entry.kind, external: false });
                } else {
                    console.warn('Could not locate embedded WASM asset for', entry);
                    outFiles.push({ path: entry.path, content: '', kind: entry.kind, external: false, missing: true });
                }
                continue;
            }
            const map = entry.kind === 'js' ? scriptMap : styleMap;
            const list = map.get(entry.hash) || [];
            const item = list.shift();
            if (!item) {
                console.warn('Could not locate inline block for', entry);
                outFiles.push({ path: entry.path, content: '', kind: entry.kind, external: false, missing: true });
                continue;
            }
            const content = item.text || '';
            outFiles.push({ path: entry.path, content, kind: entry.kind, external: false });
        }

        // Reconstruct index.html by swapping inline blocks for external refs
        const cloned = doc.cloneNode(true);
        for (const entry of manifest.files || []) {
            if (entry.kind === 'js') {
                const matches = Array.from(cloned.querySelectorAll('script:not([src])'));
                const el = matches.find(s => {
                    const raw = s.textContent || '';
                    const v1 = this._normalizeInline(raw);
                    const v2 = v1.replace(/\r\n/g, '\n');
                    const h1 = this._hashString(v1);
                    const h2 = this._hashString(v2);
                    return h1 === entry.hash || h2 === entry.hash;
                });
                if (!el) continue;
                const repl = cloned.createElement('script');
                repl.setAttribute('src', entry.path);
                el.replaceWith(repl);
            } else if (entry.kind === 'css') {
                const matches = Array.from(cloned.querySelectorAll('style'));
                const el = matches.find(s => {
                    const raw = s.textContent || '';
                    const v1 = this._normalizeInline(raw);
                    const v2 = v1.replace(/\r\n/g, '\n');
                    const h1 = this._hashString(v1);
                    const h2 = this._hashString(v2);
                    return h1 === entry.hash || h2 === entry.hash;
                });
                if (!el) continue;
                const link = cloned.createElement('link');
                link.setAttribute('rel', 'stylesheet');
                link.setAttribute('href', entry.path);
                el.replaceWith(link);
            }
        }

        // Serialize using HTML outerHTML to avoid escaping JS/CSS content
        const dt = doc.doctype;
        const doctype = dt ? `<!DOCTYPE ${dt.name}>\n` : '<!DOCTYPE html>\n';
        const htmlOut = cloned.documentElement ? cloned.documentElement.outerHTML : source;
        const indexHtml = doctype + htmlOut;

        return { manifest, files: outFiles, indexHtml };
    },

    // Write files to a chosen directory using File System Access API
    async writeOutputToDirectory(output, dirHandle) {
        // Ensure nested directories exist and write files
        const ensureDir = async (parts) => {
            let dir = dirHandle;
            for (const part of parts) {
                dir = await dir.getDirectoryHandle(part, { create: true });
            }
            return dir;
        };
        // Helper: sanitize path segments and filenames for filesystem APIs
        const sanitizeName = (raw) => {
            if (!raw || typeof raw !== 'string') return '_';
            // Normalize separators
            let name = raw.replace(/\\/g, '/');
            // Remove any leading/trailing whitespace
            name = name.trim();
            // Collapse consecutive slashes
            name = name.replace(/\/+/g, '/');
            // For a single segment ensure we don't contain path separators
            name = name.replace(/\//g, '_');
            // Replace illegal Windows filename characters
            name = name.replace(/[<>:\\"|?*]/g, '_');
            // Remove control characters
            name = name.replace(/[\x00-\x1f\x80-\x9f]/g, '_');
            // Avoid reserved names (CON, PRN, AUX, NUL, COM1..COM9, LPT1..LPT9)
            const base = name.split('.')[0].toUpperCase();
            const reserved = new Set(['CON','PRN','AUX','NUL']);
            for (let i = 1; i <= 9; i++) { reserved.add('COM' + i); reserved.add('LPT' + i); }
            if (reserved.has(base)) name = '_' + name;
            // Prevent '.' or '..' segments
            if (name === '.' || name === '..' || name.length === 0) name = '_';
            // Trim long names (safe side)
            if (name.length > 240) name = name.slice(0, 240);
            return name;
        };

        for (const f of output.files) {
            if (f.external) continue; // skip external URLs
            // Normalize and sanitize path
            const rawPath = (f.path || '').replace(/^\/+/, '');
            const partsRaw = rawPath.split('/');
            const parts = partsRaw.slice(0, -1).map(p => sanitizeName(p)).filter(Boolean);
            let nameRaw = partsRaw.slice(-1)[0] || '_';
            const name = sanitizeName(nameRaw);
            const dir = await ensureDir(parts.filter(Boolean));
            // Ensure unshipped banner for HTML files
            let fileContent = f.content || '';
            if (/\.html?$/i.test(name) && typeof editor !== 'undefined' && editor.ensureUnshippedBanner) {
                fileContent = editor.ensureUnshippedBanner(fileContent);
            }
            if (f.contentEncoding === 'base64') {
                const raw = atob(String(f.content || ''));
                const bytes = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
                fileContent = bytes;
            }
            try {
                const fh = await dir.getFileHandle(name, { create: true });
                const w = await fh.createWritable();
                await w.write(fileContent);
                await w.close();
            } catch (err) {
                console.error('Failed to write file', f.path, '->', err);
                // Try a fallback filename
                const fallback = '_' + this._hashString(f.path || name);
                const fh = await dir.getFileHandle(fallback, { create: true });
                const w = await fh.createWritable();
                await w.write(fileContent);
                await w.close();
            }
        }
        // Write index.html last
        // Write index.html last (sanitize path/name similarly)
        const idxRaw = output.manifest.index || 'index.html';
        const idxPartsRaw = idxRaw.replace(/^\/+/, '').split('/');
        const idxName = sanitizeName(idxPartsRaw.pop());
        const idxDirParts = idxPartsRaw.map(p => sanitizeName(p)).filter(Boolean);
        const idxDir = await ensureDir(idxDirParts);
        const idxHandle = await idxDir.getFileHandle(idxName, { create: true });
        // Ensure unshipped banner for the index HTML
        let idxContent = output.indexHtml;
        if (/\.html?$/i.test(idxName) && typeof editor !== 'undefined' && editor.ensureUnshippedBanner) {
            idxContent = editor.ensureUnshippedBanner(idxContent);
        }
        const idxWritable = await idxHandle.createWritable();
        await idxWritable.write(idxContent);
        await idxWritable.close();
    }
};

// UI wiring for the Decompiler tab
(function(){
    document.addEventListener('DOMContentLoaded', () => {
        const fileInput = document.getElementById('decompile-file');
        const analyzeBtn = document.getElementById('decompile-analyze');
        const writeBtn = document.getElementById('decompile-write');
        const results = document.getElementById('decompile-results');
        if (!fileInput || !analyzeBtn || !writeBtn || !results) return;

        let lastOutput = null;

        const renderResults = (out) => {
            // Clear existing
            results.replaceChildren();
            // Project/Index line
            const meta = document.createElement('div');
            meta.className = 'mb-2';
            const strong1 = document.createElement('strong');
            strong1.textContent = 'Project:';
            const strong2 = document.createElement('strong');
            strong2.textContent = 'Index:';
            const projectText = document.createTextNode(' ' + (out.manifest.project || '(unknown)') + ' | ');
            const indexText = document.createTextNode(' ' + out.manifest.index);
            meta.appendChild(strong1);
            meta.appendChild(projectText);
            meta.appendChild(strong2);
            meta.appendChild(indexText);
            results.appendChild(meta);

            const title = document.createElement('div');
            title.appendChild(document.createElement('strong')).textContent = 'Recovered files:';
            results.appendChild(title);

            const ul = document.createElement('ul');
            for (const f of out.files) {
                const li = document.createElement('li');
                const codeKind = document.createElement('code');
                codeKind.textContent = f.kind;
                const sep = document.createTextNode(' - ');
                const codePath = document.createElement('code');
                codePath.textContent = f.path;
                li.appendChild(codeKind);
                li.appendChild(sep);
                li.appendChild(codePath);
                if (f.external) li.appendChild(document.createTextNode(' (external link)'));
                ul.appendChild(li);
            }
            results.appendChild(ul);
        };

        analyzeBtn.addEventListener('click', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) { alert('Choose a compiled HTML file first.'); return; }
            const text = await file.text();
            try {
                const out = await decompiler.decompile(text);
                lastOutput = out;
                renderResults(out);
                writeBtn.disabled = false;
            } catch (e) {
                console.error(e);
                alert('Failed to analyze file: ' + e.message);
            }
        });

        writeBtn.addEventListener('click', async () => {
            if (!lastOutput) { alert('Analyze a file first.'); return; }
            try {
                const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
                const perm = await dir.requestPermission({ mode: 'readwrite' });
                if (perm !== 'granted') throw new Error('Permission denied');
                await decompiler.writeOutputToDirectory(lastOutput, dir);
                alert('Files written successfully.');
            } catch (e) {
                console.error(e);
                alert('Failed to write files: ' + e.message);
            }
        });
    });
})();
