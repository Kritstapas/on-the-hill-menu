import { cpSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const menuDir = resolve("เมนู");
const pagesDir = resolve(menuDir, "pages");
const publishedDir = resolve("public/menus");
const publishedPagesDir = resolve("public/menu-pages");
const manifestPath = resolve("public/menu.json");
const bookSources = [
  {
    id: "menu",
    title: "Menu",
    pdfPath: resolve(menuDir, "OnTheHillMenu-web.pdf"),
    pagesPath: pagesDir,
  },
  {
    id: "overview",
    title: "Overview",
    pdfPath: resolve(menuDir, "overview", "Overview-new.pdf"),
    pagesPath: resolve(menuDir, "overview", "pages"),
  },
  {
    id: "last-minutes",
    title: "The Last Minutes",
    pdfPath: resolve(menuDir, "last-minutes", "The Last Minutes.pdf"),
    pagesPath: resolve(menuDir, "last-minutes", "pages"),
  },
];
let publishTimer = 0;
let publishing = false;

function publishMenu() {
  mkdirSync(menuDir, { recursive: true });
  mkdirSync(publishedDir, { recursive: true });

  const books = bookSources.filter((book) => existsSync(book.pdfPath)).map((book) => publishBook(book));
  const first = books[0];
  if (!first) {
    writeFileSync(manifestPath, `${JSON.stringify({ src: null, name: null, pages: [], books: [] }, null, 2)}\n`);
    return;
  }

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        src: first.src,
        name: first.name,
        pages: first.pages,
        books,
      },
      null,
      2,
    )}\n`,
  );
}

function publishBook(book) {
  const version = Math.round(statSync(book.pdfPath).mtimeMs);
  const fileName = `${book.id}.pdf`;
  const destination = resolve(publishedDir, fileName);
  if (!existsSync(destination) || statSync(destination).size !== statSync(book.pdfPath).size) {
    cpSync(book.pdfPath, destination);
  }
  return {
    id: book.id,
    title: book.title,
    name: book.title,
    src: `/menus/${fileName}?v=${version}`,
    pages: publishPages(book.pagesPath, book.id, version),
  };
}

function publishPages(sourceDir, bookId, version) {
  if (!existsSync(sourceDir)) return [];
  const destinationDir = resolve(publishedPagesDir, bookId);
  mkdirSync(destinationDir, { recursive: true });
  const names = readdirSync(sourceDir)
    .filter((name) => name.toLowerCase().endsWith(".webp"))
    .sort();
  const urls = names.map((name) => {
    const destination = resolve(destinationDir, name);
    const source = resolve(sourceDir, name);
    if (!existsSync(destination) || statSync(destination).size !== statSync(source).size) {
      cpSync(source, destination);
    }
    return `/menu-pages/${bookId}/${name}?v=${version}`;
  });

  for (const name of readdirSync(destinationDir)) {
    if (!names.includes(name)) {
      try {
        unlinkSync(resolve(destinationDir, name));
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
      for (const book of bookSources) {
        if (existsSync(book.pagesPath)) server.watcher.add(book.pagesPath);
      }
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
