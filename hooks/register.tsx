import type { Register } from 'claude-code'

const SENT = /gifmate-sent: (.+?\.gif)/i
const SVG = /gifmate-svg: (.+?\.svg)/i
const GIF_REF = /(?:https?:\/\/\S+?\.gif|(?:[A-Za-z]:)?[^\s"'<>|]*\.gif)(?=[\s"'),.]|$)/gi

// gif_send's text reaches us as a string or inside JSON (backslashes doubled).
function pathFrom(output: unknown, re: RegExp): string | undefined {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  return re.exec(text)?.[1]?.replace(/\\\\/g, '\\')
}

export const register: Register = on => {
  // Me -> you: play the GIF gif_send prepared (an SMIL SVG), under its tool row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (!/gif_send$/.test(e.props.tool) || e.props.isErrored) return row
    const gif = pathFrom(e.props.output, SENT)
    if (!gif) return row

    const { Box, Text } = $.ui.resolve(e)
    const svgPath = pathFrom(e.props.output, SVG) ?? gif.replace(/\.gif$/i, '.svg')
    let svg = ''
    if (svgPath && e.surface !== 'terminal') {
      try {
        svg = await $.fs.read(svgPath)
      } catch {
        svg = ''
      }
    }
    if (!svg) {
      return (
        <Box flexDirection="column">
          {row}
          <Text dimColor>GIF: {gif}</Text>
        </Box>
      )
    }
    const { Svg } = $.ui.resolve(e) as { Svg: any }
    // draw at the SVG's own size: scaled up, small frames look blurry
    const size = /<svg[^>]*width="(\d+)" height="(\d+)"/.exec(svg)
    return (
      <Box flexDirection="column">
        {row}
        <Svg source={svg} alt="GIF" width={size?.[1] ? Number(size[1]) : undefined} height={size?.[2] ? Number(size[2]) : undefined} />
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
