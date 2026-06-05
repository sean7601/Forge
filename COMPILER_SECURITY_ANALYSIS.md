# Security Analysis: Apps Compiled with `compiler.js`

## Scope

This analysis covers security properties and vulnerabilities of applications compiled through Forge's `compiler.js`, across two deployment modes:

1. **Offline / Direct Hardened Build** — compiled HTML opened from `file://` or served locally
2. **SharePoint Compatibility Build** — compiled HTML deployed via Firepit web part into a SharePoint modern page

The analysis emphasizes exfiltration attack surface, disabled functionality per mode, and residual vulnerabilities that survive compilation.

---

## 1. Compilation Security Architecture Overview

When "Add security headers" is enabled (default), `compiler.js` produces a **two-layer HTML artifact**:

```
┌──────────────────────────────────────────┐
│  Parent Bridge Shell (outer HTML)        │
│  - Minimal UI (gesture panel)            │
│  - Bridge message handler                │
│  - URL/open sanitization logic           │
│  - File picker mediation                 │
│  - Storage proxy                         │
│  - Network permission gating             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Sandboxed <iframe>               │  │
│  │  - App runs here (srcdoc)         │  │
│  │  - CSP meta tags injected         │  │
│  │  - Runtime guards injected        │  │
│  │  - Child bridge bootstrap         │  │
│  │  - Shimmed localStorage/session   │  │
│  │  - Shimmed fetch/XHR/WS/SSE      │  │
│  │  - Shimmed window.open           │  │
│  │  - File picker bridge stubs      │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Without security headers**, the compiled output is a flat single-file HTML with all JS/CSS/images inlined but no CSP, no runtime guards, no bridge shell, and no sandbox isolation.

---

## 2. Security Controls Injected by Compilation

### 2.1 Content Security Policy (Meta Tag)

```
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
worker-src blob:;
connect-src 'none';          ← or allowlisted origins
img-src data: blob:;
font-src 'none';
media-src 'none';
manifest-src 'none';
form-action 'none';
frame-src 'none';
object-src 'none';
```

#### What this blocks
| Resource Type | Blocked | Exception |
|---|---|---|
| External script loading | Yes | Inline scripts allowed via `'unsafe-inline'` |
| External stylesheet loading | Yes | Inline styles allowed |
| Fetch / XHR / WebSocket / SSE | Yes | Unless origin is in `connect-src` allowlist |
| Embedded iframes | Yes | `frame-src 'none'` |
| Plugins (Flash, Java, PDF) | Yes | `object-src 'none'` |
| Form submissions | Yes | `form-action 'none'` + runtime guard |
| Font loading | Yes | `font-src 'none'` |
| Media loading (audio/video) | Yes | `media-src 'none'` |
| Manifest fetching | Yes | `manifest-src 'none'` |
| Image loading from network | Yes | `data:` and `blob:` allowed for inline images |
| Worker creation | Partial | `blob:` workers allowed (needed for app functionality) |

### 2.2 Additional Security Meta Tags

| Header | Value | Purpose |
|---|---|---|
| `x-dns-prefetch-control` | `off` | Prevents DNS prefetch leakage |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter (browsers that support it) |
| `Referrer-Policy` | `no-referrer` | No referrer leakage on navigation |
| `Permissions-Policy` | camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), ambient-light-sensor=(), autoplay=(), encrypted-media=(), fullscreen=(), picture-in-picture=(), screen-wake-lock=() | Disables hardware/sensor APIs |

### 2.3 Runtime Guards (Injected Scripts)

#### Link Hint Guard
- Strips `<link rel="prefetch|prerender|dns-prefetch|preconnect|modulepreload">` elements
- Only allows safe rel values: `stylesheet`, `icon`, `canonical`, `license`, `help`, `author`, `search`, `alternate`
- Uses MutationObserver to catch dynamically injected link hints

#### Query Parameter Guard
- Strips `?query` and `#hash` from navigation URLs
- Allows query params only on `mailto:` links (restricted to `subject`, `body`, `cc`, `bcc`)
- In SharePoint mode, allows query-bearing URLs only for the configured SharePoint site path
- Sanitizes `location.href`, `location.assign()`, `location.replace()`, `history.pushState()`, `history.replaceState()`
- Intercepts anchor clicks and form submissions
- Blocks `<base href>` injection
- Neutralizes `<meta http-equiv="refresh">` redirects
- Sanitizes `<iframe src>`, `<embed src>`, `<object data>`, `<iframe srcdoc>`
- Uses MutationObserver for dynamic attribute changes

