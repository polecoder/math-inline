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
/** @brief Altura, en em de la fuente del editor, del centro de la línea sobre la línea base del texto (la mitad de la x-height, aprox.). */
const AXIS_EM = 0.25;
/** @brief Texto del chip que reemplaza a las fórmulas demasiado grandes. */
const CHIP_TEXT = '∑ show formula';
/** @brief Ancho del chip, en caracteres (`ch`) de la fuente del editor. */
const CHIP_WIDTH_CH = 16;
/** @brief Espera en milisegundos antes de abrir el hover de una fórmula grande bajo el cursor. */
const HOVER_DELAY_MS = 300;
/**
 * @brief Espera en milisegundos antes de desplegar los bloques `$$` que quedaron plegados de antes.
 *
 * Da tiempo a que VS Code restaure el plegado guardado del documento; desplegar antes no tendría efecto.
 */
const FOLD_DELAY_MS = 500;
/** @brief Achique mínimo aceptable para un bloque `$$` cortado en franjas; si necesita más, no se dibuja en el editor. */
const MIN_BAND_SCALE = 0.5;
/**
 * @brief Margen mínimo, en líneas, que se decora arriba y abajo de la zona visible del editor.
 *
 * El margen real es el mayor entre este valor y el alto de la zona visible (ver `lineWindow`).
 */
export const MIN_WINDOW_MARGIN = 50;
/**
 * @brief Arma el mensaje para una fórmula en edición cuyo delimitador de cierre dejó de valer.
 *
 * Según las reglas de Pandoc (ver `findMath`), un delimitador escapado con `\` no cierra la
 * fórmula, y el `$` de cierre inline tampoco puede ir precedido de un espacio; entonces la fórmula
 * sigue hasta un delimitador posterior que sí cierre.
 *
 * @param delimiter Delimitador de cierre (`$` o `$$`).
 * @param before Carácter del TeX justo antes del delimitador.
 * @return Mensaje que explica por qué el delimitador no cierra.
 */
function closingDelimiterError(delimiter: string, before: string): string {
	const cause = before === '\\' ? 'it is escaped' : 'it follows a space';
	return `this ${delimiter} does not close the formula (${cause}), so the formula runs on to a later ${delimiter}`;
}
/** @brief Opacidad de las líneas delimitadoras (`$$`, `\begin`, `\end`) de un bloque mientras se edita. */
const FADED_OPACITY = '0.45';

/**
 * @brief Forma en que se dibuja un bloque `$$` multilínea en sus propias líneas.
 *
 * `rows`: una tabla con una imagen por fila; `rowLines` tiene la línea del documento donde empieza cada fila.
 * `bands`: cualquier fórmula, cortada en franjas del alto de una línea.
 * `unfit`: no entra con una escala aceptable, o sea que no se puede dibujar en el editor y se
 * muestra como código.
 */
type BlockView =
	| { kind: 'rows'; rows: RenderedRow[]; rowLines: number[] }
	| { kind: 'bands'; bands: RenderedBands }
	| { kind: 'unfit' };

/**
 * @brief Decoraciones que `update` acumula para un editor antes de aplicarlas.
 */
interface PendingDecorations {
	/** Fórmulas inline ocultas, con su imagen en `before`. */
	hidden: vscode.DecorationOptions[];
	/** Líneas ocultas de los bloques dibujados en el editor, con su fila o franja en `before` (o vacías). */
	blockLines: vscode.DecorationOptions[];
	/** `$` de apertura de las fórmulas inline mostradas como chip. */
	chips: vscode.DecorationOptions[];
	/** Resto del código de las fórmulas inline mostradas como chip. */
	chipSources: vscode.DecorationOptions[];
	/** Fórmulas o líneas con error de TeX. */
	errors: vscode.DecorationOptions[];
	/** Vista previa de la fila en edición, al final de su línea, o de la fórmula inline en edición, después de su `$` de cierre. */
	ghosts: vscode.DecorationOptions[];
	/** Líneas delimitadoras atenuadas de un bloque en edición. */
	faded: vscode.Range[];
	/** Líneas que muestran la imagen de una fila. */
	rows: vscode.Range[];
	/** Bloques dibujados en el editor, marcados con un borde a la izquierda. */
	blocks: vscode.Range[];
	/** Fórmulas inline mostradas como chip. */
	collapsed: vscode.Range[];
	/** Fórmulas que tocan una selección. */
	revealed: vscode.Range[];
	/** Bloques que no se pueden dibujar y se muestran como código. */
	unfolded: vscode.Range[];
}

