# Change Log

All notable changes to the "math-inline" extension are documented in this file, following [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Display math. `$$...$$` on a single line is rendered in display style (or as a chip when too tall).
- Multi-line `$$` blocks are drawn in the editor: tables (`aligned`, `cases`, matrices, ...) one row per line with aligned columns, other formulas cut into line-high bands. Editing a row reveals only that line and previews the row at its end; while the TeX is broken the other rows keep their last good rendering. A block that cannot be drawn (folded by hand, too small for its lines or with a TeX error) shows its plain TeX, without a preview. Multi-line blocks have no hover and are never folded automatically; blocks left folded from an earlier session are unfolded once.
- Live preview while editing a formula. With the cursor inside an inline `$...$` (or a single-line `$$...$$`), the rendered formula appears right after the closing `$`. If the TeX is invalid while you type, the formula is underlined with the error and the last valid rendering stays visible. If a space before the closing `$` (or a `\` escaping it) stops it from closing the formula, the preview stays at that `$` instead of at the end of the text the formula now runs over, and the `$` is underlined with an explanation. Formulas shown as a chip have no such preview: their hover still opens on its own.
- Warnings in the Problems panel for formulas that VS Code's Markdown preview (KaTeX) cannot render. Setting `mathInline.katexWarnings`.

### Changed

- Rendered formulas are much smaller (glyphs are defined once per image), so long formulas fit in VS Code's hover size limit instead of showing as text.
- Tables inside inline formulas (like `$\begin{pmatrix}...\end{pmatrix}$`) use text style, so they fit the line more often.
- In multi-line `$$` blocks drawn by rows, all rows now share one size instead of each being shrunk on its own, so rows with fractions or integrals no longer look smaller than the others. A tall row may overlap the free space of neighbouring lines. If that would make rows smaller than 80%, rows are shrunk one by one as before.

### Security

- Updated `@xmldom/xmldom` (used by MathJax) to a patched version, and the `serialize-javascript`, `@azure/msal-node` and `diff` development dependencies, to fix known vulnerabilities.

## [0.2.0] - 2026-10-21

### Added

- Keyboard shortcut for `Math Inline: Toggle Inline Math Rendering`: <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> (<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> on macOS), rebindable in Keyboard Shortcuts.
- Formulas too big to fit on a line (matrices, stacked fractions, ...) are shown as a small chip. Hover it to see the formula in display mode; the preview also opens on its own while the cursor is inside the formula.
- Extension icon.

### Changed

- Inline formulas are shrunk to fit the line height, and `\dfrac` / `\dbinom` are rendered in text style.

## [0.1.0]

- Render inline `$...$` math in Markdown editors with MathJax.
- Show the TeX source while the cursor or selection touches a formula.
- Underline invalid TeX and show the error on hover.
- Hover a formula's source to see a larger rendering.
- Settings: `mathInline.enabled`, `mathInline.scale`, `mathInline.color`; command `Math Inline: Toggle Inline Math Rendering`.
