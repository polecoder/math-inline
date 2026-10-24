import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { SVGmtable } from 'mathjax-full/js/output/svg/Wrappers/mtable.js';
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js';

/**
 * @brief Opciones de render de una fórmula.
 */
export interface RenderOptions {
	/** Color del texto, cualquier color CSS. */
	color: string;
	/** Tamaño de una unidad `ex` en píxeles. */
	exPx: number;
	/** Si es `true`, renderiza `\dfrac`, `\dbinom` y las celdas de las tablas en estilo texto. */
	textStyle?: boolean;
	/** Alto máximo en píxeles; las fórmulas más altas se achican proporcionalmente. */
	maxHeight?: number;
	/** Si es `true`, renderiza en modo display (fracciones grandes, límites debajo). */
	display?: boolean;
}

/**
 * @brief Fórmula renderizada como imagen SVG.
 */
export interface RenderedMath {
	/** URI `data:` del SVG autocontenido. */
	uri: string;
	/** Ancho de la imagen en píxeles. */
	width: number;
	/** Alto de la imagen en píxeles. */
	height: number;
	/** Desplazamiento de la línea base en px (negativo = por debajo de la línea base del texto). */
	verticalAlign: number;
	/** Factor de achique aplicado para respetar `maxHeight` (1 si no se achicó). */
	fit: number;
}

/**
 * @brief Fallo al renderizar una fórmula.
 */
export interface RenderError {
	/** Mensaje de error de MathJax. */
	error: string;
}

/** @brief Resultado de renderizar: la imagen o el error. */
export type RenderResult = RenderedMath | RenderError;

/**
 * @brief Fila de una tabla renderizada como imagen propia.
 */
export interface RenderedRow extends RenderedMath {
	/** Margen izquierdo en px que mantiene alineada la primera columna cuando la fila se achica más que las otras. */
	offset: number;
}

/**
 * @brief Fórmula cortada en franjas horizontales del alto de una línea.
 */
export interface RenderedBands {
	/** Franjas, de arriba hacia abajo. */
	bands: RenderedMath[];
	/** Índice de la línea (entre las disponibles) donde va la primera franja, para centrar la fórmula. */
	first: number;
	/** Factor de achique aplicado para que la fórmula entre en las líneas disponibles (1 si no se achicó). */
	fit: number;
}

/**
 * @brief Indica si un resultado de render es un error.
 *
 * @param result Resultado a examinar.
 * @return `true` si `result` es un `RenderError`.
 */
export function isError<T extends object>(result: T | RenderError): result is RenderError {
	return 'error' in result;
}

/** @brief Paquetes de MathJax excluidos porque ocultarían errores o cargarían código en tiempo de ejecución. */
const EXCLUDED_PACKAGES = ['noerrors', 'noundefined', 'autoload', 'require'];
/** @brief Cantidad máxima de resultados de render en caché. */
const CACHE_LIMIT = 500;
/** @brief Margen vertical, en em, que se agrega arriba y abajo de cada fila recortada para no cortar la tinta. */
const ROW_PADDING_EM = 0.05;

/** @brief Documento de MathJax usado para convertir TeX a SVG. */
type MathDocument = ReturnType<typeof mathjax.document>;

/**
 * @brief Fila de una tabla de MathJax, medida en em con el eje y hacia arriba.
 */
interface TableRow {
	/** Borde superior de la tinta de la fila (línea base + alto). */
	top: number;
	/** Alto sobre la línea base. */
	height: number;
	/** Profundidad bajo la línea base. */
	depth: number;
	/** Marcado SVG del grupo de la fila. */
	markup: string;
	/** Nodo SVG de la fila, mientras dura la conversión. */
	element: unknown;
}

/**
 * @brief Geometría de una tabla (`mtable`) registrada durante una conversión.
 */
interface TableRecord {
	/** Filas, de arriba hacia abajo. */
	rows: TableRow[];
	/** Alto de la tabla sobre su línea base, en em. */
	height: number;
	/** Profundidad de la tabla bajo su línea base, en em. */
	depth: number;
	/** Posición x, en em, del límite entre la primera y la segunda columna (0 si hay una sola). */
	anchor: number;
}

/**
 * @brief Parte de la API interna de `SVGmtable` que se usa para medir las filas.
 */