### 2.4 Isolated Bridge Shell

#### Sandbox Attribute

| Mode | Sandbox Permissions |
|---|---|
| **Direct hardened** | `allow-scripts allow-forms allow-modals allow-downloads` |
| **SharePoint compat** | `allow-scripts allow-forms allow-modals allow-downloads allow-same-origin allow-popups allow-popups-to-escape-sandbox` |

#### Bridge-Mediated Actions
The child iframe cannot directly perform these; it must request them through the parent bridge via `postMessage`:

| Bridge Action | What It Does | Gating |
|---|---|---|
| `open_url` | Opens external URLs | URL sanitization + scheme blocking + hostname label length check |
| `show_open_file_picker` | File selection dialog | User gesture required |
| `show_save_file_picker` | File save dialog | User gesture required |
| `show_directory_picker` | Directory selection dialog | User gesture required |
| `clipboard_write_text` | Write to clipboard | Bridge proxy |
| `proxy_fetch` | SharePoint fetch proxy | Origin allowlist enforcement |
| `request_network_permission` | API permission prompt | User confirmation required |
| `storage_mutate` | localStorage/sessionStorage ops | Scope-limited proxy |
| `get_sharepoint_context` | SharePoint page context | Read-only |

### 2.5 Network API Shimming

Inside the sandboxed child, the following APIs are replaced with guarded versions:

| API | Guard Behavior |
|---|---|
| `window.fetch()` | Checks `getNetworkUrlPolicy()` → blocks if origin not allowlisted → prompts user for permission on first use → proxies through parent in SharePoint mode |
| `XMLHttpRequest.open/send` | Same origin check, blocks non-allowlisted, permission prompt |
| `new WebSocket()` | Blocks if origin not allowlisted, requires pre-granted permission |
| `new EventSource()` | Same as WebSocket |
| `navigator.sendBeacon()` | Blocks with warning if not allowlisted |
| `window.open()` | Routed through bridge `sanitizeAndOpen` → URL analysis → scheme/hostname validation |

---

## 3. Functionality Disabled Per Mode

### 3.1 Functionality Disabled in All Hardened Builds (Offline + SharePoint)

| Functionality | Reason | Workaround |
|---|---|---|
| External script/stylesheet loading | `default-src 'none'`; all assets must be inlined at compile time | Compile with "Inline CDN" enabled |
| External font loading | `font-src 'none'` | Inline fonts as base64 data URIs before compile |
| Audio/video from network | `media-src 'none'` | Inline media as data URIs or remove |
| Plugin content (Flash, ActiveX, Java, PDF embeds) | `object-src 'none'` | Not available; use alternative implementations |
| Nested iframes to external sites | `frame-src 'none'` | Not available in hardened mode |
| Web manifest loading | `manifest-src 'none'` | Not available |
| Geolocation API | `Permissions-Policy: geolocation=()` | Disable security headers or remove usage |
| Camera / Microphone | `Permissions-Policy: camera=(), microphone=()` | Disable security headers |
| USB / Bluetooth / Serial / HID | `Permissions-Policy: usb=()` etc. | Disable security headers |
| Payment Request API | `Permissions-Policy: payment=()` | Not available |
| DNS prefetching | `x-dns-prefetch-control: off` + link hint guard | Not available |
| `eval()` / `new Function()` | CSP `script-src 'unsafe-inline'` does not include `'unsafe-eval'` | Refactor code to avoid dynamic evaluation |
| `document.write()` | Blocked by CSP in most browsers | Use DOM APIs instead |
| GET form submissions | Runtime guard blocks GET forms | Use POST or refactor to JS-driven submission |
| Meta refresh redirects | Runtime guard neutralizes `<meta http-equiv="refresh">` | Use JS-based navigation (also guarded) |
| `<base href>` element | Runtime guard strips base href | Use explicit relative paths |
| Direct `location.href` navigation to external sites | Guard sanitizes to current document URL + offers manual copy | Use bridge `open_url` action |
| Referrer headers | `Referrer-Policy: no-referrer` strips all referrer data | Not configurable |

### 3.2 Additional Restrictions in Offline (Direct Hardened) Mode

