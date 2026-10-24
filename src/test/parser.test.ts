import * as assert from 'assert';
import { findInlineMath, findMath, isDisplayBlock, texLocation } from '../parser';

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

suite('findMath', () => {
	test('finds single-line display math with offsets', () => {
		const source = 'See $$x^2$$ and $y$.';
		const [display, inline] = findMath(source);
		assert.deepStrictEqual(display, { start: 4, end: 11, tex: 'x^2', display: true });
		assert.strictEqual(source.slice(display.start, display.end), '$$x^2$$');
		assert.deepStrictEqual(inline, { start: 16, end: 19, tex: 'y' });
	});

	test('finds multi-line display blocks', () => {
		const source = 'Intro\n$$\n\\int_0^1 x\\,dx\n$$\nafter $z$';
		const [block, inline] = findMath(source);
		assert.strictEqual(block.tex, '\n\\int_0^1 x\\,dx\n');
		assert.strictEqual(source.slice(block.start, block.end), '$$\n\\int_0^1 x\\,dx\n$$');
		assert.ok(isDisplayBlock(block));
		assert.strictEqual(inline.tex, 'z');
	});

	test('strips carriage returns from block TeX', () => {
		const [block] = findMath('$$\r\na\r\n$$\r\n');
		assert.strictEqual(block.tex, '\na\n');
	});

	test('drops unclosed, empty and blank-line-crossing blocks', () => {
		assert.deepStrictEqual(findMath('$$\na\n\nb\n$$'), []);
		assert.deepStrictEqual(findMath('$$\na'), []);
		assert.deepStrictEqual(findMath('$$ $$ and $$\n$$'), []);
	});

	test('ignores display math inside code', () => {
		assert.deepStrictEqual(findMath('```\n$$a$$\n```\n`$$b$$`'), []);
	});

	test('isDisplayBlock is false for inline and single-line display math', () => {
		assert.deepStrictEqual(findMath('$a$ $$b$$').map(isDisplayBlock), [false, false]);
	});
});

suite('texLocation', () => {
	/** @brief Bloque de un documento CRLF cuyo TeX empieza con un salto de línea y no conserva los `\r`. */
	const block = findMath('$$\r\n\\begin{aligned}\r\na&=1\\\\\r\nb\r\n\\end{aligned}\r\n$$')[0];

	test('locates offsets of an inline formula on line 0, relative to its TeX', () => {
		const span = findMath('a $xy$')[0];
		assert.deepStrictEqual(texLocation(span, 0), { line: 0, column: 0 });
		assert.deepStrictEqual(texLocation(span, 1), { line: 0, column: 1 });
		assert.deepStrictEqual(texLocation(span, span.tex.length), { line: 0, column: 2 });
	});

	test('keeps line 0 for offsets up to the first line break, inclusive', () => {
		const span = findMath('$$a\nb$$')[0];
		assert.strictEqual(span.tex, 'a\nb');
		assert.deepStrictEqual(texLocation(span, 1), { line: 0, column: 1 });
	});

	test('moves to the next line right after a line break', () => {
		const span = findMath('$$a\nbc$$')[0];
		assert.deepStrictEqual(texLocation(span, 2), { line: 1, column: 0 });
		assert.deepStrictEqual(texLocation(span, 3), { line: 1, column: 1 });
	});

	test('places a TeX that starts with a line break at line 0 for offset 0 and line 1 right after', () => {
		assert.strictEqual(block.tex[0], '\n');
		assert.deepStrictEqual(texLocation(block, 0), { line: 0, column: 0 });
		assert.deepStrictEqual(texLocation(block, 1), { line: 1, column: 0 });
	});

	test('counts lines without being shifted by the carriage returns of CRLF documents', () => {
		assert.ok(!block.tex.includes('\r'));
		assert.deepStrictEqual(texLocation(block, block.tex.indexOf('b\n')), { line: 3, column: 0 });
		assert.deepStrictEqual(texLocation(block, block.tex.indexOf('=')), { line: 2, column: 2 });
	});
});
