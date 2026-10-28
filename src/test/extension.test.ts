import * as assert from 'assert';
import * as vscode from 'vscode';
import type { MathInlineApi } from '../extension';
import { texPosition } from '../decorator';
import { katexProblem } from '../katex';
import { BIG_TEX, EXTENSION_ID, isVisible, openEditor, sleep } from './helpers';

/**
 * @brief Espera, consultando cada pocos milisegundos, a que se cumpla una condición.
 *
 * @param condition Condición a evaluar.
 * @param timeoutMs Tiempo máximo de espera.
 * @return Promesa que se resuelve cuando la condición se cumple, o falla al vencer el plazo.
 */
async function until(condition: () => boolean, timeoutMs = 4000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) {
			assert.fail('timed out waiting for a condition');
		}
		await sleep(20);
	}
}

/**
 * @brief Cambia una opción global de `mathInline`, ejecuta una acción y restaura la opción.
 *
 * @param key Nombre de la opción dentro de `mathInline`.
 * @param value Valor temporal.
 * @param action Acción a ejecutar con la opción cambiada.
 */
async function withSetting(key: string, value: unknown, action: () => Promise<void>): Promise<void> {
	const config = vscode.workspace.getConfiguration('mathInline');
	await config.update(key, value, vscode.ConfigurationTarget.Global);
	try {
		await action();
	} finally {
		await config.update(key, undefined, vscode.ConfigurationTarget.Global);
	}
}

/** @brief Bloque `$$` con una tabla `aligned` de tres filas, cada una en su línea (líneas 0 a 6, filas en 2, 3 y 4). */
const ALIGNED_BLOCK = '$$\n\\begin{aligned}\na&=1\\\\\nb&=2\\\\\nc&=3\n\\end{aligned}\n$$\n';

suite('mathInline.toggle', () => {
	test('switches between source and rendered math', async () => {
		const api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
		const editor = await openEditor('a $x$ and $y$\n');
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		await vscode.commands.executeCommand('mathInline.toggle');
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 0);

		await vscode.commands.executeCommand('mathInline.toggle');
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 2);
	});
});

suite('Display math blocks have no chip and no hover', () => {
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

	test('renders single-line $$ inline and draws multi-line blocks, never as a chip', () => {
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.strictEqual(state.rendered.length, 1);
		assert.deepStrictEqual(state.blocks.map(r => r.start.line), [1]);
		assert.deepStrictEqual(state.errors.map(r => r.start.line), [4]);
		assert.deepStrictEqual(state.collapsed, []);
	});

	test('provides a folding range per block', async () => {
		const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
			'vscode.executeFoldingRangeProvider', editor.document.uri);
		assert.ok(ranges.some(r => r.start === 1 && r.end === 3));
		assert.ok(ranges.some(r => r.start === 4 && r.end === 6));
	});
});

