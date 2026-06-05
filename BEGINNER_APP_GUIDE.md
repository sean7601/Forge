# Beginner App Guide (No Coding Experience Needed)

This guide is for people who are new to coding and not very comfortable with computers.

## 1. Open Forge

1. Open the Forge (Forge).
2. You will see two options:
   1. `I know what I'm doing`
   2. `I need some help getting started`
3. If you are new, click `I need some help getting started`.

## 2. Open an App Folder

1. Click `Open App Folder`.
2. In File Explorer, go to `Desktop` or `Documents` on your computer.
3. Do **not** use ShareDrive.
4. Click `New folder` (top-left in File Explorer).
5. Name it something simple, like `My First App`.
6. Click that folder once, then click `Select Folder`.
7. Allow permissions when prompted.

## 3. Let Forge Set Up Your Starter File

1. If Forge asks to create `index.html`, click yes/continue.
2. Forge will show a starter prompt and copy it to your clipboard.
3. Click through the next modal that tells you to use `AI Services`.

## 4. Use AI to Generate Your App

1. Click `AI Services`.
2. Choose a provider (GenAI.mil, Capra, or Google AI Studio).
3. In that AI chat:
   1. Paste the starter prompt.
   2. Add what you want your app to do in plain English.
4. Ask AI to return the **complete** `index.html` file.

## 5. Put AI Code Into Forge

1. Go back to Forge.
2. Open `index.html`.
3. Replace all content with the full code from AI.
4. Press `Ctrl+S` to save.

## 6. Run Your App

1. Open File Explorer.
2. Go to your project folder.
3. Double-click `index.html` to open your app in the browser.

## 7. Improve Your App (Iterate)

1. Decide one small change (example: "Add a search box").
2. Ask AI for that one change only.
3. Ask AI to return the full updated `index.html` file.
4. Paste it into Forge, replacing old code.
5. Save with `Ctrl+S`.
6. Re-open or refresh your `index.html` app in browser.
7. Repeat.

## 8. Start a New AI Chat with Existing Code

Use this when an AI chat gets too long or confused.

1. In Forge, click `Quick Prompts` (top editor bar).
2. Choose `Edit Code` or `Debug Code`.
3. Check `New conversation (append codebase)`.
4. Generate + copy the prompt, then start a new chat in your AI provider and paste it.
5. Ask for complete updated files (not snippets).

## 9. Before Sharing or Using CUI Data

1. In Forge, click the `Ship` button.
2. This compiles your app with recommended security settings (including security headers).
3. Use that shipped output before:
   1. Sending the app to other people.
   2. Putting any CUI-related data in the app.

## 10. If Something Breaks

1. Stay calm and do one step at a time.
2. Get error logs first:
   1. If available, open browser DevTools Console (`F12`) and copy red errors.
   2. On NMCI (where normal console tools may be blocked), use Forge `Dev Console` and copy errors from there.
3. In AI, paste your current `index.html` and the error/problem (plus copied logs).
4. Ask: "Please fix this and return the full updated index.html file."
5. Replace file in Forge, save, and test again.

## Quick Rules

1. Keep changes small.
2. Save often (`Ctrl+S`).
3. Use local folders (`Desktop`/`Documents`), not ShareDrive.
4. Always ask AI for the full file, not snippets.
5. Click `Ship` before sharing or handling CUI data.
