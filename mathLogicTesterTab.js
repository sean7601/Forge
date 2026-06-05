const mathLogicTesterTab = {
    _setSafeContent(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
        el.replaceChildren(frag);
    },

    init() {
        const pane = document.getElementById('math-logic-tester');
        if (!pane) return;
        this._setSafeContent(pane, this.renderBase());
        this.bind();

        $('#math-logic-tester-tab').on('shown.bs.tab', () => {
            this.refreshFileList();
        });
    },

    renderBase() {
        return `
            <h3>Math & Logic Tester</h3>
            <p>Generate a structured prompt to audit mathematical logic in your code. Select files, then copy the prompt into your AI tool.</p>
            <div class="row">
                <div class="col-md-5">
                    <h5>1. Select Files</h5>
                    <div class="d-flex mb-2" style="gap: 6px;">
                        <button id="mlt-select-all" class="btn btn-sm btn-outline-secondary">Select All</button>
                        <button id="mlt-select-none" class="btn btn-sm btn-outline-secondary">Deselect All</button>
                        <button id="mlt-refresh" class="btn btn-sm btn-outline-secondary">Refresh</button>
                    </div>
                    <div id="mlt-file-list" class="border rounded p-2 mb-3" style="max-height: 320px; overflow-y: auto; background: #212529;">
                        <div class="text-muted small p-2">Load a folder to see files...</div>
                    </div>
                    <button id="mlt-generate" class="btn btn-primary btn-block mb-3">Generate Prompt</button>
                </div>
                <div class="col-md-7">
                    <h5>2. Prompt Output</h5>
                    <div class="position-relative">
                        <textarea id="mlt-prompt" class="form-control" rows="16" readonly style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-size: 0.85em;"></textarea>
                        <button id="mlt-copy" class="btn btn-sm btn-light position-absolute" style="top: 10px; right: 10px;">📋 Copy</button>
                    </div>
                </div>
            </div>
        `;
    },

    bind() {
        $('#mlt-select-all').on('click', () => $('.mlt-file-select').prop('checked', true));
        $('#mlt-select-none').on('click', () => $('.mlt-file-select').prop('checked', false));
        $('#mlt-refresh').on('click', () => this.refreshFileList());
        $('#mlt-generate').on('click', () => this.generatePrompt());
        $('#mlt-copy').on('click', () => this.copyPrompt());
    },

    refreshFileList() {
        const list = $('#mlt-file-list');
        if (!loadFolder.fileStructure || loadFolder.fileStructure.length === 0) {
            list.html('<div class="text-muted small p-2">Load a folder to see files...</div>');
            return;
        }

        const relevant = loadFolder.fileStructure.filter(f =>
            f.kind === 'file' && /\.(js|json|html|css|ts|txt|md)$/i.test(f.name)
        );

        if (!relevant.length) {
            list.html('<div class="text-muted small p-2">No text files found.</div>');
            return;
        }

        let html = '';
        relevant
            .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
            .forEach(f => {
                const id = 'mlt-' + btoa(f.relativePath).replace(/=/g, '');
                html += `
                    <div class="form-check">
                        <input class="form-check-input mlt-file-select" type="checkbox" value="${f.relativePath}" id="${id}">
                        <label class="form-check-label small text-break" for="${id}">
                            ${f.relativePath}
                        </label>
                    </div>
                `;
            });

        list.html(html);
    },

    async generatePrompt() {
        const selected = $('.mlt-file-select:checked').map((_, el) => el.value).get();
        if (!selected.length) {
            alert('Please select at least one file.');
            return;
        }

        let codeContext = '';
        for (const relPath of selected) {
            const file = loadFolder.fileStructure.find(f => f.relativePath === relPath);
            if (!file) continue;
            try {
                const content = await loadFolder.getFileContent(file);
                codeContext += `\n\n--- File: ${file.relativePath} ---\n${content}`;
            } catch (e) {
                codeContext += `\n\n--- File: ${file.relativePath} ---\n// Error reading file: ${e.message}`;
            }
        }

        const prompt = `You are an expert Mathematical Auditor and Software Test Engineer. I am going to provide you with source code. Your task is to extract, analyze, and verify the mathematical logic within that code.
Please analyze the code and generate a report using the following structure:
1. Plain Language Math Explanation
The Goal: Explain what the code is calculating in simple, non-technical English (imagine you are explaining it to a Product Manager, not a Developer).
The Formulas: Extract the specific formulas being used. Translate code variables (e.g., x_val) into mathematical concepts (e.g., "Total Revenue").
The Workflow: Describe the step-by-step mathematical transformation of the data.
2. Validity & Assumptions Assessment
Validity: Does the math seem correct for the stated or implied purpose? (e.g., Are the units consistent? Is the formula standard for this domain?)
Edge Cases: Identify potential mathematical pitfalls in the code (e.g., division by zero, floating-point precision errors, negative inputs where only positive are allowed).
Assumptions: List the implicit assumptions the code makes. (e.g., "The code assumes a 365-day year," or "It assumes linear growth," or "It ignores friction.")
3. Manual "Napkin Math" Test Cases
Provide 3 specific test cases I can run manually to verify the code works.
Format: Input -> Expected Output.
Complexity:
Case 1: Simple numbers (easy to verify mentally).
Case 2: Realistic numbers (representative of actual usage).
Case 3: Edge case (0, negative numbers, or maximum values).
Show Your Work: Briefly show the math on how you arrived at the "Expected Output" so I can verify your logic as well.
4. JSON Test Payload (If Applicable)
If the code implies it accepts structured input (like a REST API, a config file, or data object), generate a raw JSON block containing a dataset that covers the test cases above. I should be able to load this directly into the app/function to test it.
[PASTE YOUR SOURCE CODE BELOW THIS LINE]
${codeContext}`;

        document.getElementById('mlt-prompt').value = prompt;
    },

    copyPrompt() {
        const text = document.getElementById('mlt-prompt').value;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            const btn = $('#mlt-copy');
            const orig = btn.text();
            btn.text('Copied!');
            setTimeout(() => btn.text(orig), 1500);
        });
    }
};
