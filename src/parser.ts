/**
 * @brief Fórmula hallada en un documento Markdown.
 */
export interface MathSpan {
	/** Offset of the opening `$` (or `$$`). */
	start: number;
	/** Offset just past the closing `$` (or `$$`). */
	end: number;
	/** TeX source between the delimiters. */
	tex: string;
	/** `true` for display math (`$$...$$`); absent for inline math. */
	display?: boolean;
}

/** @brief Detecta, al comienzo del contenido de una línea, la apertura o cierre de un bloque de código cercado (``` o ~~~); el grupo 1 es el cerco. */
const FENCE = /^(`{3,}|~{3,})/;
/** @brief Detecta un separador horizontal (`---`, `***`, `___`, con espacios intercalados) desde el comienzo del contenido de una línea. */
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** @brief Detecta un encabezado ATX (`#` a `######`) desde el comienzo del contenido de una línea. */
const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/;
/** @brief Detecta un marcador de lista que puede interrumpir un párrafo: una viñeta o un número que empieza en 1. */
const INTERRUPTING_MARKER = /^(?:[-+*]|1[.)])/;
/** @brief Máximo anidamiento de paréntesis en el destino de un link (el mismo límite que cmark); acota el costo de los links sin cerrar. */
const MAX_LINK_PARENS = 32;
/** @brief Detecta la apertura de una etiqueta HTML cuyo contenido se ignora; el grupo 1 es el nombre. Es sticky: se aplica en `lastIndex`. */
const HTML_RAW_OPEN = /<(pre|script|style|textarea|code)(?=[\s>]|$)/iy;
/** @brief Detecta un autolink de CommonMark (`<esquema:...>`). Es sticky: se aplica en `lastIndex`. */
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/y;
/** @brief Etiquetas que abren un bloque HTML de tipo 1 de CommonMark (su contenido sigue después de una línea en blanco). */
const HTML_BLOCK_TAGS = new Set(['pre', 'script', 'style', 'textarea']);
/** @brief Expresión que busca el cierre de cada etiqueta de `HTML_RAW_OPEN`, por nombre en minúsculas. */
const HTML_RAW_CLOSE: Record<string, RegExp> = {
	pre: /<\/pre\s*>/gi,
	script: /<\/script\s*>/gi,
	style: /<\/style\s*>/gi,
	textarea: /<\/textarea\s*>/gi,
	code: /<\/code\s*>/gi,
};
/** @brief Cierre de un comentario HTML. */
const HTML_COMMENT_CLOSE = '-->';

/**
 * @brief Región HTML abierta cuyo contenido se ignora (comentario o etiqueta de `HTML_RAW_OPEN`).
 */
interface HtmlRegion {
	/** Closing delimiter: `-->` for comments, or a global regex for the closing tag. */
	close: string | RegExp;
	/**
	 * `true` if it opened an HTML block (comment or type-1 tag at the start of a line's content):
	 * it survives blank lines and swallows the rest of the line where it closes, as in CommonMark.
	 * Otherwise it is inline raw HTML: it ends with the paragraph (at a blank line).
	 */
	block: boolean;
}

/**
 * @brief Estado del escaneo que se arrastra de una línea a la siguiente.
 */
interface ScanState {
	/** Offset of the opening `$$` of an unclosed display block, or `undefined`. */
	display: number | undefined;
	/** HTML region still open at the end of the previous line, or `undefined`. */
	html: HtmlRegion | undefined;
	/** Unmatched `[` of the current paragraph, candidates to open the text of a link. */
	brackets: number;
	/** Set when an HTML block opened and closed on the scanned line: no paragraph is left open. */
	htmlBlockClosed: boolean;
}

/**
 * @brief Marcador de un ítem de lista hallado al comienzo del contenido de una línea.
 */
interface ListMarker {
	/**
	 * Column where the item's content starts (marker plus the spaces after it, as in CommonMark).
	 * If the item is empty or starts with indented code, it is the column right after the marker plus one.
	 */
	contentColumn: number;
	/** Index in the line where the content starts, past the marker and its spaces. */
	contentIndex: number;
	/** `true` if the content starts with 5 or more spaces after the marker: it is indented code. */
	code: boolean;
	/** `true` if nothing follows the marker. */
	empty: boolean;
}

