const testRecorderTab = {
    _setSafeContent(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
        el.replaceChildren(frag);
    },

    init() {
        const pane = document.getElementById('test-recorder');
        if (!pane) return;
        this._setSafeContent(pane, this.renderBase());
        this.bind();

        $('#test-recorder-tab').on('shown.bs.tab', () => {
            this.checkStatus();
        });

        if ($('#test-recorder').hasClass('active') || $('#test-recorder').hasClass('show')) {
            this.checkStatus();
        }
    },

    renderBase() {
        return `
            <h3>Test Recorder</h3>
            <p>Record clicks and data entry in your app, then replay them later as repeatable tests. Includes manual pauses for file uploads and other human-only steps.</p>

            <div class="integration-section mb-4" id="test-recorder-integration-panel">
                <h4>Integration</h4>
                <div id="test-recorder-status" class="d-flex align-items-center p-3 rounded"
                    style="background-color: #343a40; border: 1px solid #495057;">
                    <span class="status-badge mr-3" id="test-recorder-status-badge">Checking...</span>
                    <span id="test-recorder-status-message" class="flex-grow-1">Checking if testRecorder.js is integrated...</span>
                    <button id="test-recorder-refresh-status-btn" class="btn btn-sm btn-outline-secondary ml-2">🔄 Refresh</button>
                </div>
                <div class="actions-section mt-3">
                    <button id="test-recorder-add-btn" class="btn btn-success" disabled>➕ Add testRecorder.js to Project</button>
                    <button id="test-recorder-update-btn" class="btn btn-warning" style="display:none;">🔄 Update testRecorder.js</button>
                    <div id="test-recorder-progress" class="progress-indicator" aria-live="polite" style="display:none;">
                        <span class="spinner" aria-hidden="true"></span>
                        <span id="test-recorder-progress-text">Preparing integration...</span>
                    </div>
                </div>
                <div class="mt-3 small" style="line-height:1.3;">
                    After adding the script, open your app and press <kbd>Ctrl/Cmd + Alt + R</kbd> to open the recorder panel.
                    Record actions, then copy or download the JSON scenario for reuse.
                </div>
            </div>

            <hr class="my-4">

            <div class="ai-prompt-section">
                <h4>Scenario Format (Example)</h4>
                <p class="text-muted">Steps are recorded automatically. You can edit the JSON to fine-tune selectors or insert pauses.</p>
                <div class="position-relative">
                    <textarea id="test-recorder-sample" class="form-control" rows="10" readonly style="font-family: monospace; font-size: 0.85em;">
{
  "name": "Basic flow",
  "steps": [
    { "type": "click", "selector": "#start", "delayMs": 0 },
    { "type": "input", "selector": "#username", "value": "pilot", "delayMs": 320 },
    { "type": "pause", "message": "Upload a file, then click Continue", "delayMs": 0 },
    { "type": "click", "selector": "#submit", "delayMs": 180 }
  ]
}
                    </textarea>
                    <button id="test-recorder-copy-sample-btn" class="btn btn-sm btn-light position-absolute" style="top: 10px; right: 10px;">📋 Copy</button>
                </div>
            </div>
        `;
    },

    bind() {
        $('#test-recorder-refresh-status-btn').on('click', () => this.checkStatus());
        $('#test-recorder-add-btn').on('click', () => this.integrate(false));
        $('#test-recorder-update-btn').on('click', () => this.integrate(true));

        $('#test-recorder-copy-sample-btn').on('click', () => {
            const text = document.getElementById('test-recorder-sample').value;
            if (text) {
                navigator.clipboard.writeText(text);
                const btn = $('#test-recorder-copy-sample-btn');
                const orig = btn.text();
                btn.text('Copied!');
                setTimeout(() => btn.text(orig), 1500);
            }
        });
    },

    async checkStatus() {
        const statusBadge = $('#test-recorder-status-badge');
        const statusMessage = $('#test-recorder-status-message');
        const addBtn = $('#test-recorder-add-btn');
        const updateBtn = $('#test-recorder-update-btn');

        addBtn.prop('disabled', true).show();
        updateBtn.hide();

        statusBadge.text('Checking...').attr('class', 'status-badge checking');
        statusMessage.text('Checking if testRecorder.js is integrated...');

        if (!loadFolder || !loadFolder.fileHandle) {
            statusBadge.text('No Project').attr('class', 'status-badge not-found');
            statusMessage.text('Load a directory first to check integration.');
            return;
        }

        const recorderFile = loadFolder.fileStructure.find(f => f.name === 'testRecorder.js');
        const indexFile = loadFolder.fileStructure.find(f => f.name.toLowerCase() === 'index.html');

        if (recorderFile) {
            statusBadge.text('Found').attr('class', 'status-badge found');
            statusMessage.text('testRecorder.js is present in your project.');
            addBtn.hide();
            updateBtn.show();
        } else {
            statusBadge.text('Not Found').attr('class', 'status-badge not-found');
            statusMessage.text('testRecorder.js is not yet integrated in your project.');
            addBtn.prop('disabled', false).show();
            updateBtn.hide();
        }

        if (indexFile) {
            const content = await loadFolder.getFileContent(indexFile);
            const hasTag = /testRecorder\.js/i.test(content);
            if (recorderFile && !hasTag) {
                statusMessage.text('testRecorder.js is present, but script tags are missing in index.html. Click Update to inject.');
            }
        }
    },

    async integrate(isUpdate) {
        if (!loadFolder || !loadFolder.fileHandle) {
            alert('Please load a directory first.');
            return;
        }

        if (isUpdate && !confirm('This will overwrite your existing testRecorder.js file. Continue?')) {
            return;
        }

        const addBtn = $('#test-recorder-add-btn');
        const updateBtn = $('#test-recorder-update-btn');
        const progress = $('#test-recorder-progress');
        const progressText = $('#test-recorder-progress-text');

        const actionBtn = isUpdate ? updateBtn : addBtn;
        const otherBtn = isUpdate ? addBtn : updateBtn;
        const originalText = actionBtn.data('originalText') || actionBtn.text();
        actionBtn.data('originalText', originalText);

        actionBtn.prop('disabled', true).text('⏳ Working...');
        otherBtn.prop('disabled', true);

        progress.css('display', 'flex').removeClass('success error').addClass('loading');
        progressText.text(isUpdate ? 'Updating testRecorder.js...' : 'Adding testRecorder.js to your project...');

        try {
            const recorderCode = this.getRecorderCode();
            await this._writeProjectFile('testRecorder.js', recorderCode);
            await this._injectScriptTag();

            loadFolder.fileStructure = await loadFolder.recursivelyReadDirectory([], loadFolder.fileHandle);
            loadFolder.refreshFileTree();
            await this.checkStatus();

            progress.removeClass('loading error').addClass('success');
            progressText.text(isUpdate ? 'testRecorder.js updated successfully.' : 'testRecorder.js added successfully.');

            const timeoutId = setTimeout(() => {
                progress.css('display', 'none');
                progress.removeClass('success');
            }, 3500);
            progress.data('timeoutId', timeoutId);

            actionBtn.prop('disabled', false).text('✅ Done!');
            setTimeout(() => {
                actionBtn.prop('disabled', false).text(actionBtn.data('originalText') || originalText);
            }, 2200);
            otherBtn.prop('disabled', false);
        } catch (err) {
            console.error('Test Recorder integrate error:', err);
            progress.removeClass('loading success').addClass('error');
            progressText.text('Failed to integrate testRecorder.js. See console.');
            const timeoutId = setTimeout(() => {
                progress.css('display', 'none');
                progress.removeClass('error');
            }, 5000);
            progress.data('timeoutId', timeoutId);
            actionBtn.prop('disabled', false).text(actionBtn.data('originalText') || originalText);
            otherBtn.prop('disabled', false);
            alert('Error: ' + err.message);
        } finally {
            progress.removeClass('loading');
        }
    },

    async _writeProjectFile(filename, content) {
        const fileHandle = await loadFolder.fileHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    },

    async _injectScriptTag() {
        const indexFile = loadFolder.fileStructure.find(f => f.name.toLowerCase() === 'index.html');
        if (!indexFile) return;

        let content = await loadFolder.getFileContent(indexFile);
        if (/testRecorder\.js/i.test(content)) return;

        const tag = '    <script src="testRecorder.js"></script>';
        if (content.includes('</body>')) {
            content = content.replace(/\n?\s*<\/body>/i, `\n${tag}\n</body>`);
        } else {
            content += `\n${tag}\n`;
        }

        // Ensure unshipped banner is preserved
        if (typeof editor !== 'undefined' && editor.ensureUnshippedBanner) {
            content = editor.ensureUnshippedBanner(content);
        }
        const fileHandle = await loadFolder.fileHandle.getFileHandle(indexFile.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    },

    getRecorderCode() {
        return `/* Test Recorder - generated by Warfighter Coder */
(function(){
  if (window.__testRecorderInstalled) return;
  window.__testRecorderInstalled = true;

  const STORAGE_KEY = 'test-recorder:lastScenario';
  const UI_CLASS = 'test-recorder-ui';
  const state = {
    recording: false,
    playing: false,
    steps: [],
    lastTs: 0,
    overlay: null,
    panel: null,
    jsonArea: null,
    status: null,
    speedMode: false,
    speedMs: 50
  };

  const safeCss = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };

  const isUi = (el) => !!(el && el.closest && el.closest('.' + UI_CLASS));

  const getSelector = (el) => {
    if (!el || !el.tagName) return null;
    if (el.id) return '#' + safeCss(el.id);

    const attrs = ['data-testid', 'data-test', 'data-qa', 'data-role', 'name', 'aria-label'];
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (val) return el.tagName.toLowerCase() + '[' + attr + '="' + safeCss(val) + '"]';
    }

    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      const tag = node.tagName.toLowerCase();
      let index = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName.toLowerCase() === tag) index++;
        sib = sib.previousElementSibling;
      }
      path.unshift(tag + ':nth-of-type(' + index + ')');
      if (node.parentElement && node.parentElement.id) {
        path.unshift('#' + safeCss(node.parentElement.id));
        break;
      }
      node = node.parentElement;
    }
    return path.join(' > ');
  };

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: 'Recorded flow', steps: state.steps }));
    } catch (e) { }
  };

  const loadPersisted = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.steps)) state.steps = parsed.steps;
    } catch (e) { }
  };

  const loadSpeedSettings = () => {
    try {
      const speedMode = localStorage.getItem('test-recorder:speedMode');
      const speedMs = localStorage.getItem('test-recorder:speedMs');
      if (speedMode !== null) state.speedMode = speedMode === '1';
      if (speedMs !== null) {
        const n = Number(speedMs);
        if (!Number.isNaN(n)) state.speedMs = Math.max(1, n);
      }
    } catch (e) { }
  };

  const saveSpeedSettings = () => {
    try {
      localStorage.setItem('test-recorder:speedMode', state.speedMode ? '1' : '0');
      localStorage.setItem('test-recorder:speedMs', String(state.speedMs));
    } catch (e) { }
  };

  const updateJsonArea = () => {
    if (!state.jsonArea) return;
    const payload = { name: 'Recorded flow', steps: state.steps };
    state.jsonArea.value = JSON.stringify(payload, null, 2);
  };

  const setStatus = (text) => {
    if (state.status) state.status.textContent = text;
  };

  const resetTiming = () => { state.lastTs = 0; };

  const addStep = (step) => {
    const now = performance.now();
    step.delayMs = state.lastTs ? Math.max(0, Math.round(now - state.lastTs)) : 0;
    state.lastTs = now;
    state.steps.push(step);
    persist();
    updateJsonArea();
    setStatus('Steps: ' + state.steps.length);
  };

  const recordClick = (e) => {
    if (!state.recording || state.playing) return;
    if (isUi(e.target)) return;
    const selector = getSelector(e.target);
    if (!selector) return;
    addStep({ type: 'click', selector });
  };

  const recordInput = (e) => {
    if (!state.recording || state.playing) return;
    const el = e.target;
    if (!el || isUi(el)) return;
    if (el.tagName === 'SELECT') {
      const selector = getSelector(el);
      if (!selector) return;
      addStep({ type: 'select', selector, value: el.value });
      return;
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const selector = getSelector(el);
      if (!selector) return;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox') {
        addStep({ type: el.checked ? 'check' : 'uncheck', selector });
        return;
      }
      if (type === 'radio') {
        if (el.checked) addStep({ type: 'check', selector });
        return;
      }
      if (type === 'file') {
        addStep({ type: 'file', selector, message: 'Select file then continue' });
        return;
      }
      addStep({ type: 'input', selector, value: el.value });
    }
  };

  const addPause = () => {
    const msg = prompt('Pause message (shown during replay):', 'Upload a file, then click Continue');
    if (!msg) return;
    addStep({ type: 'pause', message: msg });
  };

  const clearSteps = () => {
    if (!confirm('Clear all recorded steps?')) return;
    state.steps = [];
    resetTiming();
    persist();
    updateJsonArea();
    setStatus('Steps: 0');
  };

  const wait = (ms) => new Promise(res => setTimeout(res, ms));

  const showBlockingOverlay = (message, resolve) => {
    let overlay = document.getElementById('test-recorder-blocking');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'test-recorder-blocking';
    overlay.className = UI_CLASS;
    overlay.innerHTML =
      '<div class="tr-block">' +
      '<div class="tr-block-title">Test Recorder</div>' +
      '<div class="tr-block-msg"></div>' +
      '<button class="tr-block-btn">Continue</button>' +
      '</div>';
    overlay.querySelector('.tr-block-msg').textContent = message || 'Continue when ready.';
    overlay.querySelector('.tr-block-btn').addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
    document.body.appendChild(overlay);
  };

  const handleFilePause = (selector) => new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el && typeof el.click === 'function') {
      el.focus();
    }

    const onChange = () => {
      if (el) el.removeEventListener('change', onChange);
      resolve();
    };
    if (el) el.addEventListener('change', onChange, { once: true });

    showBlockingOverlay('Select a file for ' + selector + ' then click Continue.', () => {
      if (el) el.removeEventListener('change', onChange);
      resolve();
    });
  });

  const playSteps = async () => {
    if (state.playing || state.steps.length === 0) return;
    state.playing = true;
    setStatus('Replaying...');
    try {
      for (const step of state.steps) {
        const overrideDelay = state.speedMode ? Math.max(1, Number(state.speedMs) || 1) : null;
        const effectiveDelay = overrideDelay !== null ? overrideDelay : step.delayMs;
        if (effectiveDelay) await wait(effectiveDelay);
        if (step.type === 'pause') {
          await new Promise(res => showBlockingOverlay(step.message, res));
          continue;
        }
        if (step.type === 'file') {
          await handleFilePause(step.selector);
          continue;
        }
        const el = document.querySelector(step.selector);
        if (!el) {
          console.warn('[Test Recorder] Element not found:', step.selector);
          continue;
        }
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        switch (step.type) {
          case 'click':
            if (typeof el.click === 'function') {
              el.click();
            } else {
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }
            break;
          case 'input':
            el.focus();
            el.value = step.value ?? '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          case 'select':
            el.value = step.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          case 'check':
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          case 'uncheck':
            el.checked = false;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          default:
            break;
        }
        await wait(80);
      }
    } finally {
      state.playing = false;
      setStatus('Steps: ' + state.steps.length);
    }
  };

  const downloadJson = () => {
    const payload = { name: 'Recorded flow', steps: state.steps };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'test-recorder.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadJson = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.steps)) throw new Error('Invalid JSON format');
      state.steps = parsed.steps;
      resetTiming();
      persist();
      updateJsonArea();
      setStatus('Steps: ' + state.steps.length);
    } catch (e) {
      alert('Failed to parse JSON: ' + e.message);
    }
  };

  const TEST_RECORDER_DEFAULT_RIGHT = 16;
  const TEST_RECORDER_DECONFLICT_RIGHT = 72;
  let launcherDeconflictObserver = null;

  const hasVisibleDevConsoleLauncher = () => {
    const btn = document.getElementById('pdc-open');
    if (!btn) return false;
    const styles = window.getComputedStyle(btn);
    return styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0';
  };

  const applyLauncherDeconfliction = () => {
    const launcher = document.getElementById('test-recorder-launcher');
    if (!launcher) return;
    const rightPx = hasVisibleDevConsoleLauncher()
      ? TEST_RECORDER_DECONFLICT_RIGHT
      : TEST_RECORDER_DEFAULT_RIGHT;
    launcher.style.right = rightPx + 'px';
  };

  const setupLauncherDeconfliction = () => {
    applyLauncherDeconfliction();
    if (launcherDeconflictObserver || typeof MutationObserver !== 'function') return;
    const root = document.body || document.documentElement;
    if (!root) return;
    launcherDeconflictObserver = new MutationObserver(() => applyLauncherDeconfliction());
    launcherDeconflictObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', applyLauncherDeconfliction);
  };

  const buildUI = () => {
    const launcher = document.createElement('button');
    launcher.id = 'test-recorder-launcher';
    launcher.className = UI_CLASS;
    launcher.textContent = 'REC';
    launcher.title = 'Open Test Recorder (Ctrl/Cmd + Alt + R)';

    const panel = document.createElement('div');
    panel.id = 'test-recorder-panel';
    panel.className = UI_CLASS;
    panel.innerHTML =
      '<div class="tr-header">' +
      '<strong>Test Recorder</strong>' +
      '<span class="tr-status">Steps: 0</span>' +
      '<button class="tr-close">×</button>' +
      '</div>' +
      '<div class="tr-body">' +
      '<div class="tr-row">' +
      '<button class="tr-btn" data-action="record">Start Recording</button>' +
      '<button class="tr-btn" data-action="stop" disabled>Stop</button>' +
      '<button class="tr-btn secondary" data-action="play">Replay</button>' +
      '<button class="tr-btn secondary" data-action="pause">Add Pause</button>' +
      '<button class="tr-btn danger" data-action="clear">Clear</button>' +
      '</div>' +
      '<div class="tr-row">' +
      '<label class="tr-speed">' +
      '<input type="checkbox" data-action="speed-mode" /> Speed mode' +
      '</label>' +
      '<label class="tr-speed">' +
      'Delay (ms)' +
      '<input type="number" data-action="speed-ms" min="1" value="50" />' +
      '</label>' +
      '</div>' +
      '<textarea class="tr-json" rows="10" spellcheck="false"></textarea>' +
      '<div class="tr-row">' +
      '<button class="tr-btn secondary" data-action="copy">Copy JSON</button>' +
      '<button class="tr-btn secondary" data-action="download">Download JSON</button>' +
      '<label class="tr-btn secondary tr-file">' +
      'Load JSON' +
      '<input type="file" accept=".json,application/json" />' +
      '</label>' +
      '</div>' +
      '</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    state.panel = panel;
    state.jsonArea = panel.querySelector('.tr-json');
    state.status = panel.querySelector('.tr-status');

    launcher.addEventListener('click', () => {
      panel.classList.toggle('show');
    });
    panel.querySelector('.tr-close').addEventListener('click', () => panel.classList.remove('show'));

    panel.querySelector('[data-action="record"]').addEventListener('click', () => {
      state.recording = true;
      resetTiming();
      setStatus('Recording...');
      panel.querySelector('[data-action="record"]').disabled = true;
      panel.querySelector('[data-action="stop"]').disabled = false;
    });
    panel.querySelector('[data-action="stop"]').addEventListener('click', () => {
      state.recording = false;
      setStatus('Steps: ' + state.steps.length);
      panel.querySelector('[data-action="record"]').disabled = false;
      panel.querySelector('[data-action="stop"]').disabled = true;
    });
    panel.querySelector('[data-action="play"]').addEventListener('click', () => playSteps());
    panel.querySelector('[data-action="pause"]').addEventListener('click', () => addPause());
    panel.querySelector('[data-action="clear"]').addEventListener('click', () => clearSteps());
    panel.querySelector('[data-action="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(state.jsonArea.value || '');
    });
    panel.querySelector('[data-action="download"]').addEventListener('click', () => downloadJson());

    const speedModeCb = panel.querySelector('[data-action="speed-mode"]');
    const speedMsInput = panel.querySelector('[data-action="speed-ms"]');
    if (speedModeCb && speedMsInput) {
      speedModeCb.checked = !!state.speedMode;
      speedMsInput.value = String(state.speedMs);
      speedModeCb.addEventListener('change', () => {
        state.speedMode = !!speedModeCb.checked;
        saveSpeedSettings();
      });
      speedMsInput.addEventListener('change', () => {
        const n = Number(speedMsInput.value);
        state.speedMs = Number.isNaN(n) ? 1 : Math.max(1, n);
        speedMsInput.value = String(state.speedMs);
        saveSpeedSettings();
      });
    }

    panel.querySelector('input[type="file"]').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => loadJson(reader.result);
      reader.readAsText(file);
      e.target.value = '';
    });

    updateJsonArea();
    setStatus('Steps: ' + state.steps.length);
  };

  const injectStyles = () => {
    const style = document.createElement('style');
    style.textContent =
      '#test-recorder-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#dc3545;color:#fff;border:none;border-radius:999px;padding:10px 14px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.3);}' +
      '#test-recorder-panel{position:fixed;right:16px;bottom:64px;width:360px;max-width:90vw;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;box-shadow:0 10px 24px rgba(0,0,0,.35);display:none;z-index:2147483647;}' +
      '#test-recorder-panel.show{display:block;}' +
      '#test-recorder-panel .tr-header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #334155;}' +
      '#test-recorder-panel .tr-header strong{flex:1;}' +
      '#test-recorder-panel .tr-close{background:transparent;border:none;color:#94a3b8;font-size:18px;}' +
      '#test-recorder-panel .tr-body{padding:10px 12px;}' +
      '#test-recorder-panel .tr-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}' +
      '#test-recorder-panel .tr-btn{background:#2563eb;border:none;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer;}' +
      '#test-recorder-panel .tr-btn.secondary{background:#334155;color:#e2e8f0;}' +
      '#test-recorder-panel .tr-btn.danger{background:#b91c1c;color:#fff;}' +
      '#test-recorder-panel .tr-btn[disabled]{opacity:0.5;cursor:not-allowed;}' +
      '#test-recorder-panel .tr-speed{display:flex;align-items:center;gap:6px;font-size:12px;color:#cbd5f5;}' +
      '#test-recorder-panel .tr-speed input[type="number"]{width:70px;background:#0b1220;color:#e2e8f0;border:1px solid #1e293b;border-radius:6px;padding:3px 6px;}' +
      '#test-recorder-panel .tr-json{width:100%;background:#0b1220;color:#e2e8f0;border:1px solid #1e293b;border-radius:6px;padding:8px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}' +
      '#test-recorder-panel .tr-file{position:relative;overflow:hidden;}' +
      '#test-recorder-panel .tr-file input{position:absolute;left:-9999px;}' +
      '#test-recorder-blocking{position:fixed;inset:0;background:rgba(15,23,42,0.85);display:flex;align-items:center;justify-content:center;z-index:2147483647;}' +
      '#test-recorder-blocking .tr-block{background:#111827;color:#e2e8f0;padding:20px;border-radius:12px;max-width:360px;border:1px solid #334155;text-align:center;}' +
      '#test-recorder-blocking .tr-block-title{font-weight:700;margin-bottom:6px;}' +
      '#test-recorder-blocking .tr-block-btn{margin-top:12px;background:#2563eb;border:none;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;}';
    document.head.appendChild(style);
  };

  const togglePanel = () => {
    if (!state.panel) return;
    state.panel.classList.toggle('show');
  };

  const bindShortcuts = () => {
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const metaKey = isMac ? e.metaKey : e.ctrlKey;
      if (metaKey && e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        togglePanel();
      }
    });
  };

  loadPersisted();
  loadSpeedSettings();
  injectStyles();
  buildUI();
  setupLauncherDeconfliction();
  bindShortcuts();

  document.addEventListener('click', recordClick, true);
  document.addEventListener('change', recordInput, true);
  document.addEventListener('blur', recordInput, true);
})();
`;
    }
};