interface MtableWrapper {
	numRows: number;
	fLine: number;
	rLines: number[];
	cLines: number[];
	childNodes: { H: number; D: number; element: unknown }[];
	getBBox(): { h: number; d: number };
	getRowHalfSpacing(): number[];
	getColumnHalfSpacing(): number[];
	getComputedWidths(): number[];
}

/**
 * @brief Nodo MathML recorrido por el post-filtro de tablas compactas.
 */
interface MmlNodeLike {
	isKind(kind: string): boolean;
	attributes: { set(name: string, value: unknown): void };
	walkTree(fn: (node: MmlNodeLike) => void): void;
}

/** @brief Resultado de convertir TeX: el SVG serializado y las tablas que contiene, en orden (la externa primero). */
interface Converted {
	svg: string;
	tables: TableRecord[];
}

/** @brief Adaptador DOM liviano de MathJax, creado junto con el documento. */
let adaptor: ReturnType<typeof liteAdaptor> | undefined;
/** @brief Documento de MathJax compartido, creado en el primer render. */
let doc: MathDocument | undefined;
/** @brief Caché de resultados de render (`math`, `rows` y `bands`), indexada por `cacheKey`; limitada a `CACHE_LIMIT` entradas. */
const cache = new Map<string, unknown>();
/** Tablas registradas por el `placeRows` parcheado durante la conversión en curso. */
let tableRecords: TableRecord[] = [];
/** Si la conversión en curso debe renderizar las tablas en estilo texto. */
let compactTables = false;

/**
 * @brief Devuelve el documento de MathJax, creándolo en el primer uso.
 *
 * Configura TeX con todos los paquetes salvo `EXCLUDED_PACKAGES`, hace que los
 * errores de TeX se lancen como excepción y usa salida SVG con `fontCache: 'local'`:
 * cada imagen define una sola vez cada glifo y lo reutiliza con `<use>`, lo que
 * la mantiene autónoma y liviana. Agrega un post-filtro de TeX con prioridad -10 (antes del
 * `setInherited` de MathJax, de prioridad -5) que, si `compactTables` está activo, fuerza
 * `displaystyle=false` en las tablas para que sus celdas hereden el estilo texto. Además llama a
 * `recordTableRows` para parchear el registro de geometría de tablas.
 *
 * @return Documento de MathJax compartido por todos los renders.
 */
function getDocument(): MathDocument {
	if (!doc) {
		adaptor = liteAdaptor();
		RegisterHTMLHandler(adaptor);
		const tex = new TeX({
			packages: AllPackages.filter(p => !EXCLUDED_PACKAGES.includes(p)),
			formatError: (_jax: unknown, err: Error) => {
				throw err;
			},
		});
		// Runs before MathJax's own setInherited filter (priority -5), so the cells inherit text style.
		tex.postFilters.add(({ data }: { data: { root: MmlNodeLike } }) => {
			if (compactTables) {
				data.root.walkTree(node => {
					if (node.isKind('mtable')) {
						node.attributes.set('displaystyle', false);
					}
				});
			}
		}, -10);
		// Each image is standalone, so a local cache defines every glyph once and reuses it with <use>.
		const svg = new SVG({ fontCache: 'local' });
		doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
		recordTableRows();
	}
	return doc;
}

/**
 * @brief Parchea `SVGmtable.placeRows` para registrar la geometría de cada tabla en `tableRecords`.
 *
 * MathJax no deja el alto ni la profundidad de las filas en el SVG; se calculan con las mismas
 * cuentas que usa `placeRows` para ubicarlas. La tabla se registra antes de ubicar sus filas,
 * así que la externa queda primera aunque contenga otras.
 */
