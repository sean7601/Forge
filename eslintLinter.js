// Legacy placeholder retained so stale script references fail gracefully.
// eslint4b and ESLint integration were removed in favor of CodeMirror syntax diagnostics.

(function() {
  if (typeof window === 'undefined') {
    return;
  }

  window.eslintRunner = {
    verify() {
      console.warn('eslintRunner.verify called, but ESLint support was removed.');
      return [];
    }
  };
})();
