import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GifmateAttached, GifmatePick, GifmatePicker } from '../types'

const SHOW_HEIGHT = 180

// A GIF's SVG at its own proportions, never scaled up (blurry), at most `maxHeight` tall.
function sizedGif(Svg: any, svg: string, maxHeight = SHOW_HEIGHT, alt = 'GIF') {
  const size = /<svg[^>]*width="(\d+)" height="(\d+)"/.exec(svg)
  const [w, h] = size ? [Number(size[1]), Number(size[2])] : [maxHeight, maxHeight]
  const k = Math.min(1, maxHeight / h)
  return <Svg source={svg} alt={alt} width={Math.round(w * k)} height={Math.round(h * k)} />
}
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
const CLOSED: GifmatePicker = { isOpen: false, status: '', picks: [], attached: null }
const picker = atom({ plugin: 'gifmate', key: 'picker' } as const, CLOSED, { shape: 'picker-2' })

// The GIF as a chat message: optional words, then the GIF's title and file (what prompt.submit reads back).
const gifMessage = (words: string, a: GifmateAttached) => `${words ? words + '\n' : ''}GIF: ${a.title}\n${a.file}`

// The gifmate tools by suffix: the prefix depends on how gifmate was installed.
async function toolNamed($: any, suffix: string): Promise<string | undefined> {
  const tools: { name: string }[] = await $.tool.list()
  return tools.find(t => /gifmate/i.test(t.name) && t.name.endsWith(suffix))?.name
}

// Previews never change once written: read each file once, not on every redraw.
const svgCache = new Map<string, string>()
async function svgOf($: any, path: string | undefined): Promise<string> {
  if (!path) return ''
  if (svgCache.has(path)) return svgCache.get(path) as string
  try {
    const svg: string = await $.fs.read(path)
    // a file still being written would draw broken (an empty preview): treat it as not there yet
    if (!svg.trimEnd().endsWith('</svg>')) return ''
    svgCache.set(path, svg)
    return svg
  } catch {
    return ''
  }
}

// One search, shared by `/gif <what>` and the tray's own search box.
let lastSearch = 0
async function search($: any, query: string) {
  let status = query ? `Cerco “${query}”…` : 'Scrivi qui sotto cosa cercare (in inglese funziona meglio) e premi Invio'
  let picks: GifmatePick[] = []
  const seq = ++lastSearch
  // keep the current row while searching: emptying it made the GIFs blink at every pause in typing
  await update($, picker, v => ({ ...v, isOpen: true, status }))
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
      status = picks.length
        ? 'Powered by GIPHY'
        : /limit reached/i.test(body)
          ? "Limite di GIPHY raggiunto: la chiave gratuita fa 100 ricerche l'ora. Riprova fra poco."
          : /No GIF found/i.test(body)
            ? `Nessuna GIF per “${query}”. In inglese GIPHY trova di più: prova “cat”`
            : `Ricerca non riuscita: ${body}`
    } catch (err) {
      status = `Ricerca non riuscita: ${String(err)}`
    }
  }
  // a slower, older search must not overwrite the newer one
  if (seq !== lastSearch) return
  await update($, picker, v => ({ ...v, isOpen: true, status, picks }))
  // the animated previews land a moment after the stills: redraw a few times to pick them up
  for (let i = 0; i < 8 && picks.length && seq === lastSearch; i++) {
    await $.clock.sleep(300)
    await update($, picker, v => ({ ...v }))
  }
}

