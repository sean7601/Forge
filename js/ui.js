/* ===== Forge v2 — UI: Panels, Command Palette, Shortcuts, Modals ===== */

// --- Theme Switching ---
function setTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    localStorage.setItem('wct:theme', name);
    $$('.theme-option').forEach(el => el.classList.toggle('active', el.dataset.themeOpt === name));
    if (typeof rebuildAllEditors === 'function') rebuildAllEditors();
}

// Apply saved theme immediately
(function() {
    const saved = localStorage.getItem('wct:theme') || 'beach';
    document.documentElement.setAttribute('data-theme', saved);
})();

// --- Panel Switching ---
const uiState = {
    currentSidebarPanel: 'explorer',
    rightPanelOpen: false
};

function isCompactLayout() {
    return window.matchMedia('(max-width: 820px)').matches;
}

function getStoredWidth(storageKey, min, cssVar, fallback) {
    const saved = parseInt(localStorage.getItem(storageKey) || '', 10);
    if (!isNaN(saved) && saved >= min) return saved;
    const cssDefault = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10);
    if (!isNaN(cssDefault) && cssDefault >= min) return cssDefault;
    return fallback;
}

function updateActivityBarState() {
    $$('.ab-icon').forEach(i => {
        const panel = i.dataset.panel;
        const isActive = panel === uiState.currentSidebarPanel;
        i.classList.toggle('active', isActive);
    });
}

function setSidebarCollapsed(collapsed) {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sidebar-resize-handle');
    if (!sidebar) return;
    const compact = isCompactLayout();
    const wasCollapsed = sidebar.classList.contains('collapsed');

    if (collapsed) {
        if (!compact) {
            if (!wasCollapsed) {
                const currentWidth = Math.round(sidebar.getBoundingClientRect().width);
                if (currentWidth >= 180) localStorage.setItem('wct:sidebar-width', currentWidth.toString());
            }
            sidebar.style.width = '0px';
        } else {
            sidebar.style.width = '';
        }
        sidebar.classList.add('collapsed');
    } else {
        sidebar.classList.remove('collapsed');
        if (compact) {
            sidebar.style.width = '';
        } else if (wasCollapsed || !sidebar.style.width || parseInt(sidebar.style.width, 10) < 180) {
            const restored = getStoredWidth('wct:sidebar-width', 180, '--sidebar-w', 312);
            sidebar.style.width = restored + 'px';
        }
    }

    if (handle) handle.classList.toggle('hidden', collapsed || compact);
    localStorage.setItem('wct:sidebar-collapsed', collapsed ? '1' : '0');
    syncSidebarVisibilityControls();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
}

function syncSidebarVisibilityControls() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('editor-sidebar-toggle-btn');
    const reopenBtn = document.getElementById('editor-sidebar-reopen-btn');
    if (!sidebar) return;

    const collapsed = sidebar.classList.contains('collapsed');

    if (toggleBtn) {
        const toggleLabel = collapsed ? 'Show file and search sidebar' : 'Hide file and search sidebar';
        toggleBtn.setAttribute('aria-label', toggleLabel);
        toggleBtn.setAttribute('aria-expanded', (!collapsed).toString());
        toggleBtn.setAttribute('title', (collapsed ? 'Show' : 'Hide') + ' sidebar (Ctrl+B)');
    }

    if (reopenBtn) {
        reopenBtn.hidden = !collapsed;
        reopenBtn.setAttribute('aria-expanded', (!collapsed).toString());
    }
}