/**
 * @brief Decoraciones aplicadas por última vez a un editor.
 *
 * Los rangos corresponden solo a las fórmulas del tramo de líneas decorado (ver `lineWindow`),
 * no a las de todo el documento.
 */
export interface EditorMathState {
	/** Rangos de las fórmulas renderizadas correctamente (solo las del tramo decorado). */
	rendered: vscode.Range[];
	/** Rangos de las fórmulas inline demasiado grandes, mostradas como chip. */
	collapsed: vscode.Range[];
	/** Rangos de las fórmulas con error de TeX. */
	errors: vscode.Range[];
	/** Rangos de las fórmulas que se muestran como código porque el cursor las toca. */
	revealed: vscode.Range[];
	/** Rangos de los bloques `$$` que se muestran como código porque no se pueden dibujar (plegados a mano o demasiado chicos). */
	unfolded: vscode.Range[];
	/** Rangos de los bloques `$$` dibujados en sus propias líneas (por filas o por franjas). */
	blocks: vscode.Range[];
	/** Rangos (vacíos) donde se muestra la vista previa de la fila o de la fórmula inline en edición. */
	ghosts: vscode.Range[];
	/** Rangos de las líneas que muestran la imagen de una fila de un bloque dibujado por filas. */
	rows: vscode.Range[];
}

/**
 * @brief Tramo de líneas de un editor cuyas fórmulas se decoran: la zona visible más un margen arriba y abajo.
 */
interface LineWindow {
	/** Primera línea del tramo (al menos 0). */
	start: number;
	/** Última línea del tramo (a lo sumo la última del documento). */
	end: number;
	/** Margen, en líneas, que se agregó a cada lado de la zona visible. */
	margin: number;
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
 * Las fórmulas inline (y `$$...$$` de una línea) en edición muestran una vista previa pegada a su `$`
 * de cierre (salvo los chips, que usan el hover); si el TeX es inválido, se subrayan y se conserva el
 * último render válido de esa misma fórmula (`lastGoodInline`).
 * Los bloques `$$` multilínea se dibujan en sus propias líneas: una imagen por fila si son una tabla, o franjas del alto de una línea si no; al editarlos se revelan las líneas tocadas y se
 * muestra la vista previa de la fila. Los bloques nunca son chip ni tienen hover: uno que no se
 * puede dibujar (plegado a mano, demasiado chico o con error) se muestra como código y nunca se
 * pliega automáticamente. Como VS Code recuerda los plegados entre sesiones, los que quedaron de
 * antes se despliegan una vez por documento.
 * Las fórmulas inline que habría que achicar por debajo de `MIN_INLINE_SCALE` se muestran como un
 * chip `CHIP_TEXT`. El chip no lleva `hoverMessage`: la vista previa ampliada la aporta
 * `MathHoverProvider`, y al poner el cursor dentro de una de ellas se abre su hover automáticamente.
 * Se actualiza ante cambios de editores, selección, documento, tema y configuración.
 */
export class MathDecorator implements vscode.Disposable {
	private readonly hiddenType = vscode.window.createTextEditorDecorationType({
		textDecoration: HIDE_SOURCE_CSS,
	});
	/**
	 * @brief Decoración del chip de las fórmulas inline grandes, aplicada solo al `$` de apertura.
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
	/** @brief Decoración de la vista previa de la fila de bloque o de la fórmula inline en edición; la imagen va en `after` de cada decoración. */
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
	/** Tramo de líneas decorado en la última actualización de cada editor (ver `lineWindow`). */
	private readonly windows = new WeakMap<vscode.TextEditor, LineWindow>();
	/** Último render válido de cada bloque dibujado por filas, por `uri#índice del bloque`, para seguir mostrándolo mientras el TeX está roto. */
	private readonly lastGood = new Map<string, BlockView>();
	/** Último render válido de la fórmula inline en edición de cada documento, por URI, con los offsets de inicio y fin de la fórmula. */
	private readonly lastGoodInline = new Map<string, { start: number; end: number; image: RenderedMath }>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly disposables: vscode.Disposable[] = [];
	private config: MathInlineConfig = getConfig();
	/** Tamaño de fuente y alto de línea del editor en px; se releen solo al cambiar la configuración, porque leerla en cada fórmula es caro. */
	private metrics = readMetrics();
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private lastHoverKey: string | undefined;
	/** Documentos cuyos bloques plegados de antes ya se desplegaron (ver `unfoldStaleFolds`). */
	private readonly staleFoldsCleared = new Set<string>();
	/** Temporizadores pendientes de `unfoldStaleFolds`, para cancelarlos en `dispose`. */
	private readonly staleTimers = new Set<ReturnType<typeof setTimeout>>();

