# gifmate

**Trade GIFs with your coding agent, like with a teammate, and let it get to know you.**

- **You → agent**: pick a GIF from a GIPHY tray right in the chat. The agent reads it the way a teammate
  would, as a message ("let's go!", "this is fine"), not as a picture to describe.
- **Agent → you**: at the moments that earn one (a bug hunted for days finally fixed, a long task done), the
  agent sends you a GIF that plays in the chat.
- **It learns you**: a small local diary records how GIFs land with you. Your own GIFs teach it what its
  messages make you feel, so the next time it is the one in tune.
- **Agents too**: when one agent hands a job to another (Claude to Codex, to a subagent), the handoff comes
  with a GIF, so you see at a glance who passed what to whom.
- **It watches GIFs**: share a screen recording of a bug and the agent sees it frame by frame (agents
  otherwise read only the first frame of an animated GIF).

Works with **Claude Code, Codex, Claude Desktop, Antigravity, Gemini CLI, Cursor, VS Code** and any
[MCP](https://modelcontextprotocol.io) client.

## Quick start

You need **Node 20+** (Windows, macOS, Linux).

```sh
npx -y gifmate init
```

`init` asks for a free GIPHY key if you have none ([get one in a minute](https://developers.giphy.com):
*Create an App*, choose **API**), finds the agents and editors on your machine and wires gifmate into each,
asking before every change. Then restart or reconnect your agent and type `/gif` (Claude Code), or just chat.

Prefer doing it by hand? See [Manual install](#manual-install).

## What works where

| | Claude Code | Codex (CLI, IDE, app) | Claude Desktop, Antigravity, Gemini CLI, Cursor, VS Code |
|---|---|---|---|
| Agent watches a GIF (file or URL) | ✓ | ✓ | ✓ |
| Agent sends GIFs at the right moments | ✓ plays inline | ✓ as a local image in the chat | ✓ where the chat draws local images, else a link |
| You send a GIF | `/gif` tray in the chat | GIF panel beside the chat (VS Code-family editors; other chats by Ctrl+V) | `/gif cat` shows a numbered gallery, you answer with a number (a `/gif` skill ships for agents that read skills, like Antigravity's) |
| Agent-to-agent handoffs with a GIF | ✓ plays inline | ✓ | ✓ where local images are drawn |
| Reaction diary, calibrate / quiet modes | ✓ | ✓ | ✓ |

Claude Code's tray and inline GIFs use Claude Code *mods* (plugin hooks), an early-access feature it asks
once to turn on; without them the tools still work. Tested on Windows; macOS is still to be tried.

## Use

**In Claude Code**

- `/gif` opens the tray with what is trending; type to search, results follow as you type.
- **➤ Send** sends a GIF now. **📎 Attach** keeps it for your next message: write, press Enter, both go together.
- `deploy done /gif lets go`: `/gif` anywhere in a sentence keeps your words and opens the tray on the rest.

**In VS Code, Cursor or Antigravity**: the **GIF** icon in the activity bar opens the panel. Choose where
GIFs go (**Send to**): Codex gets it pasted for you; for any other chat (Antigravity's agent, Claude...) the GIF
is copied and you press Ctrl+V. Search, click a GIF: it arrives animated. (Codex shows the model one frame of a
pasted GIF, so the panel puts the GIF's middle frame first: the model sees the moment, you see the animation.)

**Anywhere**: "What happens in this GIF? `~/Downloads/bug.gif`" and the agent watches it frame by frame.

## It gets to know you

Every GIF you trade goes into a **reaction diary** on your machine: the moment, the GIF's title, how it landed.

- **In tune.** A GIF you send is how the agent's last message made you feel. When that kind of moment comes
  again, it sends you that feeling first. Only positive or playful GIFs count as examples: a bitter
  "this is fine" is your mood, and keeps the agent's GIFs away for an hour.
- **The situation decides**, not the label. A bug hunted for days (*hard-won*) is not a quick one
  (*ordinary*). Three brakes stop any GIF: a slip of the agent's own, you under stress, a sensitive context
  (security, data, money, a client, production).
- **Calibrate, then quiet.** At first the agent asks, now and then, if a GIF fit (👍/👎). Once it has enough
  clear signal (5 GIFs over 3 days and 2 kinds of moment, 3 clear reactions, no recent "no") it says so once and only watches.
- **The pace is enforced by gifmate**, not left to the agent: 30 minutes between its GIFs, 4 a day.
  A GIF you asked for, or a reply to your playful one, always goes through.

| Command | What it does |
|---|---|
| `/gif mode calibrate` · `/gif mode quiet` | switch modes at any time |
| `/gif profile` | the agent tells you what it learned |
| `/gif forget` | erases the diary |

## Between agents

When an agent hands a job to another one, or reports a result back, `gif_handoff` wraps the message in a GIF
("on it", "your turn", "done"): you see the GIF and `→ Codex: review the diff` in the chat. The agent sends
the returned message through its own channel (a subagent, another session, `codex exec`); gifmate shows the
handoff, it does not deliver it. The written request is always the command: an agent receiving a GIF acts on
the words, never on the GIF alone.

## Tools (MCP API)

| Tool | For | What it does |
|---|---|---|
| `gif_view` | agent | Frames of a GIF (file or URL), evenly spaced in time, with timestamps (`max_frames` 2–24, default 12). |
| `gif_search` | agent | Searches GIPHY (`query`, `limit`; empty query = trending). Italian reaction words are translated. |
| `gif_send` | agent | Sends a GIF. Takes `source`, `moment` (`task_done`, `bug_fixed`, `our_mistake_fixed`, `good_news`, `kickoff`, `signoff`, `banter`, `asked`), `intensity` (`ordinary`, `hard_won`), `brakes` (`own_fault`, `user_stressed`, `sensitive`). May answer "not now". |
| `gif_note` | agent | Writes to the diary: `reaction`, `lesson`, `user_gif` (with `feeling` and `tone`), `missed`. |
| `gif_profile` | agent | Reads the diary back (mode, pace, what worked, in-tune examples); sets the mode or forgets. |
| `gif_handoff` | agent | Wraps a handoff to another agent in a GIF (`to`, `request`, `feeling` or `source`); returns the message to send. |
| `gif_pick` | the tray | Prepares a GIF the user picked. Agents do not call it. |

The etiquette (when to send a GIF, how to read one) travels with the server as MCP instructions and in the
tool descriptions, so every client gets it.

## Manual install

**Claude Code**

```
/plugin marketplace add AntonioNoOne/gifmate
/plugin install gifmate@gifmate
```

**Codex**: `codex plugin marketplace add AntonioNoOne/gifmate` then `codex plugin add gifmate@gifmate`, or
`codex mcp add gifmate -- npx -y gifmate`. To let its tools run without asking, in `~/.codex/config.toml`:

```toml
[mcp_servers.gifmate]
default_tools_approval_mode = "approve"
```

**Gemini CLI**: `gemini extensions install https://github.com/AntonioNoOne/gifmate`

**Antigravity's agent**: add the server to `~/.gemini/config/mcp_config.json` (as for Claude Desktop below) and
copy `agent-skills/gif/` to `~/.gemini/config/skills/gif/` for the `/gif` command. `gifmate init` does both.

**Claude Desktop, Cursor, VS Code and other MCP clients**: run the server with `npx -y gifmate`.

- Claude Desktop, `claude_desktop_config.json`: `{ "mcpServers": { "gifmate": { "command": "npx", "args": ["-y", "gifmate"] } } }`
- Cursor, `~/.cursor/mcp.json`: same as Claude Desktop.
- VS Code, user `mcp.json`: `{ "servers": { "gifmate": { "type": "stdio", "command": "npx", "args": ["-y", "gifmate"] } } }`

**GIF panel** for VS Code, Cursor, Antigravity: `gifmate init` installs it; by hand, download
`gifmate-panel-*.vsix` from the [latest release](https://github.com/AntonioNoOne/gifmate/releases/latest) and run
`code --install-extension <file>` (or `cursor`, `antigravity-ide`).

**GIPHY key**: `npx -y gifmate init`, or a `GIPHY_API_KEY` environment variable (it wins). The key is saved
in `%APPDATA%\gifmate\config.json` (Windows) or `~/.config/gifmate/config.json` (macOS, Linux).
A free key allows 100 searches an hour; repeated searches are remembered for 10 minutes.

## Privacy

- **What leaves your machine**: GIPHY searches (with your key, as GIPHY's API requires) and the download of
  any GIF URL you or the agent give to a tool, which the host of that URL sees like any download.
- The **diary** is one file next to the key (`diary.jsonl`): labels only (moment, GIF title, outcome, a note of
  at most 140 characters), never the conversation. `/gif forget` deletes it.
- When the agent watches a GIF, its frames become part of the conversation and reach your model provider like
  any image you paste. `gif_view` can read any GIF your user can read: keep tool approvals on if that matters.
- The key is stored in plain text in your user config folder; protect it like any local token.
- Sent GIFs and previews live in your temp folder (`gifmate/`) and are removed after a day.
- URLs pointing at your machine or local network are refused (checked on the address actually connected to);
  downloads stop at 20 MB and 15 seconds; GIFs over 4096×4096 or 2000 frames are not decoded.

## How it works

GIFs are decoded in pure JavaScript ([omggif](https://github.com/deanm/omggif)), every frame composited as a
browser draws it. `gif_view` returns frames as PNG. For Claude Code's chat, `gif_send` turns a GIF into an SVG
that plays its frames with SMIL, because chat panels draw SVG as an image and an image does not animate a GIF
nested inside an SVG. The diary is plain JSON lines; everything the agent reads from it is computed on the fly.

## Develop

```sh
npm install
npm test
npm run build                         # dist/: the bundled server the plugins run
cd vscode && npm run package          # the GIF panel's .vsix
```

Search results powered by GIPHY. MIT license.
