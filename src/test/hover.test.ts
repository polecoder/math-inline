import * as assert from 'assert';
import * as vscode from 'vscode';
import { HOVER_SCALE, MathHoverProvider, previewMarkdown } from '../hover';
import { isError, render } from '../renderer';
import type { MathInlineApi } from '../extension';
import { activateExtension, openEditor } from './helpers';

/** @brief Margen que `previewMarkdown` agrega a la izquierda de la imagen para el botón de copiar. */
const GUTTER = 20;

/**
 * @brief Decodifica el SVG envoltorio de un hover generado por `previewMarkdown`.
 *
 * @param markdown Contenido del hover.
 * @return SVG exterior en texto.
 */
function decodeWrapper(markdown: vscode.MarkdownString): string {
	const match = /^!\[math\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)$/.exec(markdown.value);
	assert.ok(match, `unexpected hover markdown: ${markdown.value}`);
	return Buffer.from(match[1], 'base64').toString();
}

/**
 * @brief Decodifica el SVG de una fórmula y le agrega el desplazamiento con que `previewMarkdown` lo anida.
 *
 * @param uri URI `data:` en base64 de la fórmula, tal como la devuelve `render`.
 * @return Texto con el que el `<svg>` de la fórmula debe aparecer dentro del SVG envoltorio.
 */
function nestedFormula(uri: string): string {
	return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').toString().replace(/^<svg/, `<svg x="${GUTTER}"`);
}

suite('previewMarkdown', () => {
	const options = { color: '#123456', exPx: 7 };

	test('nests the formula SVG in a wrapper with a transparent left gutter for the copy button', () => {
		const preview = previewMarkdown('x', options)!;
		const inner = render('x', { ...options, display: true });
		assert.ok(!isError(inner));
		const svg = decodeWrapper(preview);
		assert.strictEqual(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="${inner.width + GUTTER}" height="${inner.height}">${nestedFormula(inner.uri)}</svg>`);
		assert.ok(!svg.includes('<image'), 'the formula is not base64-encoded twice');
	});

	test('renders in display mode even if the caller asks for inline', () => {
		const tex = String.raw`\sum_{i=1}^{n} i`;
		const inline = render(tex, { ...options, display: false });
		const display = render(tex, { ...options, display: true });
		assert.ok(!isError(inline) && !isError(display));
		assert.ok(display.height > inline.height);
		const svg = decodeWrapper(previewMarkdown(tex, { ...options, display: false })!);
		assert.ok(svg.includes(`height="${display.height}"`));
	});

	test('returns undefined for invalid TeX', () => {
		assert.strictEqual(previewMarkdown(String.raw`\frac{a`, options), undefined);
	});
});

suite('MathHoverProvider', () => {
	let api: MathInlineApi;
	let provider: MathHoverProvider;
	let document: vscode.TextDocument;

	suiteSetup(async () => {
		api = await activateExtension();
		provider = new MathHoverProvider(api.decorator);
		document = (await openEditor('Euler: $e^{i\\pi}+1=0$ and $\\frac{a$.\n')).document;
	});

	test('returns the enlarged formula covering the whole `$...$` range', () => {
		const start = document.positionAt(7);
		const hover = provider.provideHover(document, start)!;
		assert.ok(hover);
		assert.deepStrictEqual(hover.range, new vscode.Range(start, document.positionAt(7 + '$e^{i\\pi}+1=0$'.length)));
		const expected = render('e^{i\\pi}+1=0', { ...api.decorator.renderOptions(HOVER_SCALE), display: true });
		assert.ok(!isError(expected));
		const content = hover.contents[0] as vscode.MarkdownString;
		assert.ok(decodeWrapper(content).includes(nestedFormula(expected.uri)));
	});

	test('is also active on the last character of the formula but not just past it', () => {
		const end = 7 + '$e^{i\\pi}+1=0$'.length;
		assert.ok(provider.provideHover(document, document.positionAt(end - 1)));
		assert.strictEqual(provider.provideHover(document, document.positionAt(end)), undefined);
	});

	test('returns undefined over plain text', () => {
		assert.strictEqual(provider.provideHover(document, new vscode.Position(0, 2)), undefined);
	});

	test('returns undefined over a formula with a TeX error', () => {
		const offset = document.getText().indexOf('$\\frac{a$') + 3;
		assert.strictEqual(provider.provideHover(document, document.positionAt(offset)), undefined);
	});
});
