// GIPHY search. Needs a free key from https://developers.giphy.com (env GIPHY_API_KEY or `gifmate setup`).
import { giphyKey } from "./config.mjs";

// A free key allows 100 searches an hour and searching while typing repeats words: the same search
// within 10 minutes is answered from memory.
const recent = new Map();
const TEN_MINUTES = 10 * 60_000;

export async function searchGiphy(query, { limit = 6, rating = "pg" } = {}) {
  const asked = `${query.trim().toLowerCase()}|${limit}|${rating}`;
  const hit = recent.get(asked);
  if (hit && Date.now() - hit.at < TEN_MINUTES) return hit.results.map((r) => ({ ...r }));

  const key = await giphyKey();
  if (!key) {
    throw new Error("No GIPHY key yet. Tell the user: get a free API key at https://developers.giphy.com (Create an App, type API), then run `npx gifmate setup` and paste it.");
  }
  const url = new URL("https://api.giphy.com/v1/gifs/search");
  url.search = new URLSearchParams({ api_key: key, q: query, limit: String(limit), rating }).toString();
  const res = await fetch(url);
  if (res.status === 429) {
    throw new Error("GIPHY limit reached: a free key allows 100 searches an hour. Try again in a while.");
  }
  if (!res.ok) throw new Error(`GIPHY search failed: HTTP ${res.status}`);
  const { data } = await res.json();
  const results = data.map((g) => {
    const gif = g.images.fixed_height.url;
    const title = g.title || query;
    return {
      title,
      page: g.url,
      gif,
      small: g.images.fixed_height_small?.url || gif,
      still: g.images.fixed_height_small_still?.url,
    };
  });
  recent.set(asked, { at: Date.now(), results });
  return results.map((r) => ({ ...r }));
}
