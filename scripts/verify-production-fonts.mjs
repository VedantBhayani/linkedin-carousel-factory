// Checks a font directory holds exactly the two approved licensed fonts.
// Usage: node scripts/verify-production-fonts.mjs <font-dir>
// Prints only file names and a verdict; never font bytes, digests, or the directory path.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readProductionFonts } from "../src/fonts.js";

export function verifyProductionFonts(fontDir) {
  return readProductionFonts(fontDir).map((font) => font.file);
}

const isMain = import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href;
if (isMain) {
  try {
    const files = verifyProductionFonts(process.argv[2]);
    console.log(`Production fonts verified: ${files.join(", ")}`);
  } catch (error) {
    console.error(`Production font check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
