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

/** @brief Detecta la línea de apertura o cierre de un bloque de código cercado (``` o ~~~); el grupo 1 es el cerco. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** @brief Detecta una línea con sangría de código (4 espacios o un tab). */
const INDENTED_CODE = /^(?: {4}|\t)/;

/**
 * @brief Busca las fórmulas inline (`$...$`) y de bloque (`$$...$$`) de un documento Markdown.
 *
 * Sigue las reglas de Pandoc: el `$` de apertura no puede ir seguido de un espacio,
 * y el de cierre no puede ir precedido de un espacio ni seguido de un dígito.
 * Se ignoran el código (cercado, con sangría y en línea) y los `\$` escapados.
 * Una fórmula inline no cruza líneas; una de bloque puede ocupar varias, pero no
 * cruzar una línea en blanco, y si no se cierra (o queda vacía) se descarta.
 *
 * @param text Contenido completo del documento.
 * @return Fórmulas halladas, en orden de aparición, con offsets sobre `text`.
 */
export function findMath(text: string): MathSpan[] {
	const spans: MathSpan[] = [];
	const lines = text.split('\n');
	let offset = 0;
	let fence: string | undefined;
	let displayStart: number | undefined;
	let prevBlank = true;

	for (const rawLine of lines) {
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		const lineStart = offset;
		offset += rawLine.length + 1;
		const inDisplay = displayStart !== undefined;

		const fenceMatch = FENCE.exec(line);
		if (fence !== undefined) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length
				&& line.slice(fenceMatch[0].length).trim() === '') {
				fence = undefined;
			}
			continue;
		}
		if (fenceMatch && !inDisplay) {
			fence = fenceMatch[1];
			continue;
		}
		const blank = line.trim() === '';
		if (!inDisplay && prevBlank && !blank && INDENTED_CODE.test(line)) {
			// Indented code block: keep treating following indented lines as code.
			continue;
		}
		prevBlank = blank;
		if (blank) {
			// Display math cannot span a blank line: an unclosed block is dropped.
			displayStart = undefined;
			continue;
		}

		displayStart = scanLine(text, line, lineStart, displayStart, spans);
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
 * @brief Indica si una fórmula es un bloque `$$...$$` que ocupa más de una línea.
 *
 * @param span Fórmula a examinar.
 * @return `true` si es display math y su TeX contiene un salto de línea.
 */
export function isDisplayBlock(span: MathSpan): boolean {
	return span.display === true && span.tex.includes('\n');
}

/**
 * @brief Escanea una línea y agrega a `spans` las fórmulas que se cierran en ella.
 *
 * @param text Contenido completo del documento, del que se extrae el TeX de los bloques multilínea.
 * @param line Línea sin el salto de línea final.
 * @param lineStart Offset del inicio de la línea en el documento.
 * @param displayStart Offset del `$$` de apertura si la línea empieza dentro de un bloque, o `undefined`.
 * @param spans Lista a la que se agregan las fórmulas halladas.
 * @return Offset del `$$` de apertura si al terminar la línea sigue abierto un bloque, o `undefined`.
 */
function scanLine(
	text: string, line: string, lineStart: number, displayStart: number | undefined, spans: MathSpan[],
): number | undefined {
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === '\\') {
			i += 2;
			continue;
		}
		if (displayStart !== undefined) {
			if (line.startsWith('$$', i)) {
				const tex = text.slice(displayStart + 2, lineStart + i).replace(/\r/g, '');
				if (tex.trim() !== '') {
					spans.push({ start: displayStart, end: lineStart + i + 2, tex, display: true });
				}
				displayStart = undefined;
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
		if (ch !== '$') {
			i++;
			continue;
		}
		if (line[i + 1] === '$') {
			displayStart = lineStart + i;
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
	return displayStart;
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
