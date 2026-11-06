import type { Register } from 'claude-code'

const SHOW_HEIGHT = 180
const SENT = /gifmate-sent: (.+?\.gif)/i
const SVG = /gifmate-svg: (.+?\.svg)/i
const GIF_REF = /(?:https?:\/\/\S+?\.gif|(?:[A-Za-z]:)?[^\s"'<>|]*\.gif)(?=[\s"'),.]|$)/gi

// gif_send's text reaches us as a string or inside JSON (backslashes doubled).
function pathFrom(output: unknown, re: RegExp): string | undefined {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  return re.exec(text)?.[1]?.replace(/\\\\/g, '\\')
}

const THUMB = 96

type Pick = { title: string; gif: string; thumb?: string }
// The picker lives for one search; a reload simply closes it.
let query = ''
let status = ''
let picks: Pick[] = []
let isOpen = false

// The gifmate tools by suffix: the prefix depends on how gifmate was installed.
async function toolNamed($: any, suffix: string): Promise<string | undefined> {
  const tools: { name: string }[] = await $.tool.list()
  return tools.find(t => /gifmate/i.test(t.name) && t.name.endsWith(suffix))?.name
}

async function svgOf($: any, path: string | undefined): Promise<string> {
  if (!path) return ''
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
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
    // never scaled up (blurry), and no taller than a chat line of thumbnails
    const size = /<svg[^>]*width="(\d+)" height="(\d+)"/.exec(svg)
    const [w, ht] = size ? [Number(size[1]), Number(size[2])] : [SHOW_HEIGHT, SHOW_HEIGHT]
    const shown = Math.min(1, SHOW_HEIGHT / ht)
    const gifOnly = <Svg source={svg} alt="GIF" width={Math.round(w * shown)} height={Math.round(ht * shown)} />
    // like a teammate's message: just the GIF; the full transcript (ctrl+o) keeps the tool row
    if (!e.props.isExpanded) return gifOnly
    return (
      <Box flexDirection="column">
        {row}
        {gifOnly}
      </Box>
    )
  })

  // You -> me, the easy way: /gif <what> opens a GIPHY picker beside the chat.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'gif', description: 'Search GIPHY and send a GIF in the chat' })
    return next(e)
  })

  on('command.run', { command: 'gif' }, async ($, e) => {
    query = e.args.trim()
    picks = []
    status = query ? `Cerco “${query}”…` : 'Scrivi cosa cercare: /gif gatto che applaude'
    isOpen = true
    $.ui.invalidate('ui.render')
    if (!query) return {}
    const search = await toolNamed($, '__gif_search')
    if (!search) {
      status = 'gifmate non è collegato in questa sessione.'
    } else {
      try {
        const { text } = await $.tool.call({ tool: search, query, limit: 6, thumbs: true } as any)
        picks = JSON.parse(String(text).split('\n\nPowered')[0])
        status = picks.length ? 'Powered by GIPHY' : `Nessuna GIF per “${query}”.`
      } catch (err) {
        status = `Ricerca non riuscita: ${String(err)}`
        $.ui.toast(status)
      }
    }
    $.ui.invalidate('ui.render')
    return {}
  })

  // The picker sits above the prompt, like a chat app's GIF tray.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isOpen) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const close = () => {
      isOpen = false
      $.ui.invalidate('ui.render')
    }
    const { Svg } = $.ui.resolve(e) as { Svg?: any }
    const send = async (p: Pick) => {
      status = 'Invio…'
      $.ui.invalidate('ui.render')
      const sendTool = await toolNamed($, '__gif_send')
      const { text } = sendTool ? await $.tool.call({ tool: sendTool, source: p.gif } as any) : { text: '' }
      const file = pathFrom(text, SENT)
      close()
      if (file) await $.prompt.submit({ text: `GIF: ${p.title}\n${file}`, asUser: true })
    }
    const cards = await Promise.all(
      picks.map(async (p, i) => {
        const thumb = Svg ? await svgOf($, p.thumb) : ''
        return (
          <Box flexDirection="column" width={THUMB + 8}>
            {thumb ? <Svg source={thumb} alt={p.title} width={THUMB} height={THUMB} /> : <Text>{p.title}</Text>}
            <Button key={`send-${i}`} label="Manda" onPress={() => send(p)} />
          </Box>
        )
      }),
    )
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{status}</Text>
          <Button key="gif-close" label="Chiudi" onPress={close} />
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {cards}
        </Box>
      </Box>
    )
  })

  // A GIF you sent from the picker: show it in your message, not its file path.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    const file = /\S*gifmate[\\/][0-9a-f]{12}\.gif/i.exec(e.props.text)?.[0]
    if (!file || e.surface === 'terminal') return row
    const { Box } = $.ui.resolve(e)
    const svg = await svgOf($, file.replace(/\.gif$/i, '.svg'))
    if (!svg) return row
    const { Svg } = $.ui.resolve(e) as { Svg: any }
    const gif = <Svg source={svg} alt="GIF" width={SHOW_HEIGHT} height={SHOW_HEIGHT} />
    if (!e.props.isExpanded) return gif
    return (
      <Box flexDirection="column">
        {row}
        {gif}
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