function toggleRightPanel(forceOpen) {
    const panel = document.getElementById('right-panel');
    const handle = document.getElementById('agent-resize-handle');
    const statusToggle = document.getElementById('statusbar-agent-toggle');
    if (!panel) return;

    const open = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('collapsed');
    const compact = isCompactLayout();
    const wasOpen = !panel.classList.contains('collapsed');

    if (open) {
        panel.classList.remove('collapsed');
        if (compact) {
            panel.style.width = '';
        } else if (!panel.style.width || parseInt(panel.style.width, 10) < 260 || !wasOpen) {
            const restored = getStoredWidth('wct:right-panel-width', 260, '--right-panel-w', 360);
            panel.style.width = restored + 'px';
        }
    } else {
        if (!compact && wasOpen) {
            const currentWidth = Math.round(panel.getBoundingClientRect().width);
            if (currentWidth >= 260) localStorage.setItem('wct:right-panel-width', currentWidth.toString());
        }
        panel.style.width = compact ? '' : '0px';
        panel.classList.add('collapsed');
    }

    if (handle) handle.classList.toggle('visible', open && !compact);
    if (statusToggle) statusToggle.classList.toggle('active', open);
    uiState.rightPanelOpen = open;
    localStorage.setItem('wct:right-panel-open', open ? '1' : '0');
    updateActivityBarState();

    if (open && typeof aiAgent !== 'undefined' && aiAgent.loadProfiles) {
        const promView = document.getElementById('prometheus-view');
        if (promView && promView.classList.contains('active')) {
            aiAgent.loadProfiles();
        }
    }
}

function switchPanel(name) {
    if (name === 'agent') {
        toggleRightPanel(true);
        if (typeof promptLab !== 'undefined' && promptLab.switchRpTab) {
            promptLab.switchRpTab('prometheus');
        }
        return;
    }
    uiState.currentSidebarPanel = name;
    $$('.sidebar-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
    const title = document.getElementById('sidebar-title-text');
    if (title) title.textContent = name.toUpperCase();
    setSidebarCollapsed(false);
    updateActivityBarState();
}

function toggleSection(el) {
    el.classList.toggle('open');
    el.nextElementSibling.classList.toggle('hidden');
}

// --- Layout / Split Resizing ---
(function initPanelLayout() {
    const main = document.getElementById('main');
    const activitybar = document.getElementById('activitybar');
    const sidebar = document.getElementById('sidebar');
    const sidebarHandle = document.getElementById('sidebar-resize-handle');
    const sidebarToggleBtn = document.getElementById('editor-sidebar-toggle-btn');
    const sidebarReopenBtn = document.getElementById('editor-sidebar-reopen-btn');
    const rightPanel = document.getElementById('right-panel');
    const rightHandle = document.getElementById('agent-resize-handle');
    if (!main || !sidebar || !rightPanel) return;

    const sidebarCollapsed = localStorage.getItem('wct:sidebar-collapsed') === '1';
    const rightOpen = localStorage.getItem('wct:right-panel-open') === '1';
    setSidebarCollapsed(sidebarCollapsed);
    toggleRightPanel(rightOpen);
    updateActivityBarState();

    window.addEventListener('resize', () => {
        const compact = isCompactLayout();
        if (compact) {
            sidebar.style.width = '';
            rightPanel.style.width = '';
        } else {
            if (sidebar.classList.contains('collapsed')) {
                sidebar.style.width = '0px';
            } else if (!sidebar.style.width || parseInt(sidebar.style.width, 10) < 180) {
                sidebar.style.width = getStoredWidth('wct:sidebar-width', 180, '--sidebar-w', 312) + 'px';
            }

            if (rightPanel.classList.contains('collapsed')) {
                rightPanel.style.width = '0px';
            } else if (!rightPanel.style.width || parseInt(rightPanel.style.width, 10) < 260) {
                rightPanel.style.width = getStoredWidth('wct:right-panel-width', 260, '--right-panel-w', 360) + 'px';
            }
        }

        if (sidebarHandle) sidebarHandle.classList.toggle('hidden', sidebar.classList.contains('collapsed') || compact);
        if (rightHandle) rightHandle.classList.toggle('visible', !rightPanel.classList.contains('collapsed') && !compact);
        syncSidebarVisibilityControls();
    });

    let drag = null;
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function beginDrag(type, event) {
        event.preventDefault();
        drag = {
            type,
            startX: event.clientX,
            startSidebar: sidebar.getBoundingClientRect().width,
            startRight: rightPanel.getBoundingClientRect().width
        };
        if (type === 'sidebar' && sidebarHandle) sidebarHandle.classList.add('dragging');
        if (type === 'right' && rightHandle) rightHandle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }

    function updateDrag(event) {
        if (!drag) return;
        const rect = main.getBoundingClientRect();
        const activityW = activitybar ? activitybar.getBoundingClientRect().width : 0;
        const sidebarW = sidebar.classList.contains('collapsed') ? 0 : sidebar.getBoundingClientRect().width;
        const rightW = rightPanel.classList.contains('collapsed') ? 0 : rightPanel.getBoundingClientRect().width;
        const editorMin = 280;

        if (drag.type === 'sidebar') {
            const min = 180;
            const max = Math.max(min, rect.width - activityW - rightW - editorMin);
            const next = clamp(drag.startSidebar + (event.clientX - drag.startX), min, max);
            sidebar.style.width = next + 'px';
        } else if (drag.type === 'right') {
            const min = 260;
            const max = Math.max(min, rect.width - activityW - sidebarW - editorMin);
            const next = clamp(drag.startRight - (event.clientX - drag.startX), min, max);
            rightPanel.style.width = next + 'px';
        }
    }

    function endDrag() {
        if (!drag) return;
        if (drag.type === 'sidebar' && sidebarHandle) sidebarHandle.classList.remove('dragging');
        if (drag.type === 'right' && rightHandle) rightHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (!sidebar.classList.contains('collapsed')) {
            localStorage.setItem('wct:sidebar-width', Math.round(sidebar.getBoundingClientRect().width).toString());
        }
        if (!rightPanel.classList.contains('collapsed')) {
            localStorage.setItem('wct:right-panel-width', Math.round(rightPanel.getBoundingClientRect().width).toString());
        }
        drag = null;
    }

    if (sidebarHandle) sidebarHandle.addEventListener('mousedown', e => beginDrag('sidebar', e));
    if (rightHandle) rightHandle.addEventListener('mousedown', e => beginDrag('right', e));
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar);
    if (sidebarReopenBtn) sidebarReopenBtn.addEventListener('click', () => setSidebarCollapsed(false));
    document.addEventListener('mousemove', updateDrag);
    document.addEventListener('mouseup', endDrag);
    syncSidebarVisibilityControls();
})();

