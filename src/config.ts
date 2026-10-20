import * as vscode from 'vscode';

export const SECTION = 'mathInline';

export interface MathInlineConfig {
	enabled: boolean;
	scale: number;
	color: string;
}

export function getConfig(): MathInlineConfig {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	return {
		enabled: cfg.get<boolean>('enabled', true),
		scale: cfg.get<number>('scale', 1),
		color: cfg.get<string>('color', '').trim(),
	};
}

/** Editor font size in px, scoped to Markdown so language overrides apply. */
export function getFontSize(): number {
	return vscode.workspace.getConfiguration('editor', { languageId: 'markdown' }).get<number>('fontSize', 14);
}

/** Color used to paint formulas: the user setting, or a default for the theme kind. */
export function resolveColor(config: MathInlineConfig): string {
	if (config.color) {
		return config.color;
	}
	switch (vscode.window.activeColorTheme.kind) {
		case vscode.ColorThemeKind.Light:
			return '#1f1f1f';
		case vscode.ColorThemeKind.HighContrastLight:
			return '#000000';
		case vscode.ColorThemeKind.HighContrast:
			return '#ffffff';
		default:
			return '#d4d4d4';
	}
}
