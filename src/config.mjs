// Where the GIPHY key lives when it is not in the environment: one file per user.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const configPath = () =>
  process.env.APPDATA ? join(process.env.APPDATA, "gifmate", "config.json") : join(homedir(), ".config", "gifmate", "config.json");

export async function giphyKey() {
  const env = process.env.GIPHY_API_KEY;
  // an unset ${GIPHY_API_KEY} in a plugin manifest can arrive literally
  if (env && !env.startsWith("${")) return env;
  try {
    return JSON.parse(await readFile(configPath(), "utf-8")).giphyApiKey;
  } catch {
    return undefined;
  }
}

export async function saveGiphyKey(key) {
  const file = configPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ giphyApiKey: key }, null, 2), { mode: 0o600 });
  return file;
}