	/**
	 * @brief Crea los tipos de decoración, suscribe los eventos relevantes y hace una primera actualización.
	 *
	 * Además de `mathInline.*`, reacciona a los cambios de `editor.fontSize` y `editor.lineHeight`.
	 * También se suscribe a `onDidChangeActiveTextEditor`, porque `unfoldStaleFolds` solo actúa
	 * sobre el editor activo y hay que actualizarlo cuando recibe el foco. Con
	 * `onDidChangeTextEditorVisibleRanges` (plegado, desplegado o scroll) actualiza el editor
	 * solo si cambió `foldSignature` (un bloque plegado a mano no se dibuja) o si `nearWindowEdge`
	 * indica que el scroll se acercó al borde del tramo decorado. Al cerrar un
	 * documento descarta sus fórmulas parseadas, su entrada de `lastGoodInline` y sus entradas de
	 * `lastGood`. Ante un cambio de documento llama a `trackInlineEdits` y programa la actualización.
	 * Ante un cambio de tema vacía `lastGoodInline` (las vistas previas guardadas llevan el color
	 * viejo) y actualiza todos los editores. Ante un cambio de configuración relee `getConfig()` y
	 * `readMetrics()`, vacía `staleFoldsCleared` (para volver a desplegar los plegados de antes, ver
	 * `unfoldStaleFolds`) y `lastGoodInline`, y actualiza todos los editores.
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
			// Folding or unfolding a block changes the visible ranges, and a folded block is not drawn.
			// Scrolling near the edge of the decorated lines needs the formulas further on.
			vscode.window.onDidChangeTextEditorVisibleRanges(e => {
				if (this.foldSignatures.get(e.textEditor) !== this.foldSignature(e.textEditor) || this.nearWindowEdge(e.textEditor)) {
					this.update(e.textEditor);
				}
			}),
			vscode.workspace.onDidChangeTextDocument(e => {
				this.trackInlineEdits(e);
				this.scheduleUpdate(e.document);
			}),
			vscode.workspace.onDidCloseTextDocument(doc => {
				const uri = doc.uri.toString();
				this.parsed.delete(uri);
				this.lastGoodInline.delete(uri);
				// Reopening restores the saved folds, so they must be undone again.
				this.staleFoldsCleared.delete(uri);
				for (const key of [...this.lastGood.keys()].filter(k => k.startsWith(`${uri}#`))) {
					this.lastGood.delete(key);
				}
			}),
			vscode.window.onDidChangeActiveColorTheme(() => {
				// The saved previews carry the old color.
				this.lastGoodInline.clear();
				this.updateAll();
			}),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('mathInline') || e.affectsConfiguration('editor.fontSize')
					|| e.affectsConfiguration('editor.lineHeight')) {
					this.config = getConfig();
					this.metrics = readMetrics();
					this.staleFoldsCleared.clear();
					this.lastGoodInline.clear();
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
			exPx: this.metrics.fontSize * EX_PER_EM * this.config.scale * scale,
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
		return { ...this.renderOptions(), textStyle: true, maxHeight: this.metrics.lineHeight };
	}

	/**
	 * @brief Renderiza una fórmula tal como se dibuja dentro del editor.
	 *
	 * Las fórmulas inline usan `inlineOptions()`. Las `$$...$$` de una sola línea usan el
	 * mismo alto máximo pero en modo display y sin `textStyle`. Los bloques multilínea se
	 * renderizan en modo display a tamaño completo, solo para detectar errores; su dibujo en las
	 * líneas del editor lo resuelve `blockView`.
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
	 * @brief Indica si una fórmula inline es demasiado grande para mostrarse en la línea.
	 *
	 * Es grande si al renderizarla con `renderInEditor` debe achicarse por debajo de
	 * `MIN_INLINE_SCALE` para entrar en una línea. Las fórmulas con error y los bloques `$$`
	 * multilínea (que nunca son chip ni tienen hover) no cuentan.
	 *
	 * @param span Fórmula a examinar.
	 * @return `true` si la fórmula se muestra como chip y necesita la vista previa del hover.
	 */
	isLarge(span: MathSpan): boolean {
		if (isDisplayBlock(span)) {
			return false;
		}
		const result = this.renderInEditor(span);
		return !isError(result) && result.fit < MIN_INLINE_SCALE;
	}

