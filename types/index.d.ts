export type GifmatePick = { title: string; gif: string; small?: string; still?: string; page?: string; thumb?: string; anim?: string }
export type GifmateAttached = { title: string; file: string }
// `attached`: a GIF picked with Attach, waiting to go out with the person's next message.
// `pasted`: the engine's saved image of a pasted GIF -> gifmate's GIF, to draw the card on that very message.
export type GifmatePicker = {
  isOpen: boolean
  status: string
  picks: GifmatePick[]
  attached: GifmateAttached | null
  pasted?: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    gifmate: { picker: Shaped<GifmatePicker> }
  }
}
