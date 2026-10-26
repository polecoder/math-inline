# Math Inline

Extensión de VS Code que renderiza matemática inline `$...$` en editores Markdown. Código en `src/`, tests en `src/test/` (`npm test`; con cobertura, `npm run test:coverage`).

## Comentarios en el código

Los comentarios de funciones, clases, interfaces y constantes importantes son estilo Doxygen y en español. Los mantiene el subagente **Comentarios** (`.claude/agents/comentarios.md`).

## Tests

Los tests y su cobertura los mantiene el subagente **Tests** (`.claude/agents/tests.md`): mide la cobertura, busca el comportamiento sin proteger y escribe tests nuevos en `src/test/`. No modifica el código de producción; si encuentra bugs, los informa.

## Dependencias

Las vulnerabilidades de las dependencias las revisa el subagente **Vulnerabilidades** (`.claude/agents/vulnerabilidades.md`): corre `npm audit`, rastrea de dónde viene cada paquete vulnerable y lo corrige en `package.json` (actualizando la dependencia o, si un paquete intermedio fija una versión vulnerable, con `overrides`). No modifica el código de `src/`; si una corrección lo requiere, lo informa.

Cada vez que se modifique `package.json` (agregar, quitar o actualizar dependencias o `overrides`), invocá al subagente **Vulnerabilidades** antes de dar el trabajo por terminado (y antes de hacer commit), indicándole qué cambió. Si informa cambios que requieren tocar código o vulnerabilidades sin corrección, resolvelos o consultalo con el usuario.

## Documentación

La documentación la mantiene el subagente **Publisher** (`.claude/agents/publisher.md`): `README.md` (página del Marketplace, en inglés), `CHANGELOG.md` (Keep a Changelog, en inglés, con lo nuevo en `[Unreleased]`), `ISSUES.md` (problemas y pendientes, en español) y los textos visibles de `package.json` (descripciones de settings y comandos). Verifica contra el código lo que documenta. No modifica el código ni las dependencias; si encuentra diferencias entre el código y la documentación que parecen bugs, o propone subir la versión, lo informa.

## Al implementar o modificar funcionalidad

Cada vez que implementes o modifiques funcionalidad, antes de dar el trabajo por terminado (y antes de hacer commit):

1. Si cambió `package.json`, invocá al subagente **Vulnerabilidades** indicándole qué dependencias cambiaron.
2. Invocá al subagente **Reviewer** indicándole los archivos que cambiaron. Si informa algún problema, resolvelo (o consultalo con el usuario) antes de seguir.
3. Invocá al subagente **Tests** indicándole los archivos y símbolos que cambiaron. Si informa bugs, resolvelos (o consultalo con el usuario) antes de seguir.
4. Invocá al subagente **Comentarios** indicándole los archivos y símbolos que cambiaron, incluidos los archivos de test que haya tocado el subagente Tests.
5. Invocá al subagente **Publisher** indicándole qué cambió (funcionalidad, settings, comandos, bugs corregidos, problemas de `ISSUES.md` resueltos y limitaciones o pendientes que quedaron), incluidos los bugs que haya informado el subagente Tests. Si informa inconsistencias con el código o decisiones pendientes (como subir la versión), resolvelas o consultalo con el usuario.
6. Revisá lo que cambió y corré `npm test`, `npm run check-types` y `npm run lint`.
