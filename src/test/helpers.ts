import * as vscode from 'vscode';
import type { MathInlineApi } from '../extension';

/** @brief Identificador de la extensión (`publisher.name`) usado para activarla en los tests. */
export const EXTENSION_ID = 'polecoder.math-inline';
/** @brief Fórmula demasiado alta para mostrarse inline (se muestra como chip). */
export const BIG_TEX = String.raw`\left[\overline{X}_n\pm\dfrac{\sqrt{\overline{X}_n(1-\overline{X}_n)}\,z_{\alpha/2}}{\sqrt n}\right]`;

/**
 * @brief Activa la extensión Math Inline y devuelve su API.
 *
 * @return Promesa que se resuelve con la API (`MathInlineApi`) que expone el decorador de la extensión.
 */
export function activateExtension(): Thenable<MathInlineApi> {
	return vscode.extensions.getExtension<MathInlineApi>(EXTENSION_ID)!.activate();
}

/**
 * @brief Abre un documento nuevo y lo muestra en el editor activo.
 *
 * @param content Contenido del documento.
 * @param language Lenguaje del documento (`markdown` por defecto).
 * @return Editor que muestra el documento.
 */
export async function openEditor(content: string, language = 'markdown'): Promise<vscode.TextEditor> {
	const document = await vscode.workspace.openTextDocument({ language, content });
	return vscode.window.showTextDocument(document);
}

/**
 * @brief Espera hasta que una condición se cumple, consultándola periódicamente.
 *
 * @param condition Condición a evaluar.
 * @param timeoutMs Tiempo máximo de espera en milisegundos (5000 por defecto).
 * @return Promesa que se resuelve apenas `condition` devuelve `true`.
 * @throws Error si la condición no se cumple antes de `timeoutMs`.
 */
export async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error('waitFor: timed out');
		}
		await new Promise(resolve => setTimeout(resolve, 20));
	}
}

/**
 * @brief Espera una cantidad fija de milisegundos; solo para afirmar que algo NO ocurre.
 *
 * @param ms Milisegundos a esperar.
 * @return Promesa que se resuelve una vez transcurrido el tiempo.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @brief Indica si una línea está dentro de las zonas visibles del editor (no plegada ni fuera de pantalla).
 *
 * @param editor Editor consultado.
 * @param line Número de línea.
 * @return `true` si alguna zona visible contiene la línea.
 */
export function isVisible(editor: vscode.TextEditor, line: number): boolean {
	return editor.visibleRanges.some(r => r.start.line <= line && line <= r.end.line);
}

/**
 * @brief Cambia un valor de configuración global y espera a que VS Code notifique el cambio.
 *
 * Como el listener del test se registra después que el de la extensión, cuando
 * la promesa se resuelve la extensión ya procesó el cambio.
 *
 * @param section Sección de la configuración (por ejemplo `mathInline`).
 * @param key Clave dentro de la sección.
 * @param value Valor nuevo; `undefined` restaura el valor por defecto.
 * @return Promesa que se resuelve cuando el cambio ya fue notificado.
 */
export async function setGlobalConfig(section: string, key: string, value: unknown): Promise<void> {
	const changed = new Promise<void>(resolve => {
		const sub = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(`${section}.${key}`)) {
				sub.dispose();
				resolve();
			}
		});
	});
	await vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Global);
	await changed;
}

/**
 * @brief Configura el word-wrap de los documentos Markdown (`[markdown]` global) y espera a que se notifique.
 *
 * Hace falta pasar por `[markdown]` porque Markdown trae `editor.wordWrap` en `on` por defecto y un valor
 * global sin lenguaje no lo pisa. Como el listener del test se registra después que el de la extensión,
 * cuando la promesa se resuelve la extensión ya procesó el cambio.
 *
 * @param wordWrap Valor de `editor.wordWrap`; `undefined` restaura la configuración original.
 * @param column Valor de `editor.wordWrapColumn` (opcional).
 * @return Promesa que se resuelve cuando el cambio ya fue notificado.
 */
export async function setMarkdownWordWrap(wordWrap: string | undefined, column?: number): Promise<void> {
	const value = wordWrap === undefined ? undefined : { 'editor.wordWrap': wordWrap, 'editor.wordWrapColumn': column };
	const effective = () => {
		const cfg = vscode.workspace.getConfiguration('editor', { languageId: 'markdown' });
		return [cfg.get('wordWrap'), cfg.get('wordWrapColumn')];
	};
	const before = effective();
	let sub: vscode.Disposable | undefined;
	const changed = new Promise<void>(resolve => {
		sub = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.wordWrap', { languageId: 'markdown' })
				|| e.affectsConfiguration('editor.wordWrapColumn', { languageId: 'markdown' })) {
				resolve();
			}
		});
	});
	try {
		await vscode.workspace.getConfiguration().update('[markdown]', value, vscode.ConfigurationTarget.Global);
		// When the effective values do not change VS Code sends no event, so there is nothing to wait for.
		if (JSON.stringify(effective()) !== JSON.stringify(before)) {
			await changed;
		}
	} finally {
		sub?.dispose();
	}
}
