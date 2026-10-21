import * as vscode from 'vscode';
import { findInlineMath, MathSpan } from './parser';
import { isError, render, RenderOptions } from './renderer';
import { getConfig, getFontSize, getLineHeight, MathInlineConfig, resolveColor } from './config';

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
/** @brief Achique mínimo aceptable inline; las fórmulas que necesitan más se muestran como chip. */
const MIN_INLINE_SCALE = 0.8;
/** @brief Texto del chip que reemplaza a las fórmulas demasiado grandes. */
const CHIP_TEXT = '∑ ver fórmula';
/** @brief Ancho del chip, en caracteres (`ch`) de la fuente del editor. */
const CHIP_WIDTH_CH = 15;
/** @brief Espera en milisegundos antes de abrir el hover de una fórmula grande bajo el cursor. */
const HOVER_DELAY_MS = 300;

/**
 * @brief Decoraciones aplicadas por última vez a un editor.
 */
export interface EditorMathState {
	/** Rangos de las fórmulas renderizadas correctamente. */
	rendered: vscode.Range[];
	/** Rangos de las fórmulas demasiado grandes, mostradas como chip. */
	collapsed: vscode.Range[];
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
 * Las fórmulas que habría que achicar por debajo de `MIN_INLINE_SCALE` se muestran como un
 * chip `CHIP_TEXT`. El chip no lleva `hoverMessage`: la vista previa ampliada la aporta
 * `MathHoverProvider`, y al poner el cursor dentro de una de ellas se abre su hover automáticamente.
 * Se actualiza ante cambios de editores, selección, documento, tema y configuración.
 */
export class MathDecorator implements vscode.Disposable {
	private readonly hiddenType = vscode.window.createTextEditorDecorationType({
		textDecoration: HIDE_SOURCE_CSS,
	});
	/**
	 * @brief Decoración del chip de las fórmulas grandes, aplicada solo al `$` de apertura.
	 *
	 * Ese `$` queda como texto real transparente, ensanchado con `letter-spacing` y desplazado con
	 * `margin-left` negativo para quedar debajo del chip (`before` de ancho `CHIP_WIDTH_CH`, con
	 * `pointer-events: none`). Así el mouse cae dentro de la fórmula: se dispara `MathHoverProvider`
	 * y el cursor es el de texto.
	 */
	private readonly collapsedType = vscode.window.createTextEditorDecorationType({
		textDecoration: `none; color: transparent !important; letter-spacing: ${CHIP_WIDTH_CH - 1}ch;`
			+ ` margin-left: -${CHIP_WIDTH_CH}ch;`,
		before: {
			contentText: CHIP_TEXT,
			color: new vscode.ThemeColor('textLink.foreground'),
			border: '1px solid',
			borderColor: new vscode.ThemeColor('textLink.foreground'),
			textDecoration: `none; display: inline-block; box-sizing: border-box; width: ${CHIP_WIDTH_CH}ch;`
				+ ' text-align: center; white-space: nowrap; border-radius: 3px; pointer-events: none;',
		},
	});
	/**
	 * @brief Decoración que oculta el resto del código de las fórmulas mostradas como chip (todo menos el `$` de apertura).
	 *
	 * Usa `font-size: 0` en lugar de `display: none` (`hiddenType`): con `display: none` VS Code no
	 * puede medir la posición del carácter siguiente al `$`, y el mouse sobre la mitad derecha del
	 * chip no resolvía a una posición ni mostraba el hover. Con tamaño cero esa posición sigue siendo
	 * medible en el borde derecho del chip.
	 */
	private readonly chipSourceType = vscode.window.createTextEditorDecorationType({
		textDecoration: 'none; font-size: 0;',
	});
	private readonly errorType = vscode.window.createTextEditorDecorationType({
		textDecoration: 'underline wavy var(--vscode-editorError-foreground)',
	});
	private readonly parsed = new Map<string, ParsedDocument>();
	private readonly states = new WeakMap<vscode.TextEditor, EditorMathState>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly disposables: vscode.Disposable[] = [];
	private config: MathInlineConfig = getConfig();
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private lastHoverKey: string | undefined;