	/**
	 * @brief Decide cómo dibujar un bloque `$$` multilínea en sus propias líneas y lo renderiza.
	 *
	 * Si `layoutRows` encuentra una tabla con una fila por línea y `renderRows` da la misma
	 * cantidad de filas, se dibuja por filas (en estilo texto, todas a la misma escala y desbordando
	 * sobre el espacio libre de las líneas vecinas si hace falta; ver `renderRows`).
	 * Las líneas de cada fila se ubican con `texPosition`, para no correrse en documentos CRLF.
	 * A `renderRows` se le pasa un `RowLayout` con las líneas relativas al inicio del bloque, la
	 * cantidad de líneas y `axis` (`AXIS_EM` por el tamaño de fuente del editor).
	 * Si no, se corta en franjas sobre todas las líneas del bloque, salvo que haya que achicarlo
	 * por debajo de `MIN_BAND_SCALE`: entonces devuelve `unfit`, que significa que no se puede
	 * dibujar (el bloque se muestra como código).
	 *
	 * @param document Documento del bloque.
	 * @param span Bloque `$$` multilínea.
	 * @return Forma de dibujarlo, o el error de TeX.
	 */
	private blockView(document: vscode.TextDocument, span: MathSpan): BlockView | RenderError {
		const startLine = document.positionAt(span.start).line;
		const lines = document.positionAt(span.end).line - startLine + 1;
		const offsets = layoutRows(span.tex);
		if (offsets) {
			const rowLines = offsets.map(offset => texPosition(document, span, offset).line);
			const layout = { rowLines: rowLines.map(line => line - startLine), lines, axis: this.metrics.fontSize * AXIS_EM };
			const rows = renderRows(span.tex, this.inlineOptions(), layout);
			if (rows && isError(rows)) {
				return rows;
			}
			if (rows?.length === offsets.length) {
				return { kind: 'rows', rows, rowLines };
			}
		}
		const bands = renderBands(span.tex, { ...this.renderOptions(), maxHeight: this.metrics.lineHeight }, lines);
		if (isError(bands)) {
			return bands;
		}
		return bands.fit < MIN_BAND_SCALE ? { kind: 'unfit' } : { kind: 'bands', bands };
	}

