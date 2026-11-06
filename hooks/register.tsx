import type { Register } from 'claude-code'

// The SVG a surface draws may hold at most 131072 characters.
const MAX_BASE64 = 120_000
const SHOW_HEIGHT = 160
const SENT = /gifmate-sent: (.+?\.gif)/i
const GIF_REF = /(?:https?:\/\/\S+?\.gif|(?:[A-Za-z]:)?[^\s"'<>|]*\.gif)(?=[\s"'),.]|$)/gi

function gifSize(base64: string) {
  const head = Uint8Array.fromBase64(base64.slice(0, 16))
  return { width: head[6] | (head[7] << 8), height: head[8] | (head[9] << 8) }
}

function sentPath(output: unknown): string | undefined {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  const raw = SENT.exec(text)?.[1]
  return raw?.replace(/\\\\/g, '\\')
}

export const register: Register = on => {
  // Me -> you: draw the GIF gif_send saved, under its tool row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    const path = /gif_send$/.test(e.props.tool) && !e.props.isErrored ? sentPath(e.props.output) : undefined
    if (!path) return row

    const { Box, Text } = $.ui.resolve(e)
    const { base64 } = await $.fs.read(path, { as: 'bytes' })
    if (base64.length > MAX_BASE64 || e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          {row}
          <Text dimColor>GIF: {path}</Text>
        </Box>
      )
    }
    const { width, height } = gifSize(base64)
    const h = Math.min(SHOW_HEIGHT, height)
    const w = Math.round((width * h) / height)
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} ${height}">` +
      `<image href="data:image/gif;base64,${base64}" width="${width}" height="${height}"/></svg>`
    const { Svg } = $.ui.resolve(e) as { Svg: any }
    return (
      <Box flexDirection="column">
        {row}
        <Svg source={source} alt="GIF" width={w} height={h} />
      </Box>
    )
  })

  // You -> me: a GIF named in the prompt goes to gif_view, not to the image reader.
  on('prompt.submit', ($, e, next) => {
    const refs = [...new Set(e.text.match(GIF_REF) ?? [])]
    const pasted = (e.attachments ?? []).filter(a => a.mediaType === 'image/gif')
    if (!refs.length && !pasted.length) return next(e)
    const notes = refs.map(
      r => `The user shared the GIF ${r}. Image readers show only its first frame: call gifmate's gif_view on it before answering.`,
    )
    if (pasted.length) {
      notes.push('The user pasted an animated GIF; you see only its first frame. Say so, and ask for its path or URL to watch it with gif_view.')
    }
    return next({ ...e, context: [...(e.context ?? []), ...notes] })
  })
}
