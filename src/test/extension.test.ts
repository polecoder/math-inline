import * as assert from 'assert';
import * as vscode from 'vscode';
import type { MathInlineApi } from '../extension';
import { isError, render } from '../renderer';

const EXTENSION_ID = 'polecoder.math-inline';

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
});

suite('MathDecorator', () => {
	let api: MathInlineApi;
	let editor: vscode.TextEditor;

	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: 'Intro line\nEuler: $e^{i\\pi}+1=0$ and $\\frac{a}{b}$.\nBroken: $\\frac{a$\n',
		});
		editor = await vscode.window.showTextDocument(document);
	});

	test('renders formulas and flags errors', () => {
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		api.decorator.update(editor);
		const state = api.decorator.getState(editor)!;
		assert.strictEqual(state.rendered.length, 2);
		assert.strictEqual(state.errors.length, 1);
		assert.strictEqual(state.revealed.length, 0);
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
