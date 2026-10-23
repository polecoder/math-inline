import * as vscode from 'vscode';
import { findMath, isDisplayBlock, MathSpan, texLocation } from './parser';
import { layoutRows } from './blockLayout';
import {
	isError, render, renderBands, RenderedBands, RenderedMath, RenderedRow, RenderError, RenderOptions, renderRows, RenderResult,
} from './renderer';
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
/** @brief Achique mínimo aceptable para un bloque `$$` cortado en franjas; si necesita más, no se dibuja en el editor. */
const MIN_BAND_SCALE = 0.5;
/** @brief Opacidad de las líneas delimitadoras (`$$`, `\begin`, `\end`) de un bloque mientras se edita. */
const FADED_OPACITY = '0.45';

/**
 * @brief Forma en que se dibuja un bloque `$$` multilínea en sus propias líneas.
 *
 * `rows`: una tabla con una imagen por fila; `rowLines` tiene la línea del documento donde empieza cada fila.
 * `bands`: cualquier fórmula, cortada en franjas del alto de una línea.
 * `chip`: no entra con una escala aceptable, o sea que no se puede dibujar en el editor. Con
 * `displayMath` en `render` se muestra como código; en el modo `chip`, como chip.
 */
type BlockView =
	| { kind: 'rows'; rows: RenderedRow[]; rowLines: number[] }
	| { kind: 'bands'; bands: RenderedBands }
	| { kind: 'chip' };

/**
 * @brief Decoraciones que `update` acumula para un editor antes de aplicarlas.
 */
