---
name: gif
description: Trade GIFs with the user through gifmate - "/gif <words>" to send you a GIF, "/gif mode calibrate|quiet", "/gif profile", "/gif forget". Use it whenever the user types /gif.
---

# /gif

gifmate's tools (`gif_search`, `gif_send`, `gif_view`, `gif_note`, `gif_profile`) must be connected.

**`/gif <words>`: the user wants to send YOU a GIF.**

1. Call `gif_search` on their words (any language) and show the numbered gallery it returns exactly as
   given, then stop and wait. Add nothing else.
2. Their next message is a number (or a word naming one): that GIF is their message. Read its title as a
   reaction to your last reply, often ironic, and answer what they mean. Do not describe it, do not send it back.
3. Record it with `gif_note` (kind `user_gif`: the moment and intensity of your last message, the feeling,
   and its tone: positive, playful, bitter or frustrated).

**`/gif` with no words**: show what is trending the same way.

**`/gif mode calibrate`, `/gif mode quiet`, `/gif profile`, `/gif forget`**: pass it to `gif_profile`
(`mode`, or `forget: true`) and answer in one or two lines; for `profile`, say in plain words what you
learned about how GIFs land with them.
