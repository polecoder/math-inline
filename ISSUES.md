# Problemas conocidos y pendientes

Lista de errores, limitaciones y tareas pendientes detectados durante la primera sesión (v0.1.0), para trabajar en las próximas.

## Limitaciones de render

### 1. El word-wrap se calcula sobre el TeX oculto
Con `editor.wordWrap` activo (por defecto en Markdown), VS Code parte las líneas según el largo del **código fuente**, aunque esté oculto. Una línea con muchas fórmulas se corta antes de lo que parece necesario (se vio en `test-fixtures/sample.md`, línea 5, con la ventana angosta).
- La API no permite influir en el cálculo del wrap.
- Ideas a investigar: ocultar con `letter-spacing` negativo en vez de `display: none` (no cambia el cálculo, pero vale medirlo) o avisar en la documentación que conviene `"[markdown]": { "editor.wordWrap": "off" }`.

### 2. Las fórmulas altas pisan las líneas vecinas
Matrices, fracciones y sumas con límites se dibujan a tamaño real y se superponen con la línea de arriba y la de abajo (ver `\begin{pmatrix}` en el sample). VS Code no permite cambiar la altura de una línea.
- Opciones: escalar automáticamente las fórmulas que superen la altura de línea (con un tope mínimo), o un setting `mathInline.maxHeight` con `fit` / `overflow`.

### 3. El color por defecto solo depende del tipo de tema
Una extensión no puede leer los colores del tema, así que `resolveColor` (`src/config.ts`) elige entre 4 colores fijos según `ColorThemeKind`. En temas con un foreground distinto del gris estándar la fórmula no coincide con el texto.
- Idea: usar `currentColor` y que el SVG lo herede. No funciona con `contentIconPath` (es una imagen), pero se podría probar con un `mask-image` vía inyección de CSS y `background-color: var(--vscode-editor-foreground)`.

### 4. El ocultamiento usa un hack de CSS no oficial
`HIDE_SOURCE_CSS = 'none; display: none;'` en `src/decorator.ts` depende de que VS Code copie `textDecoration` sin escapar en una regla CSS. También el `vertical-align` del `before` usa el mismo truco. Una versión futura de VS Code podría romperlo.
- Falta el fallback planeado (`opacity: 0` + `letterSpacing` negativo) y alguna forma de detectar que el hack dejó de funcionar.

## Alcance pendiente

### 5. Display math (`$$...$$`) no se renderiza
El parser lo detecta solo para ignorarlo (ni el inline `$$x$$` ni el bloque multilínea). Para v0.2: al menos `$$...$$` en una sola línea como `displaystyle` inline; para bloques multilínea hay que decidir cómo ocultar las líneas intermedias (¿folding?).

### 6. Delimitadores `\(...\)` y `\[...\]` no soportados.

## Parser (`src/parser.ts`)

### 7. Listas con contenido indentado se toman como código
Una línea indentada con 4+ espacios después de una línea en blanco se trata como bloque de código indentado, pero dentro de una lista (continuación de un ítem) es texto normal. Las fórmulas en párrafos de continuación de listas no se renderizan.

### 8. `$a$$b$` no produce ninguna fórmula
El `$$` del medio se interpreta como apertura de display math. Pandoc se comporta parecido, pero conviene confirmarlo y decidir.

### 9. Otros contextos que no se excluyen
No se ignoran: front matter YAML, bloques HTML (`<pre>`, `<code>`), URLs ni el texto de los links. Un `$` dentro de ellos podría tomarse como fórmula.

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

### 15. Falta metadata del Marketplace
- Icono PNG 128×128 (campo `icon` en `package.json`).
- GIF de demo en el README (hay un TODO).
- Confirmar el publisher `polecoder` (tiene que existir en el Marketplace) y la licencia MIT asumida.

### 16. Restos del scaffold
`vsc-extension-quickstart.md` sigue en el repo (ya está excluido del `.vsix`); se puede borrar.
