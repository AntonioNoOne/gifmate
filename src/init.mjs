// `gifmate init`: one step for whoever installs it. Asks for the GIPHY key if missing, finds the agents and
// editors on this machine and wires gifmate into each, asking before every change (--yes accepts all).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { giphyKey, saveGiphyKey } from "./config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url))); // src/ or dist/ -> the package
const server = join(root, "dist", "server.mjs");
const win = process.platform === "win32";
// run from npx, the package sits in a cache that gets cleaned: then point everything at stable sources
const fromClone = existsSync(join(root, ".git"));
const mcp = fromClone ? ["node", server] : ["npx", "-y", "gifmate"];
const REPO = "AntonioNoOne/gifmate";

const found = (cmd) => spawnSync(win ? "where" : "which", [cmd], { encoding: "utf-8", windowsHide: true }).status === 0;
const quote = (a) => (/\s/.test(a) ? `"${a}"` : a);
// Windows .cmd shims (claude, codex, code...) only start through cmd.exe, which reads the line as shell:
// so every argument must be plain (letters, digits, path characters), or the step is refused.
const PLAIN = /^[\w .,:@+=\\/-]+$/;
function run(cmd) {
  const odd = cmd.find((a) => !PLAIN.test(a));
  if (odd) throw new Error(`refused: unusual characters in "${odd}"`);
  const r = win
    ? spawnSync(cmd.map(quote).join(" "), { stdio: "inherit", shell: true, windowsHide: true })
    : spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
  return r.status === 0;
}

// Claude Desktop (chat app) reads MCP servers from one JSON file; gifmate is merged in, nothing else touched
// on Windows the Microsoft Store build keeps it inside its package folder (LocalCache\Roaming\Claude)
const storeClaude = () => {
  const packages = join(process.env.LOCALAPPDATA ?? "", "Packages");
  const pkg = existsSync(packages) ? readdirSync(packages).find((d) => /^Claude_/.test(d)) : null;
  return pkg ? join(packages, pkg, "LocalCache", "Roaming", "Claude") : null;
};
const desktopConfig = () =>
  win
    ? join(existsSync(join(process.env.APPDATA ?? "", "Claude")) ? join(process.env.APPDATA, "Claude") : (storeClaude() ?? join(process.env.APPDATA ?? "", "Claude")), "claude_desktop_config.json")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : join(homedir(), ".config", "Claude", "claude_desktop_config.json");
function addToDesktop() {
  const file = desktopConfig();
  const before = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const config = JSON.parse(before || "{}");
  config.mcpServers = { ...config.mcpServers, gifmate: { command: mcp[0], args: mcp.slice(1) } };
  if (before) writeFileSync(`${file}.bak`, before); // the previous config, untouched
  writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
  return true;
}

function steps() {
  const list = [];
  if (existsSync(dirname(desktopConfig())))
    list.push({ what: "Claude Desktop: the MCP server (restart the app after)", cmds: [], apply: addToDesktop, show: `add "gifmate" to ${desktopConfig()} (backup: .bak)` });
  if (found("claude") && existsSync(join(root, ".claude-plugin"))) {
    list.push({
      what: "Claude Code: the plugin (tools, in-chat GIF tray, inline GIFs)",
      cmds: [
        ["claude", "plugin", "marketplace", "add", fromClone ? root : REPO],
        ["claude", "plugin", "install", "gifmate@gifmate"],
      ],
    });
  }
  if (found("codex")) list.push({ what: "Codex: the MCP server", cmds: [["codex", "mcp", "add", "gifmate", "--", ...mcp]] });
  if (found("gemini") && existsSync(join(root, "gemini-extension.json")))
    list.push({ what: "Gemini CLI: the extension", cmds: [["gemini", "extensions", "install", fromClone ? root : `https://github.com/${REPO}`]] });
  const vsix = existsSync(join(root, "vscode")) ? readdirSync(join(root, "vscode")).filter((f) => f.endsWith(".vsix")).sort().at(-1) : null;
  if (vsix) {
    for (const [editor, cli] of [["VS Code", "code"], ["Cursor", "cursor"], ["Antigravity", "antigravity-ide"]]) {
      if (found(cli)) list.push({ what: `${editor}: the GIF panel beside the agent's chat`, cmds: [[cli, "--install-extension", join(root, "vscode", vsix)]] });
    }
  }
  return list;
}

export async function init(args = []) {
  const yes = args.includes("--yes") || args.includes("-y");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // no terminal (piped, closed): every question counts as "no"
  let closed = false;
  rl.on("close", () => (closed = true));
  const answer = async (q) => {
    if (closed) return "";
    try {
      return await rl.question(q);
    } catch {
      return "";
    }
  };
  const ask = async (q) => yes || /^y/i.test((await answer(`${q} [y/N] `)).trim());
  try {
    console.log("gifmate: trade GIFs with your coding agent.\n");
    if (await giphyKey()) {
      console.log("✓ GIPHY key found.");
    } else {
      console.log("GIFs come from GIPHY: a free key takes a minute at https://developers.giphy.com (create an API app).");
      const key = (await answer("Paste your GIPHY API key (Enter to skip): ")).trim();
      if (key) console.log(`✓ Saved to ${await saveGiphyKey(key)}`);
      else console.log("Skipped: searching GIFs needs it; watching GIFs works without. Run `gifmate init` again later.");
    }
    const list = steps();
    if (!list.length) {
      console.log(`\nNo agent found on this machine. Point any MCP client at:\n  ${mcp.join(" ")}`);
      return;
    }
    console.log("");
    for (const step of list) {
      for (const cmd of step.cmds) console.log(`  ${cmd.map(quote).join(" ")}`);
      if (step.show) console.log(`  ${step.show}`);
      if (!(await ask(`${step.what}?`))) continue;
      let ok;
      try {
        ok = step.apply ? step.apply() : step.cmds.every(run);
      } catch (err) {
        console.log(`  ${err.message}`);
        ok = false;
      }
      console.log(ok ? `✓ ${step.what.split(":")[0]} ready.\n` : `✗ ${step.what.split(":")[0]}: a step failed (already installed?). The command is above.\n`);
    }
    console.log("Done. Restart or reconnect your agent, then: `/gif` in Claude Code, or ask any agent for a GIF.");
  } finally {
    rl.close();
  }
}
