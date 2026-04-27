# Customizing decyphered.tech

This site is intentionally small: one HTML file, a few text files, and no build step.

## Edit Content

- Update `about.txt` to change the `about` command output.
- Update `values.txt` to change the `values` command output.
- Update the boot text near the bottom of `index.html`.

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

## Style

The terminal look is defined in the `<style>` block in `index.html`. Keep the CSS small and readable unless the site grows enough to justify splitting files.

## Add Photo Rolls

The `film` command reads `photos/manifest.json`. Add optimized public images to `photos/thumbs/` and `photos/full/`, then add roll entries to the manifest.

Keep originals, scans, and source files out of the repo. `.gitignore` excludes `source-photos/`, `originals/`, and common high-resolution source formats.

## Publish

Commit changes to `main` and push to GitHub. GitHub Pages will rebuild the static site from the repository.
