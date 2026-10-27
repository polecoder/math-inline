# Change Log

All notable changes to the "math-inline" extension are documented in this file, following [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Display math. `$$...$$` on a single line is rendered in display style (or as a chip when too tall).
- Multi-line `$$` blocks are drawn in the editor: tables (`aligned`, `cases`, matrices, ...) one row per line with aligned columns, other formulas cut into line-high bands. Editing a row reveals only that line and previews the row at its end; while the TeX is broken the other rows keep their last good rendering. A block that cannot be drawn (folded by hand, too small for its lines or with a TeX error) shows its plain TeX, without a preview. Multi-line blocks have no hover and are never folded automatically; blocks left folded from an earlier session are unfolded once.
- Warnings in the Problems panel for formulas that VS Code's Markdown preview (KaTeX) cannot render. Setting `mathInline.katexWarnings`.

### Changed

- Inline formulas (and one-line `$$...$$`) that do not fit the line are no longer turned into a chip right away. If there are empty lines above or below, they are drawn larger (up to natural size) and overflow onto them, with the same single scale as the rows of `$$` blocks. A run of empty lines between two formulas is split in half. In a dense paragraph nothing changes: they shrink down to 80% and then become a chip. The overflowing image does not take mouse clicks.
- With word wrap on, a formula overflows upward only if it ends before the wrap column, and downward only if the whole line fits before it. The column is `editor.wordWrapColumn` with `wordWrapColumn`, 60 with `on`, the smaller of both with `bounded`, and there is no limit with `off`. Math Inline now reacts to changes of `editor.wordWrap` and `editor.wordWrapColumn`.
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
