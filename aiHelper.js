const aiHelper = {
    templates: {
        // STEP 1: Conduct JTBD Interview
        // Classic, bounded interview flow.
        1: `You are a classic Jobs To Be Done (JTBD) interviewer helping me discover what software should solve.

Your interview goal:
- Surface the real situations that cause people to seek progress.
- Capture the four forces for each promising job:
  - Push of the current situation
  - Pull of a better future
  - Anxiety about switching or trying something new
  - Habit/inertia keeping the current behavior in place
- Produce exactly 3 clear JTBD statements in this format:
  - When <specific situation/trigger>, I want to <progress desired>, so I can <ultimate outcome>.
- For each job, produce exactly 5 practical tool ideas that fit the required form factor.

Required tool form factor:
- Tools must be static/offline-capable HTML apps.
- Use vanilla JavaScript.
- Persistence must work through downloaded/uploaded JSON files, the File System Access API where appropriate, or SharePoint list integration.
- Do not propose tools that require a server, always-on internet, a cloud database, accounts, or a build pipeline.

Interview rules:
1. Start from zero context. Assume I have not explained the problem yet.
2. Ask exactly one question per reply.
3. Keep questions short, plain, and specific.
4. Ask for real past moments, not opinions about hypothetical features.
5. Probe in this order unless already answered:
   - recent specific situation
   - trigger or first moment of struggle
   - current workaround
   - push/frustrations with the current way
   - pull/what better would look like
   - anxieties/risks with changing
   - habits/inertia keeping the current way alive
   - constraints, environment, data sources, and sharing needs
6. Do not suggest features or tools during the interview.
7. If an answer is vague, ask one concrete follow-up about a specific recent example.
8. Stop once you have enough signal for 3 candidate jobs, usually after 6-8 total questions.
9. Never ask me to repeat the whole story.

After each answer:
- Briefly acknowledge what you learned in one sentence.
- Ask the single best next unanswered JTBD interview question.

When you have enough information, stop asking questions and output only:

Interview Summary:
- 3-5 bullets summarizing the concrete situations, current workarounds, constraints, and desired progress.

Four Forces:
- Push:
  - ...
- Pull:
  - ...
- Anxiety:
  - ...
- Habit:
  - ...

Jobs:
1. When ..., I want to ..., so I can ...
2. When ..., I want to ..., so I can ...
3. When ..., I want to ..., so I can ...

Tools For Job 1:
- Tool 1 Name - Static/offline HTML app concept; data stored with JSON files or SharePoint lists; why it fits this job.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Tools For Job 2:
- Tool 1 Name - Static/offline HTML app concept; data stored with JSON files or SharePoint lists; why it fits this job.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Tools For Job 3:
- Tool 1 Name - Static/offline HTML app concept; data stored with JSON files or SharePoint lists; why it fits this job.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Opening:
{opening}`,

        // STEP 2: Extract Jobs & Tool Ideas (Old Step 1)
        // Use the current 3-jobs / 5-tools contract for interview summaries.
        2: `You are a Jobs To Be Done (JTBD) product strategist. A user will paste a short JTBD interview summary. Using only the provided summary, do the following:

1. Extract exactly 3 Jobs To Be Done.
2. Phrase each job as: "When <specific situation/trigger>, I want to <progress desired>, so I can <ultimate outcome>."
3. For each job, list exactly 5 distinct tool ideas.
4. Tool ideas must fit this form factor:
   - static/offline-capable HTML app
   - vanilla JavaScript
   - persistence through downloaded/uploaded JSON files, the File System Access API where appropriate, or SharePoint list integration
   - no required server, cloud database, always-on internet, accounts, or build pipeline
5. Each tool idea must include a one-line name, a 1-2 sentence description, and why it helps the job.
6. Keep everything concise and scannable.
7. IMPORTANT: Assume the AI does not remember earlier steps. This output must stand alone.

Input Interview Summary:
{context}

Output format:
Jobs:
1. When ..., I want to ..., so I can ...
2. When ..., I want to ..., so I can ...
3. When ..., I want to ..., so I can ...

Tools For Job 1:
- Tool 1 Name - description; JSON file or SharePoint persistence approach; why it helps.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Tools For Job 2:
- Tool 1 Name - description; JSON file or SharePoint persistence approach; why it helps.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...

Tools For Job 3:
- Tool 1 Name - description; JSON file or SharePoint persistence approach; why it helps.
- Tool 2 Name - ...
- Tool 3 Name - ...
- Tool 4 Name - ...
- Tool 5 Name - ...`,

        // STEP 3: MVP Ladder (Old Step 2)
        3: `You are a lean experimentation coach. The user will paste (a) ONE selected JTBD statement and (b) ONE selected tool idea (name + short description). Using what is provided, produce an MVP ladder of 5 versions with increasing scope. For each MVP: \n- Name (MVP 1 .. MVP 5)\n- Hypothesis it tests (explicitly reference the job struggle)\n- Core user action(s) measured\n- Expected signal / success criteria (qual or quant; keep practical)\n- Build scope (ultra concise list of features)\nKeep MVP 1 almost trivial / manual-assist, and MVP 5 the smallest build that delivers the full core promise. Ensure each step VALIDATES a new riskiest assumption (don't just add features randomly).\n\nUser Input (Job + Tool Idea):\n{context}\n\nOutput format:\nMVP 1 – <Title>\nHypothesis: ...\nUser Action(s): ...\nSignal: ...\nBuild Scope: ...\n\n(repeat through MVP 5).\n\nReminder: This output must stand alone; no previous step context is remembered.`,

        // STEP 4: Technical approaches (Old Step 3)
        4: `You are a full-stack architect helping a Navy sailor outline potential technical approaches to building their idea for a static web app. If the app runs on a P-8 aircraft, you can use the Fleet Support Virtual Machine which has read access to mission system data like ownship position, track data, sensor status, and some sensor data. You can save state by having the user download/upload json/csv files. Do not propose an application that requires consistent internet connection or a server (though it can use the file access API and sharepoint to replicate a server/database). Focus on UI/UX and algorithmic implementation differences, and distinct feature sets. Do not propose different frameworks like react or svelte, just use vanilla javascript (or maybe jquery).\nOutline 3 technical approaches that could implement the chosen solution.\nHighlight pros/cons and offline constraints.\n\nSolution concept:\n{context}\n`,

        // STEP 5: Build prompt (Old Step 4)
        5: `Here is the user's description of an app they'd like you to build:\n\n{context}\n\nSpecific instructions:\n\n1) Must be vanilla javascript, with no libraries that can't be included as a regular .js or .css file with script/link tags. You can use a CDN for development. You cannot use any UI frameworks, like React or Vue, that require a compiler installed\n2) extremely complex, default to a single html file or, at most, 1 css and 1 js file.\n3) Please start with an architecture .txt file that will be useful for a later LLM to understand the codebase.\n4) IMPORTANT: Generate the full, complete code for every file. Do not use placeholders like // ...rest of code...\n\nOkay, start coding.`,

        // ==================== ADVANCED PROMPTS ====================
        // These prompts are for modifying EXISTING apps

        // STEP 6: JSON Download/Upload Integration (Old Step 5)
        6: `Add JSON save/load functionality to my existing app. I need buttons that let users:
1. Download all app data as a JSON file (for backup or transfer)
2. Upload a previously saved JSON file to restore their data

User's preference for what data to save:
{context}

Requirements:
- If no preference given above, save ALL app data
- Use vanilla JavaScript (no frameworks)
- "Download" button saves a .json file with today's date in the filename
- "Upload" button opens a file picker, loads the JSON, and restores the app state
- Show success/error messages to the user
- Style buttons with Bootstrap 5 if the app uses it
- IMPORTANT: When modifying files, provide the COMPLETE file content with the new code integrated. Do NOT provide snippets.

Please provide:
1. The COMPLETE file content with the new functionality

NOTE: If you don't already have my app code, I'll share it with you first. Just let me know.`,

        // STEP 7: CSV/Excel File Upload Integration (Old Step 6)
        7: `Add CSV/Excel import functionality to my existing app. I need users to be able to upload a spreadsheet file and use that data in the app.

Description of the spreadsheet format users will upload:
{context}

Requirements:
- Accept .csv, .xlsx, and .xls files
- Parse the file and convert rows into usable data
- Show a preview of the first few rows before importing
- Include "Cancel" and "Confirm Import" buttons
- Handle empty cells gracefully
- Use vanilla JavaScript with the SheetJS library
- IMPORTANT: When modifying files, provide the COMPLETE file content with the new code integrated. Do NOT provide snippets.

Please provide:
1. The COMPLETE file content with the new functionality

NOTE: If you don't already have my app code, I'll share it with you first. Just let me know.`,

        // STEP 8: Export to Word/PPT/PDF (Old Step 7)
        8: `Add document export functionality to my existing app. I need users to be able to download their data as a Word document, PowerPoint presentation, or PDF.

Description of what the exported document should look like:
{context}

Requirements:
- Generate documents entirely in the browser (no server needed)
- Include proper formatting: titles, paragraphs, tables, bullet lists as needed
- Filename should include today's date
- Show a loading indicator while generating
- IMPORTANT: When modifying files, provide the COMPLETE file content with the new code integrated. Do NOT provide snippets.

Use these CDN libraries:
- Word (.docx): https://unpkg.com/docx@8.2.3/build/index.umd.js
- PowerPoint (.pptx): https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js  
- PDF: https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js

Please provide:
1. The COMPLETE file content with the new functionality

NOTE: If you don't already have my app code, I'll share it with you first. Just let me know.`,

        // STEP 9: OCR with Tesseract.js (Old Step 8)
        9: `Add OCR (text extraction from images) functionality to my existing app. I need users to be able to upload a photo or scanned document and extract the text from it.

What kind of images users will upload (optional):
{context}

Requirements:
- Accept common image formats (jpg, png, gif, bmp, webp)
- Show a preview of the uploaded image
- Display a progress bar during text extraction
- Show the extracted text in an editable text area (so users can fix mistakes)
- Include a "Copy Text" button
- Handle errors gracefully
- IMPORTANT: When modifying files, provide the COMPLETE file content with the new code integrated. Do NOT provide snippets.

Use Tesseract.js CDN:
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>

Please provide:
1. The COMPLETE file content with the new functionality

NOTE: If you don't already have my app code, I'll share it with you first. Just let me know.`,

        // STEP 10: LLM-Powered JSON Data Pipeline (Old Step 9)
        10: `Add an LLM-powered data analysis feature to my existing app. This creates a workflow where users can:
1. Select/copy data from the app (wrapped automatically in an AI prompt)
2. Paste that prompt into their AI chatbot of choice
3. Get structured JSON back from the AI
4. Paste the JSON response back into the app
5. See the results visualized in a report or chart

Description of what data users will analyze and what insights they want:
{context}

Requirements:
- "Generate AI Prompt" button that collects selected data and wraps it in a structured prompt
- Prompt should instruct the AI to return valid JSON with a specific schema
- "Paste AI Response" text area with a "Process" button
- JSON validation with helpful error messages if the response is malformed
- Visualization of the results (table, chart, or formatted report)
- "Export Results" button to save the processed data
- Use vanilla JavaScript (no server needed)
- IMPORTANT: When modifying files, provide the COMPLETE file content with the new code integrated. Do NOT provide snippets.

Please provide:
1. The COMPLETE file content with the new functionality

Suggested flow:
- User selects data in the app → clicks "Generate AI Prompt" → copies the prompt
- User pastes into AI chatbot → AI returns JSON analysis
- User copies JSON → pastes in "AI Response" area → clicks "Process"
- App validates JSON, displays visualization/report

NOTE: If you don't already have my app code, I'll share it with you first. Just let me know.`,

        // STEP 11: SharePoint List Integration
        11: `Add SharePoint list integration for data persistence to my existing HTML/JavaScript app. The app will be hosted inside SharePoint (via Firepit/SPFx, an HTML File Viewer or iframe surface, or legacy IntelShare as a direct SitePages .aspx page).

My app-specific data model / target SharePoint details:
{context}

Use the following as the implementation brief whenever you integrate this app with SharePoint.

SharePoint Integration Notes for This App
=========================================

Environment
-----------
- Ask me for the exact SharePoint site URL if it is not already provided.
- Do not invent or reuse a site URL from another app.
- The app may be hosted inside SharePoint through Firepit/SPFx, an HTML File Viewer web part, another iframe-based surface, or legacy IntelShare as a direct \`SitePages/*.aspx\` page.
- If the deployment target says legacy IntelShare, do not assume Firepit exists. The compiled app is uploaded directly to the site's Site Pages / \`SitePages\` folder as an \`.aspx\` file on \`intelshare.intelink.sgov.gov\` or \`intelshare.intelink.gov\`.
- In that scenario, \`window.location\` may be \`about:srcdoc\` and cannot be trusted as the site URL.

SharePoint list naming
----------------------
- Choose a list title that clearly matches this app, such as \`<Short App Name> Data <Suffix>\` or \`<Short App Name> Items <Suffix>\`.
- Derive \`<Short App Name>\` from the actual app name, heading, file name, or user-provided context.
- Bias toward unique list titles by appending an 8-character random alphanumeric suffix, such as \`Readiness Tracker Data A7K9M2QX\`.
- Generate the suffix once when proposing or initializing the app config. Do not regenerate it on every page load after a title has been chosen.
- Do not use generic, stale, or unrelated list names from previous apps.
- If the app name is unclear, propose one simple unique list title with a suffix and mark it as a value to confirm.
- Keep the configured list title centralized in one runtime config object.

SharePoint list auto-provisioning
---------------------------------
- The app should create its SharePoint list if the configured list title does not exist and the current user has permission.
- On startup or before the first SharePoint sync, run an \`ensureSharePointList()\` flow:
  1. GET list metadata for the configured title.
  2. If the list exists, fetch and cache \`ListItemEntityTypeFullName\`.
  3. If SharePoint returns a not-found response, POST to \`/_api/web/lists\` to create a generic custom list with \`BaseTemplate: 100\` and the configured title.
  4. After creation, create any required custom fields that are missing.
  5. Re-fetch list metadata and cache \`ListItemEntityTypeFullName\`.
- Do not silently create a list with a different title after the app has been configured. If creation fails because of permissions, show a clear setup message with the exact list title and columns to create manually.
- Keep auto-provisioning idempotent: repeated runs should verify the list and fields without duplicating columns or changing unrelated SharePoint settings.

Simple list schema rule
-----------------------
- Keep the SharePoint list schema intentionally small.
- Prefer one app data list unless the app truly has separate independent record types.
- Start with SharePoint's built-in fields:
  - \`Title\`
  - \`Created\`
  - \`Modified\`
  - \`Author\`
  - \`Editor\`
- Add only these default custom columns:
  - \`ItemType\` - Single line of text, optional category such as task, note, event, setting, or record.
  - \`DataJson\` - Multiple lines of text, Plain Text, stores the full app record as JSON.
- Add extra custom columns only when the app needs SharePoint-side filtering, sorting, views, or reporting.
- Avoid wide schemas. Do not create a column for every property in the JavaScript object.
- Keep the recommended schema to 2-5 custom columns total unless there is a clear app-specific reason.
- Use short, readable column names that match the app domain.
- Use Plain Text, not Rich Text, for any field that stores freeform app content or JSON.

Optional extra columns
----------------------
Only add these if the app clearly needs them:
- \`Status\` - Choice, only if records have a visible workflow state.
- \`DueDate\` or another app-specific date - Date and Time, only if users sort/filter by date.
- \`Owner\` - Person or Single line of text, only if assignment is part of the app.
- One app-specific lookup/filter key, only if the UI needs fast filtering without parsing JSON.

Do not add columns just because data exists in the app. If the field is only used by the app after load, store it inside \`DataJson\`.

What the app is
---------------
- This is a single-page app.
- It should not navigate between pages for normal in-app view changes.
- It should swap views by updating DOM content with JavaScript.
- Inside SharePoint, app buttons must not behave like form submit buttons.

Critical UI behavior requirements
---------------------------------
- Do not rely on URL/hash routing for view changes unless there is a strong reason.
- Prefer in-memory view state, for example:
  - \`{ name: 'home' }\`
  - \`{ name: 'list' }\`
  - \`{ name: 'detail', id: 1 }\`
  - \`{ name: 'settings' }\`
- All generated buttons in the app must explicitly use:
  - \`type="button"\`
- Remove any existing inline event handler attributes anywhere in the app, for example:
  - \`onclick\`
  - \`onchange\`
  - \`oninput\`
  - \`onsubmit\`
- Replace inline handlers with JavaScript-bound listeners, preferably delegated listeners via \`addEventListener(...)\`.
- Do not introduce new inline event handlers in generated HTML or HTML strings.
- Delegated click handlers inside the app should call:
  - \`event.preventDefault()\`
  - \`event.stopPropagation()\`
- Reason:
  - Inside SharePoint, plain \`<button>\` elements can trigger host-page form submission/postback behavior.
  - Inline event handler attributes can also break in SharePoint-hosted app surfaces.

SharePoint naming detail
------------------------
SharePoint list/library titles and URLs are not always the same.

Do not assume:
- library title == library URL
- folder name == library name
- list title == what appears in a page URL

Always verify:
- exact site absolute URL
- exact list title
- exact document library title, if files are used
- exact folder server-relative path, if files are used

File storage assumptions
------------------------
- Only add document/file integration if this app actually stores uploaded files.
- If the app stores files, prefer a folder inside the standard document library instead of creating a new library.
- Verify the library title and folder path separately.
- Read document items from the library and filter to the folder using \`FileDirRef\`.
- Upload new files with \`GetFolderByServerRelativeUrl\`.
- Do not add custom library columns unless the app needs them for visible SharePoint views or filtering.

Correct SharePoint REST patterns for this app
---------------------------------------------
Always use:
- \`credentials: 'include'\`

Accept header:
- \`Accept: application/json;odata=verbose\`

Request digest:
- Required for POST/MERGE/DELETE
- Retrieve from:
  - \`/_api/contextinfo\`
- Cache for about 15 minutes, or slightly less than the server timeout

List creation example
---------------------
Use this only when the configured app data list does not already exist.
- URL:
  - \`/_api/web/lists\`
- Headers:
  - \`X-RequestDigest\`
  - \`Content-Type: application/json;odata=verbose\`
- Body should include:
  - \`__metadata: { type: 'SP.List' }\`
  - \`BaseTemplate: 100\`
  - \`Title: '<APP_DATA_LIST_TITLE>'\`
- After creating the list, add missing custom fields such as \`ItemType\` and \`DataJson\`, then fetch the list metadata again.

GET examples
------------
Load app data list items:
- \`/_api/web/lists/getbytitle('<APP_DATA_LIST_TITLE>')/items?$select=Id,Title,ItemType,DataJson,Created,Modified&$orderby=Modified desc&$top=5000\`

Load documents from a library folder, only if the app uses files:
- \`/_api/web/lists/getbytitle('<DOCUMENT_LIBRARY_TITLE>')/items?$select=Id,FileLeafRef,FileRef,FileDirRef,Created,Modified,FSObjType&$filter=FSObjType eq 0 and FileDirRef eq '<DOCUMENT_FOLDER_SERVER_RELATIVE_PATH>'&$orderby=Modified desc&$top=5000\`

POST create example
-------------------
- URL:
  - \`/_api/web/lists/getbytitle('<APP_DATA_LIST_TITLE>')/items\`
- Headers:
  - \`X-RequestDigest\`
- Body should include:
  - \`Title\`
  - \`ItemType\`, if used
  - \`DataJson\`
- Note:
  - do not hardcode the entity type if avoidable
  - fetch \`ListItemEntityTypeFullName\` dynamically from list metadata

MERGE update example
--------------------
- URL:
  - \`/_api/web/lists/getbytitle('<APP_DATA_LIST_TITLE>')/items(ID)\`
- Headers:
  - \`X-RequestDigest\`
  - \`IF-MATCH: *\`
  - \`X-HTTP-Method: MERGE\`

Document upload example, only if the app uses files
---------------------------------------------------
- URL pattern:
  - \`/_api/web/GetFolderByServerRelativeUrl('<DOCUMENT_FOLDER_SERVER_RELATIVE_PATH>')/Files/add(url='filename.ext',overwrite=false)\`
- Use raw binary body.
- Include request digest.

Iframe/site detection requirements
----------------------------------
When running inside SharePoint iframe-like containers:
- \`window.location\` may be \`about:srcdoc\`
- use fallback logic in this order:
  1. \`_spPageContextInfo.webAbsoluteUrl\`
  2. \`window.parent.location.href\` inside \`try/catch\`
  3. \`document.referrer\`
  4. configured fallback site URL

When deriving the site URL:
- accept SharePoint hostnames by checking if hostname includes:
  - \`sharepoint\`
  - \`intelshare.intelink.sgov.gov\`
  - \`intelshare.intelink.gov\`
- support paths like:
  - \`/sites/...\`
  - \`/teams/...\`
- stop the site path before segments such as:
  - \`_layouts\`
  - \`SitePages\`
  - \`Lists\`
  - \`Shared Documents\`
  - \`SiteAssets\`
  - \`Forms\`
  - \`Documents\`

Pagination rules
----------------
- SharePoint commonly returns partial result sets.
- Use \`$top=5000\`.
- Follow \`d.__next\` until exhausted.

Known failure cases to avoid
----------------------------
1. Wrong site root
- Symptom:
  - list requests 404
- Fix:
  - use the full site URL, including the \`/sites/...\` or \`/teams/...\` path.

2. Wrong list title
- Symptom:
  - SharePoint says the list does not exist.
- Fix:
  - point the app at the actual list title, not the page URL or an old example name.

3. Wrong library title
- Symptom:
  - SharePoint says the document library does not exist.
- Fix:
  - use the actual library title for \`getbytitle(...)\` and the actual server-relative folder path for \`FileDirRef\`.

4. Folder vs library confusion
- Symptom:
  - documents do not appear or uploads go to the wrong place.
- Fix:
  - read from the document library list items, filter by \`FileDirRef\`, and upload with \`GetFolderByServerRelativeUrl\`.

5. SPA controls resetting inside SharePoint
- Symptom:
  - a button appears to work, the page flashes, then the app resets.
- Fix:
  - all app buttons must be \`type="button"\`
  - delegated click handlers must call \`preventDefault\` and \`stopPropagation\`
  - prefer in-memory view switching over URL navigation

6. Local-only behavior not matching SharePoint behavior
- Symptom:
  - works from \`file://\`
  - fails when hosted in SharePoint
- Fix:
  - validate UI interactions inside the actual SharePoint host.

Recommended code organization
-----------------------------
Prefer splitting the app into:
- \`index.html\`
  - shell only
- \`app.css\`
  - layout and component styling
- \`sharepoint.js\`
  - config, site detection, REST helpers, request digest, list access, optional file access
- \`app.js\`
  - view state, DOM rendering, event delegation, action handlers

Reason:
- easier debugging
- easier reuse
- easier to swap data layer without touching view code

Recommended runtime config block
--------------------------------
Keep the following values centralized in one place:
- site URL
- app data list title
- app data list item entity type
- request digest TTL
- document library title, only if files are used
- document folder server-relative path, only if files are used

Example config shape:
- \`siteUrl: '<SHAREPOINT_SITE_URL>'\`
- \`dataListTitle: '<APP_DATA_LIST_TITLE>'\`
- \`dataListEntityType: null\`
- \`requestDigestTtlMs: 14 * 60 * 1000\`
- \`documentLibraryTitle: '<DOCUMENT_LIBRARY_TITLE>'\`
- \`documentFolderPath: '<DOCUMENT_FOLDER_SERVER_RELATIVE_PATH>'\`

Implementation checklist
------------------------
1. Confirm the SharePoint site absolute URL.
2. Choose or confirm an app-specific data list title with an 8-character random alphanumeric suffix.
3. Add an idempotent startup/setup check that creates the list if it does not exist.
4. Keep the list schema simple: \`Title\`, \`ItemType\`, and \`DataJson\` are usually enough.
5. Add extra columns only for fields that need SharePoint-side filtering, sorting, views, or reporting.
6. Confirm the exact document library title and folder path only if files are used.
7. Verify the folder exists before testing upload, if files are used.
8. Verify all app buttons are \`type="button"\`.
9. Verify clicks do not submit the host SharePoint form.
10. Test inside SharePoint, not just from local files.
11. If a 404 mentions a list title, re-check title vs URL naming and the auto-provisioning path.
12. If documents do not load, re-check library title vs folder path.

Implementation instructions for you:
- Preserve existing app behavior and styling unless SharePoint integration requires a deliberate UI adjustment.
- Do not invent exact SharePoint titles, folder paths, or field internal names if they are missing; ask me for them or clearly mark them as values to confirm.
- Do not reuse stale list names, folder names, or field names from unrelated apps.
- Generate an app-specific list title based on this app, append an 8-character random alphanumeric suffix for uniqueness, and use that same title consistently in config, REST calls, setup instructions, and auto-provisioning.
- Implement idempotent list auto-provisioning: check for the configured list, create it if missing, create missing required fields, then continue with normal data load.
- Keep the SharePoint list nice and simple. Avoid large schemas and unnecessary columns.
- For create/update/delete operations, use SharePoint REST with \`credentials: 'include'\`, the verbose JSON accept header, and request-digest handling.
- For list-item entity type names, fetch list metadata dynamically when practical instead of hardcoding.
- For document reads, treat the folder as a filtered subset of the document library, not as a separate library.
- For view changes in the SPA, prefer in-memory state and DOM replacement, not full navigation.
- Ensure every app button is \`type="button"\` and delegated click handlers call both \`preventDefault()\` and \`stopPropagation()\`.
- Follow pagination until exhausted.

Please provide:
1. The COMPLETE file content with the new functionality integrated. Do NOT provide snippets.
2. A short SharePoint setup section with the app-specific list title and a simple column list.
3. Document library and folder instructions only if the app actually uses uploaded files.
4. Any configuration values I must update before deployment.

NOTE: If you do not already have my app code, ask me to share it first before writing code.`,

        // STEP 18: SharePoint Live Polling Follow-Up
        18: `My app already has working SharePoint list integration. Now add simple live updates via polling on top of that existing SharePoint data layer.

Relevant app code / current data flow:
{context}

This is a follow-up prompt to use AFTER the base SharePoint list integration is already implemented.

Requirements:
- Do not redesign the whole SharePoint integration from scratch.
- Reuse the existing SharePoint REST helpers, config, request-digest handling, and state model where practical.
- Keep the implementation simple, clean, and scalable for a browser-hosted SharePoint app.
- Use polling only. Do not introduce sockets, SignalR, webhooks, server push, or backend services.
- Prefer one polling controller/service with:
  - one active timer at a time
  - one in-flight poll at a time
  - polling logic separated from rendering logic
- Prefer \`setTimeout\` polling instead of \`setInterval\` so the next cycle starts only after the current one completes.
- Default behavior:
  - poll every \`15-30\` seconds while the tab is visible
  - slow down substantially when the tab is hidden, for example \`60-120\` seconds
  - temporarily back off after repeated errors
- Do not poll while:
  - initial load is still running
  - a write/update/upload/delete request is in flight
  - another poll is already running
- Prefer lightweight change detection:
  - track a \`lastSync\`, \`lastSeenModified\`, or equivalent watermark
  - request only fields needed for change detection before expensive rerenders when practical
  - rerender only when data actually changed
- Prefer incremental reconciliation:
  - merge changed SharePoint items/documents into in-memory state
  - avoid full DOM rebuilds if only a subset of records changed
  - if delete detection is difficult, use occasional slower full reconciliation instead of making the normal path complicated
- Keep conflict handling simple:
  - SharePoint is the source of truth after successful writes
  - after create/update/delete, trigger a targeted refresh or reset the sync watermark
  - avoid elaborate optimistic concurrency systems unless clearly necessary
- UI guidance:
  - add a small unobtrusive sync status such as \`Syncing...\`, \`Updated just now\`, or \`Retrying...\`
  - do not use modal dialogs for routine polling events
- Keep all existing SharePoint compatibility constraints:
  - no inline event handlers
  - buttons should remain \`type="button"\`
  - delegated handlers should still use \`preventDefault()\` and \`stopPropagation()\` where appropriate

Please provide:
1. The COMPLETE file content for every changed file. Do NOT provide snippets.
2. A short explanation of the polling design.
3. Any config values I should tune, such as polling interval or backoff.

NOTE: If you do not already have my app code, ask me to share it first before writing code.`,

        // STEP 12: Ask Sage API Integration
        12: `Add Ask Sage API integration to my existing offline HTML/JavaScript app.

Description of what Ask Sage should do in my app:
{context}

Build this to match Athena/Prometheus integration behavior, especially tool-calling behavior.

Requirements:
- Use vanilla JavaScript (no framework)
- Support these Ask Sage tenant endpoint patterns:
  - CAPRA:
    - serverBaseUrl: https://api.capra.flankspeed.us.navy.mil/server
    - userBaseUrl: https://api.capra.flankspeed.us.navy.mil/user
    - queryEndpoint: https://api.capra.flankspeed.us.navy.mil/server/query
  - Army NIPR tenant:
    - serverBaseUrl: https://api.genai.army.mil/server
    - userBaseUrl: https://api.genai.army.mil/user
    - queryEndpoint: https://api.genai.army.mil/server/query
  - Army SIPR tenant:
    - serverBaseUrl: https://api.genai.army.smil.mil/server
    - userBaseUrl: https://api.genai.army.smil.mil/user
    - queryEndpoint: https://api.genai.army.smil.mil/server/query
- Keep the tenant configurable instead of hardcoding a single Ask Sage host when practical
- Add secure API key input workflow (never hardcode keys)
- Every CAPRA request must send BOTH auth headers:
  - Authorization: Bearer <apiKey>
  - x-access-tokens: <apiKey>
- Default request mode for chat/query must be:
  - response_mode: 'sync'
  - stream: false
- Preserve existing app behavior and styling unless API integration changes require UI updates
- Assume security compilation is enabled; API calls must work with Ask Sage tenant domains in connect-src, including CAPRA, api.genai.army.mil, and api.genai.army.smil.mil
- Provide clear user-visible errors for missing key, non-200 responses, malformed JSON, and network failures

API capabilities that must be implemented:
1. Standard prompt/query calls:
   - CAPRA expects a top-level message field for the actual prompt text.
   - For normal query calls, send model + message with:
     - response_mode: 'sync'
     - stream: false
   - Root cause to account for:
     - CAPRA may place the real model output in fields like response or message, but those same fields are also used for bare status acknowledgements like "OK".
     - The old extractor bug was caused by taking the first non-empty string, which let sentinel values like message: "OK" win over the real answer.
   - Fix extractAskSageResponseText so it filters status sentinel strings before treating a field as actual model content.
   - Provide robust response text extraction across heterogeneous response shapes with this exact behavior:
     - Add a realStr() helper that rejects sentinel-only strings matching a regex such as /^(ok|okay|success|done|accepted|complete|completed)$/i
     - Check richer content fields first: output_text, generated_text, answer, completion, text
     - Push message and response to the end of the priority order because CAPRA often uses them as status echoes
     - If every candidate value is only a sentinel, return the raw fallback value as a last resort so nothing is silently swallowed
   - Treat HTTP 200 responses with body-level errors as failures too, especially:
     - { status: 400, response: 'Internal error' }
     - { message: 'Sorry, your request did not contain a message.' }

2. Native tool calling (critical):
   - CAPRA native tool calling works with a single top-level message plus OpenAI-style tools.
   - Working native request shape is:
     { model, message, response_mode: 'sync', stream: false, tools, tool_choice? }
   - Include tools as:
     tools: [{ type: 'function', function: { name, description, parameters } }]
   - Use JSON Schema object parameters (type: object, properties, required).
   - Do NOT rely on messages/query/question/input_text as the primary prompt for native tool turns.
   - Do NOT send persona in the native CAPRA tool-call request body.
   - tool_choice: 'auto' is acceptable; allow forcing 'required' when needed.
   - If native tool calling returns a body-level CAPRA error, retry once with a text-tool compatibility mode.
   - Do not use flat tools arrays, legacy functions, Anthropic tool schema, or Google tool schema for native CAPRA calls.

3. Robust tool-call parsing (critical, must support fallback formats):
   - Parse structured tool calls from object fields like:
     tool_call, tool_calls, tool_calls_unified, toolcalls, toolcallsunified
   - Parse tool calls embedded in text/tag formats:
     - <tool_call>{...}</tool_call>
     - <tool_calls>[...]</tool_calls>
     - unclosed <tool_calls> payloads (model hit output limit)
     - inline JSON objects separated by "next"
     - [TOOL CALLS] with dash-prefixed entries such as:
       - writeFile: {"path":"index.html","content":"..."}
   - Normalize tool name aliases to canonical tool names from your local tool registry.
   - Normalize argument aliases:
     filepath/file/filename -> path
     fileglob -> fileGlob
     startline -> startLine
     endline -> endLine
   - Deduplicate tool calls by canonical name + stable stringified args.
   - If tool calls exist, return empty assistant text and stopReason 'tool_calls'.

4. Model and usage endpoints:
   - Model discovery via POST /get-models
   - Monthly token usage via:
     - GET /count-monthly-tokens
     - GET /count-monthly-teach-tokens
   - Implement resilient model extraction from arrays and wrapped payload shapes.
   - Implement resilient token count extraction from nested payloads.

5. Key verification:
   - Add a lightweight key verification function that calls /get-models with required CAPRA headers.

Message normalization requirements (for multi-turn agent/tool use):
- Accept OpenAI-like message arrays.
- For native CAPRA tool turns, rebuild recent context into a single message string instead of assuming CAPRA will honor raw prior messages as conversation state.
- If a prior message has role 'tool', normalize it into a user-visible tool result block:
  [TOOL RESULT <toolName>]
  <toolOutput>
- If assistant message includes tool_calls, preserve/serialize those calls so CAPRA can continue context coherently.
- Preserve plain user and assistant text content in order.
- Do not aggressively truncate carried-forward file/tool content for native CAPRA turns; if you cap large outputs anywhere, do not tell the model to reread the file.

Implement or adapt this helper structure (do not skip these helpers):
- getAskSageApiKey()
- resolveAskSageBaseUrl(base)
- callSageApi({ path, method, body, base, headers })
- extractAskSageResponseText(payload)
- buildAskSageTools(toolDefs)
- normalizeAskSageMessages(messages)
- buildAskSageNativeToolMessage({ messages, prompt })
- buildAskSagePayload({ prompt, model, messages, tools, forceToolChoice, compatibilityMode })
- callAskSageQuery({ prompt, model, messages, tools, forceToolChoice })
- parseAskSageResponse(data) -> { text, toolCalls, stopReason }
- extractAskSageToolCallsFromStructured(payload)
- extractAskSageToolCallsFromTaggedText(text)
- normalizeAskSageToolCall(node, source, index)
- fetchAskSageModels()
- fetchTokenUsageSnapshot()
- verifyAskSageKey(apiKey)

Concrete, working examples for every helper (you can reuse or adapt directly):
  function getAskSageApiKey() {
    const key = String(askSageSettings.apiKey || '').trim();
    if (!key) throw new Error('Missing API key');
    return key;
  }

  function resolveAskSageBaseUrl(base = 'server') {
    const raw = base === 'user' ? askSageSettings.userBaseUrl : askSageSettings.serverBaseUrl;
    return String(raw || '').trim().replace(/\/+$/, '');
  }

  async function callSageApi({ path, method = 'POST', body = null, base = 'server', headers = {} } = {}) {
    const apiKey = getAskSageApiKey();
    const absolute = /^https?:\/\//i.test(String(path || ''));
    const baseUrl = absolute ? '' : resolveAskSageBaseUrl(base);
    const url = absolute ? String(path) : baseUrl + (String(path).startsWith('/') ? String(path) : '/' + String(path));
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const response = await fetch(url, {
      method,
      headers: Object.assign({
        Authorization: 'Bearer ' + apiKey,
        'x-access-tokens': apiKey
      }, isFormData ? {} : { 'Content-Type': 'application/json' }, headers || {}),
      body: body == null ? undefined : (isFormData ? body : JSON.stringify(body))
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    const bodyMessage = data && (data.error || data.message || data.response);
    if (!response.ok) {
      const msg = bodyMessage || raw || ('Ask Sage request failed (' + response.status + ')');
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    if (data && typeof data === 'object') {
      const bodyStatus = Number(data.status);
      if ((Number.isFinite(bodyStatus) && bodyStatus >= 400) || /internal error|did not contain a message/i.test(String(bodyMessage || ''))) {
        const msg = bodyMessage || ('Ask Sage body-level error (' + bodyStatus + ')');
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
    }
    if (data == null && /internal error|did not contain a message/i.test(String(raw || ''))) {
      throw new Error(String(raw || 'Ask Sage body-level error'));
    }
    return data == null ? raw : data;
  }

  function extractAskSageResponseText(payload) {
    if (payload == null) return '';

    const sentinelRe = /^(ok|okay|success|successful|done|accepted|complete|completed)$/i;
    function rawStr(value) {
      return typeof value === 'string' ? value.trim() : '';
    }
    function realStr(value) {
      const text = rawStr(value);
      return text && !sentinelRe.test(text) ? text : '';
    }

    if (typeof payload === 'string') return rawStr(payload);

    const candidates = [
      payload.output_text,
      payload.generated_text,
      payload.answer,
      payload.completion,
      payload.text,
      payload.result && payload.result.text,
      payload.data && payload.data.text,
      payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content,
      payload.choices && payload.choices[0] && payload.choices[0].text,
      payload.response,
      payload.message
    ];

    for (const candidate of candidates) {
      const text = realStr(candidate);
      if (text) return text;
    }

    for (const candidate of candidates) {
      const text = rawStr(candidate);
      if (text) return text;
    }

    return JSON.stringify(payload);
  }

  function buildAskSageTools(toolDefs = []) {
    if (!Array.isArray(toolDefs)) return [];
    return toolDefs.map(function (t) {
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: {
            type: 'object',
            properties: t.params || t.properties || {},
            required: Array.isArray(t.required) ? t.required : []
          }
        }
      };
    });
  }

  function normalizeAskSageMessages(messages = []) {
    const out = [];
    for (const m of (Array.isArray(messages) ? messages : [])) {
      if (!m) continue;
      if (m.role === 'tool') {
        const toolName = String(m._toolName || m.name || 'tool');
        const toolResult = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || {});
        out.push({ role: 'user', content: '[TOOL RESULT ' + toolName + ']\\n' + toolResult });
        continue;
      }
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const lines = m.tool_calls.map(function (tc) {
          const fn = tc && tc.function ? tc.function : {};
          const name = String(fn.name || tc.name || 'tool');
          const args = fn.arguments != null ? fn.arguments : (tc.args != null ? tc.args : {});
          return '- ' + name + ': ' + (typeof args === 'string' ? args : JSON.stringify(args));
        }).join('\\n');
        const text = typeof m.content === 'string' ? m.content.trim() : '';
        out.push({ role: 'assistant', content: (text ? text + '\\n\\n' : '') + '[TOOL CALLS]\\n' + lines });
        continue;
      }
      if (typeof m.content === 'string') out.push({ role: m.role, content: m.content });
    }
    return out;
  }

  function buildAskSageNativeToolMessage({ messages = [], prompt = '' } = {}) {
    const normalizedMessages = normalizeAskSageMessages(messages);
    const promptText = String(prompt || '').trim() || (
      [...normalizedMessages].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string')?.content || ''
    );
    const recent = normalizedMessages
      .filter(function (m) { return m && typeof m.content === 'string' && m.content.trim(); })
      .slice(-6);
    const prior = promptText && recent.length ? recent.slice(0, -1) : recent;
    const transcript = prior.map(function (m) {
      const role = m.role === 'assistant' ? 'Assistant' : 'User';
      return role + ': ' + String(m.content || '').trim();
    }).filter(Boolean).join('\\n\\n');
    return [
      transcript ? 'Conversation context:\\n' + transcript : '',
      promptText ? (transcript ? 'Current user request:\\n' + promptText : promptText) : ''
    ].filter(Boolean).join('\\n\\n').trim();
  }

  function buildAskSagePayload({ prompt, model, messages = [], tools = [], forceToolChoice = false, compatibilityMode = false } = {}) {
    const normalizedMessages = normalizeAskSageMessages(messages);
    const promptText = String(prompt || '').trim() || (
      [...normalizedMessages].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string')?.content || ''
    );
    if (compatibilityMode) {
      return {
        model: model || askSageSettings.model,
        message: promptText,
        query: promptText,
        question: promptText,
        input_text: promptText,
        messages: promptText ? [{ role: 'user', content: promptText }] : undefined,
        response_mode: 'sync',
        stream: false
      };
    }
    return {
      model: model || askSageSettings.model,
      message: buildAskSageNativeToolMessage({ messages: normalizedMessages, prompt: promptText }),
      response_mode: 'sync',
      stream: false,
      tools: buildAskSageTools(tools),
      tool_choice: forceToolChoice ? 'required' : 'auto'
    };
  }

  function stableStringify(value) {
    if (value == null) return 'null';
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + stableStringify(value[k]); }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function normalizeAskSageToolCall(node, source = 'structured', index = 0) {
    if (!node || typeof node !== 'object') return null;
    const fn = node.function && typeof node.function === 'object' ? node.function : null;
    const rawName = node.name || node.tool_name || node.tool || node.function_name || (fn && fn.name) || '';
    const name = String(rawName || '').trim();
    if (!name) return null;
    let args = node.args;
    if (args == null) args = node.arguments;
    if (args == null && fn) args = fn.arguments || fn.args;
    if (args == null) args = node.input || node.parameters || {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch (_) { args = {}; }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    const alias = { filepath: 'path', file: 'path', filename: 'path', fileglob: 'fileGlob', startline: 'startLine', endline: 'endLine' };
    const normalizedArgs = {};
    for (const k of Object.keys(args)) {
      const lookup = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
      normalizedArgs[alias[lookup] || k] = args[k];
    }
    return { id: node.id || ('as_tc_' + index), name, args: normalizedArgs, _source: source };
  }

  function extractAskSageToolCallsFromStructured(payload) {
    const out = [];
    const walk = function (node, path) {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(function (entry, idx) { walk(entry, path + '[' + idx + ']'); });
        return;
      }
      if (typeof node !== 'object') return;
      const keys = Object.keys(node);
      for (const k of keys) {
        const key = String(k).toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (key === 'tool_call' || key === 'tool_calls' || key === 'tool_calls_unified' || key === 'toolcalls' || key === 'toolcallsunified') {
          const v = node[k];
          const arr = Array.isArray(v) ? v : [v];
          arr.forEach(function (entry, idx) {
            const tc = normalizeAskSageToolCall(entry, path + '.' + k, idx);
            if (tc) out.push(tc);
          });
        }
        walk(node[k], path + '.' + k);
      }
    };
    walk(payload, 'root');
    return out;
  }

  function extractAskSageToolCallsFromTaggedText(text) {
    const src = String(text || '');
    const toolCalls = [];
    const spans = [];
    const m1 = src.match(/<tool_call\\b[^>]*>([\\s\\S]*?)<\\/tool_call>/gi) || [];
    for (const block of m1) {
      const body = block.replace(/^<tool_call\\b[^>]*>/i, '').replace(/<\\/tool_call>$/i, '').trim();
      try {
        const parsed = JSON.parse(body);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        list.forEach(function (entry, idx) {
          const tc = normalizeAskSageToolCall(entry, 'message-tag:tool_call', idx);
          if (tc) toolCalls.push(tc);
        });
      } catch (_) {}
      const start = src.indexOf(block);
      if (start >= 0) spans.push({ start: start, end: start + block.length });
    }
    let cleaned = src;
    spans.sort(function (a, b) { return a.start - b.start; });
    for (let i = spans.length - 1; i >= 0; i--) {
      cleaned = cleaned.slice(0, spans[i].start) + cleaned.slice(spans[i].end);
    }
    return { toolCalls, cleanedText: cleaned.trim(), matchedTags: toolCalls.length ? ['tool_call'] : [] };
  }

  function parseAskSageResponse(data) {
    const selectedText = extractAskSageResponseText(data);
    const structured = extractAskSageToolCallsFromStructured(data);
    const tagged = extractAskSageToolCallsFromTaggedText(selectedText);
    const merged = [];
    const seen = new Set();
    for (const tc of structured.concat(tagged.toolCalls || [])) {
      const sig = String(tc.name || '') + '::' + stableStringify(tc.args || {});
      if (!tc.name || seen.has(sig)) continue;
      seen.add(sig);
      merged.push(tc);
    }
    return {
      text: merged.length ? '' : (tagged.cleanedText || selectedText || ''),
      toolCalls: merged.map(function (tc) { return { id: tc.id, name: tc.name, args: tc.args }; }),
      stopReason: merged.length ? 'tool_calls' : 'stop'
    };
  }

  async function fetchAskSageModels() {
    const data = await callSageApi({ path: '/get-models', method: 'POST', body: {}, base: 'server' });
    const rows = Array.isArray(data) ? data : (Array.isArray(data && data.models) ? data.models : (Array.isArray(data && data.data) ? data.data : []));
    return rows.map(function (r) { return typeof r === 'string' ? r : (r.model || r.name || r.id || ''); }).filter(Boolean);
  }

  function extractTokenCount(payload) {
    if (payload == null) return null;
    if (typeof payload === 'number' && Number.isFinite(payload)) return payload;
    if (typeof payload === 'string') {
      const n = Number(payload.replace(/,/g, '').trim());
      if (Number.isFinite(n)) return n;
    }
    if (Array.isArray(payload)) {
      for (const item of payload) {
        const found = extractTokenCount(item);
        if (found != null) return found;
      }
      return null;
    }
    if (typeof payload === 'object') {
      const keys = ['tokens_used', 'tokens', 'token_count', 'tokenCount', 'total_tokens', 'totalTokens', 'usage', 'count', 'total', 'value', 'response', 'data', 'result', 'payload'];
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          const found = extractTokenCount(payload[key]);
          if (found != null) return found;
        }
      }
    }
    return null;
  }

  async function fetchTokenUsageSnapshot() {
    const inferenceRaw = await callSageApi({ path: '/count-monthly-tokens', method: 'GET', base: 'server' });
    const trainingRaw = await callSageApi({ path: '/count-monthly-teach-tokens', method: 'GET', base: 'server' });
    const inference = extractTokenCount(inferenceRaw);
    const training = extractTokenCount(trainingRaw);
    if (inference == null || training == null) throw new Error('Token count missing in response');
    return { inference, training };
  }

  async function verifyAskSageKey(apiKey) {
    const saved = askSageSettings.apiKey;
    askSageSettings.apiKey = String(apiKey || '').trim();
    try {
      await callSageApi({ path: '/get-models', method: 'POST', body: {}, base: 'server' });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err && err.message || err || 'Unknown error') };
    } finally {
      askSageSettings.apiKey = saved;
    }
  }

Use/adapt this baseline:
  const askSageSettings = {
    apiKey: '',
    serverBaseUrl: 'https://api.capra.flankspeed.us.navy.mil/server', // or https://api.genai.army.mil/server or https://api.genai.army.smil.mil/server
    userBaseUrl: 'https://api.capra.flankspeed.us.navy.mil/user', // or https://api.genai.army.mil/user or https://api.genai.army.smil.mil/user
    queryEndpoint: 'https://api.capra.flankspeed.us.navy.mil/server/query', // or https://api.genai.army.mil/server/query or https://api.genai.army.smil.mil/server/query
    model: 'gpt-4.1'
  };

  async function callAskSageQuery({ prompt, model, messages = [], tools = [], forceToolChoice = false } = {}) {
    const normalizedMessages = normalizeAskSageMessages(messages);
    const nativeBody = buildAskSagePayload({
      prompt,
      model: model || askSageSettings.model,
      messages: normalizedMessages,
      tools,
      forceToolChoice,
      compatibilityMode: false
    });
    try {
      const data = await callSageApi({ path: askSageSettings.queryEndpoint, method: 'POST', body: nativeBody, base: 'server' });
      return parseAskSageResponse(data);
    } catch (err) {
      if (!/internal error|did not contain a message/i.test(String(err && err.message || err || ''))) throw err;
      const compatBody = buildAskSagePayload({
        prompt,
        model: model || askSageSettings.model,
        messages: normalizedMessages,
        tools,
        forceToolChoice,
        compatibilityMode: true
      });
      const data = await callSageApi({ path: askSageSettings.queryEndpoint, method: 'POST', body: compatBody, base: 'server' });
      return parseAskSageResponse(data);
    }
  }

- IMPORTANT: When modifying files, provide the COMPLETE file content with the new code integrated. Do NOT provide snippets.

Please provide:
1. The COMPLETE file content with the new functionality
2. A short section: "Ask Sage setup" (where to set endpoint/key, how to verify key, how to test one standard call, how to test one tool-call turn)

NOTE: If you don't already have my app code, ask me to paste it first.`,

        // STEP 13: GenAI.mil API Integration
        13: `Add GenAI.mil API integration to my existing offline HTML/JavaScript app.

Description of what GenAI.mil should do in my app:
{context}

Requirements:
- Use vanilla JavaScript (no framework)
- Follow the GenAI.mil quickstart endpoint pattern:
  - baseUrl: https://api.genai.mil/v1
  - list models: GET /v1/models
  - chat completions: POST /v1/chat/completions
- Add a secure API key input workflow (never hardcode keys)
- Expect API keys in this format: STARK_xxxxxxxxx...
- Use Authorization header exactly as: Bearer <apiKey>
- Implement a shared request helper (e.g., callGenAiApi) with:
  - base URL handling
  - JSON request/response handling
  - robust error parsing for 401, 403, 429, and network failures
- Implement a query helper (e.g., callGenAiChat) for OpenAI-compatible chat completions with:
  - model
  - messages
  - optional temperature/max_tokens
- Include a model discovery function that fetches available models from /v1/models
- Preserve existing app behavior and styling unless changes are required for API integration
- Assume security compilation is enabled; API calls should work when api.genai.mil is allowlisted in connect-src
- Use/adapt this boilerplate structure:
  const genAiSettings = {
    apiKey: '',
    baseUrl: 'https://api.genai.mil/v1',
    model: 'gemini-2.5-pro'
  };

  function getGenAiApiKey() {
    const key = (genAiSettings.apiKey || '').trim();
    if (!key) throw new Error('Missing API key');
    return key;
  }

  function resolveGenAiUrl(path) {
    const base = String(genAiSettings.baseUrl || '').trim().replace(/\/$/, '');
    const rel = String(path || '').startsWith('/') ? String(path) : '/' + String(path || '');
    return base + rel;
  }

  async function callGenAiApi({ path, method = 'GET', body = null, headers = {} } = {}) {
    const apiKey = getGenAiApiKey();
    const res = await fetch(resolveGenAiUrl(path), {
      method,
      headers: {
        Authorization: 'Bearer ' + apiKey,
        ...(body == null ? {} : { 'Content-Type': 'application/json' }),
        ...headers
      },
      body: body == null ? undefined : JSON.stringify(body)
    });
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || raw || ('GenAI.mil request failed (' + res.status + ')');
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data ?? raw;
  }

  async function fetchGenAiModels() {
    return await callGenAiApi({ path: '/models', method: 'GET' });
  }

  async function callGenAiChat({ messages, model, temperature, max_tokens } = {}) {
    const payload = {
      model: model || genAiSettings.model,
      messages: Array.isArray(messages) ? messages : [],
      ...(typeof temperature === 'number' ? { temperature } : {}),
      ...(typeof max_tokens === 'number' ? { max_tokens } : {})
    };
    return await callGenAiApi({ path: '/chat/completions', method: 'POST', body: payload });
  }

- IMPORTANT: When modifying files, provide the COMPLETE file content with the new code integrated. Do NOT provide snippets.

Please provide:
1. The COMPLETE file content with the new functionality
2. A short section: "GenAI.mil setup" (where to set endpoint/key and how to test /v1/models and one chat call)

NOTE: If you don't already have my app code, ask me to paste it first.`,

        // STEP 14: Leaflet Map Integration
        14: `Add an offline-friendly Leaflet map to my existing HTML/JavaScript app.

Description of the map experience I want:
{context}

Requirements:
- Use vanilla JavaScript (no framework)
- Use Leaflet CDN assets for development, but keep the integration easy to swap to local files later
- Support local GeoJSON overlays and avoid dependence on online tile servers when the app is deployed offline
- Preserve existing app behavior and layout unless map-related changes are required
- Add clear user-facing map interactions such as hover labels, selections, legends, or side-panel details if appropriate
- IMPORTANT: When modifying files, provide the COMPLETE file content with the new code integrated. Do NOT provide snippets.

Please provide:
1. The COMPLETE file content with the new functionality

NOTE: If you don't already have my app code, ask me to paste it first.`,

        // STEP 16: Split Existing App Into Multiple Files
        16: `Refactor my existing offline HTML app so it is organized into one HTML entry file plus multiple JavaScript and CSS files.

What I want separated or preserved:
{context}

Requirements:
- Keep the current behavior unless I explicitly ask to change it
- Keep the app compatible with offline use from file://
- Use vanilla HTML, CSS, and JavaScript only
- Keep exactly one HTML entry file
- Split JavaScript into multiple files by responsibility, such as bootstrapping, state, rendering, utilities, or feature modules where appropriate
- Split CSS into multiple files by responsibility, such as base, layout, components, utilities, or feature-specific styles where appropriate
- Update script and link tags, load order, and any global references so the app still works after the split
- If the app is too small to justify many files, still create a sensible minimal split instead of leaving it monolithic
- Include a short file map explaining what each new file is responsible for
- IMPORTANT: When modifying files, provide the COMPLETE file content for every changed or newly created file. Do NOT provide snippets.

Please provide:
1. The recommended file structure
2. A short explanation of the split
3. The COMPLETE file content for every changed or new file

NOTE: If you don't already have my app code, ask me to paste it first.`,

        // STEP 17: Feature Idea Backlog Prompt
        17: `You are a pragmatic product strategist helping shape a feature backlog for an app.

Goal:
- turn the app concept into a small, useful feature backlog
- favor clear user value over impressive-sounding scope
- keep ideas realistic for a browser-based app unless I explicitly say otherwise

Instructions:
1. If I did not include app context, first ask me for a 2-3 sentence description of the app and the users.
2. If I did include app context, use it immediately and do not ask for more unless absolutely necessary.
3. Propose 10 feature ideas total.
4. Group them into three buckets: Now, Next, Later.
5. For each feature, provide:
   - short feature title
   - one-sentence user value
   - one short reason it belongs in that bucket
6. Keep the ideas concrete, scoped, and implementation-agnostic.
7. Do not write code.

Output format:
Now:
- Feature title — user value. Why now: ...

Next:
- Feature title — user value. Why next: ...

Later:
- Feature title — user value. Why later: ...

App context:
{context}`
    },

    backlogCheckpointFolder: '.checkpoints',
    backlogCheckpointFileName: 'feature_backlog_board.json',
    backlogColumns: [
        { id: 'backlog', label: 'Backlog' },
        { id: 'inprogress', label: 'In Progress' },
        { id: 'done', label: 'Done' }
    ],
    backlogState: null,
    dragCardId: null,
    dragSourceColumnId: null,
    planViewInitialized: false,
    backlogEventsBound: false,
    backlogInitToken: 0,

    generate(step) {
        const ctxEl = document.getElementById('ai-ctx' + step);
        const outEl = document.getElementById('ai-out' + step);
        const ctx = ctxEl ? ctxEl.value.trim() : '';
        const tmpl = this.templates[step];
        if (!tmpl || !outEl) {
            console.error('No template found for step', step);
            return;
        }

        let prompt = tmpl;
        if (step === 1) {
            const opening = ctx
                ? `Start by asking: "Tell me about one recent specific time this came up: ${ctx}."`
                : 'Start by asking: "Tell me about a recent situation where work felt harder, slower, or more frustrating than it should have."';
            prompt = prompt.replace('{opening}', opening);
        } else {
            prompt = tmpl.replace('{context}', ctx || '[all app data]');
        }

        outEl.textContent = prompt;
    },

    setStatus(step, message, tone = 'info') {
        const statusEl = document.getElementById('ai-status' + step);
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.dataset.tone = tone;
    },

    setBacklogStatus(message, tone = 'info') {
        const statusEl = document.getElementById('plan-backlog-status');
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.dataset.tone = tone;
    },

    flashButton(btn, copiedText, copiedClass, originalClass, originalText = null) {
        if (!btn) return;
        const original = originalText === null ? btn.textContent : originalText;
        btn.textContent = copiedText;
        if (originalClass) btn.classList.remove(originalClass);
        if (copiedClass) btn.classList.add(copiedClass);
        setTimeout(() => {
            btn.textContent = original;
            if (copiedClass) btn.classList.remove(copiedClass);
            if (originalClass) btn.classList.add(originalClass);
        }, 1800);
    },

    copyPrompt(step, btn) {
        const outEl = document.getElementById('ai-out' + step);
        if (!outEl || !outEl.textContent.trim()) {
            this.generate(step);
        }
        const text = outEl ? outEl.textContent : '';
        if (!text) {
            this.setStatus(step, 'Prompt unavailable. Reload the tab and try again.', 'error');
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            const successMessage = step === 1
                ? 'Prompt copied. Paste it into AI and the AI will start the JTBD interview from scratch.'
                : 'Prompt copied.';
            this.setStatus(step, successMessage, 'success');
            this.flashButton(btn, 'Copied', 'btn-success', 'btn-primary');
        }).catch(err => {
            this.setStatus(step, 'Copy failed. Select the prompt manually and copy it.', 'error');
            console.error('Failed to copy prompt:', err);
        });
    },

    generateAndCopy(step, btn) {
        // First generate the prompt
        this.generate(step);

        // Then copy it to clipboard
        this.copyPrompt(step, btn);
    },

    initPlanViews() {
        if (this.planViewInitialized) return;
        const buttons = document.querySelectorAll('[data-plan-view-target]');
        if (!buttons.length) return;
        this.planViewInitialized = true;
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-plan-view-target');
                buttons.forEach(other => {
                    const active = other === btn;
                    other.classList.toggle('active', active);
                    other.classList.toggle('btn-primary', active);
                    other.classList.toggle('btn-outline-secondary', !active);
                    other.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                document.querySelectorAll('[data-plan-view]').forEach(panel => {
                    panel.classList.toggle('active', panel.getAttribute('data-plan-view') === target);
                });
            });
        });
    },

    createBacklogCard(title, notes = '') {
        return {
            id: 'feature-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            title: String(title || '').trim(),
            notes: String(notes || '').trim()
        };
    },

    getDefaultBacklogState() {
        return {
            backlog: [],
            inprogress: [],
            done: []
        };
    },

    normalizeBacklogState(parsed) {
        const state = this.getDefaultBacklogState();
        const source = parsed && typeof parsed === 'object' ? parsed : null;
        this.backlogColumns.forEach(column => {
            const items = source && Array.isArray(source[column.id]) ? source[column.id] : [];
            state[column.id] = items
                .filter(item => item && typeof item === 'object')
                .map(item => ({
                    id: String(item.id || this.createBacklogCard(item.title, item.notes).id),
                    title: String(item.title || '').trim(),
                    notes: String(item.notes || '').trim()
                }))
                .filter(item => item.title);
        });
        if (source && Array.isArray(source.queued) && source.queued.length) {
            const migratedQueued = source.queued
                .filter(item => item && typeof item === 'object')
                .map(item => ({
                    id: String(item.id || this.createBacklogCard(item.title, item.notes).id),
                    title: String(item.title || '').trim(),
                    notes: String(item.notes || '').trim()
                }))
                .filter(item => item.title);
            state.backlog = state.backlog.concat(migratedQueued);
        }
        return state;
    },

    async getBacklogCheckpointFileHandle(create = false) {
        if (!loadFolder || !loadFolder.fileHandle) return null;
        const checkpointDir = await loadFolder.fileHandle.getDirectoryHandle(this.backlogCheckpointFolder, { create });
        return await checkpointDir.getFileHandle(this.backlogCheckpointFileName, { create });
    },

    async loadBacklogState() {
        let parsed = null;
        try {
            if (!loadFolder || !loadFolder.fileHandle) {
                this.backlogState = this.getDefaultBacklogState();
                this.setBacklogStatus(`Load a project folder to store the backlog in ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`);
                return this.backlogState;
            }

            const fileHandle = await this.getBacklogCheckpointFileHandle(false);
            if (!fileHandle) {
                this.backlogState = this.getDefaultBacklogState();
                this.setBacklogStatus(`Board data will be saved to ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`);
                return this.backlogState;
            }

            const file = await fileHandle.getFile();
            const raw = await file.text();
            parsed = raw ? JSON.parse(raw) : null;
            this.setBacklogStatus(`Board loaded from ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`, 'success');
        } catch (error) {
            if (error && error.name === 'NotFoundError') {
                this.backlogState = this.getDefaultBacklogState();
                this.setBacklogStatus(`Board data will be saved to ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`);
                return this.backlogState;
            }
            console.warn('Failed to load feature backlog file:', error);
            this.backlogState = this.getDefaultBacklogState();
            this.setBacklogStatus(`Could not read ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`, 'error');
            return this.backlogState;
        }

        const state = this.normalizeBacklogState(parsed);
        this.backlogState = state;
        return state;
    },

    async saveBacklogState() {
        if (!this.backlogState) return;
        try {
            const fileHandle = await this.getBacklogCheckpointFileHandle(true);
            if (!fileHandle) {
                this.setBacklogStatus(`Load a project folder to store the backlog in ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`, 'error');
                return;
            }
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(this.backlogState, null, 2));
            await writable.close();
            this.setBacklogStatus(`Board saved to ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`, 'success');
        } catch (error) {
            console.warn('Failed to save feature backlog file:', error);
            this.setBacklogStatus(`Could not save ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`, 'error');
        }
    },

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    buildFeatureIdeaPrompt(card) {
        const title = String(card && card.title || '').trim() || '[No Title Added]';
        const notes = String(card && card.notes || '').trim() || '[No Notes Added]';
        return `You are editing an existing html file app.

Implement this feature idea in the current codebase:

Feature Title:
${title}

Feature Notes:
${notes}

Requirements:
- Preserve existing behavior unless the feature requires a change.
- Keep the app compatible with an offline/file:// HTML workflow unless the codebase clearly uses another pattern.
- Use the existing structure and style of the app.
- Keep the implementation scoped to this feature idea.
- Return one copy/pasteable unified diff only, not complete files.
- Do not use markdown fences around the diff.
- Do not add custom wrapper marker lines.
- Include every changed file in the same diff.
- Use git-style file headers: diff --git a/<path> b/<path>, --- a/<path>, +++ b/<path>, and @@ hunks.
- Prefer small independent hunks; do not group unrelated replacements into one large hunk.
- Keep enough unchanged context around each hunk to identify the location uniquely.
- For new files, use --- /dev/null and +++ b/<relative/path>.
- Do not return snippets, ellipses, or step-by-step instructions.
- Do not include explanation text before or after the diff.`;
    },

    async buildFeatureIdeaPromptWithCode(card) {
        let output = this.buildFeatureIdeaPrompt(card);
        let appendedCode = false;

        if (!loadFolder || !loadFolder.fileHandle) {
            return { output, appendedCode, message: 'Load a project folder first if you want code appended.' };
        }

        if (typeof promptLab === 'undefined' || !promptLab || typeof promptLab.gatherCodebaseText !== 'function') {
            return { output, appendedCode, message: 'Prompt copied without code because Prompt Lab codebase append is unavailable.' };
        }

        try {
            const codeContext = await promptLab.gatherCodebaseText();
            if (codeContext && codeContext.trim()) {
                output += `\n\nCurrent codebase:\n--- CODEBASE ---\n${codeContext}`;
                appendedCode = true;
                return {
                    output,
                    appendedCode,
                    message: 'Feature prompt + codebase copied. Paste it into a new AI chat.'
                };
            }

            return { output, appendedCode, message: 'Prompt copied without code because the loaded project had no readable code files.' };
        } catch (error) {
            console.warn('Failed to append codebase context to feature prompt:', error);
            return { output, appendedCode, message: 'Prompt copied without code because code context generation failed.' };
        }
    },

    renderBacklogBoard() {
        const boardEl = document.getElementById('plan-backlog-board');
        if (!boardEl) return;
        const state = this.backlogState || this.getDefaultBacklogState();
        boardEl.innerHTML = this.backlogColumns.map(column => {
            const cards = state[column.id] || [];
            const cardsHtml = cards.length
                ? cards.map(card => `
                    <article class="plan-kanban-card" draggable="true" data-card-id="${this.escapeHtml(card.id)}" data-column-id="${this.escapeHtml(column.id)}">
                        <div class="plan-kanban-card-head">
                            <h6>${this.escapeHtml(card.title)}</h6>
                        </div>
                        ${card.notes ? `<p>${this.escapeHtml(card.notes)}</p>` : '<p class="plan-kanban-card-empty">No notes yet.</p>'}
                        <div class="plan-kanban-card-actions">
                            <button type="button" class="btn btn-sm btn-outline-secondary plan-kanban-copy-prompt" data-card-id="${this.escapeHtml(card.id)}" title="Copy AI prompt for this feature">Copy Prompt</button>
                            <button type="button" class="btn btn-sm btn-outline-primary plan-kanban-copy-prompt-with-code" data-card-id="${this.escapeHtml(card.id)}" title="Copy AI prompt with code for this feature">Copy Prompt + Code</button>
                            <button type="button" class="btn btn-sm btn-outline-danger plan-kanban-delete" data-card-id="${this.escapeHtml(card.id)}" title="Remove feature">Remove</button>
                        </div>
                    </article>
                `).join('')
                : '<div class="plan-kanban-empty">No features here yet.</div>';
            return `
                <section class="plan-kanban-column" data-column-id="${this.escapeHtml(column.id)}">
                    <div class="plan-kanban-column-head">
                        <h5>${this.escapeHtml(column.label)}</h5>
                        <span class="plan-kanban-count">${cards.length}</span>
                    </div>
                    <div class="plan-kanban-dropzone" data-column-id="${this.escapeHtml(column.id)}">
                        ${cardsHtml}
                    </div>
                </section>
            `;
        }).join('');
    },

    findCardLocation(cardId) {
        if (!this.backlogState || !cardId) return null;
        for (const column of this.backlogColumns) {
            const items = this.backlogState[column.id] || [];
            const index = items.findIndex(item => item.id === cardId);
            if (index >= 0) {
                return { columnId: column.id, index };
            }
        }
        return null;
    },

    moveBacklogCard(cardId, targetColumnId) {
        if (!cardId || !targetColumnId || !this.backlogState || !this.backlogState[targetColumnId]) return;
        const location = this.findCardLocation(cardId);
        if (!location) return;
        const [card] = this.backlogState[location.columnId].splice(location.index, 1);
        this.backlogState[targetColumnId].push(card);
        this.saveBacklogState();
        this.renderBacklogBoard();
    },

    deleteBacklogCard(cardId) {
        const location = this.findCardLocation(cardId);
        if (!location || !this.backlogState) return;
        this.backlogState[location.columnId].splice(location.index, 1);
        this.saveBacklogState();
        this.renderBacklogBoard();
    },

    getBacklogCardById(cardId) {
        const location = this.findCardLocation(cardId);
        if (!location || !this.backlogState) return null;
        return this.backlogState[location.columnId][location.index] || null;
    },

    resetBacklogBoard() {
        this.backlogState = this.getDefaultBacklogState();
        this.saveBacklogState();
        this.renderBacklogBoard();
    },

    toggleBacklogAddPanel(forceOpen = null) {
        const panel = document.getElementById('plan-backlog-add-panel');
        const button = document.getElementById('plan-backlog-add-toggle');
        if (!panel || !button) return;
        const shouldOpen = forceOpen === null ? panel.hidden : !!forceOpen;
        panel.hidden = !shouldOpen;
        button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        button.textContent = shouldOpen ? 'Close' : 'Add Feature Idea';
        if (shouldOpen) {
            const titleEl = document.getElementById('plan-feature-title');
            if (titleEl) titleEl.focus();
        }
    },

    async copyFeatureIdeaPrompt(cardId, btn, includeCode = false) {
        const card = this.getBacklogCardById(cardId);
        if (!card) {
            this.setBacklogStatus('Feature not found.', 'error');
            return;
        }

        const originalLabel = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Copying...';
        }

        try {
            const result = includeCode
                ? await this.buildFeatureIdeaPromptWithCode(card)
                : {
                    output: this.buildFeatureIdeaPrompt(card),
                    appendedCode: false,
                    message: 'Feature prompt copied. Paste it into AI.'
                };
            const copied = await (navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
                ? navigator.clipboard.writeText(result.output).then(() => true).catch(() => false)
                : Promise.resolve(false));

            if (copied) {
                this.setBacklogStatus(result.message || 'Feature prompt copied.', result.appendedCode ? 'success' : 'info');
                this.flashButton(btn, 'Copied', 'btn-success', includeCode ? 'btn-outline-primary' : 'btn-outline-secondary', originalLabel);
            } else {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = result.output;
                    ta.setAttribute('readonly', '');
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    ta.setSelectionRange(0, ta.value.length);
                    const fallbackOk = document.execCommand('copy');
                    document.body.removeChild(ta);
                    if (fallbackOk) {
                        this.setBacklogStatus(result.message || 'Feature prompt copied.', result.appendedCode ? 'success' : 'info');
                        this.flashButton(btn, 'Copied', 'btn-success', includeCode ? 'btn-outline-primary' : 'btn-outline-secondary', originalLabel);
                    } else {
                        this.setBacklogStatus('Copy failed. Try again.', 'error');
                    }
                } catch (_) {
                    this.setBacklogStatus('Copy failed. Try again.', 'error');
                }
            }
        } catch (error) {
            console.error('Failed to build feature idea prompt:', error);
            this.setBacklogStatus('Could not build the AI prompt for this feature.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                if (btn.textContent === 'Copying...') btn.textContent = originalLabel || 'Copy AI Prompt';
            }
        }
    },

    async addBacklogCardFromInputs() {
        const titleEl = document.getElementById('plan-feature-title');
        const notesEl = document.getElementById('plan-feature-notes');
        const title = titleEl ? titleEl.value.trim() : '';
        const notes = notesEl ? notesEl.value.trim() : '';
        if (!title) {
            this.setBacklogStatus('Enter a feature title before adding it.', 'error');
            if (titleEl) titleEl.focus();
            return;
        }
        if (!this.backlogState) await this.loadBacklogState();
        this.backlogState.backlog.push(this.createBacklogCard(title, notes));
        await this.saveBacklogState();
        this.renderBacklogBoard();
        if (titleEl) titleEl.value = '';
        if (notesEl) notesEl.value = '';
        this.toggleBacklogAddPanel(false);
    },

    bindBacklogEvents() {
        if (this.backlogEventsBound) return;
        const boardEl = document.getElementById('plan-backlog-board');
        const formEl = document.getElementById('plan-backlog-add-form');
        const addBtn = document.getElementById('plan-backlog-add-btn');
        const resetBtn = document.getElementById('plan-backlog-reset-btn');
        const addToggleBtn = document.getElementById('plan-backlog-add-toggle');
        if (!boardEl || !formEl || !addBtn || !resetBtn || !addToggleBtn) return;
        this.backlogEventsBound = true;

        addToggleBtn.addEventListener('click', () => {
            this.toggleBacklogAddPanel();
        });

        addBtn.addEventListener('click', async () => {
            await this.addBacklogCardFromInputs();
        });

        formEl.addEventListener('keydown', async event => {
            if (event.key !== 'Enter') return;
            const target = event.target;
            const isTextarea = target && target.tagName === 'TEXTAREA';
            if (isTextarea && !event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            await this.addBacklogCardFromInputs();
        });

        resetBtn.addEventListener('click', async () => {
            this.resetBacklogBoard();
        });

        boardEl.addEventListener('click', event => {
            const promptBtn = event.target.closest('.plan-kanban-copy-prompt');
            if (promptBtn) {
                const cardId = promptBtn.getAttribute('data-card-id');
                this.copyFeatureIdeaPrompt(cardId, promptBtn, false);
                return;
            }
            const promptWithCodeBtn = event.target.closest('.plan-kanban-copy-prompt-with-code');
            if (promptWithCodeBtn) {
                const cardId = promptWithCodeBtn.getAttribute('data-card-id');
                this.copyFeatureIdeaPrompt(cardId, promptWithCodeBtn, true);
                return;
            }
            const deleteBtn = event.target.closest('.plan-kanban-delete');
            if (!deleteBtn) return;
            const cardId = deleteBtn.getAttribute('data-card-id');
            this.deleteBacklogCard(cardId);
        });

        boardEl.addEventListener('dragstart', event => {
            const cardEl = event.target.closest('.plan-kanban-card');
            if (!cardEl) return;
            this.dragCardId = cardEl.getAttribute('data-card-id');
            this.dragSourceColumnId = cardEl.getAttribute('data-column-id');
            cardEl.classList.add('is-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', this.dragCardId || '');
            }
        });

        boardEl.addEventListener('dragend', event => {
            const cardEl = event.target.closest('.plan-kanban-card');
            if (cardEl) cardEl.classList.remove('is-dragging');
            boardEl.querySelectorAll('.plan-kanban-dropzone').forEach(zone => zone.classList.remove('is-active'));
            this.dragCardId = null;
            this.dragSourceColumnId = null;
        });

        boardEl.addEventListener('dragover', event => {
            const zone = event.target.closest('.plan-kanban-dropzone');
            if (!zone || !this.dragCardId) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });

        boardEl.addEventListener('dragenter', event => {
            const zone = event.target.closest('.plan-kanban-dropzone');
            if (!zone || !this.dragCardId) return;
            zone.classList.add('is-active');
        });

        boardEl.addEventListener('dragleave', event => {
            const zone = event.target.closest('.plan-kanban-dropzone');
            if (!zone) return;
            const related = event.relatedTarget;
            if (related && zone.contains(related)) return;
            zone.classList.remove('is-active');
        });

        boardEl.addEventListener('drop', event => {
            const zone = event.target.closest('.plan-kanban-dropzone');
            if (!zone || !this.dragCardId) return;
            event.preventDefault();
            zone.classList.remove('is-active');
            const targetColumnId = zone.getAttribute('data-column-id');
            if (!targetColumnId) return;
            this.moveBacklogCard(this.dragCardId, targetColumnId);
        });
    },

    init() {
        if (document.getElementById('ai-out1')) {
            this.generate(1);
            this.setStatus(1, 'Copy the prompt, paste it into AI, and the AI will begin the JTBD interview from scratch.');
        }
        if (document.getElementById('ai-out17')) {
            this.generate(17);
            this.setStatus(17, 'Copy the feature idea prompt if you want AI help seeding your backlog.');
        }
        this.initPlanViews();
        this.renderBacklogBoard();
        this.bindBacklogEvents();
        this.toggleBacklogAddPanel(false);
        const initToken = ++this.backlogInitToken;
        this.loadBacklogState()
            .then(() => {
                if (initToken !== this.backlogInitToken) return;
                this.renderBacklogBoard();
            })
            .catch(error => {
                console.warn('Failed to initialize feature backlog board:', error);
                this.setBacklogStatus(`Could not load ${this.backlogCheckpointFolder}/${this.backlogCheckpointFileName}.`, 'error');
            });
    },

    clear() {
        // Clear the active brainstorm prompt UI.
        for (const i of [1, 17]) {
            const ctx = document.getElementById('ai-ctx' + i);
            const out = document.getElementById('ai-out' + i);
            if (ctx) ctx.value = '';
            if (out) out.textContent = '';
            if (i === 1 && out) {
                this.generate(1);
                this.setStatus(1, 'Copy the prompt, paste it into AI, and the AI will begin the JTBD interview from scratch.');
            }
            if (i === 17 && out) {
                this.generate(17);
                this.setStatus(17, 'Copy the feature idea prompt if you want AI help seeding your backlog.');
            }
        }
    }
};
