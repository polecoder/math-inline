import * as assert from "assert";
import * as vscode from "vscode";
import { getConfig, getFontSize, getLineHeight, resolveColor } from "../config";
import { activateExtension, setGlobalConfig, waitFor } from "./helpers";

/**
 * @brief Cambia el tema de color y espera a que VS Code lo active.
 *
 * @param name Nombre del tema.
 * @param kind Tipo de tema esperado una vez activo.
 */
async function setTheme(
  name: string | undefined,
  kind: vscode.ColorThemeKind,
): Promise<void> {
  await vscode.workspace
    .getConfiguration("workbench")
    .update("colorTheme", name, vscode.ConfigurationTarget.Global);
  await waitFor(() => vscode.window.activeColorTheme.kind === kind);
}

suite("config", () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  suite("getConfig", () => {
    test("returns the defaults when nothing is configured", () => {
      assert.deepStrictEqual(getConfig(), {
        enabled: true,
        scale: 1,
        color: "",
        katexWarnings: true,
      });
    });

    test("reads scale at the documented limits", async () => {
      try {
        await setGlobalConfig("mathInline", "scale", 0.25);
        assert.strictEqual(getConfig().scale, 0.25);
        await setGlobalConfig("mathInline", "scale", 4);
        assert.strictEqual(getConfig().scale, 4);
      } finally {
        await setGlobalConfig("mathInline", "scale", undefined);
      }
    });

    test("trims the color and reads enabled", async () => {
      try {
        await setGlobalConfig("mathInline", "color", "  #ffcc00 \t");
        await setGlobalConfig("mathInline", "enabled", false);
        assert.deepStrictEqual(getConfig(), {
          enabled: false,
          scale: 1,
          color: "#ffcc00",
          katexWarnings: true,
        });
      } finally {
        await setGlobalConfig("mathInline", "color", undefined);
        await setGlobalConfig("mathInline", "enabled", undefined);
      }
    });

    test("treats a whitespace-only color as empty", async () => {
      try {
        await setGlobalConfig("mathInline", "color", "   ");
        assert.strictEqual(getConfig().color, "");
      } finally {
        await setGlobalConfig("mathInline", "color", undefined);
      }
    });
  });

  suite("editor metrics", () => {
    test("getFontSize reads editor.fontSize", async () => {
      try {
        await setGlobalConfig("editor", "fontSize", 21);
        assert.strictEqual(getFontSize(), 21);
      } finally {
        await setGlobalConfig("editor", "fontSize", undefined);
      }
    });

    test("getLineHeight uses the platform ratio when lineHeight is 0", async () => {
      try {
        await setGlobalConfig("editor", "fontSize", 20);
        const ratio = process.platform === "darwin" ? 1.5 : 1.35;
        assert.strictEqual(getLineHeight(), Math.round(20 * ratio));
      } finally {
        await setGlobalConfig("editor", "fontSize", undefined);
      }
    });

    test("getLineHeight treats values below 8 as a font size multiplier", async () => {
      try {
        await setGlobalConfig("editor", "fontSize", 15);
        await setGlobalConfig("editor", "lineHeight", 1.5);
        assert.strictEqual(getLineHeight(), 23);
        await setGlobalConfig("editor", "lineHeight", 7.9);
        assert.strictEqual(getLineHeight(), Math.round(7.9 * 15));
      } finally {
        await setGlobalConfig("editor", "lineHeight", undefined);
        await setGlobalConfig("editor", "fontSize", undefined);
      }
    });

    test("getLineHeight treats values of 8 or more as pixels", async () => {
      try {
        await setGlobalConfig("editor", "lineHeight", 8);
        assert.strictEqual(getLineHeight(), 8);
        await setGlobalConfig("editor", "lineHeight", 30);
        assert.strictEqual(getLineHeight(), 30);
      } finally {
        await setGlobalConfig("editor", "lineHeight", undefined);
      }
    });
  });

  suite("resolveColor", () => {
    const original = vscode.window.activeColorTheme.kind;
    const originalName = vscode.workspace
      .getConfiguration("workbench")
      .inspect<string>("colorTheme")?.globalValue;

    suiteTeardown(async () => {
      await setTheme(originalName, original);
    });

    test("returns the configured color regardless of the theme", () => {
      assert.strictEqual(
        resolveColor({
          enabled: true,
          scale: 1,
          color: "rebeccapurple",
          katexWarnings: true,
        }),
        "rebeccapurple",
      );
    });

    const themes: [string, vscode.ColorThemeKind, string][] = [
      ["Default Light Modern", vscode.ColorThemeKind.Light, "#1f1f1f"],
      [
        "Default High Contrast Light",
        vscode.ColorThemeKind.HighContrastLight,
        "#000000",
      ],
      ["Default High Contrast", vscode.ColorThemeKind.HighContrast, "#ffffff"],
      ["Default Dark Modern", vscode.ColorThemeKind.Dark, "#d4d4d4"],
    ];
    for (const [name, kind, color] of themes) {
      test(`picks ${color} for the ${name} theme when no color is configured`, async () => {
        await setTheme(name, kind);
        assert.strictEqual(
          resolveColor({
            enabled: true,
            scale: 1,
            color: "",
            katexWarnings: true,
          }),
          color,
        );
      });
    }
  });
});
