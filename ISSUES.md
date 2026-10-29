# Problemas conocidos y pendientes

Lista de errores, limitaciones y tareas pendientes detectados durante la primera sesión (v0.1.0), para trabajar en las próximas.

## Limitaciones de render

### 1. El word-wrap se calcula sobre el TeX oculto
Con `editor.wordWrap` activo (por defecto en Markdown), VS Code parte las líneas según el largo del **código fuente**, aunque esté oculto. Una línea con muchas fórmulas se corta antes de lo que parece necesario (se vio en `test-fixtures/sample.md`, línea 5, con la ventana angosta).
- La API no permite influir en el cálculo del wrap.
- Ideas a investigar: ocultar con `letter-spacing` negativo en vez de `display: none` (no cambia el cálculo, pero vale medirlo) o avisar en la documentación que conviene `"[markdown]": { "editor.wordWrap": "off" }`.

### 2. Las fórmulas altas pisan las líneas vecinas
Matrices, fracciones y sumas con límites se dibujan a tamaño real y se superponen con la línea de arriba y la de abajo (ver `\begin{pmatrix}` en el sample). VS Code no permite cambiar la altura de una línea.
- **Resuelto en v0.2.0:** se achican hasta entrar en la línea y, si haría falta bajar de 0,8, se muestran como chip con vista previa en el hover.

### 3. El color por defecto solo depende del tipo de tema
Una extensión no puede leer los colores del tema, así que `resolveColor` (`src/config.ts`) elige entre 4 colores fijos según `ColorThemeKind`. En temas con un foreground distinto del gris estándar la fórmula no coincide con el texto.
- Idea: usar `currentColor` y que el SVG lo herede. No funciona con `contentIconPath` (es una imagen), pero se podría probar con un `mask-image` vía inyección de CSS y `background-color: var(--vscode-editor-foreground)`.

### 4. El ocultamiento usa un hack de CSS no oficial
`HIDE_SOURCE_CSS = 'none; display: none;'` en `src/decorator.ts` depende de que VS Code copie `textDecoration` sin escapar en una regla CSS. También el `vertical-align` del `before` usa el mismo truco. Una versión futura de VS Code podría romperlo.
- Falta el fallback planeado (`opacity: 0` + `letterSpacing` negativo) y alguna forma de detectar que el hack dejó de funcionar.

## Alcance pendiente

### 5. ~~Display math (`$$...$$`) no se renderiza~~
Resuelto en v0.3.0:
- `$$...$$` de una línea se renderiza en modo display (o como chip si no entra en la línea).
- Los bloques multilínea se dibujan en el editor, por filas (tablas con una fila por línea, recortadas de la tabla completa) o por franjas del alto de una línea (el resto). Si no se pueden dibujar se muestran como TeX, sin hover; se quitó la opción de mostrarlos como chip (`displayMath`, `foldDisplayMath`) antes de publicarla.
- Las posiciones de las filas y de los diagnósticos de KaTeX se calculan bien en documentos con CRLF.
- Limitaciones que quedan: ver los ítems 17 a 20.

### 6. Delimitadores `\(...\)` y `\[...\]` no soportados.

## Parser (`src/parser.ts`)

### 7. Listas con contenido indentado se toman como código
Una línea indentada con 4+ espacios después de una línea en blanco se trata como bloque de código indentado, pero dentro de una lista (continuación de un ítem) es texto normal. Las fórmulas en párrafos de continuación de listas no se renderizan.

### 8. `$a$$b$` no produce ninguna fórmula
El `$$` del medio se interpreta como apertura de display math. Pandoc se comporta parecido, pero conviene confirmarlo y decidir.

### 9. Otros contextos que no se excluyen
No se ignoran: front matter YAML, bloques HTML (`<pre>`, `<code>`), URLs ni el texto de los links. Un `$` dentro de ellos podría tomarse como fórmula.

## Display math

### 17. Las filas se miden parcheando MathJax
`recordTableRows` (`src/renderer.ts`) parchea `SVGmtable.placeRows` de MathJax 3.2.2 para medir las filas. Si se actualiza MathJax puede dejar de funcionar; el modo por filas cae a franjas cuando las medidas no cierran con el `viewBox`, así que no rompe, pero degrada el render sin avisar.

### 18. Los bloques se dibujan dentro de las líneas que ya tienen
VS Code no puede agregar espacio entre líneas: y las líneas con `$$`, `\begin` y `\end` quedan vacías. Un bloque que habría que achicar demasiado se muestra como TeX, sin vista previa.

Parcialmente resuelto en v0.3.0: en los bloques por filas, todas las filas usan una única escala y una fila más alta que la línea desborda sobre el espacio libre de las líneas vecinas (`margin-top` negativo). La escala es la mayor que evita superposiciones entre filas consecutivas y que la primera y la última salgan del bloque. Si esa escala sería menor que 0.8, se vuelve al achique por fila. Las limitaciones del desborde están en los ítems 21 a 25.

### 19. Una tabla solo se dibuja por filas en casos acotados
Hace falta que cada fila empiece en su propia línea y que el bloque no tenga nada más que la tabla; si no, se dibuja en franjas y, al editarlo, todo el bloque muestra su TeX.

