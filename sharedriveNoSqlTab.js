const sharedriveNosqlTab = {
    _eventsBound: false,
    _setSafeContent(el, html) {
        // With Trusted Types enabled and innerHTML patched by the compiler,
        // this is now the correct and safe way to insert HTML.
        // The monkey-patch will intercept this assignment, sanitize the 'html' string
        // using the 'wfc-policy', and assign the resulting TrustedHTML object.
        el.innerHTML = html;
    },
    legacyInitDisabled() {
        this.legacyAddTabContentDisabled();
        // Bind events for the new buttons
        $('#refresh-nosql-status-btn').on('click', () => this.checkStatus());
        $('#add-nosql-btn').on('click', () => this.integrate());
        $('#update-nosql-btn').on('click', () => this.integrate(true)); // Pass true for update mode

        // Check status when the tab is shown (Bootstrap 5 uses data-bs-toggle)
        $('#sharedrive-nosql-tab').on('shown.bs.tab', () => {
            this.checkStatus();
        });

        // Check status immediately if the tab is already active
        if ($('#sharedrive-nosql').hasClass('active') || $('#sharedrive-nosql').hasClass('show')) {
            this.checkStatus();
        }
    },

    legacyAddTabContentDisabled() {
        const tabPane = document.getElementById('sharedrive-nosql');
        if (!tabPane) return;
        this._setSafeContent(tabPane, `
            <!-- Integration Section -->
            <div class="integration-section mb-4">
                <div id="nosql-status" class="d-flex align-items-center p-3 rounded" style="background-color: #343a40; border: 1px solid #495057;">
                    <span class="status-badge mr-3" id="nosql-status-badge">Checking...</span>
                    <span id="nosql-status-message" class="flex-grow-1">Checking if sharedrive-nosql.js is integrated...</span>
                    <button id="refresh-nosql-status-btn" class="btn btn-sm btn-outline-secondary ml-2">🔄 Refresh</button>
                </div>
                <div class="actions-section mt-3">
                    <button id="add-nosql-btn" class="btn btn-success" disabled>
                        Add Library to Project
                    </button>
                    <button id="update-nosql-btn" class="btn btn-warning" style="display:none;">
                        Update Library
                    </button>
                </div>
            </div>

            <hr class="my-4">

            <!-- Collaboration Integration Prompt Generator -->
            <div class="integration-prompt-section">
              <h4>Prompt Builder</h4>
              <div class="mb-2" id="collab-file-controls" style="display:flex; gap:6px; flex-wrap:wrap;">
                <button id="collab-select-all" class="btn btn-sm btn-outline-secondary">Select All</button>
                <button id="collab-select-none" class="btn btn-sm btn-outline-secondary">Select None</button>
                <button id="collab-refresh" class="btn btn-sm btn-outline-secondary">Refresh List</button>
                <div class="form-check" style="margin-left:8px;">
                  <input class="form-check-input" type="checkbox" id="collab-trim" checked>
                  <label for="collab-trim" class="form-check-label" style="font-size:0.8rem;">Trim long/minified lines</label>
                </div>
              </div>
              <div id="collab-file-list" style="max-height:160px; overflow:auto; border:1px solid #444; border-radius:4px; padding:6px; background:#1e252b; font-size:0.72rem; line-height:1.2; margin-bottom:8px;"></div>
              <button id="collab-generate" class="btn btn-primary btn-sm">Generate Integration Prompt</button>
              <button id="collab-copy" class="btn btn-info btn-sm ml-1" disabled>Copy Prompt</button>
              <small id="collab-status" class="ml-2 text-muted"></small>
              <textarea id="collab-output" class="form-control mt-2" rows="14" placeholder="Integration prompt will appear here..." readonly style="font-family:monospace; font-size:0.7rem;"></textarea>
            </div>
        `);

          // After injecting HTML, bind new prompt-related events
          this.populateCollabFileList();
          $('#collab-refresh').on('click', () => this.populateCollabFileList({ sync: true }));
          $('#collab-select-all').on('click', () => this._toggleCollabAll(true));
          $('#collab-select-none').on('click', () => this._toggleCollabAll(false));
          $('#collab-generate').on('click', () => this.generateCollabPrompt());
          $('#collab-copy').on('click', () => this.copyCollabPrompt());
    },

    init() {
        this.renderWizard();
        this.bindEvents();
        $('#sharedrive-nosql-modal').on('shown.bs.modal', () => {
            this.checkStatus();
            this.populateCollabFileList({ sync: true });
        });
    },

    bindEvents() {
        if (this._eventsBound) return;
        this._eventsBound = true;
        $(document).on('click', '#refresh-nosql-status-btn', () => this.checkStatus());
        $(document).on('click', '#add-nosql-btn', () => this.integrate());
        $(document).on('click', '#update-nosql-btn', () => this.integrate(true));
        $(document).on('click', '#collab-refresh', () => this.populateCollabFileList({ sync: true }));
        $(document).on('click', '#collab-select-all', () => this._toggleCollabAll(true));
        $(document).on('click', '#collab-select-none', () => this._toggleCollabAll(false));
        $(document).on('click', '#collab-generate', () => this.generateCollabPrompt());
        $(document).on('click', '#collab-copy', () => this.copyCollabPrompt());
    },

    renderWizard() {
        const container = document.getElementById('sharedrive-nosql-modal-body');
        if (!container) return;
        this._setSafeContent(container, `
            <div class="integration-section mb-4">
                <div id="nosql-status" class="d-flex align-items-center p-3 rounded" style="background-color: #343a40; border: 1px solid #495057;">
                    <span class="status-badge mr-3" id="nosql-status-badge">Checking...</span>
                    <span id="nosql-status-message" class="flex-grow-1">Checking if sharedrive-nosql.js is integrated...</span>
                    <button id="refresh-nosql-status-btn" class="btn btn-sm btn-outline-secondary ml-2">Refresh</button>
                </div>
                <div class="actions-section mt-3">
                    <button id="add-nosql-btn" class="btn btn-success" disabled>Add Library to Project</button>
                    <button id="update-nosql-btn" class="btn btn-warning" style="display:none;">Update Library</button>
                </div>
            </div>

            <hr class="my-4">

            <div class="integration-prompt-section">
              <h4>Prompt Builder</h4>
              <div class="mb-2" id="collab-file-controls" style="display:flex; gap:6px; flex-wrap:wrap;">
                <button id="collab-select-all" class="btn btn-sm btn-outline-secondary">Select All</button>
                <button id="collab-select-none" class="btn btn-sm btn-outline-secondary">Select None</button>
                <button id="collab-refresh" class="btn btn-sm btn-outline-secondary">Refresh List</button>
                <div class="form-check" style="margin-left:8px;">
                  <input class="form-check-input" type="checkbox" id="collab-trim" checked>
                  <label for="collab-trim" class="form-check-label" style="font-size:0.8rem;">Trim long/minified lines</label>
                </div>
              </div>
              <div id="collab-file-list" style="max-height:160px; overflow:auto; border:1px solid #444; border-radius:4px; padding:6px; background:#1e252b; font-size:0.72rem; line-height:1.2; margin-bottom:8px;"></div>
              <button id="collab-generate" class="btn btn-primary btn-sm">Generate Integration Prompt</button>
              <button id="collab-copy" class="btn btn-info btn-sm ml-1" disabled>Copy Prompt</button>
              <small id="collab-status" class="ml-2 text-muted"></small>
              <textarea id="collab-output" class="form-control mt-2" rows="14" placeholder="Integration prompt will appear here..." readonly style="font-family:monospace; font-size:0.7rem;"></textarea>
            </div>
        `);
        this.populateCollabFileList();
    },

    async checkStatus() {
        const statusBadge = $('#nosql-status-badge');
        const statusMessage = $('#nosql-status-message');
        const addBtn = $('#add-nosql-btn');
        const updateBtn = $('#update-nosql-btn');

        addBtn.prop('disabled', true).show();
        updateBtn.hide();
        statusBadge.text('Checking...').attr('class', 'status-badge checking');
        statusMessage.text('Checking if sharedrive-nosql.js is integrated...');

        if (!loadFolder || !loadFolder.fileHandle) {
            statusBadge.text('No Project').attr('class', 'status-badge not-found');
            statusMessage.text('Load a directory first to check for integration.');
            return;
        }

        const nosqlFile = loadFolder.fileStructure.find(f => f.name === 'sharedrive-nosql.js');

        if (nosqlFile) {
            statusBadge.text('Found').attr('class', 'status-badge found');
            statusMessage.text('sharedrive-nosql.js is integrated in your project.');
            addBtn.hide();
            updateBtn.show();
        } else {
            statusBadge.text('Not Found').attr('class', 'status-badge not-found');
            statusMessage.text('sharedrive-nosql.js is not integrated. You can add it.');
            addBtn.prop('disabled', false);
        }
    },

    async integrate(isUpdate = false) {
        if (!loadFolder.fileHandle) {
            alert('Please load a directory first.');
            return;
        }

        if (isUpdate && !confirm('This will overwrite your existing sharedrive-nosql.js file. Continue?')) {
            return;
        }

        try {
            const nosqlCode = this.getCode();
            const fileHandle = await loadFolder.fileHandle.getFileHandle('sharedrive-nosql.js', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(nosqlCode);
            await writable.close();

            let message = '`sharedrive-nosql.js` has been added to your project!';
            if (!isUpdate) {
                const tagAdded = await this.addScriptTagToIndex();
                if (tagAdded) {
                    message += '\\n\\nA script tag was also added to your index.html <head>.';
                } else {
                    message += '\\n\\nPlease manually add `<script src="sharedrive-nosql.js"></script>` to your HTML file.';
                }
            } else {
                message = '`sharedrive-nosql.js` has been updated to the latest version.';
            }

            // Important: Rescan the directory to update the fileStructure array
            loadFolder.fileStructure = await loadFolder.recursivelyReadDirectory([], loadFolder.fileHandle);
            loadFolder.refreshFileTree();
            await this.checkStatus();
            await this.populateCollabFileList();

            alert(message);
        } catch (err) {
            console.error('Failed to integrate sharedrive-nosql.js:', err);
            alert('Error: ' + err.message);
        }
    },

    async addScriptTagToIndex() {
        try {
            // Find index.html, preferably at the root
            const indexFile = loadFolder.fileStructure
                .filter(f => f.name.toLowerCase() === 'index.html')
                .sort((a, b) => a.relativePath.length - b.relativePath.length)[0];

            if (!indexFile) return false;

            let content = await loadFolder.getFileContent(indexFile);
            if (content.includes('src="sharedrive-nosql.js"')) {
                return true; // Already there
            }

            const scriptTag = '  <script src="sharedrive-nosql.js"></script>\\n';
            const headTagMatch = content.match(/<head[^>]*>/i);

            if (headTagMatch) {
                content = content.replace(headTagMatch[0], headTagMatch[0] + '\\n' + scriptTag);
            } else {
                 // As a fallback, create a head tag if one doesn't exist
                 const bodyMatch = content.match(/<body[^>]*>/i);
                if (bodyMatch) {
                    content = content.replace(bodyMatch[0], `<head>\\n${scriptTag}</head>\\n\\n` + bodyMatch[0]);
                } else {
                    return false; // Can't find where to insert
                }
            }

            // Ensure unshipped banner is preserved
            if (typeof editor !== 'undefined' && editor.ensureUnshippedBanner) {
                content = editor.ensureUnshippedBanner(content);
            }
            // Get a writable stream and write the new content
            const writable = await indexFile.entry.createWritable();
            await writable.write(content);
            await writable.close();
            return true;

        } catch (err) {
            console.error('Failed to add script tag to index.html:', err);
            return false;
        }
    },

    getCode() {
        return `/*!
 * fs-nosql-db.js
 * Lightweight, serverless "NoSQL" JSON store for static HTML apps (file://).
 * Uses the File System Access API to read/write a shared JSON file and
 * supports multi-user concurrent edits with LWW (last-write-wins) merging.
 *
 * Global: window.FsNoSqlDB
 */
(function () { 'use strict';

  function _uuid() {
    try { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : \`id-\${Math.random().toString(36).slice(2)}-\${Date.now()}\`; }
    catch { return \`id-\${Math.random().toString(36).slice(2)}-\${Date.now()}\`; }
  }

  const CLIENT_KEY = 'fs-nosql-db:clientId';
  function _getOrCreateClientId() {
    try {
      let id = localStorage.getItem(CLIENT_KEY);
      if (!id) {
        id = _uuid();
        localStorage.setItem(CLIENT_KEY, id);
      }
      return id;
    } catch {
      // If localStorage is blocked, just generate an ephemeral id.
      return _uuid();
    }
  }

  class FsNoSqlDB {
    constructor(opts) {
      const {
        pollMs = 1000,
        debounceMs = 400,
        autoStartPolling = true,
        // Robustness tuning
        maxWriteRetries = 5,
        retryBaseMs = 120,
        retryJitterMs = 180,
        writeJitterMs = 120,
        adaptivePolling = true,
        minPollMs = 800,
        maxPollMs = 8000,
        pollBackoffFactor = 1.6,
        pollRecoveryFactor = 0.8,
      } = (opts || {});

      // FS state
      this.handle = null;
      this.fileName = '';

      // Identity & logical clock
      this.clientId = _getOrCreateClientId();
      this.localLamport = 0;

      // In-memory DB doc (normalized)
      this.doc = null;
      this.baseVersion = 0;
      this.baseJsonHash = '';
      this.lastSeenMtime = 0;
      this.lastWriteMtime = 0;
      this.isDirty = false;

      // Timers/flags
      this.pollMs = pollMs;
      this.debounceMs = debounceMs;
      this.saveTimer = null;
      this._pollTimer = null;
      this._writing = false;
      this._loading = false;
      this._pollAdaptive = !!adaptivePolling;
      this._pollMin = minPollMs;
      this._pollMax = maxPollMs;
      this._pollBackoff = pollBackoffFactor;
      this._pollRecovery = pollRecoveryFactor;
      this._desiredPollMs = pollMs;
      this.maxWriteRetries = maxWriteRetries;
      this.retryBaseMs = retryBaseMs;
      this.retryJitterMs = retryJitterMs;
      this.writeJitterMs = writeJitterMs;
      this.conflictCount = 0;

      // Hooks (override in your app)
      this.onStatus = function (s) {};        // string
      this.onRemoteMerge = function (keys) {}; // changed record ids (coarse)
      this.onLocalChange = function (keys) {}; // changed keys from local ops
      this.onOpen = function (fileName) {};    // called after open()

      if (autoStartPolling) this.startPolling();
    }

    // ---------------- Public API ----------------

    async open() {
      if (!('showOpenFilePicker' in window)) {
        throw new Error('File System Access API not supported. Use a recent Chrome/Edge/Safari.');
      }
      const [fh] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        excludeAcceptAllOption: false
      });
      if (!(await this._verifyRW(fh))) {
        throw new Error('Read/Write permission not granted.');
      }
      this.handle = fh;
      this.fileName = fh.name || '(database.json)';
      await this.reload(true);
      this.onOpen(this.fileName);
    }

    async create(suggestedName) {
      if (!('showSaveFilePicker' in window)) {
        throw new Error('File System Access API create flow not supported. Use a recent Chrome/Edge/Safari.');
      }
      const fh = await window.showSaveFilePicker({
        suggestedName: suggestedName || 'shared-database.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        excludeAcceptAllOption: false
      });
      if (!(await this._verifyRW(fh))) {
        throw new Error('Read/Write permission not granted.');
      }

      this.handle = fh;
      this.fileName = fh.name || '(database.json)';
      this.doc = this._normalizeDoc({});
      this.doc.version = 1;
      this.doc.lamport = Math.max(this.localLamport, 1);
      this.localLamport = this.doc.lamport;
      this.baseVersion = 0;
      this.baseJsonHash = '';
      this.isDirty = true;

      await this._writeDoc(this.doc);
      const f = await this.handle.getFile();
      this.baseVersion = this.doc.version;
      this.baseJsonHash = this._jsonHash(this.doc);
      this.lastSeenMtime = f.lastModified;
      this.lastWriteMtime = f.lastModified;
      this.isDirty = false;
      this.onStatus('created');
      this.onOpen(this.fileName);
      return this.snapshot();
    }

    async reload(first) {
      if (!this.handle) throw new Error('No file handle. Call open() first.');
      this._loading = true;
      try {
        const f = await this.handle.getFile();
        const text = await f.text();
        const parsed = this._safeParse(text);
        const normalized = this._normalizeDoc(parsed);

        this.localLamport = Math.max(this.localLamport, normalized.lamport || 0);
        this.doc = normalized;
        this.baseVersion = normalized.version || 0;
        this.baseJsonHash = this._jsonHash(normalized);
        this.lastSeenMtime = f.lastModified;
        this.isDirty = false;

        if (first) this.onStatus('loaded');
        return this.snapshot();
      } finally {
        this._loading = false;
      }
    }

    snapshot() {
      if (!this.doc) return { records: [] };
      const out = [];
      for (const [id, rec] of Object.entries(this.doc.records)) {
        if (this._isRecordDeleted(rec)) continue;
        out.push({ id, data: this._flattenRecord(rec), _meta: rec._meta });
      }
      return { records: out, version: this.doc.version, lamport: this.doc.lamport, dbId: this.doc.dbId };
    }

    get(id) {
      const rec = this.doc && this.doc.records ? this.doc.records[id] : null;
      if (!rec || this._isRecordDeleted(rec)) return null;
      return this._flattenRecord(rec);
    }

    async put(id, obj) {
      this._ensureOpen();
      const changes = this._applyFields(id, obj, false);
      if (changes.length) {
        this.onLocalChange(changes);
        this._debouncedSave();
      }
      return this.get(id);
    }

    async patch(id, partial) {
      this._ensureOpen();
      const changes = this._applyFields(id, partial, true);
      if (changes.length) {
        this.onLocalChange(changes);
        this._debouncedSave();
      }
      return this.get(id);
    }

    async delete(id) {
      this._ensureOpen();
      const rec = this._ensureRecord(id);
      const ts = this._nextTs();
      rec._meta.deleted = { ts, actor: this.clientId };
      this.isDirty = true;
      this.onLocalChange([\`record:\${id}:deleted\`]);
      this._debouncedSave();
    }

    async deleteField(id, key) {
      this._ensureOpen();
      const rec = this._ensureRecord(id);
      if (!rec._meta.fieldsDeleted) rec._meta.fieldsDeleted = {};
      rec._meta.fieldsDeleted[key] = { ts: this._nextTs(), actor: this.clientId };
      this.isDirty = true;
      this.onLocalChange([\`record:\${id}:field:\${key}:deleted\`]);
      this._debouncedSave();
    }

    query(fn) {
      const snap = this.snapshot();
      return snap.records.filter(r => {
        try { return !!fn(r.data, r._meta); } catch { return false; }
      });
    }

    async saveNow() {
      await this._saveMergeIfNeeded();
    }

    startPolling() {
      if (this._pollTimer) clearInterval(this._pollTimer);
      this._schedulePoll(this._desiredPollMs);
    }

    stopPolling() {
      if (this._pollTimer) clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    // ---------------- Internals ----------------

    _ensureOpen() {
      if (!this.handle || !this.doc) throw new Error('DB not opened yet. Call open() first.');
    }

    _safeParse(text) {
      try { return JSON.parse(text || ''); } catch { return {}; }
    }

    _normalizeDoc(parsed) {
      if (!parsed || parsed.type !== 'fs-nosql' || typeof parsed.records !== 'object') {
        return {
          type: 'fs-nosql',
          schema: 1,
          dbId: _uuid(),
          version: 1,
          lamport: 1,
          actors: [this.clientId],
          records: {}
        };
      }
      parsed.schema = (parsed.schema == null ? 1 : parsed.schema);
      parsed.dbId = parsed.dbId || _uuid();
      parsed.version = parsed.version || 1;
      parsed.lamport = parsed.lamport || 1;
      parsed.actors = Array.isArray(parsed.actors) ? parsed.actors : [];
      if (!parsed.actors.includes(this.clientId)) parsed.actors.push(this.clientId);

      for (const [id, rec] of Object.entries(parsed.records)) {
        const meta = rec._meta || {};
        meta.id = meta.id || id;
        meta.createdAt = meta.createdAt || new Date().toISOString();
        if (!('deleted' in meta)) meta.deleted = null;
        if (!('fieldsDeleted' in meta)) meta.fieldsDeleted = {};
        rec._meta = meta;
        rec.fields = rec.fields || {};
      }
      return parsed;
    }

    _ensureRecord(id) {
      const db = this.doc;
      if (!db.records[id]) {
        db.records[id] = {
          _meta: { id, createdAt: new Date().toISOString(), deleted: null, fieldsDeleted: {} },
          fields: {}
        };
      }
      return db.records[id];
    }

    _flattenRecord(rec) {
      const out = {};
      const delMap = rec._meta && rec._meta.fieldsDeleted ? rec._meta.fieldsDeleted : {};
      const fields = rec.fields || {};
      for (const [k, cell] of Object.entries(fields)) {
        if (!cell) continue;
        const delT = (delMap[k] && delMap[k].ts) || -1;
        const valT = (cell.ts == null ? -1 : cell.ts);
        if (delT > valT) continue; // tombstoned
        out[k] = cell.v;
      }
      return out;
    }

    _isRecordDeleted(rec) {
      if (!rec._meta || !rec._meta.deleted) return false;
      const delTs = rec._meta.deleted.ts == null ? -1 : rec._meta.deleted.ts;
      return delTs >= this._maxFieldTs(rec);
    }

    _maxFieldTs(rec) {
      let maxTs = -1;
      const fields = rec.fields || {};
      for (const cell of Object.values(fields)) {
        if (cell && typeof cell.ts === 'number' && cell.ts > maxTs) maxTs = cell.ts;
      }
      const fdel = (rec._meta && rec._meta.fieldsDeleted) ? rec._meta.fieldsDeleted : {};
      for (const del of Object.values(fdel)) {
        if (del && typeof del.ts === 'number' && del.ts > maxTs) maxTs = del.ts;
      }
      return maxTs;
    }

    _applyFields(id, obj, isPatch) {
      const rec = this._ensureRecord(id);
      const changes = [];
      const delMap = rec._meta.fieldsDeleted || (rec._meta.fieldsDeleted = {});

      for (const [k, v] of Object.entries(obj || {})) {
        const ts = this._nextTs();
        const cell = rec.fields[k];
        if (!cell || this._clockGreater(ts, this.clientId, cell.ts, cell.actor)) {
          rec.fields[k] = { v, ts, actor: this.clientId };
          if (delMap[k] && delMap[k].ts < ts) delete delMap[k];
          changes.push(\`record:\${id}:field:\${k}:upsert\`);
        }
      }

      if (rec._meta.deleted) {
        const delTs = rec._meta.deleted.ts == null ? -1 : rec._meta.deleted.ts;
        const maxTs = this._maxFieldTs(rec);
        if (maxTs > delTs) rec._meta.deleted = null; // newer field write "undeletes"
      }

      if (changes.length) this.isDirty = true;
      return changes;
    }

    async _saveMergeIfNeeded() {
      if (!this.handle || this._writing) return;

      let attempt = 0;
      this._writing = true;
      try {
        while (attempt <= this.maxWriteRetries) {
          const head = await this._readHead();
          const headHash = this._jsonHash(head.doc);

          if (!this.isDirty && headHash === this.baseJsonHash) {
            this.onStatus('up-to-date');
            return;
          }

          let merged = this._mergeDocs(head.doc, this.doc);
          const mergedHash = this._jsonHash(merged);

          if (mergedHash === headHash) {
            // Nothing to write; adopt head
            this.doc = head.doc;
            this.baseVersion = head.doc.version;
            this.baseJsonHash = headHash;
            this.lastSeenMtime = head.mtime;
            this.isDirty = false;
            this.onStatus('up-to-date');
            return;
          }

          merged.version = Math.max(head.doc.version || 0, this.doc.version || 0) + 1;
          merged.lamport = Math.max(head.doc.lamport || 0, this.doc.lamport || 0, this.localLamport) + 1;

          if (this.writeJitterMs > 0) await this._sleep(Math.floor(Math.random() * this.writeJitterMs));

          try {
            await this._writeDoc(merged);
          } catch (e) {
            attempt++;
            this.onStatus('save-error-retry');
            await this._sleep(this._retryDelay(attempt));
            continue;
          }

          const after = await this._readHead();
          const afterHash = this._jsonHash(after.doc);
          if (afterHash === this._jsonHash(merged)) {
            this.lastSeenMtime = after.mtime;
            this.lastWriteMtime = after.mtime;
            this.doc = merged;
            this.baseVersion = merged.version;
            this.baseJsonHash = this._jsonHash(merged);
            this.localLamport = Math.max(this.localLamport, merged.lamport);
            this.isDirty = false;
            this.onStatus('saved');
            return;
          } else {
            // Conflict during write; adopt after and retry with backoff
            this.conflictCount++;
            this.doc = this._mergeDocs(after.doc, this.doc);
            this.baseVersion = after.doc.version || this.baseVersion;
            this.baseJsonHash = this._jsonHash(after.doc);
            attempt++;
            this.onStatus('conflict-retry');
            await this._sleep(this._retryDelay(attempt));
            continue;
          }
        }
        this.onStatus('save-retry-exhausted');
      } finally {
        this._writing = false;
      }
    }

    _debouncedSave() {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      const self = this;
      this.saveTimer = setTimeout(function () { self._saveMergeIfNeeded(); }, this.debounceMs);
    }

    async _pollRemote() {
      if (!this.handle || this._loading || this._writing) return;
      try {
        const f = await this.handle.getFile();
        const mtime = f.lastModified;
        if (!mtime || mtime === this.lastSeenMtime) return;

        this.lastSeenMtime = mtime;
        if (mtime === this.lastWriteMtime) return; // ignore our own last write

        const headText = await f.text();
        const headParsed = this._normalizeDoc(this._safeParse(headText));

        const beforeHash = this._jsonHash(this.doc);
        const merged = this._mergeDocs(headParsed, this.doc);
        const afterHash = this._jsonHash(merged);

        // Adopt merged locally
        this.doc = merged;
        this.baseVersion = merged.version;
        this.baseJsonHash = this._jsonHash(headParsed); // base equals HEAD now
        this.localLamport = Math.max(this.localLamport, headParsed.lamport || 0);

        if (afterHash !== beforeHash) {
          const changedKeys = this._diffRecordKeys(headParsed.records, merged.records);
          this.onRemoteMerge(changedKeys);
        }

        if (this.isDirty) {
          await this._saveMergeIfNeeded();
        } else {
          this.onStatus('remote-updated');
        }
        // Adaptive polling: speed up briefly on updates
        if (this._pollAdaptive) {
          const prev = this._desiredPollMs;
          this._desiredPollMs = Math.max(this._pollMin, Math.floor(prev * this._pollRecovery));
          if (Math.abs(this._desiredPollMs - prev) >= 50) this._schedulePoll(this._desiredPollMs);
        }
      } catch (e) {
        console.error('poll error', e);
        this.onStatus('poll-error');
        if (this._pollAdaptive) {
          const prev = this._desiredPollMs;
          this._desiredPollMs = Math.min(this._pollMax, Math.floor(prev * this._pollBackoff));
          if (Math.abs(this._desiredPollMs - prev) >= 50) this._schedulePoll(this._desiredPollMs);
        }
      }
    }

    _diffRecordKeys(a, b) {
      const out = new Set();
      const ids = new Set([...(a ? Object.keys(a) : []), ...(b ? Object.keys(b) : [])]);
      ids.forEach(id => {
        const jA = JSON.stringify(a && a[id] ? a[id] : null);
        const jB = JSON.stringify(b && b[id] ? b[id] : null);
        if (jA !== jB) out.add(\`record:\${id}\`);
      });
      return Array.from(out);
    }

    _mergeDocs(head, local) {
      const result = this._normalizeDoc({ ...(head || {}), records: { ...(head && head.records ? head.records : {}) } });
      const localRecMap = (local && local.records) ? local.records : {};

      for (const [id, lrec] of Object.entries(localRecMap)) {
        const hrec = result.records[id];

        if (!hrec) {
          result.records[id] = this._cloneRec(lrec);
          continue;
        }

        const winnerDel = this._lwwTomb(hrec._meta.deleted, lrec._meta.deleted);
        const mergedRec = {
          _meta: {
            id,
            createdAt: hrec._meta.createdAt || lrec._meta.createdAt || new Date().toISOString(),
            deleted: winnerDel,
            fieldsDeleted: { ...(hrec._meta.fieldsDeleted || {}), ...(lrec._meta.fieldsDeleted || {}) }
          },
          fields: { ...(hrec.fields || {}) }
        };

        const allKeys = new Set([
          ...(hrec.fields ? Object.keys(hrec.fields) : []),
          ...(lrec.fields ? Object.keys(lrec.fields) : [])
        ]);
        allKeys.forEach(k => {
          const a = (hrec.fields && hrec.fields[k]) || null;
          const b = (lrec.fields && lrec.fields[k]) || null;
          const w = this._lwwCell(a, b);
          if (w) mergedRec.fields[k] = w; else delete mergedRec.fields[k];
        });

        const mergedFieldDeletes = {};
        const delKeys = new Set([
          ...Object.keys(hrec._meta.fieldsDeleted || {}),
          ...Object.keys(lrec._meta.fieldsDeleted || {})
        ]);
        delKeys.forEach(k => {
          const fdA = (hrec._meta.fieldsDeleted && hrec._meta.fieldsDeleted[k]) || null;
          const fdB = (lrec._meta.fieldsDeleted && lrec._meta.fieldsDeleted[k]) || null;
          const fdW = this._lwwTomb(fdA, fdB);
          if (fdW) mergedFieldDeletes[k] = fdW;
        });
        mergedRec._meta.fieldsDeleted = mergedFieldDeletes;

        if (mergedRec._meta.deleted) {
          const delTs = mergedRec._meta.deleted.ts == null ? -1 : mergedRec._meta.deleted.ts;
          const maxTs = this._maxFieldTs(mergedRec);
          if (maxTs > delTs) mergedRec._meta.deleted = null; // newer field write revives
        }

        result.records[id] = mergedRec;
      }

      return result;
    }

    _cloneRec(rec) {
      return JSON.parse(JSON.stringify(rec));
    }

    _lwwCell(a, b) {
      if (!a && !b) return null;
      if (!a) return b;
      if (!b) return a;
      if (a.ts === b.ts) {
        return String(a.actor || '') >= String(b.actor || '') ? a : b;
      }
      return a.ts > b.ts ? a : b;
    }

    _lwwTomb(a, b) {
      if (!a && !b) return null;
      if (!a) return b;
      if (!b) return a;
      if (a.ts === b.ts) {
        return String(a.actor || '') >= String(b.actor || '') ? a : b;
      }
      return a.ts > b.ts ? a : b;
    }

    async _readHead() {
      const f = await this.handle.getFile();
      const text = await f.text();
      const doc = this._normalizeDoc(this._safeParse(text));
      return { doc, mtime: f.lastModified };
    }

    async _writeDoc(doc) {
      const writable = await this.handle.createWritable();
      try {
        await writable.write(JSON.stringify(doc, null, 2));
        await writable.close();
      } catch (e) {
        try { await writable.abort(); } catch {}
        throw e;
      }
    }

    _schedulePoll(ms) {
      if (this._pollTimer) clearInterval(this._pollTimer);
      this.pollMs = ms;
      this._pollTimer = setInterval(() => this._pollRemote(), this.pollMs);
    }

    _retryDelay(attempt) {
      // Exponential backoff with jitter
      const base = this.retryBaseMs * Math.pow(2, Math.max(0, attempt - 1));
      const jitter = Math.floor(Math.random() * (this.retryJitterMs + 1));
      return Math.min(5000, base + jitter);
    }

    _sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

    _jsonHash(o) {
      try { return JSON.stringify(o); } catch { return ''; }
    }

    _nextTs() {
      const bump = Math.max(this.localLamport, (this.doc && this.doc.lamport) || 0, this.baseVersion || 0) + 1;
      this.localLamport = bump;
      if (this.doc) this.doc.lamport = Math.max(this.doc.lamport || 0, bump);
      return bump;
    }

    _clockGreater(tsA, actorA, tsB, actorB) {
      if ((tsA || 0) === (tsB || 0)) return String(actorA || '') > String(actorB || '');
      return (tsA || 0) > (tsB || 0);
    }

    async _verifyRW(fileHandle) {
      try {
        const qp = await fileHandle.queryPermission({ mode: 'readwrite' });
        if (qp === 'granted') return true;
        const rp = await fileHandle.requestPermission({ mode: 'readwrite' });
        return rp === 'granted';
      } catch { return false; }
    }
  }

  // Expose globally
  window.FsNoSqlDB = FsNoSqlDB;

})();`;
    }
,
  // ---------------- Collaboration Integration Prompt Logic ----------------
  collabBasePrompt() {
    return `You are an expert front-end engineer working with a non-coder who needs complete replacement files.

Task:
Add optional Shared JSON Live Database collaboration to this offline/static HTML/JS app using the existing sharedrive-nosql.js library.

The app must continue to work normally:
- without a shared file
- if sharedrive-nosql.js is missing
- in browsers without the File System Access API

Important product rule:
Do not write a new sync library.
Do not create SharedJsonStore, shared_sync.js, or another abstraction.
Use the provided library: window.FsNoSqlDB.

FsNoSqlDB API:
- new FsNoSqlDB({ pollMs, debounceMs })
- db.open()
- db.create(suggestedName)
- db.get(recordId)
- db.put(recordId, object)
- db.patch(recordId, partialObject)
- db.delete(recordId)
- db.deleteField(recordId, fieldName)
- db.snapshot()
- db.saveNow()
- db.startPolling()
- db.stopPolling()

Important callback rule:
Callbacks are assigned as properties, not called as registration methods.

Use:
- db.onStatus = function(status) { ... }
- db.onOpen = function(fileName) { ... }
- db.onRemoteMerge = function(changedKeys) { ... }
- db.onLocalChange = function(changedKeys) { ... }

Do not use:
- db.onStatus(...)
- db.onOpen(...)
- db.onRemoteMerge(...)
- db.onLocalChange(...)

The library already handles:
- File System Access API reads/writes
- polling
- debounced saves
- retry/backoff
- last-write-wins per field with Lamport-style timestamps
- tombstones for deleted records/fields
- merge-before-write behavior

Before coding, gather context:
- Identify the core mutable app state variables, such as arrays/objects containing user-created data.
- Identify static lookup data that must not be stored, such as catalogs, constants, options, map metadata, or generated defaults.
- Identify the existing save/persistence function, especially localStorage, import/export, backup, or download helpers.
- Identify render/update entry points that redraw the UI.
- Identify whether app state is top-level let/const inside one HTML script. If so, put the shared integration in the same script scope. Do not assume top-level let variables are available on window.

Implementation rules:
- Keep the patch small and focused.
- Preserve existing behavior unless a shared file is actively opened or created.
- Do not split a single-file app into multiple app files.
- Do not rewrite unrelated HTML, CSS, static data, render logic, or persistence code.
- Do not change the app data model unless absolutely necessary.
- Do not introduce modules, imports, exports, build tooling, frameworks, external services, or network calls.
- If sharedrive-nosql.js is missing from the app, add a script tag for it only if the file exists in the codebase. If the library file is not provided, ask for it instead of inventing it.

UI requirements:
Add two controls near the existing save/import/export controls, toolbar, or status area:

- Open Shared
- Create Shared

Also add lightweight status text, initially:
- local only

If File System Access API support or window.FsNoSqlDB is unavailable:
- hide or disable only the shared controls
- show local-only status
- leave the rest of the app fully usable

Required helper functions:
- isSharedSupported()
- setSharedStatus(text)
- getSharedState()
- applySharedState(sharedState)
- pushSharedState()
- openSharedDb()
- createSharedDb()
- installSharedSyncUi() only if the UI must be created by script

Integration shape:
- Use one database variable, for example sharedDb.
- Use one guard flag, for example applyingSharedRemote, to prevent feedback loops.
- Prefer one shared record named app:state.
- Store only core mutable app state.
- Preserve arrays as arrays and objects as objects.
- Do not store derived UI state, selected tabs, filters, temporary form values, or static catalogs unless the app already persists them as user settings.

Default state mapping:
Use one FsNoSqlDB record:

record id: app:state

Example:
{
  tasks: tasks,
  contacts: contacts,
  settings: settings
}

For this mapping:
- getSharedState() returns the core mutable state object.
- applySharedState(sharedState) validates the shared data, assigns it into in-memory app state, saves it locally, and calls the existing render/update function.

Persistence hook:
Wrap or update the app's existing save function only if that is the common persistence hook.

The save function should:
1. Save normally to localStorage or existing local persistence.
2. If sharedDb is active and applyingSharedRemote is false, call pushSharedState().

pushSharedState() should:
1. db.put('app:state', getSharedState())
2. call db.saveNow() if available, so other browser windows can read the file promptly
3. catch errors and update status without breaking local app behavior

Remote merge behavior:
Do not rely on changedKeys containing 'app:state'.

Some versions of sharedrive-nosql.js may report changedKeys as:
- record ids
- field names
- an empty array
- another implementation-specific shape

Therefore, on any db.onRemoteMerge event:
1. Set applyingSharedRemote = true.
2. Read db.get('app:state').
3. If valid shared state exists, apply it to in-memory state.
4. Save/cache locally without triggering another shared write.
5. Call the existing render/update function.
6. Set applyingSharedRemote = false in a finally block.

Do not reload the page.
Do not overwrite static data or app functions.
If remote data fails validation, show a sync status message and keep the local app usable.

Create/open behavior:
createSharedDb() should:
1. Check support.
2. Create a new FsNoSqlDB instance if needed.
3. await db.create('shared-database.json').
4. Start polling.
5. Push the current local app state into the file.
6. Save immediately with db.saveNow() if available.
7. Update status.

openSharedDb() should:
1. Check support.
2. Create a new FsNoSqlDB instance if needed.
3. await db.open().
4. Start polling.
5. Read db.get('app:state').
6. If shared state exists, apply it locally and render.
7. If no shared state exists, push the current local app state into the file.
8. Update status.

User cancellation and permission denial should be handled quietly:
- do not throw visible app errors
- show local-only or cancelled status if useful
- keep the app usable

Deliverables:
- For every changed existing file, output the complete new file contents.
- For every new file, output the complete new file contents.
- Do not output diff-only patches.
- Do not include unrelated refactors.
- If README exists, include a short usage section in the complete README file.
- If no README exists, create one only if the app already has documentation patterns.

Final response format:

A. Discovered context:
- state variables
- persistence hooks
- render hooks
- where shared UI was added

B. What changed:
- concise list

C. Complete files:
- full contents of each changed/new file

D. Manual test steps:
1. Open the app in two browser windows.
2. In Window A, click Create Shared and save a JSON file.
3. In Window B, click Open Shared and select that same file.
4. Add/edit/delete data in A and confirm B updates after polling.
5. Add/edit/delete data in B and confirm A updates.
6. Confirm normal local save/import/export still works when no shared file is open.
7. Confirm unsupported browsers remain local-only.

If the selected codebase is too incomplete to identify state, save hooks, or render hooks, ask concise targeted questions before coding.`;
  },

  async populateCollabFileList(options = {}) {
    const listEl = document.getElementById('collab-file-list');
    if (!listEl) return;
    const status = document.getElementById('collab-status');
    const generateBtn = document.getElementById('collab-generate');
    const copyBtn = document.getElementById('collab-copy');
    if (!loadFolder.fileHandle) {
      listEl.replaceChildren();
      const em = document.createElement('em');
      em.textContent = 'Load a directory first.';
      listEl.appendChild(em);
      if (generateBtn) generateBtn.disabled = true;
      if (copyBtn) copyBtn.disabled = true;
      return;
    }

    if (generateBtn) generateBtn.disabled = false;
    const priorBoxes = Array.from(document.querySelectorAll('#collab-file-list input[type="checkbox"]'));
    const hadPriorBoxes = priorBoxes.length > 0;
    const priorSelection = new Map(priorBoxes.map(cb => [
      cb.getAttribute('data-path') || cb.getAttribute('data-uuid') || '',
      cb.checked
    ]));

    if (options.sync && typeof loadFolder.syncFileStructure === 'function') {
      if (status) status.textContent = 'Refreshing file list...';
      await loadFolder.syncFileStructure({ quiet: true });
    }

    const exts = ['js','html','css','json','md','txt'];
    const excludedPromptFiles = new Set([
      'devconsole.js',
      'testrecorder.js',
      'sharedrive-nosql.js',
      'sharedrive-noqsl.js'
    ]);
    const files = (loadFolder.fileStructure || []).filter(f => {
      if (!f || f.kind !== 'file' || !exts.includes((f.type || '').toLowerCase())) return false;
      const baseName = String(f.name || f.relativePath || '').toLowerCase();
      return !excludedPromptFiles.has(baseName);
    });
    files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
    if (!files.length) {
      listEl.replaceChildren();
      const em = document.createElement('em');
      em.textContent = 'No supported text files found.';
      listEl.appendChild(em);
      if (generateBtn) generateBtn.disabled = true;
      if (status) status.textContent = 'No files available';
      return;
    }

    this._setSafeContent(listEl, files.map(f => {
      const rel = String(f.relativePath || f.name || '');
      const checked = hadPriorBoxes ? priorSelection.get(rel) !== false : true;
      return `<label style='display:block; cursor:pointer;'><input type='checkbox' data-uuid='${this._escape(f.uuid || '')}' data-path='${this._escape(rel)}' ${checked ? 'checked' : ''}> ${this._escape(rel)}</label>`;
    }).join(''));
    if (status) status.textContent = `${files.length} files available`;
  },

  _toggleCollabAll(state) {
    document.querySelectorAll('#collab-file-list input[type="checkbox"]').forEach(cb=>cb.checked=state);
  },

  async generateCollabPrompt() {
    const status = document.getElementById('collab-status');
    const out = document.getElementById('collab-output');
    const copyBtn = document.getElementById('collab-copy');
    if (!loadFolder.fileHandle) { alert('Load a directory first.'); return; }
    await this.populateCollabFileList({ sync: true });
    const sel = Array.from(document.querySelectorAll('#collab-file-list input[type="checkbox"]:checked'));
    if (!sel.length) { alert('Select at least one file.'); return; }
    status.textContent = 'Building prompt...';
    const trim = document.getElementById('collab-trim').checked;
    const base = this.collabBasePrompt();
    const fileSections = [];
    for (const cb of sel) {
      const uuid = cb.getAttribute('data-uuid');
      const rel = cb.getAttribute('data-path');
      const file = (loadFolder.fileStructure || []).find(f=>f.relativePath===rel) ||
        (loadFolder.fileStructure || []).find(f=>f.uuid===uuid);
      if (!file) continue;
      try {
        const content = await loadFolder.getFileContent(file);
        fileSections.push(`\n----- FILE: ${file.relativePath} -----\n` + (trim ? this._trim(content) : content));
      } catch(e) { fileSections.push(`\n----- FILE: ${file.relativePath} (read error) -----\n/* ERROR: ${e.message} */`); }
    }
    const full = base + '\n\n===== CODEBASE FILES START =====' + fileSections.join('') + '\n===== CODEBASE FILES END =====';
    out.value = full;
    out.scrollTop = 0;
    copyBtn.disabled = false;
    status.textContent = 'Prompt ready';
  },

  copyCollabPrompt() {
    const out = document.getElementById('collab-output');
    if (!out.value) return;
    navigator.clipboard.writeText(out.value).then(()=>{
      const btn = document.getElementById('collab-copy');
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(()=>btn.textContent=prev, 1200);
    }).catch(err=>alert('Copy failed: '+err.message));
  },

  _trim(text) { const MAX=240; return (text||'').split(/\r?\n/).map(l=>l.length>MAX?l.slice(0,MAX)+` /* trimmed ${l.length-MAX} chars */`:l).join('\n'); },
  _escape(s='') { return s.replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }
};