function recordTableRows(): void {
	const proto = SVGmtable.prototype as unknown as { placeRows(this: MtableWrapper, svg: unknown): void };
	const placeRows = proto.placeRows;
	proto.placeRows = function (svg) {
		const record: TableRecord = { rows: [], height: 0, depth: 0, anchor: 0 };
		tableRecords.push(record);
		placeRows.call(this, svg);
		const rSpace = this.getRowHalfSpacing();
		const rLines = [this.fLine, ...this.rLines, this.fLine];
		let y = this.getBBox().h - rLines[0];
		for (let i = 0; i < this.numRows; i++) {
			const row = this.childNodes[i];
			record.rows.push({ top: y - rSpace[i], height: row.H, depth: row.D, markup: '', element: row.element });
			y -= rSpace[i] + row.H + row.D + rSpace[i + 1] + rLines[i + 1];
		}
		const bbox = this.getBBox();
		record.height = bbox.h;
		record.depth = bbox.d;
		const widths = this.getComputedWidths();
		const cSpace = this.getColumnHalfSpacing();
		record.anchor = widths.length > 1 ? this.fLine + cSpace[0] + widths[0] + cSpace[1] + (this.cLines[0] ?? 0) : 0;
	};
}

/**
 * @brief Convierte TeX a SVG con MathJax y devuelve también las tablas que contiene.
 *
 * Si `textStyle` está activo, reemplaza `\dfrac` y `\dbinom` por `\frac` y `\binom` y
 * renderiza las tablas en estilo texto (ver `compactTables`).
 *
 * @param tex Código TeX de la fórmula.
 * @param display Si se convierte en modo display.
 * @param textStyle Si se usa estilo texto para fracciones y tablas.
 * @return SVG serializado y tablas registradas, o el error de MathJax.
 */
function convert(tex: string, display: boolean, textStyle: boolean): Converted | RenderError {
	if (textStyle) {
		tex = tex.replace(/\\d(frac|binom)(?![a-zA-Z])/g, '\\$1');
	}
	tableRecords = [];
	compactTables = textStyle;
	try {
		const node = getDocument().convert(tex, { display });
		const tables = tableRecords;
		for (const row of tables.flatMap(t => t.rows)) {
			row.markup = adaptor!.outerHTML(row.element as LiteElement);
			row.element = undefined;
		}
		return { svg: adaptor!.innerHTML(node), tables };
	} catch (err) {
		// MathJax's TexError is not an Error subclass, but carries a message.
		const message = (err as { message?: unknown } | undefined)?.message;
		return { error: typeof message === 'string' ? message : String(err) };
	} finally {
		tableRecords = [];
		compactTables = false;
	}
}

/**
 * @brief Busca un resultado en la caché o lo calcula y lo guarda.
 *
 * Descarta la entrada más antigua al llegar a `CACHE_LIMIT`.
 *
 * @param key Clave del resultado.
 * @param compute Función que calcula el resultado si no está en caché.
 * @return Resultado cacheado o recién calculado.
 */
function cached<T>(key: string, compute: () => T): T {
	if (cache.has(key)) {
		return cache.get(key) as T;
	}
	const result = compute();
	if (cache.size >= CACHE_LIMIT) {
		// Map preserves insertion order: drop the oldest entry.
		cache.delete(cache.keys().next().value!);
	}
	cache.set(key, result);
	return result;
}

/**
 * @brief Renderiza TeX inline a una imagen SVG, con caché.
 *
 * La caché se indexa por color, `exPx`, `textStyle`, `maxHeight`, `display` y TeX, y
 * descarta la entrada más antigua al llegar a `CACHE_LIMIT`. Los errores también se cachean.
 *
 * @param tex Código TeX de la fórmula, sin delimitadores.
 * @param options Color, escala, estilo de texto, alto máximo y modo display del render.
 * @return Imagen renderizada, o el error de MathJax si el TeX no es válido.
 */
export function render(tex: string, options: RenderOptions): RenderResult {
	return cached(cacheKey('math', tex, options), () => renderUncached(tex, options));
}

/**
 * @brief Renderiza una tabla (`aligned`, `cases`, matrices...) como una imagen por fila, con caché.
 *
 * Convierte la fórmula entera en modo display una sola vez y recorta cada fila, de modo que
 * las columnas quedan alineadas como en la tabla completa. Cada imagen lleva solo el grupo
 * de su fila y los glifos que usa. Cada fila se achica por separado para no superar
 * `maxHeight`, y `offset` compensa el achique para que el límite entre la primera y la
 * segunda columna quede en el mismo lugar en todas las filas.
 *
 * @param tex Código TeX de la fórmula, que debe ser una única tabla.
 * @param options Color, escala, alto máximo de cada fila y `textStyle` (tablas compactas).
 * @return Una imagen por fila, el error de MathJax, o `undefined` si la fórmula no es una sola tabla.
 */
