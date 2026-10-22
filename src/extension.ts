import * as vscode from 'vscode';
import { MathDecorator } from './decorator';
import { MathHoverProvider } from './hover';
import { MathFoldingProvider } from './folding';
import { SECTION, getConfig } from './config';

/**
 * @brief API que expone la extensión al activarse (usada por los tests).
 */
export interface MathInlineApi {
	/** Decorador activo que gestiona el render en los editores. */
	decorator: MathDecorator;
}

/**
 * @brief Activa la extensión.
 *
 * Crea el decorador, registra los proveedores de hover y de plegado para Markdown y el comando
 * `mathInline.toggle`, que alterna `mathInline.enabled` en la configuración global.
 *
 * @param context Contexto de la extensión, donde se registran los recursos a liberar.
 * @return API con el decorador creado.
 */
export function activate(context: vscode.ExtensionContext): MathInlineApi {
	const decorator = new MathDecorator();

	context.subscriptions.push(
		decorator,
		vscode.languages.registerHoverProvider({ language: 'markdown' }, new MathHoverProvider(decorator)),
		vscode.languages.registerFoldingRangeProvider({ language: 'markdown' }, new MathFoldingProvider(decorator)),
		vscode.commands.registerCommand('mathInline.toggle', () =>
			vscode.workspace.getConfiguration(SECTION).update('enabled', !getConfig().enabled, vscode.ConfigurationTarget.Global)),
	);

	return { decorator };
}

/**
 * @brief Desactiva la extensión; no hay nada que liberar porque `activate` registra todo en `context.subscriptions`.
 */
export function deactivate() {}
