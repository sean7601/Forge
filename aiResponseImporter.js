(function (root) {
    const state = {
        modalEl: null,
        analysis: null,
        inputSignature: '',
        tabsClosedForModalCycle: false,
        pendingTabRestore: null,
        lastApplied: null,
        functionSyntaxCheckBlockedByCsp: false,
        functionSyntaxCheckWarningShown: false,
        lastDiffDebugPackage: null,
        diffDebugSeq: 0
    };

    function isDebugEnabled() {
        if (typeof root.wctAiResponseImportDebug === 'boolean') {
            return !!root.wctAiResponseImportDebug;
        }
        try {
            const stored = localStorage.getItem('wct:aiResponseImportDebug');
            if (stored === '0' || stored === 'false') return false;
            if (stored === '1' || stored === 'true') return true;
        } catch (_) {
            // no-op
        }
        return true;
    }

    function debugLog(...args) {
        if (!isDebugEnabled()) return;
        try {
            console.log('[Forge AI Import]', ...args);
        } catch (_) {
            // no-op
        }
    }

    function debugWarn(...args) {
        if (!isDebugEnabled()) return;
        try {
            console.warn('[Forge AI Import]', ...args);
        } catch (_) {
            // no-op
        }
    }

    function isLoadFolderApiCandidate(value) {
        return !!(
            value &&
            typeof value === 'object' &&
            Array.isArray(value.fileStructure) &&
            typeof value.createNewFile === 'function' &&
            typeof value.refreshFileTree === 'function'
        );
    }

    function isEditorApiCandidate(value) {
        return !!(
            value &&
            typeof value === 'object' &&
            typeof value.openFile === 'function' &&
            typeof value.deleteTab === 'function'
        );
    }

    function getLoadFolderApi() {
        if (isLoadFolderApiCandidate(root.loadFolder)) return root.loadFolder;
        try {
            if (typeof loadFolder !== 'undefined' && isLoadFolderApiCandidate(loadFolder)) return loadFolder;
        } catch (_) {
            // no-op
        }
        return null;
    }

    function getEditorApi() {
        // Important: window.editor may resolve to <div id="editor"> via named-element access.
        // Accept only the actual editor API object shape.
        if (isEditorApiCandidate(root.editor)) return root.editor;
        try {
            if (typeof editor !== 'undefined' && isEditorApiCandidate(editor)) return editor;
        } catch (_) {
            // no-op
        }
        const rootEditorType = root.editor ? String(Object.prototype.toString.call(root.editor)) : 'null';
        debugWarn('getEditorApi: no valid editor API found', { rootEditorType });
        return null;
    }

    function getBootstrapApi() {
        if (root.bootstrap && root.bootstrap.Modal) return root.bootstrap;
        try {
            if (typeof bootstrap !== 'undefined' && bootstrap && bootstrap.Modal) return bootstrap;
        } catch (_) {
            // no-op
        }
        return null;
    }

    function escapeHtml(value) {
        const str = value == null ? '' : String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function uniqueList(values) {
        const out = [];
        const seen = new Set();
        for (const value of values || []) {
            const key = String(value || '').trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(String(value));
        }
        return out;
    }

    function normalizeProjectPath(path) {
        const loadFolderApi = getLoadFolderApi();
        if (loadFolderApi && typeof loadFolderApi._normalizeProjectPath === 'function') {
            return loadFolderApi._normalizeProjectPath(path);
        }
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
    }

    function getExtension(path) {
        const normalized = String(path || '').trim().toLowerCase();
        const idx = normalized.lastIndexOf('.');
        if (idx < 0 || idx === normalized.length - 1) return '';
        return normalized.slice(idx + 1);
    }

    function buildInputSignature(text) {
        const raw = String(text || '');
        return `${raw.length}:${raw.slice(0, 180)}:${raw.slice(-180)}`;
    }

    function copyTextToClipboard(text) {
        const value = String(text || '');
        if (!value) return Promise.resolve(false);

        try {
            if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.writeText === 'function') {
                return root.navigator.clipboard.writeText(value).then(
                    () => true,
                    () => false
                );
            }
        } catch (_) {
            // no-op
        }

        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.left = '-1000px';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, ta.value.length);
            const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
            document.body.removeChild(ta);
            return Promise.resolve(!!ok);
        } catch (_) {
            return Promise.resolve(false);
        }
    }

    function buildDiffRetryPrompt() {
        return [
            'Regenerate your answer as a single git-style unified diff only.',
            '',
            'Required output format:',
            '1) Output only the unified diff. Do not include explanation text before or after it.',
            '2) Include every changed file inside the same diff.',
            '3) Do not wrap the diff in markdown fences.',
            '4) Do not add custom wrapper marker lines.',
            '5) Use git-style file headers:',
            'diff --git a/<relative/path> b/<relative/path>',
            '--- a/<relative/path>',
            '+++ b/<relative/path>',
            '6) Use standard @@ hunks with at least 3 unchanged context lines when possible.',
            '7) Prefer small independent hunks; do not group unrelated replacements into one large hunk.',
            '8) Keep enough unchanged context around each hunk to identify the location uniquely.',
            '9) For new files, use --- /dev/null and +++ b/<relative/path>.',
            '10) Do not return complete files, snippets, ellipses, or step-by-step instructions.',
            '11) Do not format diff lines as Markdown bullets or numbered lists.',
            '12) Do not wrap individual changed lines in code fences.',
            '13) Preserve the first character of every hunk line exactly: one space for context, + for additions, - for removals.',
            '',
            'Return the unified diff now.'
        ].join('\n');
    }

    function buildAiStudioFullFileRetryPrompt() {
        return [
            'Regenerate your answer using Forge AI Studio full-file mode.',
            '',
            'Do not return a diff. Return complete replacement file contents only.',
            '',
            'Required output format for each changed file:',
            'FILE: <relative/path>',
            '```<language>',
            '<complete file contents here>',
            '```',
            '',
            'Rules:',
            '1) Include the full file, including unchanged lines.',
            '2) Use one FILE block per changed file.',
            '3) If this is a single-file HTML app, use FILE: index.html.',
            '4) Do not use Forge diff markers or diff hunks.',
            '5) Do not format code lines as Markdown bullets or numbered lists.',
            '6) Do not wrap individual functions or changed lines in separate fences.',
            '7) Do not include explanations, summaries, or instructions outside the file block.',
            '8) Preserve indentation exactly inside the code fence.',
            '',
            'Return the complete replacement file block now.'
        ].join('\n');
    }

    function normalizeDiffTransportText(rawText) {
        let normalized = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        normalized = normalized
            .replace(/BEGIN_FORGE_UNIFIED_DIFF[ \t]+(?=\S)/gi, 'BEGIN_FORGE_UNIFIED_DIFF\n')
            .replace(/[ \t]+END_FORGE_UNIFIED_DIFF/gi, '\nEND_FORGE_UNIFIED_DIFF')
            .replace(/([^\n])\s+(diff\s+--git\s+)/g, '$1\n$2')
            .replace(/([^\n])\s+(---\s+(?:a\/|\/dev\/null))/g, '$1\n$2')
            .replace(/([^\n])\s+(\+\+\+\s+(?:b\/|\/dev\/null))/g, '$1\n$2')
            .replace(/([^\n])\s+(@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@)/g, '$1\n$2');
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
        const candidate = sawBegin ? blocks.join('\n') : normalized;

        return candidate
            .split('\n')
            .filter(line => {
                const trimmed = String(line || '').trim();
                if (!trimmed) return true;
                if (/^(`{3,}|~{3,})(?:\s*(?:diff|patch|udiff|text|txt))?\s*$/i.test(trimmed)) return false;
                if (/^(?:diff|patch|udiff|text|txt|code|copy|copy code|content_copy|download|play_circle|expand_less|expand_more)$/i.test(trimmed)) return false;
                if (/^use code with caution\.?$/i.test(trimmed)) return false;
                return true;
            })
            .join('\n');
    }

    function cleanDiffPath(rawPath) {
        let value = String(rawPath || '').trim();
        if (!value) return '';
        value = value.split('\t')[0].trim();
        value = value.replace(/^"(.*)"$/, '$1').trim();
        if (value === '/dev/null') return '/dev/null';
        value = value.replace(/^(?:a|b|i|w)\//, '');
        let normalized = sanitizePath(value);
        if (!normalized) {
            const fallback = normalizeProjectPath(value);
            if (fallback && getExtension(fallback)) normalized = fallback;
        }
        return normalized || '';
    }

    function parseUnifiedHunkHeader(line) {
        const match = String(line || '').match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
        if (!match) return null;
        return {
            oldStart: parseInt(match[1], 10),
            oldCount: match[2] == null ? 1 : parseInt(match[2], 10),
            newStart: parseInt(match[3], 10),
            newCount: match[4] == null ? 1 : parseInt(match[4], 10),
            header: String(line || '')
        };
    }

    function hunkHeaderHasTrailingSectionText(line) {
        const match = String(line || '').match(/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@(.*)$/);
        return !!(match && String(match[1] || '').trim());
    }

    function isMarkdownFenceLine(line) {
        return /^\s*(`{3,}|~{3,})/.test(String(line || ''));
    }

    function normalizePossiblyIndentedHunkLine(line) {
        const text = String(line || '');
        if (!/^ {2,}[+-]/.test(text)) return text;
        const unindented = text.replace(/^ +/, '');
        if (/^(?:\+\+\+|---)\s/.test(unindented)) return text;
        return unindented;
    }

    function nextNonFenceLine(lines, index) {
        for (let i = index + 1; i < lines.length; i += 1) {
            if (isMarkdownFenceLine(lines[i])) continue;
            return String(lines[i] || '');
        }
        return '';
    }

    function isUnifiedFileHeaderAt(lines, index) {
        const line = String(lines[index] || '');
        if (!/^---\s+\S+/.test(line)) return false;
        return /^\+\+\+\s+\S+/.test(nextNonFenceLine(lines, index));
    }

    function extractPathFromDiffHeader(line, marker) {
        const text = String(line || '');
        const re = marker === 'old' ? /^---\s+(.+)$/ : /^\+\+\+\s+(.+)$/;
        const match = text.match(re);
        return match ? cleanDiffPath(match[1]) : '';
    }

    function parseUnifiedDiffResponse(rawText) {
        const text = normalizeDiffTransportText(rawText);
        const lines = text.split('\n');
        const patches = [];
        const warnings = [];
        let currentPatch = null;
        let currentHunk = null;
        let pendingPath = '';
        let normalizedIndentedHunkMarkers = false;
        let normalizedMarkdownListMarkers = false;
        let pendingMarkdownListDiffType = '';
        let skipHeaderContinuationLines = false;
        let normalizedWrappedHunkHeaders = false;

        const finishPatch = () => {
            if (!currentPatch) return;
            if (currentHunk) {
                currentPatch.hunks.push(currentHunk);
                currentHunk = null;
            }
            const path = currentPatch.newPath && currentPatch.newPath !== '/dev/null'
                ? currentPatch.newPath
                : currentPatch.oldPath;
            if (!path || path === '/dev/null') {
                warnings.push('Skipped a diff block without a usable relative file path.');
            } else if (!currentPatch.hunks.length) {
                warnings.push(`Skipped diff block for ${path} because it had no hunks.`);
            } else {
                currentPatch.path = path;
                currentPatch.action = currentPatch.oldPath === '/dev/null'
                    ? 'create'
                    : (currentPatch.newPath === '/dev/null' ? 'delete' : 'update');
                patches.push(currentPatch);
            }
            currentPatch = null;
        };

        const ensurePatch = () => {
            if (!currentPatch) {
                currentPatch = {
                    oldPath: pendingPath || '',
                    newPath: pendingPath || '',
                    path: pendingPath || '',
                    action: 'update',
                    hunks: []
                };
            }
            return currentPatch;
        };

        for (let i = 0; i < lines.length; i += 1) {
            const line = String(lines[i] || '');
            if (isMarkdownFenceLine(line)) continue;

            const fileCue = line.match(/^\s*(?:File|Path)\s*:\s*(.+)$/i);
            if (fileCue) {
                const cuedPath = cleanDiffPath(fileCue[1]);
                if (cuedPath && cuedPath !== '/dev/null') pendingPath = cuedPath;
                continue;
            }

            const gitHeader = line.match(/^diff\s+--git\s+(?:"?a\/(.+?)"?|\S+)\s+(?:"?b\/(.+?)"?|\S+)\s*$/);
            if (gitHeader) {
                finishPatch();
                currentPatch = {
                    oldPath: cleanDiffPath(gitHeader[1] || ''),
                    newPath: cleanDiffPath(gitHeader[2] || ''),
                    path: '',
                    action: 'update',
                    hunks: []
                };
                pendingPath = currentPatch.newPath || currentPatch.oldPath || pendingPath;
                continue;
            }

            if (isUnifiedFileHeaderAt(lines, i)) {
                if (currentPatch && !currentHunk && !currentPatch.hunks.length) {
                    currentPatch.oldPath = extractPathFromDiffHeader(line, 'old');
                    currentPatch.newPath = currentPatch.newPath || '';
                } else {
                    finishPatch();
                    currentPatch = {
                        oldPath: extractPathFromDiffHeader(line, 'old'),
                        newPath: '',
                        path: '',
                        action: 'update',
                        hunks: []
                    };
                }
                continue;
            }

            if (/^\+\+\+\s+\S+/.test(line)) {
                const patch = ensurePatch();
                patch.newPath = extractPathFromDiffHeader(line, 'new');
                if (patch.newPath && patch.newPath !== '/dev/null') pendingPath = patch.newPath;
                continue;
            }

            const hunkHeader = parseUnifiedHunkHeader(line);
            if (hunkHeader) {
                const patch = ensurePatch();
                if (currentHunk) patch.hunks.push(currentHunk);
                currentHunk = {
                    ...hunkHeader,
                    lines: []
                };
                pendingMarkdownListDiffType = '';
                skipHeaderContinuationLines = hunkHeaderHasTrailingSectionText(line);
                continue;
            }

            if (!currentHunk) continue;

            if (skipHeaderContinuationLines) {
                const trimmed = line.trim();
                if (trimmed && !/^[ +-]/.test(line) && line !== '\\ No newline at end of file') {
                    normalizedWrappedHunkHeaders = true;
                    continue;
                }
                skipHeaderContinuationLines = false;
            }

            const markdownListFence = line.match(/^\s*([*-])\s*`{3,}\s*$/);
            if (markdownListFence) {
                pendingMarkdownListDiffType = markdownListFence[1] === '*' ? 'add' : 'remove';
                normalizedMarkdownListMarkers = true;
                continue;
            }

            const bareMarkdownListMarker = line.match(/^\s*([*-])\s*$/);
            if (bareMarkdownListMarker) {
                currentHunk.lines.push({
                    type: bareMarkdownListMarker[1] === '*' ? 'add' : 'remove',
                    text: '',
                    markdownListMarker: true
                });
                normalizedMarkdownListMarkers = true;
                pendingMarkdownListDiffType = '';
                continue;
            }

            const markdownListAdd = line.match(/^\s*\*\s+(.+)$/);
            if (markdownListAdd && !/^\s*\*\s*`{3,}\s*$/.test(line)) {
                currentHunk.lines.push({ type: 'add', text: markdownListAdd[1], markdownListMarker: true });
                normalizedMarkdownListMarkers = true;
                pendingMarkdownListDiffType = '';
                continue;
            }

            if (pendingMarkdownListDiffType) {
                const type = pendingMarkdownListDiffType;
                pendingMarkdownListDiffType = '';
                if (line.trim()) {
                    currentHunk.lines.push({ type, text: line, markdownListMarker: true });
                    normalizedMarkdownListMarkers = true;
                    continue;
                }
            }

            const hunkLine = normalizePossiblyIndentedHunkLine(line);
            if (hunkLine !== line) normalizedIndentedHunkMarkers = true;

            if (hunkLine === '\\ No newline at end of file') {
                currentHunk.lines.push({ type: 'meta', text: hunkLine });
                continue;
            }

            const prefix = hunkLine[0];
            const body = hunkLine.slice(1);
            if (prefix === ' ') {
                currentHunk.lines.push({ type: 'context', text: body });
            } else if (prefix === '-') {
                currentHunk.lines.push({ type: 'remove', text: body, indentedDiffMarker: hunkLine !== line });
            } else if (prefix === '+') {
                currentHunk.lines.push({ type: 'add', text: body, indentedDiffMarker: hunkLine !== line });
            } else {
                // Common LLM mistake: context lines inside a hunk lose their leading space.
                currentHunk.lines.push({ type: 'context', text: line });
            }
        }

        finishPatch();
        if (normalizedIndentedHunkMarkers) {
            warnings.push('Normalized indented +/- diff markers inside hunks.');
        }
        if (normalizedMarkdownListMarkers) {
            warnings.push('Normalized Markdown-list damaged diff markers inside hunks.');
        }
        if (normalizedWrappedHunkHeaders) {
            warnings.push('Ignored wrapped hunk-header continuation lines.');
        }
        const ambiguousIndentedMarkerHunks = patches.reduce((sum, patch) => {
            const hunks = Array.isArray(patch && patch.hunks) ? patch.hunks : [];
            return sum + hunks.filter(shouldRepairAmbiguousIndentedMarkerHunk).length;
        }, 0);
        if (ambiguousIndentedMarkerHunks) {
            warnings.push(`Detected ${ambiguousIndentedMarkerHunks} hunk(s) where AI Studio-style formatting may have erased addition markers; Forge will try content-aware repair while applying.`);
        }

        return {
            patches,
            warnings,
            stats: {
                patches: patches.length,
                hunks: patches.reduce((sum, patch) => sum + patch.hunks.length, 0)
            }
        };
    }

    function buildDiffPlanFromParsed(diffParsed, sourceText) {
        const entries = getEntries();
        const existingMap = buildExistingPathMap(entries);
        const warnings = Array.isArray(diffParsed && diffParsed.warnings) ? diffParsed.warnings.slice() : [];
        const plan = [];
        const planIndexByPath = new Map();

        const patches = Array.isArray(diffParsed && diffParsed.patches) ? diffParsed.patches : [];
        for (const patch of patches) {
            const targetPath = normalizeProjectPath(patch && patch.path);
            if (!targetPath) {
                warnings.push('Skipped a diff with an empty target path.');
                continue;
            }
            if (patch.action === 'delete') {
                warnings.push(`Skipped delete diff for ${targetPath}. Paste-back deletes are not applied automatically.`);
                continue;
            }

            const key = targetPath.toLowerCase();
            const exists = existingMap.has(key);
            const action = exists ? 'update' : 'create';
            const item = {
                path: targetPath,
                action,
                inferredPath: false,
                source: 'unified-diff',
                language: '',
                content: '',
                patch: {
                    oldPath: patch.oldPath || '',
                    newPath: patch.newPath || '',
                    action: patch.action || action,
                    hunks: patch.hunks || []
                }
            };

            if (planIndexByPath.has(key)) {
                const idx = planIndexByPath.get(key);
                warnings.push(`Multiple diff blocks targeted ${targetPath}. Kept the later block.`);
                plan[idx] = item;
            } else {
                planIndexByPath.set(key, plan.length);
                plan.push(item);
            }
        }

        const creates = plan.filter(item => item.action === 'create').length;
        const updates = plan.filter(item => item.action === 'update').length;
        return {
            inputSignature: buildInputSignature(sourceText),
            rawTextLength: String(sourceText || '').length,
            plan,
            warnings,
            requiresFullFilesRetry: false,
            retryPrompt: '',
            retryReasons: [],
            stats: {
                creates,
                updates,
                total: plan.length,
                patches: plan.length,
                hunks: diffParsed && diffParsed.stats ? diffParsed.stats.hunks : 0
            }
        };
    }

    function detectPartialUpdateResponse(rawText, parsed) {
        const text = String(rawText || '');
        if (!text.trim()) {
            return { detected: false, reasons: [] };
        }

        const reasons = [];

        const strongInstructionPatterns = [
            { re: /\badd this line\b/i, reason: 'Contains "add this line" instructions.' },
            { re: /\bfind the [^\n]*function\b/i, reason: 'Contains "find this function and modify it" instructions.' },
            { re: /\bstep\s+[a-z]\s*:/i, reason: 'Contains step-by-step patch instructions (Step A/B/etc.).' },
            { re: /\boptional tweak\b/i, reason: 'Contains optional tweak instructions instead of full files.' },
            { re: /\bbetween the [^\n]*\bdiv\b/i, reason: 'Contains insertion instructions ("add between ... div").' }
        ];
        for (const pattern of strongInstructionPatterns) {
            if (pattern.re.test(text)) reasons.push(pattern.reason);
        }

        const placeholderPatterns = [
            { re: /<!--\s*\.\.\.\s*existing[\s\S]*?-->/i, reason: 'Contains HTML placeholder comments like "... existing ...".' },
            { re: /\/\/\s*\.\.\.\s*\(.*existing.*\)/i, reason: 'Contains JS placeholder comments like "... (existing logic) ...".' },
            { re: /\.\.\.\s*\(.*existing.*\)/i, reason: 'Contains generic placeholder snippets instead of full file content.' },
            { re: /\brest of code\b/i, reason: 'Contains "rest of code" placeholder language.' }
        ];

        for (const pattern of placeholderPatterns) {
            if (pattern.re.test(text)) reasons.push(pattern.reason);
        }

        const blocks = Array.isArray(parsed && parsed.blocks) ? parsed.blocks : [];
        const blockHasPlaceholder = blocks.some(block => {
            const content = String(block && block.content ? block.content : '');
            return /(?:\/\/\s*\.\.\.|<!--\s*\.\.\.|\.\.\.\s*\(.*existing.*\)|\badd this line\b)/i.test(content);
        });
        if (blockHasPlaceholder) {
            reasons.push('One or more code blocks contain snippet placeholders, not full files.');
        }

        const detected = reasons.length > 0;
        return { detected, reasons: uniqueList(reasons) };
    }

    function getParserApi() {
        const parser = root.aiResponseParser;
        if (!parser || typeof parser.parse !== 'function') {
            return null;
        }
        return parser;
    }

    function sanitizePath(path) {
        const parser = getParserApi();
        if (parser && typeof parser.sanitizePath === 'function') {
            return parser.sanitizePath(path);
        }
        return normalizeProjectPath(path);
    }

    function detectLanguageFromContent(content) {
        const parser = getParserApi();
        if (parser && typeof parser.detectContentLanguage === 'function') {
            return parser.detectContentLanguage(content);
        }
        return '';
    }

    function getEntries() {
        const loadFolderApi = getLoadFolderApi();
        if (!(loadFolderApi && Array.isArray(loadFolderApi.fileStructure))) {
            return [];
        }
        return loadFolderApi.fileStructure.filter(entry => entry && entry.kind === 'file');
    }

    function buildExistingPathMap(entries) {
        const map = new Map();
        for (const entry of entries) {
            const normalized = normalizeProjectPath(entry.relativePath || '');
            if (!normalized) continue;
            map.set(normalized.toLowerCase(), entry);
        }
        return map;
    }

    function buildPathsByExtension(entries) {
        const byExt = new Map();
        for (const entry of entries) {
            const normalized = normalizeProjectPath(entry.relativePath || '');
            if (!normalized) continue;
            const ext = getExtension(normalized);
            if (!ext) continue;
            if (!byExt.has(ext)) byExt.set(ext, []);
            byExt.get(ext).push(normalized);
        }
        byExt.forEach(paths => paths.sort((a, b) => a.localeCompare(b)));
        return byExt;
    }

    function isProtectedPath(path) {
        const normalized = normalizeProjectPath(path).toLowerCase();
        return normalized === 'compiled-hashes.csv' || normalized.startsWith('.checkpoints/');
    }

    function inferExtensionForBlock(block) {
        const explicitExt = getExtension(block.pathHint || '');
        if (explicitExt) return explicitExt;

        const parser = getParserApi();
        const language = String(block.language || '').trim().toLowerCase();
        if (language && parser && typeof parser.languageToExtension === 'function') {
            const ext = parser.languageToExtension(language);
            if (ext) return ext;
        }

        const contentLanguage = detectLanguageFromContent(block.content || '');
        if (contentLanguage && parser && typeof parser.languageToExtension === 'function') {
            const ext = parser.languageToExtension(contentLanguage);
            if (ext) return ext;
        }

        const content = String(block.content || '').trim();
        if (/<!doctype\s+html|<html[\s>]/i.test(content)) return 'html';
        if (/^\s*[\[{]/.test(content)) return 'json';
        if (/(?:^|\n)\s*(?:const|let|var|function|class|import|export)\b/.test(content)) return 'js';
        if (/(?:^|\n)\s*[.#]?[A-Za-z0-9_-][^{}]*\{/.test(content) && /:\s*[^;\n]+;/.test(content)) return 'css';
        return '';
    }

    function sortHtmlCandidates(paths) {
        return paths.slice().sort((a, b) => {
            const aLower = a.toLowerCase();
            const bLower = b.toLowerCase();
            const aRootIndex = aLower === 'index.html';
            const bRootIndex = bLower === 'index.html';
            if (aRootIndex && !bRootIndex) return -1;
            if (!aRootIndex && bRootIndex) return 1;
            const aRoot = !a.includes('/');
            const bRoot = !b.includes('/');
            if (aRoot && !bRoot) return -1;
            if (!aRoot && bRoot) return 1;
            return a.localeCompare(b);
        });
    }

    function makeUniquePath(basePath, usedPaths) {
        const normalizedBase = normalizeProjectPath(basePath);
        const lowerBase = normalizedBase.toLowerCase();
        if (!usedPaths.has(lowerBase)) {
            return normalizedBase;
        }

        const ext = getExtension(normalizedBase);
        const extSuffix = ext ? `.${ext}` : '';
        const stem = ext ? normalizedBase.slice(0, -extSuffix.length) : normalizedBase;
        for (let i = 2; i <= 200; i += 1) {
            const candidate = `${stem}-${i}${extSuffix}`;
            if (!usedPaths.has(candidate.toLowerCase())) {
                return candidate;
            }
        }
        return '';
    }

    function pickPathByExtension(ext, context, usedPaths) {
        const byExt = context.pathsByExt;
        const getExisting = (key) => (byExt.get(key) || []).slice();

        let candidates = [];
        if (ext === 'html' || ext === 'htm') {
            candidates = sortHtmlCandidates(getExisting('html').concat(getExisting('htm')));
            candidates.push('index.html', 'app.html');
        } else if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
            candidates = getExisting(ext);
            candidates.push('styles.css', 'style.css', 'app.css');
        } else if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts' || ext === 'tsx' || ext === 'jsx') {
            candidates = getExisting(ext);
            candidates.push('script.js', 'app.js', 'main.js');
        } else if (ext === 'json') {
            candidates = getExisting('json');
            candidates.push('data.json', 'config.json');
        } else if (ext === 'md') {
            candidates = getExisting('md');
            candidates.push('README.md');
        } else if (ext) {
            candidates = getExisting(ext);
            candidates.push(`new-file.${ext}`);
        } else {
            candidates = ['index.html', 'script.js', 'styles.css'];
        }

        for (const rawCandidate of candidates) {
            const candidate = normalizeProjectPath(rawCandidate);
            if (!candidate) continue;
            if (isProtectedPath(candidate)) continue;
            const key = candidate.toLowerCase();
            if (usedPaths.has(key)) continue;
            return candidate;
        }

        const fallbackBase = ext ? `new-file.${ext}` : 'new-file.txt';
        return makeUniquePath(fallbackBase, usedPaths);
    }

    function resolveBlockPath(block, context, usedPaths, warnings) {
        const explicitRaw = String(block.pathHint || '').trim();
        let resolvedPath = sanitizePath(explicitRaw);

        if (!resolvedPath && explicitRaw) {
            // Try preserving explicit text if parser sanitization was too strict.
            const normalized = normalizeProjectPath(explicitRaw);
            if (normalized && getExtension(normalized)) {
                resolvedPath = normalized;
            }
        }

        if (resolvedPath && isProtectedPath(resolvedPath)) {
            warnings.push(`Skipped protected path: ${resolvedPath}`);
            return '';
        }

        if (!resolvedPath) {
            const ext = inferExtensionForBlock(block);
            resolvedPath = pickPathByExtension(ext, context, usedPaths);
            if (!resolvedPath) {
                warnings.push('Could not infer a target file path for one block.');
                return '';
            }
        }

        return normalizeProjectPath(resolvedPath);
    }

    function buildPlanFromParsed(parsed, sourceText) {
        const entries = getEntries();
        const existingMap = buildExistingPathMap(entries);
        const pathsByExt = buildPathsByExtension(entries);
        const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];
        const usedPaths = new Set();
        const plan = [];
        const planIndexByPath = new Map();

        const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
        for (const block of blocks) {
            const content = String(block && block.content ? block.content : '').trim();
            if (!content) {
                warnings.push('Skipped an empty parsed block.');
                continue;
            }

            const resolvedPath = resolveBlockPath(block, { entries, existingMap, pathsByExt }, usedPaths, warnings);
            if (!resolvedPath) continue;

            const key = resolvedPath.toLowerCase();
            const action = existingMap.has(key) ? 'update' : 'create';
            const inferredPath = !String(block.pathHint || '').trim()
                || normalizeProjectPath(String(block.pathHint || '')).toLowerCase() !== key;

            const item = {
                path: resolvedPath,
                action,
                inferredPath,
                source: String(block.source || 'unknown'),
                language: String(block.language || ''),
                content
            };

            if (planIndexByPath.has(key)) {
                const idx = planIndexByPath.get(key);
                warnings.push(`Multiple blocks targeted ${resolvedPath}. Kept the later block.`);
                plan[idx] = item;
            } else {
                planIndexByPath.set(key, plan.length);
                plan.push(item);
            }

            usedPaths.add(key);
        }

        const creates = plan.filter(item => item.action === 'create').length;
        const updates = plan.filter(item => item.action === 'update').length;
        const partialCheck = detectPartialUpdateResponse(sourceText, parsed);
        const requiresFullFilesRetry = !!partialCheck.detected;
        const retryPrompt = requiresFullFilesRetry ? buildDiffRetryPrompt() : '';

        if (requiresFullFilesRetry) {
            warnings.unshift('Detected an instructional or snippet-style response that is not a usable unified diff.');
            for (const reason of partialCheck.reasons) {
                warnings.push(`Partial-response signal: ${reason}`);
            }
            warnings.push('Use the "AI Retry Prompt" box below, then paste the regenerated unified diff.');
        }

        return {
            inputSignature: buildInputSignature(sourceText),
            rawTextLength: String(sourceText || '').length,
            plan,
            warnings,
            requiresFullFilesRetry,
            retryPrompt,
            retryReasons: partialCheck.reasons,
            stats: {
                creates,
                updates,
                total: plan.length
            }
        };
    }

    function findEntryByPath(path) {
        const key = normalizeProjectPath(path).toLowerCase();
        if (!key) return null;
        const entries = getEntries();
        for (const entry of entries) {
            const rel = normalizeProjectPath(entry.relativePath || '').toLowerCase();
            if (rel === key) return entry;
        }
        return null;
    }

    function getPathBasename(path) {
        const normalized = normalizeProjectPath(path);
        if (!normalized) return '';
        const parts = normalized.split('/');
        return String(parts[parts.length - 1] || '').toLowerCase();
    }

    function getBasenameFromMeta(meta) {
        if (!meta) return '';
        const rel = normalizeProjectPath(meta.relativePath || '');
        if (rel) {
            return getPathBasename(rel);
        }
        return String(meta.name || '').trim().toLowerCase();
    }

    function isUniqueBasenameInProject(basename) {
        const needle = String(basename || '').trim().toLowerCase();
        if (!needle) return false;
        let count = 0;
        const entries = getEntries();
        for (const entry of entries) {
            const name = String(entry && entry.name ? entry.name : '').trim().toLowerCase();
            if (name !== needle) continue;
            count += 1;
            if (count > 1) return false;
        }
        return count === 1;
    }

    function pathMatchesMeta(targetPath, meta, entry = null) {
        const key = normalizeProjectPath(targetPath).toLowerCase();
        if (!key || !meta) return false;
        const metaRel = normalizeProjectPath(meta.relativePath || '').toLowerCase();
        if (metaRel && metaRel === key) return true;

        const targetBase = getPathBasename(targetPath);
        const metaName = String(meta.name || '').trim().toLowerCase();
        if (!targetBase || !metaName || targetBase !== metaName) return false;

        // Additional fallback: compare path-array + basename when entry is known.
        if (entry && Array.isArray(entry.path)) {
            const metaPathArr = Array.isArray(meta.path) ? meta.path.map(v => String(v || '').trim()) : null;
            const entryPathArr = entry.path.map(v => String(v || '').trim());
            if (metaPathArr && metaPathArr.length === entryPathArr.length) {
                let allMatch = true;
                for (let i = 0; i < metaPathArr.length; i += 1) {
                    if (metaPathArr[i] !== entryPathArr[i]) {
                        allMatch = false;
                        break;
                    }
                }
                if (allMatch && metaName === targetBase) {
                    return true;
                }
            }
        }

        // Last fallback for stale metadata with root-level file.
        return !key.includes('/') && metaName === targetBase;
    }

    function getOpenUuidsByPath(path, entry = null) {
        const editorApi = getEditorApi();
        if (!(editorApi && editorApi._meta)) return [];
        const uuids = Object.keys(editorApi._meta || {});
        const out = new Set();
        const targetBase = getPathBasename(path);
        const allowBasenameFallback = isUniqueBasenameInProject(targetBase);

        for (const uuid of uuids) {
            const meta = editorApi._meta[uuid];
            if (!meta) continue;
            if (pathMatchesMeta(path, meta, entry)) {
                out.add(uuid);
                continue;
            }
            // Additional stale-meta fallback: same file handle object.
            if (entry && meta.entry && entry.entry && meta.entry === entry.entry) {
                out.add(uuid);
                continue;
            }
            // Last-resort fallback: unique basename in project.
            if (allowBasenameFallback && targetBase && getBasenameFromMeta(meta) === targetBase) {
                out.add(uuid);
            }
        }

        // If no match was found, and the active tab basename matches, refresh it to avoid stale-view misses.
        if (out.size === 0 && typeof editorApi.getActiveUuid === 'function') {
            const activeUuid = String(editorApi.getActiveUuid() || '');
            if (activeUuid) {
                const activeMeta = editorApi._meta ? editorApi._meta[activeUuid] : null;
                if (activeMeta && targetBase && getBasenameFromMeta(activeMeta) === targetBase) {
                    out.add(activeUuid);
                }
            }
        }

        return Array.from(out);
    }

    function findOpenUuidByPath(path, entry = null) {
        const matches = getOpenUuidsByPath(path, entry);
        return matches.length ? matches[0] : '';
    }

    async function ensureEditorUuidForPath(path, entry, options = {}) {
        const opts = {
            retries: 8,
            retryDelayMs: 60,
            ...options
        };
        const targetEntry = entry || findEntryByPath(path);
        if (!targetEntry || !targetEntry.uuid) return '';

        const alreadyOpen = findOpenUuidByPath(path, targetEntry);
        if (alreadyOpen) return alreadyOpen;

        const editorApi = getEditorApi();
        if (!(editorApi && typeof editorApi.openFile === 'function')) return '';
        for (let attempt = 0; attempt < opts.retries; attempt += 1) {
            try {
                await editorApi.openFile(targetEntry.uuid);
            } catch (_) {
                // no-op; retry
            }
            const resolved = findOpenUuidByPath(path, targetEntry);
            if (resolved) return resolved;
            if (attempt < opts.retries - 1) {
                await new Promise(resolve => setTimeout(resolve, opts.retryDelayMs));
            }
        }
        return '';
    }

    async function writeEntryDirect(entry, content) {
        if (!(entry && entry.entry && typeof entry.entry.createWritable === 'function')) {
            return false;
        }
        // Ensure unshipped banner for HTML files written outside the editor
        let prepared = String(content || '');
        const name = String(entry.name || '');
        if (/\.html?$/i.test(name) && typeof editor !== 'undefined' && editor.ensureUnshippedBanner) {
            prepared = editor.ensureUnshippedBanner(prepared);
        }
        const writable = await entry.entry.createWritable();
        try {
            await writable.write(prepared);
        } finally {
            await writable.close();
        }
        return true;
    }

    async function readEntryText(entry) {
        if (!(entry && entry.entry && typeof entry.entry.getFile === 'function')) {
            return '';
        }
        const file = await entry.entry.getFile();
        return await file.text();
    }

    function shouldIncludeInPostEditCodebase(path) {
        const normalized = normalizeProjectPath(path).toLowerCase();
        if (!normalized) return false;
        if (normalized.startsWith('.checkpoints/')) return false;
        if (normalized.startsWith('.git/')) return false;
        if (normalized.includes('/node_modules/')) return false;
        if (normalized.startsWith('node_modules/')) return false;
        if (normalized.startsWith('shipped app files/') || normalized.startsWith('shipped apps/')) return false;
        if (/\.crswap$/i.test(normalized)) return false;
        return /\.(html?|css|js|json|md|txt|csv)$/i.test(normalized);
    }

    async function gatherCodebaseTextForPostEdit() {
        const promptLabApi = getPromptLabApi();
        if (promptLabApi && typeof promptLabApi.gatherCodebaseText === 'function') {
            const text = await promptLabApi.gatherCodebaseText();
            if (String(text || '').trim()) return text;
        }

        const loadFolderApi = getLoadFolderApi();
        if (!(loadFolderApi && Array.isArray(loadFolderApi.fileStructure))) return '';

        const files = loadFolderApi.fileStructure
            .filter(file => file && file.kind === 'file' && shouldIncludeInPostEditCodebase(file.relativePath || file.name || ''))
            .sort((a, b) => {
                const aPath = normalizeProjectPath(a.relativePath || a.name || '');
                const bPath = normalizeProjectPath(b.relativePath || b.name || '');
                if (aPath.toLowerCase() === 'index.html') return -1;
                if (bPath.toLowerCase() === 'index.html') return 1;
                return aPath.localeCompare(bPath);
            });

        const parts = [];
        for (const file of files) {
            const name = normalizeProjectPath(file.relativePath || file.name || '');
            try {
                let content = '';
                if (typeof loadFolderApi.getFileContent === 'function') {
                    content = await loadFolderApi.getFileContent(file);
                } else {
                    content = await readEntryText(file);
                }
                parts.push(`--- ${name} ---`);
                parts.push(String(content || ''));
                parts.push('');
            } catch (_) {
                // Skip unreadable files; the copied context is best-effort.
            }
        }

        return parts.join('\n');
    }

    function readOpenEditorText(editorApi, uuid) {
        if (!(editorApi && uuid)) return null;
        try {
            if (typeof editorApi._getValue === 'function') {
                return editorApi._getValue(uuid);
            }
            const view = editorApi.instance ? editorApi.instance[uuid] : null;
            if (view && view.state && view.state.doc && typeof view.state.doc.toString === 'function') {
                return view.state.doc.toString();
            }
        } catch (_) {
            // no-op
        }
        return null;
    }

    function getCheckpointApi() {
        if (root.checkpointManager && typeof root.checkpointManager === 'object') return root.checkpointManager;
        try {
            if (typeof checkpointManager !== 'undefined' && checkpointManager) return checkpointManager;
        } catch (_) {
            // no-op
        }
        return null;
    }

    function getPromptLabApi() {
        if (root.promptLab && typeof root.promptLab === 'object') return root.promptLab;
        try {
            if (typeof promptLab !== 'undefined' && promptLab) return promptLab;
        } catch (_) {
            // no-op
        }
        return null;
    }

    function hunkOldLines(hunk) {
        const out = [];
        for (const line of (hunk && hunk.lines) || []) {
            if (line.type === 'context' || line.type === 'remove') out.push(String(line.text || ''));
        }
        return out;
    }

    function hunkNewLines(hunk) {
        const out = [];
        for (const line of (hunk && hunk.lines) || []) {
            if (line.type === 'context' || line.type === 'add') out.push(String(line.text || ''));
        }
        return out;
    }

    function countHunkLineTypes(hunk) {
        const counts = { context: 0, remove: 0, add: 0, indentedRemove: 0, indentedAdd: 0 };
        for (const line of (hunk && hunk.lines) || []) {
            if (!(line && typeof line.type === 'string')) continue;
            if (Object.prototype.hasOwnProperty.call(counts, line.type)) counts[line.type] += 1;
            if (line.indentedDiffMarker && line.type === 'remove') counts.indentedRemove += 1;
            if (line.indentedDiffMarker && line.type === 'add') counts.indentedAdd += 1;
        }
        return counts;
    }

    function shouldRepairAmbiguousIndentedMarkerHunk(hunk) {
        const counts = countHunkLineTypes(hunk);
        if (!counts.indentedRemove) return false;
        if (counts.add > 0) return false;
        const expectedOld = Math.max(0, Number.isFinite(hunk && hunk.oldCount) ? hunk.oldCount : 0);
        const expectedNew = Math.max(0, Number.isFinite(hunk && hunk.newCount) ? hunk.newCount : 0);
        return expectedNew > expectedOld || counts.remove > expectedOld + 3;
    }

    function repairAmbiguousIndentedMarkerHunk(hunk, lines, preferredIndex) {
        if (!shouldRepairAmbiguousIndentedMarkerHunk(hunk)) return null;
        const windowSize = Math.max(80, Math.max(hunk.oldCount || 0, hunk.newCount || 0) * 3 + 40);
        const lower = Math.max(0, preferredIndex - windowSize);
        const upper = Math.min(lines.length - 1, preferredIndex + windowSize);
        let reclassified = 0;
        const sourceLines = ((hunk && hunk.lines) || []);
        const repairedLines = sourceLines.slice();
        let i = 0;

        while (i < repairedLines.length) {
            const start = i;
            while (i < repairedLines.length && repairedLines[i] && repairedLines[i].indentedDiffMarker && repairedLines[i].type === 'remove') {
                i += 1;
            }
            const end = i;
            if (end === start) {
                i += 1;
                continue;
            }

            const run = repairedLines.slice(start, end);
            const distinctive = run
                .map((line, idx) => ({ line, idx, text: String(line && line.text || '') }))
                .filter(item => isDistinctivePatchLine(item.text));
            if (!distinctive.length) continue;

            let missing = 0;
            let present = 0;
            for (const item of distinctive) {
                const localMatches = findLineIndexesFlexible(lines, item.text, lower, upper);
                const globalMatches = localMatches.length ? localMatches : findLineIndexesFlexible(lines, item.text);
                if (globalMatches.length) present += 1;
                else missing += 1;
            }

            if (!missing || missing < present) continue;

            for (let j = start; j < end; j += 1) {
                repairedLines[j] = {
                    ...repairedLines[j],
                    type: 'add',
                    repairedFromIndentedRemove: true
                };
                reclassified += 1;
            }
        }

        if (!reclassified) return null;
        return {
            hunk: {
                ...hunk,
                lines: repairedLines
            },
            reclassified,
            before: countHunkLineTypes(hunk),
            after: countHunkLineTypes({ ...hunk, lines: repairedLines })
        };
    }

    function repairMarkdownEscapedDiffLine(line) {
        return String(line || '').replace(/\\([\\`*_{}\[\]()#+.!<>|-])/g, '$1');
    }

    function repairMarkdownEscapedLines(lines) {
        return (lines || []).map(repairMarkdownEscapedDiffLine);
    }

    function buildInsertionFallback(hunk, repairMarkdownEscapes = false) {
        const hunkLines = Array.isArray(hunk && hunk.lines) ? hunk.lines : [];
        const hasRemoval = hunkLines.some(line => line && line.type === 'remove');
        if (hasRemoval || !hunkLines.some(line => line && line.type === 'add')) return null;

        const firstAddIdx = hunkLines.findIndex(line => line && line.type === 'add');
        let lastAddIdx = -1;
        for (let i = hunkLines.length - 1; i >= 0; i -= 1) {
            if (hunkLines[i] && hunkLines[i].type === 'add') {
                lastAddIdx = i;
                break;
            }
        }
        if (firstAddIdx < 0 || lastAddIdx < firstAddIdx) return null;

        const mapText = line => {
            const text = String(line && line.text || '');
            return repairMarkdownEscapes ? repairMarkdownEscapedDiffLine(text) : text;
        };

        return {
            before: hunkLines.slice(0, firstAddIdx).filter(line => line.type === 'context').map(mapText),
            additions: hunkLines.slice(firstAddIdx, lastAddIdx + 1).filter(line => line.type === 'add').map(mapText),
            after: hunkLines.slice(lastAddIdx + 1).filter(line => line.type === 'context').map(mapText)
        };
    }

    function arraysMatchAt(lines, needle, index, normalizer) {
        if (index < 0 || index + needle.length > lines.length) return false;
        const norm = typeof normalizer === 'function' ? normalizer : value => value;
        for (let i = 0; i < needle.length; i += 1) {
            if (norm(lines[index + i]) !== norm(needle[i])) return false;
        }
        return true;
    }

    function findLineSequence(lines, needle, preferredIndex) {
        if (!needle.length) {
            return Math.max(0, Math.min(lines.length, preferredIndex));
        }

        if (arraysMatchAt(lines, needle, preferredIndex)) return preferredIndex;

        const windowSize = 12;
        const start = Math.max(0, preferredIndex - windowSize);
        const end = Math.min(lines.length - needle.length, preferredIndex + windowSize);
        for (let i = start; i <= end; i += 1) {
            if (i === preferredIndex) continue;
            if (arraysMatchAt(lines, needle, i)) return i;
        }

        for (let i = 0; i <= lines.length - needle.length; i += 1) {
            if (i >= start && i <= end) continue;
            if (arraysMatchAt(lines, needle, i)) return i;
        }

        const trimEnd = value => String(value || '').replace(/[ \t]+$/g, '');
        for (let i = 0; i <= lines.length - needle.length; i += 1) {
            if (arraysMatchAt(lines, needle, i, trimEnd)) return i;
        }

        const trimAll = value => String(value || '').trim();
        for (let i = 0; i <= lines.length - needle.length; i += 1) {
            if (arraysMatchAt(lines, needle, i, trimAll)) return i;
        }

        return -1;
    }

    function isBlankPatchLine(line) {
        return !String(line || '').trim();
    }

    function matchLineSequenceAllowingExtraBlanks(lines, needle, startIndex) {
        if (!needle.length) return { index: startIndex, oldLines: [] };
        if (startIndex < 0 || startIndex >= lines.length) return null;

        let lineIndex = startIndex;
        let needleIndex = 0;
        let skippedBlanks = 0;
        const maxSkippedBlanks = Math.max(8, Math.ceil(needle.length / 3));

        while (needleIndex < needle.length) {
            const expected = String(needle[needleIndex] || '');
            const actual = String(lines[lineIndex] || '');

            if (isBlankPatchLine(expected)) {
                if (lineIndex < lines.length && isBlankPatchLine(actual)) {
                    lineIndex += 1;
                }
                needleIndex += 1;
                continue;
            }

            if (lineIndex < lines.length && isBlankPatchLine(actual)) {
                skippedBlanks += 1;
                if (skippedBlanks > maxSkippedBlanks) return null;
                lineIndex += 1;
                continue;
            }

            if (lineIndex >= lines.length || !lineEqualsFlexible(actual, expected)) {
                return null;
            }

            lineIndex += 1;
            needleIndex += 1;
        }

        return {
            index: startIndex,
            oldLines: lines.slice(startIndex, lineIndex),
            skippedBlanks
        };
    }

    function findLineSequenceAllowingExtraBlanks(lines, needle, preferredIndex) {
        if (!needle.length) {
            return { index: Math.max(0, Math.min(lines.length, preferredIndex)), oldLines: [] };
        }

        const firstMeaningfulNeedleLine = needle.find(line => !isBlankPatchLine(line)) || '';

        const starts = [];
        const addStart = index => {
            const clamped = Math.max(0, Math.min(lines.length - 1, index));
            if (firstMeaningfulNeedleLine && !lineEqualsFlexible(lines[clamped], firstMeaningfulNeedleLine)) return;
            if (!starts.includes(clamped)) starts.push(clamped);
        };

        const windowSize = 12;
        for (let i = preferredIndex - windowSize; i <= preferredIndex + windowSize; i += 1) {
            if (i >= 0 && i < lines.length) addStart(i);
        }
        for (let i = 0; i < lines.length; i += 1) addStart(i);

        for (const start of starts) {
            const matched = matchLineSequenceAllowingExtraBlanks(lines, needle, start);
            if (matched) return matched;
        }
        return null;
    }

    function isUsefulDiffAnchorLine(line) {
        const text = String(line || '').trim();
        if (text.length < 8) return false;
        if (/^[{}()[\];,.:]+$/.test(text)) return false;
        if (/^(?:<\/?div>?|<\/?span>?|<\/?p>?)$/i.test(text)) return false;
        return /[A-Za-z0-9_$#.'"-]/.test(text);
    }

    function analyzeHunkApplicability(lines, hunk, preferredIndex) {
        const oldLinesRaw = hunkOldLines(hunk);
        const newLinesRaw = hunkNewLines(hunk);
        const oldLinesRepaired = repairMarkdownEscapedLines(oldLinesRaw);
        const newLinesRepaired = repairMarkdownEscapedLines(newLinesRaw);
        const candidateLines = uniqueList(
            oldLinesRepaired
                .concat(newLinesRepaired)
                .filter(isUsefulDiffAnchorLine)
        );
        const matched = [];
        const missing = [];
        for (const candidate of candidateLines) {
            const indexes = findLineIndexesFlexible(lines, candidate);
            const item = {
                text: candidate,
                matchCount: indexes.length,
                nearestLine: indexes.length ? nearestIndex(indexes, preferredIndex) + 1 : null
            };
            if (indexes.length) matched.push(item);
            else missing.push(item);
        }

        const oldDistinctive = uniqueList(oldLinesRepaired.filter(isUsefulDiffAnchorLine));
        const newDistinctive = uniqueList(newLinesRepaired.filter(isUsefulDiffAnchorLine));
        const oldMatched = oldDistinctive.filter(line => findLineIndexesFlexible(lines, line).length);
        const newMatched = newDistinctive.filter(line => findLineIndexesFlexible(lines, line).length);
        const totalDistinctive = Math.max(1, candidateLines.length);
        const matchRatio = matched.length / totalDistinctive;

        let diagnosis = 'Hunk context was not found in the current file.';
        if (matchRatio === 0) {
            diagnosis = 'None of the hunk anchor lines exist in the current file. This diff likely targets a different file, a different app, or an older generated version.';
        } else if (!oldMatched.length && newMatched.length) {
            diagnosis = 'The hunk replacement text appears to already exist, but the expected old text does not. This may be an already-applied or partially-applied diff.';
        } else if (oldMatched.length && oldMatched.length < oldDistinctive.length) {
            diagnosis = 'Only part of the expected old context exists. This diff likely targets a stale version or a previous hunk changed/removes needed anchors.';
        }

        return {
            diagnosis,
            matchRatio,
            distinctiveAnchorCount: candidateLines.length,
            matchedAnchorCount: matched.length,
            oldDistinctiveCount: oldDistinctive.length,
            oldMatchedCount: oldMatched.length,
            newDistinctiveCount: newDistinctive.length,
            newMatchedCount: newMatched.length,
            matchedAnchors: matched.slice(0, 20),
            missingAnchors: missing.slice(0, 20)
        };
    }

    function findInsertionPointFromContext(lines, hunk, preferredIndex, repairMarkdownEscapes = false) {
        const fallback = buildInsertionFallback(hunk, repairMarkdownEscapes);
        if (!(fallback && fallback.additions.length)) return null;

        if (fallback.after.length) {
            const afterPreferred = Math.max(0, preferredIndex + fallback.before.length);
            const afterIndex = findLineSequence(lines, fallback.after, afterPreferred);
            if (afterIndex >= 0) {
                return {
                    index: afterIndex,
                    oldLines: [],
                    newLines: fallback.additions
                };
            }
        }

        const meaningfulAfter = fallback.after
            .map((text, idx) => ({ text, idx }))
            .filter(item => String(item.text || '').trim());
        if (meaningfulAfter.length) {
            const firstAfter = meaningfulAfter[0];
            const afterIndex = findLineSequence(lines, [firstAfter.text], Math.max(0, preferredIndex + fallback.before.length));
            if (afterIndex >= 0) {
                return {
                    index: afterIndex,
                    oldLines: [],
                    newLines: fallback.additions
                };
            }
        }

        if (fallback.before.length) {
            const beforeIndex = findLineSequence(lines, fallback.before, preferredIndex);
            if (beforeIndex >= 0) {
                return {
                    index: beforeIndex + fallback.before.length,
                    oldLines: [],
                    newLines: fallback.additions
                };
            }
        }

        const meaningfulBefore = fallback.before
            .map((text, idx) => ({ text, idx }))
            .filter(item => String(item.text || '').trim());
        if (meaningfulBefore.length) {
            const lastBefore = meaningfulBefore[meaningfulBefore.length - 1];
            const beforeIndex = findLineSequence(lines, [lastBefore.text], preferredIndex + lastBefore.idx);
            if (beforeIndex >= 0) {
                return {
                    index: beforeIndex + 1,
                    oldLines: [],
                    newLines: fallback.additions
                };
            }
        }

        return null;
    }

    function meaningfulAnchorLines(anchorLines) {
        return (anchorLines || [])
            .map((text, idx) => ({ text, idx }))
            .filter(item => String(item.text || '').trim());
    }

    function countLineSequenceMatches(lines, needle, maxCount = 3) {
        if (!needle.length) return 0;
        let count = 0;
        const trimEnd = value => String(value || '').replace(/[ \t]+$/g, '');
        for (let i = 0; i <= lines.length - needle.length; i += 1) {
            if (arraysMatchAt(lines, needle, i) || arraysMatchAt(lines, needle, i, trimEnd)) {
                count += 1;
                if (count >= maxCount) return count;
            }
        }
        return count;
    }

    function findLineSequenceAfter(lines, needle, minIndex, preferredIndex) {
        if (!needle.length) return Math.max(0, Math.min(lines.length, preferredIndex));
        const maxIndex = lines.length - needle.length;
        if (maxIndex < minIndex) return -1;

        const clampedPreferred = Math.max(minIndex, Math.min(maxIndex, preferredIndex));
        if (arraysMatchAt(lines, needle, clampedPreferred)) return clampedPreferred;

        const windowSize = 24;
        const start = Math.max(minIndex, clampedPreferred - windowSize);
        const end = Math.min(maxIndex, clampedPreferred + windowSize);
        for (let i = start; i <= end; i += 1) {
            if (i === clampedPreferred) continue;
            if (arraysMatchAt(lines, needle, i)) return i;
        }

        for (let i = minIndex; i <= maxIndex; i += 1) {
            if (i >= start && i <= end) continue;
            if (arraysMatchAt(lines, needle, i)) return i;
        }

        const trimEnd = value => String(value || '').replace(/[ \t]+$/g, '');
        for (let i = minIndex; i <= maxIndex; i += 1) {
            if (arraysMatchAt(lines, needle, i, trimEnd)) return i;
        }

        const trimAll = value => String(value || '').trim();
        for (let i = minIndex; i <= maxIndex; i += 1) {
            if (arraysMatchAt(lines, needle, i, trimAll)) return i;
        }

        return -1;
    }

    function findStableAnchorBefore(lines, anchorLines, preferredIndex) {
        if (!anchorLines.length) return null;

        const fullIndex = findLineSequence(lines, anchorLines, preferredIndex);
        if (fullIndex >= 0) {
            const isUnique = countLineSequenceMatches(lines, anchorLines, 2) === 1;
            return {
                index: fullIndex + anchorLines.length,
                strength: anchorLines.length >= 3 ? 3 : (isUnique ? 2 : 1)
            };
        }

        const meaningful = meaningfulAnchorLines(anchorLines);
        if (!meaningful.length) return null;
        const last = meaningful[meaningful.length - 1];
        const anchorIndex = findLineSequence(lines, [last.text], preferredIndex + last.idx);
        if (anchorIndex < 0) return null;

        return {
            index: anchorIndex + 1,
            strength: countLineSequenceMatches(lines, [last.text], 2) === 1 ? 2 : 1
        };
    }

    function findStableAnchorAfter(lines, anchorLines, minIndex, preferredIndex) {
        if (!anchorLines.length) return null;

        const fullIndex = findLineSequenceAfter(lines, anchorLines, minIndex, preferredIndex);
        if (fullIndex >= 0) {
            const isUnique = countLineSequenceMatches(lines, anchorLines, 2) === 1;
            return {
                index: fullIndex,
                strength: anchorLines.length >= 3 ? 3 : (isUnique ? 2 : 1)
            };
        }

        const meaningful = meaningfulAnchorLines(anchorLines);
        if (!meaningful.length) return null;
        const first = meaningful[0];
        const anchorIndex = findLineSequenceAfter(lines, [first.text], minIndex, preferredIndex + first.idx);
        if (anchorIndex < 0) return null;

        return {
            index: anchorIndex,
            strength: countLineSequenceMatches(lines, [first.text], 2) === 1 ? 2 : 1
        };
    }

    function hunkChangeSegments(hunk, repairMarkdownEscapes = false) {
        const hunkLines = Array.isArray(hunk && hunk.lines) ? hunk.lines : [];
        const mapText = line => {
            const text = String(line && line.text || '');
            return repairMarkdownEscapes ? repairMarkdownEscapedDiffLine(text) : text;
        };
        const segments = [];
        let i = 0;

        while (i < hunkLines.length) {
            while (i < hunkLines.length && hunkLines[i] && hunkLines[i].type === 'context') i += 1;
            if (i >= hunkLines.length) break;

            const start = i;
            while (i < hunkLines.length && hunkLines[i] && hunkLines[i].type !== 'context') i += 1;
            const end = i - 1;

            let beforeStart = start - 1;
            while (beforeStart >= 0 && hunkLines[beforeStart] && hunkLines[beforeStart].type === 'context') beforeStart -= 1;
            beforeStart += 1;

            let afterEnd = end + 1;
            while (afterEnd < hunkLines.length && hunkLines[afterEnd] && hunkLines[afterEnd].type === 'context') afterEnd += 1;

            const changed = hunkLines.slice(start, end + 1);
            const oldLines = changed.filter(line => line && line.type === 'remove').map(mapText);
            const newLines = changed.filter(line => line && line.type === 'add').map(mapText);
            if (oldLines.join('\n') === newLines.join('\n')) continue;

            segments.push({
                before: hunkLines.slice(beforeStart, start).map(mapText),
                after: hunkLines.slice(end + 1, afterEnd).map(mapText),
                oldLines,
                newLines,
                markdownDamaged: changed.some(line => line && line.markdownListMarker),
                score: oldLines.length + newLines.length
            });
        }

        return segments;
    }

    function findAnchoredChangeSegment(lines, hunk, preferredIndex, repairMarkdownEscapes = false) {
        const segments = hunkChangeSegments(hunk, repairMarkdownEscapes)
            .filter(segment => segment.score >= 8 && meaningfulAnchorLines(segment.before).length && meaningfulAnchorLines(segment.after).length)
            .sort((a, b) => b.score - a.score);

        for (const segment of segments) {
            const before = findStableAnchorBefore(lines, segment.before, preferredIndex);
            if (!(before && before.strength >= 2)) continue;

            const expectedOldLength = Math.max(0, segment.oldLines.length);
            const afterPreferred = before.index + expectedOldLength;
            const after = findStableAnchorAfter(lines, segment.after, before.index, afterPreferred);
            if (!(after && after.strength >= 2)) continue;
            if (after.index < before.index) continue;

            const regionLength = after.index - before.index;
            const maxRegionLength = Math.max(expectedOldLength * 3 + 80, expectedOldLength + 160, 240);
            if (regionLength > maxRegionLength) continue;

            return {
                index: before.index,
                oldLines: lines.slice(before.index, after.index),
                newLines: segment.newLines
            };
        }

        return null;
    }

    function isDistinctivePatchLine(line) {
        const text = String(line || '').trim();
        if (text.length < 6) return false;
        if (/^[{}()[\];,.:]+$/.test(text)) return false;
        if (/^<\/?div>?$/i.test(text)) return false;
        return /[A-Za-z0-9#"'_-]/.test(text);
    }

    function lineEqualsFlexible(actual, expected) {
        const a = String(actual || '');
        const e = String(expected || '');
        return a === e || a.replace(/[ \t]+$/g, '') === e.replace(/[ \t]+$/g, '') || a.trim() === e.trim();
    }

    function findLineIndexesFlexible(lines, needle, minIndex = 0, maxIndex = lines.length - 1) {
        const out = [];
        const start = Math.max(0, minIndex);
        const end = Math.min(lines.length - 1, maxIndex);
        for (let i = start; i <= end; i += 1) {
            if (lineEqualsFlexible(lines[i], needle)) out.push(i);
        }
        return out;
    }

    function nearestIndex(indexes, preferredIndex) {
        if (!indexes.length) return -1;
        let best = indexes[0];
        let bestDistance = Math.abs(best - preferredIndex);
        for (const index of indexes.slice(1)) {
            const distance = Math.abs(index - preferredIndex);
            if (distance < bestDistance) {
                best = index;
                bestDistance = distance;
            }
        }
        return best;
    }

    function resolveSegmentBounds(lines, segment, preferredIndex) {
        const before = segment && segment.before ? findStableAnchorBefore(lines, segment.before, preferredIndex) : null;
        const lower = before && before.strength >= 2 ? before.index : 0;
        const expectedOldLength = Math.max(0, segment && segment.oldLines ? segment.oldLines.length : 0);
        const afterPreferred = Math.max(lower, preferredIndex + expectedOldLength);
        const after = segment && segment.after ? findStableAnchorAfter(lines, segment.after, lower, afterPreferred) : null;
        const upper = after && after.strength >= 2 ? Math.max(lower, after.index - 1) : lines.length - 1;
        return { lower, upper, bounded: !!(before && before.strength >= 2 && after && after.strength >= 2) };
    }

    function findDistinctiveLineForReplacement(lines, oldLine, newLine, preferredIndex, bounds) {
        if (!isDistinctivePatchLine(oldLine) && !isDistinctivePatchLine(newLine)) return null;

        const lower = bounds && Number.isFinite(bounds.lower) ? bounds.lower : 0;
        const upper = bounds && Number.isFinite(bounds.upper) ? bounds.upper : lines.length - 1;
        const oldInBounds = findLineIndexesFlexible(lines, oldLine, lower, upper);
        if (oldInBounds.length === 1) return { status: 'replace', index: oldInBounds[0] };
        if (oldInBounds.length > 1 && bounds && bounds.bounded) {
            return { status: 'replace', index: nearestIndex(oldInBounds, preferredIndex) };
        }

        const newInBounds = findLineIndexesFlexible(lines, newLine, lower, upper);
        if (newInBounds.length === 1) return { status: 'already', index: newInBounds[0] };
        if (newInBounds.length > 1 && bounds && bounds.bounded) {
            return { status: 'already', index: nearestIndex(newInBounds, preferredIndex) };
        }

        const oldGlobal = findLineIndexesFlexible(lines, oldLine);
        if (oldGlobal.length === 1) return { status: 'replace', index: oldGlobal[0] };

        const newGlobal = findLineIndexesFlexible(lines, newLine);
        if (newGlobal.length === 1) return { status: 'already', index: newGlobal[0] };

        return null;
    }

    function applyPairedLineReplacementSegment(lines, segment, preferredIndex) {
        if (!(segment && segment.oldLines && segment.newLines)) return null;
        if (!segment.oldLines.length || segment.oldLines.length !== segment.newLines.length) return null;

        const working = lines.slice();
        const replacements = [];
        let cursor = preferredIndex;
        let changed = false;

        for (let i = 0; i < segment.oldLines.length; i += 1) {
            const oldLine = segment.oldLines[i];
            const newLine = segment.newLines[i];
            if (oldLine === newLine) continue;

            const bounds = resolveSegmentBounds(working, segment, cursor);
            const resolved = findDistinctiveLineForReplacement(working, oldLine, newLine, cursor, bounds);
            if (!resolved) return null;

            replacements.push({
                ...resolved,
                oldLine,
                newLine
            });
            cursor = Math.max(0, resolved.index + 1);
        }

        replacements
            .filter(item => item.status === 'replace')
            .sort((a, b) => b.index - a.index)
            .forEach(item => {
                working.splice(item.index, 1, item.newLine);
                changed = true;
            });

        return {
            lines: working,
            changed,
            resolved: replacements.length
        };
    }

    function applyHunkByChangedSegments(lines, hunk, preferredIndex, repairMarkdownEscapes = false) {
        const segments = hunkChangeSegments(hunk, repairMarkdownEscapes);
        if (!segments.length) return null;
        if (!lines.length) return null;

        let working = lines.slice();
        let cursor = preferredIndex;
        let changed = false;
        let resolved = 0;
        const desiredLines = hunkNewLines(hunk).map(text => repairMarkdownEscapes ? repairMarkdownEscapedDiffLine(text) : text);

        for (const segment of segments) {
            if (!segment.oldLines.length && segment.newLines.length) {
                const existingIndex = findLineSequence(working, segment.newLines, cursor);
                if (existingIndex >= 0) {
                    cursor = existingIndex + segment.newLines.length;
                    resolved += 1;
                    continue;
                }

                const insertionHunk = { lines: [] };
                for (const text of segment.before) insertionHunk.lines.push({ type: 'context', text });
                for (const text of segment.newLines) insertionHunk.lines.push({ type: 'add', text });
                for (const text of segment.after) insertionHunk.lines.push({ type: 'context', text });

                const insertion = findInsertionPointFromContext(working, insertionHunk, cursor, false);
                if (!insertion) return null;

                working.splice(insertion.index, insertion.oldLines.length, ...insertion.newLines);
                cursor = insertion.index + insertion.newLines.length;
                changed = true;
                resolved += 1;
                continue;
            }

            let index = findLineSequence(working, segment.oldLines, cursor);
            if (index >= 0) {
                working.splice(index, segment.oldLines.length, ...segment.newLines);
                cursor = index + segment.newLines.length;
                changed = true;
                resolved += 1;
                continue;
            }

            if (segment.newLines.length) {
                const newIndex = findLineSequence(working, segment.newLines, cursor);
                if (newIndex >= 0) {
                    cursor = newIndex + segment.newLines.length;
                    resolved += 1;
                    continue;
                }
            } else {
                const bounds = resolveSegmentBounds(working, segment, cursor);
                const removed = segment.oldLines.every(oldLine => !findLineIndexesFlexible(working, oldLine, bounds.lower, bounds.upper).length);
                if (removed) {
                    resolved += 1;
                    continue;
                }

                const oldDistinctive = segment.oldLines.filter(isDistinctivePatchLine);
                const absentDistinctive = oldDistinctive.filter(oldLine => !findLineIndexesFlexible(working, oldLine, bounds.lower, bounds.upper).length);
                const blockingDistinctive = oldDistinctive.filter(oldLine => (
                    findLineIndexesFlexible(working, oldLine, bounds.lower, bounds.upper).length
                    && !desiredLines.some(newLine => lineEqualsFlexible(newLine, oldLine))
                ));
                if (absentDistinctive.length && !blockingDistinctive.length) {
                    resolved += 1;
                    continue;
                }
                if (segment.markdownDamaged && findLineSequence(working, segment.oldLines, cursor) < 0) {
                    resolved += 1;
                    continue;
                }
            }

            const paired = applyPairedLineReplacementSegment(working, segment, cursor);
            if (paired) {
                working = paired.lines;
                changed = changed || paired.changed;
                resolved += Math.max(1, paired.resolved);
                continue;
            }

            const pseudoHunk = { lines: [] };
            for (const text of segment.before) pseudoHunk.lines.push({ type: 'context', text });
            for (const text of segment.oldLines) pseudoHunk.lines.push({ type: 'remove', text });
            for (const text of segment.newLines) pseudoHunk.lines.push({ type: 'add', text });
            for (const text of segment.after) pseudoHunk.lines.push({ type: 'context', text });

            const anchored = findAnchoredChangeSegment(working, pseudoHunk, cursor, false);
            if (anchored) {
                working.splice(anchored.index, anchored.oldLines.length, ...anchored.newLines);
                cursor = anchored.index + anchored.newLines.length;
                changed = true;
                resolved += 1;
                continue;
            }

            return null;
        }

        return {
            lines: working,
            changed,
            resolved
        };
    }

    function splitPatchLines(content) {
        const text = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        return {
            lines: text.split('\n'),
            hadFinalNewline: text.endsWith('\n')
        };
    }

    function joinPatchLines(lines, hadFinalNewline) {
        let out = lines.join('\n');
        if (hadFinalNewline && !out.endsWith('\n')) out += '\n';
        return out;
    }

    function makeSimpleHash(text) {
        const value = String(text || '');
        let hash = 2166136261;
        for (let i = 0; i < value.length; i += 1) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function diffDebugPreviewLines(lines, index, radius = 8) {
        const arr = Array.isArray(lines) ? lines : [];
        const center = Number.isFinite(index) ? index : 0;
        const start = Math.max(0, center - radius);
        const end = Math.min(arr.length, center + radius + 1);
        return arr.slice(start, end).map((text, offset) => ({
            line: start + offset + 1,
            text: String(text || '')
        }));
    }

    function summarizeDiffHunkForDebug(hunk, index) {
        const oldLinesRaw = hunkOldLines(hunk);
        const newLinesRaw = hunkNewLines(hunk);
        const oldLinesRepaired = repairMarkdownEscapedLines(oldLinesRaw);
        const newLinesRepaired = repairMarkdownEscapedLines(newLinesRaw);
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
    }

    function createDiffDebugTrace(content, diffText, meta, hunks) {
        const sourceText = String(content || '');
        const rawDiff = String(diffText || '');
        const parsed = splitPatchLines(sourceText);
        return {
            id: ++state.diffDebugSeq,
            createdAt: new Date().toISOString(),
            source: 'aiResponseImporter',
            path: meta && meta.path ? String(meta.path) : '',
            status: 'running',
            originalContent: sourceText,
            originalContentHash: makeSimpleHash(sourceText),
            originalLineCount: parsed.lines.length === 1 && parsed.lines[0] === '' && !parsed.hadFinalNewline ? 0 : parsed.lines.length,
            diffText: rawDiff,
            diffHash: makeSimpleHash(rawDiff),
            extractedDiffText: normalizeDiffTransportText(rawDiff),
            extractedDiffHash: makeSimpleHash(normalizeDiffTransportText(rawDiff)),
            analysis: meta && meta.analysis ? meta.analysis : null,
            parsedHunks: (hunks || []).map((hunk, index) => summarizeDiffHunkForDebug(hunk, index)),
            logs: [],
            result: null,
            finalContent: '',
            finalContentHash: '',
            failureContext: null
        };
    }

    function recordDiffDebugLog(trace, message, data) {
        if (!trace) return;
        const entry = {
            step: trace.logs.length + 1,
            message: String(message || ''),
            data: data || null
        };
        trace.logs.push(entry);
        try {
            console.log(`[Forge AI Import diff debug #${trace.id}] ${entry.message}`, entry.data || '');
        } catch (_) {
            // no-op
        }
    }

    function appendMarkdownFence(lines, language, text) {
        const value = String(text || '');
        const matches = value.match(/`+/g) || [];
        const longest = matches.reduce((max, run) => Math.max(max, run.length), 0);
        const fence = '`'.repeat(Math.max(3, longest + 1));
        lines.push(fence + (language ? String(language) : ''));
        lines.push(value);
        lines.push(fence);
    }

    function formatLastDiffDebugPackage() {
        const trace = state.lastDiffDebugPackage || (root.aiAgent && root.aiAgent._lastDiffDebugPackage) || null;
        if (!trace) {
            return [
                '# Forge Unified Diff Debug Package',
                '',
                'No diff debug package has been captured yet.',
                'Paste/analyze/apply a unified diff, then press Ctrl+Shift+Alt+D again.'
            ].join('\n');
        }

        const lines = [];
        lines.push('# Forge Unified Diff Debug Package');
        lines.push('');
        lines.push('Use this package to debug Forge unified-diff parsing and application failures.');
        lines.push('');
        lines.push('## Metadata');
        appendMarkdownFence(lines, 'json', JSON.stringify({
            id: trace.id,
            createdAt: trace.createdAt,
            source: trace.source || 'unknown',
            path: trace.path,
            status: trace.status,
            originalLineCount: trace.originalLineCount,
            originalContentHash: trace.originalContentHash,
            diffHash: trace.diffHash,
            extractedDiffHash: trace.extractedDiffHash,
            parsedHunkCount: Array.isArray(trace.parsedHunks) ? trace.parsedHunks.length : 0,
            result: trace.result
        }, null, 2));
        lines.push('');
        lines.push('## Diff Analysis');
        appendMarkdownFence(lines, 'json', JSON.stringify({
            analysis: trace.analysis,
            parsedHunks: trace.parsedHunks,
            logs: trace.logs,
            failureContext: trace.failureContext
        }, null, 2));
        lines.push('');
        lines.push('## Code Being Edited');
        appendMarkdownFence(lines, '', trace.originalContent);
        lines.push('');
        lines.push('## Raw Diff Input');
        appendMarkdownFence(lines, 'diff', trace.diffText);
        lines.push('');
        lines.push('## Extracted Diff Input');
        appendMarkdownFence(lines, 'diff', trace.extractedDiffText);
        lines.push('');
        if (trace.finalContent) {
            lines.push('## Final Or Partial Content After Applying Hunks');
            appendMarkdownFence(lines, '', trace.finalContent);
            lines.push('');
        }
        lines.push('## Debugging Prompt');
        lines.push('The Forge AI response importer failed or behaved unexpectedly while applying a unified diff. Analyze the original code, raw diff, parsed hunk analysis, and per-hunk logs. Identify why a later chunk fails after earlier chunks are applied, then propose a robust parser/apply fix.');
        return lines.join('\n');
    }

    async function copyLastDiffDebugPackage() {
        const copied = await copyTextToClipboard(formatLastDiffDebugPackage());
        try {
            if (typeof addAIChatMessage === 'function') {
                addAIChatMessage('system', copied ? 'Copied AI response diff debug package to clipboard.' : 'Could not copy AI response diff debug package.');
            }
        } catch (_) {
            // no-op
        }
        return copied;
    }

    function applyUnifiedPatchToContent(content, patch, options = {}) {
        const parsed = splitPatchLines(content);
        const lines = parsed.lines;
        const hunks = Array.isArray(patch && patch.hunks) ? patch.hunks : [];
        const trace = createDiffDebugTrace(content, options.sourceText || '', {
            path: options.path || patch && patch.path || '',
            analysis: options.analysis || null
        }, hunks);
        state.lastDiffDebugPackage = trace;
        recordDiffDebugLog(trace, 'Parsed importer unified diff input.', {
            path: trace.path || null,
            hunkCount: hunks.length,
            originalLineCount: trace.originalLineCount
        });
        if (!hunks.length) {
            trace.status = 'error';
            trace.result = { ok: false, reason: 'Unified diff did not contain any hunks.' };
            return { ok: false, reason: 'Unified diff did not contain any hunks.' };
        }

        // Empty files split to ['']; treat that as zero editable lines for insertion-only patches.
        if (lines.length === 1 && lines[0] === '' && !parsed.hadFinalNewline) {
            lines.length = 0;
        }

        let offset = 0;
        let applied = 0;
        for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
            const rawHunk = hunks[hunkIndex];
            const oldStart = Number.isFinite(rawHunk.oldStart) ? rawHunk.oldStart : 1;
            const preferredIndex = Math.max(0, oldStart - 1 + offset);
            const ambiguousRepair = repairAmbiguousIndentedMarkerHunk(rawHunk, lines, preferredIndex);
            const hunk = ambiguousRepair ? ambiguousRepair.hunk : rawHunk;
            let oldLines = hunkOldLines(hunk);
            let newLines = hunkNewLines(hunk);
            if (ambiguousRepair) {
                recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} repaired AI Studio-style indented marker ambiguity.`, {
                    reclassifiedRemoveLinesAsAdditions: ambiguousRepair.reclassified,
                    before: ambiguousRepair.before,
                    after: ambiguousRepair.after
                });
            }
            recordDiffDebugLog(trace, `Starting hunk ${hunkIndex + 1}/${hunks.length}.`, {
                header: hunk.header || '',
                oldStart,
                offset,
                preferredIndex,
                currentLineCount: lines.length,
                oldLineCount: oldLines.length,
                newLineCount: newLines.length,
                contextWindow: diffDebugPreviewLines(lines, preferredIndex, 6)
            });
            let index = findLineSequence(lines, oldLines, preferredIndex);
            if (index >= 0) {
                recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} matched direct context.`, { index, line: index + 1 });
            }
            if (index < 0) {
                const repairedOldLines = repairMarkdownEscapedLines(oldLines);
                const repairedNewLines = repairMarkdownEscapedLines(newLines);
                const changedByRepair = repairedOldLines.join('\n') !== oldLines.join('\n')
                    || repairedNewLines.join('\n') !== newLines.join('\n');
                recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} direct match failed; checking markdown-escape repair.`, {
                    changedByRepair,
                    repairedOldLineCount: repairedOldLines.length,
                    repairedNewLineCount: repairedNewLines.length
                });
                if (changedByRepair) {
                    index = findLineSequence(lines, repairedOldLines, preferredIndex);
                    if (index >= 0) {
                        oldLines = repairedOldLines;
                        newLines = repairedNewLines;
                        recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} matched after markdown-escape repair.`, { index, line: index + 1 });
                    } else {
                        recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} did not match after markdown-escape repair.`, null);
                    }
                }
            }
            if (index < 0) {
                recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} trying blank-tolerant sequence match.`, null);
                const blankFlexible = findLineSequenceAllowingExtraBlanks(lines, oldLines, preferredIndex);
                if (blankFlexible) {
                    index = blankFlexible.index;
                    oldLines = blankFlexible.oldLines;
                    recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} matched with blank-tolerant sequence match.`, {
                        index,
                        line: index + 1,
                        oldLineCount: oldLines.length,
                        skippedBlanks: blankFlexible.skippedBlanks || 0
                    });
                }
            }
            if (index < 0) {
                recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} trying insertion fallback.`, null);
                const insertionFallback = findInsertionPointFromContext(lines, hunk, preferredIndex, false)
                    || findInsertionPointFromContext(lines, hunk, preferredIndex, true);
                if (insertionFallback) {
                    index = insertionFallback.index;
                    oldLines = insertionFallback.oldLines;
                    newLines = insertionFallback.newLines;
                    recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} matched insertion fallback.`, {
                        index,
                        oldLineCount: oldLines.length,
                        newLineCount: newLines.length
                    });
                }
            }
            if (index < 0) {
                recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} trying anchored segment fallback.`, null);
                const anchoredSegmentFallback = findAnchoredChangeSegment(lines, hunk, preferredIndex, false)
                    || findAnchoredChangeSegment(lines, hunk, preferredIndex, true);
                if (anchoredSegmentFallback) {
                    index = anchoredSegmentFallback.index;
                    oldLines = anchoredSegmentFallback.oldLines;
                    newLines = anchoredSegmentFallback.newLines;
                    recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} matched anchored segment fallback.`, {
                        index,
                        oldLineCount: oldLines.length,
                        newLineCount: newLines.length
                    });
                }
            }
            if (index < 0) {
                recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} trying changed-segment fallback.`, {
                    rawSegments: hunkChangeSegments(hunk, false).map(segment => ({
                        beforeCount: segment.before.length,
                        oldCount: segment.oldLines.length,
                        newCount: segment.newLines.length,
                        afterCount: segment.after.length
                    })),
                    repairedSegments: hunkChangeSegments(hunk, true).map(segment => ({
                        beforeCount: segment.before.length,
                        oldCount: segment.oldLines.length,
                        newCount: segment.newLines.length,
                        afterCount: segment.after.length
                    }))
                });
                const segmentedFallback = applyHunkByChangedSegments(lines, hunk, preferredIndex, false)
                    || applyHunkByChangedSegments(lines, hunk, preferredIndex, true);
                if (segmentedFallback) {
                    const oldLength = lines.length;
                    lines.splice(0, lines.length, ...segmentedFallback.lines);
                    offset += lines.length - oldLength;
                    applied += 1;
                    recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} applied with changed-segment fallback.`, {
                        oldLineCount: oldLength,
                        newLineCount: lines.length,
                        offset,
                        applied
                    });
                    continue;
                }
                recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} changed-segment fallback failed.`, null);
            }
            if (index < 0) {
                const applicability = analyzeHunkApplicability(lines, hunk, preferredIndex);
                trace.status = 'error';
                trace.finalContent = joinPatchLines(lines, parsed.hadFinalNewline);
                trace.finalContentHash = makeSimpleHash(trace.finalContent);
                trace.failureContext = {
                    failedHunk: hunkIndex + 1,
                    header: hunk.header || '',
                    preferredIndex,
                    appliedBeforeFailure: applied,
                    currentLineCount: lines.length,
                    applicability,
                    currentContentWindow: diffDebugPreviewLines(lines, preferredIndex, 14),
                    oldLinesRaw: hunkOldLines(hunk),
                    newLinesRaw: hunkNewLines(hunk),
                    oldLinesMarkdownRepaired: repairMarkdownEscapedLines(hunkOldLines(hunk)),
                    newLinesMarkdownRepaired: repairMarkdownEscapedLines(hunkNewLines(hunk))
                };
                const markerDamagePrefix = shouldRepairAmbiguousIndentedMarkerHunk(rawHunk)
                    ? 'This hunk appears to have AI Studio-style marker formatting damage and could not be repaired safely. '
                    : '';
                const reason = applicability && applicability.diagnosis
                    ? `${markerDamagePrefix}${applicability.diagnosis} (${hunk.header || 'unknown hunk'})`
                    : `${markerDamagePrefix}Diff hunk context not found (${hunk.header || 'unknown hunk'}).`;
                trace.result = {
                    ok: false,
                    reason,
                    applied,
                    total: hunks.length
                };
                return {
                    ok: false,
                    reason,
                    applied,
                    total: hunks.length
                };
            }
            lines.splice(index, oldLines.length, ...newLines);
            offset += newLines.length - oldLines.length;
            applied += 1;
            recordDiffDebugLog(trace, `Hunk ${hunkIndex + 1} applied by splice.`, {
                index,
                removedLineCount: oldLines.length,
                insertedLineCount: newLines.length,
                offset,
                currentLineCount: lines.length,
                applied
            });
        }

        const finalContent = joinPatchLines(lines, parsed.hadFinalNewline);
        trace.status = 'success';
        trace.finalContent = finalContent;
        trace.finalContentHash = makeSimpleHash(finalContent);
        trace.result = { ok: true, applied, total: hunks.length };
        recordDiffDebugLog(trace, 'Finished importer unified diff apply.', trace.result);
        return {
            ok: true,
            content: finalContent,
            applied,
            total: hunks.length
        };
    }

    function syncOpenEditorViews(path, content, options = {}) {
        const opts = {
            markSaved: false,
            entry: null,
            knownUuid: '',
            ...options
        };
        const editorApi = getEditorApi();
        if (!(editorApi && editorApi._meta)) return [];

        const uuids = getOpenUuidsByPath(path, opts.entry || null);

        // If path lookup missed the UUID we know is open, include it as a fallback
        if (opts.knownUuid && !uuids.includes(opts.knownUuid)) {
            uuids.push(opts.knownUuid);
        }

        for (const uuid of uuids) {
            try {
                if (typeof editorApi.setValue === 'function') {
                    editorApi.setValue(uuid, content);
                }
                const meta = editorApi._meta ? editorApi._meta[uuid] : null;
                if (opts.markSaved && meta) {
                    meta.text = String(content || '');
                    if (editorApi.dirtyFiles && typeof editorApi.dirtyFiles.delete === 'function') {
                        editorApi.dirtyFiles.delete(uuid);
                    }
                    if (typeof editorApi._setStatus === 'function') {
                        editorApi._setStatus(uuid, 'Saved', 'saved');
                    }
                }
            } catch (_) {
                // no-op
            }
        }
        return uuids;
    }

    function runJavaScriptSyntaxCheck(code, label) {
        const source = String(code || '');
        if (!source.trim()) return null;
        if (state.functionSyntaxCheckBlockedByCsp) return null;
        try {
            // This parses without executing. It catches the syntax failures that would stop normal scripts.
            new Function(source);
            return null;
        } catch (err) {
            if (isEvalBlockedByCsp(err)) {
                state.functionSyntaxCheckBlockedByCsp = true;
                if (!state.functionSyntaxCheckWarningShown) {
                    state.functionSyntaxCheckWarningShown = true;
                    debugWarn('JavaScript syntax validation disabled because shipped CSP blocks Function()-based parsing.');
                }
                return null;
            }
            const msg = err && err.message ? err.message : String(err || 'Unknown syntax error');
            return `${label}: JavaScript syntax error: ${msg}`;
        }
    }

    function isEvalBlockedByCsp(error) {
        const message = String(error && error.message ? error.message : error || '').toLowerCase();
        const name = String(error && error.name ? error.name : '').toLowerCase();
        return name === 'evalerror'
            || message.includes('unsafe-eval')
            || message.includes('evaluating a string as javascript violates')
            || message.includes('refused to evaluate a string as javascript')
            || (message.includes('content security policy') && message.includes('script-src'));
    }

    function getScriptAttribute(attrs, name) {
        const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
        const match = String(attrs || '').match(pattern);
        return match ? String(match[1] || match[2] || match[3] || '').trim() : '';
    }

    function shouldValidateInlineScript(attrs) {
        const attrText = String(attrs || '');
        if (/\bsrc\s*=/i.test(attrText)) return false;
        const type = getScriptAttribute(attrText, 'type').toLowerCase();
        if (!type) return true;
        return /^(?:text\/javascript|application\/javascript)$/i.test(type);
    }

    function lineNumberAtIndex(text, index) {
        return String(text || '').slice(0, Math.max(0, index)).split('\n').length;
    }

    function validateHtmlInlineScripts(path, content) {
        const text = String(content || '');
        const scriptRe = new RegExp('<' + 'script\\b([^>]*)>([\\s\\S]*?)<' + '\\/script>', 'gi');
        let match;
        while ((match = scriptRe.exec(text)) !== null) {
            const attrs = match[1] || '';
            if (!shouldValidateInlineScript(attrs)) continue;
            const code = match[2] || '';
            const line = lineNumberAtIndex(text, match.index);
            const error = runJavaScriptSyntaxCheck(code, `${path} inline <${'script'}> near line ${line}`);
            if (error) return error;
        }
        return null;
    }

    function validateContentBeforeWrite(path, content) {
        const ext = getExtension(path);
        if (ext === 'js') {
            return runJavaScriptSyntaxCheck(content, path);
        }
        if (ext === 'json') {
            try {
                JSON.parse(String(content || ''));
                return null;
            } catch (err) {
                return `${path}: JSON syntax error: ${err && err.message ? err.message : err}`;
            }
        }
        if (ext === 'html' || ext === 'htm') {
            return validateHtmlInlineScripts(path, content);
        }
        return null;
    }

    async function applyPlan(plan, options = {}) {
        const opts = {
            createMissing: true,
            saveImmediately: true,
            ...options
        };

        const results = {
            created: [],
            updated: [],
            saved: [],
            skipped: [],
            errors: [],
            indexHtmlTouched: false,
            htmlTouched: false
        };

        const loadFolderApi = getLoadFolderApi();
        const editorApi = getEditorApi();
        if (!(loadFolderApi && editorApi)) {
            results.errors.push('Forge file APIs are not available.');
            return results;
        }

        for (const item of plan) {
            const targetPath = normalizeProjectPath(item.path);
            if (!targetPath) {
                results.skipped.push('Skipped an item with empty target path.');
                continue;
            }
            if (isProtectedPath(targetPath)) {
                results.skipped.push(`Skipped protected path ${targetPath}.`);
                continue;
            }

            try {
                let entry = findEntryByPath(targetPath);
                let createdThisItem = false;
                if (!entry) {
                    if (item.patch && item.patch.action !== 'create') {
                        results.skipped.push(`Skipped missing file ${targetPath}; the pasted diff expected it to already exist.`);
                        continue;
                    }
                    if (!opts.createMissing) {
                        results.skipped.push(`Skipped missing file ${targetPath} (create missing disabled).`);
                        continue;
                    }

                    const segments = targetPath.split('/');
                    const fileName = segments.pop();
                    const directoryPath = segments;
                    const created = await loadFolderApi.createNewFile(fileName, directoryPath);
                    entry = findEntryByPath(targetPath) || created || null;
                    if (!entry) {
                        throw new Error('Could not create file handle.');
                    }
                    createdThisItem = true;
                }

                let wroteToDisk = false;

                let uuid = findOpenUuidByPath(targetPath, entry);
                if (!uuid) {
                    uuid = await ensureEditorUuidForPath(targetPath, entry);
                }

                let content;
                if (item.patch) {
                    const openText = readOpenEditorText(editorApi, uuid);
                    const baseContent = createdThisItem
                        ? ''
                        : (openText != null ? openText : await readEntryText(entry));
                    const patchResult = applyUnifiedPatchToContent(baseContent, item.patch, {
                        path: targetPath,
                        sourceText: options.sourceText || '',
                        analysis: options.analysis || null
                    });
                    if (!patchResult.ok) {
                        throw new Error((patchResult.reason || 'Could not apply unified diff.') +
                            (patchResult.applied ? ` Applied ${patchResult.applied}/${patchResult.total} hunks before stopping.` : ''));
                    }
                    content = String(patchResult.content || '');
                } else {
                    content = String(item.content || '');
                }

                const validationError = validateContentBeforeWrite(targetPath, content);
                if (validationError) {
                    throw new Error(`Refused to save invalid generated content. ${validationError}`);
                }

                if (uuid) {
                    syncOpenEditorViews(targetPath, content, { markSaved: false, entry, knownUuid: uuid });
                    if (opts.saveImmediately) {
                        if (typeof editorApi._writeDirect === 'function') {
                            await editorApi._writeDirect(uuid, content);
                            wroteToDisk = true;
                        } else if (typeof editorApi.saveCurrent === 'function') {
                            await editorApi.saveCurrent();
                            wroteToDisk = true;
                        }
                    }
                } else if (opts.saveImmediately) {
                    // Fallback: write directly when editor tab open/resolution fails.
                    await writeEntryDirect(entry, content);
                    wroteToDisk = true;
                } else {
                    throw new Error('Could not open file in editor.');
                }

                if (wroteToDisk) {
                    syncOpenEditorViews(targetPath, content, { markSaved: true, entry, knownUuid: uuid });
                }

                if (createdThisItem) {
                    results.created.push(targetPath);
                } else {
                    results.updated.push(targetPath);
                }

                if (wroteToDisk) {
                    results.saved.push(targetPath);
                }

                const ext = getExtension(targetPath);
                if (ext === 'html' || ext === 'htm') {
                    results.htmlTouched = true;
                    if (targetPath.toLowerCase().endsWith('index.html')) {
                        results.indexHtmlTouched = true;
                    }
                }
            } catch (err) {
                results.errors.push(`${targetPath}: ${err && err.message ? err.message : err}`);
            }
        }

        if (opts.saveImmediately && results.htmlTouched && typeof loadFolderApi.refreshFileTree === 'function') {
            loadFolderApi.refreshFileTree();
        }

        if (opts.saveImmediately && results.indexHtmlTouched) {
            try {
                document.dispatchEvent(new CustomEvent('wct:index-html-saved', {
                    detail: {
                        fileName: 'index.html',
                        source: 'ai-response-import'
                    }
                }));
            } catch (_) {
                // no-op
            }
        }

        // Force-reload every open editor tab whose file was written.
        // CM6 dispatch to hidden (or just-created) views does not always
        // re-render correctly, so we destroy and recreate each view with
        // the actual on-disk content — the same thing the user would do by
        // closing and reopening the tab.
        if (opts.saveImmediately && typeof editorApi.reloadTab === 'function') {
            const writtenPaths = [...results.created, ...results.updated];
            for (const writtenPath of writtenPaths) {
                try {
                    const openUuids = getOpenUuidsByPath(writtenPath);
                    for (const uuid of openUuids) {
                        await editorApi.reloadTab(uuid);
                    }
                } catch (_) {
                    // non-critical; user can still close/reopen manually
                }
            }
        }

        return results;
    }

    function getPendingEditTaskTitle() {
        const checkpointApi = getCheckpointApi();
        if (checkpointApi && typeof checkpointApi.getPendingPasteCheckpointTitle === 'function') {
            const title = String(checkpointApi.getPendingPasteCheckpointTitle() || '').trim();
            if (title) return title;
        }
        return '';
    }

    function buildAppliedSummaryTitle(analysis, results) {
        const pendingTitle = getPendingEditTaskTitle();
        if (pendingTitle) return pendingTitle;

        const touched = [
            ...((results && results.updated) || []),
            ...((results && results.created) || [])
        ].filter(Boolean);
        if (touched.length) {
            const preview = touched.slice(0, 3).join(', ');
            return `${preview}${touched.length > 3 ? `, +${touched.length - 3} more` : ''}`;
        }

        const plan = Array.isArray(analysis && analysis.plan) ? analysis.plan : [];
        if (plan.length) {
            const preview = plan.slice(0, 3).map(item => item && item.path).filter(Boolean).join(', ');
            if (preview) return `${preview}${plan.length > 3 ? `, +${plan.length - 3} more` : ''}`;
        }

        return 'changes';
    }

    async function createCheckpointAfterApply(analysis, results) {
        const changedCount = ((results && results.updated) || []).length + ((results && results.created) || []).length;
        if (!changedCount) {
            return { attempted: false, saved: false, message: '' };
        }

        const checkpointApi = getCheckpointApi();
        if (!(checkpointApi && (typeof checkpointApi.create === 'function' || typeof checkpointApi.createAutoCheckpoint === 'function'))) {
            return {
                attempted: true,
                saved: false,
                message: 'Could not create post-apply checkpoint because checkpointManager is unavailable.'
            };
        }

        const baseTitle = buildAppliedSummaryTitle(analysis, results);
        const prefix = ((results && results.errors && results.errors.length) ? 'After partial AI update: ' : 'After AI update: ');
        const description = `${prefix}${baseTitle}`.replace(/\s+/g, ' ').trim().slice(0, 180);

        try {
            const saved = typeof checkpointApi.createAutoCheckpoint === 'function'
                ? await checkpointApi.createAutoCheckpoint(description)
                : await checkpointApi.create(description);
            if (saved && typeof checkpointApi.clearPendingPasteCheckpoint === 'function') {
                checkpointApi.clearPendingPasteCheckpoint();
            }
            return {
                attempted: true,
                saved: !!saved,
                taskTitle: baseTitle,
                description,
                message: saved
                    ? `Checkpoint saved: ${description}`
                    : 'Post-apply checkpoint was not saved.'
            };
        } catch (err) {
            return {
                attempted: true,
                saved: false,
                taskTitle: baseTitle,
                description,
                message: `Could not create post-apply checkpoint: ${err && err.message ? err.message : err}`
            };
        }
    }

    function buildPostEditAnalysisPrompt(codebaseText) {
        const last = state.lastApplied || {};
        const task = String(last.task || getPendingEditTaskTitle() || 'Unknown edit task').trim();
        const results = last.results || {};
        const updated = Array.isArray(results.updated) ? results.updated : [];
        const created = Array.isArray(results.created) ? results.created : [];
        const saved = Array.isArray(results.saved) ? results.saved : [];
        const errors = Array.isArray(results.errors) ? results.errors : [];
        const skipped = Array.isArray(results.skipped) ? results.skipped : [];
        const checkpoint = last.checkpoint && last.checkpoint.saved
            ? last.checkpoint.description
            : '';

        return [
            'You are reviewing a codebase immediately after an AI-generated edit was applied by Forge.',
            '',
            'Edit task:',
            task || 'Unknown edit task',
            '',
            'Applied update summary:',
            `- Updated files: ${updated.length ? updated.join(', ') : 'none'}`,
            `- Created files: ${created.length ? created.join(', ') : 'none'}`,
            `- Saved files: ${saved.length ? saved.join(', ') : 'none'}`,
            `- Skipped items: ${skipped.length ? skipped.join(' | ') : 'none'}`,
            `- Apply errors: ${errors.length ? errors.join(' | ') : 'none'}`,
            checkpoint ? `- Post-apply checkpoint: ${checkpoint}` : '- Post-apply checkpoint: none recorded',
            '',
            'Review goals:',
            '- Verify the edit task was actually implemented.',
            '- Find regressions, broken references, syntax errors, missing event wiring, duplicated code, stale UI text, and incomplete changes.',
            '- Check offline/static file:// compatibility unless the codebase clearly targets another runtime.',
            '- Prioritize real issues with file references and concrete fixes.',
            '- If fixes are needed, return one copy/pasteable git-style unified diff only, with no markdown fence or explanation text.',
            '- Do not return complete files unless a new file is being created.',
            '',
            'Current codebase after the edit:',
            '--- CODEBASE ---',
            String(codebaseText || '').trim()
        ].join('\n');
    }

    async function copyPostEditAnalysisPrompt(modalEl) {
        const copyBtn = modalEl.querySelector('#wct-ai-response-copy-post-edit-btn');
        if (copyBtn) copyBtn.disabled = true;
        setStatus(modalEl, 'Building post-edit review prompt...', 'info');

        try {
            const codebaseText = await gatherCodebaseTextForPostEdit();
            if (!String(codebaseText || '').trim()) {
                setStatus(modalEl, 'Could not gather codebase text. Load a project folder first.', 'warning');
                return;
            }

            const prompt = buildPostEditAnalysisPrompt(codebaseText);
            const copied = await copyTextToClipboard(prompt);
            if (copied) {
                setStatus(modalEl, 'Post-edit analysis prompt + codebase copied.', 'success');
            } else {
                setStatus(modalEl, 'Copy failed. Browser clipboard access was blocked.', 'warning');
            }
        } catch (err) {
            setStatus(modalEl, `Could not copy post-edit analysis prompt: ${err && err.message ? err.message : err}`, 'danger');
        } finally {
            if (copyBtn) copyBtn.disabled = false;
        }
    }

    function ensureStyle() {
        if (document.getElementById('wct-ai-response-import-style')) return;
        const style = document.createElement('style');
        style.id = 'wct-ai-response-import-style';
        style.textContent = `
            #wct-ai-response-import-modal .modal-content {
                background: #1f252a;
                color: #e9ecef;
                border: 1px solid #3a434a;
            }
            #wct-ai-response-import-modal .modal-header,
            #wct-ai-response-import-modal .modal-footer {
                border-color: #3a434a;
            }
            #wct-ai-response-import-input {
                min-height: 140px;
                height: clamp(140px, 22vh, 220px);
                max-height: 240px;
                background: #10161d;
                color: #d8ecff;
                border: 1px solid #3f4d5a;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                line-height: 1.35;
                resize: vertical;
            }
            #wct-ai-response-import-modal .wct-ai-response-panels {
                display: grid;
                grid-template-columns: 1fr;
                gap: 0.6rem;
            }
            @media (min-width: 992px) {
                #wct-ai-response-import-modal .wct-ai-response-panels {
                    grid-template-columns: 1fr 1fr;
                    align-items: start;
                }
            }
            #wct-ai-response-import-summary {
                max-height: 170px;
                overflow: auto;
                border: 1px solid #3a434a;
                border-radius: 6px;
                background: #121a22;
                padding: 0.55rem 0.65rem;
            }
            #wct-ai-response-import-warnings {
                max-height: 170px;
                overflow: auto;
                border: 1px solid #3a434a;
                border-radius: 6px;
                background: #161e27;
                padding: 0.55rem 0.65rem;
            }
            #wct-ai-response-import-summary ul,
            #wct-ai-response-import-warnings ul {
                margin: 0;
                padding-left: 1.1rem;
            }
            #wct-ai-response-import-status.text-success {
                color: #7ef0bb !important;
            }
            #wct-ai-response-import-status.text-danger {
                color: #ff9ea3 !important;
            }
            #wct-ai-response-import-status.text-warning {
                color: #ffd98a !important;
            }
            #wct-ai-response-import-guidance {
                border: 1px solid #7d6331;
                border-radius: 6px;
                background: #261f12;
                padding: 0.55rem 0.65rem;
            }
            #wct-ai-response-import-guidance textarea {
                min-height: 170px;
                background: #0f151b;
                color: #d8ecff;
                border: 1px solid #3f4d5a;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                line-height: 1.3;
            }
        `;
        document.head.appendChild(style);
    }

    function ensureModal() {
        if (state.modalEl && document.body.contains(state.modalEl)) {
            return state.modalEl;
        }

        ensureStyle();

        let modalEl = document.getElementById('wct-ai-response-import-modal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.className = 'modal fade';
            modalEl.id = 'wct-ai-response-import-modal';
            modalEl.tabIndex = -1;
            modalEl.setAttribute('aria-hidden', 'true');
            modalEl.innerHTML = `
                <div class="modal-dialog modal-xl modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Apply AI Diffs or Files</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-2">Paste the entire AI response below. Forge accepts git-style unified diffs or complete file blocks.</p>
                            <textarea id="wct-ai-response-import-input" class="form-control form-control-sm" spellcheck="false" placeholder="Paste one git-style unified diff, or a complete AI response that includes file updates."></textarea>
                            <div class="d-flex flex-wrap align-items-center mt-2" style="gap:0.7rem;">
                                <button type="button" id="wct-ai-response-analyze-btn" class="btn btn-outline-info btn-sm">Analyze Response</button>
                                <button type="button" id="wct-ai-response-apply-btn" class="btn btn-success btn-sm" disabled>Apply Updates</button>
                                <button type="button" id="wct-ai-response-copy-post-edit-btn" class="btn btn-outline-light btn-sm">Copy Post-Edit Review Prompt</button>
                                <button type="button" id="wct-ai-response-copy-aistudio-prompt-btn" class="btn btn-outline-warning btn-sm">Copy AI Studio Prompt</button>
                                <div class="form-check form-check-inline ms-1">
                                    <input class="form-check-input" type="checkbox" id="wct-ai-response-create-missing" checked>
                                    <label class="form-check-label small" for="wct-ai-response-create-missing">Create missing files</label>
                                </div>
                            </div>
                            <small id="wct-ai-response-import-status" class="d-block mt-2 text-info"></small>
                            <div class="mt-2 wct-ai-response-panels">
                                <div>
                                    <div class="small text-light mb-1">Warnings</div>
                                    <div id="wct-ai-response-import-warnings"></div>
                                </div>
                                <div>
                                    <div class="small text-light mb-1">Planned file updates</div>
                                    <div id="wct-ai-response-import-summary"></div>
                                </div>
                            </div>
                            <div class="mt-2 d-none" id="wct-ai-response-import-guidance">
                                <div class="small text-warning mb-1">AI Retry Prompt (Unified Diff)</div>
                                <div class="small mb-1" id="wct-ai-response-guidance-reasons"></div>
                                <textarea id="wct-ai-response-retry-prompt" class="form-control form-control-sm" spellcheck="false" readonly></textarea>
                                <div class="mt-2">
                                    <button type="button" id="wct-ai-response-copy-prompt-btn" class="btn btn-outline-warning btn-sm">Copy Prompt</button>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modalEl);
        }

        const inputEl = modalEl.querySelector('#wct-ai-response-import-input');
        const analyzeBtn = modalEl.querySelector('#wct-ai-response-analyze-btn');
        const applyBtn = modalEl.querySelector('#wct-ai-response-apply-btn');
        const copyPostEditBtn = modalEl.querySelector('#wct-ai-response-copy-post-edit-btn');
        const copyAiStudioPromptBtn = modalEl.querySelector('#wct-ai-response-copy-aistudio-prompt-btn');
        const copyPromptBtn = modalEl.querySelector('#wct-ai-response-copy-prompt-btn');

        if (inputEl && inputEl.dataset.wctBound !== '1') {
            inputEl.dataset.wctBound = '1';
            inputEl.addEventListener('input', () => {
                state.analysis = null;
                state.inputSignature = '';
                if (applyBtn) applyBtn.disabled = true;
                renderRetryGuidance(modalEl, null);
                setStatus(modalEl, 'Input changed. Click Analyze Response.', 'info');
            });
        }

        if (analyzeBtn && analyzeBtn.dataset.wctBound !== '1') {
            analyzeBtn.dataset.wctBound = '1';
            analyzeBtn.addEventListener('click', () => {
                analyzeFromModal(modalEl);
            });
        }

        if (applyBtn && applyBtn.dataset.wctBound !== '1') {
            applyBtn.dataset.wctBound = '1';
            applyBtn.addEventListener('click', async () => {
                await applyFromModal(modalEl);
            });
        }

        if (copyPostEditBtn && copyPostEditBtn.dataset.wctBound !== '1') {
            copyPostEditBtn.dataset.wctBound = '1';
            copyPostEditBtn.addEventListener('click', async () => {
                await copyPostEditAnalysisPrompt(modalEl);
            });
        }

        if (copyAiStudioPromptBtn && copyAiStudioPromptBtn.dataset.wctBound !== '1') {
            copyAiStudioPromptBtn.dataset.wctBound = '1';
            copyAiStudioPromptBtn.addEventListener('click', async () => {
                const copied = await copyTextToClipboard(buildAiStudioFullFileRetryPrompt());
                if (copied) {
                    setStatus(modalEl, 'AI Studio full-file prompt copied.', 'success');
                } else {
                    setStatus(modalEl, 'Copy failed. Browser clipboard access was blocked.', 'warning');
                }
            });
        }

        if (copyPromptBtn && copyPromptBtn.dataset.wctBound !== '1') {
            copyPromptBtn.dataset.wctBound = '1';
            copyPromptBtn.addEventListener('click', async () => {
                const promptEl = modalEl.querySelector('#wct-ai-response-retry-prompt');
                const text = String(promptEl && promptEl.value ? promptEl.value : '');
                if (!text.trim()) {
                    setStatus(modalEl, 'No retry prompt available to copy.', 'warning');
                    return;
                }
                const copied = await copyTextToClipboard(text);
                if (copied) {
                    setStatus(modalEl, 'Retry prompt copied. Paste it into AI and request one unified diff.', 'success');
                } else {
                    setStatus(modalEl, 'Copy failed. Select and copy the prompt manually.', 'warning');
                }
            });
        }

        if (modalEl.dataset.wctDismissBound !== '1') {
            modalEl.dataset.wctDismissBound = '1';
            const dismissButtons = modalEl.querySelectorAll('[data-bs-dismiss="modal"]');
            dismissButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    closeAllOpenEditorTabsOnce();
                });
            });
        }

        modalEl.addEventListener('shown.bs.modal', () => {
            state.tabsClosedForModalCycle = false;
            state.pendingTabRestore = null;
            debugLog('modal shown; reset close/restore state');
            const activeInput = modalEl.querySelector('#wct-ai-response-import-input');
            if (activeInput && typeof activeInput.focus === 'function') {
                activeInput.focus();
            }
        });
        modalEl.addEventListener('hide.bs.modal', () => {
            debugLog('modal hide start');
            try {
                const focused = document.activeElement;
                if (focused && modalEl.contains(focused) && typeof focused.blur === 'function') {
                    debugLog('blurring focused element inside modal', focused.tagName, focused.className || '');
                    focused.blur();
                }
            } catch (_) {
                // no-op
            }
            closeAllOpenEditorTabsOnce();
            debugLog('modal hide complete');
        });
        modalEl.addEventListener('hidden.bs.modal', () => {
            debugLog('modal hidden; begin restore');
            restoreTabsAfterModalClose();
        });

        state.modalEl = modalEl;
        return modalEl;
    }

    function setStatus(modalEl, message, level = 'info') {
        const el = modalEl.querySelector('#wct-ai-response-import-status');
        if (!el) return;
        el.textContent = message || '';
        el.classList.remove('text-info', 'text-success', 'text-warning', 'text-danger');
        if (!message) return;
        const cls = level === 'success'
            ? 'text-success'
            : (level === 'warning'
                ? 'text-warning'
                : (level === 'danger' ? 'text-danger' : 'text-info'));
        el.classList.add(cls);
    }

    function closeAllOpenEditorTabs() {
        // Use existing close-tab UI handler path.
        debugLog('closeAllOpenEditorTabs: start');
        let guard = 0;
        while (guard < 300) {
            const $closeButtons = $('#editor-container [aria-label="Close tab"]');
            if (!$closeButtons.length) {
                debugLog('closeAllOpenEditorTabs: no more close buttons after', guard, 'click(s)');
                break;
            }
            try {
                $closeButtons.first().trigger('click');
            } catch (_) {
                debugWarn('closeAllOpenEditorTabs: click threw; aborting loop at guard', guard);
                break;
            }
            guard += 1;
        }
        // Fallback direct close if button path did not clear all tabs.
        if ($('#editor-container [aria-label="Close tab"]').length) {
            debugWarn('closeAllOpenEditorTabs: close buttons still present; using fallback deleteTab path');
            const editorApi = getEditorApi();
            if (editorApi && editorApi.instance && typeof editorApi.deleteTab === 'function') {
                const uuids = Object.keys(editorApi.instance || {});
                debugLog('fallback deleteTab on uuids', uuids);
                for (const uuid of uuids) {
                    try {
                        editorApi.deleteTab(uuid, { force: true });
                    } catch (_) {
                        // no-op
                    }
                }
            }
        }
        debugLog('closeAllOpenEditorTabs: end; remaining close buttons =', $('#editor-container [aria-label="Close tab"]').length);
    }

    function closeAllOpenEditorTabsOnce() {
        if (state.tabsClosedForModalCycle) {
            debugLog('closeAllOpenEditorTabsOnce: skipped (already closed this cycle)');
            return;
        }
        state.tabsClosedForModalCycle = true;
        state.pendingTabRestore = getOpenTabSnapshot();
        debugLog('closeAllOpenEditorTabsOnce: snapshot captured', state.pendingTabRestore);
        closeAllOpenEditorTabs();
    }

    function restoreTabsAfterModalClose() {
        const snapshot = state.pendingTabRestore;
        state.pendingTabRestore = null;
        if (!(snapshot && Array.isArray(snapshot.orderedTabs) && snapshot.orderedTabs.length)) {
            debugLog('restoreTabsAfterModalClose: nothing to restore');
            return;
        }
        debugLog('restoreTabsAfterModalClose: scheduling reopen for', snapshot.orderedTabs.length, 'tab(s)');
        setTimeout(() => {
            reopenTabsFromSnapshot(snapshot);
        }, 40);
    }

    function findEntryByUuid(uuid) {
        const id = String(uuid || '').trim();
        if (!id) return null;
        const entries = getEntries();
        for (const entry of entries) {
            if (String(entry && entry.uuid ? entry.uuid : '') === id) {
                return entry;
            }
        }
        return null;
    }

    function findEntryByNameUnique(name) {
        const target = String(name || '').trim().toLowerCase();
        if (!target) return null;
        const entries = getEntries().filter(entry => String(entry && entry.name ? entry.name : '').trim().toLowerCase() === target);
        if (entries.length !== 1) return null;
        return entries[0];
    }

    function resolveEntryFromTabDescriptor(tab) {
        if (!tab) return null;
        const byUuid = findEntryByUuid(tab.uuid);
        if (byUuid) return byUuid;
        if (tab.path) {
            const byPath = findEntryByPath(tab.path);
            if (byPath) return byPath;
        }
        if (tab.name) {
            const byName = findEntryByNameUnique(tab.name);
            if (byName) return byName;
        }
        return null;
    }

    function clickFileInTreeByUuid(uuid) {
        const id = String(uuid || '').trim();
        if (!id) return false;
        const escaped = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const $candidates = $(`[data-uuid="${escaped}"]`);
        if (!$candidates.length) {
            debugLog('clickFileInTreeByUuid: no candidates for uuid', id);
            return false;
        }

        const $fileNode = $candidates.filter('#file-tree li.file[data-uuid], #file-tree [data-type="file"][data-uuid]').first();
        const $target = $fileNode.length ? $fileNode : $candidates.first();
        if (!$target.length) {
            debugLog('clickFileInTreeByUuid: candidates found but no target selected for uuid', id);
            return false;
        }

        // Match the manual path that works: jQuery click on data-uuid node.
        debugLog('clickFileInTreeByUuid: clicking target for uuid', id, 'targetTag=', ($target[0] && $target[0].tagName) || '');
        $target.trigger('click');
        return true;
    }

    function clickFileInTreeByName(name) {
        const target = String(name || '').trim().toLowerCase();
        if (!target) return false;
        const nodes = Array.from(document.querySelectorAll('#file-tree li.file[data-uuid]'));
        for (const node of nodes) {
            const label = node.querySelector('.file-label');
            const text = String(label && label.textContent ? label.textContent : '').trim().toLowerCase();
            if (text !== target) continue;
            node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
        }
        return false;
    }

    function getOpenTabSnapshot() {
        const editorApi = getEditorApi();
        const orderedTabs = [];
        const seen = new Set();
        $('#editor-container .nav-tabs a.nav-link[id^="nav-"]').each((_, el) => {
            const id = String(el && el.id ? el.id : '');
            if (!id.startsWith('nav-')) return;
            const uuid = id.slice(4);
            const meta = editorApi && editorApi._meta ? editorApi._meta[uuid] : null;
            const byUuid = findEntryByUuid(uuid);
            const rel = normalizeProjectPath(
                (meta && (meta.relativePath || meta.name))
                || (byUuid && (byUuid.relativePath || byUuid.name))
                || ''
            );
            const name = String(
                (meta && meta.name)
                || (byUuid && byUuid.name)
                || ($(el).find('.filename').text() || '')
            ).trim();
            const key = rel ? rel.toLowerCase() : (`uuid:${uuid}`);
            if (seen.has(key)) return;
            seen.add(key);
            orderedTabs.push({
                uuid,
                path: rel,
                name
            });
        });

        let activeTab = null;
        let activeUuid = '';
        if (editorApi && typeof editorApi.getActiveUuid === 'function') {
            activeUuid = String(editorApi.getActiveUuid() || '');
        }
        if (!activeUuid) {
            const activeId = String($('#editor-container .nav-tabs a.nav-link.active').attr('id') || '');
            if (activeId.startsWith('nav-')) {
                activeUuid = activeId.slice(4);
            }
        }
        if (activeUuid) {
            const activeMeta = editorApi && editorApi._meta ? editorApi._meta[activeUuid] : null;
            const byUuid = findEntryByUuid(activeUuid);
            activeTab = {
                uuid: activeUuid,
                path: normalizeProjectPath(
                    (activeMeta && (activeMeta.relativePath || activeMeta.name))
                    || (byUuid && (byUuid.relativePath || byUuid.name))
                    || ''
                ),
                name: String(
                    (activeMeta && activeMeta.name)
                    || (byUuid && byUuid.name)
                    || ($(`#editor-container .nav-tabs #nav-${activeUuid} .filename`).text() || '')
                ).trim()
            };
        }

        const snap = { orderedTabs, activeTab };
        debugLog('getOpenTabSnapshot:', snap);
        return snap;
    }

    async function reopenTabsFromSnapshot(snapshot) {
        const editorApi = getEditorApi();
        if (!(editorApi && typeof editorApi.openFile === 'function')) {
            debugWarn('reopenTabsFromSnapshot: editor API unavailable');
            return;
        }
        const orderedTabs = Array.isArray(snapshot && snapshot.orderedTabs) ? snapshot.orderedTabs : [];
        const opened = new Set();
        debugLog('reopenTabsFromSnapshot: start', { count: orderedTabs.length, activeTab: snapshot && snapshot.activeTab ? snapshot.activeTab : null });

        for (const tab of orderedTabs) {
            const rel = normalizeProjectPath(tab && tab.path ? tab.path : '');
            const key = rel ? rel.toLowerCase() : (`uuid:${String(tab && tab.uuid ? tab.uuid : '')}`);
            if (opened.has(key)) continue;
            const entry = resolveEntryFromTabDescriptor(tab);
            let openedThis = false;
            if (tab && tab.uuid) {
                openedThis = clickFileInTreeByUuid(tab.uuid);
                debugLog('reopen tab by uuid click', tab.uuid, 'opened=', openedThis);
            }
            if (!openedThis && entry && entry.uuid) {
                try {
                    await editorApi.openFile(entry.uuid);
                    openedThis = true;
                    debugLog('reopen tab by openFile(entry.uuid)', entry.uuid, 'opened=', openedThis);
                } catch (_) {
                    debugWarn('reopen tab openFile failed for entry uuid', entry.uuid);
                    // no-op
                }
            }
            if (!openedThis && tab && tab.uuid) {
                openedThis = clickFileInTreeByUuid(tab.uuid);
                debugLog('reopen tab by second uuid click', tab.uuid, 'opened=', openedThis);
            }
            if (!openedThis && tab && tab.name) {
                openedThis = clickFileInTreeByName(tab.name);
                debugLog('reopen tab by name click', tab.name, 'opened=', openedThis);
            }
            if (!openedThis) {
                debugWarn('failed to reopen tab', tab);
                continue;
            }
            opened.add(key);
            try {
                await new Promise(resolve => setTimeout(resolve, 25));
            } catch (_) {
                // no-op
            }
        }

        const activeTab = snapshot && snapshot.activeTab ? snapshot.activeTab : null;
        if (activeTab) {
            const entry = resolveEntryFromTabDescriptor(activeTab);
            let activated = false;
            if (activeTab.uuid) {
                activated = clickFileInTreeByUuid(activeTab.uuid);
                debugLog('restore active by uuid click', activeTab.uuid, 'activated=', activated);
            }
            if (!activated && entry && entry.uuid) {
                try {
                    await editorApi.openFile(entry.uuid);
                    activated = true;
                    debugLog('restore active by openFile', entry.uuid, 'activated=', activated);
                } catch (_) {
                    debugWarn('restore active openFile failed for entry uuid', entry.uuid);
                    // no-op
                }
            }
            if (!activated && activeTab.uuid) {
                activated = clickFileInTreeByUuid(activeTab.uuid);
                debugLog('restore active by second uuid click', activeTab.uuid, 'activated=', activated);
            }
            if (!activated && activeTab.name) {
                activated = clickFileInTreeByName(activeTab.name);
                debugLog('restore active by name click', activeTab.name, 'activated=', activated);
            }
        }
        debugLog('reopenTabsFromSnapshot: end; open nav links=', $('#editor-container .nav-tabs a.nav-link[id^="nav-"]').length);
    }

    function renderAnalysis(modalEl, analysis) {
        const summaryEl = modalEl.querySelector('#wct-ai-response-import-summary');
        const warningsEl = modalEl.querySelector('#wct-ai-response-import-warnings');
        const applyBtn = modalEl.querySelector('#wct-ai-response-apply-btn');

        if (summaryEl) {
            if (!analysis.plan.length) {
                summaryEl.innerHTML = '<small class="text-warning">No file updates detected.</small>';
            } else {
                const rows = analysis.plan.map(item => {
                    const actionLabel = item.action === 'create' ? 'create' : 'update';
                    const inferredTag = item.inferredPath ? ' (inferred path)' : '';
                    const hunkTag = item.patch && item.patch.hunks
                        ? ` - ${item.patch.hunks.length} hunk${item.patch.hunks.length === 1 ? '' : 's'}`
                        : '';
                    return `<li><code>${escapeHtml(item.path)}</code> - ${escapeHtml(actionLabel)}${escapeHtml(inferredTag)} - source: ${escapeHtml(item.source || 'unknown')}${escapeHtml(hunkTag)}</li>`;
                }).join('');
                summaryEl.innerHTML = `<ul>${rows}</ul>`;
            }
        }

        if (warningsEl) {
            if (!analysis.warnings.length) {
                warningsEl.innerHTML = '<small class="text-success">No warnings.</small>';
            } else {
                const rows = analysis.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('');
                warningsEl.innerHTML = `<ul>${rows}</ul>`;
            }
        }

        renderRetryGuidance(modalEl, analysis);

        if (applyBtn) {
            applyBtn.disabled = !analysis.plan.length || !!analysis.requiresFullFilesRetry;
        }
    }

    function renderRetryGuidance(modalEl, analysis) {
        const wrapperEl = modalEl.querySelector('#wct-ai-response-import-guidance');
        const reasonsEl = modalEl.querySelector('#wct-ai-response-guidance-reasons');
        const promptEl = modalEl.querySelector('#wct-ai-response-retry-prompt');
        if (!(wrapperEl && reasonsEl && promptEl)) return;

        const show = !!(analysis && analysis.requiresFullFilesRetry && analysis.retryPrompt);
        if (!show) {
            wrapperEl.classList.add('d-none');
            reasonsEl.textContent = '';
            promptEl.value = '';
            return;
        }

        const reasonList = Array.isArray(analysis.retryReasons) ? analysis.retryReasons : [];
        const reasonText = reasonList.length
            ? `Detected non-full-file response patterns: ${reasonList.join(' ')}`
            : 'Detected non-full-file response patterns.';

        reasonsEl.textContent = reasonText;
        promptEl.value = String(analysis.retryPrompt || '');
        wrapperEl.classList.remove('d-none');
    }

    function analyzeText(text) {
        const diffParsed = parseUnifiedDiffResponse(text);
        const diffHunks = (diffParsed.patches || []).flatMap(patch => patch && Array.isArray(patch.hunks) ? patch.hunks : []);
        if (diffHunks.length || (diffParsed.warnings && diffParsed.warnings.length)) {
            const trace = createDiffDebugTrace('', text, {
                path: (diffParsed.patches || []).map(patch => patch && patch.path).filter(Boolean).join(', '),
                analysis: {
                    phase: 'analyze',
                    warnings: diffParsed.warnings || [],
                    stats: diffParsed.stats || null,
                    patches: (diffParsed.patches || []).map(patch => ({
                        path: patch.path,
                        action: patch.action,
                        oldPath: patch.oldPath,
                        newPath: patch.newPath,
                        hunks: Array.isArray(patch.hunks) ? patch.hunks.length : 0
                    }))
                }
            }, diffHunks);
            trace.status = diffParsed.patches.length ? 'analyzed' : 'error';
            trace.result = diffParsed.patches.length
                ? { ok: true, phase: 'analyze', patches: diffParsed.patches.length, hunks: diffHunks.length }
                : { ok: false, phase: 'analyze', reason: 'No parseable diff patches found.' };
            state.lastDiffDebugPackage = trace;
            recordDiffDebugLog(trace, 'Captured importer diff analysis.', trace.result);
        }
        if (diffParsed.patches.length) {
            return buildDiffPlanFromParsed(diffParsed, text);
        }

        const parser = getParserApi();
        if (!parser) {
            return {
                plan: [],
                warnings: ['aiResponseParser.js is not loaded.'],
                requiresFullFilesRetry: false,
                retryPrompt: '',
                retryReasons: [],
                stats: { total: 0, creates: 0, updates: 0 },
                inputSignature: buildInputSignature(text)
            };
        }
        const parsed = parser.parse(text);
        return buildPlanFromParsed(parsed, text);
    }

    function analyzeFromModal(modalEl) {
        const inputEl = modalEl.querySelector('#wct-ai-response-import-input');
        const rawText = String(inputEl && inputEl.value ? inputEl.value : '');
        if (!rawText.trim()) {
            state.analysis = null;
            state.inputSignature = '';
            renderAnalysis(modalEl, {
                plan: [],
                warnings: ['Paste an AI response first.'],
                requiresFullFilesRetry: false,
                retryPrompt: '',
                retryReasons: [],
                stats: { total: 0, creates: 0, updates: 0 }
            });
            setStatus(modalEl, 'Paste an AI response first.', 'warning');
            return null;
        }

        const analysis = analyzeText(rawText);
        state.analysis = analysis;
        state.inputSignature = analysis.inputSignature;
        renderAnalysis(modalEl, analysis);

        if (analysis.requiresFullFilesRetry) {
            setStatus(modalEl, 'Detected instructions or snippets. Copy the retry prompt below and request a unified diff.', 'warning');
        } else if (!analysis.plan.length) {
            setStatus(modalEl, 'No updates were detected. Paste a unified diff or full file blocks.', 'warning');
        } else {
            const patchText = analysis.stats && analysis.stats.patches
                ? `, ${analysis.stats.hunks || 0} hunk(s)`
                : '';
            setStatus(
                modalEl,
                `Detected ${analysis.stats.total} update(s): ${analysis.stats.updates} update, ${analysis.stats.creates} create${patchText}.`,
                'success'
            );
        }
        return analysis;
    }

    function renderApplyResults(modalEl, results, warnings = []) {
        const warningsEl = modalEl.querySelector('#wct-ai-response-import-warnings');
        if (!warningsEl) return;

        const lines = [];
        for (const warning of warnings) lines.push(String(warning));
        for (const skipped of results.skipped) lines.push(String(skipped));
        for (const error of results.errors) lines.push(`ERROR: ${error}`);

        if (!lines.length) {
            warningsEl.innerHTML = '<small class="text-success">No warnings.</small>';
            return;
        }

        const items = lines.map(line => `<li>${escapeHtml(line)}</li>`).join('');
        warningsEl.innerHTML = `<ul>${items}</ul>`;
    }

    async function applyFromModal(modalEl) {
        const inputEl = modalEl.querySelector('#wct-ai-response-import-input');
        const createMissingEl = modalEl.querySelector('#wct-ai-response-create-missing');
        const analyzeBtn = modalEl.querySelector('#wct-ai-response-analyze-btn');
        const applyBtn = modalEl.querySelector('#wct-ai-response-apply-btn');
        const copyPostEditBtn = modalEl.querySelector('#wct-ai-response-copy-post-edit-btn');

        const rawText = String(inputEl && inputEl.value ? inputEl.value : '');
        if (!rawText.trim()) {
            setStatus(modalEl, 'Paste an AI response first.', 'warning');
            return;
        }

        const signature = buildInputSignature(rawText);
        let analysis = state.analysis;
        if (!analysis || state.inputSignature !== signature) {
            analysis = analyzeFromModal(modalEl);
            if (!analysis) return;
        }

        if (!analysis.plan.length) {
            setStatus(modalEl, 'No updates to apply.', 'warning');
            return;
        }
        if (analysis.requiresFullFilesRetry) {
            setStatus(modalEl, 'Apply blocked: response is instructions or snippets. Use the retry prompt to request a unified diff.', 'warning');
            return;
        }

        const createMissing = !!(createMissingEl && createMissingEl.checked);
        const saveImmediately = true;

        if (analyzeBtn) analyzeBtn.disabled = true;
        if (applyBtn) applyBtn.disabled = true;
        if (copyPostEditBtn) copyPostEditBtn.disabled = true;
        setStatus(modalEl, 'Applying updates...', 'info');

        try {
            const results = await applyPlan(analysis.plan, {
                createMissing,
                saveImmediately,
                sourceText: rawText,
                analysis: {
                    stats: analysis.stats || null,
                    warnings: analysis.warnings || [],
                    plan: (analysis.plan || []).map(item => ({
                        path: item.path,
                        action: item.action,
                        source: item.source,
                        patchHunks: item.patch && Array.isArray(item.patch.hunks) ? item.patch.hunks.length : 0
                    }))
                }
            });
            const checkpointResult = await createCheckpointAfterApply(analysis, results);

            const updatedCount = results.updated.length;
            const createdCount = results.created.length;
            const savedCount = results.saved.length;
            const skippedCount = results.skipped.length;
            const errorCount = results.errors.length;
            const extraWarnings = [];
            if (checkpointResult.attempted && !checkpointResult.saved && checkpointResult.message) {
                extraWarnings.push(checkpointResult.message);
            }

            state.lastApplied = {
                task: checkpointResult.taskTitle || buildAppliedSummaryTitle(analysis, results),
                analysis,
                results: {
                    updated: results.updated.slice(),
                    created: results.created.slice(),
                    saved: results.saved.slice(),
                    skipped: results.skipped.slice(),
                    errors: results.errors.slice()
                },
                checkpoint: checkpointResult,
                appliedAt: new Date().toISOString()
            };

            const summary = {
                plan: analysis.plan.map(item => ({
                    ...item,
                    action: results.created.includes(item.path) ? 'create' : 'update'
                })),
                warnings: [],
                stats: analysis.stats
            };
            renderAnalysis(modalEl, summary);
            renderApplyResults(modalEl, results, [...(analysis.warnings || []), ...extraWarnings]);

            if (errorCount > 0) {
                setStatus(
                    modalEl,
                    `Applied with errors. Updated: ${updatedCount}, created: ${createdCount}, saved: ${savedCount}, skipped: ${skippedCount}, errors: ${errorCount}.${checkpointResult.saved ? ' Checkpoint saved.' : ''}`,
                    'danger'
                );
            } else {
                setStatus(
                    modalEl,
                    `Done. Updated: ${updatedCount}, created: ${createdCount}, saved: ${savedCount}, skipped: ${skippedCount}.${checkpointResult.saved ? ' Checkpoint saved.' : ''}`,
                    'success'
                );
            }
        } finally {
            if (analyzeBtn) analyzeBtn.disabled = false;
            if (applyBtn) applyBtn.disabled = false;
            if (copyPostEditBtn) copyPostEditBtn.disabled = false;
        }
    }

    function openModal() {
        const bootstrapApi = getBootstrapApi();
        if (!bootstrapApi) {
            alert('Bootstrap modal API is unavailable.');
            return;
        }
        const modalEl = ensureModal();
        const instance = bootstrapApi.Modal.getOrCreateInstance(modalEl);
        instance.show();
    }

    $(document).on('click', '#apply-ai-response-btn', function (event) {
        event.preventDefault();
        openModal();
    });

    root.aiResponseImporter = {
        openModal,
        copyLastDiffDebugPackage,
        formatLastDiffDebugPackage,
        analyzeRawText(text) {
            return analyzeText(text);
        }
    };
})(window);
