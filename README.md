# Math Inline

Renders inline `$...$` math in Markdown files **directly in the editor**, not just in the preview.

<!-- TODO: add a demo GIF, e.g. ![demo](images/demo.gif) -->

## Features

- Formulas between single dollars, like `$e^{i\pi} + 1 = 0$`, are replaced by their rendered version (MathJax, SVG output).
- Move the cursor into a formula (or select it) to edit its TeX source; it renders again when you leave.
- Invalid TeX is underlined, and hovering it shows the error.
- Hover a formula's source to see a larger rendering.

Dollar signs follow Pandoc's rules, so `$5 and $10` is not math: the opening `$` must not be followed by a space, and the closing `$` must not be preceded by a space nor followed by a digit. Escaped dollars (`\$`), code spans and code blocks are ignored.

## Settings

| Setting | Default | Description |
|---|---|---|
| `mathInline.enabled` | `true` | Render inline math in Markdown editors. |
| `mathInline.scale` | `1` | Size of formulas relative to the editor font size. |
| `mathInline.color` | `""` | CSS color for formulas. Empty picks one based on the theme (light/dark/high contrast). |

Command: **Math Inline: Toggle Inline Math Rendering**.

## Known limitations

- Display math (`$$...$$`) is not rendered yet; it is left as source.
- VS Code cannot change line heights, so tall formulas (fractions, matrices) are drawn at their natural size and may overlap neighbouring lines slightly. Use `mathInline.scale` to adjust.
- With word wrap on, VS Code wraps lines based on the length of the (hidden) TeX source, so a line full of formulas may wrap earlier than it looks like it should.
- Extensions cannot read theme colors, so the default formula color depends only on the theme kind. Set `mathInline.color` to match your theme exactly.

## Development

```sh
npm install
npm run watch   # rebuild on change; press F5 to open test-fixtures/sample.md in a dev host
npm test        # parser unit tests + integration tests in a VS Code instance
npm run package # build math-inline-<version>.vsix
```
