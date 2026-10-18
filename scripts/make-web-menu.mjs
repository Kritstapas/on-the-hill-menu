import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const menuDir = resolve("เมนู");
const pagesDir = resolve(menuDir, "pages");
const outputPath = resolve(menuDir, "OnTheHillMenu-web.pdf");
const longEdge = 2000;
const jpegQuality = 80;
const webpQuality = 82;

const sources = readdirSync(menuDir)
  .filter((name) => name.toLowerCase().endsWith(".pdf") && !name.toLowerCase().endsWith("-web.pdf"))
  .map((name) => {
    const fullPath = resolve(menuDir, name);
    return { name, fullPath, mtime: statSync(fullPath).mtimeMs, size: statSync(fullPath).size };
  })
  .sort((a, b) => b.mtime - a.mtime);

if (sources.length === 0) {
  throw new Error("No source PDF found in the menu folder.");
}

const source = sources[0];
const writePdf = source.size > 45 * 1024 * 1024;
console.log(`Source: ${source.name} (${Math.round(source.size / 1024 / 1024)} MB)`);

if (!writePdf) {
  writeFileSync(outputPath, readFileSync(source.fullPath));
  console.log(`Copied without recompression: ${outputPath}`);
}

const data = new Uint8Array(readFileSync(source.fullPath));
const pdf = await getDocument({ data, verbosity: 0 }).promise;
const web = writePdf ? await PDFDocument.create() : null;
mkdirSync(pagesDir, { recursive: true });
const written = [];

for (let number = 1; number <= pdf.numPages; number += 1) {
  const page = await pdf.getPage(number);
  const box = page.getViewport({ scale: 1 });
  const scale = longEdge / Math.max(box.width, box.height);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;

  const webpName = `page-${String(number).padStart(2, "0")}.webp`;
  const webp = canvas.toBuffer("image/webp", webpQuality);
  writeFileSync(resolve(pagesDir, webpName), webp);
  written.push(webpName);

  if (web) {
    const jpg = canvas.toBuffer("image/jpeg", jpegQuality);
    const image = await web.embedJpg(jpg);
    const sheet = web.addPage([box.width, box.height]);
    sheet.drawImage(image, { x: 0, y: 0, width: box.width, height: box.height });
  }

  page.cleanup();
  console.log(`Page ${number}/${pdf.numPages} (${Math.round(webp.length / 1024)} KB)`);
}

for (const name of readdirSync(pagesDir)) {
  if (name.toLowerCase().endsWith(".webp") && !written.includes(name)) {
    unlinkSync(resolve(pagesDir, name));
  }
}

if (web) {
  const bytes = await web.save({ useObjectStreams: true });
  writeFileSync(outputPath, bytes);
  console.log(`Wrote ${outputPath} (${Math.round(bytes.length / 1024 / 1024)} MB)`);
}

console.log(`Wrote ${written.length} page images in ${pagesDir}`);
await pdf.destroy?.();
