/*!
 * fs-nosql-db.js
 * Lightweight, serverless "NoSQL" JSON store for static HTML apps (file://).
 * Uses the File System Access API to read/write a shared JSON file and
 * supports multi-user concurrent edits with LWW (last-write-wins) merging.
 *
 * Global: window.FsNoSqlDB
 */
(function () { 'use strict';

  function _uuid() {
    try { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
    catch { return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
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
      this.onLocalChange([`record:${id}:deleted`]);
      this._debouncedSave();
    }

    async deleteField(id, key) {
      this._ensureOpen();
      const rec = this._ensureRecord(id);
      if (!rec._meta.fieldsDeleted) rec._meta.fieldsDeleted = {};
      rec._meta.fieldsDeleted[key] = { ts: this._nextTs(), actor: this.clientId };
      this.isDirty = true;
      this.onLocalChange([`record:${id}:field:${key}:deleted`]);
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
          changes.push(`record:${id}:field:${k}:upsert`);
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
        if (jA !== jB) out.add(`record:${id}`);
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

})(); 
