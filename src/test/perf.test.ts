import * as assert from 'assert';
import * as vscode from 'vscode';
import type { MathInlineApi } from '../extension';
import { MIN_WINDOW_MARGIN } from '../decorator';
import { activateExtension, isVisible, openEditor, setGlobalConfig, sleep, waitFor } from './helpers';

/** @brief Cantidad de párrafos del documento grande; cada uno tiene 3 fórmulas inline y uno de cada 10, un bloque `$$`. */
const PARAGRAPHS = 400;
/** @brief Tiempo máximo aceptado, en milisegundos, para una actualización con el render ya en caché. */
const MAX_UPDATE_MS = 100;
/** @brief Cantidad de líneas de los documentos de `lineDocument`. */
const DOCUMENT_LINES = 1000;
/** @brief Espera con la que se afirma que NO hubo una actualización por scroll (la extensión actualiza sin retardo). */
const NO_UPDATE_WAIT_MS = 200;
/** @brief Bloque `$$` de seis líneas con una tabla de dos filas, una por línea (filas en las líneas 2 y 3 del bloque). */
const TWO_ROW_BLOCK = ['$$', '\\begin{aligned}', 'd&=4\\\\', 'e&=5', '\\end{aligned}', '$$'];
/** @brief Bloque `$$` de siete líneas con una tabla de tres filas, una por línea. */
const THREE_ROW_BLOCK = ['$$', '\\begin{aligned}', 'a&=1\\\\', 'b&=2\\\\', 'c&=3', '\\end{aligned}', '$$'];

/**
 * @brief Arma un documento Markdown con muchas fórmulas distintas (inline y bloques `$$` multilínea).
 *
 * @return Texto del documento: unas 1200 fórmulas inline y 40 bloques en unas 1000 líneas.
 */
function largeDocument(): string {
	const parts: string[] = [];
	for (let i = 0; i < PARAGRAPHS; i++) {
		parts.push(`Paso ${i}: sea $x_{${i}} = \\frac{${i}}{n}$ y $\\sum_{k=0}^{${i}} a_k$, con $\\alpha^{${i}}$.`);
		if (i % 10 === 0) {
			parts.push(`$$\n\\begin{aligned}\nf(${i}) &= ${i}x \\\\\ng(${i}) &= x^{${i}}\n\\end{aligned}\n$$`);
		}
	}
	return parts.join('\n\n');
}

/**
 * @brief Mide cuánto tarda una función.
 *
 * @param action Función a medir.
 * @return Milisegundos transcurridos.
 */
function time(action: () => void): number {
	const start = performance.now();
	action();
	return performance.now() - start;
}

/**
 * @brief Arma un documento de `DOCUMENT_LINES` líneas con una fórmula inline cada una, salvo las que se reemplazan.
 *
 * @param blocks Líneas de texto que reemplazan, a partir de la línea indicada, las del documento.
 * @return Texto del documento; las líneas son `Line i $x_{i}$` (el cursor en la columna 0 no toca la fórmula).
 */
function lineDocument(blocks: { line: number; text: string[] }[] = []): string {
	const lines = Array.from({ length: DOCUMENT_LINES }, (_, i) => `Line ${i} $x_{${i}}$`);
	for (const block of blocks) {
		lines.splice(block.line, block.text.length, ...block.text);
	}
	return lines.join('\n');
}

/**
 * @brief Espera a que la zona visible del editor deje de cambiar (termina un scroll).
 *
 * @param editor Editor consultado.
 */
async function settle(editor: vscode.TextEditor): Promise<void> {
	const snapshot = () => JSON.stringify(editor.visibleRanges.map(r => [r.start.line, r.end.line]));
	for (let previous = ''; previous !== snapshot();) {
		previous = snapshot();
		await sleep(80);
	}
}

/**
 * @brief Hace scroll hasta que la primera línea visible del editor sea la indicada.
 *
 * `revealRange` deja la línea pedida unas filas más abajo del borde, así que corrige el pedido hasta acertar.
 *
 * @param editor Editor a desplazar.
 * @param first Primera línea visible deseada.
 */
