# Customizing decyphered.tech

This site is intentionally small: one HTML file, a few text files, and no build step.

## Edit Content

- Update `about.txt` to change the `about` command output.
- Update `projects.txt` to change the `projects` command output.
- Update `values.txt` to change the `values` command output.
- Update the boot text near the bottom of `index.html`.

Don't hard-wrap prose in the `.txt` files: write each paragraph on one line and let the terminal wrap it. When a line wraps, it continues under its value (`key:   value`) or under its indent, so an indented one-line paragraph stays indented on a phone.

## Add Commands

Commands live in the `commands` object in `index.html`.

```js
mycommand: {
  description: "  describe what it does",
  run: () => {
    print("hello");
  }
}
```

Set `hidden: true` for easter eggs that should run when typed directly but stay out of `help`.

Output helpers:

- `print(text)` prints one or more lines. URLs become links, and long lines wrap with a hanging indent: a `key:   value` line continues under the value, an indented line under its indent. Pad keys with spaces to line values up, like the `site` command does.
- `printBlock(text)` is for fixed-width content like tables. It never wraps and scrolls sideways on narrow screens instead.

## Style

The terminal look is defined in the `<style>` block in `index.html`. Keep the CSS small and readable unless the site grows enough to justify splitting files.

## The Cabin (`logout`)

The room's clickable objects are the `SPOTS` list near the top of `cabin.js`. Each has a `label` (shown on hover) and either `say` (a line shown on click) or `act` (a function run on click). The terminal's `act` sits you back down; the string lights' `act` cycles their color.

The string light colors are `CABIN_LIGHTS` in `index.html`, in click order. A name maps to one hex color, or to a list that alternates bulb by bulb (`multi`). The hidden `lights` command sets a name or any hex color; both save to `localStorage` under `cabin-lights`. To make the door open the photo rolls, for example, give it an `act` that leaves the room and runs `film`.

## Add Photo Rolls

The `film` command reads `photos/manifest.json`. Add optimized public images to `photos/thumbs/` and `photos/full/`, then add roll entries to the manifest.

Keep originals, scans, and source files out of the repo. `.gitignore` excludes `source-photos/`, `originals/`, and common high-resolution source formats.

## Publish

Commit changes to `main` and push to GitHub. GitHub Pages will rebuild the static site from the repository.
