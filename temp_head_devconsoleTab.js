// DevConsole Tab Module
const devConsoleTab = {
    _setSafeContent(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
        el.replaceChildren(frag);
    },
    init() {
        //this.addTabToNav();
        this.addTabContent();
        this.bindEvents();
    },

    addTabToNav() {
        // Add the DevConsole tab to the navigation
        const tabNav = document.querySelector('#myTab');
        const newTabItem = document.createElement('li');
        newTabItem.className = 'nav-item';
        const a = document.createElement('a');
        a.className = 'nav-link';
        a.id = 'devconsole-tab';
        a.setAttribute('data-toggle', 'tab');
        a.setAttribute('href', '#devconsole');
        a.setAttribute('role', 'tab');
        a.textContent = 'DevConsole Tool';
        newTabItem.appendChild(a);
        
        // Insert before the last tab (AI Helper)
        const aiHelperTab = tabNav.querySelector('li:last-child');
        tabNav.insertBefore(newTabItem, aiHelperTab);
    },

    addTabContent() {
        // Add or populate the DevConsole tab content without duplicating the pane
        const tabContent = document.querySelector('#myTabContent');
        if (!tabContent) return;

        // If an element with id "devconsole" already exists (provided by index.html), reuse it.
        let devPane = document.getElementById('devconsole');
        const shouldInsert = !devPane;
        if (!devPane) {
            devPane = document.createElement('div');
            devPane.className = 'tab-pane fade';
            devPane.id = 'devconsole';
            devPane.setAttribute('role', 'tabpanel');
        }

        this._setSafeContent(devPane, `
            <div class="devconsole-container">
                <h3>DevConsole Tool</h3>
                <p class="mb-4">The DevConsole is a powerful debugging and development tool that provides a comprehensive console interface for your web applications, especially useful when developing offline or in restricted environments.</p>
                
                                <div class="status-section mb-4">
                    <h4>📊 Integration Status</h4>
                    <div id="devconsole-status" class="status-indicator">
                        <span class="status-badge" id="status-badge">Checking...</span>
                        <span id="status-message">Checking if DevConsole is already integrated...</span>
                        <button id="refresh-status-btn" class="btn btn-sm btn-outline-secondary ml-2">🔄 Refresh</button>
                    </div>
                </div>

                <div class="actions-section">
                    <h4>🛠️ Integration Options</h4>
                    <div class="btn-group-vertical w-100">
                        <button id="copy-devconsole-btn" class="btn btn-info btn-lg mb-2">
                            📋 Copy DevConsole Code
                        </button>
                        <button id="add-devconsole-btn" class="btn btn-success btn-lg mb-2" disabled>
                            ➕ Add DevConsole to Project
                        </button>
                        <button id="view-devconsole-btn" class="btn btn-secondary btn-lg mb-2" style="display:none;">
                            👀 View Existing DevConsole
                        </button>
                        <button id="update-devconsole-btn" class="btn btn-warning btn-lg mb-2" style="display:none;">
                            🔄 Update DevConsole
                        </button>
                    </div>
                </div>
