/** @brief Entornos tabulares cuyas filas se pueden mostrar cada una en su línea de código. */
const ROW_ENVIRONMENTS = new Set([
	'aligned', 'alignedat', 'gathered', 'split', 'cases', 'dcases', 'rcases', 'array', 'subarray',
	'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix',
	'align*', 'alignat*', 'gather*', 'flalign*',
]);

/** @brief Detecta el `\begin{...}` con el que empieza el bloque; el grupo 1 es el nombre del entorno. */
const BEGIN = /^\s*\\begin\{([A-Za-z]+\*?)\}/;

/**
 * @brief Calcula dónde empieza cada fila de un bloque `$$` que es una única tabla.
 *
 * El bloque se puede mostrar fila por fila si su contenido es solo un entorno de
 * `ROW_ENVIRONMENTS` (con sus argumentos, como en `\begin{array}{cc}`), sin texto antes ni
 * después, y cada fila empieza en una línea distinta. Las filas se separan con `\\` fuera de
 * llaves y de entornos anidados; se ignoran los comentarios `%` y el argumento opcional de `\\`
 * (`\\[2pt]`). Una fila vacía al final (por un `\\` final) se descarta, como hace MathJax.
 *
 * Con `tolerant`, pensado para TeX a medio escribir, un salto de línea cierra las llaves que
 * quedaron abiertas y un `\\` al final de una línea siempre termina la fila, de modo que una
 * llave sin cerrar no une las filas siguientes.
 *
 * @param tex TeX del bloque, entre los `$$`.
 * @param tolerant Si se toleran llaves desbalanceadas.
 * @return Offset dentro de `tex` del primer carácter de cada fila, o `undefined` si el bloque
 * no es una sola tabla, tiene filas vacías en el medio o dos filas empiezan en la misma línea.
 */
export function layoutRows(tex: string, tolerant = false): number[] | undefined {
	const begin = BEGIN.exec(tex);
	if (!begin || !ROW_ENVIRONMENTS.has(begin[1])) {
		return undefined;
	}
	const env = begin[1];
	let i = skipArguments(tex, begin[0].length);
	const rows: number[] = [];
	let rowStart = i;
	let depth = 0;
	let nested = 0;

	while (i < tex.length) {
		const ch = tex[i];
		if (ch === '%') {
			const newline = tex.indexOf('\n', i);
			i = newline === -1 ? tex.length : newline;
			continue;
		}
		if (ch === '{') {
			depth++;
			i++;
			continue;
		}
		if (ch === '}') {
			depth = tolerant ? Math.max(0, depth - 1) : depth - 1;
			i++;
			continue;
		}
		if (ch === '\n' && tolerant) {
			depth = 0;
		}
		if (ch !== '\\') {
			i++;
			continue;
		}
		if (tex[i + 1] === '\\') {
			if ((depth === 0 || (tolerant && endsLine(tex, i + 2))) && nested === 0) {
				rows.push(firstNonSpace(tex, rowStart, i));
				rowStart = skipArguments(tex, i + 2, '[');
				i = rowStart;
			} else {
				i += 2;
			}
			continue;
		}
		const command = /^\\(begin|end)\{([A-Za-z]+\*?)\}/.exec(tex.slice(i, i + 40));
		if (command?.[1] === 'begin') {
			nested++;
		} else if (command?.[1] === 'end') {
			if (nested === 0) {
				if (command[2] !== env || (depth !== 0 && !tolerant) || tex.slice(i + command[0].length).trim() !== '') {
					return undefined;
				}
				const last = firstNonSpace(tex, rowStart, i);
				if (last !== -1 || rows.length === 0) {
					rows.push(last);
				}
				return validRows(tex, rows);
			}
			nested--;
		}
		// Skip the command name (letters) or the single escaped character.
		const name = /^\\(?:[A-Za-z]+|.)/.exec(tex.slice(i, i + 40));
		i += name ? name[0].length : 1;
	}
	return undefined;
}

/**
 * @brief Ubicación de las filas de un bloque `$$` en sus líneas, para calcular `blockScale`.
 */
export interface RowLayout {
	/** Línea de cada fila, relativa a la primera línea del bloque. */
	rowLines: number[];
	/** Cantidad de líneas del bloque. */
	lines: number;
	/** Distancia en px de la línea base del texto al centro de la línea del editor. */
	axis: number;
}

