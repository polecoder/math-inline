import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

export interface RenderOptions {
	/** Text color, any CSS color. */
	color: string;
	/** Size of one `ex` in px. */
	exPx: number;
}

export interface RenderedMath {
	/** `data:` URI of the self-contained SVG. */
	uri: string;
	width: number;
	height: number;
	/** Baseline offset in px (negative = below the text baseline). */
	verticalAlign: number;
}

export interface RenderError {
	error: string;
}

export type RenderResult = RenderedMath | RenderError;

export function isError(result: RenderResult): result is RenderError {
	return 'error' in result;
}

// Packages that would hide errors or try to load code at runtime.
const EXCLUDED_PACKAGES = ['noerrors', 'noundefined', 'autoload', 'require'];
const CACHE_LIMIT = 500;

type MathDocument = ReturnType<typeof mathjax.document>;

let adaptor: ReturnType<typeof liteAdaptor> | undefined;
let doc: MathDocument | undefined;
const cache = new Map<string, RenderResult>();

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

function attr(svg: string, name: string): string | undefined {
	return new RegExp(`<svg[^>]* ${name}="(-?[\\d.]+)ex"`).exec(svg)?.[1];
}

function exToPx(value: string | undefined, exPx: number): number {
	return value === undefined ? 0 : Math.round(parseFloat(value) * exPx * 100) / 100;
}

function escapeXml(value: string): string {
	return value.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`);
}
