import * as assert from 'assert';
import * as vscode from 'vscode';
import type { MathInlineApi } from '../extension';
import { BIG_TEX, activateExtension, openEditor, setMarkdownWordWrap } from './helpers';

/** @brief Matriz de 2x2, demasiado alta para entrar en una línea pero que cabe en tres. */
const MATRIX = String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`;

/**
 * @brief Resultado de dibujar un documento: estado del decorador y adjuntos `before` por línea.
 */
interface Drawn {
	/** Editor dibujado. */
	editor: vscode.TextEditor;
	/** Adjunto `before` de las decoraciones de imagen, por línea. */
	before: Map<number, vscode.ThemableDecorationAttachmentRenderOptions>;
}

suite('Inline formulas overflowing into free lines', () => {
	let api: MathInlineApi;

	suiteSetup(async () => {
		api = await activateExtension();
	});

	teardown(async () => {
		await setMarkdownWordWrap(undefined);
	});

	/**
	 * @brief Abre un documento con el cursor fuera de las fórmulas, lo dibuja y recoge los adjuntos `before`.
	 *
	 * @param content Contenido del documento.
	 * @return Editor y adjuntos por línea.
	 */
	async function draw(content: string): Promise<Drawn> {
		const editor = await openEditor(content);
		const before = new Map<number, vscode.ThemableDecorationAttachmentRenderOptions>();
		const spy = new Proxy({} as vscode.TextEditor, {
			get(_, key) {
				if (key === 'setDecorations') {
					return (type: vscode.TextEditorDecorationType, options: vscode.DecorationOptions[]) => {
						for (const option of options) {
							if (option.renderOptions?.before?.contentIconPath) {
								before.set(option.range.start.line, option.renderOptions.before);
							}
						}
						editor.setDecorations(type, options);
					};
				}
				const value = Reflect.get(editor, key);
				return typeof value === 'function' ? value.bind(editor) : value;
			},
		});
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(spy);
		return { editor, before };
	}

	/**
	 * @brief Verifica que la imagen de una línea desborda: margen superior negativo igual a su alto y sin eventos de puntero.
	 *
	 * @param before Adjunto `before` de la línea.
	 */
	function assertOverflows(before: vscode.ThemableDecorationAttachmentRenderOptions | undefined): void {
		assert.ok(before, 'the formula is drawn as an image');
		assert.strictEqual(before.margin, `-${String(before.height).replace('px', '')}px 0 0 0`);
		assert.match(String(before.textDecoration), /pointer-events: none;/);
	}

	/**
	 * @brief Verifica que la fórmula se dibuja como imagen sin margen ni `pointer-events`.
	 *
	 * @param before Adjunto `before` de la línea.
	 */
	function assertPlain(before: vscode.ThemableDecorationAttachmentRenderOptions | undefined): void {
		assert.ok(before, 'the formula is drawn as an image');
		assert.strictEqual(before.margin, undefined);
		assert.doesNotMatch(String(before.textDecoration), /pointer-events/);
	}

	test('draws a tall formula alone between blank lines overflowing with a negative top margin', async () => {
		const { editor, before } = await draw(`\n\n$${MATRIX}$\n\n\n`);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.collapsed, []);
		assert.strictEqual(state.rendered.length, 1);
		assertOverflows(before.get(2));
	});

	test('treats lines with only whitespace as free', async () => {
		const { editor, before } = await draw(`  \n$${MATRIX}$\n\t\n`);
		assert.deepStrictEqual(api.decorator.getState(editor)!.collapsed, []);
		assertOverflows(before.get(1));
	});

	test('keeps the same formula as a chip in a dense paragraph', async () => {
		const { editor, before } = await draw(`text\n$${MATRIX}$\nmore text\n`);
		const state = api.decorator.getState(editor)!;
		assert.strictEqual(state.collapsed.length, 1);
		assert.deepStrictEqual(state.rendered, []);
		assert.strictEqual(before.size, 0);
	});

	test('keeps it as a chip when it shares its line with text and has no blank lines around', async () => {
		const { editor } = await draw(`text $${MATRIX}$ end`);
		assert.strictEqual(api.decorator.getState(editor)!.collapsed.length, 1);
	});

	test('shrinks slightly instead of overflowing when there are no blank lines and it is above 0.8', async () => {
		const { editor, before } = await draw(`a\n$${String.raw`\frac{a+b}{c}`}$\nb`);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.collapsed, []);
		assert.strictEqual(state.rendered.length, 1);
		assertPlain(before.get(1));
	});

	test('keeps the shrunk image when the room on one side would give a smaller scale', async () => {
		const { editor, before } = await draw(`a\n\n$${String.raw`\int_0^1 \frac{x}{y}dx`}$\nb`);
		assert.deepStrictEqual(api.decorator.getState(editor)!.collapsed, []);
		assertPlain(before.get(2));
	});

	test('does not use margins for a formula that fits in the line', async () => {
		const { editor, before } = await draw('\n$x$\n\n');
		assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 1);
		assertPlain(before.get(1));
	});

	test('does not overflow a long line when word-wrap is on', async () => {
		await setMarkdownWordWrap('on');
		const { editor } = await draw(`\n$${MATRIX}$ and then a long tail of words\n\n`);
		assert.strictEqual(api.decorator.getState(editor)!.collapsed.length, 1);
	});

	test('overflows a long line when word-wrap is off', async () => {
		await setMarkdownWordWrap('off');
		const { editor, before } = await draw(`\n$${MATRIX}$ and then a long tail of words\n\n`);
		assert.deepStrictEqual(api.decorator.getState(editor)!.collapsed, []);
		assertOverflows(before.get(1));
	});

	test('uses the wrap column of wordWrapColumn to allow a longer line', async () => {
		const doc = `\n$${BIG_TEX}$\n\n`;
		await setMarkdownWordWrap('wordWrapColumn', 40);
		assert.strictEqual(api.decorator.getState((await draw(doc)).editor)!.collapsed.length, 1);
		await setMarkdownWordWrap('wordWrapColumn', 200);
		const { editor, before } = await draw(doc);
		assert.deepStrictEqual(api.decorator.getState(editor)!.collapsed, []);
		assertOverflows(before.get(1));
	});

	test('keeps a formula too tall for the free room as a chip', async () => {
		await setMarkdownWordWrap('off');
		const tall = String.raw`\begin{pmatrix}a\\b\\c\\d\\e\\f\\g\\h\end{pmatrix}`;
		const { editor } = await draw(`\n$${tall}$\n\n`);
		assert.strictEqual(api.decorator.getState(editor)!.collapsed.length, 1);
	});

	test('reclassifies the formulas when editor.wordWrap changes', async () => {
		await setMarkdownWordWrap('off');
		const { editor } = await draw(`\n$${BIG_TEX}$\n\n`);
		assert.deepStrictEqual(api.decorator.getState(editor)!.collapsed, []);
		await setMarkdownWordWrap('on');
		assert.strictEqual(api.decorator.getState(editor)!.collapsed.length, 1);
	});

	suite('isLarge with a document', () => {
		const docs: [string, string][] = [
			['alone between blank lines', `\n$${MATRIX}$\n\n`],
			['inside a dense paragraph', `a\n$${MATRIX}$\nb`],
			['too big even with room', `\n$${BIG_TEX}$\n\n`],
			['small', '\n$x$\n\n'],
		];
		for (const [name, content] of docs) {
			for (const wrap of ['off', 'on']) {
				test(`matches whether the formula is a chip: ${name}, word-wrap ${wrap}`, async () => {
					await setMarkdownWordWrap(wrap);
					const { editor } = await draw(content);
					const [span] = api.decorator.getSpans(editor.document);
					const collapsed = api.decorator.getState(editor)!.collapsed.length === 1;
					assert.strictEqual(api.decorator.isLarge(span, editor.document), collapsed);
				});
			}
		}

		test('without a document there are no free lines', async () => {
			const { editor } = await draw(`\n$${MATRIX}$\n\n`);
			const [span] = api.decorator.getSpans(editor.document);
			assert.strictEqual(api.decorator.isLarge(span), true);
			assert.strictEqual(api.decorator.isLarge(span, editor.document), false);
		});
	});
});
