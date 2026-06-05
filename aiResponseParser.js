(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.aiResponseParser = api;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    const KNOWN_EXTENSIONS = new Set([
        'html', 'htm', 'css', 'scss', 'sass', 'less',
        'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
        'json', 'md', 'txt', 'xml', 'yml', 'yaml',
        'csv', 'py', 'sql', 'sh'
    ]);

    const LANGUAGE_TO_EXT = Object.freeze({
        html: 'html',
        htm: 'html',
        css: 'css',
        scss: 'scss',
        sass: 'sass',
        less: 'less',
        javascript: 'js',
        js: 'js',
        typescript: 'ts',
        ts: 'ts',
        tsx: 'tsx',
        jsx: 'jsx',
        json: 'json',
        markdown: 'md',
        md: 'md',
        text: 'txt',
        txt: 'txt',
        xml: 'xml',
        yaml: 'yaml',
        yml: 'yml',
        csv: 'csv',
        python: 'py',
        py: 'py',
        sql: 'sql',
        shell: 'sh',
        bash: 'sh',
        sh: 'sh'
    });

    function normalizeNewlines(text) {
        return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    function uniqueList(values) {
        const out = [];
        const seen = new Set();
        for (const value of values) {
            const key = String(value || '').toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(value);
        }
        return out;
    }

    function getExtension(path) {
        const normalized = String(path || '').trim().toLowerCase();
        const idx = normalized.lastIndexOf('.');
        if (idx < 0 || idx === normalized.length - 1) return '';
        return normalized.slice(idx + 1);
    }

    function isKnownExtension(path) {
        const ext = getExtension(path);
        return !!(ext && KNOWN_EXTENSIONS.has(ext));
    }

    function cleanWrapperChars(value) {
        return String(value || '')
            .trim()
            .replace(/^[`"'*<(\[\s]+/, '')
            .replace(/[`"'>)\].,;:!?*\s]+$/, '')
            .trim();
    }

    function sanitizePath(rawPath) {
        if (!rawPath) return '';
        let text = String(rawPath || '').trim();
        if (!text) return '';

        // If a sentence contains a path token, keep only that token.
        const inlinePathMatch = text.match(/(?:^|[^A-Za-z0-9._-])((?:[A-Za-z0-9_.-]+[\/\\])*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8})(?=$|[^A-Za-z0-9._-])/);
        if (inlinePathMatch) {
            text = inlinePathMatch[1] || inlinePathMatch[0];
        }

        text = text
            .replace(/^filename\s*[:=-]\s*/i, '')
            .replace(/^file\s*[:=-]\s*/i, '')
            .replace(/^path\s*[:=-]\s*/i, '')
            .replace(/^save(?:\s+this\s+file)?(?:\s+as)?\s+/i, '')
            .replace(/^named\s+/i, '');

        text = cleanWrapperChars(text);
        if (!text) return '';

        text = text
            .replace(/\\/g, '/')
            .replace(/^\.\/+/, '')
            .replace(/^\/+/, '')
            .replace(/\/+/g, '/')
            .trim();

        if (!text) return '';
        if (/^[A-Za-z]:\//.test(text)) return '';

        const segments = text.split('/').map(part => part.trim()).filter(Boolean);
        if (!segments.length) return '';
        if (segments.some(part => part === '..')) return '';

        const basename = segments[segments.length - 1] || '';
        if (!basename || basename.startsWith('.')) return '';

        for (const segment of segments) {
            if (!segment) return '';
            if (/[:*?"<>|]/.test(segment)) return '';
            if (/^\.+$/.test(segment) && segment !== '.') return '';
        }

        const normalized = segments.join('/');
        if (!normalized || !isKnownExtension(normalized)) return '';
        return normalized;
    }

    function extractPathCandidatesFromText(text) {
        const source = String(text || '');
        if (!source.trim()) return [];

        const candidates = [];
        const add = (value) => {
            const normalized = sanitizePath(value);
            if (normalized) candidates.push(normalized);
        };

        // Backticked or quoted paths.
        const wrappedRegex = /[`'"]([^`'"\n]{1,220})[`'"]/g;
        let wrappedMatch;
        while ((wrappedMatch = wrappedRegex.exec(source)) !== null) {
            add(wrappedMatch[1]);
        }

        // Generic inline paths.
        const inlineRegex = /(?:^|[\s(>:[-])((?:[A-Za-z0-9_.-]+[\/\\])*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s),.;:!?<])/g;
        let inlineMatch;
        while ((inlineMatch = inlineRegex.exec(source)) !== null) {
            add(inlineMatch[1]);
        }

        return uniqueList(candidates);
    }

    function normalizeLanguage(rawLanguage) {
        const lang = String(rawLanguage || '').trim().toLowerCase();
        if (!lang) return '';
        if (LANGUAGE_TO_EXT[lang]) return lang;
        if (lang.includes('javascript')) return 'javascript';
        if (lang.includes('typescript')) return 'typescript';
        if (lang.includes('html')) return 'html';
        if (lang.includes('css')) return 'css';
        if (lang.includes('json')) return 'json';
        if (lang.includes('python')) return 'python';
        if (lang.includes('markdown')) return 'markdown';
        if (lang.includes('xml')) return 'xml';
        if (lang.includes('yaml')) return 'yaml';
        return '';
    }

    function inferLanguageFromInfo(info) {
        const raw = String(info || '').trim();
        if (!raw) return '';

        const pathCandidates = extractPathCandidatesFromText(raw);
        if (pathCandidates.length) {
            const ext = getExtension(pathCandidates[0]);
            if (ext) {
                const langByExt = Object.keys(LANGUAGE_TO_EXT).find(key => LANGUAGE_TO_EXT[key] === ext);
                if (langByExt) return langByExt;
            }
        }

        const tokens = raw.toLowerCase().split(/[\s,;|(){}\[\]<>="':]+/).filter(Boolean);
        for (const token of tokens) {
            const normalized = normalizeLanguage(token);
            if (normalized) return normalized;
        }
        return '';
    }

    function detectContentLanguage(content) {
        const text = String(content || '').trim();
        if (!text) return '';

        if (/^\s*<!doctype\s+html/i.test(text) || /<html[\s>]/i.test(text)) return 'html';
        if (/^\s*[\[{]/.test(text)) {
            try {
                JSON.parse(text);
                return 'json';
            } catch (_) {
                // ignore parse failure, may still be code
            }
        }
        if (/^\s*#\s+\S+/m.test(text)) return 'markdown';
        if (/^\s*[@.#]?[A-Za-z0-9_-][^{\n]*\{[\s\S]*\}/m.test(text) && /:\s*[^;\n]+;/.test(text)) return 'css';
        if (/(?:^|\n)\s*(?:const|let|var|function|class|import|export|document\.|window\.)/.test(text)) return 'javascript';
        if (/^\s*<\?xml/.test(text) || /<\/?[A-Za-z][^>]*>/.test(text)) return 'xml';
        return '';
    }

    function looksNarrativeLine(line) {
        const t = String(line || '').trim();
        if (!t) return false;
        if (/[<>{};=]/.test(t)) return false;
        if (/^\s*(?:\/\/|\/\*|\*)/.test(t)) return false;
        return /^(?:here(?:'s| is)|this (?:file|code)|save (?:this|the)|after saving|how to|open (?:the )?|would you like|let me know|copy (?:and )?paste)/i.test(t);
    }

    function isLikelyJavaScriptLine(line) {
        const t = String(line || '').trim();
        if (!t) return false;

        if (/^(?:\/\/|\/\*|\*)/.test(t)) return true;
        if (/^(?:const|let|var|function|class|import|export|async|await|if|else|for|while|switch|case|default|try|catch|finally|return|throw|break|continue)\b/.test(t)) return true;
        if (/^(?:document\.|window\.|module\.exports\b|exports\.)/.test(t)) return true;
        if (/^<\/?script\b/i.test(t)) return true;

        if (/=>/.test(t)) return true;
        if (/^\(\s*(?:async\s*)?(?:function|\()/.test(t)) return true;
        if (/^[A-Za-z_$][A-Za-z0-9_$]*\s*=/.test(t)) return true;
        if (/^[A-Za-z_$][A-Za-z0-9_$]*\s*\([^)]*\)\s*;?\s*$/.test(t)) return true;
        if (/;\s*(?:\/\/.*)?$/.test(t)) return true;

        if (/[{}]/.test(t) && /(?:\b(?:if|for|while|switch|catch)\s*\(|\b(?:else|try|finally)\b|\b(?:function|class)\b)/.test(t)) return true;
        if (/^[{[]/.test(t) && /[}\]]\s*[,;]?\s*$/.test(t)) return true;

        return false;
    }

    function stripUiNoise(lines) {
        const noiseTokens = new Set([
            'code', 'html', 'css', 'javascript', 'js', 'json', 'typescript',
            'play_circle', 'download', 'content_copy', 'expand_less', 'expand_more', 'copy'
        ]);

        let start = 0;
        while (start < lines.length) {
            const raw = String(lines[start] || '').trim().toLowerCase();
            if (!raw) {
                start += 1;
                continue;
            }
            if (raw.length <= 30 && (noiseTokens.has(raw) || /^language[:\s-]+[a-z0-9_-]+$/.test(raw))) {
                start += 1;
                continue;
            }
            break;
        }

        let end = lines.length - 1;
        while (end >= start) {
            const raw = String(lines[end] || '').trim().toLowerCase();
            if (!raw) {
                end -= 1;
                continue;
            }
            if (raw.length <= 40 && (noiseTokens.has(raw) || raw === '```' || raw === '~~~')) {
                end -= 1;
                continue;
            }
            break;
        }

        return lines.slice(start, end + 1);
    }

    function trimCodeContent(pathHint, rawContent) {
        const text = normalizeNewlines(rawContent || '').replace(/^\uFEFF/, '');
        const ext = getExtension(pathHint);
        let lines = text.split('\n');

        // Remove fence-only lines at edges.
        while (lines.length && /^\s*(`{3,}|~{3,})\s*$/.test(lines[0])) lines.shift();
        while (lines.length && /^\s*(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1])) lines.pop();

        lines = stripUiNoise(lines);

        if (ext === 'html' || ext === 'htm') {
            const startIdx = lines.findIndex(line => /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(line));
            if (startIdx > 0) lines = lines.slice(startIdx);

            let endIdx = -1;
            for (let i = lines.length - 1; i >= 0; i -= 1) {
                if (/<\/html\s*>/i.test(lines[i])) {
                    endIdx = i;
                    break;
                }
            }
            if (endIdx >= 0) lines = lines.slice(0, endIdx + 1);
        } else if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
            const startIdx = lines.findIndex(line => /(?:^|\s)(?:@import|@media|:root|[.#]?[A-Za-z0-9_-][^{}]*\{)/.test(line));
            if (startIdx > 0) lines = lines.slice(startIdx);
        } else if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts' || ext === 'tsx' || ext === 'jsx') {
            const startIdx = lines.findIndex(isLikelyJavaScriptLine);
            if (startIdx > 0) lines = lines.slice(startIdx);
        }

        while (lines.length && !String(lines[0] || '').trim()) lines.shift();
        while (lines.length && !String(lines[lines.length - 1] || '').trim()) lines.pop();

        while (lines.length && looksNarrativeLine(lines[lines.length - 1])) lines.pop();
        while (lines.length && looksNarrativeLine(lines[0])) lines.shift();

        return lines.join('\n').trim();
    }

    function looksLikeCodeForPath(pathHint, content) {
        const text = String(content || '').trim();
        if (!text) return false;
        const ext = getExtension(pathHint);

        if (ext === 'html' || ext === 'htm') {
            return /<\s*\/?\s*[a-z!][^>]*>/i.test(text);
        }
        if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
            return /\{[\s\S]*\}/.test(text) && /:\s*[^;\n]+;/.test(text);
        }
        if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts' || ext === 'tsx' || ext === 'jsx') {
            return /[;{}()=<>]/.test(text) && /(?:^|\n)\s*(?:const|let|var|function|class|import|export|document\.|window\.)/m.test(text);
        }
        if (ext === 'json') {
            try {
                JSON.parse(text);
                return true;
            } catch (_) {
                return false;
            }
        }
        return text.split('\n').length > 1;
    }

    function choosePathFromContext(infoText, contextText) {
        const infoCandidates = extractPathCandidatesFromText(infoText);
        if (infoCandidates.length) return infoCandidates[0];

        const contextLines = normalizeNewlines(contextText).split('\n').slice(-8);
        for (let i = contextLines.length - 1; i >= 0; i -= 1) {
            const lineCandidates = extractPathCandidatesFromText(contextLines[i]);
            if (lineCandidates.length) return lineCandidates[0];
        }
        return '';
    }

    function extractFencedBlocks(text) {
        const blocks = [];
        const fenceRegex = /(^|\n)(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g;
        let match;
        while ((match = fenceRegex.exec(text)) !== null) {
            const info = String(match[3] || '').trim();
            const content = String(match[4] || '');
            const startIndex = Number(match.index || 0);
            const before = text.slice(Math.max(0, startIndex - 500), startIndex);
            const pathHint = choosePathFromContext(info, before);
            const language = inferLanguageFromInfo(info) || detectContentLanguage(content);
            const cleaned = trimCodeContent(pathHint, content);
            if (!cleaned) continue;
            if (pathHint && !looksLikeCodeForPath(pathHint, cleaned)) continue;
            blocks.push({
                source: 'fenced',
                pathHint: pathHint || '',
                language: language || '',
                content: cleaned
            });
        }
        return blocks;
    }

    function extractFileSections(text) {
        const blocks = [];
        const sectionRegex = /(?:^|\n)\s*File\s*:\s*([^\n]+)\n\s*[-=]{3,}[^\n]*\n([\s\S]*?)(?=(?:\n\s*File\s*:)|$)/gi;
        let match;
        while ((match = sectionRegex.exec(text)) !== null) {
            const rawPath = String(match[1] || '');
            const pathHint = sanitizePath(rawPath);
            const body = String(match[2] || '');
            const language = pathHint ? (Object.keys(LANGUAGE_TO_EXT).find(key => LANGUAGE_TO_EXT[key] === getExtension(pathHint)) || '') : '';
            const cleaned = trimCodeContent(pathHint, body);
            if (!cleaned) continue;
            if (pathHint && !looksLikeCodeForPath(pathHint, cleaned)) continue;
            blocks.push({
                source: 'file-section',
                pathHint: pathHint || '',
                language,
                content: cleaned
            });
        }
        return blocks;
    }

    function detectHeadingPath(line) {
        const raw = String(line || '').trim();
        if (!raw) return '';
        if (/[{};]/.test(raw) && !/save|file|filename|path/i.test(raw)) return '';
        if (raw.length > 220) return '';
        if (!/^#{1,6}\s+/.test(raw) && !/^\d+\s*[\).:-]\s*/.test(raw) && /\b(?:open|double-click|browser|run)\b/i.test(raw)) {
            return '';
        }

        const candidates = extractPathCandidatesFromText(raw);
        if (!candidates.length) return '';

        const wordCount = raw.split(/\s+/).filter(Boolean).length;
        const hasBullet = /^#{1,6}\s+/.test(raw) || /^\d+\s*[\).:-]\s*/.test(raw) || /^[-*]\s+/.test(raw);
        const hasStrongCue = /(?:\b(?:save|filename|named)\b|\bfile\s*:|\bpath\s*:)/i.test(raw);
        if (!hasBullet && hasStrongCue && /\b(?:copy|open|click|then|after)\b/i.test(raw)) {
            return '';
        }
        if (!hasBullet && hasStrongCue && wordCount > 12) {
            return '';
        }
        if (!hasBullet && !hasStrongCue && wordCount > 8) {
            return '';
        }

        const looksHeading =
            hasBullet ||
            hasStrongCue ||
            cleanWrapperChars(raw).toLowerCase() === candidates[0].toLowerCase();

        return looksHeading ? candidates[0] : '';
    }

    function extractHeadingSections(text) {
        const blocks = [];
        const lines = normalizeNewlines(text).split('\n');
        const headings = [];

        for (let i = 0; i < lines.length; i += 1) {
            const pathHint = detectHeadingPath(lines[i]);
            if (!pathHint) continue;
            headings.push({ lineIndex: i, pathHint });
        }

        for (let h = 0; h < headings.length; h += 1) {
            const startLine = headings[h].lineIndex + 1;
            const endLine = h + 1 < headings.length ? headings[h + 1].lineIndex : lines.length;
            const body = lines.slice(startLine, endLine).join('\n');
            const pathHint = headings[h].pathHint;
            const language = detectContentLanguage(body) || (Object.keys(LANGUAGE_TO_EXT).find(key => LANGUAGE_TO_EXT[key] === getExtension(pathHint)) || '');
            const cleaned = trimCodeContent(pathHint, body);
            if (!cleaned) continue;
            if (pathHint && !looksLikeCodeForPath(pathHint, cleaned)) continue;
            blocks.push({
                source: 'heading',
                pathHint,
                language,
                content: cleaned
            });
        }

        return blocks;
    }

    function extractSingleHtmlFallback(text) {
        const source = normalizeNewlines(text);
        const startMatch = source.match(/<!doctype\s+html|<html[\s>]/i);
        if (!startMatch || typeof startMatch.index !== 'number') return null;

        const start = startMatch.index;
        let end = -1;
        const endRegex = /<\/html\s*>/ig;
        let m;
        while ((m = endRegex.exec(source)) !== null) {
            end = endRegex.lastIndex;
        }
        const snippet = end > start ? source.slice(start, end) : source.slice(start);
        const cleaned = trimCodeContent('index.html', snippet);
        if (!cleaned) return null;

        const firstChunk = source.slice(0, Math.max(2000, start + 200));
        const namedCandidates = extractPathCandidatesFromText(firstChunk);
        const pathHint = namedCandidates.find(path => /\.html?$/i.test(path)) || 'index.html';

        return {
            source: 'single-html',
            pathHint,
            language: 'html',
            content: cleaned
        };
    }

    function dedupeBlocks(blocks) {
        const out = [];
        const seen = new Set();

        for (const block of blocks) {
            const normalizedContent = String(block && block.content ? block.content : '').trim();
            if (!normalizedContent) continue;
            const key = `${String(block.pathHint || '').toLowerCase()}::${normalizedContent.length}::${normalizedContent.slice(0, 120)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                source: String(block.source || 'unknown'),
                pathHint: String(block.pathHint || ''),
                language: normalizeLanguage(block.language || ''),
                content: normalizedContent
            });
        }

        return out;
    }

    function parse(rawText) {
        const normalized = normalizeNewlines(rawText || '');
        const warnings = [];
        const blocks = [];

        if (!normalized.trim()) {
            return {
                blocks: [],
                warnings: ['No input text was provided.'],
                stats: { inputLength: 0, fencedBlocks: 0, fileSections: 0, headingSections: 0, fallbackUsed: false }
            };
        }

        const fileSections = extractFileSections(normalized);
        const fencedBlocks = extractFencedBlocks(normalized);
        blocks.push(...fileSections, ...fencedBlocks);

        if (blocks.length === 0) {
            const headingSections = extractHeadingSections(normalized);
            blocks.push(...headingSections);
        }

        if (blocks.length === 0) {
            const fallback = extractSingleHtmlFallback(normalized);
            if (fallback) blocks.push(fallback);
        }

        const deduped = dedupeBlocks(blocks);
        if (deduped.length === 0) {
            warnings.push('No code-like content was detected.');
        }

        const missingPathCount = deduped.filter(block => !block.pathHint).length;
        if (missingPathCount > 0) {
            warnings.push(`${missingPathCount} block(s) did not include a clear file path and will require path inference.`);
        }

        return {
            blocks: deduped,
            warnings,
            stats: {
                inputLength: normalized.length,
                fencedBlocks: fencedBlocks.length,
                fileSections: fileSections.length,
                headingSections: blocks.filter(block => block.source === 'heading').length,
                fallbackUsed: blocks.some(block => block.source === 'single-html')
            }
        };
    }

    return {
        parse,
        sanitizePath,
        extractPathCandidatesFromText,
        detectContentLanguage,
        getExtension,
        languageToExtension(language) {
            const normalized = normalizeLanguage(language);
            return normalized ? (LANGUAGE_TO_EXT[normalized] || '') : '';
        }
    };
});