/**
 * @brief Busca las fórmulas inline (`$...$`) y de bloque (`$$...$$`) de un documento Markdown.
 *
 * Sigue las reglas de Pandoc: el `$` de apertura no puede ir seguido de un espacio,
 * y el de cierre no puede ir precedido de un espacio ni seguido de un dígito.
 * Una fórmula inline no cruza líneas; una de bloque puede ocupar varias, pero no
 * cruzar una línea en blanco, y si no se cierra (o queda vacía) se descarta.
 *
 * Se ignoran, en un único recorrido por líneas:
 * - el código cercado, con sangría y en línea, y los `\$` escapados;
 * - el front matter YAML (ver `findFrontMatterEnd`);
 * - los comentarios HTML y el contenido de `<pre>`, `<code>`, `<script>`, `<style>` y `<textarea>`
 *   (ver `skipHtml`);
 * - el destino (y el título) de los links e imágenes `[texto](destino)`, y los autolinks `<esquema:...>`.
 *
 * Dentro de un ítem de lista la sangría se mide desde la columna del contenido del ítem: una línea
 * que lo continúa es texto y solo es código si tiene 4 o más espacios por encima de esa columna.
 *
 * @param text Contenido completo del documento.
 * @return Fórmulas halladas, en orden de aparición, con offsets sobre `text`.
 */
export function findMath(text: string): MathSpan[] {
	const spans: MathSpan[] = [];
	const lines = text.split('\n');
	const frontMatterEnd = findFrontMatterEnd(lines);
	const state: ScanState = { display: undefined, html: undefined, brackets: 0, htmlBlockClosed: false };
	// Content columns of the open list items, innermost last.
	const lists: number[] = [];
	let offset = 0;
	let fence: string | undefined;
	// No paragraph is open (start, blank line, or after a block that cannot be continued),
	// so an indented line is code and any list item can start.
	let noParagraph = true;
	// The last line opened an empty list item, which a blank line closes.
	let emptyItem = false;

	for (let n = 0; n < lines.length; n++) {
		const rawLine = lines[n];
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		const lineStart = offset;
		offset += rawLine.length + 1;
		if (n <= frontMatterEnd) {
			continue;
		}
		const blank = line.trim() === '';
		let indentIndex = 0;
		let indent = 0;
		while (line[indentIndex] === ' ' || line[indentIndex] === '\t') {
			indent = line[indentIndex] === '\t' ? indent + 4 - indent % 4 : indent + 1;
			indentIndex++;
		}

		if (state.html !== undefined) {
			if (!state.html.block && (blank || startsBlock(line, indentIndex, indent, lists[lists.length - 1] ?? 0))) {
				// Inline raw HTML ends with its paragraph; this line is handled below.
				state.html = undefined;
			} else {
				const end = findHtmlClose(line, 0, state.html.close);
				if (end === -1) {
					continue;
				}
				const block = state.html.block;
				state.html = undefined;
				noParagraph = block;
				if (!block) {
					scanLine(text, line, lineStart, end, -1, state, spans);
				}
				continue;
			}
		}

		if (fence !== undefined) {
			const fenceMatch = FENCE.exec(line.slice(indentIndex));
			if (fenceMatch && indent - (lists[lists.length - 1] ?? 0) <= 3 && fenceMatch[1][0] === fence[0]
				&& fenceMatch[1].length >= fence.length
				&& line.slice(indentIndex + fenceMatch[0].length).trim() === '') {
				fence = undefined;
				noParagraph = true;
			}
			continue;
		}
		if (blank) {
			if (emptyItem) {
				// A list item can start with at most one blank line: an empty item ends here.
				lists.pop();
				emptyItem = false;
			}
			noParagraph = true;
			// Display math cannot span a blank line: an unclosed block is dropped.
			state.display = undefined;
			state.brackets = 0;
			continue;
		}
		emptyItem = false;
		if (state.display !== undefined) {
			noParagraph = false;
			scanLine(text, line, lineStart, 0, -1, state, spans);
			continue;
		}

		const content = line.slice(indentIndex);
		let marker = listMarker(line, indentIndex, indent);
		const thematic = THEMATIC_BREAK.test(content);
		let fenceMatch = FENCE.exec(content);
		// A marker at least as indented as the innermost item opens a sublist inside its paragraph.
		const nested = indent >= (lists[lists.length - 1] ?? 0);
		if (!nested) {
			// A less indented line leaves the open items, unless it is a lazy continuation of their paragraph.
			const lazy = !noParagraph && marker === undefined && !thematic && fenceMatch === null
				&& !ATX_HEADING.test(content) && content[0] !== '>';
			while (!lazy && indent < (lists[lists.length - 1] ?? 0)) {
				lists.pop();
			}
		}
		const relative = indent - (lists[lists.length - 1] ?? 0);
		if (noParagraph && relative >= 4) {
			// Indented code block: noParagraph stays true, so following indented lines are code too.
			continue;
		}
		if (relative > 3) {
			// Paragraph continuation: no block can start here.
			marker = undefined;
			fenceMatch = null;
		}
		if (thematic && relative <= 3) {
			noParagraph = true;
			continue;
		}
		if (marker !== undefined && !noParagraph && (marker.empty || (nested && !INTERRUPTING_MARKER.test(content)))) {
			// Only a non-empty bullet item, or an ordered one starting at 1, can interrupt a paragraph.
			marker = undefined;
		}

		let contentIndex = indentIndex;
		let code = false;
		while (marker !== undefined) {
			lists.push(marker.contentColumn);
			contentIndex = marker.contentIndex;
			code = marker.code;
			emptyItem = marker.empty;
			marker = code || marker.empty ? undefined : listMarker(line, contentIndex, marker.contentColumn);
		}
		if (code) {
			// The item starts with indented code (5+ spaces after the marker).
			noParagraph = true;
			continue;
		}
		if (contentIndex !== indentIndex) {
			fenceMatch = FENCE.exec(line.slice(contentIndex));
		}
		if (fenceMatch) {
			fence = fenceMatch[1];
			continue;
		}
		state.htmlBlockClosed = false;
		scanLine(text, line, lineStart, contentIndex, relative <= 3 ? contentIndex : -1, state, spans);
		// Neither an empty item, a heading (a single line) nor an HTML block closed on this line opens a paragraph.
		noParagraph = emptyItem || state.htmlBlockClosed
			|| (relative <= 3 && ATX_HEADING.test(line.slice(contentIndex)));
	}
	return spans;
}