| Functionality | Reason |
|---|---|
| `allow-same-origin` sandbox flag | **Not set** — the iframe has an opaque origin, meaning `document.cookie`, native `localStorage`, `sessionStorage`, and `indexedDB` are inaccessible without the bridge shim |
| Popup windows | `allow-popups` **not set** — `window.open` calls go through bridge but the sandbox blocks actual popup creation |
| Same-origin API access | No same-origin capability since the iframe origin is opaque |

### 3.3 Additional Capabilities in SharePoint Compatibility Mode

| Functionality | Why Enabled | Security Implication |
|---|---|---|
| `allow-same-origin` | Required for SharePoint API calls with ambient credentials | App can access same-origin cookies, storage, and SharePoint REST API |
| `allow-popups` | Required for navigation to SharePoint pages | Popup-based exfiltration vectors become available |
| `allow-popups-to-escape-sandbox` | Required for popups to function outside sandbox restrictions | Opened popups run without sandbox constraints |
| SharePoint origin in `connect-src` | Required for SharePoint REST/CSOM API calls | Ambient credential forwarding to SharePoint endpoints |
| `'self'` in `connect-src` | Required for same-origin resource loading | Broader network access within site origin |
| Parent proxy fetch | Proxies SharePoint API requests through unsandboxed parent | Full authenticated SharePoint API access through the proxy |
| Inline event handler rewriting | Converts `onclick` etc. to `data-forge-onclick` + addEventListener bootstrap | Uses `new Function()` at runtime to compile handler code |

---

## 4. Vulnerability Enumeration

### VULN-01: `script-src 'unsafe-inline'` Permits DOM-Based XSS

**Severity**: HIGH  
**Modes affected**: All hardened builds  
**Category**: Code Injection / XSS

**Description**: The CSP uses `script-src 'unsafe-inline'` to allow the app's own inline scripts to execute. This means any DOM-XSS vulnerability in the app's source code — such as unsanitized user input flowing into `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write` — can execute arbitrary JavaScript within the sandboxed context.

**Why it exists**: Hash-based or nonce-based `script-src` enforcement is not feasible because the compiler produces inline scripts whose content varies per build, and the app's own inline scripts would need to be enumerated at compile time, which is not currently implemented.

**Impact**: An attacker who can inject markup containing `<script>` or `<img onerror=...>` into a DOM sink gains full JavaScript execution within the app's security context. From there, they can access all data in memory and attempt exfiltration through any residual channel.

**Mitigations available**:
- DOMPurify is bundled (`domPurify.js`) but **not automatically injected** — app developers must explicitly call `DOMPurify.sanitize()` on untrusted content
- The security reviewer (`securityReviewer.js`) SAST scan detects unsafe sink usage (`innerHTML`, `outerHTML`, etc.)
- SharePoint inline event handler rewriting converts handler attributes to `addEventListener` calls

**Recommendation**: Consider auto-injecting a DOMPurify wrapper around common unsafe sinks at compile time, or at minimum emit a compile-time warning when unsafe sinks are detected in source.

---

### VULN-02: Allowlisted API Origin Exfiltration

**Severity**: HIGH  
**Modes affected**: Any build with `connect-src` allowlist entries  
**Category**: Data Exfiltration

**Description**: When the developer configures API allowlist entries (e.g., Ask Sage / CAPRA at `api.capra.flankspeed.us.navy.mil`, GenAI.mil at `api.genai.mil`, or custom origins), the compiled app can make unrestricted `fetch`, `XHR`, `WebSocket`, `EventSource`, and `sendBeacon` calls to those origins after the user grants the one-time network permission prompt.

**Attack scenario**: A compromised dependency or DOM-XSS payload reads all in-memory data (e.g., personnel records loaded from CSV) and POSTs the full dataset to an allowlisted API endpoint. If the attacker controls or can read from that endpoint (e.g., through a shared AI chat interface), the data is exfiltrated.

**Why it exists**: API connectivity is a legitimate feature requirement. The permission prompt provides a single gate, but once approved it applies to all allowlisted origins for the session.

**Residual risk factors**:
- The user prompt shows allowed origins but doesn't differentiate between types of requests
- Once granted, permission covers all verbs, paths, and payload sizes
- No per-request content inspection or data loss prevention
- Wildcard patterns (e.g., `https://*.example.mil`) widen the attack surface

**Recommendation**: Consider request-level logging visible to the user, payload size warnings, or a more granular permission model for sensitive data contexts.

---