### 20. Desplegado de plegados viejos basado en comandos y temporizadores
La extensión ya no pliega bloques, pero el desplegado de plegados viejos usa `editor.unfold` con una espera de 500 ms, porque VS Code restaura el plegado guardado al terminar de calcular las regiones. Solo actúa sobre el editor activo. Verificado por tests, no a mano: falta mirar parpadeos al abrir archivos grandes con muchos bloques.

### 21. Una fila que desborda puede tapar el TeX que se está editando
Mientras se edita una línea del bloque, una fila vecina que desborda puede tapar parte del TeX revelado de esa línea.

### 22. El desborde no se ve si la línea de la fila queda fuera de pantalla
VS Code solo dibuja las líneas visibles: al hacer scroll, la parte desbordada de una fila cuya línea quedó fuera de pantalla no se ve.

### 23. El centro de la línea es una estimación
Se estima a 0.25 em de la fuente del editor sobre la línea base (`AXIS_EM` en `src/decorator.ts`). Con fuentes o `lineHeight` inusuales el desborde puede quedar algo corrido.

### 24. Escala desactualizada con TeX inválido
Si la edición deja el TeX inválido, se reutiliza el último render válido con su escala anterior aunque el layout de líneas haya cambiado. Es transitorio: se corrige apenas el TeX vuelve a ser válido.

### 25. `margin-top` negativo sin verificar a mano
No hay tests de lo visual (tamaños, escalas, márgenes de las decoraciones, contenido del SVG): se verifica a mano en cada actualización. Queda por verificar a mano que el `margin-top` negativo de las imágenes de las filas de los bloques `$$` no corra la línea base del texto.

### 26. La vista previa al editar fórmulas inline desplaza el resto de la línea
Mientras el cursor está en una fórmula inline (`$...$` o `$$...$$` de una línea), la vista previa después del `$` de cierre corre a la derecha el resto de la línea, y con word-wrap puede partirla distinto que sin edición. Su alineación con la línea base no se verificó a mano (igual que el ítem 25).

### 27. Criterio distinto para bloques `$$` multilínea rotos
Un bloque `$$` multilínea con TeX roto, sin render previo y con el cursor adentro no se subraya, a diferencia de las fórmulas inline, que sí se subrayan al editarlas.

## Sin verificar

### 10. Hover no probado a mano
`src/hover.ts` muestra la imagen como `![math](data:...)` en un `MarkdownString`. No se verificó que VS Code permita imágenes `data:` en hovers.

### 11. Revelado al mover el cursor: verificado solo por tests
El test de integración comprueba la lógica, pero no se miró en pantalla (parpadeo, posición del cursor al entrar a un rango oculto, navegación con flechas sobre fórmulas ocultas, selección por doble clic).

### 12. Rendimiento sin medir
Falta probar un archivo con ~1000 fórmulas. Cada cambio de selección recorre todas las fórmulas del documento (render cacheado, pero igual se crean todas las decoraciones); conviene limitarlo a `editor.visibleRanges`. El debounce de `onDidChangeTextDocument` queda casi anulado porque escribir también dispara `onDidChangeTextEditorSelection`, que re-parsea en el acto.

### 13. CI sin correr
`.github/workflows/ci.yml` nunca se ejecutó; `xvfb-run` en Ubuntu queda por confirmar.

## Empaquetado y publicación

### 14. Bundle grande (1.74 MB minificado)
Se cargan todos los paquetes TeX de MathJax (`AllPackages`). Se podría importar solo un subconjunto (base, ams, newcommand, boldsymbol, color, cancel, ...) o cargar MathJax de forma diferida en el primer render.

### 15. Metadata del Marketplace
- ~~Icono PNG 128×128~~: agregado en v0.2.0 (`images/icon.png`).
- Falta un GIF o captura de demo en el README.
- Confirmar el publisher `polecoder` (tiene que existir en el Marketplace) y la licencia MIT asumida.

### 16. ~~Restos del scaffold~~
Resuelto en v0.2.0: se borró `vsc-extension-quickstart.md`.

### 28. El recorte de la vista previa al romperse el cierre tiene casos sin cubrir
Si al editar una fórmula inline el `$` de cierre deja de valer (espacio antes o `\`), la vista previa y el subrayado quedan en ese `$` (`previewInline`, `closingDelimiterError`). El recorte solo funciona si la fórmula tuvo un render válido mientras se editaba (`lastGoodInline`). No cubre:
- Abrir un documento que ya tiene la fórmula rota.
- Fórmulas que van como chip.
- Varios cursores, ni dos editores del mismo documento.
- Justo después de cambiar el tema o la configuración.

En esos casos vuelve al comportamiento anterior: la vista previa aparece al final de todo el tramo que abarca la fórmula.

### 29. Un dígito después del `$` de cierre no se recorta
`$x$5` también rompe el cierre (regla Pandoc), pero el dígito cae fuera de la fórmula guardada y no se detecta como en el ítem 28: vuelve al comportamiento anterior.
