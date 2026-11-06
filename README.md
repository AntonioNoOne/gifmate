# gifmate

Trade GIFs with your coding agent, like with a teammate.

- **You → agent**: send a GIF from a GIPHY tray right in the chat (`/gif`). The agent takes it the way a
  teammate would: as a message ("let's go!", "this is fine"), not as a picture to describe.
  Share a GIF file instead (a screen recording of a bug) and the agent watches it frame by frame.
- **Agent → you**: the agent picks a GIF on GIPHY and it plays inline in the chat.

Agents read only the first frame of an animated GIF. gifmate is an
[MCP](https://modelcontextprotocol.io) server that hands them frames evenly spaced in time, plus a
Claude Code plugin that draws GIFs in the chat and adds the `/gif` tray.

## What works where

| | Claude Code | Codex, Cursor, VS Code, Gemini CLI |
|---|---|---|
| Agent watches a GIF (file or URL) | yes | yes |
| Agent searches and picks GIFs, following the etiquette rules | yes | yes |
| GIF plays inline in the chat | yes (plugin) | no: you get the local file path |
| `/gif` tray to send a GIF | yes (plugin) | no |

The inline GIFs and the tray use Claude Code *mods* (plugin hooks), an early-access feature: Claude Code
asks once whether to turn them on. Without them the MCP tools still work everywhere.

## Install

You need **Node 20 or later** (Windows, macOS, Linux). Nothing else: the server in `dist/` is bundled and
needs no `npm install`. Searching GIPHY needs a free API key from <https://developers.giphy.com>
(Create an App, choose **API**); watching GIFs needs nothing.

**Claude Code** (plugin: MCP server, `/gif` tray, inline GIFs)

```
/plugin marketplace add AntonioNoOne/gifmate
/plugin install gifmate@gifmate
```

In a company that publishes it to its organization library: `/plugin install gifmate@claudeai-organization-library`.

**Codex CLI** (plugin: MCP server; the Claude mod is not loaded)

```sh
codex plugin marketplace add AntonioNoOne/gifmate
codex plugin add gifmate@gifmate
```

Codex asks before each MCP tool call. To let gifmate's tools run without asking, add to `~/.codex/config.toml`:

```toml
[plugins."gifmate@gifmate".mcp_servers.gifmate]
default_tools_approval_mode = "approve"
```

**Gemini CLI** (extension): `gemini extensions install https://github.com/AntonioNoOne/gifmate`

**Cursor, VS Code and other MCP clients**: clone the repository and point the client at the bundled server
(on Windows write paths with `/`):

```sh
git clone https://github.com/AntonioNoOne/gifmate
```

- Cursor, `~/.cursor/mcp.json`: `{ "mcpServers": { "gifmate": { "command": "node", "args": ["/path/to/gifmate/dist/server.mjs"] } } }`
- VS Code, user `mcp.json`: `{ "servers": { "gifmate": { "type": "stdio", "command": "node", "args": ["/path/to/gifmate/dist/server.mjs"] } } }`
- Codex without the plugin: `codex mcp add gifmate -- node /path/to/gifmate/dist/server.mjs`

**GIPHY key**: run once

```sh
node /path/to/gifmate/dist/server.mjs setup
```

It saves the key in your user config (`%APPDATA%\gifmate\config.json` on Windows,
`~/.config/gifmate/config.json` on macOS and Linux). A `GIPHY_API_KEY` environment variable works too and wins.

## Use

- `/gif` opens the tray above the prompt with what is trending; type to search (results follow as you type;
  Italian reaction words are translated, since GIPHY finds little in Italian).
- **➤ Invia** sends a GIF now. **📎 Allega** attaches it to your next message: write, press Enter, both go together.
- `deploy done /gif lets go`: `/gif` anywhere in a sentence keeps your words and opens the tray on the rest.
- "What happens in this GIF? `C:\Users\me\Downloads\bug.gif`": the agent watches it frame by frame.
- The agent sends GIFs on its own only when the moment earns one (a hard-won win, good news, a kickoff),
  never when something broke; a GIF you send is read as a message, not described back.

A free GIPHY key allows 100 searches an hour; repeated searches are remembered for 10 minutes. GIPHY offers
production keys with higher limits on request.

## Privacy

- Searches go to GIPHY, with your key (in the request, as GIPHY's API requires).
- The key is stored in plain text in your user config folder; protect it like any other local token.
- `gif_view` and `gif_send` can read any GIF file your user can read. When the agent watches one, its
  frames become part of the conversation and reach your model provider like any image you paste: keep your
  client's tool approvals on if that matters. gifmate itself uploads no file anywhere.
- Sent GIFs and previews are kept in your temp folder (`gifmate/`) so the chat can draw them, and removed after a day.
- URLs pointing at your machine or local network (localhost, 10.x, 192.168.x, IPv6 local ranges, ...) are
  refused, checked on the address actually connected to; downloads
  stop at 20 MB and 15 seconds in all (redirects included), and GIFs over 4096×4096 or 2000 frames are not decoded.

## How it works

The GIF is decoded in pure JavaScript ([omggif](https://github.com/deanm/omggif)) and every frame is
composited as a browser would draw it. `gif_view` returns up to 12 frames (2–24 with `max_frames`) at even
time intervals as PNG. For the chat, `gif_send` turns the GIF into an SVG that plays its frames with SMIL,
because chat panels draw SVG as an image, and an image does not animate a GIF nested inside an SVG.

Search results are powered by GIPHY.

## Develop

```sh
npm install
npm test
npm run build   # refreshes dist/server.mjs, the bundled server (and its preview worker) the plugin runs
```

MIT license.
