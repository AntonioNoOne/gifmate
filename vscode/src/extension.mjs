// gifmate panel: a GIPHY tray beside the coding agent. Pick a GIF and it is pasted into the chat you chose
// (Codex, Antigravity's agent), animated, with its middle frame first so the model sees the moment.
import * as vscode from "vscode";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { searchGiphy } from "../../src/giphy.mjs";
import { loadBytes, withCover } from "../../src/gif.mjs";
import { note } from "../../src/diary.mjs";
import { MIN_LENGTH, waitAfterTyping } from "../../mod/typing.ts";

// The chats a GIF can go to: the command that brings each one's message box into focus.
// Found in the editors themselves (2026-11-07): the Codex extension, Antigravity's agent panel (Ctrl+L).
const CHATS = [
  { id: "codex", label: "Codex", focus: ["chatgpt.openSidebar"], present: () => !!vscode.extensions.getExtension("openai.chatgpt") },
  { id: "clipboard", label: "Any chat (copy, then Ctrl+V): Antigravity, Claude..." },
];

class Picker {
  constructor(state) {
    this.state = state; // remembers the chosen chat
  }
  results = [];
  keystroke = 0;
  lastKeyAt = 0;
  gaps = [];
  searches = 0;

  resolveWebviewView(view) {
    this.view = view;
    const nonce = randomBytes(16).toString("hex");
    view.webview.options = { enableScripts: true };
    view.webview.html = page(nonce);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    void this.offerChats();
    this.search(""); // trending, so the panel is never empty
  }

  post(message) {
    this.view?.webview.postMessage(message);
  }

  // only the chats this editor has; the last one chosen, or the first found
  async offerChats() {
    // by what is installed, not by registered commands: Codex registers its own only once it activates,
    // and Antigravity's agent commands are not in the list at all (both seen 2026-11-07)
    this.chats = CHATS.filter((c) => !c.present || c.present());
    const saved = this.state.get("gifmate.chat");
    this.chat = this.chats.find((c) => c.id === saved) ?? this.chats[0];
    this.post({ type: "chats", items: this.chats.map(({ id, label }) => ({ id, label })), selected: this.chat.id });
  }

  async onMessage(m) {
    if (m.type === "chat") {
      this.chat = this.chats.find((c) => c.id === m.id) ?? this.chat;
      return this.state.update("gifmate.chat", this.chat.id);
    }
    if (m.type === "typed") return this.typed(m.text);
    if (m.type === "enter") {
      this.keystroke++; // Enter drops the pending typing timer
      return this.search(m.text.trim());
    }
    if (m.type === "pick") return this.pick(this.results[m.index]);
  }

  // Search once the person stops typing; the wait follows their pace (mod/typing.ts, tested).
  typed(text) {
    const mine = ++this.keystroke;
    const now = Date.now();
    if (this.lastKeyAt) this.gaps.push(now - this.lastKeyAt);
    if (this.gaps.length > 6) this.gaps.shift();
    this.lastKeyAt = now;
    const query = text.trim();
    setTimeout(() => {
      if (mine === this.keystroke && (query.length >= MIN_LENGTH || !query)) this.search(query);
    }, waitAfterTyping(this.gaps));
  }

  async search(query) {
    const seq = ++this.searches;
    this.post({ type: "status", text: query ? `Searching “${query}”…` : "Trending…" });
    try {
      const results = await searchGiphy(query, { limit: 12 });
      if (seq !== this.searches) return; // a newer search is on its way
      this.results = results;
      this.post({
        type: "results",
        items: results.map((r) => ({ title: r.title, preview: r.small })),
        status: results.length
          ? `${query ? "" : "Trending · "}click a GIF to send it to the chat · Powered by GIPHY`
          : `No GIF for “${query}”.`,
      });
    } catch (err) {
      this.post({ type: "status", text: String(err.message || err) });
    }
  }