async function scrollToFirstLine(editor: vscode.TextEditor, first: number): Promise<void> {
	let target = first;
	for (let attempt = 0; attempt < 5 && editor.visibleRanges[0].start.line !== first; attempt++) {
		editor.revealRange(new vscode.Range(target, 0, target, 0), vscode.TextEditorRevealType.AtTop);
		await settle(editor);
		target += first - editor.visibleRanges[0].start.line;
	}
	assert.strictEqual(editor.visibleRanges[0].start.line, first, 'the editor could not be scrolled to the requested line');
}

/**
 * @brief Mide cuántas líneas muestra la zona visible de un editor.
 *
 * @return Cantidad de líneas visibles con el documento abierto en la parte de arriba.
 */
async function viewportLines(): Promise<number> {
	const editor = await openEditor(lineDocument());
	await settle(editor);
	const lines = editor.visibleRanges[0].end.line - editor.visibleRanges[0].start.line + 1;
	await closeActiveEditor();
	return lines;
}

/**
 * @brief Cierra el editor activo y descarta su documento sin guardar.
 *
 * Los documentos grandes que quedan abiertos se vuelven a revisar con KaTeX en cada cambio de configuración,
 * lo que enlentece a los tests siguientes.
 */
async function closeActiveEditor(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

suite('Performance', function () {
	this.timeout(30000);

	teardown(closeActiveEditor);

	test('a large document only decorates the lines around the visible area', async () => {
		const api = await activateExtension();
		const editor = await openEditor(largeDocument());
		api.decorator.update(editor);
		const lastLine = editor.document.lineCount - 1;
		const rendered = () => api.decorator.getState(editor)!.rendered;
		assert.ok(rendered().length > 0);
		assert.ok(rendered().every(r => r.start.line < lastLine / 2), 'formulas far below the visible area are decorated');

		// Scrolling to the end decorates the formulas there.
		editor.revealRange(new vscode.Range(lastLine, 0, lastLine, 0));
		await waitFor(() => rendered().some(r => r.start.line > lastLine - 10));
		assert.ok(rendered().every(r => r.start.line > lastLine / 2), 'formulas far above the visible area are still decorated');
	});

	test('moving the cursor and typing in a large document stay fast', async () => {
		const api = await activateExtension();
		const editor = await openEditor(largeDocument());
		api.decorator.update(editor);
		const cursor: number[] = [];
		for (let line = 0; line < 10; line += 2) {
			editor.selection = new vscode.Selection(line, 0, line, 0);
			cursor.push(time(() => api.decorator.update(editor)));
		}
		const worstCursor = Math.max(...cursor);
		assert.ok(worstCursor < MAX_UPDATE_MS, `moving the cursor took ${worstCursor.toFixed(0)} ms`);

		// The text before the first formula, so typing renders nothing new.
		await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'a'));
		const typing = time(() => api.decorator.update(editor));
		assert.ok(typing < MAX_UPDATE_MS, `updating after typing took ${typing.toFixed(0)} ms`);
	});
});

