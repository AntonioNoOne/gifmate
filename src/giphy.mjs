// GIPHY search. Needs a free key from https://developers.giphy.com in GIPHY_API_KEY.
export async function searchGiphy(query, { limit = 6, rating = "pg", key = process.env.GIPHY_API_KEY } = {}) {
  if (!key) {
    throw new Error("GIPHY_API_KEY is not set: get a free key at https://developers.giphy.com and add it to the MCP server's env");
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
    };
  });
}