	/**
	 * @brief Devuelve las últimas decoraciones aplicadas a un editor, para tests y diagnóstico.
	 *
	 * Los rangos son solo los de las fórmulas del tramo decorado, no los de todo el documento.
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
	 * Solo decora las fórmulas dentro de `lineWindow(editor)` (la zona visible más un margen) y
	 * guarda ese tramo en `windows`; las demás se saltean. Todos los bloques se cuentan igual
	 * (`blockIndex`, que da las claves de `lastGood`, y `blockStarts`), para que no dependan del scroll.
	 * Las fórmulas tocadas por alguna selección quedan reveladas (en `revealed`, como texto); las
	 * inline (y `$$...$$` de una línea) reveladas pasan por `previewInline`, que agrega su vista previa
	 * en `ghosts` y, si el TeX es inválido o el delimitador de cierre dejó de valer, el subrayado
	 * de error. Las demás inválidas se subrayan
	 * con el mensaje de error, las que requerirían un achique menor
	 * a `MIN_INLINE_SCALE` quedan como chip (`collapsed`) y el resto se reemplaza por su
	 * imagen. Los `$$...$$` de una sola línea se renderizan en modo display. Los bloques
	 * multilínea se dibujan primero con `drawBlock` (que los acumula en `blocks`, `rows`, `ghosts`
	 * y las líneas ocultas); si este devuelve `false`, el bloque no se pudo dibujar (plegado a
	 * mano, demasiado chico, con error) y se muestra como código (en `unfolded`, o en `revealed` o
	 * `errors` si corresponde): nunca como chip ni se pliega automáticamente. Todo se acumula en
	 * `PendingDecorations` y se aplica al final con `hiddenType`, `ghostType`, `fadedType` y
	 * `blockType`; el estado guardado incluye `blocks`, `ghosts` y `rows`. Con la extensión
	 * habilitada, junta las líneas de apertura de todos los bloques y llama a
	 * `unfoldStaleFolds` para desplegar los plegados de sesiones anteriores. Guarda la firma de plegado
	 * (`foldSignature`) para que el listener de `visibleRanges` detecte cambios.
	 * En los chips, `collapsedType` se aplica solo al `$` de apertura y el resto del
	 * código se oculta con `chipSourceType`; no llevan `hoverMessage`, porque el mouse sobre el chip
	 * cae dentro de la fórmula y la vista previa la da `MathHoverProvider`. Renderiza con
	 * `textStyle` y con `maxHeight` igual al alto de línea del editor, para que las fórmulas
	 * entren en una línea (el hover no se ve afectado).
	 * Al final llama a `scheduleHover` para abrir el hover de una fórmula inline grande bajo el cursor.
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
			collapsed: [], revealed: [], unfolded: [],
		};
		const { hidden, collapsed, chips, chipSources, errors, revealed, unfolded } = out;

		const blockStarts: number[] = [];
		let blockIndex = 0;
		const window = lineWindow(editor);
		for (const span of this.config.enabled ? this.getSpans(editor.document) : []) {
			const range = new vscode.Range(editor.document.positionAt(span.start), editor.document.positionAt(span.end));
			const block = isDisplayBlock(span);
			// Counted for every block, so that the `lastGood` keys don't depend on the scroll position.
			const key = block ? `${editor.document.uri.toString()}#${blockIndex++}` : '';
			if (block) {
				blockStarts.push(range.start.line);
			}
			// Decorating every formula of a long document on each cursor move is too slow.
			if (range.end.line < window.start || range.start.line > window.end) {
				continue;
			}
			if (block && this.drawBlock(editor, span, range, key, out)) {
				continue;
			}
			if (editor.selections.some(sel => sel.start.isBeforeOrEqual(range.end) && sel.end.isAfterOrEqual(range.start))) {
				revealed.push(range);
				if (!block) {
					this.previewInline(editor.document, span, range, out);
				}
				continue;
			}
			const result = this.renderInEditor(span);
			if (isError(result)) {
				errors.push({ range, hoverMessage: `Math Inline: ${result.error}` });
			} else if (block) {
				// A block that cannot be drawn in the editor shows its TeX, never a chip.
				unfolded.push(range);
			} else if (result.fit < MIN_INLINE_SCALE) {
				// The preview comes from MathHoverProvider, since the opening `$` stays as hoverable text under the chip.
				collapsed.push(range);
				chips.push({ range: new vscode.Range(range.start, range.start.translate(0, 1)) });
				chipSources.push({ range: new vscode.Range(range.start.translate(0, 1), range.end) });
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
		this.windows.set(editor, window);
		this.scheduleHover(editor);
		if (this.config.enabled) {
			this.unfoldStaleFolds(editor, blockStarts);
		}
	}

	/**
	 * @brief Muestra la vista previa de una fórmula inline en edición, pegada a su `$` de cierre.
	 *
	 * La imagen va en el `after` de una decoración vacía en el final de la fórmula (`ghosts`). Las
	 * fórmulas que van como chip no llevan vista previa: la da el hover que abre `scheduleHover`.
	 * Si el TeX es inválido, la fórmula se subraya con el error y se muestra el último render válido
	 * de esa fórmula (`lastGoodInline`), si lo hay.
	 * Si la edición invalidó el delimitador de cierre de la fórmula guardada (por ejemplo, con un
	 * espacio antes del `$`), el parser sigue hasta un `$` posterior y `span` abarca texto y fórmulas
	 * que le siguen. En ese caso la vista previa se limita a la fórmula en edición, hasta su `$` de
	 * cierre, que se subraya con el mensaje de `closingDelimiterError` (más el error de TeX, si lo hay).
	 * Como `span` es de una sola línea, `span.tex` es exactamente el texto entre sus delimitadores y
	 * la fórmula en edición se recorta sobre él.
	 *
	 * @param document Documento de la fórmula.
	 * @param span Fórmula inline (o `$$...$$` de una línea) tocada por una selección.
	 * @param range Rango de la fórmula en el documento.
	 * @param out Decoraciones en construcción.
	 */
	private previewInline(document: vscode.TextDocument, span: MathSpan, range: vscode.Range, out: PendingDecorations): void {
		const uri = document.uri.toString();
		const last = this.lastGoodInline.get(uri);
		let target = span;
		let targetRange = range;
		const messages: string[] = [];
		if (last?.start === span.start && last.end < span.end) {
			const delimiter = span.display ? '$$' : '$';
			// Index in `span.tex` where the saved closing delimiter would be.
			const texEnd = last.end - span.start - 2 * delimiter.length;
			if (texEnd >= 0 && span.tex.startsWith(delimiter, texEnd)) {
				// The parser ran past the closing delimiter of the formula being edited, so preview only that formula.
				target = { ...span, end: last.end, tex: span.tex.slice(0, texEnd) };
				targetRange = new vscode.Range(range.start, document.positionAt(last.end));
				messages.push(closingDelimiterError(delimiter, span.tex.charAt(texEnd - 1)));
			}
		}
		const result = this.renderInEditor(target);
		if (isError(result)) {
			messages.push(result.error);
		}
		if (messages.length > 0) {
			out.errors.push({ range: targetRange, hoverMessage: `Math Inline: ${messages.join('; ')}` });
		}
		let image: RenderedMath | undefined;
		// Edits outside the formula drop the entry (see `trackInlineEdits`), so matching bounds mean the same formula.
		const same = last?.start === target.start && last.end === target.end;
		if (isError(result)) {
			image = same ? last.image : undefined;
		} else if (result.fit >= MIN_INLINE_SCALE) {
			this.lastGoodInline.set(uri, { start: target.start, end: target.end, image: result });
			image = result;
		} else if (same) {
			// A chip shows no preview, so an error right after it must not bring back an older render.
			this.lastGoodInline.delete(uri);
		}
		if (image) {
			out.ghosts.push({ range: new vscode.Range(targetRange.end, targetRange.end), renderOptions: { after: { ...imageAttachment(image), margin: '0 0 0 1ch' } } });
		}
	}