suite('Display math drawn in the editor', () => {
	let api: MathInlineApi;
	let editor: vscode.TextEditor;
	// Lines: 1-7 aligned block (rows on 3-5), 8-10 integral block.
	const content = 'Intro\n$$\n\\begin{aligned}\n&y\'+y\\cos x=0\\\\\n&\\iff\\\\\n&\\frac{y\'}{y}=-\\cos x\n\\end{aligned}\n$$\n'
		+ '$$\n\\int_0^1 x\\,dx\n$$\n';

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
		const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
		editor = await vscode.window.showTextDocument(document);
	});

	test('draws tables by rows and other blocks by bands', () => {
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.blocks.map(r => [r.start.line, r.end.line]), [[1, 7], [8, 10]]);
		assert.strictEqual(state.collapsed.length, 0);
		assert.strictEqual(state.revealed.length, 0);
		assert.ok(isVisible(editor, 4), 'drawn blocks are not folded');
	});

	test('reveals only the edited row and previews it at the end of the line', () => {
		editor.selection = new vscode.Selection(4, 1, 4, 1);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.strictEqual(state.blocks.length, 2);
		assert.deepStrictEqual(state.ghosts.map(r => r.start.line), [4]);
		assert.strictEqual(state.errors.length, 0);
	});

	test('keeps the last good rows while the TeX is broken', async () => {
		// Line 4 is `&\iff\\`: type an unclosed `\frac{` before its `\\`.
		await editor.edit(edit => edit.insert(new vscode.Position(4, 5), '\\frac{'));
		try {
			editor.selection = new vscode.Selection(4, 1, 4, 1);
			api.decorator.update(editor);
			const state = api.decorator.getState(editor)!;
			assert.strictEqual(state.blocks.length, 2, 'the block stays drawn');
			assert.deepStrictEqual(state.errors.map(r => r.start.line), [4]);
			assert.strictEqual(state.ghosts.length, 0);
		} finally {
			await vscode.commands.executeCommand('undo');
		}
	});

	test('unfolds blocks left folded from before once, then draws them', async function () {
		this.timeout(5000);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		await vscode.commands.executeCommand('editor.fold', { selectionLines: [1], levels: 1, direction: 'up' });
		await sleep(300);
		// A configuration change starts over, like opening the document in a new session.
		await vscode.workspace.getConfiguration('mathInline').update('scale', 1.01, vscode.ConfigurationTarget.Global);
		try {
			await sleep(900);
			assert.ok(isVisible(editor, 2), 'the stale fold was undone');
			api.decorator.update(editor);
			assert.deepStrictEqual(api.decorator.getState(editor)!.blocks.map(r => r.start.line), [1, 8]);
		} finally {
			await vscode.workspace.getConfiguration('mathInline').update('scale', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});

suite('Display math rows in CRLF documents', () => {
	test('places every row on its own line, not on the \\begin line', async () => {
		const api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
		const rows = ['&y\'-\\frac{2}{x}y=x^4\\\\', '&\\iff\\\\', '&C\'(x)=x^2\\\\', '&\\iff\\\\', '&\\int C\'(x)dx=\\int x^2dx\\\\', '&\\iff\\\\',
			'&C(x)+k_1=\\frac{x^3}{3}+k_2\\\\', '&\\iff\\\\', '&C(x)=\\frac{x^3}{3}+K\\\\', '&\\iff\\\\', '&y_P=\\frac{x^5}{3}'];
		const lines = ['Intro', '', '$$', '\\begin{aligned}', ...rows, '\\end{aligned}', '$$', ''];
		const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\r\n') });
		const editor = await vscode.window.showTextDocument(document);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		// Rows are on lines 4 to 14, one image each.
		assert.deepStrictEqual(state.rows.map(r => r.start.line), rows.map((_, i) => 4 + i));
		assert.ok(state.rows.every(r => document.lineAt(r.start.line).text.startsWith('&')));
	});
});

suite('KaTeX warnings', () => {
	test('warns about formulas that KaTeX cannot render, at the offending command', async () => {
		const api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: 'A $\\bbox[red]{x}$, fine $x^2$, broken $\\frac{a$\n$$\n\\bbox{y}\n$$\n',
		});
		api.katex.check(document);
		const diagnostics = api.katex.getDiagnostics(document.uri);
		assert.strictEqual(diagnostics.length, 2, 'TeX errors are left to the error underline');
		assert.ok(diagnostics.every(d => d.severity === vscode.DiagnosticSeverity.Warning));
		assert.deepStrictEqual(diagnostics[0].range, new vscode.Range(0, 3, 0, 8));
		assert.strictEqual(document.getText(diagnostics[1].range), '\\bbox');
	});
});

