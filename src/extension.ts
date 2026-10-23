import * as vscode from 'vscode';
import { MathDecorator } from './decorator';
import { MathHoverProvider } from './hover';
import { MathFoldingProvider } from './folding';
import { KatexDiagnostics } from './katex';
import { SECTION, getConfig } from './config';

/**
 * @brief API que expone la extensión al activarse (usada por los tests).
 */
export interface MathInlineApi {
	/** Decorador activo que gestiona el render en los editores. */
	decorator: MathDecorator;
	/** Diagnósticos de las fórmulas que la vista previa de Markdown (KaTeX) no puede mostrar. */
	katex: KatexDiagnostics;
}

/**
 * @brief Activa la extensión.
 *
 * Crea el decorador y los diagnósticos de KaTeX (`KatexDiagnostics`), registra los proveedores de
 * hover y de plegado para Markdown y el comando `mathInline.toggle`, que alterna
 * `mathInline.enabled` en la configuración global.
 *
 * @param context Contexto de la extensión, donde se registran los recursos a liberar.
 * @return API con el decorador y los diagnósticos de KaTeX creados.
 */
export function activate(context: vscode.ExtensionContext): MathInlineApi {
	const decorator = new MathDecorator();
	const katex = new KatexDiagnostics(decorator);

	context.subscriptions.push(
		decorator,
		katex,
		vscode.languages.registerHoverProvider({ language: 'markdown' }, new MathHoverProvider(decorator)),
		vscode.languages.registerFoldingRangeProvider({ language: 'markdown' }, new MathFoldingProvider(decorator)),
		vscode.commands.registerCommand('mathInline.toggle', () =>
			vscode.workspace.getConfiguration(SECTION).update('enabled', !getConfig().enabled, vscode.ConfigurationTarget.Global)),
	);

	return { decorator, katex };
}

/**
 * @brief Desactiva la extensión; no hay nada que liberar porque `activate` registra todo en `context.subscriptions`.
 */
export function deactivate() {}