	/**
	 * @brief Mantiene `lastGoodInline` al día ante una edición del documento.
	 *
	 * Si todos los cambios caen dentro de la fórmula guardada (entre sus delimitadores), corre su fin
	 * según el texto agregado o quitado; si alguno cae fuera, descarta la entrada, porque otra
	 * fórmula podría quedar en la misma posición.
	 *
	 * @param e Evento de cambio del documento.
	 */
	private trackInlineEdits(e: vscode.TextDocumentChangeEvent): void {
		const uri = e.document.uri.toString();
		const last = this.lastGoodInline.get(uri);
		if (!last) {
			return;
		}
		let delta = 0;
		for (const change of e.contentChanges) {
			if (change.rangeOffset <= last.start || change.rangeOffset + change.rangeLength >= last.end) {
				this.lastGoodInline.delete(uri);
				return;
			}
			delta += change.text.length - change.rangeLength;
		}
		last.end += delta;
	}

	/**
	 * @brief Despliega una vez por documento los bloques `$$` que quedaron plegados de antes.
	 *
	 * VS Code recuerda el plegado de cada archivo entre sesiones, así que los bloques plegados antes
	 * (por ejemplo, por versiones anteriores de la extensión que plegaban los bloques automáticamente)
	 * volverían a abrirse plegados y no se dibujarían. Se hace una sola
	 * vez por documento (y otra vez si cambia la configuración), para respetar después lo que el
	 * usuario pliegue a mano. Espera `FOLD_DELAY_MS`, porque VS Code restaura el plegado guardado
	 * cuando termina de calcular las regiones. Solo actúa sobre el editor activo; si al cumplirse la
	 * espera ya no lo es, reintenta en la próxima actualización. Si durante la espera la extensión
	 * se deshabilitó, el temporizador no hace nada (ni despliega ni reintenta).
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
			// The extension may have been disabled while waiting.
			if (!this.config.enabled) {
				return;
			}
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
	 * Las imágenes de las filas (y la vista previa `ghost`) llevan un `margin-top` negativo igual a su
	 * alto: así una fila más alta que la línea no agranda la caja de línea ni desplaza el texto, y
	 * desborda sobre las líneas vecinas.
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
	 * chico (`unfit`) o en edición sin un render válido previo. El llamador lo muestra entonces como código.
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
		} else if (view.kind === 'unfit') {
			return false;
		} else {
			this.lastGood.set(key, view);
		}

		out.blocks.push(range);
		if (touched.size > 0) {
			out.revealed.push(range);
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
					out.ghosts.push({ range: new vscode.Range(end, end), renderOptions: { after: { ...imageAttachment(row), margin: `-${row.height}px 0 0 2ch` } } });
				}
			} else if (row) {
				// The negative top margin keeps a row taller than the line from growing the line box (which
				// would push its baseline down): the image overflows into the neighbouring lines instead.
				out.blockLines.push({ range: lineRange, renderOptions: { before: { ...imageAttachment(row), margin: `-${row.height}px 0 0 ${row.offset}px` } } });
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
	 * @brief Indica si la zona visible de un editor se acercó al borde del tramo decorado.
	 *
	 * Es así si la última actualización no tenía zona visible (decoró todo el documento) o si
	 * quedan menos de medio margen de líneas decoradas entre la zona visible y un borde del
	 * tramo que no es el principio ni el final del documento.
	 *
	 * @param editor Editor consultado.
	 * @return `true` si hay que actualizar para decorar las fórmulas que se acercan al hacer scroll.
	 */
	private nearWindowEdge(editor: vscode.TextEditor): boolean {
		const window = this.windows.get(editor);
		const ranges = editor.visibleRanges;
		if (!window || ranges.length === 0) {
			return false;
		}
		if (window.margin === 0) {
			// The last update had no visible area and decorated the whole document.
			return true;
		}
		const first = ranges[0].start.line;
		const last = ranges[ranges.length - 1].end.line;
		return (window.start > 0 && first < window.start + window.margin / 2)
			|| (window.end < editor.document.lineCount - 1 && last > window.end - window.margin / 2);
	}

