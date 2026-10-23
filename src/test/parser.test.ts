import * as assert from 'assert';
import { findInlineMath } from '../parser';

/**
 * @brief Extrae solo el TeX de cada fórmula inline encontrada.
 *
 * @param source Texto Markdown a analizar.
 * @return Fuentes TeX de las fórmulas, en orden de aparición.
 */
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

	test('treats an unclosed backtick run as literal text', () => {
		assert.deepStrictEqual(texts('`a $x$'), ['x']);
		assert.deepStrictEqual(texts('``a ` $x$'), ['x']);
	});

	test('does not close a code span on a longer backtick run', () => {
		assert.deepStrictEqual(texts('`` a ``` $x$ `` $y$'), ['y']);
		assert.deepStrictEqual(texts('`` a ``` $x$'), ['x']);
	});

	test('does not let math close inside a code span', () => {
		assert.deepStrictEqual(texts('$a `b$` c'), []);
	});

	test('does not accept `$$` as the closer of an inline formula', () => {
		assert.deepStrictEqual(texts('$a$$'), []);
	});

	test('keeps a trailing escaped backslash before the closing dollar', () => {
		assert.deepStrictEqual(texts(String.raw`$a\\$ b`), [String.raw`a\\`]);
	});

	test('only closes a fence with the same character, enough length and no info string', () => {
		assert.deepStrictEqual(texts('```\n$a$\n~~~\n$b$\n``` x\n$c$\n```\n$d$'), ['d']);
	});

	test('does not start a fence inside display math', () => {
		assert.deepStrictEqual(texts('$$\n```\n$$\n$a$'), ['a']);
	});

	test('does not treat an indented line right after text as code', () => {
		assert.deepStrictEqual(texts('text\n    $a$'), ['a']);
	});

	test('reports offsets on later lines and with CRLF', () => {
		const source = 'x\r\n\r\ny $a$\r\n';
		const [span] = findInlineMath(source);
		assert.deepStrictEqual(span, { start: 7, end: 10, tex: 'a' });
	});

	test('handles empty input', () => {
		assert.deepStrictEqual(findInlineMath(''), []);
		assert.deepStrictEqual(texts('$$'), []);
		assert.deepStrictEqual(texts('$'), []);
	});
});
