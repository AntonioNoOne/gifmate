# Publishing gifmate

Nothing here runs by itself: each step is a decision.

## Before any release

```sh
npm install
npm test           # all green
npm run build      # refreshes dist/: commit it, every client runs dist/ without npm install
```

Then check a clean copy works: extract `git archive HEAD` somewhere outside the repo (no `node_modules`),
run `claude plugin validate <copy>`, and call the three tools of `node <copy>/dist/server.mjs` from an MCP client.

## What is in the package, per client

| Client | Files it reads | Checked on 2026-11-06 (Windows) |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` (MCP server, `mod/` hooks), `.claude-plugin/marketplace.json`, `commands/gif.md` | validate, tray, inline GIFs, mod load |
| Codex CLI | `plugin.json`, `mcp.json`, `.agents/plugins/marketplace.json` (`hooks: []`: the Claude mod is not loaded) | install from a local marketplace, `gif_view` called |
| Gemini CLI | `gemini-extension.json` | install, server "Connected" (no model call made) |
| Cursor, VS Code | config snippets in the README | not installed here |

Not yet tried: macOS, Node 20 exactly (tested on Node 24), Cursor and VS Code Copilot.

## 1. Claude Code organization library (Jump)

- Publish the repository folder with Claude Code's PublishPlugin (it shows every file before sending).
- A name already in the library is not overwritten ("name-conflict"): an admin removes the old `gifmate`
  from the organization library first, then publish the new version.
- Colleagues install with `/plugin install gifmate@claudeai-organization-library`.
- They need Node 20+ and a free GIPHY key (`node <plugin>/dist/server.mjs setup`, or `GIPHY_API_KEY`).
- The chat part (tray, inline GIFs) uses Claude Code mods (function hooks), an early-access feature that
  Claude Code asks to enable; without it the MCP tools still work.

## 2. GitHub (public)

- Create `AntonioNoOne/gifmate` (public), push `main`. From then on the README's install lines work for
  Claude Code (`/plugin marketplace add AntonioNoOne/gifmate`), Codex (`codex plugin marketplace add
  AntonioNoOne/gifmate`) and Gemini (`gemini extensions install https://github.com/AntonioNoOne/gifmate`).

## 3. npm (optional)

- `npm publish` makes `npx -y gifmate` work for any MCP client without cloning. `bin` runs the bundle in
  `dist/`, so the package needs nothing else.
