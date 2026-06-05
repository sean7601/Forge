/* ===== Forge v2 — Editor: CodeMirror 6 Setup, Tabs, File Editing ===== */

// --- CM6 Setup ---
let cmModules = null;
(function initCM6() {
    const cm6Globals = window.cm6;
    if (!cm6Globals) return;
    const {
        EditorState, EditorView, keymap, basicSetup, searchKeymap,
        foldCode, foldKeymap, syntaxTree, lintGutter, lintKeymap, linter,
        javascript, javascriptLanguage, html: htmlLang, css: cssLang, python, oneDark,
        StateField, StateEffect, Decoration, RangeSetBuilder, ViewPlugin, WidgetType, Compartment
    } = cm6Globals;
    cmModules = {
        EditorState, EditorView, keymap, basicSetup,
        searchKeymap: Array.isArray(searchKeymap) ? searchKeymap : [],
        foldCode: typeof foldCode === 'function' ? foldCode : null,
        foldKeymap: Array.isArray(foldKeymap) ? foldKeymap : [],
        syntaxTree: typeof syntaxTree === 'function' ? syntaxTree : null,
        lintGutter: typeof lintGutter === 'function' ? lintGutter : null,
        lintKeymap: Array.isArray(lintKeymap) ? lintKeymap : [],
        linter: typeof linter === 'function' ? linter : null,
        javascript, javascriptLanguage, htmlLang, cssLang, python, oneDark,
        StateField, StateEffect, Decoration, RangeSetBuilder, ViewPlugin, WidgetType, Compartment
    };
    cmModules.searchKeymapExtensions = cmModules.searchKeymap.length ? [cmModules.keymap.of(cmModules.searchKeymap)] : [];
    cmModules.foldKeymapExtensions = cmModules.foldKeymap.length ? [cmModules.keymap.of(cmModules.foldKeymap)] : [];
    window.cmModules = cmModules;
})();

function isLightTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'light' || t === 'beach';
}

function createWctTheme() {
    const light = isLightTheme();
    return cmModules.EditorView.theme({
        '&': { backgroundColor: 'var(--bg-editor)', color: 'var(--text)' },
        '.cm-content': { fontFamily: 'var(--font-code)', fontSize: '13px', lineHeight: '1.68' },
        '.cm-gutters': { backgroundColor: 'var(--bg-deep)', color: 'var(--text-dim)', border: 'none', minWidth: '40px' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, & ::selection': { backgroundColor: 'var(--selection)' },
        '.cm-cursor': { borderLeftColor: light ? 'var(--text)' : 'var(--accent-light)' },
        '.cm-activeLine': { backgroundColor: 'var(--hover)' },
        '.cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
        '.cm-searchMatch': { backgroundColor: 'rgba(255,193,7,0.3)', outline: '1px solid rgba(255,193,7,0.5)' },
        '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255,193,7,0.5)' }
    }, { dark: !light });
}

function rebuildAllEditors() {
    if (!cmModules) return;
    for (const path in cmEditors) {
        const f = openFiles.find(fi => fi.path === path);
        if (f && cmEditors[path]) f.content = cmEditors[path].state.doc.toString();
        cmEditors[path].destroy();
        delete cmEditors[path];
    }
    renderEditors();
}

// --- File Operations ---
async function openFile(path) {
    if (openFiles.find(f => f.path === path)) { activateTab(path); return; }
    const handle = fileHandles[path];
    if (!handle) return;
    const file = await handle.getFile();
    const text = await file.text();
    const ext = path.split('.').pop().toLowerCase();
    openFiles.push({ path, name: path.split('/').pop(), content: text, original: text, ext });
    renderTabs();
    activateTab(path);
}