suite('Display math drawn in the editor: edge cases', () => {
	let api: MathInlineApi;

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
	});

	test('draws a table by rows at rest, with no revealed block', async () => {
		const editor = await openEditor(`Intro\n\n${ALIGNED_BLOCK}`);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.blocks, [new vscode.Range(2, 0, 8, 2)]);
		assert.deepStrictEqual([state.revealed, state.ghosts, state.errors, state.collapsed, state.unfolded], [[], [], [], [], []]);
	});

	test('keeps the text before the opening $$ outside the drawn block', async () => {
		const editor = await openEditor('Text $$\n\\begin{aligned}\na&=1\\\\\nb&=2\n\\end{aligned}\n$$ after\n');
		editor.selection = new vscode.Selection(1, 0, 1, 0);
		api.decorator.update(editor);
		let state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.blocks, [new vscode.Range(0, 5, 5, 2)]);
		assert.deepStrictEqual(state.revealed, [new vscode.Range(0, 5, 5, 2)]);
		assert.deepStrictEqual(state.ghosts, []);

		editor.selection = new vscode.Selection(3, 1, 3, 1);
		api.decorator.update(editor);
		state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.ghosts, [new vscode.Range(3, 4, 3, 4)]);
	});

	test('editing a delimiter line reveals the block but previews no row', async () => {
		const editor = await openEditor(ALIGNED_BLOCK);
		for (const line of [0, 1, 5, 6]) {
			editor.selection = new vscode.Selection(line, 0, line, 0);
			api.decorator.update(editor);
			const state = api.decorator.getState(editor)!;
			assert.strictEqual(state.blocks.length, 1, `line ${line}`);
			assert.strictEqual(state.revealed.length, 1, `line ${line}`);
			assert.deepStrictEqual(state.ghosts, [], `line ${line}`);
		}
	});

	test('a selection over several rows previews each of them', async () => {
		const editor = await openEditor(ALIGNED_BLOCK);
		editor.selection = new vscode.Selection(2, 1, 4, 1);
		api.decorator.update(editor);
		assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts.map(r => r.start.line), [2, 3, 4]);
	});

	test('several cursors preview one row each', async () => {
		const editor = await openEditor(ALIGNED_BLOCK);
		editor.selections = [new vscode.Selection(2, 1, 2, 1), new vscode.Selection(4, 1, 4, 1)];
		api.decorator.update(editor);
		assert.deepStrictEqual(api.decorator.getState(editor)!.ghosts.map(r => r.start.line), [2, 4]);
	});

	test('a block drawn in bands is revealed as a whole while it is edited', async () => {
		const editor = await openEditor('Intro\n\n$$\n\\int_0^1 x\\,dx\n$$\n');
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		let state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.blocks, [new vscode.Range(2, 0, 4, 2)]);
		assert.deepStrictEqual(state.revealed, []);

		editor.selection = new vscode.Selection(3, 2, 3, 2);
		api.decorator.update(editor);
		state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.blocks, [new vscode.Range(2, 0, 4, 2)]);
		assert.deepStrictEqual(state.revealed, [new vscode.Range(2, 0, 4, 2)]);
		assert.deepStrictEqual(state.ghosts, [], 'bands show no row preview');
	});

	test('underlines the whole block when its TeX is broken and the cursor is elsewhere', async () => {
		const editor = await openEditor('Intro\n\n$$\n\\begin{aligned}\na&=1\\\\\n\\frac{b\n\\end{aligned}\n$$\n');
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.errors, [new vscode.Range(2, 0, 7, 2)]);
		assert.deepStrictEqual(state.blocks, []);
		assert.deepStrictEqual(state.revealed, []);
	});

	test('reveals a block that was already broken when the cursor enters it', async () => {
		const editor = await openEditor('$$\n\\begin{aligned}\na&=1\\\\\n\\frac{b\n\\end{aligned}\n$$\n');
		editor.selection = new vscode.Selection(2, 1, 2, 1);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.revealed, [new vscode.Range(0, 0, 5, 2)]);
		assert.deepStrictEqual(state.errors, []);
		assert.deepStrictEqual(state.blocks, []);
	});

	test('draws every block of a document and keeps them independent', async () => {
		const editor = await openEditor(`${ALIGNED_BLOCK}\n$$\n\\int_0^1 x\\,dx\n$$\n\n${ALIGNED_BLOCK}`);
		editor.selection = new vscode.Selection(3, 1, 3, 1);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.blocks.map(r => r.start.line), [0, 8, 12]);
		assert.deepStrictEqual(state.revealed.map(r => r.start.line), [0]);
		assert.deepStrictEqual(state.ghosts.map(r => r.start.line), [3]);
	});

	test('draws nothing when the extension is disabled', async function () {
		this.timeout(10000);
		const editor = await openEditor(`Inline $x$\n\n${ALIGNED_BLOCK}`);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor)!.blocks.length, 1);
		await withSetting('enabled', false, async () => {
			await until(() => {
				api.decorator.update(editor);
				return api.decorator.getState(editor)!.blocks.length === 0;
			});
			const state = api.decorator.getState(editor)!;
			assert.deepStrictEqual([state.rendered, state.collapsed, state.errors, state.revealed, state.ghosts], [[], [], [], [], []]);
		});
		await until(() => {
			api.decorator.update(editor);
			return api.decorator.getState(editor)!.blocks.length === 1;
		});
	});

	test('ignores documents that are not Markdown', async () => {
		const editor = await openEditor(ALIGNED_BLOCK, 'plaintext');
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor), undefined);
	});

	test('ignores $$ blocks inside fenced code', async () => {
		const editor = await openEditor('```\n$$\n\\begin{aligned}\na\\\\\nb\n\\end{aligned}\n$$\n```\n');
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual([state.blocks, state.rendered, state.collapsed, state.errors], [[], [], [], []]);
	});
});

