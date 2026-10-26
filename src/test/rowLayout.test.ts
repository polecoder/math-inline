import * as assert from 'assert';
import * as vscode from 'vscode';
import type { MathInlineApi } from '../extension';
import { RowLayout } from '../blockLayout';
import { getFontSize, getLineHeight } from '../config';
import { RenderOptions, RenderedRow, isError, renderRows } from '../renderer';
import { activateExtension, openEditor } from './helpers';

/** @brief Opciones con las que el editor dibuja las filas (alto de línea 19, `ex` de 7 px, estilo texto). */
const ROW_OPTIONS: RenderOptions = { color: '#000', exPx: 7, maxHeight: 19, textStyle: true };
/** @brief Bloque con \frac e \int en filas contiguas (cinco filas). */
const GATHER = String.raw`\begin{gather*}
y' + y\cos x = 0\\
\iff\\
\frac{y'}{y} = -\cos x\\
\iff\\
\int \frac{y'}{y}dx = \int -\cos x\,dx
\end{gather*}`;
/** @brief Ubicación de las filas de `GATHER` dentro del bloque `$$` que las contiene (líneas 2 a 6 de 9). */
const GATHER_LAYOUT: RowLayout = { rowLines: [2, 3, 4, 5, 6], lines: 9, axis: 3.5 };
/** @brief Tabla de dos filas muy altas, que no entran a tamaño completo en líneas contiguas. */
const TALL = String.raw`\begin{aligned}a&=b\\ \dfrac{\dfrac{x}{y}}{\sqrt{z}} &= c\end{aligned}`;
/** @brief Ubicación de las dos filas de `TALL` en líneas contiguas. */
const TIGHT: RowLayout = { rowLines: [0, 1], lines: 2, axis: 3.5 };

/**
 * @brief Renderiza las filas y falla si el resultado no es una lista de filas.
 *
 * @param tex TeX de la tabla.
 * @param options Opciones de render.
 * @param layout Ubicación de las filas.
 * @return Filas renderizadas.
 */
function rowsOf(tex: string, options: RenderOptions, layout?: RowLayout): RenderedRow[] {
	const rows = renderRows(tex, options, layout);
	assert.ok(Array.isArray(rows));
	return rows;
}

suite('renderRows with a layout', () => {
	test('draws rows with fractions and integrals at full size when the lines leave room', () => {
		const layout: RowLayout = { rowLines: [2, 4, 6, 8, 10], lines: 13, axis: 3.5 };
		const rows = rowsOf(GATHER, ROW_OPTIONS, layout);
		assert.strictEqual(rows.length, 5);
		assert.deepStrictEqual(rows.map(r => [r.fit, r.offset]), [[1, 0], [1, 0], [1, 0], [1, 0], [1, 0]]);
		assert.ok(rows[2].height > 19, 'the rows with a fraction are taller than the line');
	});

	test('draws the motivating gather block with one shared fit in contiguous lines', () => {
		const rows = rowsOf(GATHER, ROW_OPTIONS, GATHER_LAYOUT);
		const fit = rows[0].fit;
		assert.ok(fit >= 0.8 && fit < 1, `fit ${fit}`);
		assert.deepStrictEqual(rows.map(r => [r.fit, r.offset]), rows.map(() => [fit, 0]));
	});

	test('without a layout the same rows are shrunk to the line height', () => {
		const rows = rowsOf(GATHER, ROW_OPTIONS);
		assert.ok(rows.some(r => r.fit < 1));
		assert.ok(rows.every(r => r.height <= 19));
	});

	test('rows taller than the line keep fit 1, offset 0 and may exceed maxHeight', () => {
		const rows = rowsOf(TALL, ROW_OPTIONS, { rowLines: [1, 5], lines: 7, axis: 3.5 });
		assert.ok(rows[1].height > 19);
		assert.deepStrictEqual(rows.map(r => [r.fit, r.offset]), [[1, 0], [1, 0]]);
	});

	test('a single scale between 0.8 and 1 is shared by every row, without offset', () => {
		const rows = rowsOf(GATHER, { ...ROW_OPTIONS, maxHeight: 20 }, GATHER_LAYOUT);
		const fit = rows[0].fit;
		assert.ok(fit >= 0.8 && fit < 1, `fit ${fit}`);
		assert.deepStrictEqual(rows.map(r => [r.fit, r.offset]), rows.map(() => [fit, 0]));
	});

	test('falls back to a separate fit per row when the single scale would be below 0.8', () => {
		const options = { ...ROW_OPTIONS, maxHeight: 12 };
		const withLayout = rowsOf(TALL, options, TIGHT);
		assert.deepStrictEqual(withLayout, rowsOf(TALL, options));
		assert.ok(withLayout[1].fit < withLayout[0].fit);
		assert.ok(withLayout[1].offset > 0);
	});

	test('ignores a layout with a different number of rows than the table', () => {
		const options = { ...ROW_OPTIONS, maxHeight: 12 };
		const wrong = rowsOf(TALL, options, { rowLines: [0, 10, 20], lines: 30, axis: 3.5 });
		assert.deepStrictEqual(wrong, rowsOf(TALL, options));
	});

	test('ignores the layout when there is no maxHeight', () => {
		const options = { color: '#000', exPx: 7, textStyle: true };
		const rows = rowsOf(TALL, options, TIGHT);
		assert.deepStrictEqual(rows, rowsOf(TALL, options));
		assert.deepStrictEqual(rows.map(r => [r.fit, r.offset]), [[1, 0], [1, 0]]);
	});

	test('caches the result per layout', () => {
		const options = { ...ROW_OPTIONS, maxHeight: 12 };
		const first = renderRows(TALL, options, TIGHT);
		assert.strictEqual(renderRows(TALL, options, { ...TIGHT, rowLines: [...TIGHT.rowLines] }), first);
		const spaced = renderRows(TALL, options, { rowLines: [3, 12], lines: 16, axis: 3.5 });
		assert.notStrictEqual(spaced, first);
		assert.deepStrictEqual(rowsOf(TALL, options, { rowLines: [3, 12], lines: 16, axis: 3.5 }).map(r => r.fit), [1, 1]);
		assert.notStrictEqual(renderRows(TALL, options, { ...TIGHT, lines: 3 }), first);
		assert.notStrictEqual(renderRows(TALL, options, { ...TIGHT, axis: 4 }), first);
		assert.notStrictEqual(renderRows(TALL, options), first);
	});

	test('still reports TeX errors when a layout is given', () => {
		const result = renderRows(String.raw`\begin{aligned}\unknownMacro\end{aligned}`, ROW_OPTIONS, { rowLines: [0], lines: 1, axis: 3.5 });
		assert.ok(isError(result!));
	});
});

