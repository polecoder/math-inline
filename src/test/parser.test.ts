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

suite('findMath: front matter', () => {
	test('skips a YAML front matter closed by --- or ...', () => {
		assert.deepStrictEqual(texts('---\ntitle: $a$\n---\n$b$'), ['b']);
		assert.deepStrictEqual(texts('---\nprice: $5 to $x$\n...\n$b$'), ['b']);
		assert.deepStrictEqual(texts('---\n---\n$b$'), ['b']);
	});

	test('tolerates trailing spaces on the delimiters', () => {
		assert.deepStrictEqual(texts('--- \nt: $a$\n---  \n$b$'), ['b']);
	});

	test('treats an unclosed front matter as regular Markdown', () => {
		assert.deepStrictEqual(texts('---\ntitle: $a$\n\n$b$'), ['a', 'b']);
	});

	test('only recognizes front matter on the first line', () => {
		assert.deepStrictEqual(texts('$x$\n---\n$a$\n---\n$b$'), ['x', 'a', 'b']);
		assert.deepStrictEqual(texts('\n---\n$a$\n---'), ['a']);
	});

	test('does not take ---- or an indented --- as front matter', () => {
		assert.deepStrictEqual(texts('----\n$a$\n----'), ['a']);
		assert.deepStrictEqual(texts(' ---\n$a$\n---'), ['a']);
		assert.deepStrictEqual(texts('---\na: $x$\n ---\n$b$'), ['x', 'b']);
	});

	test('does not leak display math opened in the front matter', () => {
		assert.deepStrictEqual(findMath('---\na: $$\n---\n$b$').map(s => s.tex), ['b']);
	});

	test('keeps display math offsets exact after the front matter', () => {
		const source = '---\nt: 1\n---\n$$x$$';
		const [span] = findMath(source);
		assert.strictEqual(source.slice(span.start, span.end), '$$x$$');
		assert.strictEqual(span.display, true);
	});

	test('keeps offsets exact after a CRLF front matter', () => {
		const source = '---\r\nt: $a$\r\n---\r\n$b$\r\n';
		const spans = findInlineMath(source);
		assert.strictEqual(spans.length, 1);
		assert.strictEqual(source.slice(spans[0].start, spans[0].end), '$b$');
	});
});

