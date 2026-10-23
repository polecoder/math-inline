import * as assert from 'assert';
import * as vscode from 'vscode';
import type { MathInlineApi } from '../extension';
import { isError, render } from '../renderer';
import { previewMarkdown } from '../hover';

/** @brief Identificador de la extensión (`publisher.name`) usado para activarla en los tests. */
const EXTENSION_ID = 'polecoder.math-inline';
/** @brief Fórmula demasiado alta para mostrarse inline. */
const BIG_TEX = String.raw`\left[\overline{X}_n\pm\dfrac{\sqrt{\overline{X}_n(1-\overline{X}_n)}\,z_{\alpha/2}}{\sqrt n}\right]`;

/**
 * @brief Espera la cantidad de milisegundos indicada.
 *
 * @param ms Milisegundos a esperar.
 * @return Promesa que se resuelve pasado ese tiempo.
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @brief Indica si una línea está dentro de las zonas visibles del editor (no plegada ni fuera de pantalla).
 *
 * @param editor Editor consultado.
 * @param line Número de línea.
 * @return `true` si alguna zona visible contiene la línea.
 */
function isVisible(editor: vscode.TextEditor, line: number): boolean {
	return editor.visibleRanges.some(r => r.start.line <= line && line <= r.end.line);
}

suite('renderer', () => {
	test('renders valid TeX to a sized SVG data URI', () => {
		const result = render(String.raw`\frac{a}{b}`, { color: '#ff0000', exPx: 7 });
		assert.ok(!isError(result));
		assert.ok(result.uri.startsWith('data:image/svg+xml;base64,'));
		assert.ok(result.width > 0 && result.height > 0);
		const svg = Buffer.from(result.uri.split(',')[1], 'base64').toString();
		assert.ok(svg.includes('#ff0000'));
		assert.ok(!svg.includes('currentColor'));
	});

	test('reports TeX errors', () => {
		const result = render(String.raw`\frac{a`, { color: '#000', exPx: 7 });
		assert.ok(isError(result));
		assert.match(result.error, /brace/i);
	});

	test('shrinks tall formulas to maxHeight keeping the aspect ratio', () => {
		const tex = String.raw`\left[\dfrac{\sqrt{a}}{b}\right]`;
		const full = render(tex, { color: '#000', exPx: 7 });
		const fitted = render(tex, { color: '#000', exPx: 7, maxHeight: 19 });
		assert.ok(!isError(full) && !isError(fitted));
		assert.ok(full.height > 19);
		assert.strictEqual(fitted.height, 19);
		assert.ok(Math.abs(fitted.width / fitted.height - full.width / full.height) < 0.05);
	});

	test('leaves formulas within maxHeight untouched', () => {
		const full = render('x', { color: '#000', exPx: 7 });
		const fitted = render('x', { color: '#000', exPx: 7, maxHeight: 19 });
		assert.deepStrictEqual(fitted, full);
		assert.ok(!isError(fitted) && fitted.fit === 1);
	});

	test('reports the shrink factor applied by maxHeight', () => {
		const fitted = render(String.raw`\dfrac{\sqrt{a}}{b}`, { color: '#000', exPx: 7, maxHeight: 10 });
		assert.ok(!isError(fitted));
		assert.ok(fitted.fit > 0 && fitted.fit < 1);
	});

	test('textStyle renders display fractions smaller', () => {
		const tex = String.raw`\dfrac{a}{b}`;
		const display = render(tex, { color: '#000', exPx: 7 });
		const text = render(tex, { color: '#000', exPx: 7, textStyle: true });
		assert.ok(!isError(display) && !isError(text));
		assert.ok(text.height < display.height);
	});
});

suite('MathDecorator', () => {
	let api: MathInlineApi;
	let editor: vscode.TextEditor;

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: 'Intro line\nEuler: $e^{i\\pi}+1=0$ and $\\frac{a}{b}$.\nBroken: $\\frac{a$\n'
				+ `Big: $${BIG_TEX}$\n`,
		});
		editor = await vscode.window.showTextDocument(document);
	});

	test('renders formulas and flags errors', () => {
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.strictEqual(state.rendered.length, 2);
		assert.strictEqual(state.collapsed.length, 1);
		assert.strictEqual(state.errors.length, 1);
		assert.strictEqual(state.revealed.length, 0);
	});

	test('shows the big formula in a display-mode hover', async () => {
		const big = api.decorator.getState(editor)!.collapsed[0];
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider', editor.document.uri, big.start.translate(0, 3));
		const contents = hovers.flatMap(h => h.contents).map(c => (c as vscode.MarkdownString).value ?? '');
		assert.ok(contents.some(c => c.includes('data:image/svg+xml')));
	});

	test('hovering the chip lands on its visible opening `$`', async () => {
		const big = api.decorator.getState(editor)!.collapsed[0];
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider', editor.document.uri, big.start);
		const images = hovers.flatMap(h => h.contents).map(c => (c as vscode.MarkdownString).value ?? '')
			.filter(c => c.includes('data:image/svg+xml'));
		assert.strictEqual(images.length, 1);
	});

	test('reveals the formula under the cursor', () => {
		const first = api.decorator.getState(editor)!.rendered[0];
		editor.selection = new vscode.Selection(first.start.translate(0, 2), first.start.translate(0, 2));
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.strictEqual(state.rendered.length, 1);
		assert.strictEqual(state.revealed.length, 1);
		assert.ok(state.revealed[0].isEqual(first));
	});

	test('toggle command switches between source and rendered math', async () => {
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		await vscode.commands.executeCommand('mathInline.toggle');
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 0);

		await vscode.commands.executeCommand('mathInline.toggle');
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 2);
	});
});