export function renderRows(tex: string, options: RenderOptions): RenderedRow[] | RenderError | undefined {
	return cached(cacheKey('rows', tex, options), () => renderRowsUncached(tex, options));
}

/**
 * @brief Renderiza una fórmula en modo display cortada en franjas horizontales del alto de una línea, con caché.
 *
 * Achica la fórmula solo si no entra en `lines` líneas de `maxHeight` px y usa la menor cantidad
 * de franjas necesaria, centradas verticalmente en las líneas disponibles.
 *
 * @param tex Código TeX de la fórmula.
 * @param options Color, escala y alto de línea (`maxHeight`, obligatorio).
 * @param lines Cantidad de líneas disponibles.
 * @return Franjas renderizadas, o el error de MathJax.
 */
export function renderBands(tex: string, options: RenderOptions, lines: number): RenderedBands | RenderError {
	return cached(`${cacheKey('bands', tex, options)}\u0000${lines}`, () => renderBandsUncached(tex, options, lines));
}

/**
 * @brief Arma la clave de caché de un render.
 *
 * @param kind Tipo de render (`math`, `rows` o `bands`).
 * @param tex Código TeX de la fórmula.
 * @param options Opciones de render.
 * @return Clave que identifica el render.
 */
function cacheKey(kind: string, tex: string, options: RenderOptions): string {
	return [
		kind, options.color, options.exPx, options.textStyle ?? false, options.maxHeight ?? '', options.display ?? false, tex,
	].join('\u0000');
}

/**
 * @brief Convierte TeX a SVG con MathJax, sin usar la caché.
 *
 * Convierte con `convert` (que aplica `textStyle` y `display`) y arma la imagen con
 * `toDataUri`. Si el alto supera `maxHeight`, escala proporcionalmente ancho, alto y
 * `verticalAlign`, y deja en `fit` el factor aplicado.
 *
 * @param tex Código TeX de la fórmula.
 * @param options Color, tamaño de `ex` en píxeles, `textStyle`, `maxHeight` y `display` (falso por defecto).
 * @return Imagen como URI `data:` con sus medidas y el factor `fit`, o el error de MathJax.
 */
function renderUncached(tex: string, { color, exPx, textStyle, maxHeight, display = false }: RenderOptions): RenderResult {
	const converted = convert(tex, display, textStyle ?? false);
	if (isError(converted)) {
		return converted;
	}
	const svg = converted.svg;

	let width = exToPx(attr(svg, 'width'), exPx);
	let height = exToPx(attr(svg, 'height'), exPx);
	let verticalAlign = exToPx(/vertical-align:\s*(-?[\d.]+)ex/.exec(svg)?.[1], exPx);
	let fit = 1;
	if (maxHeight !== undefined && height > maxHeight) {
		// The viewBox is untouched, so shrinking the box scales the drawing with it.
		fit = maxHeight / height;
		width = round2(width * fit);
		height = maxHeight;
		verticalAlign = round2(verticalAlign * fit);
	}

	return { uri: toDataUri(svg, width, height, color), width, height, verticalAlign, fit };
}

/**
 * @brief Recorta cada fila de la tabla que forma la fórmula, sin usar la caché.
 *
 * Cada recorte va desde la tinta de la fila (alto y profundidad, más `ROW_PADDING_EM`) y
 * abarca todo el ancho de la imagen, incluidos los delimitadores que rodean la tabla (como la
 * llave de `cases`, de la que cada fila muestra su tramo). La posición de las filas se corrige
 * con el desplazamiento del grupo de la tabla (`tableShift`). Devuelve `undefined` si la fórmula
 * no empieza con `\begin` y termina con `\end` (por ejemplo, `x = \begin{cases}...`), si no tiene
 * tablas o si las filas no quedan dentro de la imagen.
 *
 * @param tex Código TeX de la fórmula.
 * @param options Color, tamaño de `ex`, alto máximo de cada fila y `textStyle`.
 * @return Una imagen por fila, el error de MathJax, o `undefined` si no se puede recortar.
 */
