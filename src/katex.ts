import * as vscode from 'vscode';
import katex from 'katex';
import { texPosition, type MathDecorator } from './decorator';
import { isError, render } from './renderer';
import { getConfig } from './config';
import type { MathSpan } from './parser';

/** @brief Espera en milisegundos antes de revisar un documento tras editarlo. */
const CHECK_DELAY_MS = 500;
/** @brief Nombre de la colección de diagnósticos (aparece como origen en el panel Problems). */
const SOURCE = 'Math Inline';

/**
 * @brief Avisa con diagnósticos las fórmulas que MathJax renderiza pero KaTeX no.
 *
 * La vista previa de Markdown de VS Code dibuja la matemática con KaTeX, que no soporta todo
 * lo que soporta MathJax: una fórmula que acá se ve bien puede aparecer rota en la vista previa.
 * Las fórmulas con error de MathJax no se avisan, porque ya las subraya `MathDecorator`.
 * Se desactiva con `mathInline.katexWarnings`.
 */
export class KatexDiagnostics implements vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection(SOURCE);
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly disposables: vscode.Disposable[] = [];

	/**
	 * @brief Suscribe los eventos de documentos y configuración y revisa los documentos abiertos.
	 *
	 * @param decorator Decorador del que se obtienen las fórmulas parseadas y las opciones de render.
	 */
	constructor(private readonly decorator: MathDecorator) {
		this.disposables.push(
			this.collection,
			vscode.workspace.onDidOpenTextDocument(doc => this.check(doc)),
			vscode.workspace.onDidChangeTextDocument(e => this.schedule(e.document)),
			vscode.workspace.onDidCloseTextDocument(doc => this.collection.delete(doc.uri)),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('mathInline')) {
					vscode.workspace.textDocuments.forEach(doc => this.check(doc));
				}
			}),
		);
		vscode.workspace.textDocuments.forEach(doc => this.check(doc));
	}

	/**
	 * @brief Revisa las fórmulas de un documento Markdown y publica sus diagnósticos.
	 *
	 * Si la extensión o `mathInline.katexWarnings` están desactivados, borra los diagnósticos del documento.
	 * El rango de cada diagnóstico se ubica con `texPosition` (correcto también en documentos CRLF);
	 * si KaTeX no informa una posición, abarca la fórmula entera.
	 *
	 * @param document Documento a revisar.
	 */
	check(document: vscode.TextDocument): void {
		if (document.languageId !== 'markdown') {
			return;
		}
		const config = getConfig();
		if (!config.enabled || !config.katexWarnings) {
			this.collection.delete(document.uri);
			return;
		}
		const diagnostics: vscode.Diagnostic[] = [];
		for (const span of this.decorator.getSpans(document)) {
			const problem = katexProblem(span);
			if (!problem || isError(render(span.tex, { ...this.decorator.renderOptions(), display: span.display }))) {
				continue;
			}
			const range = problem.position === undefined
				? new vscode.Range(document.positionAt(span.start), document.positionAt(span.end))
				: new vscode.Range(
					texPosition(document, span, problem.position),
					texPosition(document, span, Math.min(span.tex.length, problem.position + Math.max(1, problem.length))),
				);
			const diagnostic = new vscode.Diagnostic(
				range,
				`VS Code's Markdown preview (KaTeX) cannot render this formula: ${problem.message}`,
				vscode.DiagnosticSeverity.Warning,
			);
			diagnostic.source = SOURCE;
			diagnostics.push(diagnostic);
		}
		this.collection.set(document.uri, diagnostics);
	}

	/**
	 * @brief Devuelve los diagnósticos publicados para un documento, para tests.
	 *
	 * @param uri URI del documento.
	 * @return Diagnósticos del documento.
	 */
	getDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
		return this.collection.get(uri) ?? [];
	}

	/**
	 * @brief Programa, con debounce, la revisión de un documento que cambió.
	 *
	 * @param document Documento que cambió.
	 */
	private schedule(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		clearTimeout(this.timers.get(key));
		this.timers.set(key, setTimeout(() => {
			this.timers.delete(key);
			this.check(document);
		}, CHECK_DELAY_MS));
	}

	/**
	 * @brief Cancela las revisiones pendientes y libera la colección y las suscripciones.
	 */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.disposables.forEach(d => d.dispose());
	}
}

/**
 * @brief Problema de KaTeX con una fórmula.
 */
interface KatexProblem {
	/** Mensaje de KaTeX, sin el prefijo `KaTeX parse error:`. */
	message: string;
	/** Offset dentro del TeX donde KaTeX detectó el error, si lo informa. */
	position?: number;
	/** Largo del fragmento señalado por KaTeX. */
	length: number;
}

/**
 * @brief Intenta renderizar una fórmula con KaTeX, como lo haría la vista previa de Markdown.
 *
 * @param span Fórmula a probar.
 * @return El problema que encontró KaTeX, o `undefined` si la renderiza.
 */
export function katexProblem(span: MathSpan): KatexProblem | undefined {
	try {
		katex.renderToString(span.tex, { displayMode: span.display === true, throwOnError: true, strict: 'ignore' });
		return undefined;
	} catch (err) {
		if (!(err instanceof katex.ParseError)) {
			return { message: String(err), length: 0 };
		}
		const parseError = err as katex.ParseError & { rawMessage?: string; length?: number };
		return {
			message: parseError.rawMessage ?? parseError.message.replace(/^KaTeX parse error: /, ''),
			position: parseError.position,
			length: parseError.length ?? 0,
		};
	}
}