/**
 * @brief Busca las fórmulas inline (`$...$`) de un documento Markdown.
 *
 * Igual que `findMath`, pero descarta las fórmulas de bloque `$$...$$`.
 *
 * @param text Contenido completo del documento.
 * @return Fórmulas inline halladas, en orden de aparición, con offsets sobre `text`.
 */
export function findInlineMath(text: string): MathSpan[] {
	return findMath(text).filter(span => !span.display);
}

/**
 * @brief Ubica un offset del TeX de una fórmula como línea y columna, contando los saltos de línea del TeX.
 *
 * No se puede sumar el offset a `span.start`: el TeX de los bloques no tiene los `\r` de los
 * documentos CRLF, así que cada línea anterior correría la posición un carácter.
 *
 * @param span Fórmula.
 * @param offset Posición dentro de `span.tex`.
 * @return Línea relativa a la del delimitador de apertura y columna: en la línea 0, relativa al
 * comienzo del TeX (después del delimitador); en las demás, desde el comienzo de la línea.
 */
export function texLocation(span: MathSpan, offset: number): { line: number; column: number } {
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < offset; i++) {
		if (span.tex[i] === '\n') {
			line++;
			lineStart = i + 1;
		}
	}
	return { line, column: offset - lineStart };
}

/**
 * @brief Indica si una fórmula es un bloque `$$...$$` que ocupa más de una línea.
 *
 * @param span Fórmula a examinar.
 * @return `true` si es display math y su TeX contiene un salto de línea.
 */
export function isDisplayBlock(span: MathSpan): boolean {
	return span.display === true && span.tex.includes('\n');
}

/**
 * @brief Busca el final del front matter YAML de un documento.
 *
 * Hay front matter si la primera línea es `---`; termina en la siguiente línea que sea `---` o `...`
 * (se toleran espacios al final; `...` es el cierre alternativo de Pandoc). Si no se cierra, no hay
 * front matter y el documento se analiza entero: así se comporta Pandoc, y la vista previa de Markdown
 * de VS Code muestra ese `---` como separador. Además, mientras se escribe un front matter nuevo,
 * no desaparecen de golpe todas las fórmulas del documento.
 *
 * @param lines Líneas del documento (pueden terminar en `\r`).
 * @return Índice de la línea de cierre, o -1 si no hay front matter.
 */
