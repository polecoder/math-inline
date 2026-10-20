import * as vscode from 'vscode';
import { MathDecorator } from './decorator';
import { isError, render } from './renderer';

/** @brief Factor de ampliación de la fórmula mostrada en el hover. */
const HOVER_SCALE = 2;

/**
 * @brief Proveedor de hover que muestra la fórmula ampliada al pasar el mouse sobre su código fuente.
 *
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
		const result = render(span.tex, this.decorator.renderOptions(HOVER_SCALE));
		if (isError(result)) {
			// The error decoration already carries the message.
			return undefined;
		}
		return new vscode.Hover(new vscode.MarkdownString(`![math](${result.uri})`), range);
	}
}
