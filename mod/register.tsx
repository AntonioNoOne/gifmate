import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GifmateAttached, GifmatePick, GifmatePicker } from '../types'
import { MIN_LENGTH, waitAfterTyping } from './typing'

const SHOW_HEIGHT = 180

// A GIF's SVG at its own proportions, never scaled up (blurry), at most `maxHeight` tall.
function sizedGif(Svg: any, svg: string, maxHeight = SHOW_HEIGHT, alt = 'GIF') {
  const size = /<svg[^>]*width="(\d+)" height="(\d+)"/.exec(svg)
  // never name anything `h` in a mod: it hides the JSX factory and every element after it throws
  const [width, height] = size ? [Number(size[1]), Number(size[2])] : [maxHeight, maxHeight]
  const k = Math.min(1, maxHeight / height)
  return <Svg source={svg} alt={alt} width={Math.round(width * k)} height={Math.round(height * k)} />
}
const SENT = /gifmate-sent: (.+?\.gif)/i
const SVG = /gifmate-svg: (.+?\.svg)/i
const GIF_REF = /(?:https?:\/\/\S+?\.gif|(?:[A-Za-z]:)?[^\s"'<>|]*\.gif)(?=[\s"'),.]|$)/gi

// gif_send's text reaches us as a string or inside JSON (backslashes doubled).
function pathFrom(output: unknown, re: RegExp): string | undefined {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  return re.exec(text)?.[1]?.replace(/\\\\/g, '\\')
}

const THUMB = 120

// In the engine's state, so the tray redraws the moment a search lands.
const CLOSED: GifmatePicker = { isOpen: false, status: '', picks: [], attached: null }
const picker = atom({ plugin: 'gifmate', key: 'picker' } as const, CLOSED, { shape: 'picker-2' })

// The GIF as a chat message: optional words, then the GIF's title and file (what prompt.submit reads back).
const gifMessage = (words: string, a: GifmateAttached) => `${words ? words + '\n' : ''}GIF: ${a.title}\n${a.file}`

// A pasted GIF's bytes (read in slices), kept by gifmate's gif_pick: null if it is not a GIF or cannot be read.
async function keepPasted($: any, id: string): Promise<GifmateAttached | null> {
  try {
    let base64 = ''
    let offset: number | undefined
    do {
      const part = await $.prompt.media(offset === undefined ? { id } : { id, offset })
      if (!part?.base64) break
      base64 += part.base64
      offset = part.next
    } while (offset !== undefined && base64.length < 28_000_000)
    const tool = await toolNamed($, '__gif_pick')
    if (!tool) return null
    // a big GIF reaches hooks as a resized still: then gifmate takes the original from the session's pasted images
    const args = base64.startsWith('R0lGOD') ? { data: base64 } : { recent_paste: true }
    const { text } = await $.tool.call({ tool, ...args, title: 'pasted GIF' } as any)
    const file = pathFrom(text, SENT)
    return file ? { title: 'pasted GIF (no title: look at it)', file } : null
  } catch {
    return null
  }
}

// GIF messages that reached the session (a re-sent paste is put back in the prompt box if it never does)
const arrived = new Set<string>()

// The gifmate tools by suffix: the prefix depends on how gifmate was installed. Listing every tool
// on each keystroke slowed typing down, so the names are looked up once.
const toolNames = new Map<string, string>()
async function toolNamed($: any, suffix: string): Promise<string | undefined> {
  if (toolNames.has(suffix)) return toolNames.get(suffix)
  const tools: { name: string }[] = await $.tool.list()
  const name = tools.find(t => /gifmate/i.test(t.name) && t.name.endsWith(suffix))?.name
  if (name) toolNames.set(suffix, name)
  return name
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
  let status = query ? `Searching “${query}”…` : 'Trending on GIPHY…'
  let picks: GifmatePick[] = []
  const seq = ++lastSearch
  // keep the current row while searching: emptying it made the GIFs blink at every pause in typing
  await update($, picker, v => ({ ...v, isOpen: true, status }))
  // an empty search shows what is trending, so the tray is never empty while you type
  const tool = await toolNamed($, '__gif_search')
  if (!tool) {
    status = 'gifmate is not connected in this session.'
  } else {
    try {
      const { text } = await $.tool.call({ tool, query, limit: 6, thumbs: true })
      const body = String(text)
      // results come as JSON; anything else is the server's own message (no results, no key)
      picks = body.trimStart().startsWith('[') ? JSON.parse(body.split('\n\nPowered')[0]) : []
      status = picks.length
        ? query
          ? 'Powered by GIPHY'
          : 'Trending · type to search · Powered by GIPHY'
        : /limit reached/i.test(body)
          ? 'GIPHY limit reached: a free key allows 100 searches an hour. Try again in a while.'
          : /No GIF found/i.test(body)
            ? `No GIF for “${query}”. Try another word.`
            : `Search failed: ${body}`
    } catch (err) {
      status = `Search failed: ${String(err)}`
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
// The wait follows the person's own typing pace (hooks/typing.ts, tested on fast to very slow typists).
// Each keystroke (and Enter) bumps `keystroke`: only the last one's timer may search, even if the text
// came back to an earlier value (abc → ab → abc).
let keystroke = 0
let lastKeyAt = 0
const gaps: number[] = []
async function searchWhileTyping($: any, value: string) {
  const mine = ++keystroke
  const now: number = await $.clock.now()
  if (lastKeyAt) gaps.push(now - lastKeyAt)
  if (gaps.length > 6) gaps.shift()
  lastKeyAt = now
  const text = value.trim()
  await $.clock.sleep(waitAfterTyping(gaps))
  if (mine === keystroke && (text.length >= MIN_LENGTH || !text)) await search($, text)
}
async function searchNow($: any, value: string) {
  keystroke++ // Enter: drop the pending typing timer
  await search($, value.trim())
}

export const register: Register = on => {
  // Me -> you: play the GIF gif_send prepared (an SMIL SVG), under its tool row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    // gif_handoff too: a job passed to another agent shows as its GIF plus "→ agent: request"
    if (!/gif_(send|handoff)$/.test(e.props.tool) || e.props.isErrored) return row
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
    const handoff = /^gifmate-handoff: (.+)$/m.exec(String(e.props.output ?? ''))?.[1]
    const gifOnly = handoff ? (
      <Box flexDirection="column">
        {sizedGif(Svg, svg)}
        <Text dimColor>{handoff}</Text>
      </Box>
    ) : (
      sizedGif(Svg, svg)
    )
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
    const line = <Text dimColor>👀 GIF watched{m ? ` · ${m[1]} frames · ${Number(m[2]).toFixed(1)} s` : ''}</Text>
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
   try {
    const { isOpen, status, picks, attached, pending } = await read($, picker)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    // a pasted GIF waiting to go out as a GIF message: sent from here, like Send. If it has not gone out within
    // 8 s, it is put back in the prompt box, so the GIF is never lost: Enter sends it.
    if (pending) {
      await update($, picker, v => ({ ...v, pending: null }))
      const backInTheBox = () => (arrived.has(pending.text) ? undefined : $.prompt.fill({ text: pending.text, mode: 'replace' }))
      if (((await $.clock.now()) as number) - pending.at < 8000) {
        void $.prompt
          .submit({ text: pending.text, asUser: true })
          .then(() => $.clock.sleep(8000))
          .then(backInTheBox, backInTheBox)
      } else {
        void backInTheBox()
      }
    }
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
    // Send sends the GIF now; Attach keeps it for the next message, sent when the person presses Enter.
    // The user's own pick goes through gif_pick: gif_send is the agent's, with its pace and its diary entries.
    const prepare = async (p: GifmatePick) => {
      const pickTool = await toolNamed($, '__gif_pick')
      const { text } = pickTool ? await $.tool.call({ tool: pickTool, source: p.gif, title: p.title } as any) : { text: '' }
      const file = pathFrom(text, SENT)
      return file ? { title: p.title, file } : null
    }
    // Send: now. One GIF per press: the first press closes the tray, the later ones find nothing to send.
    const sendNow = async (p: GifmatePick) => {
      let isFirst = false
      await update($, picker, v => {
        isFirst = v.isOpen
        return { ...CLOSED, attached: v.attached }
      })
      const gif = isFirst ? await prepare(p) : null
      if (gif) await $.prompt.submit({ text: gifMessage('', gif), asUser: true })
    }
    // Attach: the tray stays open; the GIF leaves with the next message, when the person presses Enter.
    const attach = async (p: GifmatePick) => {
      await update($, picker, v => ({ ...v, status: `Attaching “${p.title}”…` }))
      const gif = await prepare(p)
      await update($, picker, v =>
        gif ? { ...v, attached: gif, status: 'Attached: write your message and press Enter' } : { ...v, status: 'Could not attach it' },
      )
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
              // a Box measures in text rows, not pixels: a 90-row box overflowed the band and the whole tray was refused
              <Text dimColor>⏳</Text>
            )}
            <Box flexDirection="row" gap={1}>
              <Button key={`send-${i}`} label="➤ Send" plain onPress={() => sendNow(p)} />
              {attached?.title === p.title ? (
                <Text>✓ Attached</Text>
              ) : (
                <Button key={`attach-${i}`} label="📎 Attach" plain dimColor onPress={() => attach(p)} />
              )}
            </Box>
          </Box>
        )
      }),
    )
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Input key="gif-query" placeholder="Search a GIF…" submitLabel="Search" autoFocus onInput={(q: string) => searchWhileTyping($, q)} onSubmit={(q: string) => searchNow($, q)} />
          <Button key="gif-close" label="✕" plain dimColor role="dismiss" onPress={close} />
        </Box>
        <Text dimColor>{status}</Text>
        <Box flexDirection="row" gap={1}>
          {cards}
        </Box>
      </Box>
    )
   } catch (err) {
    // a tray that fails to draw says why, instead of silently not appearing
    const { Text } = $.ui.resolve(e)
    return <Text color="red">gifmate: la fascia non si disegna: {String(err)}</Text>
   }
  })

  // A GIF you sent from the tray: your words, then the GIF; not its title and file path.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // a message with a pasted image also carries the engine's "[Image: source: ...]" line: not part of it
    const shown = e.props.text.replace(/\[Image[^\]]*\]/g, '').trim()
    const m = /^([\s\S]*?)\n?GIF: .*\n(\S*gifmate[\\/][0-9a-f]{12}\.gif)\s*$/i.exec(shown)
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
      const args = e.command.args.trim()
      // /gif mode|profile|forget: commands for the reaction diary, answered by the agent with gif_profile
      if (/^(mode|profile|forget)\b/i.test(args)) {
        // a command's text cannot be rewritten: drop it and send the request as a message (as Send does)
        void $.prompt.submit({ text: `gifmate ${args}: call gif_profile for it and answer in one or two lines.`, asUser: true })
        return { drop: `gifmate: ${args}` }
      }
      void search($, args)
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
    // An attached GIF leaves with the person's next message; it leaves the tray only once the message went through
    // (a hook below may still refuse it, and then the GIF stays attached).
    const attached: GifmateAttached | null =
      !e.command && !e.isMeta && e.origin?.kind !== 'plugin' ? (await read($, picker)).attached : null
    const sent = async (ev: typeof e) => {
      const result = await next(ev)
      if (attached && !(result as { drop?: string })?.drop) await update($, picker, v => ({ ...v, attached: null, isOpen: false }))
      return result
    }
    if (attached) e = { ...e, text: gifMessage(e.text.trim(), attached) }
    // A GIF pasted in the prompt (Ctrl+V): the model gets one still frame. Read its bytes, have gifmate keep it,
    // and send it like a GIF from the tray: it plays in the chat and the agent reads it as your message.
    else if (!e.command && !e.isMeta && e.origin?.kind !== 'plugin') {
      const first = (e.attachments ?? []).find(a => a.mediaType === 'image/gif' && a.id)
      const kept = first ? await keepPasted($, first.id as string) : null
      // The chat draws a typed prompt as typed (a small pasted thumbnail), a plugin's prompt by its text (the GIF
      // card). So when the session is idle the paste is dropped and sent again as a GIF message, as Send does.
      // Mid-turn (e.turnId) a plugin's prompt would wait for idle, and a paste was lost that way (2026-11-07):
      // then the prompt is rewritten in place, drawn small but delivered at once.
      // A submit from inside this hook is lost: the band above the prompt sends it, as Send does (see AbovePrompt).
      if (kept) {
        const text = gifMessage(e.text.replace(/\[Image[^\]]*\]/g, '').trim(), kept)
        const at = (await $.clock.now()) as number
        await update($, picker, v => ({ ...v, pending: { text, at } }))
        return { drop: 'gifmate: sending your GIF as a GIF card…' }
      }
    }
    // A GIF sent from the tray is a message, like in any chat: its meaning, not its pixels.
    const reply = /^([\s\S]*?)\n?GIF: (.*)\n(\S+\.gif)\s*$/.exec(e.text)
    if (reply) {
      arrived.add(e.text) // a pasted GIF re-sent from the band made it: no need to put it back in the box
      const note =
        (reply[1].trim()
          ? `The user wrote the text above and attached a GIF to set its tone. Its GIPHY title: «${reply[2]}». The text leads; the GIF says how they feel about it. `
          : `The user answered with a GIF instead of words. Its GIPHY title: «${reply[2]}». `) +
        'Treat it as their message: read what they mean (GIFs are often ironic or a reaction to your last reply) and act on it, ' +
        'as a teammate would, in their language. Do not describe the GIF, and answer with words, not with a GIF of your own. ' +
        "Your last message made them feel this: record it with gifmate's gif_note (kind user_gif, moment and intensity of your last message, feeling in 1-3 English words, tone: positive, playful, bitter or frustrated), so next time you can be the one in tune. " +
        `Only if the title is not enough to get the meaning, glance at it with gifmate's gif_view on ${reply[3]} with max_frames 3.`
      return sent({ ...e, context: [...(e.context ?? []), note] })
    }
    // GIF names inside blocks a tool or a hook added to the prompt (<browser_instruction>...) are not the user's
    const own = e.text.replace(/<([a-z_][\w-]*)>[\s\S]*?<\/\1>/gi, ' ')
    const refs = [...new Set(own.match(GIF_REF) ?? [])]
    const pasted = (e.attachments ?? []).filter(a => a.mediaType === 'image/gif')
    if (!refs.length && !pasted.length) return sent(e)
    const notes = refs.map(
      r => `The user shared the GIF ${r}. Image readers show only its first frame: call gifmate's gif_view on it before answering.`,
    )
    if (pasted.length) {
      notes.push('The user pasted an animated GIF; you see only its first frame. Say so, and ask for its path or URL to watch it with gif_view.')
    }
    return sent({ ...e, context: [...(e.context ?? []), ...notes] })
  })
}