function renderRowsUncached(tex: string, { color, exPx, textStyle, maxHeight }: RenderOptions): RenderedRow[] | RenderError | undefined {
	const converted = convert(tex, true, textStyle ?? false);
	if (isError(converted)) {
		return converted;
	}
	const { svg, tables: [table] } = converted;
	const box = viewBox(svg);
	if (!table || table.rows.length === 0 || !box || !/^\s*\\begin\{/.test(tex) || !/\\end\{[^}]*\}\s*$/.test(tex)) {
		return undefined;
	}
	// The table may be shifted by its delimiters (the brace of `cases`); its rows must still lie inside the image.
	const shift = tableShift(svg);
	const top = -(table.height * 1000 + shift.y);
	const bottom = top + (table.height + table.depth) * 1000;
	if (top < box.y - 1 || bottom > box.y + box.height + 1) {
		return undefined;
	}
	// Each row keeps the svg around the rows (defs, outer groups) plus its own group.
	const starts: number[] = [];
	let from = 0;
	for (const row of table.rows) {
		const start = svg.indexOf(row.markup, from);
		if (start === -1) {
			return undefined;
		}
		starts.push(start);
		from = start + row.markup.length;
	}
	const head = svg.slice(0, starts[0]);
	const tail = svg.slice(from);

	const pxPerUnit = exToPx(attr(svg, 'width'), exPx) / box.width;
	const heights = table.rows.map(row => (row.height + row.depth + 2 * ROW_PADDING_EM) * 1000);
	const fits = heights.map(h => (maxHeight === undefined ? 1 : Math.min(1, maxHeight / (h * pxPerUnit))));
	const widest = Math.max(...fits);
	return table.rows.map((row, i) => {
		const fit = fits[i];
		const width = round2(box.width * pxPerUnit * fit);
		const height = round2(heights[i] * pxPerUnit * fit);
		const crop = { x: box.x, y: -((row.top + ROW_PADDING_EM) * 1000 + shift.y), width: box.width, height: heights[i] };
		return {
			uri: toDataUri(pruneDefs(head + row.markup + tail), width, height, color, crop),
			width,
			height,
			verticalAlign: round2(-(row.depth + ROW_PADDING_EM) * 1000 * pxPerUnit * fit),
			fit,
			offset: round2((shift.x + table.anchor * 1000 - box.x) * pxPerUnit * (widest - fit)),
		};
	});
}

/**
 * @brief Corta la fórmula en franjas del alto de una línea, sin usar la caché.
 *
 * Convierte en modo display (sin estilo texto), la achica solo si no entra en `lines` líneas y
 * la centra verticalmente en las franjas que usa. Se asume que el SVG tiene `viewBox`.
 *
 * @param tex Código TeX de la fórmula.
 * @param options Color, tamaño de `ex` y alto de línea (`maxHeight`).
 * @param lines Cantidad de líneas disponibles.
 * @return Franjas renderizadas, o el error de MathJax.
 */
function renderBandsUncached(tex: string, { color, exPx, maxHeight }: RenderOptions, lines: number): RenderedBands | RenderError {
	const converted = convert(tex, true, false);
	if (isError(converted)) {
		return converted;
	}
	const { svg } = converted;
	const box = viewBox(svg)!;
	const lineHeight = maxHeight ?? 1;
	const pxPerUnit = exToPx(attr(svg, 'width'), exPx) / box.width;
	const naturalHeight = box.height * pxPerUnit;
	const fit = Math.min(1, (lines * lineHeight) / naturalHeight);
	const count = Math.max(1, Math.min(lines, Math.ceil((naturalHeight * fit) / lineHeight - 1e-6)));
	const bandUnits = lineHeight / (pxPerUnit * fit);
	// Center the formula in the bands it uses.
	const top = box.y - (count * bandUnits - box.height) / 2;
	const width = round2(box.width * pxPerUnit * fit);
	const bands = Array.from({ length: count }, (_, i) => ({
		uri: toDataUri(svg, width, lineHeight, color, { x: box.x, y: top + i * bandUnits, width: box.width, height: bandUnits }),
		width,
		height: lineHeight,
		verticalAlign: 0,
		fit,
	}));
	return { bands, first: Math.floor((lines - count) / 2), fit };
}

/** @brief Rectángulo de un `viewBox` SVG. */
interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * @brief Lee el `viewBox` de la raíz `<svg>`.
 *
 * @param svg Marcado SVG.
 * @return Rectángulo del `viewBox`, o `undefined` si no tiene.
 */
