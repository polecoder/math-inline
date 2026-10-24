import * as assert from 'assert';
import { layoutRows } from '../blockLayout';

/**
 * @brief Devuelve el texto de cada fila hallada por `layoutRows`, hasta el fin de su línea.
 *
 * @param tex TeX del bloque.
 * @return Comienzo de cada fila, o `undefined` si el bloque no se muestra por filas.
 */
function rowTexts(tex: string): string[] | undefined {
	return layoutRows(tex)?.map(offset => tex.slice(offset, tex.indexOf('\n', offset) === -1 ? undefined : tex.indexOf('\n', offset)));
}

suite('layoutRows', () => {
	test('finds one row per line in an aligned block', () => {
		const tex = '\n\\begin{aligned}\n&y=0\\\\\n&\\iff\\\\\n&\\frac{a}{b}=c\\\\\n\\end{aligned}\n';
		assert.deepStrictEqual(rowTexts(tex), ['&y=0\\\\', '&\\iff\\\\', '&\\frac{a}{b}=c\\\\']);
	});

	test('keeps the last row without a trailing \\\\', () => {
		assert.deepStrictEqual(rowTexts('\\begin{cases}\n1 & x>0\\\\\n0 & x\\le 0\n\\end{cases}'), ['1 & x>0\\\\', '0 & x\\le 0']);
	});

	test('skips environment arguments and the optional argument of \\\\', () => {
		assert.deepStrictEqual(rowTexts('\\begin{array}{c|c}\na & b\\\\[2pt]\nc & d\n\\end{array}'), ['a & b\\\\[2pt]', 'c & d']);
		assert.deepStrictEqual(rowTexts('\\begin{alignedat}{2}\na&=b\\\\\nc&=d\n\\end{alignedat}'), ['a&=b\\\\', 'c&=d']);
	});

	test('ignores \\\\ inside braces, nested environments and comments', () => {
		const tex = '\\begin{aligned}\n&\\text{a\\\\b} = \\begin{pmatrix}1\\\\2\\end{pmatrix}\\\\ % note \\\\\n&c\n\\end{aligned}';
		assert.strictEqual(layoutRows(tex)?.length, 2);
	});

	test('rejects blocks that are not a single row environment', () => {
		assert.strictEqual(layoutRows('\n\\int_0^1 x\\,dx\n'), undefined);
		assert.strictEqual(layoutRows('x = \\begin{cases}\n1\\\\\n2\n\\end{cases}'), undefined);
		assert.strictEqual(layoutRows('\\begin{aligned}\na\\\\\nb\n\\end{aligned} + c'), undefined);
		assert.strictEqual(layoutRows('\\begin{equation}\na\n\\end{equation}'), undefined);
		assert.strictEqual(layoutRows('\\begin{aligned}\na\\\\\nb'), undefined);
	});

	test('rejects rows sharing a line and empty rows in the middle', () => {
		assert.strictEqual(layoutRows('\\begin{aligned}\na\\\\ b\\\\\nc\n\\end{aligned}'), undefined);
		assert.strictEqual(layoutRows('\\begin{aligned}\na\\\\\n\\\\\nc\n\\end{aligned}'), undefined);
	});

	test('tolerant mode keeps rows apart around an unclosed brace', () => {
		const tex = '\\begin{aligned}\n&a\\\\\n&\\frac{b\\\\\n&c\n\\end{aligned}';
		assert.strictEqual(layoutRows(tex), undefined);
		assert.deepStrictEqual(layoutRows(tex, true)?.map(offset => tex.slice(offset, offset + 2)), ['&a', '&\\', '&c']);
	});

	test('accepts a first row on the \\begin line', () => {
		assert.deepStrictEqual(rowTexts('\\begin{aligned} a\\\\\nb\\end{aligned}'), ['a\\\\', 'b\\end{aligned}']);
	});

	test('finds rows in CRLF text', () => {
		const tex = '\r\n\\begin{aligned}\r\nalpha\\\\\r\nbeta\\\\\r\ngamma\r\n\\end{aligned}\r\n';
		assert.deepStrictEqual(layoutRows(tex), [tex.indexOf('alpha'), tex.indexOf('beta'), tex.indexOf('gamma')]);
		assert.deepStrictEqual(layoutRows(tex, true), [tex.indexOf('alpha'), tex.indexOf('beta'), tex.indexOf('gamma')]);
	});

	test('drops an empty last row left by a trailing \\\\ followed by spaces or a comment', () => {
		for (const trailing of ['', '  ', ' % end', '\t% \\\\']) {
			const tex = `\\begin{aligned}\nX\\\\\nY\\\\${trailing}\n\\end{aligned}`;
			assert.deepStrictEqual(layoutRows(tex), [tex.indexOf('X'), tex.indexOf('Y')], JSON.stringify(trailing));
		}
	});

	test('skips environment arguments with nested braces', () => {
		const tex = '\\begin{array}{@{}c|{c}@{}}\nX & b\\\\\nY & d\n\\end{array}';
		assert.deepStrictEqual(layoutRows(tex), [tex.indexOf('X'), tex.indexOf('Y')]);
		const bars = '\\begin{array}{|c|}\nX\\\\\nY\n\\end{array}';
		assert.deepStrictEqual(layoutRows(bars), [bars.indexOf('X'), bars.indexOf('Y')]);
	});

	test('treats an escaped brace in the arguments as plain text', () => {
		const tex = '\\begin{array}{c\\}c}\nX\\\\\nY\n\\end{array}';
		assert.deepStrictEqual(layoutRows(tex), [tex.indexOf('X'), tex.indexOf('Y')]);
	});

	test('accepts starred environments only when they are listed', () => {
		assert.strictEqual(layoutRows('\\begin{align*}\na&=1\\\\\nb&=2\n\\end{align*}')?.length, 2);
		assert.strictEqual(layoutRows('\\begin{gather*}\na\\\\\nb\n\\end{gather*}')?.length, 2);
		assert.strictEqual(layoutRows('\\begin{aligned*}\na\\\\\nb\n\\end{aligned*}'), undefined);
		assert.strictEqual(layoutRows('\\begin{align}\na\\\\\nb\n\\end{align}'), undefined);
	});

	test('rejects an \\end of a different environment, even a starred twin', () => {
		assert.strictEqual(layoutRows('\\begin{aligned}\na\\\\\nb\n\\end{cases}'), undefined);
		assert.strictEqual(layoutRows('\\begin{align*}\na\\\\\nb\n\\end{align}'), undefined);
	});

	test('rejects text after the closing \\end', () => {
		assert.strictEqual(layoutRows('\\begin{aligned}\na\\\\\nb\n\\end{aligned}\\tag{1}'), undefined);
	});

	test('ignores a % comment that holds the closing \\end', () => {
		assert.strictEqual(layoutRows('\\begin{aligned}\na\\\\\nb % \\end{aligned}'), undefined);
	});

	test('does not split rows on \\\\ inside braces unless tolerant and at the end of a line', () => {
		const tex = '\\begin{aligned}\n{X\\\\\nY}\n\\end{aligned}';
		assert.deepStrictEqual(layoutRows(tex), [tex.indexOf('{X')]);
		assert.deepStrictEqual(layoutRows(tex, true), [tex.indexOf('{X'), tex.indexOf('Y}')]);
	});

	test('tolerant mode accepts an \\end with unbalanced braces but strict mode does not', () => {
		const tex = '\\begin{aligned}\nX\\\\\n{Y\n\\end{aligned}';
		assert.strictEqual(layoutRows(tex), undefined);
		assert.deepStrictEqual(layoutRows(tex, true), [tex.indexOf('X'), tex.indexOf('{Y')]);
	});

	test('accepts every row environment with its own name', () => {
		for (const env of ['aligned', 'gathered', 'split', 'cases', 'rcases', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix',
			'smallmatrix', 'align*', 'alignat*', 'flalign*']) {
			assert.strictEqual(layoutRows(`\\begin{${env}}\na\\\\\nb\n\\end{${env}}`)?.length, 2, env);
		}
	});

	test('keeps a single-row table on one line', () => {
		assert.deepStrictEqual(layoutRows('\\begin{pmatrix}a&b\\end{pmatrix}'), [15]);
	});

	test('rejects an empty environment', () => {
		assert.strictEqual(layoutRows('\\begin{aligned}\\end{aligned}'), undefined);
		assert.strictEqual(layoutRows('\\begin{aligned}\n  \n\\end{aligned}'), undefined);
	});
});
