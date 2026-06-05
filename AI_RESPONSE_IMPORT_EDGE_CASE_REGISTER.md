# AI Response Import Edge Case Register

Last updated: 2026-02-21

This register tracks known edge cases for the "Apply AI Response" workflow (paste full AI output -> auto update files).

## Status key
- `Handled`: current logic is designed to process this case automatically.
- `Partial`: case is partially handled, but may still require user review.
- `Open`: not currently handled.

## Edge cases
| ID | Edge case | Status | Current behavior |
|---|---|---|---|
| EC-001 | Standard fenced code blocks with language only (for example ` ```html `) | Handled | Extracted; path inferred from project context/defaults. |
| EC-002 | Fenced blocks with explicit filename in fence info | Handled | Filename/path extracted and applied directly. |
| EC-003 | `File: path` section format with separator line | Handled | Parsed into explicit file updates. |
| EC-004 | Heading format (`1. index.html`, `styles.css`, `script.js`) | Handled | Section bodies parsed and mapped by heading file names. |
| EC-005 | AI Studio UI noise lines (`code`, `play_circle`, `content_copy`, etc.) | Handled | Noise lines removed before applying file content. |
| EC-006 | Single-file HTML response embedded in narration (no fences) | Handled | Full HTML extracted via fallback and mapped to HTML target file. |
| EC-007 | Duplicate blocks for same file in one response | Handled | Later block wins; warning logged in modal. |
| EC-008 | Missing file path but detectable language/content | Handled | Path inferred by extension and current project files. |
| EC-009 | Missing target file on disk | Handled | File is created automatically when "Create missing files" is enabled. |
| EC-010 | Nested missing path (`src/app/main.js`) | Handled | Intermediate directories are created via File System Access API. |
| EC-011 | Invalid/unsafe path traversal (`../...`) | Handled | Path rejected; block skipped with warning. |
| EC-012 | Protected internal paths (`.checkpoints/*`, `compiled-hashes.csv`) | Handled | Skipped by guardrail. |
| EC-013 | Response contains no parseable code | Handled | No apply allowed; user gets warning. |
| EC-014 | Mixed update/create batch across many files | Handled | Applied as batch with per-file error reporting. |
| EC-015 | Save immediately disabled | Handled | Content updates editor tabs only; user can save later. |
| EC-016 | Existing file already open under remapped UUID after sync | Handled | Resolver re-matches open tab by relative path before write. |
| EC-017 | Trailing narrative after code block | Partial | Common narrative lines are trimmed; uncommon phrasing may remain. |
| EC-018 | Leading narrative before code block | Partial | Common lead-in phrases are trimmed; rare variants may remain. |
| EC-019 | Path includes uncommon extension not in known extension list | Partial | May not be recognized as file path; inference fallback may still work. |
| EC-020 | Path includes spaces/special formatting markers | Partial | Some formats are normalized; malformed markers may fail extraction. |
| EC-021 | Multiple unnamed JS (or CSS) blocks intended for distinct files | Partial | Blocks are assigned unique inferred paths; mapping may not match author intent. |
| EC-022 | Fences not properly closed | Partial | May fail fenced parsing; heading/single-file fallback may still recover. |
| EC-023 | Large response with both old and corrected versions | Partial | Latest duplicate file wins, but intent disambiguation is heuristic. |
| EC-024 | Non-code prose accidentally interpreted as path heading | Partial | Heuristics reduce false positives but cannot eliminate all. |
| EC-025 | Binary/non-text file outputs (images, PDFs, zip) | Open | Not supported by this importer. |
| EC-026 | Unified diff / patch-only outputs | Handled | Multi-file unified diffs are parsed, mapped to project files, and applied hunk-by-hunk against current file content. |
| EC-027 | File rename/delete intents expressed in prose | Open | Importer only performs create/update writes. |
| EC-028 | Step-by-step patch instructions (`Step A`, `add this line`, `...existing...`) instead of unified diffs | Handled | Import is blocked, warnings explain why, and a copyable retry prompt is shown to request one unified diff. |

## Notes for future hardening
- Add automated fixtures for malformed fences, duplicate versions, and path ambiguity.
- Add optional "strict mode" that applies only explicit path blocks.
- Add visual per-hunk preview for unified diff imports.