suite('Display math', () => {
	let api: MathInlineApi;
	let editor: vscode.TextEditor;

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: 'Single line: $$x+y$$\n$$\n\\int_0^1 x\\,dx\n$$\n$$\n\\frac{a\n$$\n',
		});
		editor = await vscode.window.showTextDocument(document);
	});

	test('renders single-line $$ inline and folds multi-line blocks into a chip', async function () {
		this.timeout(5000);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		await sleep(1000);
		const state = api.decorator.getState(editor)!;
		assert.strictEqual(state.rendered.length, 1);
		assert.strictEqual(state.collapsed.length, 1);
		assert.strictEqual(state.collapsed[0].start.line, 1);
		assert.strictEqual(state.collapsed[0].end.line, 3);
		assert.strictEqual(state.errors.length, 1);
		assert.ok(isVisible(editor, 1), 'the chip line stays visible');
		assert.ok(!isVisible(editor, 2), 'the block body is folded');
		assert.ok(isVisible(editor, 5), 'a block with a TeX error is not folded');
	});

	test('unfolding a block by hand replaces its chip with the TeX', async () => {
		await vscode.commands.executeCommand('editor.unfold', { selectionLines: [1], levels: 1, direction: 'up' });
		await sleep(300);
		const state = api.decorator.getState(editor)!;
		assert.ok(isVisible(editor, 2));
		assert.strictEqual(state.collapsed.length, 0);
		assert.strictEqual(state.unfolded.length, 1);
		assert.strictEqual(state.unfolded[0].start.line, 1);
	});

	test('reveals a block when the cursor is on one of its lines', () => {
		editor.selection = new vscode.Selection(2, 0, 2, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.strictEqual(state.collapsed.length, 0);
		assert.strictEqual(state.revealed.length, 1);
		assert.strictEqual(state.revealed[0].start.line, 1);
	});

	test('hovering any line of a block shows its preview', async () => {
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider', editor.document.uri, new vscode.Position(2, 3));
		const contents = hovers.flatMap(h => h.contents).map(c => (c as vscode.MarkdownString).value ?? '');
		assert.ok(contents.some(c => c.includes('data:image/svg+xml')));
	});

	test('unfolds the block under the cursor', async function () {
		this.timeout(5000);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		await vscode.commands.executeCommand('editor.fold', { selectionLines: [1], levels: 1, direction: 'up' });
		await sleep(300);
		assert.ok(!isVisible(editor, 2));

		editor.selection = new vscode.Selection(1, 1, 1, 1);
		api.decorator.update(editor);
		await sleep(300);
		assert.ok(isVisible(editor, 2), 'the block under the cursor is unfolded');
	});

	test('previews long blocks within the hover size limit', () => {
		const aligned = (count: number) => '\\begin{aligned}' + Array.from({ length: count },
			(_, i) => String.raw`&\int_0^{${i}} \frac{\sin x}{x}\,dx = \sum_{k=0}^{\infty} a_k\\`).join('\n') + '\\end{aligned}';
		const options = api.decorator.renderOptions(1.5);

		const long = previewMarkdown(aligned(20), options);
		assert.ok(long);
		assert.ok(long.value.startsWith('![math](data:image/svg+xml;base64,'));
		assert.ok(long.value.length <= 100_000, `hover Markdown is ${long.value.length} characters long`);

		// Past VS Code's limit the data URI would be cut and shown as text, so a notice is shown instead.
		const huge = previewMarkdown(aligned(200), options);
		assert.ok(huge && !huge.value.includes('data:'));
	});

	test('provides a folding range per block', async () => {
		const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
			'vscode.executeFoldingRangeProvider', editor.document.uri);
		assert.ok(ranges.some(r => r.start === 1 && r.end === 3));
		assert.ok(ranges.some(r => r.start === 4 && r.end === 6));
	});
});