function findFrontMatterEnd(lines: string[]): number {
	if (lines[0].trimEnd() !== '---') {
		return -1;
	}
	for (let n = 1; n < lines.length; n++) {
		const line = lines[n].trimEnd();
		if (line === '---' || line === '...') {
			return n;
		}
	}
	return -1;
}

/**
 * @brief Indica si una línea abre un bloque que corta un párrafo: cerco, encabezado ATX, separador o ítem de lista.
 *
 * Las citas (`>`) no cuentan: el parser no quita su prefijo, así que cada línea de una cita lo tiene.
 *
 * @param line Línea sin el salto de línea final.
 * @param indentIndex Índice del primer carácter que no es espacio ni tab.
 * @param indent Columna de ese carácter (con los tabs expandidos).
 * @param itemColumn Columna del contenido del ítem de lista más interno abierto (0 si no hay).
 * @return `true` si la línea abre uno de esos bloques.
 */
function startsBlock(line: string, indentIndex: number, indent: number, itemColumn: number): boolean {
	if (indent - itemColumn > 3) {
		// Paragraph continuation: no block can start here.
		return false;
	}
	const content = line.slice(indentIndex);
	if (FENCE.test(content) || ATX_HEADING.test(content) || THEMATIC_BREAK.test(content)) {
		return true;
	}
	const marker = listMarker(line, indentIndex, indent);
	// A sibling or outer item always does; a nested one only if it can interrupt a paragraph.
	return marker !== undefined && !marker.empty && (indent < itemColumn || INTERRUPTING_MARKER.test(content));
}

/**
 * @brief Reconoce el marcador de un ítem de lista (`-`, `+`, `*`, `1.` o `1)`) en una posición de una línea.
 *
 * @param line Línea donde buscar.
 * @param index Índice donde tiene que empezar el marcador.
 * @param column Columna de ese índice (con los tabs expandidos).
 * @return El marcador, o `undefined` si no hay uno (tiene que ir seguido de un espacio, un tab o el fin de línea).
 */
function listMarker(line: string, index: number, column: number): ListMarker | undefined {
	let end = index;
	const ch = line[index];
	if (ch === '-' || ch === '+' || ch === '*') {
		end++;
	} else {
		while (end - index < 9 && line[end] >= '0' && line[end] <= '9') {
			end++;
		}
		if (end === index || (line[end] !== '.' && line[end] !== ')')) {
			return undefined;
		}
		end++;
	}
	const markerColumn = column + end - index;
	if (end === line.length || line.slice(end).trim() === '') {
		return { contentColumn: markerColumn + 1, contentIndex: line.length, code: false, empty: true };
	}
	if (line[end] !== ' ' && line[end] !== '\t') {
		return undefined;
	}
	let contentIndex = end;
	let contentColumn = markerColumn;
	while (line[contentIndex] === ' ' || line[contentIndex] === '\t') {
		contentColumn = line[contentIndex] === '\t' ? contentColumn + 4 - contentColumn % 4 : contentColumn + 1;
		contentIndex++;
	}
	const code = contentColumn - markerColumn > 4;
	return { contentColumn: code ? markerColumn + 1 : contentColumn, contentIndex, code, empty: false };
}

/**
 * @brief Escanea una línea y agrega a `spans` las fórmulas que se cierran en ella.
 *
 * Actualiza `state` con lo que queda abierto al final de la línea (bloque `$$`, región HTML, corchetes).
 *
 * @param text Contenido completo del documento, del que se extrae el TeX de los bloques multilínea.
 * @param line Línea sin el salto de línea final.
 * @param lineStart Offset del inicio de la línea en el documento.
 * @param from Índice desde el que se escanea la línea.
 * @param blockStart Índice donde un comentario o una etiqueta de tipo 1 abriría un bloque HTML, o -1.
 * @param state Estado arrastrado desde la línea anterior.
 * @param spans Lista a la que se agregan las fórmulas halladas.
 */
