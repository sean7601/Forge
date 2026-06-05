/* ===== Forge v2 - CSP Bindings: Replace Inline Handlers with addEventListener ===== */

(function () {
    const EVENT_ATTRS = {
        onclick: 'click',
        onkeydown: 'keydown',
        oninput: 'input',
        onchange: 'change'
    };
    const compileCache = new Map();
    let observer = null;

    function splitStatements(code) {
        const statements = [];
        let current = '';
        let quote = '';
        let escape = false;
        let depthParen = 0;
        let depthBrace = 0;

        for (let i = 0; i < code.length; i++) {
            const ch = code[i];
            if (escape) {
                current += ch;
                escape = false;
                continue;
            }
            if (quote) {
                current += ch;
                if (ch === '\\') {
                    escape = true;
                } else if (ch === quote) {
                    quote = '';
                }
                continue;
            }
            if (ch === '"' || ch === "'") {
                quote = ch;
                current += ch;
                continue;
            }
            if (ch === '(') depthParen++;
            if (ch === ')' && depthParen > 0) depthParen--;
            if (ch === '{') depthBrace++;
            if (ch === '}' && depthBrace > 0) depthBrace--;

            if (ch === ';' && depthParen === 0 && depthBrace === 0) {
                const t = current.trim();
                if (t) statements.push(t);
                current = '';
                continue;
            }
            current += ch;
        }

        const tail = current.trim();
        if (tail) statements.push(tail);
        return statements;
    }

    function stripOuterParens(expr) {
        let out = String(expr || '').trim();
        while (out.startsWith('(') && out.endsWith(')')) {
            out = out.slice(1, -1).trim();
        }
        return out;
    }

    function unquote(token) {
        const t = String(token || '').trim();
        if (t.length < 2) return t;
        const q = t[0];
        if ((q !== "'" && q !== '"') || t[t.length - 1] !== q) return t;
        const body = t.slice(1, -1);
        return body
            .replace(/\\\\/g, '\\')
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t');
    }

    function splitArgs(argString) {
        const src = String(argString || '').trim();
        if (!src) return [];
        const out = [];
        let current = '';
        let quote = '';
        let escape = false;
        let depth = 0;
        for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            if (escape) {
                current += ch;
                escape = false;
                continue;
            }
            if (quote) {
                current += ch;
                if (ch === '\\') {
                    escape = true;
                } else if (ch === quote) {
                    quote = '';
                }
                continue;
            }
            if (ch === '"' || ch === "'") {
                quote = ch;
                current += ch;
                continue;
            }
            if (ch === '(') depth++;
            if (ch === ')' && depth > 0) depth--;
            if (ch === ',' && depth === 0) {
                out.push(current.trim());
                current = '';
                continue;
            }
            current += ch;
        }
        if (current.trim()) out.push(current.trim());
        return out;
    }

    function resolveValue(token, event, el) {
        const t = String(token || '').trim();
        if (!t) return undefined;
        if (t === 'this') return el;
        if (t === 'event') return event;
        if (t === 'this.value') return el ? el.value : undefined;
        if (t === 'this.checked') return el ? el.checked : undefined;
        if (t === 'true') return true;
        if (t === 'false') return false;
        if (t === 'null') return null;
        if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
        if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
            return unquote(t);
        }
        return undefined;
    }

    function resolveCall(path) {
        const parts = String(path || '').split('.').filter(Boolean);
        if (!parts.length) return null;
        let ctx = window;
        if (parts.length === 1) {
            const fn = window[parts[0]];
            return typeof fn === 'function' ? { fn, ctx: window } : null;
        }
        for (let i = 0; i < parts.length - 1; i++) {
            const seg = parts[i];
            ctx = seg === 'window' ? window : ctx?.[seg];
            if (!ctx) return null;
        }
        const fn = ctx[parts[parts.length - 1]];
        if (typeof fn !== 'function') return null;
        return { fn, ctx };
    }

    function callExpression(expr, event, el) {
        const m = String(expr || '').trim().match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(([\s\S]*)\)$/);
        if (!m) return false;
        const call = resolveCall(m[1]);
        if (!call) return false;
        const args = splitArgs(m[2]).map(token => resolveValue(token, event, el));
        call.fn.apply(call.ctx, args);
        return true;
    }

    function evalCondition(condition, event, el) {
        const cond = stripOuterParens(condition);
        const parts = cond.split('&&').map(p => p.trim()).filter(Boolean);
        if (!parts.length) return false;
        return parts.every(part => {
            const p = stripOuterParens(part);
            if (p === 'event.target===this' || p === 'event.target === this') return event.target === el;
            if (p === '!event.shiftKey') return !event.shiftKey;
            const keyMatch = p.match(/^event\.key\s*===\s*(['"])([^'"]+)\1$/);
            if (keyMatch) return event.key === keyMatch[2];
            return false;
        });
    }

    function executeStatements(statements, event, el) {
        for (const raw of statements) {
            const stmt = raw.trim();
            if (!stmt) continue;

            const ifMatch = stmt.match(/^if\s*\(([\s\S]*?)\)\s*([\s\S]+)$/);
            if (ifMatch) {
                const condition = ifMatch[1];
                let body = ifMatch[2].trim();
                if (evalCondition(condition, event, el)) {
                    if (body.startsWith('{') && body.endsWith('}')) {
                        body = body.slice(1, -1).trim();
                    }
                    executeStatements(splitStatements(body), event, el);
                }
                continue;
            }

            if (stmt === 'event.preventDefault()') {
                event.preventDefault();
                continue;
            }

            if (stmt === 'event.stopPropagation()') {
                event.stopPropagation();
                continue;
            }

            let m = stmt.match(/^this\.classList\.toggle\((['"])([^'"]+)\1\)$/);
            if (m) {
                el.classList.toggle(m[2]);
                continue;
            }

            m = stmt.match(/^this\.nextElementSibling\.classList\.toggle\((['"])([^'"]+)\1\)$/);
            if (m) {
                if (el.nextElementSibling) el.nextElementSibling.classList.toggle(m[2]);
                continue;
            }

            m = stmt.match(/^document\.querySelectorAll\((['"])([^'"]+)\1\)\.forEach\(\s*[A-Za-z_$][\w$]*\s*=>\s*[A-Za-z_$][\w$]*\.checked\s*=\s*(true|false)\s*\)$/);
            if (m) {
                const checked = m[3] === 'true';
                document.querySelectorAll(m[2]).forEach(node => {
                    if ('checked' in node) node.checked = checked;
                });
                continue;
            }

            callExpression(stmt, event, el);
        }
    }

    function compileInlineHandler(code) {
        const source = String(code || '').trim().replace(/;+\s*$/, '');
        if (!source) return null;
        if (compileCache.has(source)) return compileCache.get(source);
        const statements = splitStatements(source);
        if (!statements.length) return null;
        const fn = function (event) {
            executeStatements(statements, event, this);
        };
        compileCache.set(source, fn);
        return fn;
    }

    function bindElement(el) {
        if (!el || el.nodeType !== 1) return;
        for (const [attr, eventName] of Object.entries(EVENT_ATTRS)) {
            if (!el.hasAttribute(attr)) continue;
            const code = el.getAttribute(attr);
            const listener = compileInlineHandler(code);
            if (listener) {
                el.addEventListener(eventName, listener);
            } else {
                console.warn('CSP binding skipped unsupported handler:', code);
            }
            el.removeAttribute(attr);
        }
    }

    function bindSubtree(root) {
        if (!root || root.nodeType !== 1) return;
        bindElement(root);
        root.querySelectorAll('[onclick],[onkeydown],[oninput],[onchange]').forEach(bindElement);
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(mutations => {
            mutations.forEach(m => {
                if (m.type === 'attributes') {
                    bindElement(m.target);
                    return;
                }
                m.addedNodes.forEach(node => {
                    if (node.nodeType === 1) bindSubtree(node);
                });
            });
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: Object.keys(EVENT_ATTRS)
        });
    }

    function init() {
        bindSubtree(document.body || document.documentElement);
        startObserver();
    }

    window.cspBindings = {
        init
    };
})();
