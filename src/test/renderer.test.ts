import * as assert from 'assert';
import { isError, render, renderBands, renderRows } from '../renderer';

suite('renderer', () => {
	const options = { color: '#000', exPx: 7 };

	test('reports TeX errors', () => {
		const result = render(String.raw`\frac{a`, options);
		assert.ok(isError(result));
		assert.match(result.error, /brace/i);
	});

	test('renders empty TeX without throwing', () => {
		assert.ok(!isError(render('', options)));
	});

	test('rejects packages that would hide errors or load code', () => {
		for (const tex of [String.raw`\require{amsmath}`, String.raw`\undefinedmacro`]) {
			assert.ok(isError(render(tex, options)), tex);
		}
	});

	test('escapes XML special characters in the color', () => {
		const result = render('x', { color: 'a"<&>\'b', exPx: 7 });
		assert.ok(!isError(result));
		const svg = Buffer.from(result.uri.split(',')[1], 'base64').toString();
		assert.ok(svg.includes('a&#34;&#60;&#38;&#62;&#39;b'));
	});

	test('textStyle rewrites \\dbinom but leaves longer control sequences alone', () => {
		assert.deepStrictEqual(render(String.raw`\dbinom{n}{k}`, { ...options, textStyle: true }), render(String.raw`\binom{n}{k}`, options));
		const longer = render(String.raw`\dfracx`, { ...options, textStyle: true });
		assert.ok(isError(longer));
		assert.match(longer.error, /undefined control sequence/i);
	});

	test('renderRows does not split formulas that are not a single table', () => {
		const fitted = { ...options, maxHeight: 19 };
		assert.strictEqual(renderRows(String.raw`x = \begin{cases}1\\2\end{cases}`, fitted), undefined);
		assert.strictEqual(renderRows(String.raw`\int_0^1 x\,dx`, fitted), undefined);
	});

	// Regression: the brace of `cases` is taller than its table and shifts it, which used to make renderRows give up.
	test('renderRows splits a cases environment into one image per row', () => {
		const rows = renderRows(String.raw`\begin{cases}1 & x>0\\ 0 & x<0\end{cases}`, { ...options, maxHeight: 19, textStyle: true });
		assert.ok(Array.isArray(rows));
		assert.strictEqual(rows.length, 2);
	});

	test('renderRows reports the TeX error of an invalid table', () => {
		const result = renderRows(String.raw`\begin{aligned}\unknownMacro\end{aligned}`, options);
		assert.ok(result && !Array.isArray(result) && isError(result));
		assert.match(result.error, /undefined control sequence/i);
	});

	test('renderBands reports TeX errors', () => {
		const result = renderBands(String.raw`\frac{a`, { ...options, maxHeight: 19 }, 3);
		assert.ok(isError(result));
		assert.match(result.error, /brace/i);
	});
});
