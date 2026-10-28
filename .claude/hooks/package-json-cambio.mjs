// Hook PostToolUse de Claude Code: cuando se edita package.json o se corre un `npm install`,
// `uninstall` o `update`, le recuerda al agente que tiene que invocar al subagente
// Vulnerabilidades si cambiaron dependencias u overrides. Nunca bloquea.
import { basename, dirname, resolve } from 'node:path';

/** @brief Comandos de npm que cambian dependencias (`npm version` no cuenta). */
const NPM_DEPENDENCY_COMMAND = /\bnpm\s+(i|install|add|un|uninstall|rm|remove|update|up|upgrade)\b/;

/**
 * @brief Normaliza una ruta para compararla (en Windows, sin distinguir mayúsculas).
 * @param path Ruta a normalizar.
 * @return Ruta absoluta normalizada.
 */
const normalize = path => {
	const absolute = resolve(path);
	return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
};

/**
 * @brief Indica si la herramienta usada pudo cambiar las dependencias del proyecto.
 * @param toolInput `tool_input` del evento del hook.
 * @return `true` si se editó el `package.json` de la raíz o se corrió un comando de npm que cambia dependencias.
 */
const touchesDependencies = toolInput => {
	if (typeof toolInput?.command === 'string') {
		return NPM_DEPENDENCY_COMMAND.test(toolInput.command);
	}
	const filePath = toolInput?.file_path;
	if (typeof filePath !== 'string' || basename(filePath) !== 'package.json') {
		return false;
	}
	const root = process.env.CLAUDE_PROJECT_DIR;
	return root ? normalize(dirname(filePath)) === normalize(root) : !/node_modules/.test(filePath);
};

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
	let toolInput;
	try {
		toolInput = JSON.parse(input).tool_input;
	} catch {
		return;
	}
	if (!touchesDependencies(toolInput)) {
		return;
	}
	console.log(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: 'PostToolUse',
			additionalContext:
				'Puede haber cambiado package.json. Si sos el agente principal y cambiaron dependencies, devDependencies u overrides, ' +
				'invocá al subagente Vulnerabilidades (nivel Dependencias de /cerrar-cambio) antes de dar el trabajo por terminado.',
		},
	}));
});
