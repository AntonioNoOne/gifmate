# Publishing gifmate

Nothing here runs by itself: each step is a decision.

## Before any release

```sh
npm install
npm test           # all green
npm run build      # refreshes dist/: commit it, the plugin runs dist/ without npm install
```

Then check a clean copy works: extract `git archive HEAD` somewhere outside the repo (no `node_modules`),
run `claude plugin validate <copy>`, and call the three tools of `node <copy>/dist/server.mjs` from an MCP client.

## 1. Claude Code organization library (Jump)

- Publish the repository folder with Claude Code's PublishPlugin (it shows every file before sending).
- A name already in the library is not overwritten ("name-conflict"): an admin removes the old `gifmate`
  from the organization library first, then publish the new version.
- Colleagues install with `/plugin install gifmate@claudeai-organization-library`.
- They need Node 20+ and a free GIPHY key (`node <plugin>/dist/server.mjs setup`, or `GIPHY_API_KEY`).
- The chat part (tray, inline GIFs) uses Claude Code mods (function hooks), an early-access feature that
  Claude Code asks to enable; without it the MCP tools still work.

## 2. GitHub (public)

- Create `AntonioNoOne/gifmate` (public), push `main`. The README's install line
  `/plugin install gifmate --marketplace AntonioNoOne/gifmate` works from then on.

## 3. npm (optional)

- `npm publish` makes `npx -y gifmate` work for Codex, Cursor, VS Code and Gemini CLI without cloning.
  `bin` runs the bundle in `dist/`, so the package needs nothing else.
