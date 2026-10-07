import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function inlineCssFile(specifier) {
  const cssPath = require.resolve(specifier);
  const cssDir = path.dirname(cssPath);
  return fs.readFileSync(cssPath, "utf8").replace(
    /url\((['"]?)(\.\/files\/[^)'"\s]+)\1\)/g,
    (_match, _quote, relativePath) => {
      const fontPath = path.resolve(cssDir, relativePath);
      const data = fs.readFileSync(fontPath).toString("base64");
      return `url("data:font/woff2;base64,${data}")`;
    }
  );
}

export function loadEmbeddedFontCss() {
  return [
    inlineCssFile("@fontsource/inter/400.css"),
    inlineCssFile("@fontsource/inter/600.css"),
    inlineCssFile("@fontsource/lora/400-italic.css")
  ].join("\n");
}