	/**
	 * @brief Crea los tipos de decoración, suscribe los eventos relevantes y hace una primera actualización.
	 *
	 * Además de `mathInline.*`, reacciona a los cambios de `editor.fontSize` y `editor.lineHeight`.
	 */
	constructor() {
		this.disposables.push(
			this.hiddenType,
			this.collapsedType,
			this.chipSourceType,
			this.errorType,
			vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
			vscode.window.onDidChangeTextEditorSelection(e => this.update(e.textEditor)),
			vscode.workspace.onDidChangeTextDocument(e => this.scheduleUpdate(e.document)),
			vscode.workspace.onDidCloseTextDocument(doc => this.parsed.delete(doc.uri.toString())),
			vscode.window.onDidChangeActiveColorTheme(() => this.updateAll()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('mathInline') || e.affectsConfiguration('editor.fontSize')
					|| e.affectsConfiguration('editor.lineHeight')) {
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
	 * @brief Calcula las opciones de render para dibujar fórmulas dentro del editor.
	 *
	 * Usa `textStyle` y limita el alto (`maxHeight`) al alto de línea del editor.
	 *
	 * @return Opciones de `renderOptions()` más `textStyle` y `maxHeight`.
	 */
	private inlineOptions(): RenderOptions {
		// Lines cannot grow, so tall formulas are flattened and shrunk to fit one line.
		return { ...this.renderOptions(), textStyle: true, maxHeight: getLineHeight() };
	}

	/**
	 * @brief Indica si una fórmula es demasiado grande para mostrarse inline.
	 *
	 * Es grande si, al renderizarla con las opciones inline, debe achicarse por debajo
	 * de `MIN_INLINE_SCALE` para entrar en una línea. Las fórmulas con error no cuentan.
	 *
	 * @param tex Código TeX de la fórmula, sin delimitadores.
	 * @return `true` si la fórmula se mostraría como chip.
	 */
	isLarge(tex: string): boolean {
		const result = render(tex, this.inlineOptions());
		return !isError(result) && result.fit < MIN_INLINE_SCALE;
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
	 * inválidas se subrayan con el mensaje de error, las que requerirían un achique menor
	 * a `MIN_INLINE_SCALE` quedan como chip (`collapsed`) y el resto se reemplaza por su
	 * imagen. En los chips, `collapsedType` se aplica solo al `$` de apertura y el resto del
	 * código se oculta con `chipSourceType`; no llevan `hoverMessage`, porque el mouse sobre el chip
	 * cae dentro de la fórmula y la vista previa la da `MathHoverProvider`. Renderiza con
	 * `textStyle` y con `maxHeight` igual al alto de línea del editor, para que las fórmulas
	 * entren en una línea (el hover no se ve afectado).
	 * Al final llama a `scheduleHover` para abrir el hover de una fórmula grande bajo el cursor.
	 * No hace nada si el documento no es Markdown; si la extensión está
	 * deshabilitada, limpia las decoraciones.
	 *
	 * @param editor Editor a actualizar.
	 */
	update(editor: vscode.TextEditor): void {
		if (editor.document.languageId !== 'markdown') {
			return;
		}
		const hidden: vscode.DecorationOptions[] = [];
		const collapsed: vscode.Range[] = [];
		const chips: vscode.DecorationOptions[] = [];
		const chipSources: vscode.DecorationOptions[] = [];
		const errors: vscode.DecorationOptions[] = [];
		const revealed: vscode.Range[] = [];

		if (this.config.enabled) {
			const options = this.inlineOptions();
			for (const span of this.getSpans(editor.document)) {
				const range = new vscode.Range(editor.document.positionAt(span.start), editor.document.positionAt(span.end));
				if (editor.selections.some(sel => sel.start.isBeforeOrEqual(range.end) && sel.end.isAfterOrEqual(range.start))) {
					revealed.push(range);
					continue;
				}
				const result = render(span.tex, options);
				if (isError(result)) {
					errors.push({ range, hoverMessage: `Math Inline: ${result.error}` });
				} else if (result.fit < MIN_INLINE_SCALE) {
					// The preview comes from MathHoverProvider, since the opening `$` stays as hoverable text under the chip.
					collapsed.push(range);
					chips.push({ range: new vscode.Range(range.start, range.start.translate(0, 1)) });
					chipSources.push({ range: new vscode.Range(range.start.translate(0, 1), range.end) });
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
		editor.setDecorations(this.collapsedType, chips);
		editor.setDecorations(this.chipSourceType, chipSources);
		editor.setDecorations(this.errorType, errors);
		this.states.set(editor, {
			rendered: hidden.map(d => d.range), collapsed, errors: errors.map(d => d.range), revealed,
		});
		this.scheduleHover(editor);
	}

	/**
	 * @brief Abre el hover de la fórmula grande bajo el cursor, si la hay.
	 *
	 * Solo actúa sobre el editor activo. Tras `HOVER_DELAY_MS` ejecuta `editor.action.showHover`;
	 * `lastHoverKey` evita reabrirlo mientras el cursor sigue en la misma fórmula y versión del
	 * documento, y cancela el temporizador pendiente si el cursor sale de la fórmula.
	 *
	 * @param editor Editor recién actualizado.
	 */
	private scheduleHover(editor: vscode.TextEditor): void {
		if (editor !== vscode.window.activeTextEditor) {
			return;
		}
		const key = this.config.enabled ? this.largeSpanKey(editor) : undefined;
		if (key === this.lastHoverKey) {
			// Already shown (or pending) for this formula and version, so cursor moves inside it don't flicker.
			return;
		}
		clearTimeout(this.hoverTimer);
		this.hoverTimer = undefined;
		this.lastHoverKey = key;
		if (key !== undefined) {
			this.hoverTimer = setTimeout(() => {
				this.hoverTimer = undefined;
				void vscode.commands.executeCommand('editor.action.showHover');
			}, HOVER_DELAY_MS);
		}
	}

	/**
	 * @brief Identifica la fórmula grande que contiene al cursor, junto con la versión del documento.
	 *
	 * @param editor Editor a consultar.
	 * @return Clave `uri:inicio:versión`, o `undefined` si hay varias selecciones o una no vacía,
	 * o si el cursor no está dentro de una fórmula grande.
	 */
	private largeSpanKey(editor: vscode.TextEditor): string | undefined {
		if (editor.selections.length !== 1 || !editor.selection.isEmpty) {
			return undefined;
		}
		const offset = editor.document.offsetAt(editor.selection.active);
		const span = this.getSpans(editor.document).find(s => s.start < offset && offset < s.end);
		if (!span || !this.isLarge(span.tex)) {
			return undefined;
		}
		return `${editor.document.uri.toString()}:${span.start}:${editor.document.version}`;
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
	 * @brief Cancela los temporizadores pendientes (incluido el del hover) y libera las decoraciones y suscripciones.
	 */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		clearTimeout(this.hoverTimer);
		this.disposables.forEach(d => d.dispose());
	}
}
