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
	/** Indica si se avisan las fórmulas que la vista previa de Markdown (KaTeX) no puede mostrar (`mathInline.katexWarnings`). */
	katexWarnings: boolean;
}

/**
 * @brief Lee la configuración `mathInline.*` del usuario.
 *
 * Aplica los valores por defecto (`enabled` verdadero, `scale` 1, `color` vacío y `katexWarnings`
 * verdadero) y recorta los espacios de `color`.
 *
 * @return Configuración vigente de la extensión.
 */
export function getConfig(): MathInlineConfig {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	return {
		enabled: cfg.get<boolean>('enabled', true),
		scale: cfg.get<number>('scale', 1),
		color: cfg.get<string>('color', '').trim(),
		katexWarnings: cfg.get<boolean>('katexWarnings', true),
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
 * @brief Devuelve el alto de línea del editor en píxeles.
 *
 * Replica el cálculo de VS Code a partir de `editor.lineHeight`: 0 usa la
 * proporción por defecto de la plataforma, un valor menor que 8 es un
 * multiplicador del tamaño de fuente y cualquier otro es un valor en píxeles.
 *
 * @return Alto de línea en píxeles.
 */
export function getLineHeight(): number {
	const fontSize = getFontSize();
	const lineHeight = vscode.workspace.getConfiguration('editor', { languageId: 'markdown' }).get<number>('lineHeight', 0);
	if (lineHeight <= 0) {
		return Math.round(fontSize * (process.platform === 'darwin' ? 1.5 : 1.35));
	}
	return lineHeight < 8 ? Math.round(lineHeight * fontSize) : lineHeight;
}

/**
 * @brief Columna de corte que se supone cuando el word-wrap depende del ancho de la ventana, que la API no expone.
 *
 * Es conservadora para un editor angosto, como el que queda con la vista previa al costado.
 */
export const ASSUMED_WRAP_COLUMN = 60;

/**
 * @brief Devuelve la columna donde puede cortar el word-wrap del editor.
 *
 * Lee `editor.wordWrap` y `editor.wordWrapColumn` con alcance de Markdown. Con `wordWrapColumn`
 * se usa la columna configurada. Con `on`, `ASSUMED_WRAP_COLUMN`, y con `bounded`, la menor de las dos,
 * porque esos modos cortan en el borde de la ventana.
 *
 * @return Columna de corte, o `undefined` si el word-wrap está desactivado.
 */
export function getWrapColumn(): number | undefined {
	const cfg = vscode.workspace.getConfiguration('editor', { languageId: 'markdown' });
	const column = cfg.get<number>('wordWrapColumn', 80);
	switch (cfg.get<string>('wordWrap', 'off')) {
		case 'off':
			return undefined;
		case 'wordWrapColumn':
			return column;
		case 'bounded':
			return Math.min(column, ASSUMED_WRAP_COLUMN);
		default:
			return ASSUMED_WRAP_COLUMN;
	}
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
