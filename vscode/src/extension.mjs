// gifmate panel: a GIPHY tray beside the coding agent. Pick a GIF and it is attached to the Codex chat,
// named after its title, so the agent reads it as your message (gifmate's rules).
import * as vscode from "vscode";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { searchGiphy } from "../../src/giphy.mjs";
import { loadBytes } from "../../src/gif.mjs";
import { MIN_LENGTH, waitAfterTyping } from "../../mod/typing.ts";

const ATTACH = "chatgpt.addFileToThread"; // the Codex extension's "Add File to Codex Chat"

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
    this.post({ type: "status", text: query ? `Cerco “${query}”…` : "Di tendenza…" });
    try {
      const results = await searchGiphy(query, { limit: 12 });
      if (seq !== this.searches) return; // a newer search is on its way
      this.results = results;
      this.post({
        type: "results",
        items: results.map((r) => ({ title: r.title, preview: r.small })),
        status: results.length
          ? `${query ? "" : "Di tendenza · "}clic su una GIF per allegarla alla chat · Powered by GIPHY`
          : `Nessuna GIF per “${query}”.`,
      });
    } catch (err) {
      this.post({ type: "status", text: String(err.message || err) });
    }
  }

  async pick(result) {
    if (!result) return;
    this.post({ type: "status", text: `Allego “${result.title}”…` });
    try {
      const dir = join(tmpdir(), "gifmate", "picked");
      await mkdir(dir, { recursive: true });
      // the file name is the title: it is what the agent reads as your message
      const name = `GIF ${result.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 80).trim() || "GIF"}.gif`;
      const file = join(dir, name);
      await writeFile(file, await loadBytes(result.gif));
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes(ATTACH)) {
        await vscode.commands.executeCommand(ATTACH, vscode.Uri.file(file));
        this.post({ type: "status", text: `Allegata alla chat di Codex: scrivi il messaggio e invia` });
      } else {
        await vscode.env.clipboard.writeText(file);
        this.post({ type: "status", text: "Codex non trovato: percorso della GIF copiato, incollalo nella chat" });
      }
    } catch (err) {
      this.post({ type: "status", text: `Non sono riuscito ad allegarla: ${String(err.message || err)}` });
    }
  }
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
<input id="q" placeholder="Cerca una GIF… (anche in italiano)" autofocus>
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