suite('Decorated lines', function () {
	this.timeout(60000);
	let api: MathInlineApi;
	let height: number;
	/** @brief Margen que se decora arriba y abajo de la zona visible (el mayor entre `MIN_WINDOW_MARGIN` y su alto). */
	let margin: number;

	suiteSetup(async () => {
		api = await activateExtension();
		height = await viewportLines();
		margin = Math.max(MIN_WINDOW_MARGIN, height);
	});

	teardown(closeActiveEditor);

	/**
	 * @brief Espera a que terminen las actualizaciones que dispara abrir un editor y lo actualiza una vez más.
	 *
	 * @param editor Editor recién abierto.
	 */
	const settleUpdates = async (editor: vscode.TextEditor) => {
		await settle(editor);
		await sleep(NO_UPDATE_WAIT_MS);
		api.decorator.update(editor);
	};

	/** @brief Primera y última línea con una fórmula renderizada, y cuántas hay. */
	const renderedLines = (editor: vscode.TextEditor) => {
		const lines = api.decorator.getState(editor)!.rendered.map(r => r.start.line);
		return { first: Math.min(...lines), last: Math.max(...lines), count: lines.length };
	};

	test('decorates the visible lines plus a margin above and below, nothing else', async () => {
		const editor = await openEditor(lineDocument());
		await scrollToFirstLine(editor, 500);
		api.decorator.update(editor);
		// One formula per line, from 500 - margin to 500 + height - 1 + margin.
		assert.deepStrictEqual(renderedLines(editor), { first: 500 - margin, last: 500 + height - 1 + margin, count: 2 * margin + height });
	});

	test('clips the decorated lines to the start of the document', async () => {
		const editor = await openEditor(lineDocument());
		await scrollToFirstLine(editor, 0);
		api.decorator.update(editor);
		assert.deepStrictEqual(renderedLines(editor), { first: 0, last: height - 1 + margin, count: height + margin });
	});

	test('decorates more formulas when scrolling down gets close to the end of the decorated lines', async () => {
		const editor = await openEditor(lineDocument());
		await scrollToFirstLine(editor, 500);
		api.decorator.update(editor);
		const before = api.decorator.getState(editor)!;
		const oldEnd = renderedLines(editor).last;
		// More than half a margin: the visible area ends up closer than that to the end of the decorated lines.
		const shift = Math.floor(margin / 2) + 5;
		await scrollToFirstLine(editor, 500 + shift);
		await waitFor(() => api.decorator.getState(editor) !== before);
		assert.ok(renderedLines(editor).last > oldEnd, 'the formulas after the old end are decorated');
	});

	test('decorates more formulas when scrolling up gets close to the start of the decorated lines', async () => {
		const editor = await openEditor(lineDocument());
		await scrollToFirstLine(editor, 500);
		api.decorator.update(editor);
		const before = api.decorator.getState(editor)!;
		const oldStart = renderedLines(editor).first;
		const shift = Math.floor(margin / 2) + 5;
		await scrollToFirstLine(editor, 500 - shift);
		await waitFor(() => api.decorator.getState(editor) !== before);
		assert.ok(renderedLines(editor).first < oldStart, 'the formulas before the old start are decorated');
	});

	test('does not update while the visible area stays far from the edges of the decorated lines', async () => {
		const editor = await openEditor(lineDocument());
		await scrollToFirstLine(editor, 500);
		api.decorator.update(editor);
		const before = api.decorator.getState(editor)!;
		await scrollToFirstLine(editor, 510);
		await sleep(NO_UPDATE_WAIT_MS);
		assert.strictEqual(api.decorator.getState(editor), before);
	});

	test('does not update when scrolling near the start of the document, where nothing more can be decorated', async () => {
		const editor = await openEditor(lineDocument());
		await scrollToFirstLine(editor, 0);
		await settleUpdates(editor);
		const before = api.decorator.getState(editor)!;
		await scrollToFirstLine(editor, 10);
		await sleep(NO_UPDATE_WAIT_MS);
		assert.strictEqual(api.decorator.getState(editor), before);
	});

	test('does not update when scrolling near the end of the document, where nothing more can be decorated', async () => {
		const editor = await openEditor(lineDocument());
		const lastFirst = DOCUMENT_LINES - height;
		await scrollToFirstLine(editor, lastFirst);
		api.decorator.update(editor);
		const before = api.decorator.getState(editor)!;
		await scrollToFirstLine(editor, lastFirst - 10);
		await sleep(NO_UPDATE_WAIT_MS);
		assert.strictEqual(api.decorator.getState(editor), before);
	});

	test('decorates everything in a document that fits in the decorated lines, without updates on scroll', async () => {
		// A few lines more than the screen: it scrolls, but the margin covers the whole document.
		const lines = Array.from({ length: height + 10 }, (_, i) => `Line ${i} $x_{${i}}$`);
		const editor = await openEditor(lines.join('\n'));
		await settleUpdates(editor);
		assert.deepStrictEqual(renderedLines(editor), { first: 0, last: height + 9, count: height + 10 });
		const before = api.decorator.getState(editor)!;
		await scrollToFirstLine(editor, 10);
		await sleep(NO_UPDATE_WAIT_MS);
		assert.strictEqual(api.decorator.getState(editor), before);
		assert.strictEqual(renderedLines(editor).count, height + 10);
	});

	suite('display blocks at the edges of the decorated lines', () => {
		// The block takes 6 lines from `start`; the decorated lines are `first - margin` to `first + height - 1 + margin`.
		const cases = [
			{ title: 'ends exactly on the first decorated line', first: 500, start: () => 500 - margin - 5, drawn: true },
			{ title: 'ends one line before the first decorated line', first: 500, start: () => 500 - margin - 6, drawn: false },
			{ title: 'crosses the first decorated line', first: 500, start: () => 500 - margin - 3, drawn: true },
			{ title: 'starts exactly on the last decorated line', first: 0, start: () => height - 1 + margin, drawn: true },
			{ title: 'starts one line after the last decorated line', first: 0, start: () => height + margin, drawn: false },
			{ title: 'crosses the last decorated line', first: 0, start: () => height - 3 + margin, drawn: true },
		];
		for (const { title, first, start, drawn } of cases) {
			test(`${drawn ? 'draws' : 'leaves as code'} a block that ${title}`, async () => {
				const line = start();
				const editor = await openEditor(lineDocument([{ line, text: TWO_ROW_BLOCK }]));
				await scrollToFirstLine(editor, first);
				api.decorator.update(editor);
				const blocks = api.decorator.getState(editor)!.blocks;
				assert.deepStrictEqual(blocks, drawn ? [new vscode.Range(line, 0, line + 5, 2)] : []);
			});
		}
	});

	test('keeps the last good render of a block when scrolling leaves the blocks above out of the decorated lines', async () => {
		// Block A (three rows) is the first block and B (two rows) the second; B's last good render is saved under its position among all blocks.
		const editor = await openEditor(lineDocument([{ line: 2, text: THREE_ROW_BLOCK }, { line: 10, text: TWO_ROW_BLOCK }]));
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor)!.blocks.length, 2);
		// Break the TeX of the row `d&=4\\` of B (line 12), with the cursor in it.
		await editor.edit(edit => edit.insert(new vscode.Position(12, 3), '\\frac{'));
		editor.selection = new vscode.Selection(12, 1, 12, 1);
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor)!.blocks.length, 2, 'B stays drawn with its last good render');

		// The decorated lines start on line 12: A (lines 2 to 8) is left out, B (lines 10 to 15) is not.
		await scrollToFirstLine(editor, margin + 12);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.blocks, [new vscode.Range(10, 0, 15, 2)]);
		assert.deepStrictEqual(state.errors.map(r => r.start.line), [12]);
	});

	test('does not count the folded lines as part of the visible height', async () => {
		// A block of 600 lines, folded by hand: the visible lines are the first ones and those after the fold.
		const block = { line: 5, text: ['$$', ...Array<string>(598).fill('x'), '$$'] };
		const editor = await openEditor(lineDocument([block]));
		api.decorator.update(editor);
		// Wait for the one-time cleanup of stale folds (it would undo the fold), then fold the block by hand.
		await sleep(900);
		try {
			await vscode.commands.executeCommand('editor.fold', { selectionLines: [5], levels: 1, direction: 'up' });
			await waitFor(() => !isVisible(editor, 6));
			await settle(editor);
			api.decorator.update(editor);
			const lines = api.decorator.getState(editor)!.rendered.map(r => r.start.line);
			assert.ok(lines.includes(606), 'a formula right after the fold is not decorated');
			assert.ok(!lines.includes(900), 'a formula far after the fold is decorated');
		} finally {
			await vscode.commands.executeCommand('editor.unfold', { selectionLines: [5], levels: 1, direction: 'up' });
		}
	});

	test('unfolds a block left folded far from the visible area', async () => {
		const editor = await openEditor(lineDocument([{ line: 600, text: TWO_ROW_BLOCK }]));
		await vscode.commands.executeCommand('editor.fold', { selectionLines: [600], levels: 1, direction: 'up' });
		await sleep(300);
		try {
			// A configuration change starts over the cleanup of the folds saved from before, as when the document opens in a new session.
			await setGlobalConfig('mathInline', 'scale', 1.01);
			await sleep(900);
			editor.revealRange(new vscode.Range(600, 0, 600, 0), vscode.TextEditorRevealType.AtTop);
			await settle(editor);
			assert.ok(isVisible(editor, 603), 'the stale fold was not undone');
		} finally {
			await setGlobalConfig('mathInline', 'scale', undefined);
		}
	});
});
