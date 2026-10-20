# Math Inline

Extensión de VS Code que renderiza matemática inline `$...$` en editores Markdown. Código en `src/`, tests con `npm test`.

## Comentarios en el código

Los comentarios de funciones, clases, interfaces y constantes importantes son estilo Doxygen y en español. Los mantiene el subagente **Comentarios** (`.claude/agents/comentarios.md`).

Cada vez que implementes o modifiques funcionalidad, antes de dar el trabajo por terminado (y antes de hacer commit), invocá al subagente Comentarios indicándole los archivos y símbolos que cambiaron. Revisá lo que cambió y corré `npm run check-types` y `npm run lint` después.
