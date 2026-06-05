// DevConsole Tab Module
const devConsoleTab = {
    _setSafeContent(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
        el.replaceChildren(frag);
    },
    init() {
        //this.addTabToNav();
        this.addTabContent();
        this.bindEvents();
    },

    addTabToNav() {
        // Add the DevConsole tab to the navigation
        const tabNav = document.querySelector('#myTab');
        const newTabItem = document.createElement('li');
        newTabItem.className = 'nav-item';
        const a = document.createElement('a');
        a.className = 'nav-link';
        a.id = 'devconsole-tab';
        a.setAttribute('data-toggle', 'tab');
        a.setAttribute('href', '#devconsole');
        a.setAttribute('role', 'tab');
        a.textContent = 'DevConsole Tool';
        newTabItem.appendChild(a);
        
        // Insert before the last tab (AI Helper)
        const aiHelperTab = tabNav.querySelector('li:last-child');
        tabNav.insertBefore(newTabItem, aiHelperTab);
    },

    addTabContent() {
        // Add or populate the DevConsole tab content without duplicating the pane
        const tabContent = document.querySelector('#myTabContent');
        if (!tabContent) return;

        // If an element with id "devconsole" already exists (provided by index.html), reuse it.
        let devPane = document.getElementById('devconsole');
        const shouldInsert = !devPane;
        if (!devPane) {
            devPane = document.createElement('div');
            devPane.className = 'tab-pane fade';
            devPane.id = 'devconsole';
            devPane.setAttribute('role', 'tabpanel');
        }

        this._setSafeContent(devPane, `
            <div class="devconsole-container">
                <h3>DevConsole Tool</h3>
                <p class="mb-4">The DevConsole is a powerful debugging and development tool that provides a comprehensive console interface for your web applications, especially useful when developing offline or in restricted environments.</p>
                
                                <div class="status-section mb-4">
                    <h4>📊 Integration Status</h4>
                    <div id="devconsole-status" class="status-indicator">
                        <span class="status-badge" id="status-badge">Checking...</span>
                        <span id="status-message">Checking if DevConsole is already integrated...</span>
                        <button id="refresh-status-btn" class="btn btn-sm btn-outline-secondary ml-2">🔄 Refresh</button>
                    </div>
                </div>

                <div class="actions-section">
                    <h4>🛠️ Integration Options</h4>
                    <div class="btn-group-vertical w-100">
                        <button id="copy-devconsole-btn" class="btn btn-info btn-lg mb-2">
                            📋 Copy DevConsole Code
                        </button>
                        <button id="add-devconsole-btn" class="btn btn-success btn-lg mb-2" disabled>
                            ➕ Add DevConsole to Project
                        </button>
                        <button id="view-devconsole-btn" class="btn btn-secondary btn-lg mb-2" style="display:none;">
                            👀 View Existing DevConsole
                        </button>
                        <button id="update-devconsole-btn" class="btn btn-warning btn-lg mb-2" style="display:none;">
                            🔄 Update DevConsole
                        </button>
                    </div>
          <div id="add-devconsole-progress" class="progress-indicator" aria-live="polite" style="display:none;">
            <span class="spinner" aria-hidden="true"></span>
            <span id="add-devconsole-progress-text">Preparing to add DevConsole...</span>
          </div>
                </div>

                <div class="instructions-section mt-4">
                    <h4>📝 Manual Integration Instructions</h4>
                    <div class="alert alert-info">
                        <p><strong>To manually add DevConsole to any HTML file:</strong></p>
                        <ol>
                            <li>Copy the DevConsole code using the button above</li>
                            <li>Save it as <code>devconsole.js</code> in your project</li>
                            <li>Add this line to the &lt;head&gt; section of your HTML:</li>
                        </ol>
                        <pre class="bg-dark text-light p-2 rounded"><code>&lt;script src="devconsole.js"&gt;&lt;/script&gt;</code></pre>
                        <p class="mb-0"><strong>That's it!</strong> The console will appear as a floating button in the bottom-right corner. Click it or press Ctrl+~ to open.</p>
                    </div>
                </div>
                
                <div class="feature-section mb-4">
                    <h4>✨ Key Features</h4>
                    <ul class="feature-list">
                        <li><strong>Complete Console Replacement:</strong> Captures all console.log, warn, error, info, debug, and table calls</li>
                        <li><strong>Error Tracking:</strong> Automatically catches and displays JavaScript errors with line numbers and stack traces</li>
                        <li><strong>Interactive REPL:</strong> Built-in JavaScript evaluation with command history (↑/↓ arrows)</li>
                        <li><strong>Network Monitoring:</strong> Logs all fetch requests and responses</li>
                        <li><strong>Persistent Storage:</strong> Remembers window position, size, and command history</li>
                        <li><strong>Offline Capable:</strong> Works completely offline without external dependencies</li>
                        <li><strong>Hotkey Access:</strong> Press Ctrl+~ to quickly toggle the console</li>
                        <li><strong>Professional UI:</strong> Clean, dark-themed interface that doesn't interfere with your app</li>
                    </ul>
                </div>

                <div class="integration-section mb-4">
                    <h4>🚀 Perfect For</h4>
                    <ul class="use-cases">
                        <li>Offline web applications that need debugging capabilities</li>
                        <li>Static HTML apps where traditional dev tools might be limited</li>
                        <li>Educational environments with restricted internet access</li>
                        <li>Any application that needs a self-contained debugging solution</li>
                    </ul>
                </div>


            </div>

            <style>
                .devconsole-container {
                    max-width: 1000px;
                }
                
                .feature-list, .use-cases {
                    padding-left: 1.5rem;
                }
                
                .feature-list li, .use-cases li {
                    margin-bottom: 0.5rem;
                    line-height: 1.5;
                }
                
                .status-indicator {
                    padding: 1rem;
                    background-color: #343a40;
                    border: 1px solid #495057;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                }
                
                .status-badge {
                    padding: 0.25rem 0.75rem;
                    border-radius: 1rem;
                    font-weight: bold;
                    font-size: 0.875rem;
                    text-transform: uppercase;
                }
                
                .status-badge.not-found {
                    background-color: #dc3545;
                    color: white;
                }
                
                .status-badge.found {
                    background-color: #28a745;
                    color: white;
                }
                
                .status-badge.checking {
                    background-color: #ffc107;
                    color: #212529;
                }
                
                .actions-section .btn {
                    transition: all 0.2s ease;
                }
                
                .actions-section .btn:hover:not(:disabled) {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                }
                
                pre code {
                    font-size: 0.9rem;
                }
                
                .alert {
                    border: 1px solid #495057;
                    background-color: #1a202c;
                }
                
                .alert-info {
                    border-color: #17a2b8;
                }

        .progress-indicator {
          display: none;
          align-items: center;
          gap: 0.75rem;
          margin-top: 0.75rem;
          padding: 0.75rem 1rem;
          border: 1px solid #495057;
          border-radius: 8px;
          background-color: #1a202c;
          color: #e9ecef;
        }

        .progress-indicator.loading {
          border-color: #ffc107;
        }

        .progress-indicator.success {
          border-color: #28a745;
        }

        .progress-indicator.error {
          border-color: #dc3545;
        }

        .progress-indicator .spinner {
          width: 1.1rem;
          height: 1.1rem;
          border: 2px solid rgba(233, 236, 239, 0.25);
          border-top-color: currentColor;
          border-radius: 50%;
          animation: devconsole-spin 0.8s linear infinite;
        }

        .progress-indicator:not(.loading) .spinner {
          display: none;
        }

        @keyframes devconsole-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
            </style>
        `);

        // Only insert if the pane didn't already exist
        if (shouldInsert) {
            // Insert before the AI Helper tab content to keep ordering consistent
            const aiHelperContent = tabContent.querySelector('#ai-helper');
            if (aiHelperContent) {
                tabContent.insertBefore(devPane, aiHelperContent);
            } else {
                tabContent.appendChild(devPane);
            }
        }
    },

    bindEvents() {
        // Copy DevConsole code button
        document.getElementById('copy-devconsole-btn').addEventListener('click', () => {
            this.copyDevConsoleCode();
        });

        // Add DevConsole to project button
        document.getElementById('add-devconsole-btn').addEventListener('click', () => {
            this.addDevConsoleToProject();
        });

        // View existing DevConsole button
        document.getElementById('view-devconsole-btn').addEventListener('click', () => {
            this.viewExistingDevConsole();
        });

        // Update DevConsole button
        document.getElementById('update-devconsole-btn').addEventListener('click', () => {
            this.updateDevConsole();
        });

        // Refresh status button
        document.getElementById('refresh-status-btn').addEventListener('click', () => {
            this.checkDevConsoleStatus();
        });

        // Check status when tab is shown
        document.getElementById('devconsole-tab').addEventListener('shown.bs.tab', () => {
            console.log('DevConsole: Tab shown event triggered');
            // Add a small delay to ensure DOM is ready
            setTimeout(() => {
                this.checkDevConsoleStatus();
            }, 100);
        });

        // Also check status when tab is clicked (immediate feedback)
        document.getElementById('devconsole-tab').addEventListener('click', () => {
            console.log('DevConsole: Tab clicked');
            setTimeout(() => {
                this.checkDevConsoleStatus();
            }, 200);
        });
    },

    async checkDevConsoleStatus() {
        const statusBadge = document.getElementById('status-badge');
        const statusMessage = document.getElementById('status-message');
        const addBtn = document.getElementById('add-devconsole-btn');
        const viewBtn = document.getElementById('view-devconsole-btn');
        const updateBtn = document.getElementById('update-devconsole-btn');

        // Reset buttons
        addBtn.style.display = 'block';
        viewBtn.style.display = 'none';
        updateBtn.style.display = 'none';
        addBtn.disabled = true;

        statusBadge.className = 'status-badge checking';
        statusBadge.textContent = 'Checking...';
        statusMessage.textContent = 'Checking if DevConsole is already integrated...';

        console.log('DevConsole: Starting status check');
        console.log('DevConsole: loadFolder available:', !!loadFolder);
        console.log('DevConsole: loadFolder.fileHandle available:', !!(loadFolder && loadFolder.fileHandle));

        // Set a timeout to prevent hanging
        const timeoutId = setTimeout(() => {
            console.log('DevConsole: Status check timed out, enabling add button');
            statusBadge.className = 'status-badge not-found';
            statusBadge.textContent = 'Timeout';
            statusMessage.textContent = 'Status check timed out. You can still try to add DevConsole.';
            addBtn.disabled = false;
        }, 3000);

        try {
            // Check if we have a loaded directory
            if (!loadFolder || !loadFolder.fileHandle) {
                clearTimeout(timeoutId);
                statusBadge.className = 'status-badge not-found';
                statusBadge.textContent = 'No Project';
                statusMessage.textContent = 'Load a directory first to check for DevConsole integration.';
                console.log('DevConsole: No project loaded');
                return;
            }

            // Check if devconsole.js exists in the project
            const hasDevConsole = await this.checkForDevConsoleFile();
            clearTimeout(timeoutId);
            console.log('DevConsole: File check result:', hasDevConsole);
            
            if (hasDevConsole) {
                statusBadge.className = 'status-badge found';
                statusBadge.textContent = 'Found';
                statusMessage.textContent = 'DevConsole is already integrated in your project!';
                
                addBtn.style.display = 'none';
                viewBtn.style.display = 'block';
                updateBtn.style.display = 'block';
            } else {
                statusBadge.className = 'status-badge not-found';
                statusBadge.textContent = 'Not Found';
                statusMessage.textContent = 'DevConsole is not yet integrated. You can add it to your project.';
                
                addBtn.disabled = false;
            }
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('DevConsole status check error:', error);
            statusBadge.className = 'status-badge not-found';
            statusBadge.textContent = 'Error';
            statusMessage.textContent = 'Error checking DevConsole status. You can still try to add it.';
            // Enable the add button even on error, so users can still try to add it
            addBtn.disabled = false;
        }
    },

    async checkForDevConsoleFile() {
        try {
            console.log('DevConsole: Checking for file using File System Access API');
            // Try to access the devconsole.js file directly
            if (loadFolder && loadFolder.fileHandle) {
                const devConsoleHandle = await loadFolder.fileHandle.getFileHandle('devconsole.js');
                console.log('DevConsole: File found via File System Access API');
                return !!devConsoleHandle;
            }
        } catch (error) {
            console.log('DevConsole: File not found via File System Access API:', error.message);
            // File doesn't exist or can't be accessed
        }
        
        // Fallback: Try to check if loadFolder has a files array
        try {
            if (loadFolder && loadFolder.fileStructure && Array.isArray(loadFolder.fileStructure)) {
                const hasFile = loadFolder.fileStructure.some(file => file.name === 'devconsole.js');
                console.log('DevConsole: File check via fileStructure array:', hasFile);
                return hasFile;
            }
        } catch (error) {
            console.log('DevConsole: FileStructure array check failed:', error.message);
        }
        
        return false;
    },

    getDevConsoleCode() {
        // Return the complete DevConsole code directly embedded
        return `(() => {
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
    let host = document.getElementById(\`\${PDC_NS}-toast-host\`);
    if (host) return host;
    host = document.createElement('div');
    host.id = \`\${PDC_NS}-toast-host\`;
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'true');
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function showToast(kind, title, message) {
    const host = ensureToastHost();
    const toast = document.createElement('div');
    toast.className = \`\${PDC_NS}-toast \${PDC_NS}-toast-\${kind || 'info'}\`;
    toast.innerHTML =
      '<div class="' + PDC_NS + '-toast-title">' + esc(title || '') + '</div>' +
      '<div class="' + PDC_NS + '-toast-msg">' + esc(message || '') + '</div>';
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
        if (typeof v === 'function') return \`[Function \${v.name || 'anonymous'}]\`;
        if (v instanceof Error) return \`\${v.name}: \${v.message}\`;
        return v;
      }
      if (seen.has(v)) return '[Circular]';
      if (depth >= maxDepth) return Array.isArray(v) ? \`[Array(\${v.length})]\` : \`[Object]\`;
      seen.add(v);
      if (v instanceof Element) {
        const id = v.id ? \`#\${v.id}\` : '';
        const cls = v.className ? '.' + String(v.className).trim().replace(/\\s+/g,'.') : '';
        return \`<\${v.tagName.toLowerCase()}\${id}\${cls}>\`;
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
  const SKIP_RE = /(getCallerLoc|emit|addRowUI|patchConsole|__pdcWrapped(Console|Table)__|console\\.(log|info|warn|error|debug|table)|runEval|__pdc|Pseudo Dev Console)/i;

  function extractLocFromLine(line) {
    const trimmed = line.replace(/^\\s*at\\s+/, '');
    const mNums = trimmed.match(/(\\d+):(\\d+)\\)?$/);
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
    const lines = stackStr.split('\\n').slice(1);
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
  function ensureStyle() {
    if (document.querySelector('style[data-pdc-style]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-pdc-style','');
    style.textContent = \`
    #\${PDC_NS}-open {
      position: fixed; z-index: 2147483647; bottom: 12px; right: 12px;
      width: 44px; height: 44px; border-radius: 10px; border: none;
      background: #111; color: #eee; font: 600 16px/1 system-ui,Segoe UI,Roboto,Arial;
      box-shadow: 0 6px 18px rgba(0,0,0,.35); cursor: pointer; user-select: none;
    }
    #\${PDC_NS}-root {
      position: fixed; z-index: 2147483647; bottom: 64px; right: 12px; width: 600px; height: 380px;
      display: flex; flex-direction: column; border-radius: 12px; overflow: hidden;
      background: #0e0f12; color: #e7e7e7; box-shadow: 0 12px 30px rgba(0,0,0,.55);
      border: 1px solid #2a2d34;
    }
    #\${PDC_NS}-header {
      background: linear-gradient(180deg,#14161b,#101216); padding: 8px 10px; display: flex; gap: 8px; align-items: center;
      user-select:none; border-bottom: 1px solid #22252b;
    }
    #\${PDC_NS}-title { cursor: move; font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; opacity:.9; margin-right: auto; }
    .\${PDC_NS}-btn {
      border: 1px solid #2d3138; background: #151820; color: #cfd3da; border-radius: 8px; padding: 5px 8px; font: 600 12px/1 system-ui,Segoe UI,Roboto,Arial; cursor: pointer;
    }
    .\${PDC_NS}-btn:hover { background: #1b1f29; }
    #\${PDC_NS}-log {
      flex: 1; overflow: auto; padding: 8px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #0b0c10;
    }
    .\${PDC_NS}-row { border-bottom: 1px dashed #23262c; padding: 6px 0; display:flex; gap:8px; align-items:flex-start; }
    .\${PDC_NS}-ts { opacity:.55; margin-right: 4px; flex: none; }
    .\${PDC_NS}-lvl { min-width: 38px; text-align:center; flex: none; }
    .\${PDC_NS}-src { opacity:.75; font-style: italic; flex: none; }
    .\${PDC_NS}-msg { flex:1; min-width:0; }
    .\${PDC_NS}-lvl-log .\${PDC_NS}-lvl { color: #a3c7ff; } 
    .\${PDC_NS}-lvl-info .\${PDC_NS}-lvl { color: #89f; }
    .\${PDC_NS}-lvl-warn .\${PDC_NS}-lvl { color: #ffcc66; }
    .\${PDC_NS}-lvl-error .\${PDC_NS}-lvl { color: #ff6b6b; }
    .\${PDC_NS}-lvl-debug .\${PDC_NS}-lvl { color: #b8ff8a; }
    .\${PDC_NS}-lvl-eval .\${PDC_NS}-lvl { color: #8affd2; }
    .\${PDC_NS}-lvl-res  .\${PDC_NS}-lvl { color: #8ad2ff; }
    #\${PDC_NS}-inputbar { display:flex; gap:8px; align-items:center; padding: 8px; border-top: 1px solid #22252b; background:#0e1016; }
    #\${PDC_NS}-prompt { color:#8affd2; font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    #\${PDC_NS}-input {
      flex:1; border:1px solid #2a2d34; background:#0c0f15; color:#e7e7e7; border-radius: 8px; padding:8px 10px;
      font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; outline: none;
    }
    #\${PDC_NS}-input:focus { border-color: #3a82f6; box-shadow: 0 0 0 3px rgba(58,130,246,.15); }
    .\${PDC_NS}-pill { opacity:.7; font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background:#151820; border:1px solid #2d3138; border-radius: 999px; padding: 4px 8px; }
    .\${PDC_NS}-row code { background:#13151b; border:1px solid #242833; padding:2px 4px; border-radius:6px; }
    details.\${PDC_NS}-collapsible { background: transparent; border: 1px solid #242833; border-radius: 8px; padding: 4px 6px; }
    details.\${PDC_NS}-collapsible summary { cursor: pointer; user-select: none; list-style: none; display: inline-flex; gap: 6px; align-items: center; }
    details.\${PDC_NS}-collapsible summary::-webkit-details-marker { display:none; }
    .\${PDC_NS}-caret { display:inline-block; transform: rotate(0deg); transition: transform .2s ease; }
    details.\${PDC_NS}-collapsible[open] > summary .\${PDC_NS}-caret { transform: rotate(90deg); }
    pre.\${PDC_NS}-pre { margin: 6px 0 0 18px; padding: 8px; background:#0b0e14; border:1px solid #1f2430; border-radius:8px; overflow:auto; max-height: 40vh; }
    #\${PDC_NS}-resize {
      position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, #3a82f6 50%);
      opacity: .6;
    }
    #\${PDC_NS}-resize:hover { opacity: .9; }
    #\${PDC_NS}-toast-host {
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
    .\${PDC_NS}-toast {
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
    .\${PDC_NS}-toast.is-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .\${PDC_NS}-toast.is-hiding {
      opacity: 0;
      transform: translateY(-8px) scale(.985);
    }
    .\${PDC_NS}-toast-success {
      background: linear-gradient(135deg, rgba(34,197,94,.96), rgba(14,165,233,.94));
    }
    .\${PDC_NS}-toast-error {
      background: linear-gradient(135deg, rgba(244,63,94,.96), rgba(249,115,22,.94));
    }
    .\${PDC_NS}-toast-info {
      background: linear-gradient(135deg, rgba(99,102,241,.96), rgba(168,85,247,.94));
    }
    .\${PDC_NS}-toast-title {
      font: 800 13px/1.15 system-ui,Segoe UI,Roboto,Arial;
      margin-bottom: 5px;
      letter-spacing: .01em;
    }
    .\${PDC_NS}-toast-msg {
      font: 600 12px/1.4 system-ui,Segoe UI,Roboto,Arial;
      color: rgba(255,255,255,.94);
    }
    \`;
    (document.head || document.documentElement).appendChild(style);
  }

  function setSafeContent(el, html) {\n    const parser = new DOMParser();\n    const doc = parser.parseFromString(html, 'text/html');\n    const frag = document.createDocumentFragment();\n    Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));\n    el.replaceChildren(frag);\n  }\n\n  function buildUI() {
    if (state.uiReady || document.getElementById(\`\${PDC_NS}-root\`)) return;

    ensureStyle();

    const openBtn = document.createElement('button');
    openBtn.id = \`\${PDC_NS}-open\`;
    openBtn.title = 'Open pseudo dev console (Ctrl+~)';
    openBtn.textContent = '<>';
    document.body.appendChild(openBtn);

    const root = document.createElement('div');
    root.id = \`\${PDC_NS}-root\`;
    root.style.display = 'none';
    const pns = PDC_NS;
    const html = ''+
      '<div id="'+pns+'-header">'+
        '<div id="'+pns+'-title">Pseudo Dev Console</div>'+
        '<button class="'+pns+'-btn" data-act="copy">Copy All</button>'+
        '<button class="'+pns+'-btn" data-act="clear">Clear</button>'+
        '<button class="'+pns+'-btn" data-act="pause" aria-pressed="false">Pause</button>'+
        '<button class="'+pns+'-btn" data-act="min">Min</button>'+
        '<button class="'+pns+'-btn" data-act="close">Close</button>'+
      '</div>'+
      '<div id="'+pns+'-log" aria-live="polite" aria-label="Log output"></div>'+
      '<div id="'+pns+'-inputbar">'+
        '<span id="'+pns+'-prompt">&gt;</span>'+
        '<input id="'+pns+'-input" type="text" spellcheck="false" autocomplete="off" placeholder="Type JS and press Enter (Ctrl+&#96;/Ctrl+&quot; history)" />'+
        '<span class="'+pns+'-pill">log/info/warn/error/debug/table mirrored here</span>'+
      '</div>'+
      '<div id="'+pns+'-resize" aria-hidden="true"></div>';
    setSafeContent(root, html);
    document.body.appendChild(root);

    const saved = LS.get(\`\${PDC_NS}-win\`, null);
    if (saved && typeof saved === 'object') {
      for (const k of ['right','bottom','width','height']) if (saved[k]) root.style[k] = saved[k];
    }

    // Drag (title)
    (() => {
      let dragging = null;
      const title = root.querySelector(\`#\${PDC_NS}-title\`);
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
      const grip = root.querySelector(\`#\${PDC_NS}-resize\`);
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
      LS.set(\`\${PDC_NS}-win\`, {
        right: (window.innerWidth - r.right) + 'px',
        bottom: (window.innerHeight - r.bottom) + 'px',
        width: r.width + 'px',
        height: r.height + 'px'
      });
    }

    // Header buttons
    const actions = root.querySelectorAll(\`.\${PDC_NS}-btn\`);
    const logEl = root.querySelector(\`#\${PDC_NS}-log\`);
    const inputBar = root.querySelector(\`#\${PDC_NS}-inputbar\`);
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
      if (e.ctrlKey && (e.key === '\`' || e.key === '~')) {
        e.preventDefault();
        if (root.style.display === 'none') openConsole();
        else { root.style.display = 'none'; state.openBtn.style.display = ''; }
      }
    });

    // Wire for logging
    state.logEl = logEl;
    state.root = root;
    state.input = root.querySelector(\`#\${PDC_NS}-input\`);

    // REPL
    let history = LS.get(\`\${PDC_NS}-hist\`, []);
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
        LS.set(\`\${PDC_NS}-hist\`, history);
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
    if (value instanceof Error) return \`\${value.name}: \${value.message || ''}\`;
    if (Array.isArray(value)) return \`Array(\${value.length})\`;
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      const head = keys.slice(0, 5).join(', ');
      return \`Object { \${head}\${keys.length > 5 ? ', …' : ''} }\`;
    }
    if (typeof value === 'string') {
      const first = value.split(/\\r?\\n/)[0];
      const s = first.length > 140 ? first.slice(0, 140) + '…' : first;
      return JSON.stringify(s);
    }
    return String(value);
  }

  function makeCollapsible(previewText, fullText) {
    const details = document.createElement('details');
    details.className = \`\${PDC_NS}-collapsible\`;
    const summary = document.createElement('summary');
    const caret = document.createElement('span');
    caret.className = \`\${PDC_NS}-caret\`;
    caret.textContent = '▸';
    const label = document.createElement('code');
    label.textContent = previewText;
    summary.appendChild(caret);
    summary.appendChild(label);
    const pre = document.createElement('pre');
    pre.className = \`\${PDC_NS}-pre\`;
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
    if (typeof p === 'string' && (p.length > 140 || /\\n/.test(p))) {
      return makeCollapsible(summaryFor(p), p);
    }
    const code = document.createElement('code');
    code.textContent = typeof p === 'string' ? p : String(p);
    return code;
  }

  function addRowUI(level, parts, site, tsDate) {
    if (!state.logEl) return;

    const row = document.createElement('div');
    row.className = \`\${PDC_NS}-row \${PDC_NS}-lvl-\${level}\`;

    const ts = document.createElement('span');
    ts.className = \`\${PDC_NS}-ts\`;
    ts.textContent = \`[\${fmtTime(tsDate || new Date())}]\`;

    const lvl = document.createElement('span');
    lvl.className = \`\${PDC_NS}-lvl\`;
    lvl.textContent = level.toUpperCase();

    const src = document.createElement('span');
    src.className = \`\${PDC_NS}-src\`;
    if (site && (site.file || site.url)) {
      src.title = site.url || site.file;
      src.textContent = (site.file || '(inline)') + (site.line ? \`:\${site.line}\${site.col ? ':' + site.col : ''}\` : '');
    } else {
      src.textContent = '';
    }

    const msg = document.createElement('span');
    msg.className = \`\${PDC_NS}-msg\`;
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
        const headers = cols.map(c => \`<th>\${esc(String(c))}</th>\`).join('');
        const rows = arr.map(obj => \`<tr>\${cols.map(c => \`<td><code>\${esc(stringifySafe(obj ? obj[c] : undefined))}</code></td>\`).join('')}</tr>\`).join('');
        emit('log', [\`\\n<table border="1" style="border-collapse:collapse;font-size:12px"><thead><tr>\${headers}</tr></thead><tbody>\${rows}</tbody></table>\`], site);
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
      const src = t.src || '(inline <scri'+'pt>)';
      let note = '';
      try {
        const origin = new URL(src, location.href).origin;
        if (origin !== location.origin && !t.crossOrigin) {
          note = ' (cross-origin; add crossorigin="anonymous" on the <scr'+'ipt> and serve with Access-Control-Allow-Origin to see line/col)';
        }
      } catch {}
      emit('error', [\`Script load/parsing error: \${src}\${note}\`], { url: src, file: fileFromUrl(src) });
    }
  }, true);

  // 3) Unhandled promise rejections (module parse errors can surface here)
  window.addEventListener('unhandledrejection', (e) => {
    // Try to include stack/location when available
    const reason = e.reason;
    let site = null;
    if (reason && reason.stack) {
      const first = String(reason.stack).split('\\n').find(l => !SKIP_RE.test(l));
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
        emit('info', [\`fetch → \${method} \${url}\`], null);
        try {
          const resp = await origFetch(...args);
          emit('info', [\`fetch ← \${resp.status} \${resp.statusText || ''} (\${url})\`], null);
          return resp;
        } catch (err) {
          emit('error', [\`fetch ✖ (\${url})\`, err], null);
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
      const r = document.getElementById(\`\${PDC_NS}-root\`);
      const b = document.getElementById(\`\${PDC_NS}-open\`);
      if (r && r.style.display === 'none') { r.style.display=''; if (b) b.style.display='none'; }
      else if (r) { r.style.display='none'; if (b) b.style.display=''; }
    },
    buffer: state.buffer,
    restoreConsole() { for (const k of Object.keys(window.__originalConsole__||{})) console[k] = window.__originalConsole__[k]; }
  };
})();`;
    },

    async copyDevConsoleCode() {
        try {
            const devConsoleCode = this.getDevConsoleCode();
            await navigator.clipboard.writeText(devConsoleCode);
            
            // Show success feedback
            const btn = document.getElementById('copy-devconsole-btn');
            const originalText = btn.textContent;
            btn.textContent = '✅ Copied to Clipboard!';
            btn.classList.remove('btn-info');
            btn.classList.add('btn-success');
            
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('btn-success');
                btn.classList.add('btn-info');
            }, 2000);
            
        } catch (error) {
            console.error('Failed to copy DevConsole code:', error);
            alert('Failed to copy DevConsole code: ' + error.message);
        }
    },

    async addDevConsoleToProject() {
        console.log('DevConsole: Add to project button clicked');
    const addBtn = document.getElementById('add-devconsole-btn');
    const progress = document.getElementById('add-devconsole-progress');
    const progressText = document.getElementById('add-devconsole-progress-text');
    const originalLabel = addBtn ? (addBtn.dataset.originalText || addBtn.textContent) : '';

        if (!loadFolder || !loadFolder.fileHandle) {
            alert('Please load a directory first.');
            return;
        }

    if (addBtn) {
      addBtn.dataset.originalText = originalLabel;
      addBtn.disabled = true;
      addBtn.textContent = '⏳ Working...';
    }

    if (progress && progress.dataset.timeoutId) {
      clearTimeout(Number(progress.dataset.timeoutId));
      delete progress.dataset.timeoutId;
    }

    if (progress && progressText) {
      progress.style.display = 'flex';
      progress.classList.add('loading');
      progress.classList.remove('success', 'error');
      progressText.textContent = 'Adding DevConsole to your project...';
    }

        try {
            console.log('DevConsole: Getting DevConsole code...');
            // Get the DevConsole code
            const devConsoleCode = this.getDevConsoleCode();
            
            console.log('DevConsole: Creating file handle...');
            // Create the devconsole.js file in the project
            const devConsoleHandle = await loadFolder.fileHandle.getFileHandle('devconsole.js', { create: true });
            const writable = await devConsoleHandle.createWritable();
            await writable.write(devConsoleCode);
            await writable.close();
            
            console.log('DevConsole: File created successfully');
            
            // Inject the script tag into every HTML file we can find
            const htmlIntegration = await this.addScriptTagToHtmlFiles();
            
            // Refresh the file tree to show the new file
            if (loadFolder.refreshFileTree) {
                console.log('DevConsole: Refreshing file tree...');
                // Re-scan from disk to get the new file
                loadFolder.fileStructure = await loadFolder.recursivelyReadDirectory([], loadFolder.fileHandle);
                loadFolder.refreshFileTree();
            }
            
            // Update status
            await this.checkDevConsoleStatus();
            
            // Show success message
      if (progress && progressText) {
        progress.classList.remove('loading', 'error');
        progress.classList.add('success');
        progressText.textContent = 'DevConsole added successfully.';

        const timeoutId = setTimeout(() => {
          progress.style.display = 'none';
          progress.classList.remove('success');
          delete progress.dataset.timeoutId;
        }, 4000);
        progress.dataset.timeoutId = String(timeoutId);
      }

      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = '✅ Added Successfully!';
        addBtn.classList.remove('btn-success');
        addBtn.classList.add('btn-info');

        setTimeout(() => {
          addBtn.textContent = addBtn.dataset.originalText || '➕ Add DevConsole to Project';
          addBtn.classList.remove('btn-info');
          addBtn.classList.add('btn-success');
        }, 3000);
      }
            
            // Summarize how many HTML files we updated
            const summary = htmlIntegration || { total: 0, updated: 0, alreadyPresent: 0, missingHead: 0, failures: [] };
            console.log('DevConsole: HTML integration summary:', summary);

            const lines = ['DevConsole has been added to your project!'];

            if (summary.total === 0) {
                lines.push('No HTML files were found. Add <scr'+'ipt src="devconsole.js"></scr'+'ipt> to your pages manually.');
            } else {
                lines.push(`Script tag added to ${summary.updated} of ${summary.total} HTML file${summary.total === 1 ? '' : 's'}.`);
                if (summary.alreadyPresent) {
                    lines.push(`${summary.alreadyPresent} file${summary.alreadyPresent === 1 ? '' : 's'} already included the script.`);
                }
                if (summary.missingHead) {
                    lines.push(`${summary.missingHead} file${summary.missingHead === 1 ? '' : 's'} did not have a <he'+'ad> tag; please add the script manually.`);
                }
                if (summary.failures && summary.failures.length) {
                    lines.push(`Failed to update ${summary.failures.length} file${summary.failures.length === 1 ? '' : 's'}; check the console for details.`);
                }
            }

            alert(lines.join('\n'));
            
        } catch (error) {
            console.error('Failed to add DevConsole to project:', error);
      if (progress && progressText) {
        progress.classList.remove('loading', 'success');
        progress.classList.add('error');
        progressText.textContent = 'Failed to add DevConsole. Check the console for details.';

        const timeoutId = setTimeout(() => {
          progress.style.display = 'none';
          progress.classList.remove('error');
          delete progress.dataset.timeoutId;
        }, 5000);
        progress.dataset.timeoutId = String(timeoutId);
      }

      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = addBtn.dataset.originalText || '➕ Add DevConsole to Project';
        addBtn.classList.remove('btn-info');
        if (!addBtn.classList.contains('btn-success')) {
          addBtn.classList.add('btn-success');
        }
      }

            alert('Failed to add DevConsole to project: ' + error.message);
    } finally {
      if (progress) {
        progress.classList.remove('loading');
      }
        }
    },

    async addScriptTagToHtmlFiles() {
        const result = { total: 0, updated: 0, alreadyPresent: 0, missingHead: 0, failures: [] };

        try {
            if (!loadFolder || !Array.isArray(loadFolder.fileStructure)) {
                console.log('DevConsole: No file structure available to scan for HTML files');
                return result;
            }

            const htmlFiles = loadFolder.fileStructure.filter(file =>
                file && file.kind === 'file' && /\.html?$/i.test(file.name || '')
            );

            result.total = htmlFiles.length;
            console.log('DevConsole: HTML files detected:', htmlFiles.map(f => f.relativePath));

            for (const file of htmlFiles) {
        try {
          const outcome = await this._injectScriptTagIntoHtmlFile(file);
          if (!outcome || !outcome.status) {
            continue;
          }
          switch (outcome.status) {
                        case 'updated':
                            result.updated += 1;
                            break;
                        case 'missing-head':
                            result.missingHead += 1;
                            break;
                        case 'already-present':
                        case 'noop':
                            result.alreadyPresent += 1;
                            break;
                        default:
                            break;
                    }
                } catch (error) {
                    result.failures.push({ path: file.relativePath, error });
                    console.error('DevConsole: Failed to update HTML file:', file.relativePath, error);
                }
            }
        } catch (error) {
            console.error('DevConsole: Error while scanning HTML files:', error);
        }

        return result;
    },

    _findOpenEditorByRelativePath(relativePath) {
        if (typeof editor === 'undefined' || !editor || !editor._meta) {
            return null;
        }

        for (const [uuid, meta] of Object.entries(editor._meta)) {
            if (meta && meta.relativePath === relativePath) {
                return {
                    uuid,
                    meta,
                    view: editor.instance ? editor.instance[uuid] : null
                };
            }
        }

        return null;
    },

    async _getHtmlContentForFile(file) {
        const openInfo = this._findOpenEditorByRelativePath(file.relativePath);
        if (openInfo && openInfo.view) {
            return { content: openInfo.view.state.doc.toString(), openInfo };
        }

        const blob = await file.entry.getFile();
        const content = await blob.text();
        return { content, openInfo };
    },

    _computeDevConsoleRelativePath(relativePath) {
        const dir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
        if (!dir) return 'devconsole.js';
        const depth = dir.split('/').filter(Boolean).length;
        return '../'.repeat(depth) + 'devconsole.js';
    },

    async _writeFileContents(fileHandle, contents) {
        // Ensure unshipped banner is preserved for HTML files
        let prepared = contents;
        if (typeof editor !== 'undefined' && editor.ensureUnshippedBanner) {
            prepared = editor.ensureUnshippedBanner(prepared);
        }
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(prepared);
        } finally {
            await writable.close();
        }
    },

    _syncEditorAfterExternalWrite(openInfo, newContent, fileHandle) {
        if (!openInfo) return;

        const view = openInfo.view;
        if (view) {
            const current = view.state.doc.toString();
            if (current !== newContent) {
                view.dispatch({
                    changes: { from: 0, to: current.length, insert: newContent }
                });
            }
        }

        if (openInfo.meta) {
            openInfo.meta.text = newContent;
            if (fileHandle) {
                openInfo.meta.entry = fileHandle;
            }
        }

        if (typeof editor !== 'undefined' && editor) {
            if (editor.dirtyFiles) {
                editor.dirtyFiles.delete(openInfo.uuid);
            }
            if (typeof editor._setStatus === 'function') {
                editor._setStatus(openInfo.uuid, 'Saved', 'saved');
            }
            if (editor.dirtyFiles && editor.dirtyFiles.size === 0 && typeof $ === 'function') {
                $('#saveButton')
                    .removeClass('btn-outline-danger btn-outline-success')
                    .addClass('btn-outline-primary');
            }
        }
    },

    async _injectScriptTagIntoHtmlFile(file) {
        const { content, openInfo } = await this._getHtmlContentForFile(file);

        if (content.includes('devconsole.js')) {
            return { status: 'already-present' };
        }

        const headMatch = content.match(/(<head[^>]*>)/i);
        if (!headMatch) {
            return { status: 'missing-head' };
        }

        const scriptPath = this._computeDevConsoleRelativePath(file.relativePath);
        const scriptTag = `\n    <scr`+`ipt src="${scriptPath}"></scr`+`ipt>`;
        const newContent = content.replace(headMatch[0], headMatch[0] + scriptTag);

        if (newContent === content) {
            return { status: 'noop' };
        }

        await this._writeFileContents(file.entry, newContent);
        file.text = newContent;

        if (openInfo) {
            this._syncEditorAfterExternalWrite(openInfo, newContent, file.entry);
        }

        return { status: 'updated', scriptPath };
    },

    async viewExistingDevConsole() {
        if (!loadFolder || !loadFolder.fileHandle) {
            alert('Please load a directory first.');
            return;
        }

        try {
            // Switch to editor tab
            const editorTab = document.getElementById('editor-tab');
            if (editorTab) {
                editorTab.click();
            }
            
            // Try to get the file handle and open it
            setTimeout(async () => {
                try {
                    const devConsoleHandle = await loadFolder.fileHandle.getFileHandle('devconsole.js');
                    if (editor && editor.openFile) {
                        editor.openFile(devConsoleHandle, 'devconsole.js');
                    }
                } catch (error) {
                    console.error('Error opening DevConsole file:', error);
                    alert('Could not open DevConsole file in editor.');
                }
            }, 100);
        } catch (error) {
            console.error('Failed to view DevConsole file:', error);
            alert('Failed to view DevConsole file: ' + error.message);
        }
    },

    async updateDevConsole() {
        if (!loadFolder || !loadFolder.fileHandle) {
            alert('Please load a directory first.');
            return;
        }

        const confirmed = confirm('This will overwrite your existing devconsole.js file with the latest version. Continue?');
        if (!confirmed) {
            return;
        }

        try {
            // Get the latest DevConsole code
            const devConsoleCode = this.getDevConsoleCode();
            
            // Update the existing file
            const devConsoleHandle = await loadFolder.fileHandle.getFileHandle('devconsole.js');
            const writable = await devConsoleHandle.createWritable();
            await writable.write(devConsoleCode);
            await writable.close();
            
            // Show success message
            const btn = document.getElementById('update-devconsole-btn');
            const originalText = btn.textContent;
            btn.textContent = '✅ Updated Successfully!';
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-success');
            
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('btn-success');
                btn.classList.add('btn-warning');
            }, 3000);
            
            alert('DevConsole has been updated to the latest version!');
            
        } catch (error) {
            console.error('Failed to update DevConsole:', error);
            alert('Failed to update DevConsole: ' + error.message);
        }
    },

    // Debug helper - can be called from browser console
    debug() {
        console.log('=== DevConsole Debug Info ===');
        console.log('loadFolder object:', loadFolder);
        console.log('loadFolder.fileHandle:', loadFolder?.fileHandle);
        console.log('loadFolder.fileStructure:', loadFolder?.fileStructure);
        console.log('loadFolder.fileStructure length:', loadFolder?.fileStructure?.length);
        
        if (loadFolder?.fileStructure) {
            console.log('Files in project:');
            loadFolder.fileStructure.forEach(file => {
                console.log(`  - ${file.name} (${file.relativePath})`);
            });
        }
        
        return {
            hasLoadFolder: !!loadFolder,
            hasFileHandle: !!(loadFolder?.fileHandle),
            hasFileStructure: !!(loadFolder?.fileStructure),
            fileCount: loadFolder?.fileStructure?.length || 0,
            files: loadFolder?.fileStructure?.map(f => f.name) || []
        };
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    devConsoleTab.init();
    // Expose debug function globally
    window.debugDevConsole = () => devConsoleTab.debug();
    console.log('DevConsole tab initialized. Call debugDevConsole() in console for debug info.');
});