suite('MathDecorator.isLarge', () => {
	let api: MathInlineApi;
	let document: vscode.TextDocument;
	// Spans: inline, tall inline, single-line $$, rows block, bands block, broken block.
	const content = `Inline $x$ and $${BIG_TEX}$ and $$x+y$$\n\n${ALIGNED_BLOCK}\n$$\n\\int_0^1 x\\,dx\n$$\n\n$$\n\\frac{a\n$$\n`;

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
		document = (await openEditor(content)).document;
	});

	/**
	 * @brief Evalúa `isLarge` sobre todas las fórmulas del documento.
	 *
	 * @return Un booleano por fórmula, en orden de aparición.
	 */
	function largeFlags(): boolean[] {
		return api.decorator.getSpans(document).map(span => api.decorator.isLarge(span));
	}

	test('flags only tall inline formulas, never multi-line blocks', () => {
		assert.strictEqual(api.decorator.getSpans(document).length, 6);
		assert.deepStrictEqual(largeFlags(), [false, true, false, false, false, false]);
	});
});

suite('KaTeX warnings: edge cases', () => {
	let api: MathInlineApi;

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
	});

	test('katexProblem accepts what KaTeX renders', () => {
		assert.strictEqual(katexProblem({ start: 0, end: 5, tex: String.raw`\frac{a}{b}` }), undefined);
	});

	test('katexProblem reports the unsupported command with its position and length', () => {
		assert.deepStrictEqual(katexProblem({ start: 0, end: 12, tex: String.raw`x\bbox{y}` }),
			{ message: 'Undefined control sequence: \\bbox', position: 1, length: 5 });
	});

	test('katexProblem reports TeX syntax errors without the KaTeX prefix', () => {
		const problem = katexProblem({ start: 0, end: 8, tex: String.raw`\frac{a` });
		assert.ok(problem);
		assert.match(problem.message, /^Unexpected end of input/);
		assert.strictEqual(problem.position, 7);
		assert.strictEqual(problem.length, 0);
	});

	test('katexProblem reports each unsupported command at its own offset and length', () => {
		const cases: { tex: string; message: string; position: number; length: number }[] = [
			{ tex: String.raw`\foo`, message: 'Undefined control sequence: \\foo', position: 0, length: 4 },
			{ tex: String.raw`\ce{H2O}`, message: 'Undefined control sequence: \\ce', position: 0, length: 3 },
			{ tex: String.raw`\bbox[red]{x}`, message: 'Undefined control sequence: \\bbox', position: 0, length: 5 },
			{ tex: 'a^b^c', message: 'Double superscript', position: 3, length: 1 },
			{ tex: '}', message: "Expected 'EOF', got '}'", position: 0, length: 1 },
		];
		for (const { tex, message, position, length } of cases) {
			assert.deepStrictEqual(katexProblem({ start: 0, end: tex.length, tex }), { message, position, length }, tex);
		}
	});

	test('katexProblem accepts empty TeX and macros defined in the formula', () => {
		for (const tex of ['', String.raw`\newcommand{\f}{1}\f`, String.raw`\mathbb{R}`, String.raw`\color{red}x`]) {
			assert.strictEqual(katexProblem({ start: 0, end: tex.length, tex }), undefined, tex);
		}
	});

	test('katexProblem renders display-only environments only in display mode', () => {
		const tex = String.raw`\begin{align}a&b\end{align}`;
		assert.strictEqual(katexProblem({ start: 0, end: tex.length, tex, display: true }), undefined);
		for (const display of [false, undefined]) {
			const problem = katexProblem({ start: 0, end: tex.length, tex, display });
			assert.ok(problem);
			assert.strictEqual(problem.message, '{align} can be used only in display mode.');
		}
	});

	test('katexProblem reports no position and no length when KaTeX gives no token', () => {
		assert.deepStrictEqual(katexProblem({ start: 0, end: 10, tex: String.raw`\tag{1}x` }),
			{ message: '\\tag works only in display equations', position: undefined, length: 0 });
	});

	test('publishes warnings with the KaTeX explanation and the extension as source', async () => {
		const document = (await openEditor(String.raw`A $\bbox[red]{x}$ and $$\bbox{y}$$` + '\n')).document;
		api.katex.check(document);
		const diagnostics = api.katex.getDiagnostics(document.uri);
		assert.deepStrictEqual(diagnostics.map(d => document.getText(d.range)), ['\\bbox', '\\bbox']);
		for (const d of diagnostics) {
			assert.strictEqual(d.source, 'Math Inline');
			assert.strictEqual(d.message, "VS Code's Markdown preview (KaTeX) cannot render this formula: Undefined control sequence: \\bbox");
		}
	});

	test('underlines the whole formula when KaTeX reports no position', async () => {
		const document = (await openEditor(String.raw`A $\tag{1}x$ end` + '\n')).document;
		api.katex.check(document);
		const diagnostics = api.katex.getDiagnostics(document.uri);
		assert.deepStrictEqual(diagnostics.map(d => document.getText(d.range)), [String.raw`$\tag{1}x$`]);
		assert.match(diagnostics[0].message, /: \\tag works only in display equations$/);
	});

	test('publishes no warnings for formulas both engines render', async () => {
		const document = (await openEditor('Fine $x^2$ and\n$$\n\\begin{aligned}\na&=1\\\\\nb&=2\n\\end{aligned}\n$$\n')).document;
		api.katex.check(document);
		assert.deepStrictEqual(api.katex.getDiagnostics(document.uri), []);
	});

	test('clears the warnings when mathInline.katexWarnings is off', async function () {
		this.timeout(10000);
		const document = (await openEditor(String.raw`A $\bbox{x}$` + '\n')).document;
		api.katex.check(document);
		assert.strictEqual(api.katex.getDiagnostics(document.uri).length, 1);
		await withSetting('katexWarnings', false, async () => {
			await until(() => {
				api.katex.check(document);
				return api.katex.getDiagnostics(document.uri).length === 0;
			});
		});
		await until(() => {
			api.katex.check(document);
			return api.katex.getDiagnostics(document.uri).length === 1;
		});
	});

	test('clears the warnings when the extension is disabled', async function () {
		this.timeout(10000);
		const document = (await openEditor(String.raw`A $\bbox{x}$` + '\n')).document;
		api.katex.check(document);
		assert.strictEqual(api.katex.getDiagnostics(document.uri).length, 1);
		await withSetting('enabled', false, async () => {
			await until(() => {
				api.katex.check(document);
				return api.katex.getDiagnostics(document.uri).length === 0;
			});
		});
		await until(() => {
			api.katex.check(document);
			return api.katex.getDiagnostics(document.uri).length === 1;
		});
	});

	test('ignores documents that are not Markdown', async () => {
		const document = (await openEditor(String.raw`A $\bbox{x}$` + '\n', 'plaintext')).document;
		api.katex.check(document);
		assert.deepStrictEqual(api.katex.getDiagnostics(document.uri), []);
	});

	test('updates the warnings after the document changes', async function () {
		this.timeout(10000);
		const editor = await openEditor('Fine $x$\n');
		api.katex.check(editor.document);
		assert.deepStrictEqual(api.katex.getDiagnostics(editor.document.uri), []);
		await editor.edit(edit => edit.replace(new vscode.Range(0, 6, 0, 7), String.raw`\bbox{x}`));
		await until(() => api.katex.getDiagnostics(editor.document.uri).length === 1);
	});
});

