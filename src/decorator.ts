import * as vscode from 'vscode';
import { findInlineMath, MathSpan } from './parser';
import { isError, render, RenderOptions } from './renderer';
import { getConfig, getFontSize, MathInlineConfig, resolveColor } from './config';

/**
 * @brief Valor de `textDecoration` que oculta el código fuente detrás de la imagen renderizada.
 *
 * No es API oficial: VS Code copia `textDecoration` tal cual en una regla CSS,
 * por lo que una declaración extra al final permite ocultar el texto.
 */
const HIDE_SOURCE_CSS = 'none; display: none;';
/** @brief Espera en milisegundos antes de actualizar tras editar un documento. */
const DEBOUNCE_MS = 150;
/** @brief Relación `ex`/`em` con la que MathJax calcula el layout; mantiene las fórmulas cerca del tamaño del texto. */
const EX_PER_EM = 0.5;

/**
 * @brief Decoraciones aplicadas por última vez a un editor.
 */
export interface EditorMathState {
	/** Rangos de las fórmulas renderizadas correctamente. */
	rendered: vscode.Range[];
	/** Rangos de las fórmulas con error de TeX. */
	errors: vscode.Range[];
	/** Rangos de las fórmulas que se muestran como código porque el cursor las toca. */
	revealed: vscode.Range[];
}

/** @brief Fórmulas parseadas de un documento, asociadas a la versión que se analizó. */
interface ParsedDocument {
	/** Versión del documento al momento de parsear. */
	version: number;
	/** Fórmulas halladas. */
	spans: MathSpan[];
}

/**
 * @brief Renderiza las fórmulas inline de los editores Markdown mediante decoraciones.
 *
 * Oculta el código fuente de cada fórmula y muestra en su lugar la imagen; las fórmulas
 * con error se subrayan y las que tocan una selección se dejan como texto para poder editarlas.
 * Se actualiza ante cambios de editores, selección, documento, tema y configuración.
 */
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

	/**
	 * @brief Crea los tipos de decoración, suscribe los eventos relevantes y hace una primera actualización.
	 */
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

	/**
	 * @brief Devuelve las fórmulas de un documento.
	 *
	 * Solo vuelve a parsear cuando cambia la versión del documento.
	 *
	 * @param document Documento a analizar.
	 * @return Fórmulas inline del documento.
	 */
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

	/**
	 * @brief Calcula las opciones de render según la configuración y el editor.
	 *
	 * @param scale Factor adicional de escala sobre `mathInline.scale` (1 por defecto).
	 * @return Color resuelto y tamaño de `ex` en píxeles.
	 */
	renderOptions(scale = 1): RenderOptions {
		return {
			color: resolveColor(this.config),
			exPx: getFontSize() * EX_PER_EM * this.config.scale * scale,
		};
	}

	/**
	 * @brief Devuelve las últimas decoraciones aplicadas a un editor, para tests y diagnóstico.
	 *
	 * @param editor Editor consultado.
	 * @return Estado de las decoraciones, o `undefined` si el editor nunca se actualizó.
	 */
	getState(editor: vscode.TextEditor): EditorMathState | undefined {
		return this.states.get(editor);
	}

	/**
	 * @brief Actualiza las decoraciones de todos los editores visibles.
	 */
	updateAll(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.update(editor);
		}
	}

	/**
	 * @brief Recalcula y aplica las decoraciones de un editor Markdown.
	 *
	 * Las fórmulas tocadas por alguna selección quedan reveladas (sin decorar), las
	 * inválidas se subrayan con el mensaje de error y el resto se reemplaza por su
	 * imagen. No hace nada si el documento no es Markdown; si la extensión está
	 * deshabilitada, limpia las decoraciones.
	 *
	 * @param editor Editor a actualizar.
	 */
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

	/**
	 * @brief Programa, con debounce, la actualización de los editores que muestran un documento Markdown.
	 *
	 * @param document Documento que cambió.
	 */
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

	/**
	 * @brief Cancela los temporizadores pendientes y libera las decoraciones y suscripciones.
	 */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.disposables.forEach(d => d.dispose());
	}
}
