---
name: release
description: Prepara una versión nueva de la extensión Math Inline (sube la versión, cierra el CHANGELOG, empaqueta el .vsix y abre el PR de release). Solo la invoca el usuario, con la versión nueva o el tipo de cambio (patch, minor, major) como argumento.
disable-model-invocation: true
argument-hint: "<versión | patch | minor | major>"
---

# Preparar una release

Argumento: `$ARGUMENTS` (una versión como `0.3.0`, o `patch`, `minor` o `major`).

## 1. Chequeos previos

- `git status --short` tiene que estar limpio y la base tiene que ser `main` actualizado (`git fetch origin` y `git log HEAD..origin/main` vacío). Si no, avisá y frená.
- Calculá la versión nueva a partir de `version` en `package.json` y del argumento. Si no vino argumento, proponé una según `## [Unreleased]` del CHANGELOG (solo `### Fixed` o `### Security`: patch; algo en `### Added` o `### Changed`: minor; como la extensión está en `0.x`, un cambio incompatible también es minor) y confirmala con el usuario.
- `## [Unreleased]` del CHANGELOG no puede estar vacío.

## 2. Cambios de la release

Trabajá en una rama `release/v<versión>` creada desde `main`.

1. `npm version <versión> --no-git-tag-version`: actualiza `version` en `package.json` y `package-lock.json`. Cambiar solo la versión no requiere al subagente Vulnerabilidades.
2. En `CHANGELOG.md`, renombrá `## [Unreleased]` a `## [<versión>] - <fecha de hoy, AAAA-MM-DD>` y agregá un `## [Unreleased]` vacío arriba. No cambies el contenido de las entradas.
3. En `ISSUES.md`, a las entradas marcadas **Resuelto:** sin versión que correspondan a esta release, agregales la versión.
4. Invocá al subagente **Publisher** para que verifique que README, CHANGELOG, ISSUES y los textos de `package.json` estén coherentes con el código de esta versión. Que no agregue entradas nuevas al CHANGELOG: solo que informe lo que falte.

## 3. Verificación

- `npm audit` (si hay vulnerabilidades, frená y sugerí invocar al subagente **Vulnerabilidades**).
- `npm test`, `npm run check-types` y `npm run lint`.
- `npx vsce package` y revisá con `npx vsce ls` que el paquete no incluya archivos de más (`src/`, `coverage/`, `.claude/`, fixtures).

## 4. Publicar la rama

- Commit (`Release v<versión>`), push de la rama y PR a `main` con las entradas del CHANGELOG de esta versión en la descripción.
- No crees el tag ni publiques en el Marketplace por tu cuenta. Al terminar, indicale al usuario los comandos para después de mergear el PR:
  - `git checkout main && git pull && git tag v<versión> && git push origin v<versión>`
  - `npx vsce publish` (requiere el token del publisher `polecoder`).