interface PendingDecorations {
	/** Fórmulas inline ocultas, con su imagen en `before`. */
	hidden: vscode.DecorationOptions[];
	/** Líneas ocultas de los bloques dibujados en el editor, con su fila o franja en `before` (o vacías). */
	blockLines: vscode.DecorationOptions[];
	/** `$` de apertura de las fórmulas mostradas como chip. */
	chips: vscode.DecorationOptions[];
	/** Resto del código de las fórmulas mostradas como chip. */
	chipSources: vscode.DecorationOptions[];
	/** Fórmulas o líneas con error de TeX. */
	errors: vscode.DecorationOptions[];
	/** Vista previa de la fila en edición, al final de su línea. */
	ghosts: vscode.DecorationOptions[];
	/** Líneas delimitadoras atenuadas de un bloque en edición. */
	faded: vscode.Range[];
	/** Líneas que muestran la imagen de una fila. */
	rows: vscode.Range[];
	/** Bloques dibujados en el editor, marcados con un borde a la izquierda. */
	blocks: vscode.Range[];
	/** Fórmulas mostradas como chip. */
	collapsed: vscode.Range[];
	/** Fórmulas que tocan una selección. */
	revealed: vscode.Range[];
	/** Bloques desplegados que se muestran como código. */
	unfolded: vscode.Range[];
	/** Líneas de apertura de los bloques a plegar. */
	foldLines: number[];
	/** Líneas de apertura de los bloques a desplegar. */
	unfoldLines: number[];
}

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
	/** Rangos de los bloques `$$` que se muestran como código porque no están plegados. */
	unfolded: vscode.Range[];
	/** Rangos de los bloques `$$` dibujados en sus propias líneas (por filas o por franjas). */
	blocks: vscode.Range[];
	/** Rangos de las líneas que muestran la vista previa de la fila en edición. */
	ghosts: vscode.Range[];
	/** Rangos de las líneas que muestran la imagen de una fila de un bloque dibujado por filas. */
	rows: vscode.Range[];
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
 * Los bloques `$$` multilínea se dibujan por defecto en sus propias líneas (`mathInline.displayMath`
 * en `render`): una imagen por fila si son una tabla, o franjas del alto de una línea si no; al
 * editarlos se revelan las líneas tocadas y se muestra la vista previa de la fila. En el modo
 * `render` no hay chip: un bloque que no se puede dibujar (plegado a mano, demasiado chico o con
 * error) se muestra como código y nunca se pliega automáticamente. Como VS Code recuerda los
 * plegados entre sesiones, los que quedaron de antes se despliegan una vez por documento. Solo en
 * el modo `chip` los bloques se muestran como chip en su primera línea y, si
 * `mathInline.foldDisplayMath` está activo, se pliegan y despliegan automáticamente (con
 * `MathFoldingProvider` aportando las regiones); desplegados se ven como código.
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
	/** @brief Decoración de la vista previa de la fila en edición; la imagen va en `after` de cada decoración. */
	private readonly ghostType = vscode.window.createTextEditorDecorationType({});
	/** @brief Atenúa (`FADED_OPACITY`) las líneas delimitadoras de un bloque mientras se edita. */
	private readonly fadedType =vscode.window.createTextEditorDecorationType({ opacity: FADED_OPACITY });
	/** @brief Borde a la izquierda de las líneas de un bloque `$$` dibujado en el editor. */
	private readonly blockType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: '0 0 0 2px',
		borderStyle: 'solid',
		borderColor: new vscode.ThemeColor('editorLineNumber.foreground'),
	});
	private readonly parsed = new Map<string, ParsedDocument>();
	private readonly states = new WeakMap<vscode.TextEditor, EditorMathState>();
	private readonly foldSignatures = new WeakMap<vscode.TextEditor, string>();
	/** Último render válido de cada bloque dibujado por filas, por `uri#índice del bloque`, para seguir mostrándolo mientras el TeX está roto. */
	private readonly lastGood = new Map<string, BlockView>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly disposables: vscode.Disposable[] = [];
	private config: MathInlineConfig = getConfig();
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private lastHoverKey: string | undefined;
	private foldTimer: ReturnType<typeof setTimeout> | undefined;
	private lastFoldKey: string | undefined;
	/** Documentos cuyos bloques plegados de antes ya se desplegaron (ver `unfoldStaleFolds`). */
	private readonly staleFoldsCleared = new Set<string>();
	/** Temporizadores pendientes de `unfoldStaleFolds`, para cancelarlos en `dispose`. */
	private readonly staleTimers = new Set<ReturnType<typeof setTimeout>>();

	/**
	 * @brief Crea los tipos de decoración, suscribe los eventos relevantes y hace una primera actualización.
	 *
	 * Además de `mathInline.*`, reacciona a los cambios de `editor.fontSize` y `editor.lineHeight`.
	 * También se suscribe a `onDidChangeActiveTextEditor`, porque los comandos de plegado solo
	 * alcanzan al editor activo y hay que actualizarlo cuando recibe el foco. Con
	 * `onDidChangeTextEditorVisibleRanges` (plegado, desplegado o scroll) actualiza el editor
	 * solo si cambió `foldSignature`, porque el chip depende del estado de plegado. Al cerrar un
	 * documento descarta sus fórmulas parseadas y sus entradas de `lastGood`. Ante un cambio de
	 * configuración relee `getConfig()`, vacía `staleFoldsCleared` (para volver a desplegar los
	 * plegados de antes, ver `unfoldStaleFolds`) y actualiza todos los editores.
	 */
	constructor() {
		this.disposables.push(
			this.hiddenType,
			this.collapsedType,
			this.chipSourceType,
			this.errorType,
			this.ghostType,
			this.fadedType,
			this.blockType,
			vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
			// Folding commands only reach the active editor, so it needs an update when focus moves.
			vscode.window.onDidChangeActiveTextEditor(editor => editor && this.update(editor)),
			vscode.window.onDidChangeTextEditorSelection(e => this.update(e.textEditor)),
			// Folding or unfolding a block changes the visible ranges, and the chip follows the fold state.
			vscode.window.onDidChangeTextEditorVisibleRanges(e => {
				if (this.foldSignatures.get(e.textEditor) !== this.foldSignature(e.textEditor)) {
					this.update(e.textEditor);
				}
			}),
			vscode.workspace.onDidChangeTextDocument(e => this.scheduleUpdate(e.document)),
			vscode.workspace.onDidCloseTextDocument(doc => {
				const uri = doc.uri.toString();
				this.parsed.delete(uri);
				// Reopening restores the saved folds, so they must be undone again.
				this.staleFoldsCleared.delete(uri);
				for (const key of [...this.lastGood.keys()].filter(k => k.startsWith(`${uri}#`))) {
					this.lastGood.delete(key);
				}
			}),
			vscode.window.onDidChangeActiveColorTheme(() => this.updateAll()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('mathInline') || e.affectsConfiguration('editor.fontSize')
					|| e.affectsConfiguration('editor.lineHeight')) {
					this.config = getConfig();
					this.staleFoldsCleared.clear();
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
	 * renderizan en modo display a tamaño completo, solo para detectar errores y para el chip
	 * y el hover; su dibujo en las líneas del editor lo resuelve `blockView`.
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
	 * @param document Documento de la fórmula, para ubicar las líneas de un bloque.
	 * @return `true` si la fórmula necesita la vista previa del hover: se mostraría como chip, o es un
	 * bloque `$$` dibujado por franjas (que se revela entero al editarlo). Los bloques dibujados por filas no.
	 */
	isLarge(span: MathSpan, document: vscode.TextDocument): boolean {
		const result = this.renderInEditor(span);
		if (isError(result)) {
			return false;
		}
		if (!isDisplayBlock(span)) {
			return result.fit < MIN_INLINE_SCALE;
		}
		// A block drawn by rows shows the edited row next to the cursor, so it needs no hover.
		const view = this.config.displayMath === 'render' ? this.blockView(document, span) : undefined;
		return view === undefined || isError(view) || view.kind !== 'rows';
	}

	/**
	 * @brief Decide cómo dibujar un bloque `$$` multilínea en sus propias líneas y lo renderiza.
	 *
	 * Si `layoutRows` encuentra una tabla con una fila por línea y `renderRows` da la misma
	 * cantidad de filas, se dibuja por filas (en estilo texto, con el alto de línea como máximo).
	 * Las líneas de cada fila se ubican con `texPosition`, para no correrse en documentos CRLF.
	 * Si no, se corta en franjas sobre todas las líneas del bloque, salvo que haya que achicarlo
	 * por debajo de `MIN_BAND_SCALE`: entonces devuelve `chip`, que significa que no se puede
	 * dibujar (con `displayMath` en `render`, el bloque se muestra como código).
	 *
	 * @param document Documento del bloque.
	 * @param span Bloque `$$` multilínea.
	 * @return Forma de dibujarlo, o el error de TeX.
	 */
	private blockView(document: vscode.TextDocument, span: MathSpan): BlockView | RenderError {
		const offsets = layoutRows(span.tex);
		if (offsets) {
			const rows = renderRows(span.tex, this.inlineOptions());
			if (rows && isError(rows)) {
				return rows;
			}
			if (rows?.length === offsets.length) {
				return { kind: 'rows', rows, rowLines: offsets.map(offset => texPosition(document, span, offset).line) };
			}
		}
		const lines = document.positionAt(span.end).line - document.positionAt(span.start).line + 1;
		const bands = renderBands(span.tex, { ...this.renderOptions(), maxHeight: getLineHeight() }, lines);
		if (isError(bands)) {
			return bands;
		}
		return bands.fit < MIN_BAND_SCALE ? { kind: 'chip' } : { kind: 'bands', bands };
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
	 * multilínea, con `displayMath` en `render`, se dibujan primero con `drawBlock` (que los
	 * acumula en `blocks`, `rows`, `ghosts` y las líneas ocultas); si este devuelve `false`, el
	 * bloque no se pudo dibujar (plegado a mano, demasiado chico, con error) y en este modo se
	 * muestra como código (`unfolded`): nunca como chip ni se pliega automáticamente.
	 * En el modo `chip` los bloques son chip solo si están plegados (ver `isFolded`), y su
	 * decoración cubre solo la primera línea (el resto lo oculta el plegado). Los no plegados no
	 * llevan chip: van a `unfolded` y se muestran como código, aunque se siguen incluyendo en las
	 * líneas a plegar. Los que tienen error o están revelados se despliegan. Todo se acumula en
	 * `PendingDecorations` y se aplica al final con `hiddenType`, `ghostType`, `fadedType` y
	 * `blockType`; el estado guardado incluye `blocks`, `ghosts` y `rows`. Con la extensión
	 * habilitada en modo `render`, junta las líneas de apertura de todos los bloques y llama a
	 * `unfoldStaleFolds` para desplegar los plegados de sesiones anteriores. Guarda la firma de plegado
	 * (`foldSignature`) para que el listener de `visibleRanges` detecte cambios.
	 * En los chips, `collapsedType` se aplica solo al `$` de apertura y el resto del
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
		const out: PendingDecorations = {
			hidden: [], blockLines: [], rows: [], chips: [], chipSources: [], errors: [], ghosts: [], faded: [], blocks: [],
			collapsed: [], revealed: [], unfolded: [], foldLines: [], unfoldLines: [],
		};
		const { hidden, collapsed, chips, chipSources, errors, revealed, unfolded, foldLines, unfoldLines } = out;

		const renderMode = this.config.displayMath === 'render';
		const blockStarts: number[] = [];
		let blockIndex = 0;
		for (const span of this.getSpans(editor.document)) {
			const range = new vscode.Range(editor.document.positionAt(span.start), editor.document.positionAt(span.end));
			const block = isDisplayBlock(span);
			if (!this.config.enabled) {
				if (block) {
					unfoldLines.push(range.start.line);
				}
				continue;
			}
			if (block) {
				blockStarts.push(range.start.line);
			}
			if (block && renderMode && this.drawBlock(editor, span, range, `${editor.document.uri.toString()}#${blockIndex++}`, out)) {
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
			} else if (block && (renderMode || !this.isFolded(editor, range.start.line))) {
				// Unfolded (by hand, or not folded yet): a chip over the visible TeX would only get in the way.
				// When blocks are drawn in the editor, one that cannot be drawn shows its TeX rather than a chip.
				unfolded.push(range);
				if (!renderMode) {
					foldLines.push(range.start.line);
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
				hidden.push({ range, renderOptions: { before: imageAttachment(result) } });
			}
		}

		editor.setDecorations(this.hiddenType, [...hidden, ...out.blockLines]);
		editor.setDecorations(this.collapsedType, chips);
		editor.setDecorations(this.chipSourceType, chipSources);
		editor.setDecorations(this.errorType, errors);
		editor.setDecorations(this.ghostType, out.ghosts);
		editor.setDecorations(this.fadedType, out.faded);
		editor.setDecorations(this.blockType, out.blocks);
		this.states.set(editor, {
			rendered: hidden.map(d => d.range), collapsed, errors: errors.map(d => d.range),
			revealed, unfolded, blocks: out.blocks, ghosts: out.ghosts.map(d => d.range), rows: out.rows,
		});
		this.foldSignatures.set(editor, this.foldSignature(editor));
		this.scheduleHover(editor);
		if (this.config.foldDisplayMath) {
			this.syncFolds(editor, foldLines, unfoldLines);
		}
		if (renderMode && this.config.enabled) {
			this.unfoldStaleFolds(editor, blockStarts);
		}
	}

	/**
	 * @brief Despliega una vez por documento los bloques `$$` que quedaron plegados de antes.
	 *
	 * VS Code recuerda el plegado de cada archivo entre sesiones, así que los bloques que se
	 * plegaron en el modo `chip` volverían a abrirse plegados y no se dibujarían. Se hace una sola
	 * vez por documento (y otra vez si cambia la configuración), para respetar después lo que el
	 * usuario pliegue a mano. Espera `FOLD_DELAY_MS`, porque VS Code restaura el plegado guardado
	 * cuando termina de calcular las regiones. Solo actúa sobre el editor activo; si al cumplirse la
	 * espera ya no lo es, reintenta en la próxima actualización.
	 *
	 * @param editor Editor recién actualizado.
	 * @param lines Líneas de apertura de los bloques del documento.
	 */
	private unfoldStaleFolds(editor: vscode.TextEditor, lines: number[]): void {
		const uri = editor.document.uri.toString();
		if (lines.length === 0 || editor !== vscode.window.activeTextEditor || this.staleFoldsCleared.has(uri)) {
			return;
		}
		this.staleFoldsCleared.add(uri);
		const timer = setTimeout(() => {
			this.staleTimers.delete(timer);
			if (editor === vscode.window.activeTextEditor) {
				void vscode.commands.executeCommand('editor.unfold', { selectionLines: lines, levels: 1, direction: 'up' });
			} else {
				// Retry when the editor is active again.
				this.staleFoldsCleared.delete(uri);
			}
		}, FOLD_DELAY_MS);
		this.staleTimers.add(timer);
	}

	/**
	 * @brief Dibuja un bloque `$$` multilínea en sus propias líneas, si se puede.
	 *
	 * En reposo, cada línea del bloque oculta su código: en el modo `rows` la línea donde empieza
	 * cada fila muestra su imagen (con `offset` como margen) y las demás quedan vacías; en el modo
	 * `bands` cada línea muestra su franja. Todas las líneas llevan el borde de `blockType`.
	 *
	 * Con el cursor en el bloque, en el modo `rows` solo se revelan las líneas tocadas por la
	 * selección, con la vista previa de su fila al final (`ghostType`), y las líneas delimitadoras
	 * se atenúan; el resto de las filas sigue dibujado. Si el TeX está roto, se usa el último render
	 * válido del bloque (`lastGood`) mientras tenga la misma cantidad de filas, y las líneas tocadas
	 * se subrayan con el error. En el modo `bands` se revela el bloque entero.
	 *
	 * @param editor Editor a decorar.
	 * @param span Bloque `$$` multilínea.
	 * @param range Rango del bloque en el documento.
	 * @param key Clave del bloque en `lastGood`.
	 * @param out Decoraciones en construcción.
	 * @return `false` si el bloque no se dibuja: plegado a mano, con error fuera de edición, demasiado
	 * chico (`chip`) o en edición sin un render válido previo. En el modo `render` el llamador lo
	 * muestra entonces como código, no como chip.
	 */
	private drawBlock(editor: vscode.TextEditor, span: MathSpan, range: vscode.Range, key: string, out: PendingDecorations): boolean {
		const document = editor.document;
		const touched = new Set<number>();
		for (const sel of editor.selections) {
			if (sel.start.isBeforeOrEqual(range.end) && sel.end.isAfterOrEqual(range.start)) {
				for (let line = Math.max(sel.start.line, range.start.line); line <= Math.min(sel.end.line, range.end.line); line++) {
					touched.add(line);
				}
			}
		}
		if (touched.size === 0 && this.isFolded(editor, range.start.line)) {
			return false;
		}

		let view = this.blockView(document, span);
		let error: string | undefined;
		if (isError(view)) {
			const last = this.lastGood.get(key);
			// The TeX is being typed, so tolerate unbalanced braces to keep placing the rows.
			const offsets = layoutRows(span.tex, true);
			if (touched.size === 0 || last?.kind !== 'rows' || offsets?.length !== last.rows.length) {
				return false;
			}
			error = view.error;
			view = { ...last, rowLines: offsets.map(offset => texPosition(document, span, offset).line) };
		} else if (view.kind === 'chip') {
			return false;
		} else {
			this.lastGood.set(key, view);
		}

		out.blocks.push(range);
		if (touched.size > 0) {
			out.revealed.push(range);
			out.unfoldLines.push(range.start.line);
			if (view.kind === 'bands') {
				return true;
			}
		}
		for (let line = range.start.line; line <= range.end.line; line++) {
			const lineRange = range.intersection(document.lineAt(line).range)!;
			if (view.kind === 'bands') {
				const band = view.bands.bands[line - range.start.line - view.bands.first];
				out.blockLines.push(band ? { range: lineRange, renderOptions: { before: imageAttachment(band, 'top') } } : { range: lineRange });
				continue;
			}
			const row = view.rows[view.rowLines.indexOf(line)];
			if (touched.has(line)) {
				if (error !== undefined) {
					out.errors.push({ range: lineRange, hoverMessage: `Math Inline: ${error}` });
				} else if (row) {
					const end = document.lineAt(line).range.end;
					out.ghosts.push({ range: new vscode.Range(end, end), renderOptions: { after: { ...imageAttachment(row), margin: '0 0 0 2ch' } } });
				}
			} else if (row) {
				out.blockLines.push({ range: lineRange, renderOptions: { before: { ...imageAttachment(row), margin: `0 0 0 ${row.offset}px` } } });
				out.rows.push(lineRange);
			} else if (touched.size > 0) {
				out.faded.push(lineRange);
			} else {
				out.blockLines.push({ range: lineRange });
			}
		}
		return true;
	}

	/**
	 * @brief Indica si el bloque `$$` que empieza en una línea está plegado.
	 *
	 * La API no expone el estado de plegado, pero las líneas plegadas no forman parte de
	 * `visibleRanges`: el bloque se considera plegado si su primera línea es visible, la segunda
	 * no, y hay líneas visibles más abajo. Así un bloque fuera de la pantalla, o que asoma por el
	 * borde inferior, no se confunde con uno plegado.
	 *
	 * @param editor Editor consultado.
	 * @param startLine Línea del `$$` de apertura.
	 * @return `true` si las líneas del bloque después de `startLine` están ocultas por un plegado.
	 */
	private isFolded(editor: vscode.TextEditor, startLine: number): boolean {
		const ranges = editor.visibleRanges;
		const visible = (line: number) => ranges.some(r => r.start.line <= line && line <= r.end.line);
		return visible(startLine) && !visible(startLine + 1) && ranges.some(r => r.start.line > startLine + 1);
	}

	/**
	 * @brief Resume el estado de plegado de los bloques `$$` de un editor.
	 *
	 * Permite saber, ante un cambio de `visibleRanges` (scroll o plegado), si algún bloque
	 * cambió de estado y hay que actualizar las decoraciones.
	 *
	 * @param editor Editor consultado.
	 * @return Cadena con un `1` por bloque plegado y un `0` por bloque desplegado, en orden.
	 */
	private foldSignature(editor: vscode.TextEditor): string {
		return this.getSpans(editor.document)
			.filter(isDisplayBlock)
			.map(span => (this.isFolded(editor, editor.document.positionAt(span.start).line) ? '1' : '0'))
			.join('');
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
		if (!span || !this.isLarge(span, editor.document)) {
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
	 * @brief Cancela los temporizadores pendientes (incluidos los del hover, el plegado y el desplegado de plegados viejos) y libera las decoraciones y suscripciones.
	 */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		clearTimeout(this.hoverTimer);
		clearTimeout(this.foldTimer);
		this.staleTimers.forEach(timer => clearTimeout(timer));
		this.disposables.forEach(d => d.dispose());
	}
}

/**
 * @brief Convierte un offset del TeX de una fórmula en una posición del documento.
 *
 * Usa `texLocation`, que cuenta los saltos de línea del TeX, para no correrse en documentos CRLF.
 * En la primera línea de la fórmula suma el ancho del delimitador de apertura (`$$` o `$`).
 *
 * @param document Documento de la fórmula.
 * @param span Fórmula.
 * @param offset Posición dentro de `span.tex`.
 * @return Posición correspondiente en el documento.
 */
export function texPosition(document: vscode.TextDocument, span: MathSpan, offset: number): vscode.Position {
	const start = document.positionAt(span.start);
	const { line, column } = texLocation(span, offset);
	return line === 0 ? start.translate(0, (span.display ? 2 : 1) + column) : new vscode.Position(start.line + line, column);
}

/**
 * @brief Arma el adjunto `before`/`after` de una decoración que muestra una imagen renderizada.
 *
 * @param image Imagen a mostrar.
 * @param verticalAlign `top` para alinear la imagen con el borde superior de la línea (franjas);
 * por defecto usa el `verticalAlign` de la imagen, para alinear su línea base con la del texto.
 * @return Opciones del adjunto.
 */
function imageAttachment(image: RenderedMath, verticalAlign?: 'top'): vscode.ThemableDecorationAttachmentRenderOptions {
	return {
		contentIconPath: vscode.Uri.parse(image.uri),
		width: `${image.width}px`,
		height: `${image.height}px`,
		textDecoration: `none; vertical-align: ${verticalAlign ?? `${image.verticalAlign}px`};`,
	};
}
