export type GifmatePick = { title: string; gif: string; small?: string; still?: string; page?: string; thumb?: string; anim?: string }
export type GifmateAttached = { title: string; file: string }
// `attached`: a GIF picked with Attach, waiting to go out with the person's next message.
// `pending`: a pasted GIF's message, sent from the band like Send (a prompt.submit hook's own submit is lost).
export type GifmatePicker = {
  isOpen: boolean
  status: string
  picks: GifmatePick[]
  attached: GifmateAttached | null
  pending?: { text: string; at: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    gifmate: { picker: Shaped<GifmatePicker> }
  }
}
