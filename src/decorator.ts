import * as vscode from 'vscode';
import { findInlineMath, MathSpan } from './parser';
import { isError, render, RenderOptions } from './renderer';
import { getConfig, getFontSize, MathInlineConfig, resolveColor } from './config';

// Not an official API: VS Code copies `textDecoration` verbatim into a CSS rule,
// so a trailing declaration hides the source text behind the rendered image.
const HIDE_SOURCE_CSS = 'none; display: none;';
const DEBOUNCE_MS = 150;
// MathJax lays out with ex ≈ 0.5em; the factor keeps formulas close to the text size.
const EX_PER_EM = 0.5;

export interface EditorMathState {
	rendered: vscode.Range[];
	errors: vscode.Range[];
	revealed: vscode.Range[];
}

interface ParsedDocument {
	version: number;
	spans: MathSpan[];
}

export class MathDecorator implements vscode.Disposable {
	private readonly hiddenType = vscode.window.createTextEditorDecorationType({
		textDecoration: HIDE_SOURCE_CSS,
	});
	private readonly errorType = vscode.window.createTextEditorDecorationType({
		textDecoration: 'underline wavy var(--vscode-editorError-foreground)',
	});
	private readonly parsed = new Map<string, ParsedDocument>();
	private readonly states = new WeakMap<vscode.TextEditor, EditorMathState>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly disposables: vscode.Disposable[] = [];
	private config: MathInlineConfig = getConfig();

	constructor() {
		this.disposables.push(
			this.hiddenType,
			this.errorType,
			vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
			vscode.window.onDidChangeTextEditorSelection(e => this.update(e.textEditor)),
			vscode.workspace.onDidChangeTextDocument(e => this.scheduleUpdate(e.document)),
			vscode.workspace.onDidCloseTextDocument(doc => this.parsed.delete(doc.uri.toString())),
			vscode.window.onDidChangeActiveColorTheme(() => this.updateAll()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('mathInline') || e.affectsConfiguration('editor.fontSize')) {
					this.config = getConfig();
					this.updateAll();
				}
			}),
		);
		this.updateAll();
	}

	/** Formulas in `document`, re-parsed only when its version changes. */
	getSpans(document: vscode.TextDocument): MathSpan[] {
		const key = document.uri.toString();
		const cached = this.parsed.get(key);
		if (cached?.version === document.version) {
			return cached.spans;
		}
		const spans = findInlineMath(document.getText());
		this.parsed.set(key, { version: document.version, spans });
		return spans;
	}

	renderOptions(scale = 1): RenderOptions {
		return {
			color: resolveColor(this.config),
			exPx: getFontSize() * EX_PER_EM * this.config.scale * scale,
		};
	}

	/** Last decorations applied to `editor`, for tests and diagnostics. */
	getState(editor: vscode.TextEditor): EditorMathState | undefined {
		return this.states.get(editor);
	}

	updateAll(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.update(editor);
		}
	}

	update(editor: vscode.TextEditor): void {
		if (editor.document.languageId !== 'markdown') {
			return;
		}
		const hidden: vscode.DecorationOptions[] = [];
		const errors: vscode.DecorationOptions[] = [];
		const revealed: vscode.Range[] = [];

		if (this.config.enabled) {
			const options = this.renderOptions();
			for (const span of this.getSpans(editor.document)) {
				const range = new vscode.Range(editor.document.positionAt(span.start), editor.document.positionAt(span.end));
				if (editor.selections.some(sel => sel.start.isBeforeOrEqual(range.end) && sel.end.isAfterOrEqual(range.start))) {
					revealed.push(range);
					continue;
				}
				const result = render(span.tex, options);
				if (isError(result)) {
					errors.push({ range, hoverMessage: `Math Inline: ${result.error}` });
				} else {
					hidden.push({
						range,
						renderOptions: {
							before: {
								contentIconPath: vscode.Uri.parse(result.uri),
								width: `${result.width}px`,
								height: `${result.height}px`,
								textDecoration: `none; vertical-align: ${result.verticalAlign}px;`,
							},
						},
					});
				}
			}
		}

		editor.setDecorations(this.hiddenType, hidden);
		editor.setDecorations(this.errorType, errors);
		this.states.set(editor, { rendered: hidden.map(d => d.range), errors: errors.map(d => d.range), revealed });
	}

	private scheduleUpdate(document: vscode.TextDocument): void {
		if (document.languageId !== 'markdown') {
			return;
		}
		const key = document.uri.toString();
		clearTimeout(this.timers.get(key));
		this.timers.set(key, setTimeout(() => {
			this.timers.delete(key);
			for (const editor of vscode.window.visibleTextEditors) {
				if (editor.document === document) {
					this.update(editor);
				}
			}
		}, DEBOUNCE_MS));
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.disposables.forEach(d => d.dispose());
	}
}