### VULN-03: SharePoint Same-Origin Write Abuse

**Severity**: HIGH  
**Modes affected**: SharePoint compatibility mode  
**Category**: Data Exfiltration

**Description**: In SharePoint compatibility mode, the sandbox includes `allow-same-origin`, and the parent bridge's `proxy_fetch` action forwards requests to the SharePoint origin with the user's ambient credentials. A compromised script can silently write data to any SharePoint location the victim has write access to — list items, document libraries, draft pages, or any REST-accessible endpoint.

**Attack scenario**: The app loads personnel readiness data. A malicious script extracts records marked "non-deployable" and uses the SharePoint REST API to create a new list item or upload a file to a document library that the attacker can later access through their own SharePoint permissions.

**Why it exists**: SharePoint API access with ambient credentials is required for legitimate SharePoint-connected app functionality.

**Amplifying factors**:
- The `proxy_fetch` bridge action validates only that the origin matches the allowlisted SharePoint origin — it does not restrict paths, methods, or payload content
- No audit trail visible to the user for proxy-fetched requests
- SharePoint's permission model means the victim's existing access determines what can be written
- Write operations to SharePoint lists/libraries may not produce any visible indication to the user

**Recommendation**: Consider restricting `proxy_fetch` to read-only methods (GET, HEAD) by default, with an explicit opt-in for write methods. Log proxy requests in the gesture panel or a visible status area.

---

### VULN-04: `mailto:` Protocol Exfiltration

**Severity**: MEDIUM  
**Modes affected**: All hardened builds  
**Category**: Data Exfiltration (Human-Mediated)

**Description**: The URL sanitization guards intentionally preserve `mailto:` links with `subject`, `body`, `cc`, and `bcc` parameters. A malicious script can construct a `mailto:` URL containing sensitive data in the body field and trigger the user's mail client to open a compose window with pre-populated content.

**Attack scenario**: The app presents an "Email Report" button. Malicious code injects additional personnel data into the email body alongside the expected summary. The user sends the email without noticing the extra content, and the data leaves through the mail system.

**Bandwidth**: Limited by URL length constraints (~2KB in most mail handlers), but sufficient for small targeted extractions (EDIPIs, clearance status, unit codes).

**Why it exists**: Email workflow integration is a legitimate feature. Stripping `subject`/`body` would break expected functionality.

**Recommendation**: Display the full `mailto:` URL content to the user in the gesture panel before opening the mail client, allowing review of embedded data.

---

### VULN-05: Hostname Label Exfiltration via Navigation

**Severity**: MEDIUM  
**Modes affected**: All hardened builds  
**Category**: Data Exfiltration (Low Bandwidth)

**Description**: The URL sanitization strips path, query, and hash from navigation URLs, but preserves the hostname. An attacker can encode a small data payload into subdomain labels of a controlled domain (e.g., `https://e1234567890-uicABC.attacker.example/`). The DNS lookup and HTTP request to this hostname leak the encoded data through DNS infrastructure or server logs.

**Mitigation present**: The guard enforces a 20-character maximum per hostname label, limiting payload capacity:
```javascript
if (!host || !host.split(".").every((label) => label && label.length <= 20))
```

**Residual capacity**: With multiple labels of up to 20 characters each, an attacker could still encode a short identifier (EDIPI + unit code ≈ 30-40 chars across 2-3 labels). This is enough for targeted individual identification but not bulk export.

**Recommendation**: Consider reducing the label length limit or requiring hostname allowlisting for `open_url` navigation.

---

### VULN-06: `window.name` / Target Channel

**Severity**: MEDIUM  
**Modes affected**: All bridge-mode builds  
**Category**: Data Exfiltration (Low Bandwidth)

**Description**: The bridge's `open_url` handler sanitizes the URL but passes the `target` parameter to `window.open()` without full sanitization. A malicious script can encode data in the target window name, and a receiving page can read `window.name` to recover the payload.

**Attack prerequisites**:
- Script execution within the app
- Popup/navigation must succeed (blocked in direct hardened mode without `allow-popups`, but available in SharePoint compat mode)
- Attacker needs a landing page that reads `window.name`

**Red-team validation**: The red-team harness (`forge-security-redteam-harness/app.js`) includes a probe for this vector (`tamper-open-url-target-windowname`), confirming it is a known and tested channel.

