# Math Inline

Renders inline `$...$` math in Markdown files **directly in the editor**, not just in the preview.

## Features

- Formulas between single dollars, like `$e^{i\pi} + 1 = 0$`, are replaced by their rendered version (MathJax, SVG output).
- Move the cursor into a formula (or select it) to edit its TeX source; it renders again when you leave.
- Invalid TeX is underlined, and hovering it shows the error.
- Hover a formula's source to see a larger rendering.
- Formulas are scaled down to fit the line. Those that would get too small (matrices, stacked fractions, big operators with limits) are replaced by a **∑ show formula** chip: hover it to see the formula in display mode. While you edit one, the preview opens next to the cursor.
- Display math written on one line, like `$$\int_0^1 x\,dx$$`, is rendered in display style the same way, and becomes a chip when it would not fit.
- Multi-line `$$ ... $$` blocks are drawn on their own lines:
  - A block that is a single table (`aligned`, `cases`, `array`, matrices, `gathered`, ...) with one row per line shows **each row rendered on its own line**, with the columns aligned as in the full formula. Fractions in tables use text style so rows fit the line height.
  - Put the cursor on a row to edit it: only that line shows its TeX, with a live preview of the row at the end of the line, while the rest of the block stays rendered. While the TeX is half-typed (say, an unclosed `\frac{`), the other rows keep their last good rendering and the edited line is underlined.
  - Any other block (a single integral, a long sum split across lines, ...) is cut into horizontal bands, one per line of the block.
  - Blocks that would get too small, or that you fold by hand, are shown as a **∑ show formula** chip with the preview on hover (set `mathInline.displayMath` to `chip` to always use it).
- Formulas that render here but that VS Code's Markdown preview (KaTeX) cannot render, like `\bbox`, get a warning in the Problems panel pointing at the unsupported command.

Dollar signs follow Pandoc's rules, so `$5 and $10` is not math: the opening `$` must not be followed by a space, and the closing `$` must not be preceded by a space nor followed by a digit. Escaped dollars (`\$`), code spans and code blocks are ignored.

## Settings

| Setting | Default | Description |
|---|---|---|
| `mathInline.enabled` | `true` | Render inline math in Markdown editors. |
| `mathInline.scale` | `1` | Size of formulas relative to the editor font size. |
| `mathInline.color` | `""` | CSS color for formulas. Empty picks one based on the theme (light/dark/high contrast). |
| `mathInline.displayMath` | `"render"` | How multi-line `$$` blocks are shown: `render` draws them on their own lines (by rows or bands); `chip` shows a chip with the preview on hover. |
| `mathInline.foldDisplayMath` | `true` | Fold `$$` blocks shown as a chip, and unfold them while the cursor is inside. When off, a block only shows its chip if you fold it by hand. Blocks drawn in the editor are never folded automatically. |
| `mathInline.katexWarnings` | `true` | Warn about formulas that VS Code's Markdown preview (KaTeX) cannot render. |

Command: **Math Inline: Toggle Inline Math Rendering**, bound to <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> (<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> on macOS) in Markdown editors. Press it once to see the TeX source of every formula, and again to see them rendered. To use another shortcut, open **Preferences: Open Keyboard Shortcuts** and search for `mathInline.toggle`.

## Known limitations

- VS Code cannot add room between lines, so a `$$` block is drawn within the lines it already has: rows taller than a line (stacked fractions, matrices inside a row) are scaled down, and the lines with `$$`, `\begin` and `\end` stay empty. Hover previews are limited by VS Code to about 100 KB, so a very long block shows a notice instead of its preview.
- A table is drawn by rows only if every row starts on its own line and the block holds nothing but the table; otherwise it is drawn in bands, and while you edit it the whole block shows its TeX.
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
