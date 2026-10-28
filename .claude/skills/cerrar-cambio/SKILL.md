---
name: cerrar-cambio
description: Cierra un cambio de la extensión Math Inline antes de darlo por terminado o de hacer commit, invocando a los subagentes que correspondan (Vulnerabilidades, Reviewer, Tests, Comentarios, Publisher) según el tamaño del cambio, en paralelo cuando se puede, y haciendo una única verificación final. Usala siempre que termines de implementar o modificar funcionalidad, corregir un bug o cambiar dependencias.
---

# Cerrar un cambio

Seguí estos pasos en orden. `$ARGUMENTS`, si viene, describe el cambio.

## 1. Relevá qué cambió

Corré `git status --short` y `git diff HEAD --stat` (y `git diff $(git merge-base HEAD origin/main)...HEAD --stat` si ya hay commits en la rama). Armá la lista de archivos y símbolos que cambiaron y una descripción de una o dos líneas del cambio: se la vas a pasar a cada subagente.

## 2. Elegí el nivel

| Nivel | Cuándo | Subagentes |
|---|---|---|
| **Mínimo** | Solo cambian textos, comentarios, documentación, configuración de herramientas (`.claude/`, `.vscode/`, CI) o tests, sin cambiar comportamiento de `src/`. | Ninguno, o solo **Reviewer** si tocaste tests o CI. Si cambiaste textos visibles de `package.json` a mano, **Publisher** para verificar la coherencia. |
| **Normal** | Cambia el comportamiento de `src/`: funcionalidad nueva, bug corregido, refactor. | Todos menos Vulnerabilidades. |
| **Dependencias** | Cambiaron `dependencies`, `devDependencies` u `overrides` de `package.json`. | **Vulnerabilidades** primero, y después lo que corresponda por el resto del cambio. |

Si dudás entre dos niveles, elegí el más alto. Decí en una línea qué nivel elegiste y por qué.

## 3. Invocá a los subagentes

Cada subagente arranca sin tu contexto: pasale los archivos y símbolos que cambiaron, la descripción del cambio y lo que te hayan informado los subagentes anteriores que le sirva. Avisales que la verificación final (`npm test`, `check-types`, `lint`) la hacés vos, para que no repitan corridas que no necesitan (Tests sí corre los tests: es su trabajo).

1. **Vulnerabilidades** (solo en el nivel Dependencias), indicándole qué dependencias cambiaron. Si cambió `package.json`, sus cambios entran en los pasos siguientes.
2. **Reviewer** y **Tests**, en paralelo (en el mismo mensaje): el Reviewer no modifica nada y Tests solo escribe en `src/test/`. Decile al Reviewer que ignore los cambios de `src/test/` que aparezcan mientras revisa: son de Tests, que está trabajando en paralelo.
3. Si alguno informa problemas o bugs, resolvelos (o consultalo con el usuario si la decisión es suya). Si el arreglo cambia el código de forma no trivial, volvé a pasarle el arreglo al **Reviewer**.
4. **Comentarios** y **Publisher**, en paralelo: Comentarios solo edita comentarios de `src/` y Publisher solo la documentación y los textos de `package.json`.
   - A Comentarios pasale también los archivos de test que haya tocado Tests.
   - A Publisher pasale qué cambió para el usuario (funcionalidad, settings, comandos, bugs corregidos), los problemas de `ISSUES.md` que se resolvieron, las limitaciones o pendientes que quedaron y los bugs que haya informado Tests.
5. Si Publisher informa inconsistencias o decisiones pendientes (por ejemplo, subir la versión), resolvelas o consultalo con el usuario. Para subir la versión está la skill `/release`, que la invoca el usuario.

## 4. Verificación final (una sola vez)

1. Revisá el diff completo (`git diff HEAD`) para ver lo que cambiaron los subagentes.
2. Corré `npm test`, `npm run check-types` y `npm run lint`. Si algo falla, corregilo y repetí solo lo que falló.

## 5. Informe

Resumí en pocas líneas qué hizo cada subagente, qué problemas se resolvieron y qué quedó pendiente, con el resultado de la verificación final.
