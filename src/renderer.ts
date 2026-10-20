import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

/**
 * @brief Opciones de render de una fórmula.
 */
export interface RenderOptions {
	/** Color del texto, cualquier color CSS. */
	color: string;
	/** Tamaño de una unidad `ex` en píxeles. */
	exPx: number;
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
 * @brief Indica si un resultado de render es un error.
 *
 * @param result Resultado a examinar.
 * @return `true` si `result` es un `RenderError`.
 */
export function isError(result: RenderResult): result is RenderError {
	return 'error' in result;
}

/** @brief Paquetes de MathJax excluidos porque ocultarían errores o cargarían código en tiempo de ejecución. */
const EXCLUDED_PACKAGES = ['noerrors', 'noundefined', 'autoload', 'require'];
/** @brief Cantidad máxima de resultados de render en caché. */
const CACHE_LIMIT = 500;

/** @brief Documento de MathJax usado para convertir TeX a SVG. */
type MathDocument = ReturnType<typeof mathjax.document>;

let adaptor: ReturnType<typeof liteAdaptor> | undefined;
let doc: MathDocument | undefined;
const cache = new Map<string, RenderResult>();

/**
 * @brief Devuelve el documento de MathJax, creándolo en el primer uso.
 *
 * Configura TeX con todos los paquetes salvo `EXCLUDED_PACKAGES`, hace que los
 * errores de TeX se lancen como excepción y usa salida SVG sin caché de fuentes.
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
		const svg = new SVG({ fontCache: 'none' });
		doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
	}
	return doc;
}

/**
 * @brief Renderiza TeX inline a una imagen SVG, con caché.
 *
 * La caché se indexa por color, `exPx` y TeX, y descarta la entrada más antigua
 * al llegar a `CACHE_LIMIT`. Los errores también se cachean.
 *
 * @param tex Código TeX de la fórmula, sin delimitadores.
 * @param options Color y escala del render.
 * @return Imagen renderizada, o el error de MathJax si el TeX no es válido.
 */
export function render(tex: string, options: RenderOptions): RenderResult {
	const key = `${options.color}\u0000${options.exPx}\u0000${tex}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const result = renderUncached(tex, options);
	if (cache.size >= CACHE_LIMIT) {
		// Map preserves insertion order: drop the oldest entry.
		cache.delete(cache.keys().next().value!);
	}
	cache.set(key, result);
	return result;
}

/**
 * @brief Convierte TeX a SVG con MathJax, sin usar la caché.
 *
 * Reescribe el SVG para que tenga dimensiones en píxeles, sin `style` en la raíz
 * y con `currentColor` reemplazado por el color pedido.
 *
 * @param tex Código TeX de la fórmula.
 * @param options Color y tamaño de `ex` en píxeles.
 * @return Imagen como URI `data:` con sus medidas, o el error de MathJax.
 */
function renderUncached(tex: string, { color, exPx }: RenderOptions): RenderResult {
	let svg: string;
	try {
		const node = getDocument().convert(tex, { display: false });
		svg = adaptor!.innerHTML(node);
	} catch (err) {
		// MathJax's TexError is not an Error subclass, but carries a message.
		const message = (err as { message?: unknown } | undefined)?.message;
		return { error: typeof message === 'string' ? message : String(err) };
	}

	const width = exToPx(attr(svg, 'width'), exPx);
	const height = exToPx(attr(svg, 'height'), exPx);
	const verticalAlign = exToPx(/vertical-align:\s*(-?[\d.]+)ex/.exec(svg)?.[1], exPx);

	svg = svg
		.replace(/^<svg[^>]*>/, root => root
			.replace(/ width="[^"]*"/, ` width="${width}"`)
			.replace(/ height="[^"]*"/, ` height="${height}"`)
			.replace(/ style="[^"]*"/, ''))
		.replace(/currentColor/g, escapeXml(color));

	return {
		uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
		width,
		height,
		verticalAlign,
	};
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
	return value === undefined ? 0 : Math.round(parseFloat(value) * exPx * 100) / 100;
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