function scanLine(
	text: string, line: string, lineStart: number, from: number, blockStart: number, state: ScanState,
	spans: MathSpan[],
): void {
	let i = from;
	while (i < line.length) {
		const ch = line[i];
		if (ch === '\\') {
			i += 2;
			continue;
		}
		if (state.display !== undefined) {
			if (line.startsWith('$$', i)) {
				const tex = text.slice(state.display + 2, lineStart + i).replace(/\r/g, '');
				if (tex.trim() !== '') {
					spans.push({ start: state.display, end: lineStart + i + 2, tex, display: true });
				}
				state.display = undefined;
				i += 2;
			} else {
				i++;
			}
			continue;
		}
		if (ch === '`') {
			let ticks = 1;
			while (line[i + ticks] === '`') {
				ticks++;
			}
			const delim = '`'.repeat(ticks);
			const close = findCodeSpanClose(line, i + ticks, delim);
			i = close === -1 ? i + ticks : close + ticks;
			continue;
		}
		if (ch === '<') {
			i = skipHtml(line, i, i === blockStart, state);
			continue;
		}
		if (ch === '[') {
			state.brackets++;
			i++;
			continue;
		}
		if (ch === ']') {
			i++;
			if (state.brackets > 0) {
				state.brackets--;
				if (line[i] === '(') {
					const end = linkTailEnd(line, i);
					if (end !== -1) {
						i = end;
					}
				}
			}
			continue;
		}
		if (ch !== '$') {
			i++;
			continue;
		}
		if (line[i + 1] === '$') {
			state.display = lineStart + i;
			i += 2;
			continue;
		}
		const close = findMathClose(line, i + 1);
		if (close === -1) {
			i++;
			continue;
		}
		spans.push({ start: lineStart + i, end: lineStart + close + 1, tex: line.slice(i + 1, close) });
		i = close + 1;
	}
}

/**
 * @brief Salta el HTML que empieza en un `<`: comentarios, etiquetas de `HTML_RAW_OPEN` con su contenido y autolinks.
 *
 * Sigue la idea de los bloques HTML de CommonMark (tipos 1 y 2) sin implementarlos enteros: si el comentario
 * o la etiqueta de tipo 1 está al comienzo del contenido de la línea, abre un bloque, que continúa después
 * de las líneas en blanco y se traga el resto de la línea donde se cierra. Si no (o si es `<code>`), es HTML
 * en línea y termina con el párrafo. Si no se cierra en la línea, queda abierto en `state.html`.
 *
 * @param line Línea donde buscar.
 * @param i Índice del `<`.
 * @param atBlockStart `true` si el `<` está donde puede empezar un bloque HTML.
 * @param state Estado del escaneo, donde se deja la región abierta.
 * @return Índice desde el que seguir escaneando: justo después del cierre (o del autolink), el largo de la
 * línea si queda abierto o si es un bloque HTML que se cierra en ella, e `i + 1` si no es HTML a saltar.
 */
function skipHtml(line: string, i: number, atBlockStart: boolean, state: ScanState): number {
	let close: string | RegExp;
	let block = atBlockStart;
	if (line.startsWith('<!--', i)) {
		close = HTML_COMMENT_CLOSE;
	} else {
		HTML_RAW_OPEN.lastIndex = i;
		const open = HTML_RAW_OPEN.exec(line);
		if (open === null) {
			AUTOLINK.lastIndex = i;
			return AUTOLINK.test(line) ? AUTOLINK.lastIndex : i + 1;
		}
		const tag = open[1].toLowerCase();
		close = HTML_RAW_CLOSE[tag];
		block = block && HTML_BLOCK_TAGS.has(tag);
	}
	// From i + 2, so that `<!-->` and `<!--->` close themselves, as in CommonMark.
	const end = findHtmlClose(line, i + 2, close);
	if (end === -1) {
		state.html = { close, block };
		return line.length;
	}
	if (block) {
		state.htmlBlockClosed = true;
		return line.length;
	}
	return end;
}

/**
 * @brief Busca el cierre de una región HTML en una línea.
 *
 * @param line Línea donde buscar.
 * @param from Índice desde el cual buscar.
 * @param close Delimitador de cierre (`-->`) o expresión global de la etiqueta de cierre.
 * @return Índice justo después del cierre, o -1 si no está en la línea.
 */