  async pick(result) {
    if (!result) return;
    this.post({ type: "status", text: `Sending “${result.title}”…` });
    try {
      const dir = join(tmpdir(), "gifmate", "picked");
      await mkdir(dir, { recursive: true });
      // the file name is the title: it is what the agent reads as your message
      const name = `GIF ${result.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 80).trim() || "GIF"}.gif`;
      const file = join(dir, name);
      const bytes = await loadBytes(result.gif);
      let covered = bytes;
      try {
        covered = withCover(bytes); // the model sees the middle frame of a pasted GIF, not its first one
      } catch {}
      await writeFile(file, covered);
      void note({ kind: "picked", client: "gifmate-panel", gif: result.title.slice(0, 80) }).catch(() => {});
      // A chat draws an attached file as a name chip, a pasted image file as an image: so the GIF goes to the
      // clipboard as a file, then into the chosen chat as if the person pressed Ctrl+V there.
      const copied = await copyFile(file);
      if (!copied) {
        await vscode.env.clipboard.writeText(file);
        this.post({ type: "status", text: "GIF path copied: paste it in the chat" });
      } else if (this.chat?.focus) {
        try {
          let opened = false;
          for (const command of this.chat.focus) {
            try {
              await vscode.commands.executeCommand(command);
              opened = true;
              break;
            } catch {}
          }
          if (!opened) throw new Error("no command opened it");
          await new Promise((r) => setTimeout(r, 400));
          await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
          this.post({ type: "status", text: `Pasted in the ${this.chat.label} chat (not there? press Ctrl+V)` });
        } catch {
          this.post({ type: "status", text: `Could not open the ${this.chat.label} chat: the GIF is copied, press Ctrl+V there` });
        }
      } else {
        this.post({ type: "status", text: "GIF copied: press Ctrl+V in the chat" });
      }
    } catch (err) {
      this.post({ type: "status", text: `Could not send it: ${String(err.message || err)}` });
    }
  }
}

// Put a file (not its path) on the system clipboard. No window opens; false where it cannot.
function copyFile(file) {
  const run =
    process.platform === "win32"
      ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath $env:GIFMATE_FILE"]] // -Command glues extra args into the script
      : process.platform === "darwin"
        ? ["osascript", ["-e", "on run a", "-e", "set the clipboard to (POSIX file (item 1 of a))", "-e", "end run", file]]
        : null;
  if (!run) return Promise.resolve(false);
  return new Promise((resolve) => execFile(run[0], run[1], { windowsHide: true, timeout: 5000, env: { ...process.env, GIFMATE_FILE: file } }, (err) => resolve(!err)));
}

function page(nonce) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://*.giphy.com; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { padding: 8px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  input { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--vscode-input-border, transparent);
          background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
  #status { margin: 6px 0 8px; font-size: 11px; opacity: .7; }
  #grid { display: flex; flex-wrap: wrap; gap: 6px; }
  #grid img { height: 100px; border-radius: 6px; cursor: pointer; transition: transform .1s, outline-color .1s; outline: 2px solid transparent; }
  #grid img:hover { transform: scale(1.04); outline-color: var(--vscode-focusBorder); }
  #to { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 11px; opacity: .85; }
  select { flex: 1; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
           border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 4px; padding: 2px 4px; }
</style></head><body>
<label id="to">Send to <select id="chat"></select></label>
<input id="q" placeholder="Search a GIF…" autofocus>
<div id="status"></div><div id="grid"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const q = document.getElementById('q'), grid = document.getElementById('grid'), status = document.getElementById('status');
  const chat = document.getElementById('chat');
  chat.addEventListener('change', () => vscode.postMessage({ type: 'chat', id: chat.value }));
  q.addEventListener('input', () => vscode.postMessage({ type: 'typed', text: q.value }));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') vscode.postMessage({ type: 'enter', text: q.value }); });
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'status') status.textContent = data.text;
    if (data.type === 'chats') {
      chat.replaceChildren(...data.items.map(({ id, label }) => Object.assign(document.createElement('option'), { value: id, textContent: label })));
      chat.value = data.selected;
    }
    if (data.type === 'results') {
      status.textContent = data.status;
      grid.replaceChildren(...data.items.map((item, index) => {
        const img = document.createElement('img');
        img.src = item.preview; img.alt = item.title; img.title = item.title;
        img.addEventListener('click', () => vscode.postMessage({ type: 'pick', index }));
        return img;
      }));
    }
  });
</script></body></html>`;
}

export function activate(context) {
  const picker = new Picker(context.globalState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("gifmate.picker", picker, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("gifmate.open", () => vscode.commands.executeCommand("gifmate.picker.focus")),
  );
}

export function deactivate() {}
