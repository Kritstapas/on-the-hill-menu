import { cpSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const menuDir = resolve("เมนู");
const pagesDir = resolve(menuDir, "pages");
const publishedDir = resolve("public/menus");
const publishedPagesDir = resolve("public/menu-pages");
const manifestPath = resolve("public/menu.json");
let publishTimer = 0;
let publishing = false;

function publishMenu() {
  mkdirSync(menuDir, { recursive: true });
  mkdirSync(publishedDir, { recursive: true });

  const pdfs = readdirSync(menuDir)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => {
      const fullPath = resolve(menuDir, name);
      return { name, fullPath, mtime: statSync(fullPath).mtimeMs, size: statSync(fullPath).size };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (pdfs.length === 0) {
    writeFileSync(manifestPath, `${JSON.stringify({ src: null, name: null }, null, 2)}\n`);
    return;
  }

  const hostLimit = 80 * 1024 * 1024;
  const publishable = pdfs.filter((pdf) => pdf.size <= hostLimit);
  const chosen = (publishable.length > 0 ? publishable : pdfs)[0];
  const version = Math.round(chosen.mtime);
  const fileName = `menu-${version}.pdf`;
  const destination = resolve(publishedDir, fileName);
  if (!existsSync(destination) || statSync(destination).size !== chosen.size) {
    cpSync(chosen.fullPath, destination);
  }

  const pages = publishPages(version);

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        src: `/menus/${fileName}?v=${version}`,
        name: chosen.name,
        pages,
      },
      null,
      2,
    )}\n`,
  );

  for (const name of readdirSync(publishedDir)) {
    if (name !== fileName && name.toLowerCase().endsWith(".pdf")) {
      try {
        unlinkSync(resolve(publishedDir, name));
      } catch {
        // The browser may still have the previous file open.
      }
    }
  }
}

function publishPages(version) {
  if (!existsSync(pagesDir)) return [];
  mkdirSync(publishedPagesDir, { recursive: true });
  const names = readdirSync(pagesDir)
    .filter((name) => name.toLowerCase().endsWith(".webp"))
    .sort();
  const urls = names.map((name) => {
    const destination = resolve(publishedPagesDir, name);
    const source = resolve(pagesDir, name);
    if (!existsSync(destination) || statSync(destination).size !== statSync(source).size) {
      cpSync(source, destination);
    }
    return `/menu-pages/${name}?v=${version}`;
  });

  for (const name of readdirSync(publishedPagesDir)) {
    if (!names.includes(name)) {
      try {
        unlinkSync(resolve(publishedPagesDir, name));
      } catch {
        // The browser may still be reading the previous image.
      }
    }
  }

  return urls;
}

function schedulePublish() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    if (publishing) return;
    publishing = true;
    try {
      publishMenu();
    } catch (error) {
      console.error("[menu] Could not publish the PDF.", error);
    } finally {
      publishing = false;
    }
  }, 800);
}

function menuFolder() {
  const isMenuPdf = (file) => {
    const normalized = file.replaceAll("\\", "/").toLowerCase();
    const dir = menuDir.replaceAll("\\", "/").toLowerCase();
    return (
      normalized.startsWith(`${dir}/`) &&
      (normalized.endsWith(".pdf") || normalized.endsWith(".webp"))
    );
  };

  return {
    name: "menu-folder",
    configResolved() {
      try {
        publishMenu();
      } catch (error) {
        console.error("[menu] Could not publish the PDF.", error);
      }
    },
    buildStart() {
      try {
        publishMenu();
      } catch (error) {
        console.error("[menu] Could not publish the PDF.", error);
      }
    },
    configureServer(server) {
      server.watcher.add(menuDir);
      if (existsSync(pagesDir)) server.watcher.add(pagesDir);
      server.watcher.on("all", (event, file) => {
        if (isMenuPdf(file)) schedulePublish();
      });
    },
  };
}

function copyPdfjsAssets() {
  const copy = () => {
    const root = resolve("node_modules/pdfjs-dist");
    const dest = resolve("public/pdfjs");
    mkdirSync(dest, { recursive: true });
    cpSync(resolve(root, "cmaps"), resolve(dest, "cmaps"), { recursive: true });
    cpSync(resolve(root, "standard_fonts"), resolve(dest, "standard_fonts"), {
      recursive: true,
    });
  };

  return {
    name: "copy-pdfjs-assets",
    buildStart: copy,
    configureServer: copy,
  };
}

export default defineConfig({
  plugins: [react(), menuFolder(), copyPdfjsAssets()],
  build: {
    chunkSizeWarningLimit: 800,
  },
});
