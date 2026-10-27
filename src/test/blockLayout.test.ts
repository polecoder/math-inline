import * as assert from 'assert';
import { blockScale, inlineRoom, layoutRows, wrapSafeRoom } from '../blockLayout';

/**
 * @brief Calcula el espacio libre de una fórmula en un documento descripto por sus líneas libres.
 *
 * @param free Una cadena por línea del documento: `.` es una línea libre y cualquier otro carácter, una con contenido.
 * @param first Primera línea de la fórmula.
 * @param last Última línea de la fórmula.
 * @return Resultado de `inlineRoom`.
 */
function roomIn(free: string, first: number, last = first): { up: number; down: number } {
	return inlineRoom(first, last, free.length, line => free[line] === '.');
}

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

/**
 * @brief Verifica que dos números coincidan salvo errores de redondeo.
 *
 * @param actual Valor obtenido.
 * @param expected Valor esperado.
 */
function assertClose(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected} but got ${actual}`);
}

suite('blockScale', () => {
	const LINE = 20;

	test('returns 1 when there are no rows', () => {
		assert.strictEqual(blockScale([], { rowLines: [], lines: 3, axis: 0 }, LINE), 1);
	});

	test('returns 1 when every row fits at full size', () => {
		const rows = [{ height: 10, depth: 4 }, { height: 12, depth: 3 }];
		assert.strictEqual(blockScale(rows, { rowLines: [1, 2], lines: 4, axis: 3 }, LINE), 1);
	});

	test('limits a single row by the space above its line', () => {
		// Space above: 0.5 * 20 + 5 = 15 px for a 30 px tall row.
		assertClose(blockScale([{ height: 30, depth: 0 }], { rowLines: [0], lines: 1, axis: 5 }, LINE), 0.5);
	});

	test('limits a single row by the space below its line', () => {
		// Space below: 0.5 * 20 - 5 = 5 px for a 10 px deep row.
		assertClose(blockScale([{ height: 10, depth: 10 }], { rowLines: [0], lines: 1, axis: 5 }, LINE), 0.5);
	});

	test('uses the free lines above and below a row in the middle of the block', () => {
		const layout = { rowLines: [2], lines: 5, axis: 0 };
		// 2.5 lines above and below: 50 px.
		assert.strictEqual(blockScale([{ height: 50, depth: 50 }], layout, LINE), 1);
		assertClose(blockScale([{ height: 100, depth: 10 }], layout, LINE), 0.5);
		assertClose(blockScale([{ height: 10, depth: 200 }], layout, LINE), 0.25);
	});

	test('moves the space between the block edges with the axis', () => {
		const rows = [{ height: 40, depth: 40 }];
		const centered = blockScale(rows, { rowLines: [1], lines: 3, axis: 0 }, LINE);
		const raised = blockScale(rows, { rowLines: [1], lines: 3, axis: 4 }, LINE);
		// Above: 30 + axis, below: 30 - axis; the smaller one rules.
		assertClose(centered, 30 / 40);
		assertClose(raised, 26 / 40);
	});

	test('separates consecutive rows by the depth of one and the height of the next', () => {
		// Rows on lines 1 and 3 leave 2 * 20 = 40 px between their baselines.
		const layout = { rowLines: [1, 3], lines: 5, axis: 0 };
		assert.strictEqual(blockScale([{ height: 10, depth: 18 }, { height: 20, depth: 5 }], layout, LINE), 1);
		assertClose(blockScale([{ height: 10, depth: 5 }, { height: 55, depth: 5 }], layout, LINE), 40 / 60);
	});

	test('rows on adjacent lines get only the line height minus the gap', () => {
		const layout = { rowLines: [1, 2], lines: 4, axis: 0 };
		assertClose(blockScale([{ height: 5, depth: 9 }, { height: 18, depth: 5 }], layout, LINE), 20 / 27);
	});

	test('the axis does not change the space between consecutive rows', () => {
		const rows = [{ height: 5, depth: 9 }, { height: 18, depth: 5 }];
		const scales = [0, 3, 8].map(axis => blockScale(rows, { rowLines: [1, 2], lines: 4, axis }, LINE));
		assert.deepStrictEqual(scales, [scales[0], scales[0], scales[0]]);
	});

	test('takes the most restrictive limit among all rows', () => {
		const layout = { rowLines: [1, 2, 4], lines: 6, axis: 0 };
		const rows = [{ height: 10, depth: 12 }, { height: 10, depth: 12 }, { height: 10, depth: 12 }];
		// Rows 0-1 have 20 px for 22 px of ink; rows 1-2 have 40 px for 22 px.
		assertClose(blockScale(rows, layout, LINE), 20 / 22);
	});

	test('ignores rows whose extent is zero or negative', () => {
		const layout = { rowLines: [0, 1], lines: 2, axis: 0 };
		assert.strictEqual(blockScale([{ height: -3, depth: -3 }, { height: 0, depth: 0 }], layout, LINE), 1);
		// A row that rises above its baseline (negative depth) leaves room to the next one.
		assert.strictEqual(blockScale([{ height: 0, depth: -50 }, { height: 36, depth: 0 }], layout, LINE), 1);
		assertClose(blockScale([{ height: 0, depth: -10 }, { height: 36, depth: 0 }], layout, LINE), 20 / 26);
	});

	test('returns 0 when there is no space at all', () => {
		// Space below: 0.5 * 20 - 12 < 0.
		assert.strictEqual(blockScale([{ height: 1, depth: 1 }], { rowLines: [0], lines: 1, axis: 12 }, LINE), 0);
	});
});

suite('inlineRoom', () => {
	test('is 0 above and below when the neighbour lines have content', () => {
		assert.deepStrictEqual(roomIn('xFx', 1), { up: 0, down: 0 });
	});

	test('splits in half a run of free lines shared with a line that has content', () => {
		assert.deepStrictEqual(roomIn('x..F...x', 3), { up: 1, down: 1.5 });
	});

	test('keeps a single free line between two lines with content as half a line', () => {
		assert.deepStrictEqual(roomIn('xx.F.xx', 3), { up: 0.5, down: 0.5 });
	});

	test('gives the whole run when it reaches the top of the document', () => {
		assert.deepStrictEqual(roomIn('..Fx', 2), { up: 2, down: 0 });
	});

	test('gives the whole run when it reaches the bottom of the document', () => {
		assert.deepStrictEqual(roomIn('xF...', 1), { up: 0, down: 3 });
	});

	test('has nothing beyond the document edge when the formula is on the first or last line', () => {
		assert.deepStrictEqual(roomIn('F.', 0), { up: 0, down: 1 });
		assert.deepStrictEqual(roomIn('.F', 1), { up: 1, down: 0 });
	});

	test('counts from the first line up and from the last line down for a multi-line formula', () => {
		assert.deepStrictEqual(roomIn('x.FF..x', 2, 3), { up: 0.5, down: 1 });
	});

	test('does not count free lines beyond the first line with content', () => {
		assert.deepStrictEqual(roomIn('..x.F.x', 4), { up: 0.5, down: 0.5 });
	});
});

suite('wrapSafeRoom', () => {
	const room = { up: 2, down: 3 };

	test('returns the room untouched when word-wrap is off', () => {
		assert.deepStrictEqual(wrapSafeRoom(room, 500, 900, undefined), room);
	});

	test('keeps both sides when the formula ends and the line ends exactly at the column', () => {
		assert.deepStrictEqual(wrapSafeRoom(room, 60, 60, 60), room);
	});

	test('drops both sides when the formula ends past the column', () => {
		assert.deepStrictEqual(wrapSafeRoom(room, 61, 61, 60), { up: 0, down: 0 });
	});

	test('drops only the room below when the formula ends in time but the line goes on', () => {
		assert.deepStrictEqual(wrapSafeRoom(room, 40, 80, 60), { up: 2, down: 0 });
	});
});
