import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine
} from "@codemirror/view";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  foldCode,
  foldKeymap,
  syntaxTree,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching
} from "@codemirror/language";
import {
  closeBrackets,
  autocompletion,
  closeBracketsKeymap,
  completionKeymap
} from "@codemirror/autocomplete";
import {
  history,
  defaultKeymap,
  historyKeymap
} from "@codemirror/commands";
import { lintGutter, lintKeymap, linter } from "@codemirror/lint";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

const basicSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap
  ])
];

export {
  EditorState,
  EditorView,
  keymap,
  basicSetup,
  searchKeymap,
  foldCode,
  foldKeymap,
  syntaxTree,
  lintGutter,
  lintKeymap,
  linter,
  javascript,
  javascriptLanguage,
  html,
  css,
  python,
  oneDark
};