suite('texPosition', () => {
	let api: MathInlineApi;

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
	});

	test('adds the width of the delimiter on the first line of an inline formula', async () => {
		const document = (await openEditor('ab $x+y$\n')).document;
		const span = api.decorator.getSpans(document)[0];
		assert.deepStrictEqual(texPosition(document, span, 0), new vscode.Position(0, 4));
		assert.deepStrictEqual(texPosition(document, span, 2), new vscode.Position(0, 6));
	});

	test('adds the width of $$ on the first line of a display formula, after any text before it', async () => {
		const document = (await openEditor('Text $$x+\ny$$\n')).document;
		const span = api.decorator.getSpans(document)[0];
		assert.deepStrictEqual(texPosition(document, span, 0), new vscode.Position(0, 7));
		assert.deepStrictEqual(texPosition(document, span, 2), new vscode.Position(0, 9));
	});

	for (const [name, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
		test(`maps TeX offsets on later lines to their own line and column in a ${name} document`, async () => {
			const content = ['Text', '$$', '\\begin{aligned}', 'a&=1\\\\', 'b&=2', '\\end{aligned}', '$$', ''].join(eol);
			const document = (await openEditor(content)).document;
			const span = api.decorator.getSpans(document)[0];
			assert.deepStrictEqual(texPosition(document, span, span.tex.indexOf('a&')), new vscode.Position(3, 0));
			assert.deepStrictEqual(texPosition(document, span, span.tex.indexOf('&=2')), new vscode.Position(4, 1));
			assert.deepStrictEqual(texPosition(document, span, span.tex.indexOf('\\end')), new vscode.Position(5, 0));
		});
	}
});

