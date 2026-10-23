# Change Log

All notable changes to the "math-inline" extension are documented in this file, following [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Display math. `$$...$$` on a single line is rendered in display style (or as a chip when too tall). Multi-line `$$` blocks fold into a **∑ show formula** chip with a display-mode preview on hover, and unfold while the cursor is inside them.
- Multi-line `$$` blocks are drawn in the editor: tables (`aligned`, `cases`, matrices, ...) one row per line with aligned columns, other formulas cut into line-high bands. Editing a row reveals only that line and previews the row at its end; while the TeX is broken the other rows keep their last good rendering. Setting `mathInline.displayMath` (`render` or `chip`).
- Warnings in the Problems panel for formulas that VS Code's Markdown preview (KaTeX) cannot render. Setting `mathInline.katexWarnings`.
- Setting `mathInline.foldDisplayMath` to turn off the automatic folding of `$$` blocks shown as a chip.

### Changed

- Rendered formulas are much smaller (glyphs are defined once per image), so long formulas fit in VS Code's hover size limit instead of showing as text.
- Tables inside inline formulas (like `$\begin{pmatrix}...\end{pmatrix}$`) use text style, so they fit the line more often.

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