// --- Global Search ---
async function runGlobalSearch() {
    const query = document.getElementById('global-search').value.trim();
    if (!query || !dirHandle) return;
    const results = [];
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    for (const [path, handle] of Object.entries(fileHandles)) {
        try {
            const text = await readFileContent(path);
            const lines = text.split('\n');
            lines.forEach((line, i) => {
                if (regex.test(line)) {
                    results.push({ path, line: i + 1, text: line.trim().substring(0, 120) });
                }
                regex.lastIndex = 0;
            });
        } catch (e) { }
    }
    const container = document.getElementById('search-results');
    const summary = document.getElementById('search-summary');
    const clearBtn = document.getElementById('search-clear');
    container.innerHTML = '';
    summary.textContent = results.length + ' results';
    clearBtn.style.display = 'inline';
    results.slice(0, 200).forEach(r => {
        const d = document.createElement('div');
        d.className = 'search-result';
        d.innerHTML = '<span class="file">' + escHtml(r.path) + '</span><span class="line">:' + r.line + '</span> ' + escHtml(r.text);
        d.addEventListener('click', () => openFile(r.path));
        container.appendChild(d);
    });
}

function clearSearch() {
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-summary').textContent = '';
    document.getElementById('search-clear').style.display = 'none';
    document.getElementById('global-search').value = '';
}

// --- Command Palette ---
const commands = [
    // File
    { name: 'Open Folder', shortcut: '', action: loadDirectory },
    { name: 'Save All', shortcut: 'Ctrl+S', action: saveAll },
    { name: 'Save Current File', shortcut: 'Ctrl+Shift+S', action: saveCurrentFile },
    { name: 'New File', shortcut: '', action: createNewFile },
    { name: 'New Folder', shortcut: '', action: createNewFolder },
    // View
    { name: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: toggleSidebar },
    { name: 'Toggle Agent Panel', shortcut: '', action: () => toggleRightPanel() },
    { name: 'Explorer', shortcut: 'Ctrl+Shift+E', action: () => switchPanel('explorer') },
    { name: 'Search', shortcut: 'Ctrl+Shift+F', action: () => switchPanel('search') },
    { name: 'Prometheus', shortcut: '', action: () => toggleRightPanel(true) },
    { name: 'Settings', shortcut: 'Ctrl+,', action: () => switchPanel('settings') },
    // Tools
    { name: 'Compile Project', shortcut: '', action: () => openTool('compiler') },
    { name: 'Run SAST Scan', shortcut: '', action: () => openTool('sast') },
    { name: 'Generate LLM Context', shortcut: '', action: () => openTool('llm-context') },
    { name: 'Launch External AI', shortcut: '', action: showAILaunchModal },
    // Help
    { name: 'Guided Tour', shortcut: '', action: startGuidedTour },
];

