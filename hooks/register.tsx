import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GifmatePick, GifmatePicker } from '../types'

const SHOW_HEIGHT = 180
const SENT = /gifmate-sent: (.+?\.gif)/i
const SVG = /gifmate-svg: (.+?\.svg)/i
const GIF_REF = /(?:https?:\/\/\S+?\.gif|(?:[A-Za-z]:)?[^\s"'<>|]*\.gif)(?=[\s"'),.]|$)/gi

// gif_send's text reaches us as a string or inside JSON (backslashes doubled).
function pathFrom(output: unknown, re: RegExp): string | undefined {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  return re.exec(text)?.[1]?.replace(/\\\\/g, '\\')
}

const THUMB = 90

// In the engine's state, so the tray redraws the moment a search lands.
const CLOSED: GifmatePicker = { isOpen: false, status: '', picks: [] }
const picker = atom({ plugin: 'gifmate', key: 'picker' } as const, CLOSED, { shape: 'picker-1' })

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

// One search, shared by `/gif <what>` and the tray's own search box.
async function search($: any, query: string) {
  let status = query ? `Cerco “${query}”…` : 'Scrivi qui sotto cosa cercare (in inglese funziona meglio) e premi Invio'
  let picks: GifmatePick[] = []
  await update($, picker, () => ({ isOpen: true, status, picks }))
  if (!query) return
  const tool = await toolNamed($, '__gif_search')
  if (!tool) {
    status = 'gifmate non è collegato in questa sessione.'
  } else {
    try {
      const { text } = await $.tool.call({ tool, query, limit: 6, thumbs: true })
      const body = String(text)
      // results come as JSON; anything else is the server's own message (no results, no key)
      picks = body.trimStart().startsWith('[') ? JSON.parse(body.split('\n\nPowered')[0]) : []
      status = picks.length ? 'Powered by GIPHY' : `Nessuna GIF per “${query}”. In inglese GIPHY trova di più: prova “cat”`
    } catch (err) {
      status = `Ricerca non riuscita: ${String(err)}`
    }
  }
  await update($, picker, () => ({ isOpen: true, status, picks }))
}

// Search while typing: wait until the person pauses, so a free GIPHY key (100 searches an hour) lasts.
let typed = ''
async function searchWhileTyping($: any, value: string) {
  typed = value.trim()
  const mine = typed
  await $.clock.sleep(700)
  if (mine === typed && mine.length >= 2) await search($, mine)
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

  // gif_view: one quiet line instead of a box of frames; ctrl+o still shows them all.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!/gif_view$/.test(e.props.tool) || e.props.isRunning || e.props.isErrored || e.props.isExpanded) return next(e)
    const text = typeof e.props.output === 'string' ? e.props.output : JSON.stringify(e.props.output ?? '')
    const m = /(\d+) frames, ([\d.]+) s/.exec(text)
    const { Box, Text } = $.ui.resolve(e)
    const line = <Text dimColor>👀 GIF guardata{m ? ` · ${m[1]} fotogrammi · ${Number(m[2]).toFixed(1)} s` : ''}</Text>
    // a GIF sent from the tray has its animation next to it: show what was watched
    const source = String((e.props.input as { source?: string })?.source ?? '')
    const svg = e.surface === 'terminal' || !/\.gif$/i.test(source) ? '' : await svgOf($, source.replace(/\.gif$/i, '.svg'))
    if (!svg) return line
    const { Svg } = $.ui.resolve(e) as { Svg: any }
    const size = /<svg[^>]*width="(\d+)" height="(\d+)"/.exec(svg)
    const [w, ht] = size ? [Number(size[1]), Number(size[2])] : [SHOW_HEIGHT, SHOW_HEIGHT]
    const shown = Math.min(1, SHOW_HEIGHT / ht)
    return (
      <Box flexDirection="column">
        <Svg source={svg} alt="GIF" width={Math.round(w * shown)} height={Math.round(ht * shown)} />
        {line}
      </Box>
    )
  })

  // You -> me, the easy way: /gif <what> opens a GIPHY picker beside the chat.
  // /gif is a command file of the plugin (commands/gif.md), so menus list it; with the mod it opens
  // the tray instead of prompting the model.

  // The picker sits above the prompt, like a chat app's GIF tray.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { isOpen, status, picks } = await read($, picker)
    if (!isOpen) return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const close = () => update($, picker, () => CLOSED)
    const { Svg } = $.ui.resolve(e) as { Svg?: any }
    const send = async (p: GifmatePick) => {
      await update($, picker, v => ({ ...v, status: 'Invio…' }))
      const sendTool = await toolNamed($, '__gif_send')
      const { text } = sendTool ? await $.tool.call({ tool: sendTool, source: p.gif } as any) : { text: '' }
      const file = pathFrom(text, SENT)
      await close()
      if (file) await $.prompt.submit({ text: `GIF: ${p.title}\n${file}`, asUser: true })
    }
    const cards = await Promise.all(
      picks.map(async (p, i) => {
        const thumb = Svg ? await svgOf($, p.thumb) : ''
        const size = /<svg[^>]*width="(\d+)" height="(\d+)"/.exec(thumb)
        const w = size ? Math.round((Number(size[1]) * THUMB) / Number(size[2])) : THUMB
        return (
          <Box flexDirection="column" alignItems="center">
            {thumb ? <Svg source={thumb} alt={p.title} width={w} height={THUMB} /> : <Text>{p.title}</Text>}
            <Button key={`send-${i}`} label="Manda" onPress={() => send(p)} />
          </Box>
        )
      }),
    )
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Input key="gif-query" placeholder="Cerca una GIF…" submitLabel="Cerca" autoFocus onInput={(q: string) => searchWhileTyping($, q)} onSubmit={(q: string) => search($, q.trim())} />
          <Button key="gif-close" label="Chiudi" onPress={close} />
        </Box>
        <Text dimColor>{status}</Text>
        <Box flexDirection="row" gap={1}>
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
  // One prompt.submit hook (the engine allows one per event without a matcher):
  // /gif opens the tray instead of reaching the model; a GIF named in a prompt goes to gif_view.
  on('prompt.submit', ($, e, next) => {
    if (e.command && /^(gifmate:)?gif$/.test(e.command.name)) {
      void search($, e.command.args.trim())
      return { drop: 'gifmate: GIF tray opened' }
    }
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
