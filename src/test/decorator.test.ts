import * as assert from 'assert';
import * as vscode from 'vscode';
import { MathDecorator } from '../decorator';
import type { MathInlineApi } from '../extension';
import type { MathSpan } from '../parser';
import { BIG_TEX, activateExtension, openEditor, setGlobalConfig, sleep, waitFor } from './helpers';

/** @brief Espera con la que se afirma que NO se abrió un hover (mayor que el retardo de la extensión, 300 ms). */
const NO_HOVER_WAIT_MS = 700;
/** @brief Espera con la que se afirma que NO hubo una actualización (mayor que el debounce de la extensión, 150 ms). */
const NO_UPDATE_WAIT_MS = 400;

/**
 * @brief Crea un rango de una sola línea.
 *
 * @param line Línea.
 * @param start Columna inicial.
 * @param end Columna final.
 * @return Rango correspondiente.
 */
function range(line: number, start: number, end: number): vscode.Range {
	return new vscode.Range(line, start, line, end);
}

/**
 * @brief Crea una fórmula inline (`$...$`) con el TeX indicado, como la devolvería el parser.
 *
 * @param tex Fuente TeX de la fórmula.
 * @return Fórmula que empieza en el offset 0 del documento.
 */
function inlineSpan(tex: string): MathSpan {
	return { start: 0, end: tex.length + 2, tex };
}

/**
 * @brief Coloca una única selección vacía y actualiza el decorador de forma sincrónica.
 *
 * @param api API de la extensión.
 * @param editor Editor a modificar.
 * @param line Línea del cursor.
 * @param column Columna del cursor.
 */
function placeCursor(api: MathInlineApi, editor: vscode.TextEditor, line: number, column: number): void {
	editor.selection = new vscode.Selection(line, column, line, column);
	api.decorator.update(editor);
}

/**
 * @brief Verifica que el editor no tenga ninguna decoración, sea cual sea la lista de categorías del estado.
 *
 * @param api API de la extensión.
 * @param editor Editor consultado.
 */
function assertNoDecorations(api: MathInlineApi, editor: vscode.TextEditor): void {
	const state = api.decorator.getState(editor);
	assert.ok(state);
	for (const [kind, ranges] of Object.entries(state)) {
		assert.deepStrictEqual(ranges, [], kind);
	}
}

/**
 * @brief Actualiza el decorador y devuelve los mensajes de hover de las decoraciones que puso en el editor.
 *
 * `getState` solo expone rangos, así que se actualiza a través de un proxy del editor que intercepta
 * `setDecorations` (el de un editor real es de solo lectura).
 * Solo las decoraciones de error llevan `hoverMessage`.
 *
 * @param api API de la extensión.
 * @param editor Editor a actualizar.
 * @return Mensajes de hover, en el orden en que se aplicaron.
 */
function hoverMessages(api: MathInlineApi, editor: vscode.TextEditor): string[] {
	const messages: string[] = [];
	const spy = new Proxy({} as vscode.TextEditor, {
		get(_, property) {
			if (property === 'setDecorations') {
				return (type: vscode.TextEditorDecorationType, decorations: readonly vscode.Range[] | readonly vscode.DecorationOptions[]) => {
					for (const decoration of decorations as readonly (vscode.Range | vscode.DecorationOptions)[]) {
						const message = 'hoverMessage' in decoration ? decoration.hoverMessage : undefined;
						if (typeof message === 'string') {
							messages.push(message);
						}
					}
					editor.setDecorations(type, decorations as vscode.DecorationOptions[]);
				};
			}
			const value: unknown = Reflect.get(editor, property, editor);
			return typeof value === 'function' ? value.bind(editor) : value;
		},
	});
	api.decorator.update(spy);
	return messages;
}

