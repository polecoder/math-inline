export interface MathSpan {
	/** Offset of the opening `$`. */
	start: number;
	/** Offset just past the closing `$`. */
	end: number;
	/** TeX source between the delimiters. */
	tex: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^(?: {4}|\t)/;

/**
 * Finds inline math (`$...$`) in a Markdown document, following Pandoc's rules:
 * the opening `$` must not be followed by whitespace, the closing `$` must not be
 * preceded by whitespace nor followed by a digit. Code (fenced, indented and code
 * spans), escaped dollars and `$$...$$` display math are skipped.
 */
export function findInlineMath(text: string): MathSpan[] {
	const spans: MathSpan[] = [];
	const lines = text.split('\n');
	let offset = 0;
	let fence: string | undefined;
	let inDisplay = false;
	let prevBlank = true;

	for (const rawLine of lines) {
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		const lineStart = offset;
		offset += rawLine.length + 1;

		const fenceMatch = FENCE.exec(line);
		if (fence !== undefined) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length
				&& line.slice(fenceMatch[0].length).trim() === '') {
				fence = undefined;
			}
			continue;
		}
		if (fenceMatch && !inDisplay) {
			fence = fenceMatch[1];
			continue;
		}
		const blank = line.trim() === '';
		if (!inDisplay && prevBlank && !blank && INDENTED_CODE.test(line)) {
			// Indented code block: keep treating following indented lines as code.
			continue;
		}
		prevBlank = blank;
		if (blank) {
			// Display math cannot span a blank line.
			inDisplay = false;
			continue;
		}

		inDisplay = scanLine(line, lineStart, inDisplay, spans);
	}
	return spans;
}

/** Scans one line, appending spans; returns whether a `$$` block is still open. */
function scanLine(line: string, lineStart: number, inDisplay: boolean, spans: MathSpan[]): boolean {
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === '\\') {
			i += 2;
			continue;
		}
		if (inDisplay) {
			if (line.startsWith('$$', i)) {
				inDisplay = false;
				i += 2;
			} else {
				i++;
			}
			continue;
		}
		if (ch === '`') {
			let ticks = 1;
			while (line[i + ticks] === '`') {
				ticks++;
			}
			const delim = '`'.repeat(ticks);
			const close = findCodeSpanClose(line, i + ticks, delim);
			i = close === -1 ? i + ticks : close + ticks;
			continue;
		}
		if (ch !== '$') {
			i++;
			continue;
		}
		if (line[i + 1] === '$') {
			inDisplay = true;
			i += 2;
			continue;
		}
		const close = findMathClose(line, i + 1);
		if (close === -1) {
			i++;
			continue;
		}
		spans.push({ start: lineStart + i, end: lineStart + close + 1, tex: line.slice(i + 1, close) });
		i = close + 1;
	}
	return inDisplay;
}

function findCodeSpanClose(line: string, from: number, delim: string): number {
	let idx = line.indexOf(delim, from);
	while (idx !== -1) {
		if (line[idx + delim.length] !== '`') {
			return idx;
		}
		let j = idx;
		while (line[j] === '`') {
			j++;
		}
		idx = line.indexOf(delim, j);
	}
	return -1;
}

function findMathClose(line: string, from: number): number {
	if (from >= line.length || /\s/.test(line[from])) {
		return -1;
	}
	for (let j = from; j < line.length; j++) {
		const ch = line[j];
		if (ch === '\\') {
			j++;
			continue;
		}
		if (ch === '`') {
			// Code spans take precedence: math cannot close inside one.
			return -1;
		}
		if (ch !== '$') {
			continue;
		}
		if (line[j + 1] === '$') {
			// `$$` inside inline math: not a valid closer here.
			return -1;
		}
		if (/\s/.test(line[j - 1]) || /[0-9]/.test(line[j + 1] ?? '')) {
			continue;
		}
		return j;
	}
	return -1;
}