suite('findMath: HTML', () => {
	test('skips the content of <pre>, <script>, <style> and <textarea> blocks across lines', () => {
		assert.deepStrictEqual(texts('$x$\n<pre>\n$a$\n</pre>\n$b$'), ['x', 'b']);
		assert.deepStrictEqual(texts('<script>\nlet s = $a$;\n</script>\n$b$'), ['b']);
		assert.deepStrictEqual(texts('<STYLE type="text/css">\n$a$\n</style >\n$b$'), ['b']);
		assert.deepStrictEqual(texts('<textarea>\n$a$\n</textarea>\n$b$'), ['b']);
	});

	test('ends unclosed inline raw HTML at a line that starts a block', () => {
		const source = 'Use <code> for this:\n```js\nconst p = "$" + x + "$";\n```\n\nLet $x$.\n\n## Other $y$';
		assert.deepStrictEqual(texts(source), ['x', 'y']);
		assert.deepStrictEqual(texts('Use the <pre> tag\n# Title $h$\n- item $i$\n> quote $q$'), ['h', 'i', 'q']);
		assert.deepStrictEqual(texts('a <code>\n***\n$b$'), ['b']);
		assert.deepStrictEqual(texts('a <code>\n2. $a$\n</code> $b$'), ['b']);
		assert.deepStrictEqual(texts('1. a <code>\n2. $x$'), ['x']);
	});

	test('keeps inline raw HTML open across indented continuation lines and quote lines', () => {
		assert.deepStrictEqual(texts('a <code>\n    - $a$ </code> $b$'), ['b']);
		assert.deepStrictEqual(texts('a <code>\n    # $a$ </code> $b$'), ['b']);
		assert.deepStrictEqual(texts('> a <code>\n> $a$ </code> $b$'), ['b']);
	});

	test('treats an indented line right after a single-line HTML block as code', () => {
		assert.deepStrictEqual(texts('<!-- c -->\n    $a$\n$b$'), ['b']);
		assert.deepStrictEqual(texts('x <!-- c -->\n    $a$'), ['a']);
	});

	test('keeps an HTML block open across blank lines', () => {
		assert.deepStrictEqual(texts('<pre>\n$a$\n\n$c$\n</pre>\n$b$'), ['b']);
		assert.deepStrictEqual(texts('<!--\n$a$\n\n$c$\n-->\n$b$'), ['b']);
	});

	test('ignores the rest of the line that closes an HTML block, as CommonMark does', () => {
		assert.deepStrictEqual(texts('<pre>$a$</pre> $c$\n$b$'), ['b']);
		assert.deepStrictEqual(texts('<!-- $a$ --> $c$\n$b$'), ['b']);
	});

	test('skips inline <code> and <pre> but not the math around them', () => {
		assert.deepStrictEqual(texts('$x$ <code>$a$</code> $b$'), ['x', 'b']);
		assert.deepStrictEqual(texts('<code>$a$</code> $b$'), ['b']);
		assert.deepStrictEqual(texts('see <pre class="x">$a$</pre> $b$'), ['b']);
	});

	test('continues inline raw HTML on the next line of the paragraph', () => {
		assert.deepStrictEqual(texts('x <code>$a$\n$c$</code> $b$'), ['b']);
	});

	test('ends inline raw HTML that is not closed at the end of the paragraph', () => {
		assert.deepStrictEqual(texts('x <code>$a$\n\n$b$'), ['b']);
	});

	test('skips inline and multi-line comments', () => {
		assert.deepStrictEqual(texts('$x$ <!-- $a$ --> $b$'), ['x', 'b']);
		assert.deepStrictEqual(texts('text <!-- $a$\n$c$ --> $b$'), ['b']);
		assert.deepStrictEqual(texts('<!-->$b$'), []);
		assert.deepStrictEqual(texts('x <!--> $b$'), ['b']);
	});

	test('skips display math inside HTML', () => {
		assert.deepStrictEqual(findMath('<pre>\n$$\na\n$$\n</pre>'), []);
	});

	test('does not take other tags or a lone < as raw HTML', () => {
		assert.deepStrictEqual(texts('<div>$a$</div>'), ['a']);
		assert.deepStrictEqual(texts('<preamble> $a$'), ['a']);
		assert.deepStrictEqual(texts('if a < b then $a$'), ['a']);
	});

	test('does not open HTML inside code spans or code blocks', () => {
		assert.deepStrictEqual(texts('`<pre>` $a$'), ['a']);
		assert.deepStrictEqual(texts('```\n<!--\n```\n$a$'), ['a']);
	});

	test('keeps an HTML block that is never closed open until the end of the document', () => {
		assert.deepStrictEqual(texts('<pre>\n$a$\n\n$b$'), []);
		assert.deepStrictEqual(texts('<!-- $a$\n\n$b$'), []);
	});

	test('treats inline raw HTML across lines as ending at the paragraph, also for <pre>', () => {
		assert.deepStrictEqual(texts('x <pre>$a$\n$c$\n</pre> $b$'), ['b']);
		assert.deepStrictEqual(texts('x <pre>$a$\n\n$b$'), ['b']);
	});

	test('treats <code> at the start of a line as inline HTML that ends at a blank line', () => {
		assert.deepStrictEqual(texts('<code>\n$a$\n</code>\n$b$'), ['b']);
		assert.deepStrictEqual(texts('<code>$a$\n\n$b$'), ['b']);
	});

	test('opens an HTML block only when the tag is not indented 4 or more beyond a paragraph', () => {
		assert.deepStrictEqual(texts('text\n   <pre>\n$a$\n\n$b$'), []);
		assert.deepStrictEqual(texts('text\n    <pre>$a$\n\n$b$'), ['b']);
	});

	test('opens an HTML block after the marker of a list item', () => {
		assert.deepStrictEqual(texts('- <pre>\n  $a$\n  </pre>\n  $b$'), ['b']);
		assert.deepStrictEqual(texts('- item\n\n  <pre>\n  $a$\n\n  $c$\n  </pre>\n\n  $b$'), ['b']);
	});

	test('recognizes a tag that ends its line and closes only with its own tag', () => {
		assert.deepStrictEqual(texts('<pre\nclass="x">$a$\n</pre>\n$b$'), ['b']);
		assert.deepStrictEqual(texts('<pre>\n$a$\n</script>\n$b$\n</pre>\n$c$'), ['c']);
	});

	test('closes a comment that is just <!--> or <!--->', () => {
		assert.deepStrictEqual(texts('x <!---> $b$'), ['b']);
		assert.deepStrictEqual(texts('x <!----> $b$'), ['b']);
	});

	test('lets math that contains < or HTML take precedence over the HTML', () => {
		assert.deepStrictEqual(texts('$a<b$ $c$'), ['a<b', 'c']);
		assert.deepStrictEqual(texts('$a <pre> b$ $c$'), ['a <pre> b', 'c']);
	});

	test('does not open HTML after a backslash', () => {
		assert.deepStrictEqual(texts(String.raw`\<!-- $a$`), ['a']);
		assert.deepStrictEqual(texts(String.raw`\<pre>$a$</pre>`), ['a']);
		// An escaped backslash does not escape the `<`.
		assert.deepStrictEqual(texts(String.raw`\\<pre>$a$</pre> $b$`), ['b']);
	});

	test('does not open HTML inside display math', () => {
		const spans = findMath('$$\n<!--\n$$\n$a$');
		assert.deepStrictEqual(spans.map(s => [s.tex, s.display === true]), [['\n<!--\n', true], ['a', false]]);
	});

	test('does not open display math inside an HTML comment', () => {
		assert.deepStrictEqual(findMath('<!-- $$ -->\n$a$').map(s => s.tex), ['a']);
		assert.deepStrictEqual(findMath('x <!-- $$ --> $a$').map(s => s.tex), ['a']);
	});

	test('keeps offsets exact after a CRLF HTML block', () => {
		const source = '<pre>\r\n$a$\r\n</pre>\r\n<!-- $c$ -->\r\nz $b$\r\n';
		const spans = findInlineMath(source);
		assert.strictEqual(spans.length, 1);
		assert.strictEqual(source.slice(spans[0].start, spans[0].end), '$b$');
	});
});

