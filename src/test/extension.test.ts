import * as assert from "assert";
import * as vscode from "vscode";
import type { MathInlineApi } from "../extension";
import { isError, render } from "../renderer";
import { previewMarkdown } from "../hover";
import { BIG_TEX, EXTENSION_ID, isVisible, sleep } from "./helpers";

suite("renderer", () => {
  test("renders valid TeX to a sized SVG data URI", () => {
    const result = render(String.raw`\frac{a}{b}`, {
      color: "#ff0000",
      exPx: 7,
    });
    assert.ok(!isError(result));
    assert.ok(result.uri.startsWith("data:image/svg+xml;base64,"));
    assert.ok(result.width > 0 && result.height > 0);
    const svg = Buffer.from(result.uri.split(",")[1], "base64").toString();
    assert.ok(svg.includes("#ff0000"));
    assert.ok(!svg.includes("currentColor"));
  });

  test("reports TeX errors", () => {
    const result = render(String.raw`\frac{a`, { color: "#000", exPx: 7 });
    assert.ok(isError(result));
    assert.match(result.error, /brace/i);
  });

  test("shrinks tall formulas to maxHeight keeping the aspect ratio", () => {
    const tex = String.raw`\left[\dfrac{\sqrt{a}}{b}\right]`;
    const full = render(tex, { color: "#000", exPx: 7 });
    const fitted = render(tex, { color: "#000", exPx: 7, maxHeight: 19 });
    assert.ok(!isError(full) && !isError(fitted));
    assert.ok(full.height > 19);
    assert.strictEqual(fitted.height, 19);
    assert.ok(
      Math.abs(fitted.width / fitted.height - full.width / full.height) < 0.05,
    );
  });

  test("leaves formulas within maxHeight untouched", () => {
    const full = render("x", { color: "#000", exPx: 7 });
    const fitted = render("x", { color: "#000", exPx: 7, maxHeight: 19 });
    assert.deepStrictEqual(fitted, full);
    assert.ok(!isError(fitted) && fitted.fit === 1);
  });

  test("reports the shrink factor applied by maxHeight", () => {
    const fitted = render(String.raw`\dfrac{\sqrt{a}}{b}`, {
      color: "#000",
      exPx: 7,
      maxHeight: 10,
    });
    assert.ok(!isError(fitted));
    assert.ok(fitted.fit > 0 && fitted.fit < 1);
  });

  test("textStyle renders display fractions smaller", () => {
    const tex = String.raw`\dfrac{a}{b}`;
    const display = render(tex, { color: "#000", exPx: 7 });
    const text = render(tex, { color: "#000", exPx: 7, textStyle: true });
    assert.ok(!isError(display) && !isError(text));
    assert.ok(text.height < display.height);
  });

  test("textStyle rewrites \\dbinom but leaves longer control sequences alone", () => {
    const opts = { color: "#000", exPx: 7 };
    assert.deepStrictEqual(
      render(String.raw`\dbinom{n}{k}`, { ...opts, textStyle: true }),
      render(String.raw`\binom{n}{k}`, opts),
    );
    const longer = render(String.raw`\dfracx`, { ...opts, textStyle: true });
    assert.ok(isError(longer));
    assert.match(longer.error, /undefined control sequence/i);
  });

  test("display mode makes limits taller than inline mode", () => {
    const tex = String.raw`\sum_{i=1}^{n} i`;
    const inline = render(tex, { color: "#000", exPx: 7 });
    const display = render(tex, { color: "#000", exPx: 7, display: true });
    assert.ok(!isError(inline) && !isError(display));
    assert.ok(display.height > inline.height);
  });

  test("scales the size with exPx", () => {
    const small = render("x", { color: "#000", exPx: 7 });
    const big = render("x", { color: "#000", exPx: 14 });
    assert.ok(!isError(small) && !isError(big));
    assert.ok(Math.abs(big.width - small.width * 2) < 0.05);
    assert.ok(Math.abs(big.height - small.height * 2) < 0.05);
  });

  test("scales verticalAlign along with the shrink", () => {
    const tex = String.raw`\left[\dfrac{\sqrt{a}}{b}\right]`;
    const full = render(tex, { color: "#000", exPx: 7 });
    const fitted = render(tex, { color: "#000", exPx: 7, maxHeight: 10 });
    assert.ok(!isError(full) && !isError(fitted));
    assert.ok(full.verticalAlign < 0);
    assert.ok(
      Math.abs(fitted.verticalAlign - full.verticalAlign * fitted.fit) < 0.02,
    );
    assert.ok(Math.abs(fitted.width - full.width * fitted.fit) < 0.02);
  });

  test("does not shrink a formula whose height equals maxHeight", () => {
    const full = render("x", { color: "#000", exPx: 7 });
    assert.ok(!isError(full));
    const exact = render("x", {
      color: "#000",
      exPx: 7,
      maxHeight: full.height,
    });
    assert.deepStrictEqual(exact, full);
  });

  test("escapes XML special characters in the color", () => {
    const result = render("x", { color: "a\"<&>'b", exPx: 7 });
    assert.ok(!isError(result));
    const svg = Buffer.from(result.uri.split(",")[1], "base64").toString();
    assert.ok(svg.includes("a&#34;&#60;&#38;&#62;&#39;b"));
  });

  test("rewrites the root <svg> with pixel dimensions and no style", () => {
    const result = render(String.raw`\frac{a}{b}`, { color: "#000", exPx: 7 });
    assert.ok(!isError(result));
    const svg = Buffer.from(result.uri.split(",")[1], "base64").toString();
    const root = /^<svg[^>]*>/.exec(svg)![0];
    assert.ok(root.includes(` width="${result.width}"`));
    assert.ok(root.includes(` height="${result.height}"`));
    assert.ok(!root.includes("style="));
  });

  test("returns the same result for repeated renders and keeps colors apart", () => {
    const a = render("q+1", { color: "#111111", exPx: 7 });
    assert.strictEqual(render("q+1", { color: "#111111", exPx: 7 }), a);
    const b = render("q+1", { color: "#222222", exPx: 7 });
    assert.notStrictEqual(b, a);
    assert.ok(!isError(a) && !isError(b));
    assert.notStrictEqual(a.uri, b.uri);
  });

  test("caches errors too", () => {
    const first = render(String.raw`\frac{a`, { color: "#000", exPx: 7.5 });
    assert.strictEqual(
      render(String.raw`\frac{a`, { color: "#000", exPx: 7.5 }),
      first,
    );
  });

  test("evicts the oldest cached entry once the cache is full", () => {
    const opts = { color: "#000", exPx: 7.25 };
    const first = render("evict0", opts);
    assert.strictEqual(render("evict0", opts), first);
    for (let i = 1; i <= 500; i++) {
      render(`evict${i}`, opts);
    }
    const again = render("evict0", opts);
    assert.notStrictEqual(again, first);
    assert.deepStrictEqual(again, first);
  });

  test("renders empty TeX without throwing", () => {
    const result = render("", { color: "#000", exPx: 7 });
    assert.ok(!isError(result));
    assert.strictEqual(result.fit, 1);
  });

  test("rejects packages that would hide errors or load code", () => {
    for (const tex of [
      String.raw`\require{amsmath}`,
      String.raw`\undefinedmacro`,
    ]) {
      assert.ok(isError(render(tex, { color: "#000", exPx: 7 })), tex);
    }
  });
});

