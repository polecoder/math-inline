import * as assert from 'assert';
import { findInlineMath } from '../parser';

function texts(source: string): string[] {
	return findInlineMath(source).map(s => s.tex);
}

suite('findInlineMath', () => {
	test('finds simple formulas with correct offsets', () => {
		const source = 'Let $x^2$ be.';
		const [span] = findInlineMath(source);
		assert.deepStrictEqual(span, { start: 4, end: 9, tex: 'x^2' });
		assert.strictEqual(source.slice(span.start, span.end), '$x^2$');
	});

	test('finds adjacent and multiple formulas', () => {
		assert.deepStrictEqual(texts('$a$$b$ and $c$'), []);
		assert.deepStrictEqual(texts('$a$ $b$, $c$'), ['a', 'b', 'c']);
	});

	test('ignores escaped dollars', () => {
		assert.deepStrictEqual(texts(String.raw`costs \$5 and \$6`), []);
		assert.deepStrictEqual(texts(String.raw`$a \$ b$`), [String.raw`a \$ b`]);
	});

	test('applies whitespace and digit rules', () => {
		assert.deepStrictEqual(texts('$5 and $10'), []);
		assert.deepStrictEqual(texts('$ x$'), []);
		assert.deepStrictEqual(texts('$x $'), []);
		assert.deepStrictEqual(texts('$x$1'), []);
		assert.deepStrictEqual(texts('$20,000 and $30,000'), []);
	});

	test('does not cross lines', () => {
		assert.deepStrictEqual(texts('$a\nb$'), []);
	});

	test('skips code spans and fenced code', () => {
		assert.deepStrictEqual(texts('`$a$` and $b$'), ['b']);
		assert.deepStrictEqual(texts('``x ` $a$`` $b$'), ['b']);
		assert.deepStrictEqual(texts('$5 and `$x$`'), []);
		assert.deepStrictEqual(texts('```\n$a$\n```\n$b$'), ['b']);
		assert.deepStrictEqual(texts('~~~~md\n$a$\n~~~\n$c$\n~~~~\n$b$'), ['b']);
	});

	test('skips indented code blocks', () => {
		assert.deepStrictEqual(texts('text\n\n    $a$\n    $b$\n\n$c$'), ['c']);
	});

	test('skips display math, inline and multi-line', () => {
		assert.deepStrictEqual(texts('$$x$$ and $y$'), ['y']);
		assert.deepStrictEqual(texts('$$\n$a$\n\\sum\n$$\n$b$'), ['b']);
	});

	test('handles CRLF line endings', () => {
		const source = 'a\r\n$x$\r\n';
		const [span] = findInlineMath(source);
		assert.strictEqual(source.slice(span.start, span.end), '$x$');
	});

	test('handles empty input', () => {
		assert.deepStrictEqual(findInlineMath(''), []);
		assert.deepStrictEqual(texts('$$'), []);
		assert.deepStrictEqual(texts('$'), []);
	});
});
