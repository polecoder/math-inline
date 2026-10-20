import * as vscode from 'vscode';
import { MathDecorator } from './decorator';
import { MathHoverProvider } from './hover';
import { SECTION, getConfig } from './config';

export interface MathInlineApi {
	decorator: MathDecorator;
}

export function activate(context: vscode.ExtensionContext): MathInlineApi {
	const decorator = new MathDecorator();

	context.subscriptions.push(
		decorator,
		vscode.languages.registerHoverProvider({ language: 'markdown' }, new MathHoverProvider(decorator)),
		vscode.commands.registerCommand('mathInline.toggle', () =>
			vscode.workspace.getConfiguration(SECTION).update('enabled', !getConfig().enabled, vscode.ConfigurationTarget.Global)),
	);

	return { decorator };
}

export function deactivate() {}
