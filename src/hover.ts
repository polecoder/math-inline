import * as vscode from 'vscode';
import type { MathDecorator } from './decorator';
import { isError, render, RenderOptions } from './renderer';

/** @brief Factor de ampliación de la fórmula mostrada en el hover. */
export const HOVER_SCALE = 1.5;
/**
 * @brief Espacio en píxeles que VS Code reserva a la derecha de cada hover para su botón de copiar.
 *
 * Se agrega el mismo margen transparente a la izquierda de la imagen para que quede centrada.
 */
const COPY_BUTTON_GUTTER = 20;

/**
 * @brief Proveedor de hover que muestra la fórmula ampliada al pasar el mouse sobre su código fuente.
 *
 * También cubre las fórmulas grandes mostradas como chip, ya que el `$` de apertura transparente
 * queda bajo el chip y el mouse cae dentro de la fórmula. En los bloques `$$` multilínea
 * el hover aparece sobre cualquier línea del bloque, no solo la del chip.
 * Si la fórmula tiene errores de TeX no devuelve nada: el mensaje ya lo aporta la decoración de error.
 */
export class MathHoverProvider implements vscode.HoverProvider {
	/**
	 * @param decorator Decorador del que se obtienen las fórmulas parseadas y las opciones de render.
	 */
	constructor(private readonly decorator: MathDecorator) {}

	/**
	 * @brief Devuelve el hover con la fórmula renderizada bajo la posición dada.
	 *
	 * Delega en `previewMarkdown` y renderiza ampliada por `HOVER_SCALE`.
	 *
	 * @param document Documento Markdown consultado.
	 * @param position Posición del cursor del mouse.
	 * @return Hover con la imagen de la fórmula, o `undefined` si no hay fórmula en esa posición o no se pudo renderizar.
	 */
	provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const offset = document.offsetAt(position);
		const span = this.decorator.getSpans(document).find(s => s.start <= offset && offset < s.end);
		if (!span) {
			return undefined;
		}
		const range = new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
		const preview = previewMarkdown(span.tex, this.decorator.renderOptions(HOVER_SCALE));
		// On a TeX error the error decoration already carries the message.
		return preview && new vscode.Hover(preview, range);
	}
}

/**
 * @brief Arma el contenido de hover con la fórmula renderizada en modo display.
 *
 * Envuelve la imagen en un SVG con un margen transparente a la izquierda de
 * `COPY_BUTTON_GUTTER` píxeles, igual al espacio que VS Code reserva a la derecha
 * para su botón de copiar, de modo que la fórmula quede centrada en el hover.
 * Lo usa `MathHoverProvider.provideHover`.
 *
 * @param tex Código TeX de la fórmula.
 * @param options Opciones de render (color y escala); `display` se fuerza a `true`.
 * @return Markdown con la imagen SVG codificada en base64, o `undefined` si el TeX no es válido.
 */
export function previewMarkdown(tex: string, options: RenderOptions): vscode.MarkdownString | undefined {
	const result = render(tex, { ...options, display: true });
	if (isError(result)) {
		return undefined;
	}
	const width = result.width + COPY_BUTTON_GUTTER;
	const padded = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${result.height}">`
		+ `<image href="${result.uri}" x="${COPY_BUTTON_GUTTER}" width="${result.width}" height="${result.height}"/></svg>`;
	return new vscode.MarkdownString(`![math](data:image/svg+xml;base64,${Buffer.from(padded).toString('base64')})`);
}
