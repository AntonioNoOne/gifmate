// When to search while the person types: after they pause, where "pause" follows their own pace.
// A fixed 0.3 s fired a search at almost every letter for someone typing slowly (one GIPHY call each,
// and a free key has 100 an hour); so the wait is about twice their usual gap between letters.
export const MIN_WAIT = 500
export const MAX_WAIT = 1500
export const MIN_LENGTH = 3

// gaps: milliseconds between their recent keystrokes, most recent last.
export function waitAfterTyping(gaps: number[]): number {
  const recent = gaps.slice(-6).filter(g => g > 0 && g < 3000) // a long break is not typing pace
  if (!recent.length) return MIN_WAIT
  const sorted = [...recent].sort((a, b) => a - b)
  const usual = sorted[Math.floor(sorted.length / 2)]
  return Math.min(MAX_WAIT, Math.max(MIN_WAIT, Math.round(usual * 2)))
}

// Which texts a typing session would search, given each keystroke as [time, text after it]:
// the same rule the tray runs, so tests can try fast, slow and very slow typists.
export function searchesFor(keys: [number, string][]): string[] {
  const searched: string[] = []
  for (let i = 0; i < keys.length; i++) {
    const [at, text] = keys[i]
    const gaps = keys.slice(Math.max(0, i - 6), i + 1).map((k, j, all) => (j ? k[0] - all[j - 1][0] : 0)).slice(1)
    const nextAt = i + 1 < keys.length ? keys[i + 1][0] : Infinity
    if (nextAt - at >= waitAfterTyping(gaps) && text.trim().length >= MIN_LENGTH && searched.at(-1) !== text.trim()) {
      searched.push(text.trim())
    }
  }
  return searched
}