**Recommendation**: Sanitize the `target` parameter in the `open_url` bridge action to only allow `_blank`, `_self`, `_parent`, `_top`.

---

### VULN-07: User-Approved File Picker Abuse

**Severity**: HIGH  
**Modes affected**: All bridge-mode builds  
**Category**: Data Access + Staging

**Description**: The bridge exposes `showOpenFilePicker`, `showSaveFilePicker`, and `showDirectoryPicker` to the sandboxed app, gated by user gesture. A socially engineered prompt (e.g., "Re-select your personnel export folder to refresh data") could trick the user into granting broad file or directory access. The malicious script then reads far more content than the user intended.

**Chain requirement**: File access alone is not exfiltration — the attacker still needs a second channel (allowlisted API, `mailto:`, download staging, or SharePoint write) to move the data off-host.

**Why it exists**: File picker access is essential for offline data processing apps.

**Recommendation**: Consider limiting `showDirectoryPicker` scope, displaying the number of files accessed in the gesture panel, or warning when large numbers of files are read through the bridge.

---

### VULN-08: Download-Based Data Staging

**Severity**: MEDIUM  
**Modes affected**: All hardened builds  
**Category**: Data Exfiltration (Human-Mediated)

**Description**: The sandbox includes `allow-downloads`, and the runtime allows `blob:` and `data:` download links. A malicious script can create a convincing-looking export file (e.g., `readiness-summary.csv`) that actually contains more data than the user expects, such as all loaded personnel records rather than just the displayed summary.

**Chain requirement**: The staged file still needs to leave the host through human action — the user saves it, uploads it to SharePoint, emails it, or copies it to removable media.

**Why it exists**: Generating downloadable reports and exports is core functionality for offline tools.

**Recommendation**: No practical compile-time mitigation; this is inherent to file download capability. Consider app-level data classification labels in exports.

---

### VULN-09: Compiled Artifact Source Disclosure

**Severity**: HIGH  
**Modes affected**: All compiled builds  
**Category**: Information Disclosure

**Description**: The compiled HTML artifact contains all source code, embedded assets, and the build manifest as a base64-encoded `CHILD_HTML_B64` constant. The repo includes a decompiler (`decompiler.js`) that can reverse the compilation. Anyone with access to the compiled file can extract:
- Full application source code
- Embedded example/test data (if included in source)
- Hardcoded API keys, tokens, or endpoint URLs
- Business logic revealing how sensitive data is categorized
- Internal domain names and infrastructure details

**Why it exists**: Single-file HTML compilation inherently bundles everything. The manifest and base64 encoding are not obfuscation — they are packaging.

**Impact**: If a compiled artifact containing real data, credentials, or sensitive business rules is shared beyond the intended trust boundary, all embedded content is trivially recoverable.

**Recommendation**: 
- Emit a compile-time warning if patterns matching secrets (API keys, tokens, passwords) are detected in the source
- The SAST scan in `securityReviewer.js` already detects hardcoded secrets — consider integrating this as a pre-compile gate
- Document that compiled artifacts should be treated with the same classification as their embedded data

---

### VULN-10: `new Function()` in SharePoint Inline Event Rewriting

**Severity**: MEDIUM  
**Modes affected**: SharePoint compatibility mode  
**Category**: Code Injection

**Description**: The SharePoint inline event handler bootstrap script uses `new Function("event", code)` to compile handler code from `data-forge-onclick` (and similar) attributes at runtime. If an attacker can inject or modify a `data-forge-on*` attribute on a DOM element, they achieve arbitrary code execution.

**Relevant code** (in `buildSharePointInlineEventListenerBootstrapScript()`):
```javascript
const compiled = new Function("event", String(code || ""));
```

**Attack prerequisite**: The attacker must be able to inject or mutate `data-forge-on*` attributes on DOM elements. This requires either:
- A DOM-XSS vulnerability that can set attributes (not just inject text)
- Server-side HTML injection in the SharePoint page context

**Mitigating factor**: If the attacker can already set arbitrary attributes via DOM-XSS, they likely have other code execution paths available. However, `new Function()` provides a clean escalation path even if the XSS vector is attribute-only.

**Recommendation**: Consider using a handler registry with string-to-function lookup table instead of dynamic `new Function()` compilation. The `csp-bindings.js` approach of pre-parsing common statement patterns is safer.

---

### VULN-11: Bridge Token Predictability

**Severity**: LOW  
**Modes affected**: All bridge-mode builds  
**Category**: Bridge Integrity

