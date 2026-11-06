export type GifmatePick = { title: string; gif: string; small?: string; page?: string; thumb?: string }
export type GifmatePicker = { isOpen: boolean; status: string; picks: GifmatePick[] }

declare module 'claude-code' {
  interface PluginState {
    gifmate: { picker: Shaped<GifmatePicker> }
  }
}
