/* ===== Forge Skills Tab ===== */
/* UI module for managing Athena skills */

const skillsTab = {
    _activeCategory: null,

    _setSafeContent(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(document.adoptNode(n)));
        el.replaceChildren(frag);
    },

    _esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    init() {
        const pane = document.getElementById('skills');
        if (!pane) return;
        this._setSafeContent(pane, this.renderBase());
        this.bind();
    },

    renderBase() {
        return `
            <div style="padding: 1rem;">
                <h3 class="text-light mb-1">Athena Skills</h3>
                <p class="text-muted small mb-3">
                    Skills give Athena specialized knowledge for NAVAIR workflows.
                    Upload <code>.md</code> skill files or use the built-in starters.
                    Use the Skills picker in Athena chat to activate a skill.
                </p>

                <div class="d-flex align-items-center mb-3" style="gap: 8px;">
                    <button class="btn btn-primary btn-sm" id="skills-upload-btn">Upload Skill (.md)</button>
                    <input type="file" id="skills-file-input" accept=".md" style="display:none" multiple>
                    <button class="btn btn-outline-secondary btn-sm" id="skills-reset-btn">Reset Built-ins</button>
                    <div style="flex:1"></div>
                    <span id="skills-count" class="text-muted small"></span>
                </div>

                <div id="skills-category-filter" class="mb-3"></div>
                <div id="skills-list"></div>
            </div>`;
    },

    bind() {
        const uploadBtn = document.getElementById('skills-upload-btn');
        const fileInput = document.getElementById('skills-file-input');
        if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput && fileInput.click());
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleUpload(e));

        const resetBtn = document.getElementById('skills-reset-btn');
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetBuiltIns());

        // Delegated events on skills list
        const list = document.getElementById('skills-list');
        if (list) {
            list.addEventListener('click', (e) => {
                const toggle = e.target.closest('[data-skill-toggle]');
                if (toggle) {
                    const id = toggle.getAttribute('data-skill-toggle');
                    const skill = skillsManager.getSkill(id);
                    if (skill) {
                        skillsManager.toggleSkill(id, !skill.enabled);
                        this.renderSkillsList();
                    }
                    return;
                }
                const del = e.target.closest('[data-skill-delete]');
                if (del) {
                    const id = del.getAttribute('data-skill-delete');
                    const skill = skillsManager.getSkill(id);
                    const label = skill ? skill.name : id;
                    if (confirm('Remove skill "' + label + '"?')) {
                        skillsManager.removeSkill(id);
                        this.renderSkillsList();
                        this.renderCategoryFilter();
                    }
                    return;
                }
                const exp = e.target.closest('[data-skill-export]');
                if (exp) {
                    const id = exp.getAttribute('data-skill-export');
                    const md = skillsManager.exportSkill(id);
                    if (md) {
                        const blob = new Blob([md], { type: 'text/markdown' });
                        if (typeof saveAs === 'function') saveAs(blob, id + '.md');
                        else {
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = id + '.md';
                            a.click();
                            URL.revokeObjectURL(a.href);
                        }
                    }
                    return;
                }
                // Expand/collapse body preview
                const card = e.target.closest('.skill-card');
                if (card && !e.target.closest('button')) {
                    const body = card.querySelector('.skill-body-preview');
                    if (body) body.classList.toggle('expanded');
                }
            });
        }

        this.renderCategoryFilter();
        this.renderSkillsList();
    },

    renderCategoryFilter() {
        const container = document.getElementById('skills-category-filter');
        if (!container) return;
        const categories = skillsManager.getCategories();
        const allItems = [{ key: null, label: 'All' }, ...categories.map(c => ({ key: c, label: c }))];

        const html = allItems.map(item => {
            const active = item.key === this._activeCategory;
            const cls = active ? 'btn-info' : 'btn-outline-secondary';
            return '<button class="btn btn-sm ' + cls + ' me-1 mb-1" data-cat="' + (item.key || '') + '">'
                + this._esc(item.label.charAt(0).toUpperCase() + item.label.slice(1)) + '</button>';
        }).join('');

        this._setSafeContent(container, html);
        container.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                this._activeCategory = btn.getAttribute('data-cat') || null;
                this.renderCategoryFilter();
                this.renderSkillsList();
            });
        });
    },

    renderSkillsList() {
        const container = document.getElementById('skills-list');
        if (!container) return;
        let skills = skillsManager.getAllSkills();
        if (this._activeCategory) {
            skills = skills.filter(s => s.category === this._activeCategory);
        }

        const countEl = document.getElementById('skills-count');
        if (countEl) {
            const total = skillsManager.getAllSkills().length;
            const enabled = skillsManager.getEnabledSkills().length;
            countEl.textContent = enabled + '/' + total + ' enabled';
        }

        if (skills.length === 0) {
            this._setSafeContent(container,
                '<div class="text-center text-muted py-4">No skills found. Upload a .md file or click Reset Built-ins.</div>');
            return;
        }

        const html = skills.map(s => this._renderSkillCard(s)).join('');
        this._setSafeContent(container, html);
    },

    _renderSkillCard(skill) {
        const n = this._esc(skill.name);
        const d = this._esc(skill.description);
        const c = this._esc(skill.category);
        const hint = skill.argumentHint ? ' <code>' + this._esc(skill.argumentHint) + '</code>' : '';
        const builtIn = skill.builtIn ? '<span class="badge bg-info ms-2">Built-in</span>' : '';
        const enabledCls = skill.enabled ? 'btn-success' : 'btn-outline-secondary';
        const enabledLbl = skill.enabled ? 'On' : 'Off';
        const bodyPreview = this._esc(skill.body.slice(0, 300)) + (skill.body.length > 300 ? '...' : '');

        return '<div class="skill-card card mb-2" style="background:#1e252b; border-color:#2a3240; cursor:pointer;">'
            + '<div class="card-body p-2">'
            + '<div class="d-flex align-items-center justify-content-between">'
            + '<div>'
            + '<strong class="text-light">/' + n + '</strong>' + hint
            + ' <span class="badge bg-secondary ms-1">' + c + '</span>' + builtIn
            + '</div>'
            + '<div class="d-flex" style="gap:4px;">'
            + '<button class="btn btn-sm ' + enabledCls + '" data-skill-toggle="' + n + '" title="Toggle">' + enabledLbl + '</button>'
            + '<button class="btn btn-sm btn-outline-light" data-skill-export="' + n + '" title="Export .md">&#8615;</button>'
            + (skill.builtIn ? '' : '<button class="btn btn-sm btn-outline-danger" data-skill-delete="' + n + '" title="Delete">&times;</button>')
            + '</div>'
            + '</div>'
            + '<div class="small text-muted mt-1">' + d + '</div>'
            + '<div class="skill-body-preview small mt-1" style="color:#6c757d; max-height:0; overflow:hidden; transition:max-height .25s ease;">'
            + '<pre style="white-space:pre-wrap; font-size:0.72rem; margin:4px 0 0 0; color:#8b949e;">' + bodyPreview + '</pre>'
            + '</div>'
            + '</div></div>';
    },

    async handleUpload(event) {
        const files = event.target.files;
        if (!files || !files.length) return;
        let added = 0;
        const errors = [];
        for (const file of files) {
            const result = await skillsManager.importFromFile(file);
            if (result.success) added++;
            else errors.push(file.name + ': ' + result.error);
        }
        event.target.value = '';
        this.renderCategoryFilter();
        this.renderSkillsList();
        if (errors.length) alert('Import errors:\n' + errors.join('\n'));
        if (added && typeof addAIChatMessage === 'function') {
            addAIChatMessage('system', added + ' skill(s) imported. Pick one from the Skills button in chat.');
        }
    },

    resetBuiltIns() {
        if (typeof skillsManager !== 'undefined') {
            skillsManager._ensureBuiltInSkills(true);
            this.renderCategoryFilter();
            this.renderSkillsList();
        }
    }
};
