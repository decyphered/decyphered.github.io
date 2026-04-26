# decyphered.tech

A minimal terminal-style personal site. Single static page, no dependencies. Hosted on GitHub Pages.

## Commands

- `help` - list available commands
- `clear` - clear the screen
- `whoareyou` - display identity
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