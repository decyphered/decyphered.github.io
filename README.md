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
- `whoami` - display identity
- `github` - display github
- `film` - browse photo rolls
- `site` - display site details
- `about` - print contents of `about.txt`
- `values` - print contents of `values.txt`

The `film` command also supports `film list`, `film random`, and `film open <roll-id>`.

### Hidden Commands

- `sudo` - don't even try it, bud
- `ping` - it'll come back
- `aurora` - try it on a clear night
- `puck` - drop the puck
- `puckies` - send a rubber duck across the screen
- `standings` - show AWHL intermediate standings

Use `ArrowUp` / `ArrowDown` to navigate input history.

## Files

- `index.html` - page, styles, and terminal logic
- `customizing.md` - notes for adapting commands, content, style, photos, and publishing
- `photos/manifest.json` - photo roll metadata used by the `film` command
- `photos/thumbs/` - optimized thumbnail images for the `film` command
- `photos/full/` - optimized full-size images for the `film` command
- `about.txt` - content shown by the `about` command
- `values.txt` - content shown by the `values` command
- `CNAME` - custom domain configuration for GitHub Pages
- `favicon.ico` - icon for the browser tab
- `android-chrome-512x512.png` - PNG favicon/app icon

## Adding a command

Add an entry to the `commands` object in `index.html`:

```js
mycmd: {
  description: "what it does",
  run: () => print("hello")
}
```

`help` picks it up automatically.

## License

The code in this repository is available under the MIT License.

Personal content and branding should be adapted, not copied directly.