suite('Display math rows: decorations', () => {
	let api: MathInlineApi;

	suiteSetup(async () => {
		api = await activateExtension();
	});

	/**
	 * @brief Abre un documento, lo dibuja y devuelve los márgenes de las imágenes `before` y `after` por línea.
	 *
	 * @param content Contenido del documento.
	 * @param cursor Línea donde se coloca el cursor.
	 * @return Margen de la imagen `before` y de la imagen `after` de cada línea que las tiene.
	 */
	async function margins(content: string, cursor: number): Promise<{ before: Map<number, string>; after: Map<number, string> }> {
		const editor = await openEditor(content);
		const before = new Map<number, string>();
		const after = new Map<number, string>();
		const spy = new Proxy({} as vscode.TextEditor, {
			get(_, key) {
				if (key === 'setDecorations') {
					return (type: vscode.TextEditorDecorationType, options: vscode.DecorationOptions[]) => {
						for (const option of options) {
							const { before: b, after: a } = option.renderOptions ?? {};
							if (b?.margin !== undefined) {
								before.set(option.range.start.line, String(b.margin));
							}
							if (a?.margin !== undefined) {
								after.set(option.range.start.line, String(a.margin));
							}
						}
						editor.setDecorations(type, options);
					};
				}
				const value = Reflect.get(editor, key);
				return typeof value === 'function' ? value.bind(editor) : value;
			},
		});
		editor.selection = new vscode.Selection(cursor, 0, cursor, 0);
		before.clear();
		after.clear();
		api.decorator.update(spy);
		return { before, after };
	}

	/**
	 * @brief Arma un documento con un bloque `gather*` de tres filas (líneas 3 a 5).
	 *
	 * @param eol Fin de línea del documento.
	 * @return Contenido del documento.
	 */
	const block = (eol: string): string => ['Intro', '$$', '\\begin{gather*}', 'a\\\\', '\\frac{1}{2}\\\\', 'b', '\\end{gather*}', '$$', ''].join(eol);

	test('gives every row image a negative top margin equal to its height', async () => {
		const { before } = await margins(block('\n'), 0);
		assert.deepStrictEqual([...before.keys()], [3, 4, 5]);
		for (const margin of before.values()) {
			assert.match(margin, /^-\d+(\.\d+)?px 0 0 0px$/);
		}
	});

	test('gives the preview of the edited row a negative top margin and a 2ch left margin', async () => {
		const { after } = await margins(block('\n'), 4);
		assert.deepStrictEqual([...after.keys()], [4]);
		assert.match(after.get(4)!, /^-\d+(\.\d+)?px 0 0 2ch$/);
	});

	test('computes the same layout with CRLF line endings', async () => {
		const lf = await margins(block('\n'), 0);
		const crlf = await margins(block('\r\n'), 0);
		assert.strictEqual(crlf.before.size, 3);
		assert.deepStrictEqual([...crlf.before.entries()], [...lf.before.entries()]);
	});

	test('passes renderRows the lines relative to the block, the line count and the axis', async () => {
		const { before } = await margins(block('\n'), 0);
		const tex = '\n\\begin{gather*}\na\\\\\n\\frac{1}{2}\\\\\nb\n\\end{gather*}\n';
		const layout: RowLayout = { rowLines: [2, 3, 4], lines: 7, axis: getFontSize() * 0.25 };
		const options: RenderOptions = { ...api.decorator.renderOptions(), textStyle: true, maxHeight: getLineHeight() };
		const rows = rowsOf(tex, options, layout);
		assert.deepStrictEqual([...before.values()], rows.map(r => `-${r.height}px 0 0 ${r.offset}px`));
	});
});