function activateTab(path) {
    activeFile = path;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.path === path));
    $$('.editor-instance').forEach(e => e.classList.toggle('active', e.dataset.path === path));
    const activeTab = document.querySelector('.tab[data-path="' + CSS.escape(path) + '"]');
    if (activeTab) activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    document.getElementById('editor-welcome').style.display = openFiles.length ? 'none' : '';
    const f = openFiles.find(f => f.path === path);
    if (f) {
        document.getElementById('status-lang').textContent = langMap[f.ext] || 'Plain Text';
        updateCursorPos(f);
    }
    highlightFileTree(path);
}

function highlightFileTree(path) {
    $$('.file-tree-item').forEach(i => i.classList.toggle('selected', i.dataset.path === path));
}

function renderTabs() {
    const bar = document.getElementById('tabs-bar');
    bar.innerHTML = '';
    openFiles.forEach(f => {
        const tab = document.createElement('div');
        tab.className = 'tab' + (f.path === activeFile ? ' active' : '');
        tab.dataset.path = f.path;
        const ext = f.ext;
        const icon = iconMap[ext] || iconMap.default;
        const unsaved = unsavedFiles.has(f.path) ? '<span class="unsaved">&#9679;</span>' : '';
        tab.innerHTML = icon + ' ' + escHtml(f.name) + unsaved + '<span class="close-tab" data-close="' + escHtml(f.path) + '">&#10005;</span>';
        tab.addEventListener('click', (ev) => {
            if (ev.target.classList.contains('close-tab') || ev.target.dataset.close) {
                ev.stopPropagation();
                closeTab(ev.target.dataset.close || f.path);
                return;
            }
            activateTab(f.path);
        });
        bar.appendChild(tab);
    });
    renderEditors();
}

function renderEditors() {
    const container = document.getElementById('editor-container');
    const existing = new Map();
    container.querySelectorAll('.editor-instance').forEach(e => existing.set(e.dataset.path, e));
    const openPaths = new Set(openFiles.map(f => f.path));
    existing.forEach((el, path) => { if (!openPaths.has(path)) el.remove(); });

    openFiles.forEach(f => {
        let ed = existing.get(f.path);
        if (!ed) {
            ed = document.createElement('div');
            ed.className = 'editor-instance';
            ed.dataset.path = f.path;
            container.appendChild(ed);
        }
        ed.classList.toggle('active', f.path === activeFile);

        if (cmModules) {
            if (!cmEditors[f.path]) {
                const ext = f.ext;
                let langExt = [];
                if (ext === 'js' || ext === 'mjs') langExt = [cmModules.javascript()];
                else if (ext === 'html' || ext === 'htm') langExt = cmModules.htmlLang ? [cmModules.htmlLang()] : [];
                else if (ext === 'css') langExt = cmModules.cssLang ? [cmModules.cssLang()] : [];
                else if (ext === 'py') langExt = cmModules.python ? [cmModules.python()] : [];
                const state = cmModules.EditorState.create({
                    doc: f.content,
                    extensions: [
                        cmModules.basicSetup,
                        ...langExt,
                        ...(isLightTheme() ? [] : [cmModules.oneDark]),
                        createWctTheme(),
                        ...cmModules.searchKeymapExtensions,
                        ...cmModules.foldKeymapExtensions,
                        cmModules.EditorView.updateListener.of(update => {
                            if (update.docChanged) {
                                f.content = update.state.doc.toString();
                                markUnsaved(f.path);
                            }
                            updateCursorPos(f, update.view);
                        }),
                        cmModules.keymap.of([{
                            key: 'Tab',
                            run: (view) => {
                                view.dispatch(view.state.replaceSelection('    '));
                                return true;
                            }
                        }])
                    ]
                });
                cmEditors[f.path] = new cmModules.EditorView({ state, parent: ed });
            } else if (cmEditors[f.path].dom.parentElement !== ed) {
                ed.appendChild(cmEditors[f.path].dom);
            }
        } else if (!ed.querySelector('textarea')) {
            // Fallback: textarea editor if CM6 didn't load
            const ta = document.createElement('textarea');
            ta.spellcheck = false;
            ta.value = f.content;
            ta.style.cssText = 'flex:1;background:transparent;color:var(--text);border:none;outline:none;font-family:var(--font-code);font-size:13px;line-height:1.68;padding:12px 16px;resize:none;tab-size:4;white-space:pre;overflow-wrap:normal;overflow-x:auto;caret-color:var(--text-bright);width:100%;height:100%';
            ta.addEventListener('input', () => { f.content = ta.value; markUnsaved(f.path); });
            ta.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.substring(0, s) + '    ' + ta.value.substring(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 4; f.content = ta.value; markUnsaved(f.path); }
            });
            ed.appendChild(ta);
        }
    });

    // Keep wrapper order aligned with tab order.
    openFiles.forEach(f => {
        const ed = container.querySelector('.editor-instance[data-path="' + CSS.escape(f.path) + '"]');
        if (ed) container.appendChild(ed);
    });

    document.getElementById('editor-welcome').style.display = openFiles.length ? 'none' : '';
}

