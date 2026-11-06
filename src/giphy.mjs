// GIPHY search. Needs a free key from https://developers.giphy.com (env GIPHY_API_KEY or `gifmate setup`).
import { giphyKey } from "./config.mjs";

export async function searchGiphy(query, { limit = 6, rating = "pg" } = {}) {
  const key = await giphyKey();
  if (!key) {
    throw new Error("No GIPHY key yet. Tell the user: get a free API key at https://developers.giphy.com (Create an App, type API), then run `npx gifmate setup` and paste it.");
  }
  const url = new URL("https://api.giphy.com/v1/gifs/search");
  url.search = new URLSearchParams({ api_key: key, q: query, limit: String(limit), rating }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GIPHY search failed: HTTP ${res.status}`);
  const { data } = await res.json();
  return data.map((g) => {
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
}
