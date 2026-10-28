# Math Inline

Extensión de VS Code que renderiza matemática inline `$...$` en editores Markdown. Código en `src/`, tests en `src/test/` (`npm test`; con cobertura, `npm run test:coverage`).

## Comentarios en el código

Los comentarios de funciones, clases, interfaces y constantes importantes son estilo Doxygen y en español. Los mantiene el subagente **Comentarios** (`.claude/agents/comentarios.md`).

## Tests

Los tests y su cobertura los mantiene el subagente **Tests** (`.claude/agents/tests.md`): mide la cobertura, busca el comportamiento sin proteger y escribe tests nuevos en `src/test/`. No modifica el código de producción; si encuentra bugs, los informa.

## Dependencias

Las vulnerabilidades de las dependencias las revisa el subagente **Vulnerabilidades** (`.claude/agents/vulnerabilidades.md`): corre `npm audit`, rastrea de dónde viene cada paquete vulnerable y lo corrige en `package.json` (actualizando la dependencia o, si un paquete intermedio fija una versión vulnerable, con `overrides`). No modifica el código de `src/`; si una corrección lo requiere, lo informa.

## Documentación

La documentación la mantiene el subagente **Publisher** (`.claude/agents/publisher.md`): `README.md` (página del Marketplace, en inglés), `CHANGELOG.md` (Keep a Changelog, en inglés, con lo nuevo en `[Unreleased]`), `ISSUES.md` (problemas y pendientes, en español) y los textos visibles de `package.json` (descripciones de settings y comandos). Verifica contra el código lo que documenta. No modifica el código ni las dependencias; si encuentra diferencias entre el código y la documentación que parecen bugs, o propone subir la versión, lo informa.

## Revisión

Los cambios los revisa el subagente **Reviewer** (`.claude/agents/reviewer.md`): busca bugs, fugas de recursos de la API de VS Code y problemas de rendimiento del render en el diff. No modifica archivos.

## Al implementar o modificar funcionalidad

Antes de dar el trabajo por terminado (y antes de hacer commit), usá la skill **`/cerrar-cambio`**: elige qué subagentes invocar según el tamaño del cambio, los corre en paralelo cuando se puede y hace la verificación final (`npm test`, `npm run check-types`, `npm run lint`). Si cambian dependencias u `overrides` de `package.json`, incluye al subagente **Vulnerabilidades**.

Para preparar una versión nueva está la skill **`/release`** (la invoca el usuario).