function getEditorContent(path) {
    const f = openFiles.find(fi => fi.path === path);
    if (!f) return '';
    if (cmEditors[path]) return cmEditors[path].state.doc.toString();
    return f.content;
}

function updateCursorPos(f, view) {
    if (!view && cmEditors[f.path]) view = cmEditors[f.path];
    if (view) {
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        document.getElementById('status-cursor').textContent = 'Ln ' + line.number + ', Col ' + (pos - line.from + 1);
    }
}

function markUnsaved(path) {
    unsavedFiles.add(path);
    const tab = document.querySelector('.tab[data-path="' + CSS.escape(path) + '"]');
    if (tab && !tab.querySelector('.unsaved')) {
        const name = tab.querySelector('.close-tab');
        if (name) name.insertAdjacentHTML('beforebegin', '<span class="unsaved">&#9679;</span>');
    }
}

function closeTab(path) {
    const idx = openFiles.findIndex(f => f.path === path);
    if (idx === -1) return;
    openFiles.splice(idx, 1);
    unsavedFiles.delete(path);
    if (cmEditors[path]) { cmEditors[path].destroy(); delete cmEditors[path]; }
    if (activeFile === path) {
        if (openFiles.length) activateTab(openFiles[Math.min(idx, openFiles.length - 1)].path);
        else { activeFile = null; document.getElementById('editor-welcome').style.display = ''; document.getElementById('status-lang').textContent = 'Plain Text'; }
    }
    renderTabs();
}

// --- Save ---
async function saveAll() {
    for (const path of unsavedFiles) {
        const f = openFiles.find(fi => fi.path === path);
        const handle = fileHandles[path];
        if (!f || !handle) continue;
        if (cmEditors[path]) f.content = cmEditors[path].state.doc.toString();
        try {
            await writeFileToHandle(handle, f.content);
            f.original = f.content;
        } catch (e) { console.error('Save failed:', path, e); }
    }
    unsavedFiles.clear();
    renderTabs();
    showStatusMsg('All files saved');
}

async function saveCurrentFile() {
    if (!activeFile) return;
    const f = openFiles.find(fi => fi.path === activeFile);
    const handle = fileHandles[activeFile];
    if (!f || !handle) return;
    if (cmEditors[activeFile]) f.content = cmEditors[activeFile].state.doc.toString();
    try {
        await writeFileToHandle(handle, f.content);
        f.original = f.content;
        unsavedFiles.delete(activeFile);
        renderTabs();
        showStatusMsg(f.name + ' saved');
    } catch (e) { console.error(e); }
}

// --- Settings ---
function setWordWrap(v) {
    $$('.editor-instance textarea').forEach(t => {
        t.style.whiteSpace = v === 'on' ? 'pre-wrap' : 'pre';
        t.style.overflowWrap = v === 'on' ? 'break-word' : 'normal';
    });
}
