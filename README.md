# gifmate

Send GIFs to your coding agent, and get GIFs back, like with a teammate.

Agents read only the first frame of an animated GIF, so a screen recording of a bug
or a reaction GIF reaches them as a still picture. gifmate is a small
[MCP](https://modelcontextprotocol.io) server that fixes both directions:

- **`gif_view`**: you share a GIF (local path or URL), the agent receives frames
  evenly spaced in time, in order, with timestamps, and follows the motion.
- **`gif_search`**: the agent searches [GIPHY](https://developers.giphy.com) and
  replies with a GIF, as a markdown image.

It works with any MCP client: Claude Code, Codex, Cursor and others. Windows and
macOS, Node 18 or later, no ffmpeg.

## Install

`gif_search` needs a free GIPHY API key from <https://developers.giphy.com>, set as
`GIPHY_API_KEY`. `gif_view` needs nothing.

**Claude Code**

```sh
claude mcp add gifmate --scope user -e GIPHY_API_KEY=your-key -- npx -y gifmate
```

or as a plugin: `/plugin install gifmate --marketplace AntonioNoOne/gifmate`
(it reads `GIPHY_API_KEY` from your environment).

**Codex**

```sh
codex mcp add gifmate --env GIPHY_API_KEY=your-key -- npx -y gifmate
```

Codex asks before each MCP tool call. To let gifmate run without asking, add to
`~/.codex/config.toml`:

```toml
[mcp_servers.gifmate]
default_tools_approval_mode = "approve"
```

**Cursor, Windsurf and other clients**: add to the client's MCP settings:

```json
{ "mcpServers": { "gifmate": { "command": "npx", "args": ["-y", "gifmate"], "env": { "GIPHY_API_KEY": "your-key" } } } }
```

## Use

- "What happens in this GIF? `C:\Users\me\Downloads\bug.gif`"
- "Look at <https://example.com/demo.gif> and tell me when the button turns red."
- "Tests are green, send me a celebration GIF."

Whether a GIF sent back shows animated depends on the client: chat panels that
render markdown images show it; a plain terminal shows the link.

## How it works

The GIF is decoded in pure JavaScript ([omggif](https://github.com/deanm/omggif)),
every frame is composited as a browser would draw it, then up to 12 frames (2 to 24
with `max_frames`) are picked at even time intervals, first and last included, and
returned as PNG images no larger than 384 px.

Local files never leave your machine. Search queries go to GIPHY.
Search results are powered by GIPHY.

## Develop

```sh
npm install
npm test
```

MIT license.
