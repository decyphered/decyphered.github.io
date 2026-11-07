# decyphered.tech

A minimal terminal-style personal website built with plain HTML, CSS, and JavaScript, hosted on GitHub Pages.

## Why this exists

This project is meant to be easy to read, change, and adapt. It is intentionally small so people can learn how a simple website works without needing a large framework.

## Features

- Static website
- Terminal-style commands
- Easily editable text/content files
- GitHub Pages hosting
- Privacy-friendly traffic monitoring with GoatCounter
- No database
- No build step or package dependencies

## How to use this project

1. Fork or use this repository as a starting point.
2. Edit the content files.
3. Update the command list.
4. Publish with GitHub Pages.

## Customizing the site

See `customizing.md`.

## Monitoring

This site uses GoatCounter for simple, privacy-friendly traffic monitoring. The counter script is loaded in `index.html` from `https://decyphered.goatcounter.com/count`.

## Commands

- `help` - list available commands
- `clear` - clear the screen
- `whoami` - one-line identity
- `github` - public code and site source
- `contact` - public contact path
- `projects` - print contents of `projects.txt`
- `film` - browse photo rolls
- `site` - show how the site is built
- `about` - print identity and current focus from `about.txt`
- `values` - print principles from `values.txt`

The `film` command also supports `film list`, `film random`, and `film open <roll-id>`.

### Hidden Commands

- `sudo` - don't even try it, bud
- `ping` - it'll come back
- `aurora` - try it on a clear night
- `puck` - drop the puck
- `puckies` - send a rubber duck across the screen
- `standings` - show AWHL intermediate standings
- `biglake` - sit by a campfire at Big Lake, Alaska. The scene follows live conditions at the lake: the time and today's sunrise/sunset, temperature, clouds, wind, snow, rain and fog ([Open-Meteo](https://open-meteo.com)), aurora when NOAA's Kp index is high enough, and the real moon phase. Extra words force conditions, e.g. `biglake night snow` or `biglake dusk aurora` (`night` / `dusk` / `day`, `clear` / `cloudy` / `snow` / `rain` / `fog` / `storm`, `aurora`, `frozen` / `thaw`). In winter the lake freezes over. The fire burns down to embers over about ten minutes (it never goes out): any key or a tap adds a log, which smokes and catches a few seconds later, and `p` (or press and hold) pokes it for sparks. Rain dampens it and sizzles on the coals. `w` cycles the wind (live first), `m` toggles sound and `-` / `+` set the volume. The sound is synthesized: a fire that crackles with the flames and ticks as it burns down, waves or singing lake ice, wind from the live weather, rain and thunder, loons on summer evenings and an owl on winter nights. iPhones mute it when the silent switch is on.

Use `ArrowUp` / `ArrowDown` to navigate input history, and `Tab` to complete command names (hidden commands never complete). Command names in `help` and URLs in output are clickable.

On touch screens, a row of quick-command buttons sits under the terminal, and full-screen modes (`aurora`, `puck`, `film`, `biglake`) have a tappable `[x] exit` button. In `puck`, drag to move your stick and tap to pause.

Output is laid out for narrow screens too: wrapped lines continue under their value (`key:   value`) or indent instead of at the left edge. On phones, output taller than the screen opens at its first line, and tapping a quick command closes the keyboard so it doesn't cover the result.

## Files

- `index.html` - page, styles, and terminal logic
- `biglake.js` - the `biglake` campfire scene, loaded only when the command runs
- `biglake-sound.js` - the synthesized soundscape for `biglake`, loaded only when sound is turned on
- `customizing.md` - notes for adapting commands, content, style, photos, and publishing
- `photos/manifest.json` - photo roll metadata used by the `film` command
- `photos/thumbs/` - optimized thumbnail images for the `film` command
- `photos/full/` - optimized full-size images for the `film` command
- `about.txt` - content shown by the `about` command
- `projects.txt` - content shown by the `projects` command
- `values.txt` - content shown by the `values` command
- `CNAME` - custom domain configuration for GitHub Pages
- `favicon.ico` - icon for the browser tab
- `android-chrome-512x512.png` - PNG favicon/app icon

## Adding a command

Add an entry to the `commands` object in `index.html`:

```js
mycmd: {
  description: "  what it does",
  run: () => print("hello")
}
```

`help` picks it up automatically. The two leading spaces in `description` match the other visible commands so the `help` columns line up. See `customizing.md` for how output is formatted.

## License

The code in this repository is available under the MIT License.

Personal content and branding should be adapted, not copied directly.
