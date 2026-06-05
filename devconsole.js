(() => {
  // ===== Config / Namespace =====
  const PDC_NS = "pdc";

  // ===== Safe storage =====
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  // ===== Utilities =====
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtTime = (d) => d.toLocaleTimeString();
  const fileFromUrl = (u) => ((u || '').split('/').pop() || u || '(inline)').split('?')[0];

  async function copyTextToClipboard(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {}
    try {
      const tmp = document.createElement('textarea');
      tmp.value = value;
      document.body.appendChild(tmp);
      tmp.select();
      const ok = document.execCommand('copy');
      tmp.remove();
      return !!ok;
    } catch {
      return false;
    }
  }

  function flashButtonLabel(btn, nextText, restoreAfter = 1600) {
    if (!btn) return;
    const original = btn.dataset.originalLabel || btn.textContent || '';
    btn.dataset.originalLabel = original;
    btn.textContent = nextText;
    window.setTimeout(() => {
      btn.textContent = btn.dataset.originalLabel || original;
    }, restoreAfter);
  }

  function ensureToastHost() {
    let host = document.getElementById(`${PDC_NS}-toast-host`);
    if (host) return host;
    host = document.createElement('div');
    host.id = `${PDC_NS}-toast-host`;
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'true');
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function showToast(kind, title, message) {
    const host = ensureToastHost();
    const toast = document.createElement('div');
    toast.className = `${PDC_NS}-toast ${PDC_NS}-toast-${kind || 'info'}`;
    toast.innerHTML = `
      <div class="${PDC_NS}-toast-title">${esc(title || '')}</div>
      <div class="${PDC_NS}-toast-msg">${esc(message || '')}</div>
    `;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    window.setTimeout(() => {
      toast.classList.remove('is-visible');
      toast.classList.add('is-hiding');
      window.setTimeout(() => toast.remove(), 360);
    }, 3200);
  }

  function stringifySafe(value, space = 2, maxDepth = 5) {
    const seen = new WeakSet();
    function inner(v, depth) {
      if (v === null || typeof v !== 'object') {
        if (typeof v === 'string') return v;
        if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
        if (v instanceof Error) return `${v.name}: ${v.message}`;
        return v;
      }
      if (seen.has(v)) return '[Circular]';
      if (depth >= maxDepth) return Array.isArray(v) ? `[Array(${v.length})]` : `[Object]`;
      seen.add(v);
      if (v instanceof Element) {
        const id = v.id ? `#${v.id}` : '';
        const cls = v.className ? '.' + String(v.className).trim().replace(/\s+/g,'.') : '';
        return `<${v.tagName.toLowerCase()}${id}${cls}>`;
      }
      if (Array.isArray(v)) return v.map(x => inner(x, depth + 1));
      const out = {};
      for (const k of Object.keys(v)) {
        try { out[k] = inner(v[k], depth + 1); } catch { out[k] = '[Uninspectable]'; }
      }
      return out;
    }
    try { return JSON.stringify(inner(value, 0), null, space); }
    catch { try { return String(value); } catch { return '[Unstringifiable]'; } }
  }

  // ===== Callsite parsing (file:line:col) =====
  const SKIP_RE = /(getCallerLoc|emit|addRowUI|patchConsole|__pdcWrapped(Console|Table)__|console\.(log|info|warn|error|debug|table)|runEval|__pdc|Pseudo Dev Console)/i;

  function extractLocFromLine(line) {
    const trimmed = line.replace(/^\s*at\s+/, '');
    const mNums = trimmed.match(/:(\d+):(\d+)\)?$/);
    if (!mNums) return null;
    const lineNum = parseInt(mNums[1], 10), colNum = parseInt(mNums[2], 10);
    let head = trimmed.slice(0, mNums.index);
    const p = Math.max(head.lastIndexOf('('), head.lastIndexOf('@'));
    if (p !== -1) head = head.slice(p + 1);
    const url = head.trim();
    const file = fileFromUrl(url);
    return { url, file, line: lineNum, col: colNum };
  }

  function getCallerLoc(skipUntilFn) {
    let stackStr = '';
    if (typeof Error.captureStackTrace === 'function' && skipUntilFn) {
      const obj = {};
      Error.captureStackTrace(obj, skipUntilFn);
      stackStr = obj.stack || '';
    } else {
      const e = new Error();
      stackStr = e.stack || '';
    }
    if (!stackStr) return null;
    const lines = stackStr.split('\n').slice(1);
    for (const ln of lines) {
      if (SKIP_RE.test(ln)) continue;
      const loc = extractLocFromLine(ln);
      if (loc) return loc;
    }
    return null;
  }

  // ===== Core state (works before <body>) =====
  const state = {
    uiReady: false,
    logEl: null,
    openBtn: null,
    root: null,
    input: null,
    paused: false,
    minimized: false,
    buffer: [], // { level, args, site, ts: Date }
  };

  // ===== Emit (safe before UI) =====
  function emit(level, args, site) {
    if (!state.uiReady || !state.logEl) {
      state.buffer.push({ level, args, site, ts: new Date() });
      if (state.buffer.length > 2000) state.buffer.splice(0, state.buffer.length - 2000);
      return;
    }
    addRowUI(level, args, site, new Date());
  }

  // ===== DOM building (run once body exists) =====
  function setSafeContent(el, html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const frag = document.createDocumentFragment();
    Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
    el.replaceChildren(frag);
  }
  function ensureStyle() {
    if (document.querySelector('style[data-pdc-style]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-pdc-style','');
    style.textContent = `
    #${PDC_NS}-open {
      position: fixed; z-index: 2147483647; bottom: 12px; right: 12px;
      width: 44px; height: 44px; border-radius: 10px; border: none;
      background: #111; color: #eee; font: 600 16px/1 system-ui,Segoe UI,Roboto,Arial;
      box-shadow: 0 6px 18px rgba(0,0,0,.35); cursor: pointer; user-select: none;
    }
    #${PDC_NS}-root {
      position: fixed; z-index: 2147483647; bottom: 64px; right: 12px; width: 600px; height: 380px;
      display: flex; flex-direction: column; border-radius: 12px; overflow: hidden;
      background: #0e0f12; color: #e7e7e7; box-shadow: 0 12px 30px rgba(0,0,0,.55);
      border: 1px solid #2a2d34;
    }
    #${PDC_NS}-header {
      background: linear-gradient(180deg,#14161b,#101216); padding: 8px 10px; display: flex; gap: 8px; align-items: center;
      user-select:none; border-bottom: 1px solid #22252b;
    }
    #${PDC_NS}-title { cursor: move; font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; opacity:.9; margin-right: auto; }
    .${PDC_NS}-btn {
      border: 1px solid #2d3138; background: #151820; color: #cfd3da; border-radius: 8px; padding: 5px 8px; font: 600 12px/1 system-ui,Segoe UI,Roboto,Arial; cursor: pointer;
    }
    .${PDC_NS}-btn:hover { background: #1b1f29; }
    #${PDC_NS}-log {
      flex: 1; overflow: auto; padding: 8px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #0b0c10;
    }
    .${PDC_NS}-row { border-bottom: 1px dashed #23262c; padding: 6px 0; display:flex; gap:8px; align-items:flex-start; }
    .${PDC_NS}-ts { opacity:.55; margin-right: 4px; flex: none; }
    .${PDC_NS}-lvl { min-width: 38px; text-align:center; flex: none; }
    .${PDC_NS}-src { opacity:.75; font-style: italic; flex: none; }
    .${PDC_NS}-msg { flex:1; min-width:0; }
    .${PDC_NS}-lvl-log .${PDC_NS}-lvl { color: #a3c7ff; } 
    .${PDC_NS}-lvl-info .${PDC_NS}-lvl { color: #89f; }
    .${PDC_NS}-lvl-warn .${PDC_NS}-lvl { color: #ffcc66; }
    .${PDC_NS}-lvl-error .${PDC_NS}-lvl { color: #ff6b6b; }
    .${PDC_NS}-lvl-debug .${PDC_NS}-lvl { color: #b8ff8a; }
    .${PDC_NS}-lvl-eval .${PDC_NS}-lvl { color: #8affd2; }
    .${PDC_NS}-lvl-res  .${PDC_NS}-lvl { color: #8ad2ff; }
    #${PDC_NS}-inputbar { display:flex; gap:8px; align-items:center; padding: 8px; border-top: 1px solid #22252b; background:#0e1016; }
    #${PDC_NS}-prompt { color:#8affd2; font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    #${PDC_NS}-input {
      flex:1; border:1px solid #2a2d34; background:#0c0f15; color:#e7e7e7; border-radius: 8px; padding:8px 10px;
      font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; outline: none;
    }
    #${PDC_NS}-input:focus { border-color: #3a82f6; box-shadow: 0 0 0 3px rgba(58,130,246,.15); }
    .${PDC_NS}-pill { opacity:.7; font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background:#151820; border:1px solid #2d3138; border-radius: 999px; padding: 4px 8px; }
    .${PDC_NS}-row code { background:#13151b; border:1px solid #242833; padding:2px 4px; border-radius:6px; }
    details.${PDC_NS}-collapsible { background: transparent; border: 1px solid #242833; border-radius: 8px; padding: 4px 6px; }
    details.${PDC_NS}-collapsible summary { cursor: pointer; user-select: none; list-style: none; display: inline-flex; gap: 6px; align-items: center; }
    details.${PDC_NS}-collapsible summary::-webkit-details-marker { display:none; }
    .${PDC_NS}-caret { display:inline-block; transform: rotate(0deg); transition: transform .2s ease; }
    details.${PDC_NS}-collapsible[open] > summary .${PDC_NS}-caret { transform: rotate(90deg); }
    pre.${PDC_NS}-pre { margin: 6px 0 0 18px; padding: 8px; background:#0b0e14; border:1px solid #1f2430; border-radius:8px; overflow:auto; max-height: 40vh; }
    #${PDC_NS}-resize {
      position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, #3a82f6 50%);
      opacity: .6;
    }
    #${PDC_NS}-resize:hover { opacity: .9; }
    #${PDC_NS}-toast-host {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      width: min(360px, calc(100vw - 28px));
    }
    .${PDC_NS}-toast {
      border-radius: 16px;
      padding: 14px 16px;
      color: #fff;
      box-shadow: 0 18px 46px rgba(0,0,0,.34);
      border: 1px solid rgba(255,255,255,.18);
      backdrop-filter: blur(10px);
      transform: translateY(-10px) scale(.98);
      opacity: 0;
      transition: opacity .24s ease, transform .24s ease;
    }
    .${PDC_NS}-toast.is-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .${PDC_NS}-toast.is-hiding {
      opacity: 0;
      transform: translateY(-8px) scale(.985);
    }
    .${PDC_NS}-toast-success {
      background: linear-gradient(135deg, rgba(34,197,94,.96), rgba(14,165,233,.94));
    }
    .${PDC_NS}-toast-error {
      background: linear-gradient(135deg, rgba(244,63,94,.96), rgba(249,115,22,.94));
    }
    .${PDC_NS}-toast-info {
      background: linear-gradient(135deg, rgba(99,102,241,.96), rgba(168,85,247,.94));
    }
    .${PDC_NS}-toast-title {
      font: 800 13px/1.15 system-ui,Segoe UI,Roboto,Arial;
      margin-bottom: 5px;
      letter-spacing: .01em;
    }
    .${PDC_NS}-toast-msg {
      font: 600 12px/1.4 system-ui,Segoe UI,Roboto,Arial;
      color: rgba(255,255,255,.94);
    }
    `);
    (document.head || document.documentElement).appendChild(style);
  }

  function buildUI() {
    if (state.uiReady || document.getElementById(`${PDC_NS}-root`)) return;

    ensureStyle();

    const openBtn = document.createElement('button');
    openBtn.id = `${PDC_NS}-open`;
    openBtn.title = 'Open pseudo dev console (Ctrl+~)';
    openBtn.textContent = '<>';
    document.body.appendChild(openBtn);

    const root = document.createElement('div');
    root.id = `${PDC_NS}-root`;
    root.style.display = 'none';
    setSafeContent(root, `
      <div id="${PDC_NS}-header">
        <div id="${PDC_NS}-title">Pseudo Dev Console</div>
        <button class="${PDC_NS}-btn" data-act="copy">Copy All</button>
        <button class="${PDC_NS}-btn" data-act="clear">Clear</button>
        <button class="${PDC_NS}-btn" data-act="pause" aria-pressed="false">Pause</button>
        <button class="${PDC_NS}-btn" data-act="min">Min</button>
        <button class="${PDC_NS}-btn" data-act="close">Close</button>
      </div>
      <div id="${PDC_NS}-log" aria-live="polite" aria-label="Log output"></div>
      <div id="${PDC_NS}-inputbar">
        <span id="${PDC_NS}-prompt">&gt;</span>
        <input id="${PDC_NS}-input" type="text" spellcheck="false" autocomplete="off" placeholder="Type JS and press Enter (Ctrl+&#96;/Ctrl+&quot; history)" />
        <span class="${PDC_NS}-pill">log/info/warn/error/debug/table mirrored here</span>
      </div>
      <div id="${PDC_NS}-resize" aria-hidden="true"></div>
    `);
    document.body.appendChild(root);

    const saved = LS.get(`${PDC_NS}-win`, null);
    if (saved && typeof saved === 'object') {
      for (const k of ['right','bottom','width','height']) if (saved[k]) root.style[k] = saved[k];
    }

    // Drag (title)
    (() => {
      let dragging = null;
      const title = root.querySelector(`#${PDC_NS}-title`);
      title.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = { ox: e.clientX, oy: e.clientY, rect: root.getBoundingClientRect() };
        title.setPointerCapture(e.pointerId);
      });
      title.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragging.ox;
        const dy = e.clientY - dragging.oy;
        root.style.right = (window.innerWidth - dragging.rect.right - dx) + 'px';
        root.style.bottom = (window.innerHeight - dragging.rect.bottom - dy) + 'px';
      });
      title.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = null;
        title.releasePointerCapture(e.pointerId);
        saveWin();
      });
    })();

    // Resize grip
    (() => {
      const grip = root.querySelector(`#${PDC_NS}-resize`);
      let resizing = null;
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const r = root.getBoundingClientRect();
        resizing = { ox: e.clientX, oy: e.clientY, w: r.width, h: r.height };
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener('pointermove', (e) => {
        if (!resizing) return;
        const dx = e.clientX - resizing.ox;
        const dy = e.clientY - resizing.oy;
        root.style.width = Math.max(380, resizing.w + dx) + 'px';
        root.style.height = Math.max(240, resizing.h + dy) + 'px';
      });
      grip.addEventListener('pointerup', (e) => {
        if (!resizing) return;
        resizing = null;
        grip.releasePointerCapture(e.pointerId);
        saveWin();
      });
    })();

    function saveWin() {
      const r = root.getBoundingClientRect();
      LS.set(`${PDC_NS}-win`, {
        right: (window.innerWidth - r.right) + 'px',
        bottom: (window.innerHeight - r.bottom) + 'px',
        width: r.width + 'px',
        height: r.height + 'px'
      });
    }

    // Header buttons
    const actions = root.querySelectorAll(`.${PDC_NS}-btn`);
    const logEl = root.querySelector(`#${PDC_NS}-log`);
    const inputBar = root.querySelector(`#${PDC_NS}-inputbar`);
    actions.forEach(btn => {
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act');
        if (act === 'clear') {
          logEl.textContent = '';
        } else if (act === 'pause') {
          state.paused = !state.paused;
          btn.setAttribute('aria-pressed', String(state.paused));
          btn.textContent = state.paused ? 'Resume' : 'Pause';
        } else if (act === 'min') {
          state.minimized = !state.minimized;
          logEl.style.display = state.minimized ? 'none' : '';
          inputBar.style.display = state.minimized ? 'none' : '';
          btn.textContent = state.minimized ? 'Restore' : 'Min';
        } else if (act === 'close') {
          root.style.display = 'none';
          state.openBtn.style.display = '';
        } else if (act === 'copy') {
          copyTextToClipboard(logEl.innerText || '').then((ok) => {
            if (ok) {
              flashButtonLabel(btn, 'Copied');
              showToast('success', 'Copied to clipboard', 'Paste the DevConsole output into the Debug Prompt in Forge.');
            } else {
              flashButtonLabel(btn, 'Copy Failed');
              showToast('error', 'Copy failed', 'Select the DevConsole output manually, then paste it into the Debug Prompt in Forge.');
            }
          });
        }
      });
    });

    // Open/Close & hotkey
    function openConsole() {
      root.style.display = '';
      state.openBtn.style.display = 'none';
      setTimeout(() => state.input && state.input.focus(), 0);
    }
    state.openBtn = openBtn;
    openBtn.addEventListener('click', openConsole);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === '`' || e.key === '~')) {
        e.preventDefault();
        if (root.style.display === 'none') openConsole();
        else { root.style.display = 'none'; state.openBtn.style.display = ''; }
      }
    });

    // Wire for logging
    state.logEl = logEl;
    state.root = root;
    state.input = root.querySelector(`#${PDC_NS}-input`);

    // REPL
    let history = LS.get(`${PDC_NS}-hist`, []);
    let hIdx = history.length;
    function runEval(code) {
      if (!code.trim()) return;
      emit('eval', [code], { url: '[REPL]', file: '[REPL]' });
      let res;
      try {
        res = (0, eval)(code);
        if (res instanceof Promise) {
          res.then(v => emit('res', [v], { url: '[REPL]', file: '[REPL]' }))
             .catch(e => emit('error', [e], { url: '[REPL]', file: '[REPL]' }));
        } else {
          emit('res', [res], { url: '[REPL]', file: '[REPL]' });
        }
      } catch (e) {
        emit('error', [e], { url: '[REPL]', file: '[REPL]' });
      }
    }
    state.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const code = state.input.value;
        history.push(code);
        if (history.length > 200) history = history.slice(-200);
        LS.set(`${PDC_NS}-hist`, history);
        hIdx = history.length;
        state.input.value = '';
        runEval(code);
      } else if (e.key === 'ArrowUp') {
        if (hIdx > 0) { hIdx--; state.input.value = history[hIdx] || ''; state.input.setSelectionRange(state.input.value.length, state.input.value.length); e.preventDefault(); }
      } else if (e.key === 'ArrowDown') {
        if (hIdx < history.length) { hIdx++; state.input.value = history[hIdx] || ''; state.input.setSelectionRange(state.input.value.length, state.input.value.length); e.preventDefault(); }
      }
    });

    // Flush buffer
    state.uiReady = true;
    if (state.buffer.length) {
      const toFlush = state.buffer.slice();
      state.buffer.length = 0;
      for (const it of toFlush) addRowUI(it.level, it.args, it.site, it.ts);
    }
    emit('info', ['Pseudo Dev Console ready. Type code below and press Enter. Use console.log/info/warn/error/debug/table as usual.'], null);
  }

  // ===== Add one row to UI =====
  function summaryFor(value) {
    if (value instanceof Error) return `${value.name}: ${value.message || ''}`;
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      const head = keys.slice(0, 5).join(', ');
      return `Object { ${head}${keys.length > 5 ? ', …' : ''} }`;
    }
    if (typeof value === 'string') {
      const first = value.split(/\r?\n/)[0];
      const s = first.length > 140 ? first.slice(0, 140) + '…' : first;
      return JSON.stringify(s);
    }
    return String(value);
  }

  function makeCollapsible(previewText, fullText) {
    const details = document.createElement('details');
    details.className = `${PDC_NS}-collapsible`;
    const summary = document.createElement('summary');
    const caret = document.createElement('span');
    caret.className = `${PDC_NS}-caret`;
    caret.textContent = '▸';
    const label = document.createElement('code');
    label.textContent = previewText;
    summary.appendChild(caret);
    summary.appendChild(label);
    const pre = document.createElement('pre');
    pre.className = `${PDC_NS}-pre`;
    const code = document.createElement('code');
    code.textContent = fullText;
    pre.appendChild(code);
    details.appendChild(summary);
    details.appendChild(pre);
    return details;
  }

  function partToNode(p) {
    if (p instanceof Error) {
      const full = p.stack ? String(p.stack) : (p.name + ': ' + p.message);
      return makeCollapsible(summaryFor(p), full);
    }
    if (p && typeof p === 'object') {
      return makeCollapsible(summaryFor(p), stringifySafe(p, 2, 8));
    }
    if (typeof p === 'string' && (p.length > 140 || /\n/.test(p))) {
      return makeCollapsible(summaryFor(p), p);
    }
    const code = document.createElement('code');
    code.textContent = typeof p === 'string' ? p : String(p);
    return code;
  }

  function addRowUI(level, parts, site, tsDate) {
    if (!state.logEl) return;

    const row = document.createElement('div');
    row.className = `${PDC_NS}-row ${PDC_NS}-lvl-${level}`;

    const ts = document.createElement('span');
    ts.className = `${PDC_NS}-ts`;
    ts.textContent = `[${fmtTime(tsDate || new Date())}]`;

    const lvl = document.createElement('span');
    lvl.className = `${PDC_NS}-lvl`;
    lvl.textContent = level.toUpperCase();

    const src = document.createElement('span');
    src.className = `${PDC_NS}-src`;
    if (site && (site.file || site.url)) {
      src.title = site.url || site.file;
      src.textContent = (site.file || '(inline)') + (site.line ? `:${site.line}${site.col ? ':' + site.col : ''}` : '');
    } else {
      src.textContent = '';
    }

    const msg = document.createElement('span');
    msg.className = `${PDC_NS}-msg`;
    try { for (const p of parts) msg.appendChild(partToNode(p)); }
    catch {
      const code = document.createElement('code');
      code.textContent = parts.map(String).join(' ');
      msg.appendChild(code);
    }

    row.appendChild(ts);
    row.appendChild(lvl);
    row.appendChild(src);
    row.appendChild(msg);
    state.logEl.appendChild(row);

    if (!state.paused) {
      const atBottom = (state.logEl.scrollTop + state.logEl.clientHeight) >= (state.logEl.scrollHeight - 24);
      if (atBottom) state.logEl.scrollTop = state.logEl.scrollHeight;
    }
  }

  // ===== Console patch (works before body) =====
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
    table: console.table ? console.table.bind(console) : null
  };
  window.__originalConsole__ = originalConsole;

  function patchConsole() {
    ['log','info','warn','error','debug'].forEach(lvl => {
      const wrapped = function __pdcWrappedConsole__(...args) {
        let site = null;
        try { site = getCallerLoc(wrapped); } catch {}
        try { emit(lvl, args, site); } catch {}
        try { originalConsole[lvl](...args); } catch {}
      };
      console[lvl] = wrapped;
    });

    const wrappedTable = function __pdcWrappedTable__(data, columns) {
      let site = null;
      try { site = getCallerLoc(wrappedTable); } catch {}
      try {
        const arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.entries(data).map(([k,v]) => ({key:k, value:v})) : [{value:data}]);
        const cols = columns && Array.isArray(columns) && columns.length ? columns
                     : Array.from(arr.reduce((set, obj) => { Object.keys(obj||{}).forEach(k=>set.add(k)); return set; }, new Set()));
        const headers = cols.map(c => `<th>${esc(String(c))}</th>`).join('');
        const rows = arr.map(obj => `<tr>${cols.map(c => `<td><code>${esc(stringifySafe(obj ? obj[c] : undefined))}</code></td>`).join('')}</tr>`).join('');
        emit('log', [`\n<table border="1" style="border-collapse:collapse;font-size:12px"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`], site);
      } catch (e) {
        emit('error', ['console.table failed:', e], site);
      }
      try { originalConsole.table && originalConsole.table(data, columns); } catch {}
    };
    console.table = wrappedTable;
  }
  patchConsole();

  // ===== Error handling =====
  // 1) Legacy onerror (often best for SyntaxError with line/col)
  const prevOnError = window.onerror;
  window.onerror = function(message, source, lineno, colno, error) {
    const site = source ? { url: source, file: fileFromUrl(source), line: lineno || 0, col: colno || 0 } : null;
    // Prefer the Error object if present; otherwise use the text message.
    emit('error', [error || String(message)], site);
    if (typeof prevOnError === 'function') {
      try { return prevOnError.apply(this, arguments); } catch {}
    }
    // Return false to allow default logging as well
    return false;
  };

  // 2) Global 'error' event (capture phase) – catches both ErrorEvent *and* resource/script-tag errors
  window.addEventListener('error', (e) => {
    // ErrorEvent with details (runtime or parse errors)
    if ('message' in e && (e.message || e.filename || e.error)) {
      const site = (e.filename || e.lineno || e.colno) ? {
        url: e.filename || '(inline)',
        file: fileFromUrl(e.filename || '(inline)'),
        line: e.lineno || 0,
        col: e.colno || 0
      } : null;
      emit('error', [e.error || e.message || 'Error'], site);
      return;
    }

    // Resource / <scr ipt> element error -> often no details; show best-effort + CORS hint.
    const t = e.target;
    if (t && t.tagName === 'SCRIPT') {
      const src = t.src || '(inline <sc'+'ript>)';
      let note = '';
      try {
        const origin = new URL(src, location.href).origin;
        if (origin !== location.origin && !t.crossOrigin) {
          note = ' (cross-origin; add crossorigin="anonymous" on the <scri'+'pt> and serve with Access-Control-Allow-Origin to see line/col)';
        }
      } catch {}
      emit('error', [`Script load/parsing error: ${src}${note}`], { url: src, file: fileFromUrl(src) });
    }
  }, true);

  // 3) Unhandled promise rejections (module parse errors can surface here)
  window.addEventListener('unhandledrejection', (e) => {
    // Try to include stack/location when available
    const reason = e.reason;
    let site = null;
    if (reason && reason.stack) {
      const first = String(reason.stack).split('\n').find(l => !SKIP_RE.test(l));
      const loc = first && extractLocFromLine(first);
      if (loc) site = loc;
    }
    emit('error', ['UnhandledRejection:', reason instanceof Error ? reason : String(reason)], site);
  });

  // ===== Fetch logging (works before body) =====
  if (!window.__pdcFetchPatched) {
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = async (...args) => {
        const [input, init] = args;
        const method = (init && init.method) || 'GET';
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        emit('info', [`fetch → ${method} ${url}`], null);
        try {
          const resp = await origFetch(...args);
          emit('info', [`fetch ← ${resp.status} ${resp.statusText || ''} (${url})`], null);
          return resp;
        } catch (err) {
          emit('error', [`fetch ✖ (${url})`, err], null);
          throw err;
        }
      };
      window.__pdcFetchPatched = true;
    }
  }

  // ===== Body-ready detection =====
  function whenBodyReady(cb) {
    if (document.body) return cb();
    const onReady = () => { if (document.body) { cleanup(); cb(); } };
    const cleanup = () => {
      document.removeEventListener('DOMContentLoaded', onReady);
      if (mo) mo.disconnect();
    };
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
    const mo = new MutationObserver(() => { if (document.body) { onReady(); } });
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
  }

  // Boot UI
  whenBodyReady(buildUI);

  // Expose tiny API
  window.__PseudoDevConsole = {
    toggle() {
      const r = document.getElementById(`${PDC_NS}-root`);
      const b = document.getElementById(`${PDC_NS}-open`);
      if (r && r.style.display === 'none') { r.style.display=''; if (b) b.style.display='none'; }
      else if (r) { r.style.display='none'; if (b) b.style.display=''; }
    },
    buffer: state.buffer,
    restoreConsole() { for (const k of Object.keys(window.__originalConsole__||{})) console[k] = window.__originalConsole__[k]; }
  };
})();