function viewBox(svg: string): Box | undefined {
	const values = /^<svg[^>]* viewBox="([^"]+)"/.exec(svg)?.[1].split(/\s+/).map(Number);
	return values && { x: values[0], y: values[1], width: values[2], height: values[3] };
}

/**
 * @brief Lee el desplazamiento del grupo de la primera tabla (la externa) del SVG.
 *
 * @param svg Marcado SVG de MathJax.
 * @return Desplazamiento `translate` en unidades de MathJax (0, 0 si no tiene).
 */
function tableShift(svg: string): { x: number; y: number } {
	const tag = /<g data-mml-node="mtable"([^>]*)>/.exec(svg)?.[1] ?? '';
	const translate = /transform="translate\((-?[\d.]+)(?:[ ,]\s*(-?[\d.]+))?\)/.exec(tag);
	return { x: Number(translate?.[1] ?? 0), y: Number(translate?.[2] ?? 0) };
}

/**
 * @brief Quita de `<defs>` los glifos que el SVG no referencia.
 *
 * @param svg Marcado SVG con la caché local de glifos de MathJax.
 * @return SVG solo con los glifos usados.
 */
function pruneDefs(svg: string): string {
	return svg.replace(/<path id="([^"]+)"[^>]*><\/path>/g, (path, id: string) => (svg.includes(`#${id}"`) ? path : ''));
}

/**
 * @brief Ajusta la raíz de un SVG de MathJax y lo codifica como URI `data:`.
 *
 * Fija ancho y alto en píxeles, quita el `style` de la raíz, reemplaza el `viewBox` si se
 * pide un recorte y reemplaza `currentColor` por el color pedido. Quita los atributos `data-*`
 * de MathJax y normaliza los ids `MJX-<n>-` a `MJX-`, de modo que la salida sea determinista y liviana.
 *
 * @param svg Marcado SVG.
 * @param width Ancho en píxeles.
 * @param height Alto en píxeles.
 * @param color Color CSS de la fórmula.
 * @param crop `viewBox` a mostrar, en unidades de MathJax; si falta se conserva el original.
 * @return URI `data:` con el SVG en base64.
 */
function toDataUri(svg: string, width: number, height: number, color: string, crop?: Box): string {
	svg = svg
		.replace(/^<svg[^>]*>/, root => {
			root = root
				.replace(/ width="[^"]*"/, ` width="${width}"`)
				.replace(/ height="[^"]*"/, ` height="${height}"`)
				.replace(/ style="[^"]*"/, '');
			return crop ? root.replace(/ viewBox="[^"]*"/, ` viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}"`) : root;
		})
		// MathJax's data-* attributes only matter to its own scripts and add a lot of weight.
		.replace(/ data-[\w-]+="[^"]*"/g, '')
		// Glyph ids carry a per-conversion counter; each image is standalone, so drop it to keep the output deterministic.
		.replace(/MJX-\d+-/g, 'MJX-')
		.replace(/currentColor/g, escapeXml(color));
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * @brief Extrae de la raíz `<svg>` un atributo expresado en `ex`.
 *
 * @param svg Marcado SVG.
 * @param name Nombre del atributo (por ejemplo `width`).
 * @return Valor numérico como texto (sin la unidad), o `undefined` si no está.
 */
function attr(svg: string, name: string): string | undefined {
	return new RegExp(`<svg[^>]* ${name}="(-?[\\d.]+)ex"`).exec(svg)?.[1];
}

/**
 * @brief Convierte una medida en `ex` a píxeles, redondeada a dos decimales.
 *
 * @param value Medida en `ex` como texto, o `undefined`.
 * @param exPx Tamaño de un `ex` en píxeles.
 * @return Medida en píxeles (0 si `value` es `undefined`).
 */
function exToPx(value: string | undefined, exPx: number): number {
	return value === undefined ? 0 : round2(parseFloat(value) * exPx);
}

/**
 * @brief Redondea un número a dos decimales.
 *
 * @param value Número a redondear.
 * @return `value` redondeado a dos decimales.
 */
function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * @brief Escapa los caracteres especiales de XML como entidades numéricas.
 *
 * @param value Texto a escapar.
 * @return Texto seguro para insertar en un atributo SVG.
 */
function escapeXml(value: string): string {
	return value.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`);
}