/**
 * @brief Calcula la escala única con la que se dibujan todas las filas de un bloque.
 *
 * Cada fila se alinea por su línea base con la del texto y puede desbordar sobre el espacio
 * libre de las líneas vecinas (VS Code no agranda la línea, la imagen se superpone). La escala
 * es la mayor que cumple que las cajas de dos filas consecutivas no se superpongan (las cajas de
 * MathJax ya dejan un margen alrededor de la tinta) y que la primera y la última fila no salgan
 * del bloque. El centro de cada línea queda `layout.axis` px sobre la línea base, sin importar la escala.
 *
 * @param rows Alto (`height`) y profundidad (`depth`) de cada fila a escala 1, en px, respecto de su línea base.
 * @param layout Líneas de las filas, cantidad de líneas del bloque y posición del centro de la línea.
 * @param lineHeight Alto de una línea en px.
 * @return Escala entre 0 y 1 (1 si todas las filas entran a tamaño completo).
 */
export function blockScale(rows: { height: number; depth: number }[], { rowLines, lines, axis }: RowLayout, lineHeight: number): number {
	let scale = 1;
	const limit = (extent: number, space: number) => {
		if (extent > 0) {
			scale = Math.min(scale, Math.max(0, space) / extent);
		}
	};
	rows.forEach((row, i) => {
		if (i === 0) {
			limit(row.height, (rowLines[0] + 0.5) * lineHeight + axis);
		}
		if (i === rows.length - 1) {
			limit(row.depth, (lines - 1 - rowLines[i] + 0.5) * lineHeight - axis);
		} else {
			// The axis offsets of both rows cancel out.
			limit(row.depth + rows[i + 1].height, (rowLines[i + 1] - rowLines[i]) * lineHeight);
		}
	});
	return scale;
}

/**
 * @brief Verifica que las filas no estén vacías y que cada una empiece en una línea distinta.
 *
 * @param tex TeX del bloque.
 * @param rows Offset del primer carácter de cada fila (-1 si la fila está vacía).
 * @return `rows` si es válido, o `undefined`.
 */
function validRows(tex: string, rows: number[]): number[] | undefined {
	let previousLine = -1;
	for (const offset of rows) {
		if (offset === -1) {
			return undefined;
		}
		const line = lineOf(tex, offset);
		if (line <= previousLine) {
			return undefined;
		}
		previousLine = line;
	}
	return rows;
}

/**
 * @brief Indica si desde una posición solo quedan espacios (o un comentario `%`) hasta el fin de la línea.
 *
 * @param tex Texto a recorrer.
 * @param from Posición inicial.
 * @return `true` si no hay más contenido en la línea.
 */
function endsLine(tex: string, from: number): boolean {
	const newline = tex.indexOf('\n', from);
	const rest = tex.slice(from, newline === -1 ? undefined : newline);
	return /^\s*(%.*)?$/.test(rest);
}

/**
 * @brief Saltea los argumentos (`{...}` o `[...]`) que siguen inmediatamente a una posición.
 *
 * @param tex Texto a recorrer.
 * @param from Posición donde pueden empezar los argumentos.
 * @param openers Delimitadores de apertura aceptados.
 * @return Posición después del último argumento.
 */
function skipArguments(tex: string, from: number, openers = '{['): number {
	let i = from;
	while (i < tex.length && openers.includes(tex[i])) {
		const open = tex[i];
		const close = open === '{' ? '}' : ']';
		let depth = 0;
		while (i < tex.length) {
			const ch = tex[i];
			if (ch === '\\') {
				i += 2;
				continue;
			}
			i++;
			if (ch === open) {
				depth++;
			} else if (ch === close && --depth === 0) {
				break;
			}
		}
	}
	return i;
}

/**
 * @brief Busca el primer carácter que no es espacio ni parte de un comentario `%` en un rango.
 *
 * @param tex Texto a recorrer.
 * @param from Inicio del rango.
 * @param to Fin del rango (excluido).
 * @return Offset del primer carácter de contenido, o -1 si el rango está vacío.
 */
function firstNonSpace(tex: string, from: number, to: number): number {
	for (let i = from; i < to; i++) {
		if (tex[i] === '%') {
			const newline = tex.indexOf('\n', i);
			if (newline === -1) {
				return -1;
			}
			i = newline;
		} else if (!/\s/.test(tex[i])) {
			return i;
		}
	}
	return -1;
}

/**
 * @brief Cuenta en qué línea de `tex` está un offset.
 *
 * @param tex Texto.
 * @param offset Posición dentro de `tex`.
 * @return Número de línea, empezando en 0.
 */
function lineOf(tex: string, offset: number): number {
	let line = 0;
	for (let i = 0; i < offset; i++) {
		if (tex[i] === '\n') {
			line++;
		}
	}
	return line;
}