suite('MathDecorator behavior', () => {
	let api: MathInlineApi;

	suiteSetup(async () => {
		api = await activateExtension();
	});

	suite('update', () => {
		test('does nothing for editors that are not Markdown', async () => {
			const editor = await openEditor('$x^2$', 'plaintext');
			api.decorator.update(editor);
			assert.strictEqual(api.decorator.getState(editor), undefined);
		});

		test('reports the exact range of each formula on every line', async () => {
			const editor = await openEditor('a $x$\n\nb $y$ c $z$\n');
			placeCursor(api, editor, 1, 0);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.rendered, [range(0, 2, 5), range(2, 2, 5), range(2, 8, 11)]);
			assert.deepStrictEqual(state.revealed, []);
		});

		test('reveals a formula when the cursor touches either delimiter', async () => {
			const editor = await openEditor('a $x$ b');
			placeCursor(api, editor, 0, 2);
			assert.deepStrictEqual(api.decorator.getState(editor)!.revealed, [range(0, 2, 5)]);
			placeCursor(api, editor, 0, 5);
			assert.deepStrictEqual(api.decorator.getState(editor)!.revealed, [range(0, 2, 5)]);
			placeCursor(api, editor, 0, 1);
			assert.deepStrictEqual(api.decorator.getState(editor)!.revealed, []);
			placeCursor(api, editor, 0, 6);
			assert.deepStrictEqual(api.decorator.getState(editor)!.revealed, []);
			assert.deepStrictEqual(api.decorator.getState(editor)!.rendered, [range(0, 2, 5)]);
		});

		test('reveals every formula that a selection overlaps', async () => {
			const editor = await openEditor('$a$ $b$ $c$');
			editor.selection = new vscode.Selection(0, 2, 0, 5);
			api.decorator.update(editor);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.revealed, [range(0, 0, 3), range(0, 4, 7)]);
			assert.deepStrictEqual(state.rendered, [range(0, 8, 11)]);
		});

		test('honours multiple cursors', async () => {
			const editor = await openEditor('$a$ $b$ $c$');
			editor.selections = [new vscode.Selection(0, 1, 0, 1), new vscode.Selection(0, 9, 0, 9)];
			api.decorator.update(editor);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.revealed, [range(0, 0, 3), range(0, 8, 11)]);
			assert.deepStrictEqual(state.rendered, [range(0, 4, 7)]);
		});

		test('shows a formula with a TeX error as underlined source when the cursor is inside it', async () => {
			const editor = await openEditor('$\\frac{a$');
			placeCursor(api, editor, 0, 0);
			assert.deepStrictEqual(api.decorator.getState(editor)!.errors, [range(0, 0, 9)]);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, []);
			assert.deepStrictEqual(api.decorator.getState(editor)!.revealed, [range(0, 0, 9)]);
			assert.deepStrictEqual(api.decorator.getState(editor)!.rendered, []);
		});

		test('flags errors and collapses big formulas without touching the others', async () => {
			const editor = await openEditor(`$x$ $\\frac{a$ $${BIG_TEX}$`);
			editor.selection = new vscode.Selection(0, 0, 0, 0);
			// The cursor touches `$x$`, so it is revealed; the other two are classified.
			api.decorator.update(editor);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.revealed, [range(0, 0, 3)]);
			assert.deepStrictEqual(state.errors, [range(0, 4, 13)]);
			assert.deepStrictEqual(state.collapsed, [range(0, 14, 14 + BIG_TEX.length + 2)]);
			assert.deepStrictEqual(state.rendered, []);
		});

		test('ignores dollars that are not formulas', async () => {
			const editor = await openEditor('costs \\$5 and `$x$`\n');
			placeCursor(api, editor, 0, 0);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual([state.rendered, state.collapsed, state.errors, state.revealed], [[], [], [], []]);
		});

		test('leaves an empty document without decorations', async () => {
			const editor = await openEditor('');
			api.decorator.update(editor);
			assertNoDecorations(api, editor);
		});
	});

	suite('inline preview', () => {
		test('shows a preview right after the closing dollar of the formula being edited', async () => {
			const editor = await openEditor('a $x^2$ b');
			placeCursor(api, editor, 0, 4);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.revealed, [range(0, 2, 7)]);
			assert.deepStrictEqual(state.ghosts, [range(0, 7, 7)]);
			assert.deepStrictEqual(state.errors, []);
		});

		test('removes the preview when the cursor leaves the formula', async () => {
			const editor = await openEditor('a $x^2$ b');
			placeCursor(api, editor, 0, 4);
			placeCursor(api, editor, 0, 9);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.ghosts, []);
			assert.deepStrictEqual(state.rendered, [range(0, 2, 7)]);
		});

		test('shows the preview of a one-line $$ formula after its closing dollars', async () => {
			const editor = await openEditor('$$x^2$$');
			placeCursor(api, editor, 0, 3);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.revealed, [range(0, 0, 7)]);
			assert.deepStrictEqual(state.ghosts, [range(0, 7, 7)]);
		});

		test('shows one preview per touched formula with multiple cursors', async () => {
			const editor = await openEditor('$a$ $b$ $c$');
			editor.selections = [new vscode.Selection(0, 1, 0, 1), new vscode.Selection(0, 9, 0, 9)];
			api.decorator.update(editor);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 3, 3), range(0, 11, 11)]);
		});

		test('shows no preview for a big formula shown as a chip', async () => {
			const editor = await openEditor(`$${BIG_TEX}$`);
			placeCursor(api, editor, 0, 3);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.revealed, [range(0, 0, BIG_TEX.length + 2)]);
			assert.deepStrictEqual(state.ghosts, []);
			assert.deepStrictEqual(state.errors, []);
		});

		test('keeps showing the last valid render while an edit leaves the TeX invalid', async () => {
			const editor = await openEditor('$x^2$');
			placeCursor(api, editor, 0, 4);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 5, 5)]);
			// `$x^2$` -> `$x^{2$`: the opening `$` stays at offset 0.
			await editor.edit(b => b.replace(range(0, 3, 3), '{'));
			assert.strictEqual(editor.document.getText(), '$x^{2$');
			placeCursor(api, editor, 0, 5);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, [range(0, 0, 6)]);
			assert.deepStrictEqual(state.ghosts, [range(0, 6, 6)]);
		});

		test('shows the preview of the fixed formula once the TeX is valid again', async () => {
			const editor = await openEditor('$x^2$');
			placeCursor(api, editor, 0, 4);
			await editor.edit(b => b.replace(range(0, 3, 3), '{'));
			placeCursor(api, editor, 0, 5);
			await editor.edit(b => b.insert(new vscode.Position(0, 5), '}'));
			assert.strictEqual(editor.document.getText(), '$x^{2}$');
			placeCursor(api, editor, 0, 6);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, []);
			assert.deepStrictEqual(state.ghosts, [range(0, 7, 7)]);
		});

		test('shows no preview for an error in a formula that never rendered', async () => {
			const editor = await openEditor(String.raw`$\frac{a$`);
			placeCursor(api, editor, 0, 3);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, [range(0, 0, 9)]);
			assert.deepStrictEqual(state.ghosts, []);
		});

		test('does not reuse the render of another formula for a formula with an error', async () => {
			const editor = await openEditor(String.raw`$x$ $\frac{a$`);
			placeCursor(api, editor, 0, 1);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 3, 3)]);
			placeCursor(api, editor, 0, 8);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, [range(0, 4, 13)]);
			assert.deepStrictEqual(state.ghosts, []);
		});

		test('does not reuse the render of another document for a formula with an error', async () => {
			const valid = await openEditor('$x$');
			placeCursor(api, valid, 0, 1);
			assert.deepStrictEqual(api.decorator.getState(valid)!.ghosts, [range(0, 3, 3)]);
			const broken = await openEditor(String.raw`$\frac{a$`);
			placeCursor(api, broken, 0, 3);
			assert.deepStrictEqual(api.decorator.getState(broken)!.errors, [range(0, 0, 9)]);
			assert.deepStrictEqual(api.decorator.getState(broken)!.ghosts, []);
		});

		test('does not reuse the render when the line of its formula is deleted and a broken formula lands on the same bounds', async () => {
			const editor = await openEditor('$ab$\n' + String.raw`$\q$`);
			placeCursor(api, editor, 0, 2);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 4, 4)]);
			await editor.edit(b => b.delete(new vscode.Range(0, 0, 1, 0)));
			assert.strictEqual(editor.document.getText(), String.raw`$\q$`);
			placeCursor(api, editor, 0, 2);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, [range(0, 0, 4)]);
			assert.deepStrictEqual(state.ghosts, []);
		});

		test('does not reuse the render when its formula is deleted from the same line and a broken one lands on the same bounds', async () => {
			const editor = await openEditor(String.raw`$ab$ $\q$`);
			placeCursor(api, editor, 0, 2);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 4, 4)]);
			await editor.edit(b => b.delete(range(0, 0, 5)));
			assert.strictEqual(editor.document.getText(), String.raw`$\q$`);
			placeCursor(api, editor, 0, 2);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, [range(0, 0, 4)]);
			assert.deepStrictEqual(state.ghosts, []);
		});

		test('does not bring back an older render when a formula that became a chip then has an error', async () => {
			const editor = await openEditor('$x$');
			placeCursor(api, editor, 0, 1);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 3, 3)]);
			await editor.edit(b => b.insert(new vscode.Position(0, 2), BIG_TEX));
			placeCursor(api, editor, 0, 3);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [], 'a chip has no preview');
			assert.deepStrictEqual(api.decorator.getState(editor)!.revealed, [range(0, 0, BIG_TEX.length + 3)]);
			await editor.edit(b => b.insert(new vscode.Position(0, BIG_TEX.length + 2), '{'));
			placeCursor(api, editor, 0, 3);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, [range(0, 0, BIG_TEX.length + 4)]);
			assert.deepStrictEqual(state.ghosts, []);
		});

		test('limits the preview to the edited formula when a space before its closing dollar makes the parser run on', async () => {
			// Columns: `$` of the first formula at 18; its closing `$` at 35, which becomes 36 after the space.
			const editor = await openEditor(String.raw`Euler's identity: $e^{i\pi} + 1 = 0$, and a fraction $\frac{a+b}{c}$ inline.`);
			placeCursor(api, editor, 0, 20);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 36, 36)]);
			await editor.edit(b => b.insert(new vscode.Position(0, 35), ' '));
			assert.strictEqual(editor.document.lineAt(0).text, String.raw`Euler's identity: $e^{i\pi} + 1 = 0 $, and a fraction $\frac{a+b}{c}$ inline.`);
			placeCursor(api, editor, 0, 20);
			const state = api.decorator.getState(editor)!;
			// The parser now reads up to the second formula's closing `$`, but only the first one is flagged.
			assert.deepStrictEqual(state.revealed, [range(0, 18, 69)]);
			assert.deepStrictEqual(state.errors, [range(0, 18, 37)]);
			assert.deepStrictEqual(state.ghosts, [range(0, 37, 37)]);
		});

		test('keeps the preview after the original closing dollar when the TeX is also invalid', async () => {
			const editor = await openEditor(String.raw`Euler's identity: $e^{i\pi} + 1 = 0$, and a fraction $\frac{a+b}{c}$ inline.`);
			placeCursor(api, editor, 0, 20);
			// One edit adds an unclosed `{` after the opening `$` and the space before the closing `$` (35 -> 37).
			await editor.edit(b => {
				b.insert(new vscode.Position(0, 19), '{');
				b.insert(new vscode.Position(0, 35), ' ');
			});
			assert.strictEqual(editor.document.lineAt(0).text, String.raw`Euler's identity: $` + String.raw`{e^{i\pi} + 1 = 0 $, and a fraction $\frac{a+b}{c}$ inline.`);
			placeCursor(api, editor, 0, 21);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, [range(0, 18, 38)]);
			assert.deepStrictEqual(state.ghosts, [range(0, 38, 38)]);
		});

		test('moves the preview along with the closing dollar while the formula is edited after it stopped closing', async () => {
			const editor = await openEditor(String.raw`$x^2$ and $y$`);
			placeCursor(api, editor, 0, 2);
			await editor.edit(b => b.insert(new vscode.Position(0, 4), ' '));
			assert.strictEqual(editor.document.getText(), String.raw`$x^2 $ and $y$`);
			placeCursor(api, editor, 0, 2);
			assert.deepStrictEqual(api.decorator.getState(editor)!.errors, [range(0, 0, 6)]);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 6, 6)]);
			// Typing inside the formula moves its closing `$`, and the preview follows it.
			await editor.edit(b => b.insert(new vscode.Position(0, 1), 'a'));
			placeCursor(api, editor, 0, 3);
			assert.deepStrictEqual(api.decorator.getState(editor)!.errors, [range(0, 0, 7)]);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 7, 7)]);
		});

		test('previews the whole run-on formula after its end when the document opens with the closing dollar already broken', async () => {
			const editor = await openEditor(String.raw`Euler's identity: $e^{i\pi} + 1 = 0 $, and a fraction $\frac{a+b}{c}$ inline.`);
			placeCursor(api, editor, 0, 20);
			const state = api.decorator.getState(editor)!;
			// There is no earlier render to tell where the formula used to close, so the parser's span (columns 18 to 69) is used as is.
			assert.deepStrictEqual(state.revealed, [range(0, 18, 69)]);
			assert.deepStrictEqual(state.errors, []);
			assert.deepStrictEqual(state.ghosts, [range(0, 69, 69)]);
		});

		test('limits the preview of a one-line $$ formula to its original closing dollars when an escape makes the parser run on', async () => {
			const editor = await openEditor('$$x^2$$ and $$y$$');
			placeCursor(api, editor, 0, 4);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 7, 7)]);
			// `$$x^2\$$ and $$y$$`: the escaped `$` no longer closes, so the formula runs to the second `$$`.
			await editor.edit(b => b.insert(new vscode.Position(0, 5), '\\'));
			assert.strictEqual(editor.document.getText(), String.raw`$$x^2\$$ and $$y$$`);
			placeCursor(api, editor, 0, 4);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.revealed, [range(0, 0, 15)]);
			assert.deepStrictEqual(state.errors, [range(0, 0, 8)]);
			assert.deepStrictEqual(state.ghosts, [range(0, 8, 8)]);
		});

		test('explains that the closing dollar follows a space', async () => {
			const editor = await openEditor('$x^2$ and $y$');
			placeCursor(api, editor, 0, 2);
			await editor.edit(b => b.insert(new vscode.Position(0, 4), ' '));
			assert.deepStrictEqual(hoverMessages(api, editor), [
				'Math Inline: this $ does not close the formula (it follows a space), so the formula runs on to a later $',
			]);
		});

		test('explains that the closing dollar is escaped', async () => {
			const editor = await openEditor('$x^2$ and $y$');
			placeCursor(api, editor, 0, 2);
			// `$x^2\$ and $y$`: the escaped `$` does not close, so the formula runs on to the last `$`.
			await editor.edit(b => b.insert(new vscode.Position(0, 4), '\\'));
			assert.strictEqual(editor.document.getText(), String.raw`$x^2\$ and $y$`);
			placeCursor(api, editor, 0, 2);
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual(state.errors, [range(0, 0, 6)]);
			assert.deepStrictEqual(state.ghosts, [range(0, 6, 6)]);
			assert.deepStrictEqual(hoverMessages(api, editor), [
				'Math Inline: this $ does not close the formula (it is escaped), so the formula runs on to a later $',
			]);
		});

		test('joins the delimiter and TeX messages when both are wrong', async () => {
			const editor = await openEditor('$x^2$ and $y$');
			placeCursor(api, editor, 0, 2);
			await editor.edit(b => {
				b.insert(new vscode.Position(0, 3), '{');
				b.insert(new vscode.Position(0, 4), ' ');
			});
			assert.strictEqual(editor.document.getText(), '$x^{2 $ and $y$');
			const messages = hoverMessages(api, editor);
			assert.strictEqual(messages.length, 1);
			assert.match(messages[0], /^Math Inline: this \$ does not close the formula \(it follows a space\), so the formula runs on to a later \$; .+/);
		});

		test('does not flag a closing delimiter when a $$ formula loses its closing dollars by deletion', async () => {
			const editor = await openEditor('$$x$$ and $$y$$');
			placeCursor(api, editor, 0, 2);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 5, 5)]);
			// `$$x$$ and $$y$$` -> `$$$ and $$y$$`: the formula now runs to the second `$$`.
			await editor.edit(b => b.delete(range(0, 2, 4)));
			assert.strictEqual(editor.document.getText(), '$$$ and $$y$$');
			placeCursor(api, editor, 0, 1);
			assert.deepStrictEqual(api.decorator.getState(editor)!.revealed, [range(0, 0, 10)]);
			for (const message of hoverMessages(api, editor)) {
				assert.doesNotMatch(message, /does not close the formula/);
			}
		});

		test('drops the saved render when the configuration changes', async () => {
			const editor = await openEditor('$x^2$');
			placeCursor(api, editor, 0, 4);
			await editor.edit(b => b.replace(range(0, 3, 3), '{'));
			placeCursor(api, editor, 0, 5);
			assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts, [range(0, 6, 6)], 'the old render is still shown');
			try {
				await setGlobalConfig('mathInline', 'scale', 2);
				const state = api.decorator.getState(editor)!;
				assert.deepStrictEqual(state.errors, [range(0, 0, 6)]);
				assert.deepStrictEqual(state.ghosts, []);
			} finally {
				await setGlobalConfig('mathInline', 'scale', undefined);
			}
		});
	});

	suite('configuration', () => {
		test('clears every decoration while mathInline.enabled is false', async () => {
			const editor = await openEditor(`$x$ $y$ $\\frac{a$ $${BIG_TEX}$`);
			placeCursor(api, editor, 0, 0);
			try {
				await setGlobalConfig('mathInline', 'enabled', false);
				api.decorator.update(editor);
				assertNoDecorations(api, editor);
			} finally {
				await setGlobalConfig('mathInline', 'enabled', undefined);
			}
			assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 1);
		});

		test('refreshes the visible editors when the configuration changes', async () => {
			const editor = await openEditor('$\\frac{a}{b}$ tail');
			placeCursor(api, editor, 0, 17);
			assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 1);
			const before = api.decorator.getState(editor);
			try {
				// A big scale pushes the fraction past the one-line limit, so it turns into a chip.
				await setGlobalConfig('mathInline', 'scale', 4);
				const after = api.decorator.getState(editor)!;
				assert.notStrictEqual(after, before);
				assert.deepStrictEqual(after.collapsed, [range(0, 0, 13)]);
				assert.deepStrictEqual(after.rendered, []);
			} finally {
				await setGlobalConfig('mathInline', 'scale', undefined);
			}
			assert.deepStrictEqual(api.decorator.getState(editor)!.rendered, [range(0, 0, 13)]);
		});

		test('refreshes the editors when editor.lineHeight changes', async () => {
			const editor = await openEditor('$\\frac{a}{b}$ tail');
			placeCursor(api, editor, 0, 17);
			try {
				await setGlobalConfig('editor', 'lineHeight', 8);
				assert.deepStrictEqual(api.decorator.getState(editor)!.collapsed, [range(0, 0, 13)]);
			} finally {
				await setGlobalConfig('editor', 'lineHeight', undefined);
			}
			assert.deepStrictEqual(api.decorator.getState(editor)!.collapsed, []);
		});

		test('renderOptions combines font size, mathInline.scale and the extra scale', async () => {
			try {
				await setGlobalConfig('editor', 'fontSize', 20);
				await setGlobalConfig('mathInline', 'scale', 2);
				assert.strictEqual(api.decorator.renderOptions().exPx, 20);
				assert.strictEqual(api.decorator.renderOptions(1.5).exPx, 30);
			} finally {
				await setGlobalConfig('mathInline', 'scale', undefined);
				await setGlobalConfig('editor', 'fontSize', undefined);
			}
		});

		test('renderOptions uses the configured color', async () => {
			try {
				await setGlobalConfig('mathInline', 'color', ' #ffcc00 ');
				assert.strictEqual(api.decorator.renderOptions().color, '#ffcc00');
			} finally {
				await setGlobalConfig('mathInline', 'color', undefined);
			}
		});
	});

	suite('isLarge', () => {
		test('is true only for formulas that need shrinking below the inline limit', () => {
			assert.strictEqual(api.decorator.isLarge(inlineSpan(BIG_TEX)), true);
			assert.strictEqual(api.decorator.isLarge(inlineSpan('x^2')), false);
		});

		test('is false for formulas with TeX errors', () => {
			assert.strictEqual(api.decorator.isLarge(inlineSpan(String.raw`\frac{a`)), false);
		});
	});

	suite('document edits', () => {
		test('updates the decorations after typing, once the debounce elapses', async () => {
			const editor = await openEditor('plain\n');
			placeCursor(api, editor, 0, 0);
			assert.deepStrictEqual(api.decorator.getState(editor)!.rendered, []);
			await editor.edit(b => b.insert(new vscode.Position(1, 0), '$x$'));
			editor.selection = new vscode.Selection(0, 0, 0, 0);
			await waitFor(() => api.decorator.getState(editor)!.rendered.length === 1);
			assert.deepStrictEqual(api.decorator.getState(editor)!.rendered, [range(1, 0, 3)]);
		});

		test('coalesces a burst of edits into one refresh', async () => {
			const editor = await openEditor('plain\n');
			placeCursor(api, editor, 0, 0);
			const before = api.decorator.getState(editor);
			await editor.edit(b => b.insert(new vscode.Position(1, 0), '$'));
			await editor.edit(b => b.insert(new vscode.Position(1, 1), 'x'));
			await editor.edit(b => b.insert(new vscode.Position(1, 2), '$'));
			editor.selection = new vscode.Selection(0, 0, 0, 0);
			await waitFor(() => api.decorator.getState(editor)!.rendered.length === 1);
			assert.notStrictEqual(api.decorator.getState(editor), before);
		});

		test('editing a document that is not Markdown does not decorate it', async () => {
			const editor = await openEditor('', 'plaintext');
			await editor.edit(b => b.insert(new vscode.Position(0, 0), '$x$'));
			await sleep(NO_UPDATE_WAIT_MS);
			assert.strictEqual(api.decorator.getState(editor), undefined);
		});
	});

	suite('hover of big formulas', () => {
		let calls: number;
		let provider: vscode.Disposable;
		const bigLine = `Big: $${BIG_TEX}$ end\n`;

		suiteSetup(() => {
			calls = 0;
			// `editor.action.showHover` asks every provider; counting our calls tells us the command ran.
			provider = vscode.languages.registerHoverProvider({ language: 'markdown' }, {
				provideHover: () => {
					calls++;
					return undefined;
				},
			});
		});

		suiteTeardown(() => provider.dispose());

		test('opens the hover when the cursor moves inside a big formula', async () => {
			const editor = await openEditor(bigLine);
			placeCursor(api, editor, 0, 0);
			const before = calls;
			placeCursor(api, editor, 0, 10);
			await waitFor(() => calls > before);
		});

		test('opens it again after the cursor leaves and re-enters the formula', async () => {
			const editor = await openEditor(bigLine);
			placeCursor(api, editor, 0, 10);
			await waitFor(() => calls > 0);
			placeCursor(api, editor, 0, 0);
			const before = calls;
			placeCursor(api, editor, 0, 12);
			await waitFor(() => calls > before);
		});

		test('cancels the pending hover when the cursor leaves the formula first', async () => {
			const editor = await openEditor(bigLine);
			placeCursor(api, editor, 0, 0);
			await sleep(NO_HOVER_WAIT_MS);
			const before = calls;
			placeCursor(api, editor, 0, 10);
			placeCursor(api, editor, 0, 0);
			await sleep(NO_HOVER_WAIT_MS);
			assert.strictEqual(calls, before);
		});

		test('does not open it for a small formula', async () => {
			const editor = await openEditor('Small: $x^2$ end\n');
			placeCursor(api, editor, 0, 0);
			await sleep(NO_HOVER_WAIT_MS);
			const before = calls;
			placeCursor(api, editor, 0, 10);
			await sleep(NO_HOVER_WAIT_MS);
			assert.strictEqual(calls, before);
		});

		test('does not open it while text is selected', async () => {
			const editor = await openEditor(bigLine);
			placeCursor(api, editor, 0, 0);
			await sleep(NO_HOVER_WAIT_MS);
			const before = calls;
			editor.selection = new vscode.Selection(0, 8, 0, 12);
			api.decorator.update(editor);
			await sleep(NO_HOVER_WAIT_MS);
			assert.strictEqual(calls, before);
		});

		test('does not open it with several cursors', async () => {
			const editor = await openEditor(bigLine);
			placeCursor(api, editor, 0, 0);
			await sleep(NO_HOVER_WAIT_MS);
			const before = calls;
			editor.selections = [new vscode.Selection(0, 10, 0, 10), new vscode.Selection(0, 12, 0, 12)];
			api.decorator.update(editor);
			await sleep(NO_HOVER_WAIT_MS);
			assert.strictEqual(calls, before);
		});

		test('does not open it when the extension is disabled', async () => {
			const editor = await openEditor(bigLine);
			placeCursor(api, editor, 0, 0);
			try {
				await setGlobalConfig('mathInline', 'enabled', false);
				await sleep(NO_HOVER_WAIT_MS);
				const before = calls;
				placeCursor(api, editor, 0, 10);
				await sleep(NO_HOVER_WAIT_MS);
				assert.strictEqual(calls, before);
			} finally {
				await setGlobalConfig('mathInline', 'enabled', undefined);
			}
		});

		test('does not open it for an editor that is not the active one', async () => {
			const background = await openEditor(bigLine);
			const active = await openEditor('other\n');
			// showHover works on the active editor, so its cursor sits on text that any hover provider is asked about.
			active.selection = new vscode.Selection(0, 2, 0, 2);
			placeCursor(api, background, 0, 0);
			await sleep(NO_HOVER_WAIT_MS);
			const before = calls;
			assert.notStrictEqual(vscode.window.activeTextEditor, background);
			placeCursor(api, background, 0, 10);
			api.decorator.update(background);
			await sleep(NO_HOVER_WAIT_MS);
			assert.strictEqual(calls, before);
			assert.strictEqual(vscode.window.activeTextEditor, active);
		});
	});

	suite('dispose', () => {
		test('cancels pending refreshes and stops listening', async () => {
			const editor = await openEditor('plain\n');
			const decorator = new MathDecorator();
			const before = decorator.getState(editor);
			assert.ok(before);
			await editor.edit(b => b.insert(new vscode.Position(1, 0), '$x$'));
			decorator.dispose();
			await sleep(NO_UPDATE_WAIT_MS);
			assert.strictEqual(decorator.getState(editor), before);
		});
	});
});
