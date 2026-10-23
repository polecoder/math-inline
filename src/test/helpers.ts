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
