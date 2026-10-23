import * as vscode from 'vscode';
import type { MathDecorator } from './decorator';
import { isDisplayBlock } from './parser';

/**
 * @brief Proveedor de regiones de plegado para los bloques `$$...$$` multilínea.
 *
 * Cada región va desde la línea del `$$` de apertura hasta la del de cierre, de modo que al
 * plegarla solo queda visible la primera línea, donde `MathDecorator` dibuja el chip.
 */
export class MathFoldingProvider implements vscode.FoldingRangeProvider {
	/**
	 * @param decorator Decorador del que se obtienen las fórmulas parseadas.
	 */
	constructor(private readonly decorator: MathDecorator) {}

	/**
	 * @brief Devuelve una región de plegado por cada bloque `$$` multilínea del documento.
	 *
	 * @param document Documento Markdown consultado.
	 * @return Regiones de plegado de los bloques.
	 */
	provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
		return this.decorator.getSpans(document)
			.filter(isDisplayBlock)
			.map(span => new vscode.FoldingRange(document.positionAt(span.start).line, document.positionAt(span.end).line));
	}
}
