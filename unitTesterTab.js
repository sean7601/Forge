const unitTesterTab = {
    _setSafeContent(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
        el.replaceChildren(frag);
    },

    init() {
        const pane = document.getElementById('unit-tester');
        if (!pane) return;
        this._setSafeContent(pane, this.renderBase());
        this.bind();

        $('#unit-tester-tab').on('shown.bs.tab', () => {
            this.checkStatus();
        });

        if ($('#unit-tester').hasClass('active') || $('#unit-tester').hasClass('show')) {
            this.checkStatus();
        }
    },

    renderBase() {
        return `
            <h3>AI Unit Test Generator</h3>
            <p>Use an external LLM (like ChatGPT/Claude) to analyze your code and generate intelligent, context-aware unit tests.</p>

            <div class="integration-section mb-4" id="unit-test-integration-panel">
                <h4>1. Runner Integration</h4>
                <div id="unit-test-status" class="d-flex align-items-center p-3 rounded"
                    style="background-color: #343a40; border: 1px solid #495057;">
                    <span class="status-badge mr-3" id="unit-test-status-badge">Checking...</span>
                    <span id="unit-test-status-message" class="flex-grow-1">Checking system...</span>
                    <button id="unit-test-refresh-status-btn" class="btn btn-sm btn-outline-secondary ml-2">🔄 Check</button>
                </div>
                <div class="actions-section mt-3 d-flex flex-wrap" style="gap: .5rem;">
                    <button id="unit-test-add-btn" class="btn btn-success" disabled>➕ Inject Runner</button>
                    <button id="unit-test-update-btn" class="btn btn-warning" style="display:none;">🔄 Update Runner</button>
                </div>
                <div id="unit-test-progress" class="progress-indicator" aria-live="polite" style="display:none;">
                    <span class="spinner" aria-hidden="true"></span>
                    <span id="unit-test-progress-text">Processing...</span>
                </div>
                <div class="mt-2 small">Run tests via <kbd>Ctrl+Alt+T</kbd> in your app.</div>
            </div>

            <hr class="my-4">

            <div class="unit-test-builder">
                <h4>2. Plan Generation</h4>
                <div class="row">
                    <div class="col-md-5">
                        <label class="font-weight-bold">Select Files to Test</label>
                        <div class="d-flex mb-2" style="gap: 5px;">
                            <button id="ut-select-all-btn" class="btn btn-sm btn-outline-secondary">Select All</button>
                            <button id="ut-deselect-all-btn" class="btn btn-sm btn-outline-secondary">Deselect All</button>
                        </div>
                        <div id="ut-file-list" class="border rounded p-2 mb-3" style="max-height: 200px; overflow-y: auto; background: #212529;">
                            <div class="text-muted small p-2">Load a folder to see files...</div>
                        </div>
                        <button id="ut-gen-prompt-btn" class="btn btn-primary btn-block mb-3">Generate AI Prompt</button>
                        
                        <label class="font-weight-bold">AI Response (Paste JSON)</label>
                        <textarea id="ut-json-paste" class="form-control mb-2" rows="6" placeholder="Paste the JSON returned by the AI here..."></textarea>
                        <button id="ut-apply-plan-btn" class="btn btn-info btn-block">💾 Save Test Plan</button>
                    </div>
                    
                    <div class="col-md-7">
                        <label class="font-weight-bold">AI Prompt Preview</label>
                        <div class="position-relative">
                            <textarea id="ut-prompt-preview" class="form-control" rows="18" readonly style="font-family: monospace; font-size: 0.8em;"></textarea>
                            <button id="ut-copy-prompt-btn" class="btn btn-sm btn-light position-absolute" style="top: 10px; right: 10px;">📋 Copy</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    bind() {
        $('#unit-test-refresh-status-btn').on('click', () => this.checkStatus());
        $('#unit-test-add-btn').on('click', () => this.integrate(false));
        $('#unit-test-update-btn').on('click', () => this.integrate(true));
        
        $('#ut-gen-prompt-btn').on('click', () => this.generateLLMPrompt());
        $('#ut-select-all-btn').on('click', () => $('.file-select-cb').prop('checked', true));
        $('#ut-deselect-all-btn').on('click', () => $('.file-select-cb').prop('checked', false));
        
        $('#ut-copy-prompt-btn').on('click', () => {
            const text = document.getElementById('ut-prompt-preview').value;
            if(text) {
                navigator.clipboard.writeText(text);
                const btn = $('#ut-copy-prompt-btn');
                const orig = btn.text();
                btn.text('Copied!');
                setTimeout(() => btn.text(orig), 2000);
            }
        });
        $('#ut-apply-plan-btn').on('click', () => this.applyPastedPlan());

        $('#unit-tester-tab').on('shown.bs.tab', () => {
            this.renderFileList();
            this.checkStatus();
        });
    },

    async renderFileList() {
        const container = $('#ut-file-list');
        if (!loadFolder || !loadFolder.fileStructure) {
            container.html('<div class="text-danger p-2">No project loaded.</div>');
            return;
        }

        const files = loadFolder.fileStructure.filter(f => 
            (f.name.endsWith('.js') || f.name.endsWith('.html')) && 
            !f.name.includes('unitTest')
        );
        
        if (files.length === 0) {
            container.html('<div class="text-muted p-2">No code files found.</div>');
            return;
        }

        let html = '';
        files.forEach(f => {
            const id = `ut-file-${f.uuid}`;
            html += `
                <div class="form-check">
                    <input class="form-check-input file-select-cb" type="checkbox" value="${f.uuid}" id="${id}">
                    <label class="form-check-label small" for="${id}" title="${f.relativePath}">
                        ${f.relativePath}
                    </label>
                </div>
            `;
        });
        container.html(html);
    },

    async generateLLMPrompt() {
        const selected = $('.file-select-cb:checked').map((_, el) => el.value).get();
        if(!selected.length) return alert("Select at least one file to test.");

        const btn = $('#ut-gen-prompt-btn');
        const originalText = btn.text();
        btn.prop('disabled', true).text('Reading files...');

        let codeDump = '';
        for(const uuid of selected) {
            const file = loadFolder.fileStructure.find(f => f.uuid === uuid);
            if(file) {
                let content = '';
                try { 
                    // Ensure we are getting the text content
                    const fileHandle = await file.entry.getFile();
                    content = await fileHandle.text();
                } catch(e) { 
                    console.error("Error reading file for prompt:", file.relativePath, e);
                    content = "// Error reading file: " + e.message; 
                }
                codeDump += `\n\n--- FILE: ${file.relativePath} ---\n${content}`;
            }
        }

        btn.prop('disabled', false).text(originalText);

        const prompt = `You are an expert QA Automation Engineer.
I need you to generate a JSON test plan for the following JavaScript codebase.
The test runner is a simple custom harness that runs in the browser.

Supported Assertion Types:
- "equals" (strict equality ===)
- "deepEquals" (JSON.stringify comparison)
- "truthy"
- "falsy"
- "throws" (expects function to throw error)
- "notThrows" (expects function to return without error)
- "typeOf" (value: "string", "number", etc)

INSTRUCTIONS:
1. Analyze the code to understand the logic and edge cases.
2. Identify pure functions and logic-heavy functions that can be tested in isolation.
3. For each function, generate 3-5 test cases (Happy Path + Edge Cases).
4. OUTPUT ONLY VALID JSON matching this schema:

{
  "targets": [
    {
      "path": "functionName", // e.g., "myCalc" or "app.utils.format"
      "cases": [
        {
          "name": "Description of case",
          "args": [1, "test"], // Arguments array
          "expected": { "type": "equals", "value": 123 }
        }
      ]
    }
  ]
}

NOTES:
- Use "path" to reference the function. If it's global, just the name. If on an object, "obj.method".
- Ensure "args" matches the function signature.
- Do not output Markdown formatting, just the raw JSON.

CODEBASE:
${codeDump}`;

        document.getElementById('ut-prompt-preview').value = prompt;
    },

    async applyPastedPlan() {
        const raw = document.getElementById('ut-json-paste').value;
        if (!raw.trim()) return alert("Paste the JSON test plan first.");

        try {
            // loose parsing to handle if they pasted markdown code blocks
            let jsonStr = raw;
            if (raw.includes('```json')) {
                jsonStr = raw.split('```json')[1].split('```')[0];
            } else if (raw.includes('```')) {
                jsonStr = raw.split('```')[1].split('```')[0];
            }
            
            const plan = JSON.parse(jsonStr);
            if (!plan.targets || !Array.isArray(plan.targets)) throw new Error("Invalid schema: missing 'targets' array.");

            await this._writeProjectFile('unitTest.plan.js', this.buildPlanJs(plan));
            alert("Test Plan Saved Successfully! Refresh your app to run tests.");
            this.checkStatus();
        } catch (e) {
            alert("Error parsing JSON: " + e.message);
        }
    },

    async checkStatus() {
        const statusBadge = $('#unit-test-status-badge');
        const statusMessage = $('#unit-test-status-message');
        const addBtn = $('#unit-test-add-btn');
        const updateBtn = $('#unit-test-update-btn');
        const addPlanBtn = $('#unit-test-add-plan-btn');

        addBtn.prop('disabled', true).show();
        updateBtn.hide();
        addPlanBtn.prop('disabled', true);

        statusBadge.text('Checking...').attr('class', 'status-badge checking');
        statusMessage.text('Checking if unit tests are integrated...');

        if (!loadFolder || !loadFolder.fileHandle) {
            statusBadge.text('No Project').attr('class', 'status-badge not-found');
            statusMessage.text('Load a directory first to check integration.');
            return;
        }

        const runnerFile = loadFolder.fileStructure.find(f => f.name === 'unitTest.js');
        const planFile = loadFolder.fileStructure.find(f => f.name === 'unitTest.plan.js');
        const indexFile = loadFolder.fileStructure.find(f => f.name.toLowerCase() === 'index.html');

        if (runnerFile) {
            statusBadge.text('Found').attr('class', 'status-badge found');
            statusMessage.text('unitTest.js is present in your project.');
            addBtn.hide();
            updateBtn.show();
            addPlanBtn.prop('disabled', !planFile);
        } else {
            statusBadge.text('Not Found').attr('class', 'status-badge not-found');
            statusMessage.text('unitTest.js is not yet integrated in your project.');
            addBtn.prop('disabled', false).show();
            updateBtn.hide();
            addPlanBtn.prop('disabled', true);
        }

        if (indexFile) {
            const { content } = await this._getHtmlContentForFile(indexFile);
            const hasPlanTag = /unitTest\.plan\.js/i.test(content);
            const hasRunnerTag = /unitTest\.js/i.test(content);
            if (!hasPlanTag || !hasRunnerTag) {
                statusMessage.text('unitTest.js is present, but script tags are missing in index.html. Click Update to inject.');
            }
        }
    },

    async integrate(isUpdate) {
        if (!loadFolder || !loadFolder.fileHandle) {
            alert('Please load a directory first.');
            return;
        }

        if (isUpdate && !confirm('This will overwrite your existing unitTest.js file. Continue?')) {
            return;
        }

        const addBtn = $('#unit-test-add-btn');
        const updateBtn = $('#unit-test-update-btn');
        const progress = $('#unit-test-progress');
        const progressText = $('#unit-test-progress-text');

        const actionBtn = isUpdate ? updateBtn : addBtn;
        const otherBtn = isUpdate ? addBtn : updateBtn;
        const originalText = actionBtn.data('originalText') || actionBtn.text();
        actionBtn.data('originalText', originalText);

        actionBtn.prop('disabled', true).text('⏳ Working...');
        otherBtn.prop('disabled', true);

        progress.css('display', 'flex').removeClass('success error').addClass('loading');
        progressText.text(isUpdate ? 'Updating unitTest.js...' : 'Adding unitTest.js to your project...');

        try {
            const runnerCode = this.getRunnerCode();
            await this._writeProjectFile('unitTest.js', runnerCode);

            const planFile = loadFolder.fileStructure.find(f => f.name === 'unitTest.plan.js');
            if (!planFile && !isUpdate) {
                const plan = this.getDefaultPlan();
                await this._writeProjectFile('unitTest.plan.js', this.buildPlanJs(plan));
            }

            await this.addScriptTagsToHtmlFiles();

            loadFolder.fileStructure = await loadFolder.recursivelyReadDirectory([], loadFolder.fileHandle);
            loadFolder.refreshFileTree();
            await this.checkStatus();

            progress.removeClass('loading error').addClass('success');
            progressText.text(isUpdate ? 'unitTest.js updated successfully.' : 'unitTest.js added successfully.');

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
            console.error('Unit Tester integrate error:', err);
            progress.removeClass('loading success').addClass('error');
            progressText.text('Failed to integrate unitTest.js. See console.');
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

    async generatePlan() {
        if (!loadFolder || !loadFolder.fileHandle) {
            alert('Load a directory first.');
            return;
        }

        const mode = $('input[name="unit-test-mode"]:checked').val();
        const includeArrow = document.getElementById('unit-test-include-arrow').checked;
        const skipLarge = document.getElementById('unit-test-skip-large').checked;
        const expectationMode = document.getElementById('unit-test-expectation-mode').value;

        let targets = [];
        let functionCatalog = [];

        if (mode === 'broad') {
            functionCatalog = await this.scanFunctions({ includeArrow, skipLarge });
            targets = functionCatalog;
        } else {
            const raw = document.getElementById('unit-test-targets').value || '';
            const list = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (!list.length) {
                alert('Add at least one target function or switch to Broad mode.');
                return;
            }
            functionCatalog = await this.scanFunctions({ includeArrow, skipLarge, limitToNames: list });
            targets = list.map(name => {
                const match = functionCatalog.find(f => f.name === name || f.simpleName === name || f.simpleName === name.split('.').pop());
                if (match) return { ...match, path: name };
                return { name, path: name, params: [], definedIn: 'unknown' };
            });
        }

        if (!targets.length) {
            alert('No functions found to test.');
            return;
        }

        const plan = this.buildPlan(targets, expectationMode, mode);
        const json = JSON.stringify(plan, null, 2);
        this._lastPlan = plan;
        this._lastPlanJson = json;
        this._lastPlanJs = this.buildPlanJs(plan);

        const output = document.getElementById('unit-test-plan-output');
        output.value = json;
        output.scrollTop = 0;

        const summary = document.getElementById('unit-test-plan-summary');
        summary.textContent = `Generated ${plan.targets.length} target(s) with ${plan.targets.reduce((acc, t) => acc + t.cases.length, 0)} total test case(s).`;

        $('#unit-test-copy-plan').prop('disabled', false);
        $('#unit-test-save-plan').prop('disabled', false);
        $('#unit-test-add-plan-btn').prop('disabled', false);
    },

    buildPlan(targets, expectationMode, mode) {
        const expectedFor = (kind) => {
            if (expectationMode === 'auto') {
                return { type: 'auto' };
            }
            if (expectationMode === 'edge-throws' && kind === 'edge') {
                return { type: 'throws' };
            }
            return { type: 'notThrows' };
        };

        return {
            meta: {
                generatedAt: new Date().toISOString(),
                mode,
                generatedBy: 'Forge Unit Tester'
            },
            options: {
                autoRun: false,
                failFast: false
            },
            targets: targets.map(t => {
                const params = Array.isArray(t.params) ? t.params : [];
                const normalArgs = params.map(p => this.generateValueForParam(p, 'normal'));
                const edgeArgs = params.map(p => this.generateValueForParam(p, 'edge'));
                const cases = [
                    {
                        name: 'normal inputs',
                        args: normalArgs,
                        expected: expectedFor('normal')
                    },
                    {
                        name: 'edge inputs',
                        args: edgeArgs,
                        expected: expectedFor('edge')
                    }
                ];
                return {
                    name: t.name || t.simpleName || 'unnamed',
                    path: t.path || t.name || t.simpleName,
                    definedIn: t.definedIn || 'unknown',
                    params,
                    cases
                };
            })
        };
    },

    buildPlanJs(plan) {
        return `// Auto-generated by Forge Unit Tester\nwindow.__unitTestPlan = ${JSON.stringify(plan, null, 2)};\n`;
    },

    getDefaultPlan() {
        return {
            meta: {
                generatedAt: new Date().toISOString(),
                mode: 'targeted',
                generatedBy: 'Forge Unit Tester'
            },
            options: {
                autoRun: false,
                failFast: false
            },
            targets: []
        };
    },

    async writePlanToProject() {
        if (!loadFolder || !loadFolder.fileHandle) {
            alert('Load a directory first.');
            return;
        }
        if (!this._lastPlanJs) {
            alert('Generate a plan first.');
            return;
        }
        await this._writeProjectFile('unitTest.plan.js', this._lastPlanJs);
        await this.addScriptTagsToHtmlFiles();
        loadFolder.fileStructure = await loadFolder.recursivelyReadDirectory([], loadFolder.fileHandle);
        loadFolder.refreshFileTree();
        await this.checkStatus();
    },

    copyPlan() {
        if (!this._lastPlanJson) return;
        navigator.clipboard.writeText(this._lastPlanJson).then(() => {
            const btn = $('#unit-test-copy-plan');
            const old = btn.text();
            btn.text('Copied!');
            setTimeout(() => btn.text(old), 1200);
        }).catch(err => alert('Copy failed: ' + err.message));
    },

    async scanFunctions({ includeArrow = true, skipLarge = true, limitToNames = null } = {}) {
        const files = (loadFolder.fileStructure || []).filter(f => f.kind === 'file' && f.name.toLowerCase().endsWith('.js'));
        const skipNames = new Set(['unittest.js', 'unittest.plan.js', 'simpletest.js', 'devconsole.js', 'cm6-bundle.js']);
        const results = [];
        const added = new Set();

        for (const file of files) {
            if (skipNames.has(file.name.toLowerCase())) continue;
            let text = '';
            try {
                text = await loadFolder.getFileContent(file);
            } catch (_) {
                continue;
            }
            if (skipLarge && text.length > 350000) {
                continue;
            }

            const patterns = [
                { regex: /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g, type: 'function' },
                { regex: /(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\(([^)]*)\)/g, type: 'function-expr' }
            ];
            if (includeArrow) {
                patterns.push({ regex: /(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>/g, type: 'arrow' });
                patterns.push({ regex: /(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*=>/g, type: 'arrow' });
            }

            for (const pattern of patterns) {
                let match;
                while ((match = pattern.regex.exec(text)) !== null) {
                    let name = '';
                    let rawParams = '';
                    if (pattern.type === 'function') {
                        name = match[1];
                        rawParams = match[2] || '';
                    } else if (pattern.type === 'function-expr') {
                        name = match[2];
                        rawParams = match[3] || '';
                    } else {
                        name = match[2];
                        rawParams = match[3] || '';
                    }
                    if (!name) continue;
                    if (limitToNames && !limitToNames.some(n => n === name || n.endsWith('.' + name))) {
                        continue;
                    }
                    const key = `${file.relativePath}:${name}`;
                    if (added.has(key)) continue;
                    added.add(key);
                    const params = this.parseParams(rawParams);
                    results.push({
                        name,
                        simpleName: name,
                        path: name,
                        params,
                        definedIn: file.relativePath
                    });
                }
            }
        }

        return results;
    },

    parseParams(raw) {
        if (!raw) return [];
        return raw
            .split(',')
            .map(p => p.trim())
            .filter(Boolean)
            .map((p, idx) => {
                if (/^[\[{]/.test(p)) return `param${idx + 1}`;
                return p
                    .replace(/=.*$/, '')
                    .replace(/^\.\.\./, '')
                    .replace(/\s+.*/, '')
                    .trim() || `param${idx + 1}`;
            });
    },

    generateValueForParam(param, kind) {
        const name = String(param || '').toLowerCase();
        if (/(^is|^has|^should|flag|enabled)/.test(name)) return kind === 'edge' ? false : true;
        if (/(count|num|size|total|len|length)/.test(name)) return kind === 'edge' ? 0 : 1;
        if (/(id$|_id|uuid)/.test(name)) return kind === 'edge' ? 0 : 1;
        if (/(name|title|label|text|str|query|search)/.test(name)) return kind === 'edge' ? '' : 'test';
        if (/(list|array|items|values)/.test(name)) return kind === 'edge' ? [] : [1, 2];
        if (/(obj|object|data|config|options|payload)/.test(name)) return kind === 'edge' ? {} : { sample: true };
        if (/(date|time)/.test(name)) return kind === 'edge' ? '' : '2024-01-01';
        if (/(cb|callback|fn|handler)/.test(name)) return kind === 'edge' ? null : '__fn__';
        if (/(map|dict)/.test(name)) return kind === 'edge' ? {} : { key: 'value' };
        return kind === 'edge' ? '__undefined__' : 'test';
    },

    async addScriptTagsToHtmlFiles() {
        if (!loadFolder || !Array.isArray(loadFolder.fileStructure)) return;
        const htmlFiles = loadFolder.fileStructure.filter(file =>
            file && file.kind === 'file' && /\.html?$/i.test(file.name || '')
        );

        for (const file of htmlFiles) {
            try {
                await this._injectUnitTestTagsIntoHtmlFile(file);
            } catch (err) {
                console.warn('Failed to inject unit test tags into', file.relativePath, err);
            }
        }
    },

    _computeRelativePath(relativePath, fileName) {
        const dir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
        if (!dir) return fileName;
        const depth = dir.split('/').filter(Boolean).length;
        return '../'.repeat(depth) + fileName;
    },

    async _injectUnitTestTagsIntoHtmlFile(file) {
        const { content, openInfo } = await this._getHtmlContentForFile(file);
        const planPath = this._computeRelativePath(file.relativePath, 'unitTest.plan.js');
        const runnerPath = this._computeRelativePath(file.relativePath, 'unitTest.js');

        const planTag = `<script src="${planPath}"></script>`;
        const runnerTag = `<script src="${runnerPath}"></script>`;

        let updated = content;
        const tagsToInsert = [];
        if (!new RegExp('unitTest\\.plan\\.js', 'i').test(updated)) tagsToInsert.push(planTag);
        if (!new RegExp('unitTest\\.js', 'i').test(updated)) tagsToInsert.push(runnerTag);

        if (!tagsToInsert.length) return;

        if (/<\/body>/i.test(updated)) {
            updated = updated.replace(/<\/body>/i, `${tagsToInsert.join('\n')}\n</body>`);
        } else {
            updated = `${updated}\n${tagsToInsert.join('\n')}\n`;
        }

        if (updated === content) return;

        if (openInfo && openInfo.view) {
            openInfo.view.dispatch({
                changes: { from: 0, to: openInfo.view.state.doc.length, insert: updated }
            });
            editor.markDirty(openInfo.uuid);
        } else {
            await this._writeFileContents(file.entry, updated);
        }
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

    _findOpenEditorByRelativePath(relativePath) {
        if (typeof editor === 'undefined' || !editor || !editor._meta) return null;
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

    async _writeProjectFile(relativePath, contents) {
        const fileHandle = await loadFolder.fileHandle.getFileHandle(relativePath, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(contents);
        await writable.close();
    },

    getRunnerCode() {
        const lines = [
            '// unitTest.js - generated by Forge Unit Tester',
            '(() => {',
            '  const state = {',
            '    lastResults: null,',
            '    panel: null,',
            '    list: null,',
            '    summary: null',
            '  };',
            '',
            '  function createPanel() {',
            '    if (state.panel) return state.panel;',
            '',
            '    const style = document.createElement("style");',
            '    style.textContent = [',
            '      "#forge-unit-test-panel {",',
            '      "  position: fixed;",',
            '      "  right: 16px;",',
            '      "  bottom: 16px;",',
            '      "  width: 420px;",',
            '      "  max-height: 70vh;",',
            '      "  background: #141a1f;",',
            '      "  color: #e9ecef;",',
            '      "  border: 1px solid #495057;",',
            '      "  border-radius: 8px;",',
            '      "  box-shadow: 0 10px 24px rgba(0,0,0,0.4);",',
            '      "  z-index: 999999;",',
            '      "  font-family: system-ui, -apple-system, Segoe UI, sans-serif;",',
            '      "  display: none;",',
            '      "}",',
            '      "#forge-unit-test-panel header {",',
            '      "  display: flex;",',
            '      "  align-items: center;",',
            '      "  justify-content: space-between;",',
            '      "  padding: 8px 10px;",',
            '      "  background: #1f252a;",',
            '      "  border-bottom: 1px solid #2f3a43;",',
            '      "}",',
            '      "#forge-unit-test-panel header h5 {",',
            '      "  margin: 0;",',
            '      "  font-size: 0.95rem;",',
            '      "}",',
            '      "#forge-unit-test-panel .content {",',
            '      "  padding: 10px;",',
            '      "  overflow: auto;",',
            '      "  max-height: 60vh;",',
            '      "  font-size: 0.85rem;",',
            '      "}",',
            '      "#forge-unit-test-panel .actions {",',
            '      "  display: flex;",',
            '      "  gap: 6px;",',
            '      "  flex-wrap: wrap;",',
            '      "  margin-bottom: 8px;",',
            '      "}",',
            '      "#forge-unit-test-panel button {",',
            '      "  background: #0d6efd;",',
            '      "  border: none;",',
            '      "  color: #fff;",',
            '      "  padding: 4px 8px;",',
            '      "  border-radius: 4px;",',
            '      "  font-size: 0.8rem;",',
            '      "  cursor: pointer;",',
            '      "}",',
            '      "#forge-unit-test-panel button.secondary {",',
            '      "  background: #6c757d;",',
            '      "}",',
            '      "#forge-unit-test-panel button.danger {",',
            '      "  background: #dc3545;",',
            '      "}",',
            '      "#forge-unit-test-panel ul {",',
            '      "  list-style: none;",',
            '      "  padding: 0;",',
            '      "  margin: 0;",',
            '      "}",',
            '      "#forge-unit-test-panel li {",',
            '      "  padding: 6px 4px;",',
            '      "  border-bottom: 1px solid #26313a;",',
            '      "}",',
            '      "#forge-unit-test-panel .pass {",',
            '      "  color: #7ee081;",',
            '      "}",',
            '      "#forge-unit-test-panel .fail {",',
            '      "  color: #ff6b6b;",',
            '      "}",',
            '      "#forge-unit-test-panel .warn {",',
            '      "  color: #ffd43b;",',
            '      "}",',
            '      "#forge-unit-test-panel .summary {",',
            '      "  margin-bottom: 6px;",',
            '      "}",',
            '      "#forge-unit-test-trigger {",',
            '      "  position: fixed;",',
            '      "  left: 16px;",',
            '      "  bottom: 16px;",',
            '      "  width: 48px;",',
            '      "  height: 48px;",',
            '      "  background: #0d6efd;",',
            '      "  color: white;",',
            '      "  border-radius: 50%;",',
            '      "  display: flex;",',
            '      "  align-items: center;",',
            '      "  justify-content: center;",',
            '      "  font-size: 24px;",',
            '      "  box-shadow: 0 4px 10px rgba(0,0,0,0.3);",',
            '      "  cursor: pointer;",',
            '      "  z-index: 999998;",',
            '      "  user-select: none;",',
            '      "  transition: transform 0.2s;",',
            '      "}",',
            '      "#forge-unit-test-trigger:hover {",',
            '      "  transform: scale(1.1);",',
            '      "}",',
            '    ].join("\\n");',
            '    document.head.appendChild(style);',
            '',
            '    if (!document.getElementById("forge-unit-test-trigger")) {',
            '      const trigger = document.createElement("div");',
            '      trigger.id = "forge-unit-test-trigger";',
            '      trigger.textContent = "🧪";',
            '      trigger.title = "Open Unit Tester";',
            '      trigger.addEventListener("click", togglePanel);',
            '      document.body.appendChild(trigger);',
            '    }',
            '',
            '    const panel = document.createElement("div");',
            '    panel.id = "forge-unit-test-panel";',
            '    panel.innerHTML = [',
            '      "<header>",',
            '      "  <h5>Unit Tests</h5>",',
            '      "  <div>",',
            '      "    <button id=\\\"forge-unit-test-close\\\" class=\\\"secondary\\\">Close</button>",',
            '      "  </div>",',
            '      "</header>",',
            '      "<div class=\\\"content\\\">",',
            '      "  <div class=\\\"actions\\\">",',
            '      "    <button id=\\\"forge-unit-test-run\\\">Run Tests</button>",',
            '      "    <button id=\\\"forge-unit-test-copy\\\" class=\\\"secondary\\\">Copy Results</button>",',
            '      "    <button id=\\\"forge-unit-test-baseline\\\" class=\\\"secondary\\\">Build Baseline</button>",',
            '      "    <button id=\\\"forge-unit-test-clear\\\" class=\\\"danger\\\">Clear</button>",',
            '      "  </div>",',
            '      "  <div class=\\\"summary\\\" id=\\\"forge-unit-test-summary\\\">No results yet.</div>",',
            '      "  <ul id=\\\"forge-unit-test-list\\\"></ul>",',
            '      "</div>",',
            '    ].join("");',
            '    document.body.appendChild(panel);',
            '',
            '    panel.querySelector("#forge-unit-test-close").addEventListener("click", () => panel.style.display = "none");',
            '    panel.querySelector("#forge-unit-test-run").addEventListener("click", () => runAll());',
            '    panel.querySelector("#forge-unit-test-clear").addEventListener("click", () => renderResults([]));',
            '    panel.querySelector("#forge-unit-test-copy").addEventListener("click", () => copyResults());',
            '    panel.querySelector("#forge-unit-test-baseline").addEventListener("click", () => copyBaseline());',
            '',
            '    state.panel = panel;',
            '    state.list = panel.querySelector("#forge-unit-test-list");',
            '    state.summary = panel.querySelector("#forge-unit-test-summary");',
            '    return panel;',
            '  }',
            '',
            '  function togglePanel() {',
            '    const panel = createPanel();',
            '    panel.style.display = panel.style.display === "none" ? "block" : "none";',
            '  }',
            '',
            '  function resolveTarget(path) {',
            '    if (!path) return { fn: null, owner: null };',
            '    let p = String(path).replace(/^window\\./, "");',
            '    const parts = p.split(".");',
            '    let root;',
            '    try {',
            '      if (typeof window[parts[0]] !== "undefined") {',
            '        root = window[parts[0]];',
            '      } else {',
            '        root = (new Function("return " + parts[0]))();',
            '      }',
            '    } catch (e) { root = undefined; }',
            '    if (parts.length === 1) return { fn: root, owner: window };',
            '    let owner = root;',
            '    for (let i = 1; i < parts.length - 1; i++) {',
            '      owner = owner ? owner[parts[i]] : undefined;',
            '    }',
            '    const fn = owner ? owner[parts[parts.length - 1]] : undefined;',
            '    return { fn, owner };',
            '  }',
            '',
            '  function isPromise(value) {',
            '    return value && typeof value.then === "function";',
            '  }',
            '',
            '  async function runCase(target, testCase) {',
            '    const expected = testCase.expected || { type: "notThrows" };',
            '    const args = (Array.isArray(testCase.args) ? testCase.args : []).map(arg => {',
            '      if (arg === "__fn__") return () => true;',
            '      if (arg === "__async_fn__") return async () => true;',
            '      if (arg === "__undefined__") return undefined;',
            '      return arg;',
            '    });',
            '    const { fn, owner } = resolveTarget(target.path);',
            '    if (typeof fn !== "function") {',
            '      return {',
            '        status: "fail",',
            '        message: "Function not found: " + target.path,',
            '        target,',
            '        testCase',
            '      };',
            '    }',
            '',
            '    try {',
            '      let result = fn.apply(owner || null, args);',
            '      if (isPromise(result)) result = await result;',
            '',
            '      if (expected.type === "throws") {',
            '        return { status: "fail", message: "Expected throw, but returned", actual: result, target, testCase };',
            '      }',
            '      if (expected.type === "auto") {',
            '        return { status: "warn", message: "Auto-capture", actual: result, target, testCase };',
            '      }',
            '      if (expected.type === "equals") {',
            '        const pass = result === expected.value;',
            '        return pass ? { status: "pass", target, testCase } : { status: "fail", message: "Not equal", actual: result, expected, target, testCase };',
            '      }',
            '      if (expected.type === "deepEquals") {',
            '        const pass = JSON.stringify(result) === JSON.stringify(expected.value);',
            '        return pass ? { status: "pass", target, testCase } : { status: "fail", message: "Not deep equal", actual: result, expected, target, testCase };',
            '      }',
            '      if (expected.type === "typeOf") {',
            '        const pass = typeof result === expected.value;',
            '        return pass ? { status: "pass", target, testCase } : { status: "fail", message: "Unexpected type", actual: typeof result, expected, target, testCase };',
            '      }',
            '      if (expected.type === "truthy") {',
            '        return result ? { status: "pass", target, testCase } : { status: "fail", message: "Expected truthy", actual: result, target, testCase };',
            '      }',
            '      if (expected.type === "falsy") {',
            '        return !result ? { status: "pass", target, testCase } : { status: "fail", message: "Expected falsy", actual: result, target, testCase };',
            '      }',
            '      if (expected.type === "approx") {',
            '        const epsilon = expected.epsilon || 0.00001;',
            '        const pass = typeof result === "number" && Math.abs(result - expected.value) <= epsilon;',
            '        return pass ? { status: "pass", target, testCase } : { status: "fail", message: "Not approx", actual: result, expected, target, testCase };',
            '      }',
            '      if (expected.type === "matches") {',
            '        const re = new RegExp(expected.value);',
            '        const pass = re.test(String(result));',
            '        return pass ? { status: "pass", target, testCase } : { status: "fail", message: "No regex match", actual: result, expected, target, testCase };',
            '      }',
            '',
            '      return { status: "pass", target, testCase };',
            '    } catch (err) {',
            '      if (expected.type === "throws") {',
            '        return { status: "pass", target, testCase };',
            '      }',
            '      return { status: "fail", message: err && err.message ? err.message : String(err), error: err, target, testCase };',
            '    }',
            '  }',
            '',
            '  async function runAll() {',
            '    const plan = window.__unitTestPlan;',
            '    if (!plan || !Array.isArray(plan.targets)) {',
            '      renderResults([{ status: "fail", message: "No unit test plan found (window.__unitTestPlan)" }]);',
            '      return;',
            '    }',
            '    const results = [];',
            '    for (const target of plan.targets) {',
            '      if (!target || !Array.isArray(target.cases)) continue;',
            '      for (const testCase of target.cases) {',
            '        const res = await runCase(target, testCase);',
            '        results.push(res);',
            '        if (plan.options && plan.options.failFast && res.status === "fail") break;',
            '      }',
            '    }',
            '    state.lastResults = { plan, results };',
            '    renderResults(results);',
            '  }',
            '',
            '  function renderResults(results) {',
            '    createPanel();',
            '    state.list.innerHTML = "";',
            '    const pass = results.filter(r => r.status === "pass").length;',
            '    const fail = results.filter(r => r.status === "fail").length;',
            '    const warn = results.filter(r => r.status === "warn").length;',
            '    state.summary.textContent = "Pass: " + pass + " | Fail: " + fail + " | Auto: " + warn;',
            '',
            '    if (!results.length) {',
            '      const li = document.createElement("li");',
            '      li.textContent = "No results yet.";',
            '      state.list.appendChild(li);',
            '      return;',
            '    }',
            '',
            '    results.forEach((res, idx) => {',
            '      const li = document.createElement("li");',
            '      li.className = res.status === "pass" ? "pass" : res.status === "warn" ? "warn" : "fail";',
            '      const label = res.target && res.target.path ? res.target.path : "unknown";',
            '      const name = res.testCase && res.testCase.name ? res.testCase.name : "case";',
            '      li.textContent = (idx + 1) + ". [" + res.status.toUpperCase() + "] " + label + " — " + name + (res.message ? ": " + res.message : "");',
            '      state.list.appendChild(li);',
            '    });',
            '  }',
            '',
            '  async function copyToClipboard(text, btnId) {',
            '    const btn = document.querySelector(btnId);',
            '    const origText = btn ? btn.textContent : "";',
            '    try {',
            '      await navigator.clipboard.writeText(text);',
            '      if (btn) btn.textContent = "Copied!";',
            '    } catch (err) {',
            '      console.error("Copy failed", err);',
            '      if (btn) btn.textContent = "Error!";',
            '      try {',
            '          const textarea = document.createElement("textarea");',
            '          textarea.value = text;',
            '          document.body.appendChild(textarea);',
            '          textarea.select();',
            '          document.execCommand("copy");',
            '          document.body.removeChild(textarea);',
            '          if (btn) btn.textContent = "Copied (Fallback)!";',
            '      } catch (fbErr) { console.error("Fallback failed", fbErr); }',
            '    }',
            '    if (btn) setTimeout(() => btn.textContent = origText, 2500);',
            '  }',
            '',
            '  function copyResults() {',
            '    if (!state.lastResults) return;',
            '    const payload = JSON.stringify(state.lastResults, null, 2);',
            '    copyToClipboard(payload, "#forge-unit-test-copy");',
            '  }',
            '',
            '  function copyBaseline() {',
            '    if (!state.lastResults) return;',
            '    const { plan, results } = state.lastResults;',
            '    const updated = JSON.parse(JSON.stringify(plan));',
            '    let idx = 0;',
            '    updated.targets.forEach(target => {',
            '      target.cases.forEach(testCase => {',
            '        const res = results[idx++];',
            '        if (testCase.expected && testCase.expected.type === "auto" && res && res.status !== "fail") {',
            '          testCase.expected = { type: "equals", value: res.actual };',
            '        }',
            '      });',
            '    });',
            '    const payload = "window.__unitTestPlan = " + JSON.stringify(updated, null, 2) + ";";',
            '    copyToClipboard(payload, "#forge-unit-test-baseline");',
            '  }',
            '',
            '  document.addEventListener("keydown", (e) => {',
            '    if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "t" || e.key === "T")) {',
            '      e.preventDefault();',
            '      togglePanel();',
            '    }',
            '  });',
            '',
            '  window.UnitTestRunner = { runAll, togglePanel };',
            '',
            '  window.addEventListener("DOMContentLoaded", () => {',
            '    createPanel();',
            '    const plan = window.__unitTestPlan;',
            '    if (plan && plan.options && plan.options.autoRun) {',
            '      runAll();',
            '      const panel = createPanel();',
            '      panel.style.display = "block";',
            '    }',
            '  });',
            '})();'
        ];
        return lines.join("\n");
    }
};