**Description**: The bridge token is generated as:
```javascript
const bridgeToken = `forge-bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
```

`Date.now()` is predictable (millisecond timestamp), and `Math.random()` is not cryptographically secure. In theory, an attacker who can observe the compilation timestamp could narrow the token search space.

**Mitigating factors**: 
- The token is embedded inside the compiled artifact (both parent and child), so an external attacker would need to already have the artifact
- The bridge only accepts messages from `frame.contentWindow`, providing origin-level binding
- `Math.random()` state is per-origin and not observable from outside

**Practical impact**: Negligible in current usage since the token is embedded in both sides of the same artifact.

**Recommendation**: Use `crypto.getRandomValues()` for the random component for defense-in-depth alignment. The codebase already uses `crypto.randomUUID()` elsewhere (in `randomGuid()`).

---

### VULN-12: `allow-popups-to-escape-sandbox` in SharePoint Mode

**Severity**: MEDIUM  
**Modes affected**: SharePoint compatibility mode  
**Category**: Sandbox Escape

**Description**: SharePoint compatibility mode includes `allow-popups-to-escape-sandbox` on the iframe. This means any popup window opened from the sandboxed app runs **without sandbox restrictions**. Combined with `allow-same-origin`, a script that can trigger `window.open()` and navigate the popup to attacker-controlled content effectively escapes all sandbox constraints for that popup context.

**Why it exists**: SharePoint navigation flows require popups to function as normal windows for user workflow continuity.

**Mitigating factor**: The bridge's `open_url` handler sanitizes URLs before opening. However, if a DOM-XSS vulnerability has already replaced or bypassed the `window.open` shim, the popup would inherit the full parent origin context without sandbox restrictions.

**Recommendation**: Document this as a known trust expansion in SharePoint mode. Consider wrapping `open_url` with additional confirmation when navigating to non-SharePoint origins.

---

### VULN-13: No `unsafe-eval` Block Enforcement at CSP Level

**Severity**: LOW  
**Modes affected**: All hardened builds  
**Category**: Defense Gap

**Description**: The CSP does not explicitly include `'unsafe-eval'` in `script-src`, which means `eval()` and `new Function()` are blocked by default. This is good. However, the SharePoint inline event bootstrap (VULN-10) relies on `new Function()`, creating a tension: either the app works with inline events in SharePoint mode or `eval`-family calls are blocked.

**Current behavior**: In the parent shell (non-sandboxed), `new Function()` is available. In the sandboxed child, `new Function()` is blocked by CSP unless `'unsafe-eval'` is added. The inline event bootstrap runs in the child's context.

**Analysis**: The bootstrap script is injected into the child HTML **before** it enters the sandbox. The CSP meta tag in the child blocks `'unsafe-eval'`. This means the SharePoint inline event bootstrap's `new Function("event", code)` will fail silently in practice under the current CSP, falling back to the `try/catch` around the handler attachment.

**Recommendation**: Verify that the SharePoint inline event handler rewriting functions correctly under the injected CSP, or document the expected behavior when `new Function()` is blocked.

---

### VULN-14: `postMessage` Origin Wildcard

**Severity**: LOW  
**Modes affected**: All bridge-mode builds  
**Category**: Bridge Integrity

**Description**: Both the parent and child sides of the bridge use `"*"` as the `targetOrigin` in `postMessage()`:
```javascript
parent.postMessage({ [BRIDGE_NS]: true, token: BRIDGE_TOKEN, ... }, "*");
// and
targetWindow.postMessage({ __forgeBridgeResp: true, ... }, "*");
```

**Why it exists**: In direct hardened mode, the sandboxed iframe has an opaque origin (`null`), so specifying a `targetOrigin` other than `"*"` would cause message delivery to fail.

**Mitigating factors**:
- The bridge token must match on both sides
- The parent only accepts messages from `frame.contentWindow`
- The child only accepts messages with the matching response namespace and token
- In practice, no other window should have the bridge token

**Recommendation**: In SharePoint compatibility mode (where `allow-same-origin` is set and the child has a real origin), the `targetOrigin` could be set to the known SharePoint origin instead of `"*"` for defense-in-depth.

---

### VULN-15: Blob Worker Exfiltration Channel

**Severity**: LOW  
**Modes affected**: All hardened builds  
**Category**: Data Exfiltration (Speculative)

**Description**: The CSP includes `worker-src blob:`, allowing the app to create Web Workers from blob URLs. A worker runs in a separate execution context. While the worker inherits the CSP and cannot make network requests to non-allowlisted origins, it could potentially be used as a covert computation channel for encoding data that is then exfiltrated through a primary channel.

**Mitigating factors**: The worker cannot bypass `connect-src` restrictions on its own. It would need to pass processed data back to the main thread, which is still subject to the same exfiltration constraints.

**Practical impact**: Negligible incremental risk over direct main-thread exfiltration.

---

## 5. Exfiltration Attack Surface Summary

### 5.1 Direct Hardened Build (Offline)

| Channel | Status | Bandwidth | User Interaction Required | Notes |
|---|---|---|---|---|
| Allowlisted fetch/XHR | Open (if allowlisted) | High | One-time permission prompt | Primary high-bandwidth exfil path |
| mailto: | Open | Low (~2KB) | User must send email | Body/subject field data embedding |
| Hostname label encoding | Open | Very Low (~60 chars) | None if popup succeeds | Subdomain label data encoding |
| window.name | Blocked | N/A | N/A | No `allow-popups` in direct mode |
| Download staging | Open | High | User saves file | Requires second step to leave host |
| File picker read | Open | High | User approves picker | Requires second exfil channel |
| Clipboard write | Open | Medium | None (bridge proxy) | User must paste elsewhere |
| DNS prefetch | Blocked | N/A | N/A | Link hint guard + CSP |
| CSS url() exfil | Blocked | N/A | N/A | `font-src: 'none'`, `img-src: data: blob:` |
| Anchor ping | Blocked | N/A | N/A | CSP connect-src |
| Form action | Blocked | N/A | N/A | `form-action 'none'` + runtime guard |
| iframe/embed/object | Blocked | N/A | N/A | `frame-src 'none'`, `object-src 'none'` |
| WebSocket/SSE/sendBeacon | Blocked (unless allowlisted) | N/A | N/A | connect-src enforcement |
| Import/module loading | Blocked | N/A | N/A | `default-src 'none'` |

### 5.2 SharePoint Compatibility Build

All channels from 5.1 apply, plus:

| Channel | Status | Bandwidth | User Interaction Required | Notes |
|---|---|---|---|---|
| SharePoint REST API write | Open | High | None | Ambient credentials via proxy_fetch |
| SharePoint list/library write | Open | High | None | Via REST API |
| Popup to attacker page | Open | Medium | Popup must succeed | `allow-popups-to-escape-sandbox` |
| window.name channel | Open | Low | Popup must succeed | `allow-popups` enabled |
| Same-origin storage | Open | N/A | None | `allow-same-origin` gives cookie/storage access |

---

## 6. Attack Chain Analysis

### Chain 1: Supply Chain → Allowlisted API Exfil (Offline)
```
1. Compromised npm package or CDN library inlined at compile time
2. Malicious code activates when user loads sensitive data
3. Waits for user to approve network permission prompt
4. Serializes in-memory dataset to JSON
5. POSTs to allowlisted API origin
```
**Likelihood**: Medium (requires compromised dependency + allowlisted API)  
**Impact**: Full dataset exfiltration  
**Blocked by**: No allowlist entries → fully blocked. With allowlist → unblocked after user approval.

### Chain 2: DOM-XSS → SharePoint Sink (SharePoint Mode)
```
1. User-controlled input reaches innerHTML (e.g., CSV column rendered as HTML)
2. Injected script reads all loaded personnel data
3. Uses proxy_fetch bridge to write data to attacker-readable SharePoint location
4. No network permission prompt needed (SharePoint origin is pre-allowlisted)
5. Attacker retrieves data later through their own SharePoint access
```
**Likelihood**: Medium-High (common XSS patterns + SharePoint write access)  
**Impact**: Full dataset exfiltration through trusted infrastructure  
**Blocked by**: DOMPurify usage on all unsafe sinks (developer responsibility)

### Chain 3: Social Engineering → File Picker → Download Staging
```
1. App displays convincing prompt: "Select personnel export folder to refresh quarterly data"
2. User grants directory access through file picker
3. Malicious script reads all files in directory (rosters, counseling records, etc.)
4. Creates download: "Q1-Readiness-Summary.xlsx" containing all read data
5. User saves file, later uploads to SharePoint or attaches to email
```
**Likelihood**: Medium (requires social engineering + user completing transfer)  
**Impact**: Broad file access beyond intended scope  
**Blocked by**: User vigilance on picker prompts + institutional policy on file handling

### Chain 4: Artifact Disclosure → Intelligence Gathering
```
1. Compiled HTML shared on Teams/Campfire/email for distribution
2. Recipient (or interceptor) decompiles with decompiler.js
3. Extracts hardcoded API endpoints, internal domain names, business logic
4. Uses extracted intelligence for targeted attacks on infrastructure
```
**Likelihood**: High (compiled artifacts are routinely shared)  
**Impact**: Information disclosure enabling further attacks  
**Blocked by**: Compile-time secret scanning (partial — SAST scan available but not mandatory)

---

## 7. Security Controls Comparison: Modes

| Security Control | No Headers | Direct Hardened | SharePoint Compat |
|---|---|---|---|
| CSP meta tag | None | Full restrictive | Full + SharePoint allowlist |
| Runtime URL guards | None | Full | Full |
| Link hint guard | None | Full | Full |
| Query param guard | None | Full | Full + SharePoint path exception |
| Iframe sandbox | None | Strict (no same-origin, no popups) | Permissive (same-origin + popups) |
| Bridge isolation | None | Full | Full |
| Network permission prompt | None | Yes (if allowlist exists) | Yes (but SharePoint calls bypass) |
| Inline event rewriting | None | None | Full (data-forge-on* + bootstrap) |
| File picker gesture gating | None | Yes | Yes |
| Storage isolation | Native browser | Bridge-shimmed localStorage/sessionStorage | Bridge-shimmed + native available |
| CDN inlining | Optional | Recommended | Recommended |
| SHA-256 hash logging | Always | Always | Always |
| Manifest embedding | Always | Always | Always |

---

## 8. Recommendations

### Critical
1. **Auto-inject DOMPurify sanitization** or at least emit a compile-time hard warning when `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write` are detected in source without corresponding `DOMPurify.sanitize()` calls
2. **Restrict `proxy_fetch` write methods** in SharePoint mode — require explicit opt-in for POST/PUT/PATCH/DELETE through the proxy

### High
3. **Sanitize `window.open` target parameter** in the `open_url` bridge action — restrict to `_blank`, `_self`, `_parent`, `_top`
4. **Integrate SAST secret scanning as a pre-compile gate** — block compilation if hardcoded API keys/tokens are detected, with an override option
5. **Use `crypto.getRandomValues()`** for bridge token generation instead of `Math.random()`

### Medium
6. **Add proxy request logging** visible to the user in SharePoint mode — show a brief indicator when `proxy_fetch` is used and what method/path was called
7. **Display full `mailto:` content** in the gesture panel before opening the mail client
8. **Consider hostname allowlisting** for `open_url` navigation in the bridge to reduce hostname label exfiltration bandwidth

### Low
9. **Set specific `targetOrigin`** in postMessage when in SharePoint compatibility mode (where the child origin is known)
10. **Document the `allow-popups-to-escape-sandbox`** trust expansion clearly in the post-compile report so deployers understand the SharePoint mode risk surface
11. **Consider compile-time data classification tagging** to mark compiled artifacts with sensitivity levels matching their embedded content

---

## 9. Positive Security Findings

The compiler implements a mature defense-in-depth security model that substantially reduces the attack surface of browser-based apps:

1. **Default-deny CSP** is the correct baseline — `default-src 'none'` with explicit allowances only where needed
2. **Runtime guards with MutationObserver** catch dynamically injected risky elements, not just static content
3. **Bridge isolation pattern** correctly separates the app execution context from sensitive host APIs
4. **User gesture gating** on file pickers and network permissions adds meaningful friction
5. **158+ red-team probe vectors** in the harness demonstrate systematic security validation
6. **SHA-256 hash logging** provides artifact integrity verification
7. **Manifest embedding** enables decompilation auditing and supply chain transparency
8. **Pre-compile compatibility checking** with actionable remediation guidance reduces developer friction
9. **STIG compliance tooling** integration provides formal RMF documentation pathway
10. **SBOM generation** with CycloneDX export supports supply chain risk management

The overall architecture correctly recognizes that `compiler.js` is an **egress-reduction layer**, not a code-execution prevention layer, and the threat model documentation (`EXFILTRATION_THREAT_MATRIX.md`) clearly communicates this boundary.
