# On The Hill Karon Resort — Menu

A single-page website that shows the restaurant menu as soon as it opens. There is no intro screen. The menu opens on the Karon hillside view. Visitors turn pages like a book. Zoom stays separate from page turns: while zoomed in, dragging moves around the page, and Fit brings swipe turning back. They can zoom with the browser and use **Open PDF** if they want the original file. The menu is drawn with PDF.js so phones and desktops show the same pages.

## Replace the menu

The three books live in matching folders and stack in this order: `เมนู/Menu 1`, `เมนู/Menu 2`, and `เมนู/Menu 3`. Each folder has the PDF for Open PDF and a `pages` folder of WebP images.

1. Add the new PDF to that book's folder. The filename can be anything.
2. Run `npm run web-menu`. This writes one sharp WebP per page into each book's `pages` folder. A PDF over 45 MB also gets a smaller `-web.pdf` for the Open PDF button.
3. Refresh the page. The viewer loads only the open page, and preloads the next one.
4. To publish the change, commit that book's folder, then push to GitHub. Vercel redeploys from that push.

GitHub and Vercel cannot accept the 212 MB print file. The web copy is the file the public site opens.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. `npm run build` then `npm run preview` checks the production build.

## Deploy on Vercel

1. Push this project to a GitHub repository.
2. In Vercel, import that repository.
3. Use the Vite preset: build command `npm run build`, output directory `dist`.
4. Deploy. No environment variables are required.

The site is public. Anyone with the link can view the menu. During the build, the PDF in `เมนู` is published for the site to open.