suite("MathDecorator", () => {
  let api: MathInlineApi;
  let editor: vscode.TextEditor;

  suiteSetup(async () => {
    api = await vscode.extensions
      .getExtension<MathInlineApi>(EXTENSION_ID)!
      .activate();
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content:
        "Intro line\nEuler: $e^{i\\pi}+1=0$ and $\\frac{a}{b}$.\nBroken: $\\frac{a$\n" +
        `Big: $${BIG_TEX}$\n`,
    });
    editor = await vscode.window.showTextDocument(document);
  });

  test("renders formulas and flags errors", () => {
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    api.decorator.update(editor);
    const state = api.decorator.getState(editor)!;
    assert.strictEqual(state.rendered.length, 2);
    assert.strictEqual(state.collapsed.length, 1);
    assert.strictEqual(state.errors.length, 1);
    assert.strictEqual(state.revealed.length, 0);
  });

  test("shows the big formula in a display-mode hover", async () => {
    const big = api.decorator.getState(editor)!.collapsed[0];
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      editor.document.uri,
      big.start.translate(0, 3),
    );
    const contents = hovers
      .flatMap((h) => h.contents)
      .map((c) => (c as vscode.MarkdownString).value ?? "");
    assert.ok(contents.some((c) => c.includes("data:image/svg+xml")));
  });

  test("hovering the chip lands on its visible opening `$`", async () => {
    const big = api.decorator.getState(editor)!.collapsed[0];
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      editor.document.uri,
      big.start,
    );
    const images = hovers
      .flatMap((h) => h.contents)
      .map((c) => (c as vscode.MarkdownString).value ?? "")
      .filter((c) => c.includes("data:image/svg+xml"));
    assert.strictEqual(images.length, 1);
  });

  test("reveals the formula under the cursor", () => {
    const first = api.decorator.getState(editor)!.rendered[0];
    editor.selection = new vscode.Selection(
      first.start.translate(0, 2),
      first.start.translate(0, 2),
    );
    api.decorator.update(editor);
    const state = api.decorator.getState(editor)!;
    assert.strictEqual(state.rendered.length, 1);
    assert.strictEqual(state.revealed.length, 1);
    assert.ok(state.revealed[0].isEqual(first));
  });

  test("toggle command switches between source and rendered math", async () => {
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand("mathInline.toggle");
    api.decorator.update(editor);
    assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 0);

    await vscode.commands.executeCommand("mathInline.toggle");
    api.decorator.update(editor);
    assert.strictEqual(api.decorator.getState(editor)!.rendered.length, 2);
  });
});

