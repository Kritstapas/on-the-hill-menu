# On The Hill Karon Resort — Menu

A single-page website that shows the restaurant menu as soon as it opens. There is no intro screen. The menu opens on the Karon hillside view. Visitors turn pages like a book. Zoom stays separate from page turns: while zoomed in, dragging moves around the page, and Fit brings swipe turning back. They can zoom with the browser and use **Open PDF** if they want the original file. The menu is drawn with PDF.js so phones and desktops show the same pages.

## Replace the menu

Put the PDF in the `เมนู` folder. The filename can be anything. The site reads the newest PDF that is small enough to publish (80 MB or less).

1. Add the new PDF to `เมนู`.
2. Delete the old PDF. The original print file can stay if a smaller `-web.pdf` is present.
3. If the PDF is larger than 80 MB, run `npm run web-menu`. This writes `เมนู/OnTheHillMenu-web.pdf`.
4. Refresh the page. No code changes are needed.
5. To publish the change, commit `OnTheHillMenu-web.pdf` and push to GitHub. Vercel redeploys from that push.

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
