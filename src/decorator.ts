import * as vscode from 'vscode';
import { findMath, isDisplayBlock, MathSpan } from './parser';
import { isError, render, RenderOptions, RenderResult } from './renderer';
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
const CHIP_TEXT = '∑ show formula';
/** @brief Ancho del chip, en caracteres (`ch`) de la fuente del editor. */
const CHIP_WIDTH_CH = 16;
/** @brief Espera en milisegundos antes de abrir el hover de una fórmula grande bajo el cursor. */
const HOVER_DELAY_MS = 300;
/**
 * @brief Espera en milisegundos antes de plegar los bloques `$$`.
 *
 * Da tiempo a que VS Code recalcule las regiones de plegado (por ejemplo, al abrir el documento
 * o tras editarlo); plegar antes no tendría efecto.
 */
const FOLD_DELAY_MS = 500;

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
 * @brief Renderiza las fórmulas inline y los bloques `$$` de los editores Markdown mediante decoraciones.
 *
 * Oculta el código fuente de cada fórmula y muestra en su lugar la imagen; las fórmulas
 * con error se subrayan y las que tocan una selección se dejan como texto para poder editarlas.
 * Los bloques `$$` multilínea se muestran siempre como chip en su primera línea y, si
 * `mathInline.foldDisplayMath` está activo, se pliegan y despliegan automáticamente
 * (con `MathFoldingProvider` aportando las regiones).
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
	private foldTimer: ReturnType<typeof setTimeout> | undefined;
	private lastFoldKey: string | undefined;

	/**
	 * @brief Crea los tipos de decoración, suscribe los eventos relevantes y hace una primera actualización.
	 *
	 * Además de `mathInline.*`, reacciona a los cambios de `editor.fontSize` y `editor.lineHeight`.
	 * También se suscribe a `onDidChangeActiveTextEditor`, porque los comandos de plegado solo
	 * alcanzan al editor activo y hay que actualizarlo cuando recibe el foco.
	 */
	constructor() {
		this.disposables.push(
			this.hiddenType,
			this.collapsedType,
			this.chipSourceType,
			this.errorType,
			vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
			// Folding commands only reach the active editor, so it needs an update when focus moves.
			vscode.window.onDidChangeActiveTextEditor(editor => editor && this.update(editor)),
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
	 * @return Fórmulas del documento, inline y de bloque `$$`, en orden de aparición.
	 */
	getSpans(document: vscode.TextDocument): MathSpan[] {
		const key = document.uri.toString();
		const cached = this.parsed.get(key);
		if (cached?.version === document.version) {
			return cached.spans;
		}
		const spans = findMath(document.getText());
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
	 * @brief Renderiza una fórmula tal como se dibuja dentro del editor.
	 *
	 * Las fórmulas inline usan `inlineOptions()`. Las `$$...$$` de una sola línea usan el
	 * mismo alto máximo pero en modo display y sin `textStyle`. Los bloques multilínea se
	 * renderizan en modo display a tamaño completo, solo para detectar errores: siempre se
	 * muestran como chip.
	 *
	 * @param span Fórmula a renderizar.
	 * @return Imagen renderizada o error de TeX.
	 */
	private renderInEditor(span: MathSpan): RenderResult {
		if (isDisplayBlock(span)) {
			return render(span.tex, { ...this.renderOptions(), display: true });
		}
		if (span.display) {
			return render(span.tex, { ...this.inlineOptions(), textStyle: false, display: true });
		}
		return render(span.tex, this.inlineOptions());
	}

	/**
	 * @brief Indica si una fórmula es demasiado grande para mostrarse en la línea.
	 *
	 * Es grande si es un bloque `$$` multilínea, o si al renderizarla con `renderInEditor`
	 * debe achicarse por debajo de `MIN_INLINE_SCALE` para entrar en una línea.
	 * Las fórmulas con error no cuentan.
	 *
	 * @param span Fórmula a examinar.
	 * @return `true` si la fórmula se mostraría como chip.
	 */
	isLarge(span: MathSpan): boolean {
		const result = this.renderInEditor(span);
		return !isError(result) && (isDisplayBlock(span) || result.fit < MIN_INLINE_SCALE);
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
	 * imagen. Los `$$...$$` de una sola línea se renderizan en modo display. Los bloques
	 * multilínea siempre son chip, y su decoración cubre solo la primera línea (el resto lo
	 * oculta el plegado); los que tienen error o están revelados se despliegan. En los chips, `collapsedType` se aplica solo al `$` de apertura y el resto del
	 * código se oculta con `chipSourceType`; no llevan `hoverMessage`, porque el mouse sobre el chip
	 * cae dentro de la fórmula y la vista previa la da `MathHoverProvider`. Renderiza con
	 * `textStyle` y con `maxHeight` igual al alto de línea del editor, para que las fórmulas
	 * entren en una línea (el hover no se ve afectado).
	 * Al final llama a `scheduleHover` para abrir el hover de una fórmula grande bajo el cursor
	 * y, si `mathInline.foldDisplayMath` está activo, a `syncFolds` para plegar y desplegar bloques.
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
		const foldLines: number[] = [];
		const unfoldLines: number[] = [];

		for (const span of this.getSpans(editor.document)) {
			const range = new vscode.Range(editor.document.positionAt(span.start), editor.document.positionAt(span.end));
			const block = isDisplayBlock(span);
			if (!this.config.enabled) {
				if (block) {
					unfoldLines.push(range.start.line);
				}
				continue;
			}
			if (editor.selections.some(sel => sel.start.isBeforeOrEqual(range.end) && sel.end.isAfterOrEqual(range.start))) {
				revealed.push(range);
				if (block) {
					unfoldLines.push(range.start.line);
				}
				continue;
			}
			const result = this.renderInEditor(span);
			if (isError(result)) {
				errors.push({ range, hoverMessage: `Math Inline: ${result.error}` });
				if (block) {
					unfoldLines.push(range.start.line);
				}
			} else if (block || result.fit < MIN_INLINE_SCALE) {
				// The preview comes from MathHoverProvider, since the opening `$` stays as hoverable text under the chip.
				collapsed.push(range);
				chips.push({ range: new vscode.Range(range.start, range.start.translate(0, 1)) });
				// In a block only the opening line is hidden; the other lines are folded away.
				const chipEnd = block ? editor.document.lineAt(range.start.line).range.end : range.end;
				chipSources.push({ range: new vscode.Range(range.start.translate(0, 1), chipEnd) });
				if (block) {
					foldLines.push(range.start.line);
				}
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

		editor.setDecorations(this.hiddenType, hidden);
		editor.setDecorations(this.collapsedType, chips);
		editor.setDecorations(this.chipSourceType, chipSources);
		editor.setDecorations(this.errorType, errors);
		this.states.set(editor, {
			rendered: hidden.map(d => d.range), collapsed, errors: errors.map(d => d.range), revealed,
		});
		this.scheduleHover(editor);
		if (this.config.foldDisplayMath) {
			this.syncFolds(editor, foldLines, unfoldLines);
		}
	}

	/**
	 * @brief Pliega los bloques `$$` mostrados como chip y despliega los que se están editando.
	 *
	 * Solo actúa sobre el editor activo, porque `editor.fold` y `editor.unfold` operan sobre él.
	 * Despliega enseguida (para ver el código al entrar con el cursor) y pliega tras
	 * `FOLD_DELAY_MS`, cuando las regiones de `MathFoldingProvider` ya están calculadas.
	 * `lastFoldKey` evita repetir los comandos mientras no cambien el documento ni los bloques
	 * afectados, de modo que un bloque desplegado a mano no se vuelve a plegar al mover el cursor.
	 *
	 * @param editor Editor recién actualizado.
	 * @param foldLines Líneas de apertura de los bloques a plegar.
	 * @param unfoldLines Líneas de apertura de los bloques a desplegar.
	 */
	private syncFolds(editor: vscode.TextEditor, foldLines: number[], unfoldLines: number[]): void {
		if (editor !== vscode.window.activeTextEditor) {
			return;
		}
		const key = `${editor.document.uri.toString()}:${editor.document.version}:${foldLines.join(',')}|${unfoldLines.join(',')}`;
		if (key === this.lastFoldKey) {
			return;
		}
		this.lastFoldKey = key;
		clearTimeout(this.foldTimer);
		this.foldTimer = undefined;
		// Level 1 upwards only touches the innermost region at each line, i.e. the block itself.
		if (unfoldLines.length > 0) {
			void vscode.commands.executeCommand('editor.unfold', { selectionLines: unfoldLines, levels: 1, direction: 'up' });
		}
		if (foldLines.length > 0) {
			this.foldTimer = setTimeout(() => {
				this.foldTimer = undefined;
				if (editor === vscode.window.activeTextEditor) {
					void vscode.commands.executeCommand('editor.fold', { selectionLines: foldLines, levels: 1, direction: 'up' });
				} else {
					// Retry when the editor is active again.
					this.lastFoldKey = undefined;
				}
			}, FOLD_DELAY_MS);
		}
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
		if (!span || !this.isLarge(span)) {
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
	 * @brief Cancela los temporizadores pendientes (incluidos los del hover y el plegado) y libera las decoraciones y suscripciones.
	 */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		clearTimeout(this.hoverTimer);
		clearTimeout(this.foldTimer);
		this.disposables.forEach(d => d.dispose());
	}
}
