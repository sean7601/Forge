/* ===== Forge v2 - App Initialization ===== */

(function () {
    function syncThemeOptions() {
        const current = document.documentElement.getAttribute('data-theme') || 'beach';
        document.querySelectorAll('.theme-option').forEach(el => {
            el.classList.toggle('active', el.dataset.themeOpt === current);
        });
    }

    function runInit() {
        if (window.cspBindings && typeof window.cspBindings.init === 'function') {
            window.cspBindings.init();
        }
        if (typeof initPlanPanels === 'function') {
            initPlanPanels();
        }
        if (typeof aiAgent !== 'undefined' && aiAgent && typeof aiAgent.loadProfiles === 'function') {
            aiAgent.loadProfiles();
        }
        syncThemeOptions();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runInit, { once: true });
    } else {
        runInit();
    }
})();
