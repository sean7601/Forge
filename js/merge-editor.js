/* ===== Forge v2 — Merge Editor: Unified Inline Diff with Per-Hunk Accept/Reject ===== */

(function () {
    'use strict';

    // ══════════════════════════════════════════════════════════════════
    //  DIFF ALGORITHM — LCS-based line diff with hunk grouping
    // ══════════════════════════════════════════════════════════════════

    function computeDiff(oldText, newText) {
        if (oldText === newText) return [];
        var oldLines = (oldText || '').split('\n');
        var newLines = (newText || '').split('\n');

        // Common prefix
        var prefixLen = 0;
        while (prefixLen < oldLines.length && prefixLen < newLines.length &&
            oldLines[prefixLen] === newLines[prefixLen]) {
            prefixLen++;
        }

        // Common suffix
        var suffixLen = 0;
        while (suffixLen < oldLines.length - prefixLen &&
            suffixLen < newLines.length - prefixLen &&
            oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]) {
            suffixLen++;
        }

        var oldMid = oldLines.slice(prefixLen, oldLines.length - suffixLen);
        var newMid = newLines.slice(prefixLen, newLines.length - suffixLen);

        if (oldMid.length === 0 && newMid.length === 0) return [];

        // Guard: if too large for LCS, use simple approach
        if (oldMid.length * newMid.length > 25000000) {
            return [{
                id: 0,
                oldStart: prefixLen, oldEnd: prefixLen + oldMid.length,
                newStart: prefixLen, newEnd: prefixLen + newMid.length,
                oldLines: oldMid.slice(), newLines: newMid.slice(), status: 'pending'
            }];
        }

        // LCS DP
        var m = oldMid.length, n = newMid.length;
        var dp = new Array(m + 1);
        for (var ii = 0; ii <= m; ii++) {
            dp[ii] = new Uint16Array(n + 1);
        }
        for (var i = 1; i <= m; i++) {
            for (var j = 1; j <= n; j++) {
                if (oldMid[i - 1] === newMid[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to produce edit script
        var ops = [];
        var bi = m, bj = n;
        while (bi > 0 || bj > 0) {
            if (bi > 0 && bj > 0 && oldMid[bi - 1] === newMid[bj - 1]) {
                ops.push({ type: 'equal', oldIdx: prefixLen + bi - 1, newIdx: prefixLen + bj - 1 });
                bi--; bj--;
            } else if (bj > 0 && (bi === 0 || dp[bi][bj - 1] >= dp[bi - 1][bj])) {
                ops.push({ type: 'insert', newIdx: prefixLen + bj - 1 });
                bj--;
            } else {
                ops.push({ type: 'delete', oldIdx: prefixLen + bi - 1 });
                bi--;
            }
        }
        ops.reverse();

        return groupIntoHunks(ops, oldLines, newLines);
    }

    function groupIntoHunks(ops, oldLines, newLines) {
        var rawHunks = [];
        var current = null;

        for (var k = 0; k < ops.length; k++) {
            var op = ops[k];
            if (op.type === 'equal') {
                if (current) {
                    rawHunks.push(current);
                    current = null;
                }
                continue;
            }
            if (!current) {
                current = {
                    oldStart: op.type === 'delete' ? op.oldIdx : (op.oldIdx != null ? op.oldIdx : -1),
                    deletes: [],
                    inserts: []
                };
            }
            if (op.type === 'delete') {
                current.deletes.push(op.oldIdx);
                if (current.oldStart === -1) current.oldStart = op.oldIdx;
            }
            if (op.type === 'insert') {
                current.inserts.push(op.newIdx);
            }
        }
        if (current) rawHunks.push(current);

        // Merge hunks within 3 lines of each other
        var merged = [];
        for (var mi = 0; mi < rawHunks.length; mi++) {
            var h = rawHunks[mi];
            if (merged.length > 0) {
                var prev = merged[merged.length - 1];
                var prevOldEnd = prev.deletes.length ? Math.max.apply(null, prev.deletes) + 1 : prev.oldStart;
                var prevNewEnd = prev.inserts.length ? Math.max.apply(null, prev.inserts) + 1 : (prev.deletes.length ? prev.deletes[0] : 0);
                var hOldStart = h.deletes.length ? h.deletes[0] : (h.oldStart >= 0 ? h.oldStart : Infinity);
                var hNewStart = h.inserts.length ? h.inserts[0] : Infinity;
                var gapOld = hOldStart - prevOldEnd;
                var gapNew = hNewStart - prevNewEnd;
                if (Math.min(gapOld, gapNew) <= 3) {
                    prev.deletes = prev.deletes.concat(h.deletes);
                    prev.inserts = prev.inserts.concat(h.inserts);
                    continue;
                }
            }
            merged.push(h);
        }

        return merged.map(function (h, idx) {
            var oldIdxs = h.deletes.sort(function (a, b) { return a - b; });
            var newIdxs = h.inserts.sort(function (a, b) { return a - b; });
            var oldStart = oldIdxs.length ? oldIdxs[0] : (h.oldStart >= 0 ? h.oldStart : (newIdxs.length ? newIdxs[0] : 0));
            var oldEnd = oldIdxs.length ? oldIdxs[oldIdxs.length - 1] + 1 : oldStart;
            var newStart = newIdxs.length ? newIdxs[0] : oldStart;
            var newEnd = newIdxs.length ? newIdxs[newIdxs.length - 1] + 1 : newStart;
            return {
                id: idx,
                oldStart: oldStart, oldEnd: oldEnd,
                newStart: newStart, newEnd: newEnd,
                oldLines: oldLines.slice(oldStart, oldEnd),
                newLines: newLines.slice(newStart, newEnd),
                status: 'pending'
            };
        });
    }

    function buildInlineReviewHtml(oldContent, newContent, esc) {
        var oldText = oldContent != null ? oldContent : '';
        var newText = newContent != null ? newContent : '';
        var oldLines = oldText.split('\n');
        var newLines = newText.split('\n');
        var hunks = computeDiff(oldText, newText);
        var addedLines = Object.create(null);
        var removedBefore = Object.create(null);
        var firstTargetAssigned = false;

        function pushRemoved(anchor, payload) {
            if (!removedBefore[anchor]) removedBefore[anchor] = [];
            removedBefore[anchor].push(payload);
        }

        for (var i = 0; i < hunks.length; i++) {
            var hunk = hunks[i];
            var anchor = Math.max(0, Math.min(newLines.length, hunk.newStart));
            var markRemovedTarget = !firstTargetAssigned && hunk.oldLines.length > 0 && hunk.newLines.length === 0;
            if (hunk.oldLines.length > 0) {
                pushRemoved(anchor, {
                    oldStart: hunk.oldStart,
                    lines: hunk.oldLines.slice(),
                    isTarget: markRemovedTarget
                });
                if (markRemovedTarget) firstTargetAssigned = true;
            }
            for (var li = hunk.newStart; li < hunk.newEnd; li++) {
                addedLines[li] = !firstTargetAssigned && li === hunk.newStart ? 'target' : 'changed';
            }
            if (!firstTargetAssigned && hunk.newLines.length > 0) firstTargetAssigned = true;
        }

        var html = '<div class="inline-file-review"><div class="inline-file-code">';

        function renderRemovedBlocks(anchor) {
            var blocks = removedBefore[anchor];
            if (!blocks || !blocks.length) return;
            for (var bi = 0; bi < blocks.length; bi++) {
                var block = blocks[bi];
                html += '<div class="inline-file-removed-block">';
                for (var ri = 0; ri < block.lines.length; ri++) {
                    var targetAttr = block.isTarget && ri === 0 ? ' data-review-target="true"' : '';
                    html += '<div class="inline-file-line removed"' + targetAttr + '>' +
                        '<span class="inline-file-lineno">' + (block.oldStart + ri + 1) + '</span>' +
                        '<span class="inline-file-marker">-</span>' +
                        '<span class="inline-file-text">' + esc(block.lines[ri] || '\u00A0') + '</span>' +
                        '</div>';
                }
                html += '</div>';
            }
        }

        for (var lineIdx = 0; lineIdx < newLines.length; lineIdx++) {
            renderRemovedBlocks(lineIdx);
            var state = addedLines[lineIdx] || '';
            var targetAttr = state === 'target' ? ' data-review-target="true"' : '';
            var cls = state ? ' changed' : '';
            html += '<div class="inline-file-line' + cls + '"' + targetAttr + '>' +
                '<span class="inline-file-lineno">' + (lineIdx + 1) + '</span>' +
                '<span class="inline-file-marker">' + (state ? '+' : ' ') + '</span>' +
                '<span class="inline-file-text">' + esc(newLines[lineIdx] || '\u00A0') + '</span>' +
                '</div>';
        }
        renderRemovedBlocks(newLines.length);

        html += '</div></div>';
        return html;
    }

    // ══════════════════════════════════════════════════════════════════
    //  CM6 WIDGET CLASSES — Deleted lines + hunk controls
    // ══════════════════════════════════════════════════════════════════

    var DeletedLinesWidget = null;
    var HunkControlsWidget = null;

    function initWidgetClasses() {
        if (DeletedLinesWidget) return;
        var cm = window.cmModules;
        if (!cm || !cm.WidgetType) return;

        // Deleted lines widget — shows old (removed) lines in red above the new lines
        DeletedLinesWidget = class extends cm.WidgetType {
            constructor(lines, hunkId) {
                super();
                this.lines = lines;
                this.hunkId = hunkId;
            }
            toDOM() {
                var wrap = document.createElement('div');
                wrap.className = 'merge-deleted-block';
                wrap.setAttribute('data-hunk-id', this.hunkId);
                for (var i = 0; i < this.lines.length; i++) {
                    var lineEl = document.createElement('div');
                    lineEl.className = 'merge-deleted-line';
                    lineEl.textContent = this.lines[i] || '\u00A0'; // nbsp for empty lines
                    wrap.appendChild(lineEl);
                }
                return wrap;
            }
            eq(other) {
                return this.hunkId === other.hunkId &&
                    this.lines.length === other.lines.length &&
                    this.lines.join('\n') === other.lines.join('\n');
            }
            get estimatedHeight() {
                return this.lines.length * 20;
            }
            ignoreEvent() { return true; }
        };

        // Hunk controls widget — Accept / Reject buttons
        HunkControlsWidget = class extends cm.WidgetType {
            constructor(hunkId, oldCount, newCount) {
                super();
                this.hunkId = hunkId;
                this.oldCount = oldCount;
                this.newCount = newCount;
            }
            toDOM() {
                var wrap = document.createElement('div');
                wrap.className = 'merge-hunk-controls';
                wrap.setAttribute('data-hunk-id', this.hunkId);

                var label = document.createElement('span');
                label.className = 'merge-hunk-label';
                var parts = [];
                if (this.oldCount > 0) parts.push('-' + this.oldCount);
                if (this.newCount > 0) parts.push('+' + this.newCount);
                label.textContent = 'Change ' + (this.hunkId + 1) + ' (' + parts.join(', ') + ')';

                var acceptBtn = document.createElement('button');
                acceptBtn.className = 'merge-inline-btn accept';
                acceptBtn.textContent = '\u2713 Accept';
                acceptBtn.addEventListener('click', function () { window.mergeEditor.acceptHunk(wrap.getAttribute('data-hunk-id') | 0); });

                var rejectBtn = document.createElement('button');
                rejectBtn.className = 'merge-inline-btn reject';
                rejectBtn.textContent = '\u2717 Reject';
                rejectBtn.addEventListener('click', function () { window.mergeEditor.rejectHunk(wrap.getAttribute('data-hunk-id') | 0); });

                wrap.appendChild(label);
                wrap.appendChild(acceptBtn);
                wrap.appendChild(rejectBtn);
                return wrap;
            }
            eq(other) {
                return this.hunkId === other.hunkId &&
                    this.oldCount === other.oldCount &&
                    this.newCount === other.newCount;
            }
            get estimatedHeight() { return 26; }
            ignoreEvent() { return false; }
        };
    }

    // ══════════════════════════════════════════════════════════════════
    //  CM6 DECORATION — StateField that holds all decorations
    // ══════════════════════════════════════════════════════════════════

    var setMergeDecos = null;

    function initMergeEffects() {
        if (setMergeDecos) return;
        var cm = window.cmModules;
        if (!cm || !cm.StateEffect) return;
        setMergeDecos = cm.StateEffect.define();
    }

    function createMergeDecoField() {
        var cm = window.cmModules;
        if (!cm || !cm.StateField || !cm.Decoration) return null;
        return cm.StateField.define({
            create: function () { return cm.Decoration.none; },
            update: function (decos, tr) {
                // On doc change, remap existing decorations
                decos = decos.map(tr.changes);
                for (var i = 0; i < tr.effects.length; i++) {
                    if (tr.effects[i].is(setMergeDecos)) {
                        decos = tr.effects[i].value;
                    }
                }
                return decos;
            },
            provide: function (field) {
                return cm.EditorView.decorations.from(field);
            }
        });
    }

    /**
     * Build all decorations (widgets + line highlights) for the unified view.
     * The document contains the NEW content. Old (deleted) lines are widgets.
     */
    function buildUnifiedDecorations(hunks, doc) {
        var cm = window.cmModules;
        if (!cm || !DeletedLinesWidget || !HunkControlsWidget) return cm.Decoration.none;

        // Collect all decorations, then sort by position
        var decos = [];

        for (var h = 0; h < hunks.length; h++) {
            var hunk = hunks[h];
            if (hunk.status !== 'pending') continue;

            // Position: before the first new line of this hunk (or end of doc for pure deletions)
            var anchorLine = hunk.newStart + 1; // 1-based
            if (anchorLine > doc.lines) anchorLine = doc.lines;
            var anchorPos = doc.line(anchorLine).from;

            // 1. Hunk controls widget (appears first, above deleted lines)
            decos.push({
                pos: anchorPos,
                deco: cm.Decoration.widget({
                    widget: new HunkControlsWidget(hunk.id, hunk.oldLines.length, hunk.newLines.length),
                    block: true,
                    side: -2 // render above deleted lines widget
                })
            });

            // 2. Deleted lines widget (shows old lines in red)
            if (hunk.oldLines.length > 0) {
                decos.push({
                    pos: anchorPos,
                    deco: cm.Decoration.widget({
                        widget: new DeletedLinesWidget(hunk.oldLines, hunk.id),
                        block: true,
                        side: -1 // render above the new line but below controls
                    })
                });
            }

            // 3. Line decorations on new (added/changed) lines — green highlight
            for (var li = hunk.newStart; li < hunk.newEnd && li + 1 <= doc.lines; li++) {
                var line = doc.line(li + 1);
                decos.push({
                    pos: line.from,
                    deco: cm.Decoration.line({ class: 'merge-line-added' })
                });
            }
        }

        // Sort by position (required by RangeSetBuilder)
        decos.sort(function (a, b) { return a.pos - b.pos || 0; });

        var builder = new cm.RangeSetBuilder();
        for (var d = 0; d < decos.length; d++) {
            builder.add(decos[d].pos, decos[d].pos, decos[d].deco);
        }
        return builder.finish();
    }

    // ══════════════════════════════════════════════════════════════════
    //  LANGUAGE DETECTION
    // ══════════════════════════════════════════════════════════════════

    function getLangExtension(path) {
        var cm = window.cmModules;
        if (!cm) return [];
        var ext = (path || '').split('.').pop().toLowerCase();
        if (ext === 'js' || ext === 'mjs') return cm.javascript ? [cm.javascript()] : [];
        if (ext === 'html' || ext === 'htm') return cm.htmlLang ? [cm.htmlLang()] : [];
        if (ext === 'css') return cm.cssLang ? [cm.cssLang()] : [];
        if (ext === 'py') return cm.python ? [cm.python()] : [];
        return [];
    }

    // ══════════════════════════════════════════════════════════════════
    //  MERGE EDITOR — Unified inline view
    // ══════════════════════════════════════════════════════════════════

    var mergeEditor = {
        _active: false,
        _hunks: [],
        _view: null,      // single CM6 editor
        _resolve: null,
        _containerEl: null,
        _decoField: null,
        _overviewEl: null,
        _overviewCanvas: null,
        _overviewMarkersEl: null,
        _overviewViewportEl: null,
        _overviewDragging: false,
        _overviewRaf: 0,
        _onOverviewPointerDown: null,
        _onOverviewPointerMove: null,
        _onOverviewPointerUp: null,
        _onEditorScroll: null,
        _onWindowResize: null,

        /**
         * Open the merge editor.
         * @param {string} path - File path
         * @param {string|null} oldContent - Original content (null for new file)
         * @param {string} newContent - Proposed content
         * @returns {Promise<{accepted: boolean, content: string|null}>}
         */
        open: function (path, oldContent, newContent) {
            var self = this;
            this._destroy();

            return new Promise(function (resolve) {
                self._resolve = resolve;
                self._active = true;

                var old = oldContent != null ? oldContent : '';
                self._isNewFile = (oldContent == null);
                self._hunks = computeDiff(old, newContent);

                if (self._hunks.length === 0) {
                    resolve({ accepted: true, content: newContent });
                    self._active = false;
                    return;
                }

                initMergeEffects();
                initWidgetClasses();
                self._buildDOM(path);
                self._createEditor(path, newContent);
                self._applyDecorations();
                self._updateHunkCounter();
            });
        },

        _buildDOM: function (path) {
            var container = document.getElementById('ai-diff-inline');
            if (!container) return;
            this._containerEl = container;

            var suffix = this._isNewFile ? ' (new file)' : '';

            container.innerHTML =
                '<div class="merge-editor-header">' +
                    '<span class="codicon codicon-git-compare"></span> ' +
                    '<span class="merge-file-path">' + this._esc(path) + suffix + '</span>' +
                    '<span class="merge-hunk-counter" id="merge-hunk-counter"></span>' +
                    '<div style="flex:1"></div>' +
                    '<button class="btn btn-sm btn-success" id="merge-accept-all">Accept All</button>' +
                    '<button class="btn btn-sm" id="merge-reject-all">Reject All</button>' +
                    '<button class="btn btn-sm btn-primary" id="merge-done">Done</button>' +
                '</div>' +
                '<div class="merge-editor-body">' +
                    '<div class="merge-unified-editor-wrap">' +
                        '<div class="merge-unified-editor" id="merge-unified-editor"></div>' +
                    '</div>' +
                    '<div class="merge-overview" id="merge-overview" title="Overview: drag or click to scroll">' +
                        '<canvas class="merge-overview-canvas" id="merge-overview-canvas"></canvas>' +
                        '<div class="merge-overview-markers" id="merge-overview-markers"></div>' +
                        '<div class="merge-overview-viewport" id="merge-overview-viewport"></div>' +
                    '</div>' +
                '</div>';

            var self = this;
            document.getElementById('merge-accept-all').addEventListener('click', function () { self.acceptAll(); });
            document.getElementById('merge-reject-all').addEventListener('click', function () { self.rejectAll(); });
            document.getElementById('merge-done').addEventListener('click', function () { self.finish(); });

            this._overviewEl = document.getElementById('merge-overview');
            this._overviewCanvas = document.getElementById('merge-overview-canvas');
            this._overviewMarkersEl = document.getElementById('merge-overview-markers');
            this._overviewViewportEl = document.getElementById('merge-overview-viewport');

            container.classList.add('visible');
        },

        _createEditor: function (path, newContent) {
            var cm = window.cmModules;
            if (!cm || !cm.EditorView || !cm.EditorState) return;

            this._decoField = createMergeDecoField();
            var langExt = getLangExtension(path);
            var light = typeof isLightTheme === 'function' ? isLightTheme() : false;
            var themeExt = typeof createWctTheme === 'function' ? createWctTheme() : null;

            var extensions = [
                cm.basicSetup,
                ...(light ? [] : (cm.oneDark ? [cm.oneDark] : [])),
                ...(themeExt ? [themeExt] : []),
                ...langExt
            ];
            if (this._decoField) extensions.push(this._decoField);

            var state = cm.EditorState.create({ doc: newContent, extensions: extensions });
            this._view = new cm.EditorView({
                state: state,
                parent: document.getElementById('merge-unified-editor')
            });
            this._bindOverviewEvents();
            this._requestOverviewRefresh();
        },

        _applyDecorations: function () {
            if (!this._view || !setMergeDecos) return;
            var decos = buildUnifiedDecorations(this._hunks, this._view.state.doc);
            this._view.dispatch({ effects: setMergeDecos.of(decos) });
            this._requestOverviewRefresh();
        },

        _updateHunkCounter: function () {
            var el = document.getElementById('merge-hunk-counter');
            if (!el) return;
            var total = this._hunks.length;
            var resolved = 0;
            for (var i = 0; i < this._hunks.length; i++) {
                if (this._hunks[i].status !== 'pending') resolved++;
            }
            if (resolved === total) {
                el.innerHTML = '<span class="resolved">All ' + total + ' changes resolved</span>';
            } else {
                el.textContent = resolved + ' / ' + total + ' changes resolved';
            }
            this._renderOverviewMarkers();
        },

        _bindOverviewEvents: function () {
            if (!this._view || !this._overviewEl) return;
            var self = this;
            this._overviewDragging = false;

            this._onOverviewPointerDown = function (e) {
                if (e.button !== 0) return;
                self._overviewDragging = true;
                if (self._overviewEl.setPointerCapture) {
                    try { self._overviewEl.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
                }
                self._handleOverviewPointer(e);
                e.preventDefault();
            };
            this._onOverviewPointerMove = function (e) {
                if (!self._overviewDragging) return;
                self._handleOverviewPointer(e);
                e.preventDefault();
            };
            this._onOverviewPointerUp = function (e) {
                self._overviewDragging = false;
                if (self._overviewEl.releasePointerCapture) {
                    try { self._overviewEl.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
                }
            };
            this._onEditorScroll = function () { self._updateOverviewViewport(); };
            this._onWindowResize = function () { self._requestOverviewRefresh(); };

            this._overviewEl.addEventListener('pointerdown', this._onOverviewPointerDown);
            this._overviewEl.addEventListener('pointermove', this._onOverviewPointerMove);
            this._overviewEl.addEventListener('pointerup', this._onOverviewPointerUp);
            this._overviewEl.addEventListener('pointercancel', this._onOverviewPointerUp);
            this._view.scrollDOM.addEventListener('scroll', this._onEditorScroll, { passive: true });
            window.addEventListener('resize', this._onWindowResize);
        },

        _unbindOverviewEvents: function () {
            if (this._overviewEl) {
                if (this._onOverviewPointerDown) this._overviewEl.removeEventListener('pointerdown', this._onOverviewPointerDown);
                if (this._onOverviewPointerMove) this._overviewEl.removeEventListener('pointermove', this._onOverviewPointerMove);
                if (this._onOverviewPointerUp) {
                    this._overviewEl.removeEventListener('pointerup', this._onOverviewPointerUp);
                    this._overviewEl.removeEventListener('pointercancel', this._onOverviewPointerUp);
                }
            }
            if (this._view && this._onEditorScroll) {
                this._view.scrollDOM.removeEventListener('scroll', this._onEditorScroll);
            }
            if (this._onWindowResize) {
                window.removeEventListener('resize', this._onWindowResize);
            }
            this._onOverviewPointerDown = null;
            this._onOverviewPointerMove = null;
            this._onOverviewPointerUp = null;
            this._onEditorScroll = null;
            this._onWindowResize = null;
            this._overviewDragging = false;
        },

        _handleOverviewPointer: function (e) {
            if (!this._view || !this._overviewEl) return;
            var markerEl = e.target && e.target.closest ? e.target.closest('.merge-overview-marker') : null;
            if (markerEl) {
                this._scrollToHunk(markerEl.getAttribute('data-hunk-id') | 0);
                return;
            }
            this._scrollOverviewToEvent(e);
        },

        _scrollOverviewToEvent: function (e) {
            if (!this._view || !this._overviewEl) return;
            var rect = this._overviewEl.getBoundingClientRect();
            if (rect.height <= 1) return;
            var ratio = (e.clientY - rect.top) / rect.height;
            ratio = Math.max(0, Math.min(1, ratio));

            var scrollDom = this._view.scrollDOM;
            var maxScroll = Math.max(0, scrollDom.scrollHeight - scrollDom.clientHeight);
            if (maxScroll <= 0) return;

            var viewportRatio = scrollDom.clientHeight / Math.max(1, scrollDom.scrollHeight);
            var targetRatio = Math.max(0, Math.min(1, ratio - (viewportRatio / 2)));
            scrollDom.scrollTop = targetRatio * maxScroll;
            this._updateOverviewViewport();
        },

        _scrollToHunk: function (hunkId) {
            if (!this._view) return;
            var hunk = null;
            for (var i = 0; i < this._hunks.length; i++) {
                if (this._hunks[i].id === hunkId) { hunk = this._hunks[i]; break; }
            }
            if (!hunk) return;
            var totalLines = Math.max(1, this._view.state.doc.lines);
            var ratio = Math.max(0, Math.min(1, hunk.newStart / totalLines));
            var scrollDom = this._view.scrollDOM;
            var maxScroll = Math.max(0, scrollDom.scrollHeight - scrollDom.clientHeight);
            scrollDom.scrollTop = ratio * maxScroll;
            this._updateOverviewViewport();
        },

        _requestOverviewRefresh: function () {
            if (this._overviewRaf) return;
            var self = this;
            this._overviewRaf = requestAnimationFrame(function () {
                self._overviewRaf = 0;
                self._renderOverviewCanvas();
                self._renderOverviewMarkers();
                self._updateOverviewViewport();
            });
        },

        _renderOverviewCanvas: function () {
            if (!this._overviewCanvas || !this._overviewEl || !this._view) return;
            var rect = this._overviewEl.getBoundingClientRect();
            var width = Math.max(1, Math.floor(rect.width));
            var height = Math.max(1, Math.floor(rect.height));
            var dpr = window.devicePixelRatio || 1;

            this._overviewCanvas.width = Math.max(1, Math.floor(width * dpr));
            this._overviewCanvas.height = Math.max(1, Math.floor(height * dpr));
            this._overviewCanvas.style.width = width + 'px';
            this._overviewCanvas.style.height = height + 'px';

            var ctx = this._overviewCanvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);

            var textBandW = Math.max(6, width - 16);
            var doc = this._view.state.doc;
            var totalLines = Math.max(1, doc.lines);

            ctx.fillStyle = 'rgba(127, 152, 183, 0.08)';
            ctx.fillRect(1, 0, textBandW, height);

            for (var y = 0; y < height; y += 2) {
                var lineNo = Math.min(totalLines, Math.floor((y / height) * totalLines) + 1);
                var lineText = doc.line(lineNo).text || '';
                var density = lineText.length ? Math.min(1, lineText.length / 120) : 0;
                if (!lineText.trim()) density *= 0.2;
                var alpha = 0.05 + (0.28 * density);
                var barW = Math.max(2, Math.floor(textBandW * (0.15 + 0.85 * density)));
                ctx.fillStyle = 'rgba(160, 184, 214,' + alpha.toFixed(3) + ')';
                ctx.fillRect(2, y, barW, 1);
            }
        },

        _renderOverviewMarkers: function () {
            if (!this._overviewMarkersEl || !this._view) return;
            var totalLines = Math.max(1, this._view.state.doc.lines);
            var frag = document.createDocumentFragment();

            for (var i = 0; i < this._hunks.length; i++) {
                var hunk = this._hunks[i];
                var start = Math.max(0, Math.min(totalLines - 1, hunk.newStart));
                var endExclusive = Math.max(start + 1, Math.min(totalLines, hunk.newEnd || (hunk.newStart + 1)));
                var topPct = (start / totalLines) * 100;
                var heightPct = Math.max(0.8, ((endExclusive - start) / totalLines) * 100);
                if (topPct + heightPct > 100) topPct = 100 - heightPct;

                var marker = document.createElement('div');
                marker.className = 'merge-overview-marker ' + (hunk.status || 'pending');
                marker.style.top = topPct + '%';
                marker.style.height = heightPct + '%';
                marker.setAttribute('data-hunk-id', String(hunk.id));
                marker.title = 'Change ' + (hunk.id + 1) + ' (' + (hunk.status || 'pending') + ')';
                frag.appendChild(marker);
            }

            this._overviewMarkersEl.innerHTML = '';
            this._overviewMarkersEl.appendChild(frag);
        },

        _updateOverviewViewport: function () {
            if (!this._overviewViewportEl || !this._overviewEl || !this._view) return;
            var scrollDom = this._view.scrollDOM;
            var scrollHeight = Math.max(1, scrollDom.scrollHeight);
            var clientHeight = Math.max(1, scrollDom.clientHeight);
            var maxScroll = Math.max(0, scrollHeight - clientHeight);
            var viewH = Math.max(1, this._overviewEl.clientHeight);

            var heightPct = Math.max((10 / viewH) * 100, (clientHeight / scrollHeight) * 100);
            heightPct = Math.min(100, heightPct);
            var topPct = maxScroll > 0 ? (scrollDom.scrollTop / maxScroll) * (100 - heightPct) : 0;

            this._overviewViewportEl.style.top = topPct + '%';
            this._overviewViewportEl.style.height = heightPct + '%';
        },

        _allResolved: function () {
            for (var i = 0; i < this._hunks.length; i++) {
                if (this._hunks[i].status === 'pending') return false;
            }
            return true;
        },

        _autoFinishIfResolved: function () {
            if (!this._active || !this._resolve) return;
            if (this._allResolved()) this.finish();
        },

        // ── Per-Hunk Actions ──

        acceptHunk: function (id) {
            var hunk = null;
            for (var i = 0; i < this._hunks.length; i++) {
                if (this._hunks[i].id === id) { hunk = this._hunks[i]; break; }
            }
            if (!hunk || hunk.status !== 'pending') return;
            hunk.status = 'accepted';
            this._applyDecorations();
            this._updateHunkCounter();
            this._autoFinishIfResolved();
        },

        rejectHunk: function (id) {
            var hunkIdx = -1;
            for (var i = 0; i < this._hunks.length; i++) {
                if (this._hunks[i].id === id) { hunkIdx = i; break; }
            }
            if (hunkIdx < 0) return;
            var hunk = this._hunks[hunkIdx];
            if (hunk.status !== 'pending') return;

            // Replace the new lines in the editor with the old lines
            var doc = this._view.state.doc;
            var newLen = hunk.newEnd - hunk.newStart;
            var startLine = hunk.newStart + 1; // 1-based
            var endLine = hunk.newEnd;

            var from, to;
            if (newLen === 0) {
                // Pure deletion — insert old lines at this position
                from = startLine <= doc.lines ? doc.line(startLine).from : doc.length;
                to = from;
            } else {
                from = doc.line(Math.min(startLine, doc.lines)).from;
                to = doc.line(Math.min(endLine, doc.lines)).to;
            }

            var replacement = hunk.oldLines.join('\n');

            this._view.dispatch({
                changes: { from: from, to: to, insert: replacement }
            });

            hunk.status = 'rejected';

            // Compute line delta and shift subsequent hunk positions
            var oldLineCount = hunk.oldLines.length;
            var delta = oldLineCount - newLen;
            hunk.newEnd = hunk.newStart + oldLineCount;

            for (var j = hunkIdx + 1; j < this._hunks.length; j++) {
                this._hunks[j].newStart += delta;
                this._hunks[j].newEnd += delta;
            }

            this._applyDecorations();
            this._updateHunkCounter();
            this._autoFinishIfResolved();
        },

        acceptAll: function () {
            for (var i = 0; i < this._hunks.length; i++) {
                if (this._hunks[i].status === 'pending') {
                    this._hunks[i].status = 'accepted';
                }
            }
            this._applyDecorations();
            this._updateHunkCounter();
            this._autoFinishIfResolved();
        },

        rejectAll: function () {
            // Process bottom-to-top so position shifts don't affect earlier hunks
            var pending = [];
            for (var i = 0; i < this._hunks.length; i++) {
                if (this._hunks[i].status === 'pending') pending.push(this._hunks[i].id);
            }
            for (var j = pending.length - 1; j >= 0; j--) {
                this.rejectHunk(pending[j]);
            }
            this._autoFinishIfResolved();
        },

        finish: function () {
            var content = this._view ? this._view.state.doc.toString() : null;
            this._destroy();
            if (this._resolve) {
                this._resolve({ accepted: true, content: content });
                this._resolve = null;
            }
        },

        close: function (accepted) {
            var content = null;
            if (accepted && this._view) {
                content = this._view.state.doc.toString();
            }
            this._destroy();
            if (this._resolve) {
                this._resolve({ accepted: !!accepted, content: content });
                this._resolve = null;
            }
        },

        _destroy: function () {
            this._active = false;
            if (this._overviewRaf) {
                cancelAnimationFrame(this._overviewRaf);
                this._overviewRaf = 0;
            }
            this._unbindOverviewEvents();
            if (this._view) { this._view.destroy(); this._view = null; }
            this._hunks = [];
            this._decoField = null;
            this._overviewEl = null;
            this._overviewCanvas = null;
            this._overviewMarkersEl = null;
            this._overviewViewportEl = null;
            var container = document.getElementById('ai-diff-inline');
            if (container) {
                container.classList.remove('visible');
                container.innerHTML = '';
            }
        },

        _esc: function (str) {
            return typeof escHtml === 'function' ? escHtml(str) : String(str || '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },

        buildInlineReviewHtml: function (path, oldContent, newContent) {
            return buildInlineReviewHtml(oldContent, newContent, this._esc.bind(this));
        }
    };

    window.mergeEditor = mergeEditor;
})();
