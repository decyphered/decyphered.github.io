# decyphered.tech

A minimal terminal-style personal website built with plain HTML, CSS, and JavaScript, hosted on GitHub Pages.

## Why this exists

This project is meant to be easy to read, change, and adapt. It is intentionally small so people can learn how a simple website works without needing a large framework.

## Features

- Static website
- Terminal-style commands
- Easily editable text/content files
- GitHub Pages hosting
- No database
- No tracking
- Minimal dependencies

## How to use this project

1. Fork or use this repository as a starting point.
2. Edit the content files.
3. Update the command list.
4. Publish with GitHub Pages.

## Customizing the site

See `customizing.md`.

## Commands

- `help` - list available commands
- `clear` - clear the screen
- `whoareyou` - display identity
- `github` - display github
- `site` - display site details
- `about` - print contents of `about.txt`
- `values` - print contents of `values.txt`

### Hidden Commands

- `sudo` - don't even try it, bud
- `ping` - it'll come back
- `aurora` - try it on a clear night

Use `ArrowUp` / `ArrowDown` to navigate input history.

## Files

- `index.html` - page, styles, and terminal logic
- `about.txt` - content shown by the `about` command
- `values.txt` - content shown by the `values` command
- `favicon.ico` - icon for the browser tab

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