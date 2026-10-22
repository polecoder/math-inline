# Change Log

All notable changes to the "math-inline" extension are documented in this file, following [Keep a Changelog](https://keepachangelog.com/).

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