	/**
	 * @brief Abre el hover de la fórmula inline grande bajo el cursor, si la hay.
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
	 * @brief Identifica la fórmula inline grande que contiene al cursor, junto con la versión del documento.
	 *
	 * @param editor Editor a consultar.
	 * @return Clave `uri:inicio:versión`, o `undefined` si hay varias selecciones o una no vacía,
	 * o si el cursor no está dentro de una fórmula inline grande.
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
	 * @brief Cancela los temporizadores pendientes (incluidos los del hover y el desplegado de plegados viejos) y libera las decoraciones y suscripciones.
	 */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		clearTimeout(this.hoverTimer);
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
 * @brief Calcula el tramo de líneas de un editor cuyas fórmulas se decoran.
 *
 * Es la zona visible (de la primera a la última línea de `visibleRanges`) más un margen arriba y
 * abajo del mayor entre su alto (sin contar las líneas plegadas) y
 * `MIN_WINDOW_MARGIN`, recortado al documento. Si el editor no informa zona visible, abarca
 * todo el documento (con `margin` en 0).
 *
 * @param editor Editor consultado.
 * @return Tramo de líneas a decorar.
 */
function lineWindow(editor: vscode.TextEditor): LineWindow {
	const ranges = editor.visibleRanges;
	const lastLine = editor.document.lineCount - 1;
	if (ranges.length === 0) {
		return { start: 0, end: lastLine, margin: 0 };
	}
	const first = ranges[0].start.line;
	const last = ranges[ranges.length - 1].end.line;
	// Folded lines lie between the visible ranges, so they must not count towards the height.
	const height = ranges.reduce((lines, r) => lines + r.end.line - r.start.line + 1, 0);
	const margin = Math.max(MIN_WINDOW_MARGIN, height);
	return { start: Math.max(0, first - margin), end: Math.min(lastLine, last + margin), margin };
}

/**
 * @brief Lee el tamaño de fuente y el alto de línea del editor.
 *
 * @return Tamaño de fuente (`getFontSize`) y alto de línea (`getLineHeight`), en píxeles.
 */
function readMetrics(): { fontSize: number; lineHeight: number } {
	return { fontSize: getFontSize(), lineHeight: getLineHeight() };
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