suite('Display math rows in CRLF documents: edge cases', () => {
	let api: MathInlineApi;
	/**
	 * @brief Convierte los saltos de línea de un texto a CRLF.
	 *
	 * @param text Texto con saltos `\n`.
	 * @return Texto con saltos `\r\n`.
	 */
	const crlf = (text: string) => text.replace(/\n/g, '\r\n');

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
	});

	test('keeps the rows on their lines when the $$ has text before it', async () => {
		const editor = await openEditor(crlf('Text $$\n\\begin{aligned}\na&=1\\\\\nb&=2\n\\end{aligned}\n$$ after\n'));
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.blocks, [new vscode.Range(0, 5, 5, 2)]);
		assert.deepStrictEqual(state.rows.map(r => r.start.line), [2, 3]);
	});

	test('previews the edited row on its own line', async () => {
		const editor = await openEditor(crlf(ALIGNED_BLOCK));
		editor.selection = new vscode.Selection(4, 1, 4, 1);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.ghosts, [new vscode.Range(4, 4, 4, 4)]);
		assert.deepStrictEqual(state.rows.map(r => r.start.line), [2, 3]);
	});

	test('underlines the edited line when the TeX of a CRLF block breaks', async () => {
		const editor = await openEditor(crlf(ALIGNED_BLOCK));
		editor.selection = new vscode.Selection(3, 1, 3, 1);
		api.decorator.update(editor);
		assert.strictEqual(api.decorator.getState(editor)!.errors.length, 0);
		await editor.edit(edit => edit.insert(new vscode.Position(3, 1), '\\frac{'));
		editor.selection = new vscode.Selection(3, 1, 3, 1);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.errors, [new vscode.Range(3, 0, 3, editor.document.lineAt(3).text.length)]);
		assert.strictEqual(state.blocks.length, 1, 'the block stays drawn with the last good rows');
		assert.deepStrictEqual(state.ghosts, []);
	});

	test('underlines the whole CRLF block when its TeX is broken and the cursor is elsewhere', async () => {
		const editor = await openEditor(crlf('Intro\n\n$$\n\\begin{aligned}\na&=1\\\\\n\\frac{b\n\\end{aligned}\n$$\n'));
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.errors, [new vscode.Range(2, 0, 7, 2)]);
		assert.deepStrictEqual([state.blocks, state.collapsed, state.unfolded], [[], [], []]);
	});

	test('places KaTeX warnings of a CRLF block exactly on the offending command', async () => {
		const document = (await openEditor(crlf('A $x$\n$$\n\\begin{aligned}\na&=1\\\\\nb&=\\bbox{y}\n\\end{aligned}\n$$\n'))).document;
		api.katex.check(document);
		const diagnostics = api.katex.getDiagnostics(document.uri);
		assert.strictEqual(diagnostics.length, 1);
		assert.strictEqual(document.getText(diagnostics[0].range), '\\bbox');
		assert.deepStrictEqual(diagnostics[0].range, new vscode.Range(4, 3, 4, 8));
	});
});

