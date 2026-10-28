import * as assert from 'assert';
import * as vscode from 'vscode';
import { MathHoverProvider, previewMarkdown } from '../hover';
import type { MathInlineApi } from '../extension';
import { activateExtension, openEditor } from './helpers';

suite('previewMarkdown', () => {
	const options = { color: '#123456', exPx: 7 };

	test('returns undefined for invalid TeX', () => {
		assert.strictEqual(previewMarkdown(String.raw`\frac{a`, options), undefined);
	});

	test('previews long blocks within the hover size limit', () => {
		const aligned = (count: number) => '\\begin{aligned}' + Array.from({ length: count },
			(_, i) => String.raw`&\int_0^{${i}} \frac{\sin x}{x}\,dx = \sum_{k=0}^{\infty} a_k\\`).join('\n') + '\\end{aligned}';

		const long = previewMarkdown(aligned(20), options);
		assert.ok(long);
		assert.ok(long.value.startsWith('![math](data:image/svg+xml;base64,'));
		assert.ok(long.value.length <= 100_000, `hover Markdown is ${long.value.length} characters long`);

		// Past VS Code's limit the data URI would be cut and shown as text, so a notice is shown instead.
		const huge = previewMarkdown(aligned(200), options);
		assert.ok(huge && !huge.value.includes('data:'));
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

	test('covers the whole `$...$` range of the formula', () => {
		const start = document.positionAt(7);
		const hover = provider.provideHover(document, start)!;
		assert.ok(hover);
		assert.deepStrictEqual(hover.range, new vscode.Range(start, document.positionAt(7 + '$e^{i\\pi}+1=0$'.length)));
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

suite('MathHoverProvider: display blocks', () => {
	let provider: MathHoverProvider;
	let document: vscode.TextDocument;

	suiteSetup(async () => {
		const api = await activateExtension();
		provider = new MathHoverProvider(api.decorator);
		document = (await openEditor('One $$x+y$$ line\n$$\n\\int_0^1 x\\,dx\n$$\n$$\n\\frac{a\n$$\n')).document;
	});

	test('returns undefined on every line of a multi-line block, even a broken one', () => {
		for (const position of [new vscode.Position(1, 1), new vscode.Position(2, 3), new vscode.Position(3, 1), new vscode.Position(5, 2)]) {
			assert.strictEqual(provider.provideHover(document, position), undefined, `line ${position.line}`);
		}
	});

	test('still returns the preview of a single-line $$ formula', () => {
		const hover = provider.provideHover(document, new vscode.Position(0, 7))!;
		assert.ok(hover);
		assert.deepStrictEqual(hover.range, new vscode.Range(0, 4, 0, 11));
	});
});