function findHtmlClose(line: string, from: number, close: string | RegExp): number {
	if (typeof close === 'string') {
		const idx = line.indexOf(close, from);
		return idx === -1 ? -1 : idx + close.length;
	}
	close.lastIndex = from;
	return close.test(line) ? close.lastIndex : -1;
}

/**
 * @brief Reconoce la parte `(destino "título")` de un link o imagen en línea, que sigue al `]` del texto.
 *
 * El destino va entre `<...>` o es una secuencia sin espacios con los paréntesis balanceados; el título,
 * opcional, va entre comillas dobles, simples o paréntesis. Todo tiene que estar en la misma línea.
 *
 * @param line Línea donde buscar.
 * @param open Índice del `(`.
 * @return Índice justo después del `)` de cierre, o -1 si no es un link válido.
 */
function linkTailEnd(line: string, open: number): number {
	let k = skipSpaces(line, open + 1);
	if (line[k] === '<') {
		for (k++; k < line.length && line[k] !== '>'; k++) {
			if (line[k] === '<') {
				return -1;
			}
			if (line[k] === '\\') {
				k++;
			}
		}
		if (k >= line.length) {
			return -1;
		}
		k++;
	} else {
		for (let depth = 0; k < line.length; k++) {
			const ch = line[k];
			if (ch === '\\') {
				k++;
			} else if (ch === ' ' || ch === '\t' || (ch === ')' && depth === 0)) {
				break;
			} else if (ch === '(') {
				if (++depth > MAX_LINK_PARENS) {
					return -1;
				}
			} else if (ch === ')') {
				depth--;
			}
		}
	}
	const afterDestination = k;
	k = skipSpaces(line, k);
	const quote = line[k];
	if (k > afterDestination && (quote === '"' || quote === '\'' || quote === '(')) {
		const closer = quote === '(' ? ')' : quote;
		for (k++; k < line.length && line[k] !== closer; k++) {
			if (quote === '(' && line[k] === '(') {
				// An unescaped `(` cannot appear in a parenthesized title; stopping here keeps the scan linear.
				return -1;
			}
			if (line[k] === '\\') {
				k++;
			}
		}
		if (k >= line.length) {
			return -1;
		}
		k = skipSpaces(line, k + 1);
	}
	return line[k] === ')' ? k + 1 : -1;
}

/**
 * @brief Avanza sobre espacios y tabs.
 *
 * @param line Línea.
 * @param from Índice inicial.
 * @return Índice del primer carácter que no es espacio ni tab (o el largo de la línea).
 */
function skipSpaces(line: string, from: number): number {
	while (line[from] === ' ' || line[from] === '\t') {
		from++;
	}
	return from;
}

/**
 * @brief Busca el delimitador que cierra un code span de Markdown.
 *
 * @param line Línea donde buscar.
 * @param from Índice desde el cual buscar (justo después de la apertura).
 * @param delim Delimitador de apertura (una cadena de backticks).
 * @return Índice del delimitador de cierre, o -1 si no se cierra en la línea.
 */
function findCodeSpanClose(line: string, from: number, delim: string): number {
	let idx = line.indexOf(delim, from);
	while (idx !== -1) {
		if (line[idx + delim.length] !== '`') {
			return idx;
		}
		let j = idx;
		while (line[j] === '`') {
			j++;
		}
		idx = line.indexOf(delim, j);
	}
	return -1;
}

/**
 * @brief Busca el `$` que cierra una fórmula inline.
 *
 * Aplica las reglas de Pandoc y se rinde ante un backtick o un `$$`.
 *
 * @param line Línea donde buscar.
 * @param from Índice del primer carácter después del `$` de apertura.
 * @return Índice del `$` de cierre, o -1 si no hay uno válido.
 */
function findMathClose(line: string, from: number): number {
	if (from >= line.length || /\s/.test(line[from])) {
		return -1;
	}
	for (let j = from; j < line.length; j++) {
		const ch = line[j];
		if (ch === '\\') {
			j++;
			continue;
		}
		if (ch === '`') {
			// Code spans take precedence: math cannot close inside one.
			return -1;
		}
		if (ch !== '$') {
			continue;
		}
		if (line[j + 1] === '$') {
			// `$$` inside inline math: not a valid closer here.
			return -1;
		}
		if (/\s/.test(line[j - 1]) || /[0-9]/.test(line[j + 1] ?? '')) {
			continue;
		}
		return j;
	}
	return -1;
}