suite('Display math that cannot be drawn is shown as code', () => {
	let api: MathInlineApi;
	/** @brief Bloque de tres líneas con una matriz de 20 filas en una sola línea de contenido: no entra en franjas sin achicarse a menos de la mitad. */
	const tallBlock = `Intro\n\n$$\n\\begin{array}{c}${Array.from({ length: 20 }, (_, i) => i).join('\\\\')}\\end{array}\n$$\n`;

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
	});

	test('a block too tall for its lines is unfolded, not a chip', async () => {
		const editor = await openEditor(tallBlock);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.unfolded, [new vscode.Range(2, 0, 4, 2)]);
		assert.deepStrictEqual([state.collapsed, state.blocks, state.errors, state.revealed], [[], [], [], []]);
	});

	test('a block folded by hand is shown as code and not as a chip', async function () {
		this.timeout(10000);
		const editor = await openEditor(`Intro\n\n${ALIGNED_BLOCK}After\nMore\n`);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		await until(() => {
			api.decorator.update(editor);
			return api.decorator.getState(editor)!.blocks.length === 1;
		});
		// Wait for the one-time cleanup of stale folds (it would undo the fold), then fold the block by hand.
		await sleep(900);
		await vscode.commands.executeCommand('editor.fold', { selectionLines: [2], levels: 1, direction: 'up' });
		await until(() => isVisible(editor, 2) && !isVisible(editor, 3));
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.unfolded, [new vscode.Range(2, 0, 8, 2)]);
		assert.deepStrictEqual([state.collapsed, state.blocks, state.errors], [[], [], []]);
		await vscode.commands.executeCommand('editor.unfold', { selectionLines: [2], levels: 1, direction: 'up' });
	});

	test('a table block with a TeX error is underlined, not drawn by rows', async () => {
		const editor = await openEditor('Intro\n\n$$\n\\begin{aligned}\na&=\\unknownMacro\\\\\nb&=2\n\\end{aligned}\n$$\n');
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.errors, [new vscode.Range(2, 0, 7, 2)]);
		assert.deepStrictEqual([state.collapsed, state.unfolded, state.blocks, state.rows], [[], [], [], []]);
	});

	test('disabling the extension while stale folds are pending does not unfold a block folded by hand', async function () {
		this.timeout(15000);
		const editor = await openEditor(`Intro

${ALIGNED_BLOCK}After
More
`);
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		await until(() => {
			api.decorator.update(editor);
			return api.decorator.getState(editor)!.blocks.length === 1;
		});
		// Wait for the one-time cleanup of stale folds, then fold the block by hand.
		await sleep(900);
		await vscode.commands.executeCommand('editor.fold', { selectionLines: [2], levels: 1, direction: 'up' });
		await until(() => isVisible(editor, 2) && !isVisible(editor, 3));
		try {
			// A configuration change schedules the cleanup again; disabling right after must cancel its effect.
			await withSetting('scale', 1.01, async () => {
				await withSetting('enabled', false, async () => {
					await sleep(900);
					assert.ok(!isVisible(editor, 3), 'the fold made by hand is kept');
				});
			});
		} finally {
			await vscode.commands.executeCommand('editor.unfold', { selectionLines: [2], levels: 1, direction: 'up' });
		}
	});

	test('a block with invalid TeX is underlined, not a chip', async () => {
		const editor = await openEditor('Intro\n\n$$\n\\frac{a\n$$\n');
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.deepStrictEqual(state.errors, [new vscode.Range(2, 0, 4, 2)]);
		assert.deepStrictEqual([state.collapsed, state.unfolded, state.blocks], [[], [], []]);
	});
});