function showCmdPalette() {
    document.getElementById('cmd-palette').classList.add('show');
    const input = document.getElementById('cmd-palette-input');
    input.value = ''; input.focus();
    filterCommands();
}

function hideCmdPalette() { document.getElementById('cmd-palette').classList.remove('show'); }

function filterCommands() {
    const q = document.getElementById('cmd-palette-input').value.toLowerCase();
    const list = document.getElementById('cmd-palette-list');
    list.innerHTML = '';
    commands.filter(c => c.name.toLowerCase().includes(q)).forEach((c, i) => {
        const d = document.createElement('div');
        d.className = 'cmd-item' + (i === 0 ? ' selected' : '');
        d.innerHTML = escHtml(c.name) + (c.shortcut ? '<span class="shortcut">' + c.shortcut + '</span>' : '');
        d.addEventListener('click', () => { hideCmdPalette(); c.action(); });
        list.appendChild(d);
    });
}

function cmdPaletteKey(e) {
    if (e.key === 'Escape') hideCmdPalette();
    if (e.key === 'Enter') {
        const sel = document.querySelector('.cmd-item.selected') || document.querySelector('.cmd-item');
        if (sel) sel.click();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...document.querySelectorAll('.cmd-item')];
        const idx = items.findIndex(i => i.classList.contains('selected'));
        items.forEach(i => i.classList.remove('selected'));
        const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        if (items[next]) { items[next].classList.add('selected'); items[next].scrollIntoView({ block: 'nearest' }); }
    }
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') { e.preventDefault(); showCmdPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') { e.preventDefault(); saveAll(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') { e.preventDefault(); saveCurrentFile(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); toggleSidebar(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') { e.preventDefault(); switchPanel('explorer'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') { e.preventDefault(); switchPanel('search'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); switchPanel('settings'); return; }
});

// --- Modal Helpers ---
function showAILaunchModal() { document.getElementById('ai-launch-modal').classList.add('show'); }

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// --- External AI Split Pane ---
let _extAICurrentUrl = '';

function openExtAI(url, label) {
    closeModal('ai-launch-modal');
    _extAICurrentUrl = url;
    const pane = document.getElementById('extai-pane');
    const handle = document.getElementById('extai-resize-handle');
    const iframe = document.getElementById('extai-iframe');
    const title = document.getElementById('extai-pane-title');
    title.innerHTML = '<span class="codicon codicon-globe"></span> ' + label;
    iframe.src = url;
    pane.classList.add('open');
    handle.classList.add('visible');
    const saved = parseInt(localStorage.getItem('wct:extai-width') || '', 10);
    if (!isNaN(saved) && saved >= 120) pane.style.width = saved + 'px';
}

function closeExtAIPane() {
    const pane = document.getElementById('extai-pane');
    const handle = document.getElementById('extai-resize-handle');
    pane.classList.remove('open');
    handle.classList.remove('visible');
    document.getElementById('extai-iframe').src = '';
    _extAICurrentUrl = '';
}

function openExtAINewTab() {
    if (_extAICurrentUrl) window.open(_extAICurrentUrl, '_blank');
}

// --- External AI Pane Resize ---
(function initExtAIResize() {
    const handle = document.getElementById('extai-resize-handle');
    if (!handle) return;
    let startX, startW;
    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        const pane = document.getElementById('extai-pane');
        startX = e.clientX;
        startW = pane.getBoundingClientRect().width;
        handle.classList.add('dragging');
        const onMove = ev => {
            const w = Math.max(120, startW - (ev.clientX - startX));
            pane.style.width = w + 'px';
        };
        const onUp = () => {
            handle.classList.remove('dragging');
            localStorage.setItem('wct:extai-width', parseInt(pane.style.width));
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
})();

// --- Guided Tour ---
let _tourIdx = 0;
const _tourSteps = [
    {
        title: '<span class="codicon codicon-shield"></span> Welcome to Forge v2',
        body: '<p>The <strong>Forge</strong> is a browser-based IDE for building offline HTML/CSS/JS applications — no server, no install, no network required.</p><p>This tour walks you through the full workflow: from opening a project to shipping a compiled app.</p><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> Retake this tour anytime: Ctrl+Shift+P &rarr; "Guided Tour"</div>'
    },
    {
        title: '<span class="codicon codicon-folder-opened"></span> Step 1: Open a Project',
        body: '<p>Click <strong>Open Folder</strong> to load a local directory. Forge reads and writes files directly on your machine using the File System Access API.</p><div class="tour-highlight">&#8226; Your files appear in the <strong>Explorer</strong> sidebar<br>&#8226; Click any file to open it in the editor<br>&#8226; Right-click files/folders for rename, delete, new file</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> No server needed — works from file:// and runs entirely in your browser.</div>',
        highlight: '[data-panel="explorer"]',
        onEnter: () => switchPanel('explorer')
    },
    {
        title: '<span class="codicon codicon-hubot"></span> Step 2: AI Services to Generate Code',
        body: '<p>Click <strong>AI Services</strong> in the top-right to open your preferred AI chatbot in a new tab. Snap both windows side by side.</p><div class="tour-highlight"><strong>Recommended workflow:</strong><br>1. Click <strong>AI Services</strong> &rarr; pick a chatbot<br>2. Tell the AI: "Create a single-file, vanilla, offline HTML application that [your idea]"<br>3. Copy the AI\'s response<br>4. Paste it into your <code>index.html</code> in Forge</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> Ask for complete files, not snippets. AI works best when it returns the full code.</div>',
        highlight: '.brand'
    },
    {
        title: '<span class="codicon codicon-save"></span> Step 3: Edit &amp; Save',
        body: '<p>Edit files in the CodeMirror editor with syntax highlighting, search (Ctrl+F), and bracket matching.</p><div class="tour-highlight">&#8226; <strong>Ctrl+S</strong> — Save all modified files<br>&#8226; <strong>Ctrl+Shift+S</strong> — Save current file only<br>&#8226; Unsaved files show a <strong style="color:#f1c40f">&#9679;</strong> dot on their tab<br>&#8226; Tab key inserts 4 spaces</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> Changes only exist in memory until you save. Save often!</div>',
        highlight: '#tabs-bar'
    },
    {
        title: '<span class="codicon codicon-run-all"></span> Step 4: Run Your App',
        body: '<p>After saving your files, run the app directly from your project folder so you are testing the real output.</p><div class="tour-highlight">&#8226; Keep your entry file named <code>index.html</code> when possible<br>&#8226; Open it from File Explorer to validate the full app outside the editor shell<br>&#8226; Use <strong>Dev Console</strong> and <strong>Test Recorder</strong> when you need debugging or repeatable checks</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> This keeps testing aligned with the actual files you will ship.</div>',
        highlight: '#tabs-bar'
    },
    {
        title: '<span class="codicon codicon-bookmark"></span> Step 5: Create Checkpoints',
        body: '<p>Before risky changes (like pasting new AI code), create a <strong>checkpoint</strong> — a named snapshot of all project files.</p><div class="tour-highlight">The checkpoint bar appears above the editor tabs:<br>&#8226; <strong>Checkpoint</strong> — Save current state with a name<br>&#8226; <strong>Restore</strong> — Roll back to any previous checkpoint<br>&#8226; <strong>Delete</strong> — Remove old checkpoints<br><br>Checkpoints are stored as JSON files in a <code>.checkpoints</code> folder inside your project.</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> Always checkpoint before pasting large AI responses. You can undo if something breaks.</div>',
        highlight: '#checkpoint-bar'
    },
    {
        title: '<span class="codicon codicon-note"></span> Step 6: Plan with AI Prompts',
        body: '<p>The <strong>Plan</strong> panel provides structured prompts to help you define what to build before writing code.</p><div class="tour-highlight"><strong>Basic (JTBD Method):</strong><br>1. JTBD Interview — AI interviews you to uncover requirements<br>2. Extract Jobs &amp; Tools — Identify user needs<br>3. MVP Ladder — Build incrementally<br>4. Technical Approaches — Compare solutions<br>5. Build Prompt — Generate the starter code prompt<br><br><strong>Advanced:</strong> JSON save/load, CSV import, OCR, data pipelines</div>',
        highlight: '[data-panel="plan"]',
        onEnter: () => switchPanel('plan')
    },
    {
        title: '<span class="codicon codicon-tools"></span> Step 7: Build Tools',
        body: '<p>The <strong>Build</strong> panel has tools to help you develop and integrate features:</p><div class="tour-highlight">&#8226; <strong>LLM Context</strong> — Copy all project files as one block for pasting into AI<br>&#8226; <strong>Dev Console</strong> — Add a floating debug console to your app<br>&#8226; <strong>ShareDrive-NoSQL</strong> — File-based JSON database for shared folders<br>&#8226; <strong>Leaflet Maps</strong> — Convert GeoJSON for offline map integration</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> "LLM Context" is the most-used tool. It copies your entire project so AI has full context.</div>',
        highlight: '[data-panel="build"]',
        onEnter: () => switchPanel('build')
    },
    {
        title: '<span class="codicon codicon-shield"></span> Step 8: Harden Your App',
        body: '<p>The <strong>Harden</strong> panel helps you find and fix security issues before shipping:</p><div class="tour-highlight">&#8226; <strong>SAST Scanner</strong> — Scans for XSS, eval, innerHTML, and other vulnerabilities<br>&#8226; <strong>Security Reviewer</strong> — STIG compliance check + generates security report<br>&#8226; <strong>SBOM Export</strong> — Software Bill of Materials in CycloneDX JSON<br>&#8226; <strong>Test Recorder</strong> — Record click/input interactions as test scenarios<br>&#8226; <strong>Math &amp; Logic Tester</strong> — Generate audit prompts for calculations</div>',
        highlight: '[data-panel="harden"]',
        onEnter: () => switchPanel('harden')
    },
    {
        title: '<span class="codicon codicon-rocket"></span> Step 9: Ship It!',
        body: '<p>Click the <strong>Ship</strong> button (top-right) or use the Ship panel to compile your project into a single standalone HTML file.</p><div class="tour-highlight">The compiler bundles everything:<br>&#8226; All JS/CSS inlined into one file<br>&#8226; Images base64-encoded<br>&#8226; CSP security headers injected<br>&#8226; WFC manifest for decompilation<br>&#8226; SHA-256 hash logged<br><br>The <strong>Decompiler</strong> can reverse the process to recover original files.</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> The compiled file runs completely offline with zero network dependencies.</div>',
        highlight: '[data-panel="ship"]',
        onEnter: () => switchPanel('ship')
    },
    {
        title: '<span class="codicon codicon-hubot"></span> Step 10: Prometheus (Optional)',
        body: '<p>For direct AI integration, configure an API endpoint in the <strong>Prometheus</strong> panel. The built-in chat can read/write your project files.</p><div class="tour-highlight"><strong>Supports any OpenAI-compatible API:</strong><br>&#8226; Anthropic (Claude) &#8226; OpenAI (GPT) &#8226; Google (Gemini)<br>&#8226; Mistral &#8226; DeepSeek &#8226; xAI (Grok) &#8226; Meta (Llama)<br><br>Or use the <strong>offline workflow</strong>: LLM Context &rarr; copy &rarr; paste into any chatbot &rarr; paste response back.</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> This is optional. The app works fully offline without any API configured.</div>',
        highlight: '#statusbar-agent-toggle',
        onEnter: () => toggleRightPanel(true)
    },
    {
        title: '<span class="codicon codicon-check"></span> You\'re Ready!',
        body: '<p>That\'s everything. Here\'s the quick reference:</p><div class="tour-highlight"><strong>Keyboard Shortcuts:</strong><br>&#8226; <kbd>Ctrl+Shift+P</kbd> — Command Palette<br>&#8226; <kbd>Ctrl+S</kbd> — Save all files<br>&#8226; <kbd>Ctrl+B</kbd> — Toggle sidebar<br>&#8226; <kbd>Ctrl+Shift+E</kbd> — Explorer<br>&#8226; <kbd>Ctrl+Shift+F</kbd> — Search across files<br>&#8226; <kbd>Ctrl+,</kbd> — Settings</div><div class="tour-tip"><span class="codicon codicon-lightbulb"></span> Workflow: <strong>Open Folder &rarr; AI Services &rarr; Paste Code &rarr; Save &rarr; Run &rarr; Iterate &rarr; Ship</strong></div>'
    }
];

function startGuidedTour() {
    _tourIdx = 0;
    renderTourStep();
    document.getElementById('tour-modal').classList.add('show');
}

function closeTour() {
    document.getElementById('tour-modal').classList.remove('show');
    $$('.tour-pulse').forEach(el => el.classList.remove('tour-pulse'));
    localStorage.setItem('wct:toured', '1');
}

function tourStep(dir) {
    $$('.tour-pulse').forEach(el => el.classList.remove('tour-pulse'));
    _tourIdx += dir;
    if (_tourIdx >= _tourSteps.length) { closeTour(); return; }
    if (_tourIdx < 0) _tourIdx = 0;
    renderTourStep();
}

function renderTourStep() {
    const step = _tourSteps[_tourIdx];
    document.getElementById('tour-content').innerHTML = '<div class="tour-step"><h3>' + step.title + '</h3>' + step.body + '</div>';
    document.getElementById('tour-progress').textContent = (_tourIdx + 1) + ' / ' + _tourSteps.length;
    document.getElementById('tour-prev').style.visibility = _tourIdx === 0 ? 'hidden' : 'visible';
    document.getElementById('tour-next').textContent = _tourIdx === _tourSteps.length - 1 ? 'Get Started' : 'Next';
    // Render step navigation
    const nav = document.getElementById('tour-steps-nav');
    if (nav) {
        const labels = ['Welcome','Open Project','AI Services','Edit & Save','Run','Checkpoints','Plan','Build','Harden','Ship','Prometheus','Ready!'];
        nav.innerHTML = _tourSteps.map((_, i) => {
            const cls = i === _tourIdx ? 'active' : (i < _tourIdx ? 'completed' : '');
            return '<div class="tour-nav-item ' + cls + '" onclick="tourJump(' + i + ')">' + (labels[i] || ('Step ' + (i+1))) + '</div>';
        }).join('');
    }
    // Run onEnter callback (e.g. switch sidebar panel)
    if (step.onEnter) step.onEnter();
    // Pulse highlight
    if (step.highlight) {
        const el = document.querySelector(step.highlight);
        if (el) el.classList.add('tour-pulse');
    }
}

function tourJump(idx) {
    $$('.tour-pulse').forEach(el => el.classList.remove('tour-pulse'));
    _tourIdx = idx;
    renderTourStep();
}

// --- Plan Panel Initialization ---
function initPlanPanels() {
    const basicSteps = ['1. JTBD Interview', '2. Extract Jobs & Tools', '3. MVP Ladder', '4. Technical Approaches', '5. Build Prompt'];
    const advancedSteps = ['6. JSON Save/Load', '7. CSV/Excel Import', '8. Export to Docs', '9. OCR (Image Text)', '10. LLM Data Pipeline', '11. SharePoint Integration'];

    const basic = document.getElementById('plan-basic-body');
    basicSteps.forEach((s, i) => {
        basic.innerHTML += '<div class="file-tree-item" onclick="openPromptStep(' + (i + 1) + ')"><span class="icon"><span class="codicon codicon-note"></span></span>' + s + '</div>';
    });
    const adv = document.getElementById('plan-advanced-body');
    advancedSteps.forEach((s, i) => {
        adv.innerHTML += '<div class="file-tree-item" onclick="openPromptStep(' + (i + 6) + ')"><span class="icon"><span class="codicon codicon-tools"></span></span>' + s + '</div>';
    });
}