// Search while typing: wait until the person pauses, so a free GIPHY key (100 searches an hour) lasts.
let typed = ''
async function searchWhileTyping($: any, value: string) {
  typed = value.trim()
  const mine = typed
  await $.clock.sleep(450)
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
    const gifOnly = sizedGif(Svg, svg)
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
    return (
      <Box flexDirection="column">
        {sizedGif(Svg, svg)}
        {line}
      </Box>
    )
  })

  // You -> me, the easy way: /gif <what> opens a GIPHY picker beside the chat.
  // /gif is a command file of the plugin (commands/gif.md), so menus list it; with the mod it opens
  // the tray instead of prompting the model.

  // The picker sits above the prompt, like a chat app's GIF tray.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { isOpen, status, picks, attached } = await read($, picker)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    // tray closed with a GIF attached: a small chip until the next message takes it
    if (!isOpen && attached) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text>📎 GIF allegata: {attached.title}</Text>
          <Button key="gif-unattach" label="✕" plain dimColor onPress={() => update($, picker, v => ({ ...v, attached: null }))} />
        </Box>
      )
    }
    if (!isOpen) return next(e)
    const close = () => update($, picker, v => ({ ...CLOSED, attached: v.attached }))
    const { Svg } = $.ui.resolve(e) as { Svg?: any }
    // Manda sends the GIF now; Allega keeps it for the next message, sent when the person presses Enter
    const pick = async (p: GifmatePick, isNow: boolean) => {
      // one GIF per press: the first press closes the tray, the later ones find nothing to send
      let isFirst = false
      await update($, picker, v => {
        isFirst = v.isOpen
        return { ...CLOSED, attached: v.attached, status: 'Preparo la GIF…' }
      })
      if (!isFirst) return
      const sendTool = await toolNamed($, '__gif_send')
      const { text } = sendTool ? await $.tool.call({ tool: sendTool, source: p.gif } as any) : { text: '' }
      const file = pathFrom(text, SENT)
      if (!file) return
      const gif = { title: p.title, file }
      if (isNow) await $.prompt.submit({ text: gifMessage('', gif), asUser: true })
      else await update($, picker, v => ({ ...v, attached: gif }))
    }
    const cards = await Promise.all(
      picks.map(async (p, i) => {
        // the animated preview once the server has it, GIPHY's still frame until then
        const thumb = Svg ? (await svgOf($, p.anim)) || (await svgOf($, p.thumb)) : ''
        return (
          <Box flexDirection="column" alignItems="center">
            {thumb ? (
              sizedGif(Svg, thumb, THUMB, p.title)
            ) : (
              <Box width={THUMB} height={THUMB} borderStyle="round" justifyContent="center" alignItems="center">
                <Text dimColor>…</Text>
              </Box>
            )}
            <Box flexDirection="row" gap={1}>
              <Button key={`send-${i}`} label="➤ Invia" plain onPress={() => pick(p, true)} />
              <Button key={`attach-${i}`} label="📎 Allega" plain dimColor onPress={() => pick(p, false)} />
            </Box>
          </Box>
        )
      }),
    )
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Input key="gif-query" placeholder="Cerca una GIF…" submitLabel="Cerca" autoFocus onInput={(q: string) => searchWhileTyping($, q)} onSubmit={(q: string) => search($, q.trim())} />
          <Button key="gif-close" label="✕" plain dimColor role="dismiss" onPress={close} />
        </Box>
        <Text dimColor>{status}</Text>
        <Box flexDirection="row" gap={1}>
          {cards}
        </Box>
      </Box>
    )
  })

  // A GIF you sent from the tray: your words, then the GIF; not its title and file path.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const m = /^([\s\S]*?)\n?GIF: .*\n(\S*gifmate[\\/][0-9a-f]{12}\.gif)\s*$/i.exec(e.props.text)
    const svg = m && e.surface !== 'terminal' ? await svgOf($, m[2].replace(/\.gif$/i, '.svg')) : ''
    if (!m || !svg) return next(e)
    const { Box } = $.ui.resolve(e)
    const { Svg } = $.ui.resolve(e) as { Svg: any }
    const words = m[1].trim()
    return (
      <Box flexDirection="column">
        {words ? await next({ ...e, props: { ...e.props, text: words } }) : null}
        {sizedGif(Svg, svg)}
      </Box>
    )
  })

  // You -> me: a GIF named in the prompt goes to gif_view, not to the image reader.
  // One prompt.submit hook (the engine allows one per event without a matcher):
  // /gif opens the tray instead of reaching the model; a GIF named in a prompt goes to gif_view.
  on('prompt.submit', async ($, e, next) => {
    if (e.command && /^(gifmate:)?gif$/.test(e.command.name)) {
      void search($, e.command.args.trim())
      return { drop: 'gifmate: GIF tray opened' }
    }
    // `/gif` inside a sentence ("deploy done /gif lets go"): give the words back to the prompt box and open
    // the tray on the rest; the person attaches a GIF and sends both with Enter.
    const inline = !e.command && !e.isMeta && e.origin?.kind !== 'plugin' ? /^([\s\S]*?)(?:^|\s)\/(?:gifmate:)?gif(?:\s+([^\n]*))?\s*$/.exec(e.text) : null
    if (inline) {
      void search($, (inline[2] ?? '').trim())
      if (inline[1].trim()) void $.prompt.fill({ text: inline[1].trim() + ' ', mode: 'replace' })
      return { drop: 'gifmate: GIF tray opened' }
    }
    // An attached GIF leaves with the person's next message.
    if (!e.command && !e.isMeta && e.origin?.kind !== 'plugin') {
      let attached: GifmateAttached | null = null
      await update($, picker, v => {
        attached = v.attached
        return { ...v, attached: null }
      })
      if (attached) return next({ ...e, text: gifMessage(e.text.trim(), attached) })
    }
    // A GIF sent from the tray is a message, like in any chat: its meaning, not its pixels.
    const reply = /^([\s\S]*?)\n?GIF: (.*)\n(\S+\.gif)\s*$/.exec(e.text)
    if (reply) {
      const note =
        (reply[1].trim()
          ? `The user wrote the text above and attached a GIF to set its tone. Its GIPHY title: «${reply[2]}». The text leads; the GIF says how they feel about it. `
          : `The user answered with a GIF instead of words. Its GIPHY title: «${reply[2]}». `) +
        'Treat it as their message: read what they mean (GIFs are often ironic or a reaction to your last reply) and act on it, ' +
        'as a teammate would, in their language. Do not describe the GIF, and answer with words, not with a GIF of your own. ' +
        `Only if the title is not enough to get the meaning, glance at it with gifmate's gif_view on ${reply[3]} with max_frames 3.`
      return next({ ...e, context: [...(e.context ?? []), note] })
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
