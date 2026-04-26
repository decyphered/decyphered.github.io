# decyphered.tech

A minimal terminal-style personal site. Single static page, no dependencies. Hosted on GitHub Pages.

## Commands

- `help` - list available commands
- `whoareyou` - display identity
- `about` - print contents of `about.txt`
- `values` - print contents of `values.txt`
- `clear` - clear the screen

### Hidden Commands

- `sudo` - don't even try it, bud
- `ping` - it'll come back

Use `ArrowUp` / `ArrowDown` to navigate input history.

## Files

- `index.html` - page, styles, and terminal logic
- `about.txt` - content shown by the `about` command
- `values.txt` - content shown by the `values` command

## Adding a command

Add an entry to the `commands` object in `index.html`:

```js
mycmd: {
  description: "what it does",
  run: () => print("hello")
}
```

`help` picks it up automatically.