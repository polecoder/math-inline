import * as vscode from 'vscode';
import { MathDecorator } from './decorator';
import { isError, render } from './renderer';

const HOVER_SCALE = 2;

/** Shows a larger rendering (or the TeX error) when hovering a formula's source. */
export class MathHoverProvider implements vscode.HoverProvider {
	constructor(private readonly decorator: MathDecorator) {}

	provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const offset = document.offsetAt(position);
		const span = this.decorator.getSpans(document).find(s => s.start <= offset && offset < s.end);
		if (!span) {
			return undefined;
		}
		const range = new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
		const result = render(span.tex, this.decorator.renderOptions(HOVER_SCALE));
		if (isError(result)) {
			// The error decoration already carries the message.
			return undefined;
		}
		return new vscode.Hover(new vscode.MarkdownString(`![math](${result.uri})`), range);
	}
}