suite('findMath: lists', () => {
	test('treats an indented continuation paragraph of a list item as text', () => {
		assert.deepStrictEqual(texts('- item\n\n    $a$'), ['a']);
		assert.deepStrictEqual(texts('- item\n\n  $a$'), ['a']);
		assert.deepStrictEqual(texts('* item\n\n    text\n    $a$'), ['a']);
	});

	test('measures the indentation from the content of the item', () => {
		assert.deepStrictEqual(texts('1. item\n\n   $a$'), ['a']);
		assert.deepStrictEqual(texts('10)  item\n\n      $a$'), ['a']);
		assert.deepStrictEqual(texts('-   item\n\n      $a$'), ['a']);
	});

	test('treats 4 or more spaces beyond the content of the item as code', () => {
		assert.deepStrictEqual(texts('- item\n\n      $a$\n\n  $b$'), ['b']);
		assert.deepStrictEqual(texts('1. item\n\n       $a$'), []);
	});

	test('follows nested items', () => {
		assert.deepStrictEqual(texts('- a\n  - b\n\n      $a$'), ['a']);
		assert.deepStrictEqual(texts('- a\n  - b\n\n        $a$\n\n    $b$'), ['b']);
		assert.deepStrictEqual(texts('- - a\n\n    $a$'), ['a']);
	});

	test('treats 5 or more spaces after the marker as indented code', () => {
		assert.deepStrictEqual(texts('-      $a$\n\n  $b$'), ['b']);
	});

	test('closes the list at a less indented line after a blank line', () => {
		assert.deepStrictEqual(texts('- item\n\n$x$\n\n    $a$\n\n$b$'), ['x', 'b']);
	});

	test('keeps the list open across a lazy continuation line', () => {
		assert.deepStrictEqual(texts('- item\nlazy $x$\n\n    $a$'), ['x', 'a']);
	});

	test('closes the list at a heading, fence or thematic break', () => {
		assert.deepStrictEqual(texts('- a\n# h\n\n    $a$\n\n$b$'), ['b']);
		assert.deepStrictEqual(texts('- a\n***\n\n    $a$\n\n$b$'), ['b']);
		assert.deepStrictEqual(texts('- a\n```\n$a$\n```\n\n    $c$\n\n$b$'), ['b']);
	});

	test('does not take a thematic break as a list', () => {
		assert.deepStrictEqual(texts('* * *\n\n    $a$\n\n$b$'), ['b']);
	});

	test('does not start a list in the middle of a paragraph unless allowed', () => {
		assert.deepStrictEqual(texts('text\n2024. year\n\n    $a$\n\n$b$'), ['b']);
		assert.deepStrictEqual(texts('text\n-\n\n    $a$\n\n$b$'), ['b']);
		assert.deepStrictEqual(texts('text\n- item\n\n    $a$'), ['a']);
	});

	test('does not take emphasis or a minus sign as a list marker', () => {
		assert.deepStrictEqual(texts('*a*\n\n    $a$\n\n$b$'), ['b']);
		assert.deepStrictEqual(texts('-5 is $x$'), ['x']);
	});

	test('finds fenced code inside a list item', () => {
		assert.deepStrictEqual(texts('1.  item\n\n    ```\n    $a$\n    ```\n\n    $b$'), ['b']);
		assert.deepStrictEqual(texts('- ```\n  $a$\n  ```\n  $b$'), ['b']);
	});

	test('expands tabs in the indentation', () => {
		assert.deepStrictEqual(texts('-\titem\n\n\t$a$'), ['a']);
		assert.deepStrictEqual(texts('- item\n\n\t\t$a$\n\n$b$'), ['b']);
	});

	test('takes up to 9 digits as an ordered list marker', () => {
		// "123456789. " is 11 columns wide, so 11 spaces continue the item.
		assert.deepStrictEqual(texts('123456789. item\n\n           $a$'), ['a']);
		// With 10 digits it is not a marker: 12 spaces (the content column it would have) are indented code.
		assert.deepStrictEqual(texts('1234567890. item\n\n            $a$'), []);
	});

	test('takes a marker only when followed by a space or the end of the line', () => {
		assert.deepStrictEqual(texts('1. 5\n\n    $a$'), ['a']);
		assert.deepStrictEqual(texts('1.5\n\n    $a$'), []);
	});

	test('treats 5 or more spaces after the marker as code, but not 4', () => {
		assert.deepStrictEqual(texts('-    $a$'), ['a']);
		assert.deepStrictEqual(texts('-     $a$'), []);
		assert.deepStrictEqual(texts('-\t\t$a$\n\n  $b$'), ['b']);
	});

	test('only lets an ordered list that starts at 1 interrupt a paragraph', () => {
		assert.deepStrictEqual(texts('text\n1. item\n\n    $a$'), ['a']);
		assert.deepStrictEqual(texts('text\n2. item\n\n    $a$'), []);
		assert.deepStrictEqual(texts('text\n10. item\n\n    $a$'), []);
	});

	test('does not start a list or a fence from a line indented 4 or more beyond a paragraph', () => {
		// Not a list: `      $a$` (6 spaces) would be the item content if `- item` were a marker.
		assert.deepStrictEqual(texts('text\n    - item\n\n      $a$'), []);
		assert.deepStrictEqual(texts('text\n    ```\n$a$'), ['a']);
	});

	test('keeps the list open on an item that continues the list', () => {
		assert.deepStrictEqual(texts('- a\n- b\n\n    $x$'), ['x']);
		assert.deepStrictEqual(texts('1. a\n1. b\n\n    $x$'), ['x']);
		assert.deepStrictEqual(texts('1. a\n\n2. b\n\n    $x$'), ['x']);
	});

	test('keeps the list open on an ordered item numbered 2 or more right after another item', () => {
		assert.deepStrictEqual(texts('1. a\n2. b\n\n    $x$'), ['x']);
		assert.deepStrictEqual(texts('1. a\n2. b\n3. c\n\n       $x$\n\n$y$'), ['y']);
	});

	test('does not let a sublist numbered 2 or more interrupt the paragraph of an item', () => {
		assert.deepStrictEqual(texts('- a\n  10. b\n\n      $a$\n\n$b$'), ['b']);
		assert.deepStrictEqual(texts('- a\n  1. b\n\n      $a$'), ['a']);
	});

	test('closes an empty item at the blank line after it', () => {
		assert.deepStrictEqual(texts('-\n\n    $a$\n\n$b$'), ['b']);
		assert.deepStrictEqual(texts('-\n  $a$\n\n  $b$'), ['a', 'b']);
	});

	test('treats an indented line right after an empty item as code inside it', () => {
		assert.deepStrictEqual(texts('-\n      $a$\n  $b$'), ['b']);
	});

	test('closes only the empty item at a blank line after another block', () => {
		assert.deepStrictEqual(texts('-   a\n\n    -\n    ***\n\n    $x$'), ['x']);
	});

	test('treats an indented line right after a heading, thematic break, fence or HTML block as code', () => {
		assert.deepStrictEqual(texts('# h $x$\n    $a$\n$b$'), ['x', 'b']);
		assert.deepStrictEqual(texts('***\n    $a$\n$b$'), ['b']);
		assert.deepStrictEqual(texts('```\n```\n    $a$\n$b$'), ['b']);
		assert.deepStrictEqual(texts('<pre>\n</pre>\n    $a$\n$b$'), ['b']);
		assert.deepStrictEqual(texts('x <code>a</code>\n    $a$'), ['a']);
	});

	test('skips display math in an indented code block of a list item', () => {
		const spans = findMath('- item\n\n      $$\n      a\n      $$\n\n  $b$');
		assert.deepStrictEqual(spans.map(s => s.tex), ['b']);
	});

	test('finds display math that opens on the marker line of an item', () => {
		const source = '- $$\n  x\n  $$\n  $a$';
		const [display, inline] = findMath(source);
		assert.strictEqual(source.slice(display.start, display.end), '$$\n  x\n  $$');
		assert.strictEqual(display.display, true);
		assert.strictEqual(inline.tex, 'a');
	});

	test('does not close a fence indented 4 or more beyond the content of the item', () => {
		assert.deepStrictEqual(texts('- ```\n  $a$\n      ```\n  $c$\n  ```\n$b$'), ['b']);
	});

	test('closes a fence of an item with a less indented closing fence', () => {
		assert.deepStrictEqual(texts('- ```\n  $a$\n```\n$b$'), ['b']);
	});

	test('finds fenced code in a nested item', () => {
		assert.deepStrictEqual(texts('- a\n  - ```\n    $x$\n    ```\n  $b$'), ['b']);
	});

	test('treats an indented line right after an item paragraph as text', () => {
		assert.deepStrictEqual(texts('- item\n      $a$'), ['a']);
	});

	test('keeps offsets exact in CRLF lists', () => {
		const source = '- item\r\n\r\n    $a$\r\n';
		const [span] = findInlineMath(source);
		assert.strictEqual(source.slice(span.start, span.end), '$a$');
	});
});

