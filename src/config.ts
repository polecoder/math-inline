import * as vscode from 'vscode';

/** @brief Sección de configuración de la extensión (`mathInline.*`). */
export const SECTION = 'mathInline';

/**
 * @brief Valores de configuración de la extensión.
 */
export interface MathInlineConfig {
	/** Indica si el render de matemática está activo (`mathInline.enabled`). */
	enabled: boolean;
	/** Factor de escala aplicado al tamaño de las fórmulas (`mathInline.scale`). */
	scale: number;
	/** Color de las fórmulas; cadena vacía para usar el color por defecto del tema (`mathInline.color`). */
	color: string;
}

/**
 * @brief Lee la configuración `mathInline.*` del usuario.
 *
 * Aplica los valores por defecto (`enabled` verdadero, `scale` 1, `color` vacío)
 * y recorta los espacios de `color`.
 *
 * @return Configuración vigente de la extensión.
 */
export function getConfig(): MathInlineConfig {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	return {
		enabled: cfg.get<boolean>('enabled', true),
		scale: cfg.get<number>('scale', 1),
		color: cfg.get<string>('color', '').trim(),
	};
}

/**
 * @brief Devuelve el tamaño de fuente del editor en píxeles.
 *
 * Lee `editor.fontSize` con alcance de Markdown, para respetar las
 * configuraciones específicas del lenguaje.
 *
 * @return Tamaño de fuente en píxeles (14 si no está configurado).
 */
export function getFontSize(): number {
	return vscode.workspace.getConfiguration('editor', { languageId: 'markdown' }).get<number>('fontSize', 14);
}

/**
 * @brief Determina el color con el que se pintan las fórmulas.
 *
 * Usa el color configurado por el usuario; si está vacío, elige uno por defecto
 * según el tipo de tema activo (claro, alto contraste claro, alto contraste u oscuro).
 *
 * @param config Configuración de la extensión.
 * @return Color CSS a usar.
 */
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
