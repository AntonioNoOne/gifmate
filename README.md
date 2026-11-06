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

| | Claude Code (VS Code, desktop) | Codex, Cursor, other MCP clients |
|---|---|---|
| Agent watches a GIF (file or URL) | yes | yes |
| Agent searches GIPHY | yes | yes |
| GIF plays inline in the chat | yes (plugin) | no: you get the local file path |
| `/gif` tray to send a GIF | yes (plugin) | no |

The inline GIFs and the tray use Claude Code *mods* (plugin hooks), an early-access feature: Claude Code
asks once whether to turn them on. Without them the MCP tools still work everywhere.

## Install

You need Node 18 or later. Searching GIPHY needs a free API key from
<https://developers.giphy.com> (Create an App, choose **API**); watching GIFs needs nothing.

**Claude Code**: inside Claude Code run

```
/plugin install gifmate --marketplace AntonioNoOne/gifmate
```

**Codex, Cursor and others**: clone the repository and point your client at the bundled server,
which needs no `npm install`:

```sh
git clone https://github.com/AntonioNoOne/gifmate
codex mcp add gifmate -- node /path/to/gifmate/dist/server.mjs
```

```json
{ "mcpServers": { "gifmate": { "command": "node", "args": ["/path/to/gifmate/dist/server.mjs"] } } }
```

Codex asks before each MCP tool call; to let gifmate run without asking, add
`default_tools_approval_mode = "approve"` under `[mcp_servers.gifmate]` in `~/.codex/config.toml`.

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

- Searches go to GIPHY, with your key.
- When the agent watches a GIF, its frames become part of the conversation, so they reach your model
  provider like any image you paste. The GIF file itself is not uploaded anywhere by gifmate.
- Sent GIFs and previews are kept in your temp folder (`gifmate/`) so the chat can draw them, and removed after a day.
- URLs pointing at your machine or local network (localhost, 10.x, 192.168.x, ...) are refused, downloads
  stop at 20 MB and 15 seconds, and GIFs over 4096×4096 are not decoded.

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