suite("Display math", () => {
  let api: MathInlineApi;
  let editor: vscode.TextEditor;

  suiteSetup(async () => {
    api = await vscode.extensions
      .getExtension<MathInlineApi>(EXTENSION_ID)!
      .activate();
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content:
        "Single line: $$x+y$$\n$$\n\\int_0^1 x\\,dx\n$$\n$$\n\\frac{a\n$$\n",
    });
    editor = await vscode.window.showTextDocument(document);
  });

  test("renders single-line $$ inline and folds multi-line blocks into a chip", async function () {
    this.timeout(5000);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    api.decorator.update(editor);
    await sleep(1000);
    const state = api.decorator.getState(editor)!;
    assert.strictEqual(state.rendered.length, 1);
    assert.strictEqual(state.collapsed.length, 1);
    assert.strictEqual(state.collapsed[0].start.line, 1);
    assert.strictEqual(state.collapsed[0].end.line, 3);
    assert.strictEqual(state.errors.length, 1);
    assert.ok(isVisible(editor, 1), "the chip line stays visible");
    assert.ok(!isVisible(editor, 2), "the block body is folded");
    assert.ok(isVisible(editor, 5), "a block with a TeX error is not folded");
  });

  test("unfolding a block by hand replaces its chip with the TeX", async () => {
    await vscode.commands.executeCommand("editor.unfold", {
      selectionLines: [1],
      levels: 1,
      direction: "up",
    });
    await sleep(300);
    const state = api.decorator.getState(editor)!;
    assert.ok(isVisible(editor, 2));
    assert.strictEqual(state.collapsed.length, 0);
    assert.strictEqual(state.unfolded.length, 1);
    assert.strictEqual(state.unfolded[0].start.line, 1);
  });

  test("reveals a block when the cursor is on one of its lines", () => {
    editor.selection = new vscode.Selection(2, 0, 2, 0);
    api.decorator.update(editor);
    const state = api.decorator.getState(editor)!;
    assert.strictEqual(state.collapsed.length, 0);
    assert.strictEqual(state.revealed.length, 1);
    assert.strictEqual(state.revealed[0].start.line, 1);
  });

  test("hovering any line of a block shows its preview", async () => {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      editor.document.uri,
      new vscode.Position(2, 3),
    );
    const contents = hovers
      .flatMap((h) => h.contents)
      .map((c) => (c as vscode.MarkdownString).value ?? "");
    assert.ok(contents.some((c) => c.includes("data:image/svg+xml")));
  });

  test("unfolds the block under the cursor", async function () {
    this.timeout(5000);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand("editor.fold", {
      selectionLines: [1],
      levels: 1,
      direction: "up",
    });
    await sleep(300);
    assert.ok(!isVisible(editor, 2));

    editor.selection = new vscode.Selection(1, 1, 1, 1);
    api.decorator.update(editor);
    await sleep(300);
    assert.ok(isVisible(editor, 2), "the block under the cursor is unfolded");
  });

  test("previews long blocks within the hover size limit", () => {
    const aligned = (count: number) =>
      "\\begin{aligned}" +
      Array.from(
        { length: count },
        (_, i) =>
          String.raw`&\int_0^{${i}} \frac{\sin x}{x}\,dx = \sum_{k=0}^{\infty} a_k\\`,
      ).join("\n") +
      "\\end{aligned}";
    const options = api.decorator.renderOptions(1.5);

    const long = previewMarkdown(aligned(20), options);
    assert.ok(long);
    assert.ok(long.value.startsWith("![math](data:image/svg+xml;base64,"));
    assert.ok(
      long.value.length <= 100_000,
      `hover Markdown is ${long.value.length} characters long`,
    );

    // Past VS Code's limit the data URI would be cut and shown as text, so a notice is shown instead.
    const huge = previewMarkdown(aligned(200), options);
    assert.ok(huge && !huge.value.includes("data:"));
  });

  test("provides a folding range per block", async () => {
    const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
      "vscode.executeFoldingRangeProvider",
      editor.document.uri,
    );
    assert.ok(ranges.some((r) => r.start === 1 && r.end === 3));
    assert.ok(ranges.some((r) => r.start === 4 && r.end === 6));
  });
});
