# Publishing gifmate

Nothing here runs by itself: each step is a decision.

## Before any release

```sh
npm install
npm test                      # all green
npm run build                 # refreshes dist/: commit it, plugins run dist/ without npm install
cd vscode && npm run package  # the GIF panel's .vsix (git-ignored: it ships in the npm package and on the GitHub release)
```

Then check a clean copy: extract `git archive HEAD` outside the repo (no `node_modules`), run
`claude plugin validate <copy>`, and call the tools of `node <copy>/dist/server.mjs` from an MCP client.
`npm pack --dry-run` lists what the npm package will hold.

## What is in the package, per client

| Client | Files it reads | Checked (Windows) |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` (MCP server, `mod/` hooks), `.claude-plugin/marketplace.json`, `commands/gif.md` | validate, tray, inline GIFs, mod load |
| Codex CLI / IDE | `plugin.json`, `mcp.json`, `.agents/plugins/marketplace.json` (`hooks: []`) | local marketplace install, tools, local images in chat |
| GIF panel | `vscode/gifmate-panel-*.vsix` | Antigravity + Codex: search, paste with middle-frame cover |
| Gemini CLI | `gemini-extension.json` | install, server "Connected" (no model call made) |
| Claude Desktop | `claude_desktop_config.json` written by `gifmate init` | config path found (Store build); chat not tried |
| Cursor, VS Code Copilot | README snippets | not tried |

Not yet tried: macOS (the panel's clipboard paste uses `osascript` there), Linux, Node 20 exactly (tested on
Node 24), the Codex desktop app, Claude Desktop's chat.

## 1. GitHub (public)

- Create `AntonioNoOne/gifmate` (public), push `main`, attach the `.vsix` to a release.
- From then on these work: `/plugin marketplace add AntonioNoOne/gifmate` (Claude Code),
  `codex plugin marketplace add AntonioNoOne/gifmate`, `gemini extensions install https://github.com/AntonioNoOne/gifmate`.

## 2. npm

- `npm publish` (after `npm pack --dry-run`). It makes the README's quick start true: `npx -y gifmate init`,
  and `npx -y gifmate` as the MCP server for any client. Until then, the README's `npx` lines do not work.

## 3. VS Code Marketplace / Open VSX (optional)

- The panel needs a publisher account (`vsce publish`, `ovsx publish`). Until then it installs from the `.vsix`.

## 4. Claude Code organization library (Jump)

- Publish the repository folder with Claude Code's PublishPlugin (it shows every file before sending).
- A name already in the library is not overwritten: an admin removes the old `gifmate` first.
- Colleagues install with `/plugin install gifmate@claudeai-organization-library`, then `npx -y gifmate init`
  (or a `GIPHY_API_KEY` variable) for the key.
