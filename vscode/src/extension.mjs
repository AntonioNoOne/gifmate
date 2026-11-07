// gifmate panel: a GIPHY tray beside the coding agent. Pick a GIF and it is attached to the Codex chat,
// named after its title, so the agent reads it as your message (gifmate's rules).
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

const ATTACH = "chatgpt.addFileToThread"; // the Codex extension's "Add File to Codex Chat"
const OPEN_CODEX = "chatgpt.openSidebar"; // focuses the Codex chat

class Picker {
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
    this.search(""); // trending, so the panel is never empty
  }

  post(message) {
    this.view?.webview.postMessage(message);
  }

  async onMessage(m) {
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
      void note({ kind: "user_gif", client: "gifmate-panel", gif: result.title, note: "picked in the panel" }).catch(() => {});
      // Codex draws an attached file as a name chip only; a pasted image file it draws as an image.
      // So the GIF also goes to the clipboard as a file, for Ctrl+V into the message.
      const copied = await copyFile(file);
      const commands = await vscode.commands.getCommands(true);
      if (copied && commands.includes(OPEN_CODEX)) {
        // as if the person pressed Ctrl+V in the Codex composer: focus it, then paste
        await vscode.commands.executeCommand(OPEN_CODEX);
        await new Promise((r) => setTimeout(r, 400));
        await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
        this.post({ type: "status", text: "Pasted in the Codex chat (not there? press Ctrl+V)" });
      } else if (commands.includes(ATTACH)) {
        await vscode.commands.executeCommand(ATTACH, vscode.Uri.file(file));
        this.post({ type: "status", text: "Attached to the Codex chat" });
      } else {
        if (!copied) await vscode.env.clipboard.writeText(file);
        this.post({ type: "status", text: copied ? "GIF copied: press Ctrl+V in the chat" : "GIF path copied: paste it in the chat" });
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
</style></head><body>
<input id="q" placeholder="Search a GIF…" autofocus>
<div id="status"></div><div id="grid"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const q = document.getElementById('q'), grid = document.getElementById('grid'), status = document.getElementById('status');
  q.addEventListener('input', () => vscode.postMessage({ type: 'typed', text: q.value }));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') vscode.postMessage({ type: 'enter', text: q.value }); });
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'status') status.textContent = data.text;
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
  const picker = new Picker();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("gifmate.picker", picker, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("gifmate.open", () => vscode.commands.executeCommand("gifmate.picker.focus")),
  );
}

export function deactivate() {}