suite('findMath: links', () => {
	test('stays fast on a long line of unclosed link destinations', () => {
		const start = performance.now();
		findMath('[]('.repeat(20000));
		findMath('['.repeat(2000) + '](x'.repeat(2000) + ' $a$');
		findMath('[](a ('.repeat(20000));
		assert.ok(performance.now() - start < 500);
	});

	test('does not accept an unescaped ( inside a parenthesized title', () => {
		assert.deepStrictEqual(texts('[a](u (($x$)) $b$'), ['x', 'b']);
		assert.deepStrictEqual(texts('[a](u (\\($x$)) $b$'), ['b']);
	});

	test('limits the nesting of parentheses in a link destination', () => {
		assert.deepStrictEqual(texts(`[a](${'('.repeat(32)}$x$${')'.repeat(32)}) $b$`), ['b']);
		assert.deepStrictEqual(texts(`[a](${'('.repeat(33)}$x$${')'.repeat(33)}) $b$`), ['x', 'b']);
	});

	test('skips the destination and title of links and images', () => {
		assert.deepStrictEqual(texts('[text](http://x/$a$/$b$) $c$'), ['c']);
		assert.deepStrictEqual(texts('![alt](img.png "$a$") $c$'), ['c']);
		assert.deepStrictEqual(texts('[t](<a $a$ b> \'$b$\') $c$'), ['c']);
		assert.deepStrictEqual(texts('[t](f(x)$a$y) $c$'), ['c']);
	});

	test('finds math in the text of a link', () => {
		assert.deepStrictEqual(texts('[$a$ and $b$](url) $c$'), ['a', 'b', 'c']);
		assert.deepStrictEqual(texts('[see [$a$]](url$x$)'), ['a']);
	});

	test('finds math right before a link and in a following link text', () => {
		assert.deepStrictEqual(texts('$x$[a](u$y$)[$b$](v)'), ['x', 'b']);
	});

	test('does not skip parentheses that are not a link destination', () => {
		assert.deepStrictEqual(texts('[a](b c $x$)'), ['x']);
		assert.deepStrictEqual(texts('[a](b "$x$)'), ['x']);
		assert.deepStrictEqual(texts('a](b $x$)'), ['x']);
		assert.deepStrictEqual(texts('[a] ($x$)'), ['x']);
		assert.deepStrictEqual(texts('[a]\n\n](u $x$)'), ['x']);
	});

	test('matches the link text across the lines of a paragraph', () => {
		assert.deepStrictEqual(texts('[a $x$\nb](u$y$) $z$'), ['x', 'z']);
	});

	test('skips autolinks', () => {
		assert.deepStrictEqual(texts('$x$ <https://x.com/$a$/$b$> $c$'), ['x', 'c']);
		assert.deepStrictEqual(texts('<mailto:a$b$c@x.org>'), []);
	});

	test('does not take angle brackets with spaces as an autolink', () => {
		assert.deepStrictEqual(texts('<a: $x$>'), ['x']);
	});

	test('lets a backslash escape the delimiters of a link destination', () => {
		assert.deepStrictEqual(texts(String.raw`[t](a\)$a$) $c$`), ['c']);
		assert.deepStrictEqual(texts(String.raw`[t](<a\>$a$b>) $c$`), ['c']);
	});

	test('lets a backslash escape the closing quote of a link title', () => {
		assert.deepStrictEqual(texts(String.raw`[t](u "a\"$a$") $c$`), ['c']);
	});

	test('accepts a title in parentheses', () => {
		assert.deepStrictEqual(texts('[t](u ($a$)) $c$'), ['c']);
		// The title `($a$)` is not followed by `)`, so there is no link.
		assert.deepStrictEqual(texts('[t](u ($a$) $c$'), ['a', 'c']);
	});

	test('accepts a tab before the title and a quote glued to the destination', () => {
		assert.deepStrictEqual(texts('[t](u\t"$a$") $c$'), ['c']);
		assert.deepStrictEqual(texts('[t](u"$a$") $c$'), ['c']);
	});

	test('does not take a destination with `<` or without the closing `>` as a link', () => {
		assert.deepStrictEqual(texts('[t](<a<$x$>)'), ['x']);
		assert.deepStrictEqual(texts('[t](<a $x$)'), ['x']);
	});

	test('does not take a destination with unbalanced parentheses or an unterminated title as a link', () => {
		assert.deepStrictEqual(texts('[t](a(b) $x$'), ['x']);
		assert.deepStrictEqual(texts('[t](u ($x$)'), ['x']);
	});

	test('skips the destination of a link with no text or no destination', () => {
		assert.deepStrictEqual(texts('[](u$a$) $c$'), ['c']);
		assert.deepStrictEqual(texts('[t]() $x$'), ['x']);
	});

	test('does not take an escaped bracket as the text of a link', () => {
		assert.deepStrictEqual(texts(String.raw`\[$x$](u$y$)`), ['x', 'y']);
		assert.deepStrictEqual(texts(String.raw`[a\](u$x$)`), ['x']);
	});

	test('does not count brackets inside code spans as link text', () => {
		assert.deepStrictEqual(texts('[`]`](u$x$) $c$'), ['c']);
		assert.deepStrictEqual(texts('`[`](u$x$)'), ['x']);
	});

	test('does not count brackets inside display math as link text', () => {
		assert.deepStrictEqual(texts('$$\n[a\n$$\n](u $x$)'), ['x']);
	});

	test('finds math next to footnotes and task list boxes', () => {
		assert.deepStrictEqual(texts('[^1]: see $x$'), ['x']);
		assert.deepStrictEqual(texts('- [ ] $x$\n- [x] $y$'), ['x', 'y']);
	});

	test('takes a scheme of 2 to 32 characters as an autolink', () => {
		assert.deepStrictEqual(texts('<ab:$x$> $y$'), ['y']);
		assert.deepStrictEqual(texts('<a:$x$> $y$'), ['x', 'y']);
		const scheme32 = 'a'.repeat(32);
		assert.deepStrictEqual(texts(`<${scheme32}:$x$> $y$`), ['y']);
		assert.deepStrictEqual(texts(`<${scheme32}a:$x$> $y$`), ['x', 'y']);
	});

	test('keeps offsets exact around links in CRLF documents', () => {
		const source = 'a\r\n[$a$](u$x$) $b$\r\n';
		assert.deepStrictEqual(findInlineMath(source).map(s => source.slice(s.start, s.end)), ['$a$', '$b$']);
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
