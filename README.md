# Math Inline

Renders inline `$...$` math in Markdown files **directly in the editor**, not just in the preview.

## Features

- Formulas between single dollars, like `$e^{i\pi} + 1 = 0$`, are replaced by their rendered version (MathJax, SVG output).
- Move the cursor into a formula (or select it) to edit its TeX source; it renders again when you leave.
- Invalid TeX is underlined, and hovering it shows the error.
- Hover a formula's source to see a larger rendering.
- Formulas are scaled down to fit the line. Those that would get too small (matrices, stacked fractions, big operators with limits) are replaced by a **∑ show formula** chip: hover it to see the formula in display mode. While you edit one, the preview opens next to the cursor.
- Display math written on one line, like `$$\int_0^1 x\,dx$$`, is rendered in display style the same way, and becomes a chip when it would not fit.
- Multi-line `$$ ... $$` blocks are folded into a chip on their first line. Put the cursor on the chip (or unfold the block with the folding arrow) to see its TeX; while the cursor is inside, the preview opens next to it as you type, and the block folds again when you leave. Blocks with TeX errors stay unfolded and underlined.

Dollar signs follow Pandoc's rules, so `$5 and $10` is not math: the opening `$` must not be followed by a space, and the closing `$` must not be preceded by a space nor followed by a digit. Escaped dollars (`\$`), code spans and code blocks are ignored.

## Settings

| Setting | Default | Description |
|---|---|---|
| `mathInline.enabled` | `true` | Render inline math in Markdown editors. |
| `mathInline.scale` | `1` | Size of formulas relative to the editor font size. |
| `mathInline.color` | `""` | CSS color for formulas. Empty picks one based on the theme (light/dark/high contrast). |
| `mathInline.foldDisplayMath` | `true` | Fold multi-line `$$` blocks into their chip, and unfold them while the cursor is inside. When off, a block only shows its chip if you fold it by hand. |

Command: **Math Inline: Toggle Inline Math Rendering**, bound to <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> (<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> on macOS) in Markdown editors. Press it once to see the TeX source of every formula, and again to see them rendered. To use another shortcut, open **Preferences: Open Keyboard Shortcuts** and search for `mathInline.toggle`.

## Known limitations

- Multi-line display math is never drawn in the editor itself, only in the chip's hover, since VS Code cannot make room for it. If you unfold a block by hand, it folds again after you edit the document. Hover previews are limited by VS Code to about 100 KB, so a very long block shows a notice instead of its preview.
- VS Code cannot change line heights, so tall formulas are scaled down or collapsed into a chip instead of being shown at their natural size. Use `mathInline.scale` to adjust the overall size.
- With word wrap on, VS Code wraps lines based on the length of the (hidden) TeX source, so a line full of formulas may wrap earlier than it looks like it should.
- Extensions cannot read theme colors, so the default formula color depends only on the theme kind. Set `mathInline.color` to match your theme exactly.

## Development

```sh
npm install
npm run watch   # rebuild on change; press F5 to open test-fixtures/sample.md in a dev host
npm test        # parser unit tests + integration tests in a VS Code instance
npm run package # build math-inline-<version>.vsix
```
