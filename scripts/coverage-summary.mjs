// Imprime la cobertura de los archivos de `src/` a partir del reporte de c8.
//
// El reporte completo también incluye las fuentes de mathjax que vienen dentro
// del bundle de esbuild, y esas no se pueden excluir antes del remapeo con
// source maps; por eso se filtran acá.

import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** @brief Directorio raíz del proyecto. */
const ROOT = resolve(import.meta.dirname, '..');
/** @brief Reporte de cobertura en formato istanbul generado por `npm run test:coverage`. */
const REPORT = join(ROOT, 'coverage', 'coverage-final.json');

/**
 * @brief Calcula el porcentaje cubierto de una lista de contadores de ejecución.
 *
 * @param counts Cantidad de veces que se ejecutó cada elemento.
 * @return Porcentaje con un decimal (100 si la lista está vacía).
 */
function pct(counts) {
	if (counts.length === 0) {
		return '100.0';
	}
	return (100 * counts.filter(c => c > 0).length / counts.length).toFixed(1);
}

/**
 * @brief Compacta una lista de números de línea en rangos (`3-5,9`).
 *
 * @param lines Números de línea, en cualquier orden y con repetidos.
 * @return Rangos separados por comas, o una cadena vacía.
 */
function ranges(lines) {
	const sorted = [...new Set(lines)].sort((a, b) => a - b);
	const out = [];
	for (let i = 0; i < sorted.length; i++) {
		const start = sorted[i];
		while (sorted[i + 1] === sorted[i] + 1) {
			i++;
		}
		out.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
	}
	return out.join(',');
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'));
const srcDir = join(ROOT, 'src') + sep;
const testDir = join(srcDir, 'test') + sep;

const rows = Object.values(report)
	.filter(f => {
		const path = resolve(f.path).toLowerCase();
		return path.startsWith(srcDir.toLowerCase()) && !path.startsWith(testDir.toLowerCase());
	})
	.map(f => {
		const statements = Object.values(f.s);
		const branches = Object.values(f.b).flat();
		const uncoveredLines = Object.entries(f.s)
			.filter(([, count]) => count === 0)
			.map(([id]) => f.statementMap[id].start.line);
		const uncoveredBranches = Object.entries(f.b)
			.filter(([, counts]) => counts.some(c => c === 0))
			.map(([id]) => f.branchMap[id].loc.start.line);
		return {
			file: relative(ROOT, resolve(f.path)).replaceAll('\\', '/'),
			statements: pct(statements),
			branches: pct(branches),
			functions: pct(Object.values(f.f)),
			uncoveredLines: ranges(uncoveredLines),
			uncoveredBranches: ranges(uncoveredBranches),
		};
	})
	.sort((a, b) => a.file.localeCompare(b.file));

console.table(rows);
