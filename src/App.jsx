import { useEffect, useRef, useState } from "react";
import { AnnotationMode, getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MENU_MANIFEST_PATH } from "./menuPath.js";

const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

GlobalWorkerOptions.workerSrc = workerUrl;

const SWIPE_THRESHOLD = 42;
const FLICK_PX_PER_MS = 0.45;

function dragSpan(width) {
  return Math.max(width * 0.7, 1);
}

function dragAngle(dx, width, mode) {
  const pull = Math.max(-1.2, Math.min(1.2, dx / dragSpan(width)));
  const shaped = pull / (1 + 0.18 * Math.abs(pull));
  if (mode === "next") return Math.max(-178, Math.min(0, shaped * 170));
  if (mode === "prev") return Math.max(-180, Math.min(0, -180 + shaped * 170));
  return Math.max(-8, Math.min(8, dx / 34));
}

function easeTurn(t) {
  return t * t * (3 - 2 * t);
}

function fitScale(pageWidth, pageHeight, boxWidth, boxHeight) {
  return Math.min(boxWidth / pageWidth, boxHeight / pageHeight);
}

function BookView({ pages, source, moreBelow }) {
  const stageRef = useRef(null);
  const pageRef = useRef(null);
  const shellRef = useRef(null);
  const bookRef = useRef(null);
  const baseRef = useRef(null);
  const leafRef = useRef(null);
  const frontRef = useRef(null);
  const turnRef = useRef(async () => {});
  const zoomApiRef = useRef(() => {});
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const indexRef = useRef(0);
  const countRef = useRef(0);
  const busyRef = useRef(false);
  const [status, setStatus] = useState("loading");
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [pdfUrl, setPdfUrl] = useState("");
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    const stage = stageRef.current;
    const page = pageRef.current;
    const shell = shellRef.current;
    const book = bookRef.current;
    const base = baseRef.current;
    const leaf = leafRef.current;
    const front = frontRef.current;
    let cancelled = false;
    let loadingTask = null;
    let pdfDoc = null;
    let renderTasks = [];
    let resizeTimer = 0;
    let generation = 0;
    let sheetGeneration = 0;
    let frameWidth = 0;
    let frameHeight = 0;
    let pixelRatio = 1;
    let laidOutWidth = 0;
    let laidOutHeight = 0;
    let arranging = false;
    let leafAngle = 0;
    let animFrame = 0;
    let animToken = 0;
    let prefetchId = 0;
    let sheets = [];
    let pageUrls = [];
    let menuSrc = "";
    const pendingSheets = new Map();

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    leaf.style.transition = "none";
    pageUrls = pages.map((page) =>
      page.startsWith("/") ? `${import.meta.env.BASE_URL}${page.slice(1)}` : page,
    );
    if (source) {
      menuSrc = source.startsWith("/") ? `${import.meta.env.BASE_URL}${source.slice(1)}` : source;
      setPdfUrl(menuSrc);
    }

    function cancelRenders() {
      for (const task of renderTasks) task.cancel();
      renderTasks = [];
    }

    function place(container, canvas) {
      if (canvas) {
        if (canvas.parentElement !== container) container.replaceChildren(canvas);
      } else {
        container.replaceChildren();
      }
    }

    function ensureImage(index) {
      if (index < 0 || index >= pageUrls.length) return Promise.resolve(null);
      if (sheets[index]) return Promise.resolve(sheets[index]);
      if (pendingSheets.has(index)) return pendingSheets.get(index);
      const job = new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.alt = "";
        image.draggable = false;
        image.onload = () => {
          if (frameWidth) {
            image.style.width = `${frameWidth}px`;
            image.style.height = `${frameHeight}px`;
          }
          sheets[index] = image;
          resolve(image);
        };
        image.onerror = () => reject(new Error("page image missing"));
        image.src = pageUrls[index];
      });
      pendingSheets.set(index, job);
      return job.finally(() => pendingSheets.delete(index));
    }

    async function ensureSheet(index) {
      if (pageUrls.length) return ensureImage(index);
      if (!pdfDoc || index < 0 || index >= countRef.current) return null;
      if (sheets[index]) return sheets[index];
      if (pendingSheets.has(index)) return pendingSheets.get(index);
      const run = sheetGeneration;
      const job = renderSheet(index, run);
      pendingSheets.set(index, job);
      try {
        return await job;
      } finally {
        pendingSheets.delete(index);
      }
    }

    async function renderSheet(index, run) {
      const page = await pdfDoc.getPage(index + 1);
      if (cancelled || run !== sheetGeneration) return sheets[index] ?? null;

      const box = page.getViewport({ scale: 1 });
      const scale = fitScale(box.width, box.height, frameWidth, frameHeight);
      const viewport = page.getViewport({ scale: scale * pixelRatio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${frameWidth}px`;
      canvas.style.height = `${frameHeight}px`;
      const task = page.render({
        canvas,
        viewport,
        annotationMode: AnnotationMode.DISABLE,
      });
      renderTasks.push(task);
      await task.promise;
      if (cancelled || run !== sheetGeneration) return null;
      sheets[index] = canvas;
      return canvas;
    }

    function pose(angle) {
      leafAngle = angle;
      const fold = Math.sin((Math.min(Math.abs(angle), 180) * Math.PI) / 180);
      const lift = fold * 36;
      const rise = fold * -8;
      leaf.style.transform = `translate3d(0, ${rise}px, ${lift}px) rotateY(${angle}deg)`;
    }

    function frame() {
      return new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
    }

    function stopMotion() {
      animToken += 1;
      if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = 0;
      }
    }

    function setLeaf(angle) {
      stopMotion();
      pose(angle);
    }

    function animateTo(target, velocity = 0) {
      const token = ++animToken;
      if (animFrame) cancelAnimationFrame(animFrame);
      const from = leafAngle;
      const delta = target - from;
      const distance = Math.abs(delta);
      if (distance < 0.6 || motionQuery.matches) {
        pose(target);
        return Promise.resolve();
      }

      const speed = Math.abs(velocity);
      const duration = speed > 0.35
        ? Math.min(420, Math.max(260, 340 - speed * 40))
        : Math.min(520, Math.max(400, 360 + distance * 0.45));
      const ease = easeTurn;
      const start = performance.now();

      return new Promise((resolve) => {
        const step = (now) => {
          if (token !== animToken) {
            resolve();
            return;
          }
          const t = Math.min(1, (now - start) / duration);
          pose(from + delta * ease(t));
          if (t < 1) {
            animFrame = requestAnimationFrame(step);
          } else {
            animFrame = 0;
            pose(target);
            resolve();
          }
        };
        animFrame = requestAnimationFrame(step);
      });
    }

    function showIdle() {
      const current = indexRef.current;
      leaf.style.visibility = "visible";
      leaf.classList.remove("is-lifted");
      setLeaf(0);
      place(front, sheets[current]);
      place(base, sheets[current + 1]);
    }

    function settleTo(nextIndex) {
      leaf.style.visibility = "hidden";
      leaf.classList.remove("is-lifted");
      setLeaf(0);
      indexRef.current = nextIndex;
      place(front, sheets[nextIndex]);
      place(base, sheets[nextIndex + 1]);
      leaf.style.visibility = "visible";
      setIndex(nextIndex);
    }

    function scheduleNeighbors(current) {
      window.clearTimeout(prefetchId);
      prefetchId = window.setTimeout(() => {
        prefetchId = 0;
        if (cancelled) return;
        void ensureSheet(current + 1);
        void ensureSheet(current - 1);
      }, 0);
    }

    function applyView(animate) {
      shell.style.transition = animate ? "transform 180ms ease" : "none";
      shell.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomRef.current})`;
    }

    function clampPan() {
      const zoom = zoomRef.current;
      const maxX = Math.max(0, (book.clientWidth * (zoom - 1)) / 2);
      const maxY = Math.max(0, (book.clientHeight * (zoom - 1)) / 2);
      panRef.current.x = Math.min(maxX, Math.max(-maxX, panRef.current.x));
      panRef.current.y = Math.min(maxY, Math.max(-maxY, panRef.current.y));
    }

    function setZoom(next, animate = false) {
      const value = Math.min(2.8, Math.max(1, Math.round(next * 100) / 100));
      zoomRef.current = value;
      if (value === 1) panRef.current = { x: 0, y: 0 };
      else clampPan();
      applyView(animate);
      setZoomLevel(value);
    }

    zoomApiRef.current = (direction) => {
      if (direction === 0) setZoom(1, true);
      else setZoom(zoomRef.current + direction * 0.4, true);
    };

    async function turn(direction) {
      if (cancelled || busyRef.current || countRef.current === 0) return;
      const current = indexRef.current;
      const nextIndex = current + direction;
      if (nextIndex < 0 || nextIndex >= countRef.current) return;

      busyRef.current = true;
      try {
        panRef.current = { x: 0, y: 0 };
        applyView(false);
        const [currentSheet, nextSheet] = await Promise.all([
          ensureSheet(current),
          ensureSheet(nextIndex),
        ]);
        if (cancelled) return;
        if (direction > 0) {
          place(front, currentSheet);
          place(base, nextSheet);
          setLeaf(0);
        } else {
          place(base, currentSheet);
          place(front, nextSheet);
          setLeaf(-180);
        }
        leaf.classList.add("is-lifted");
        await frame();
        await animateTo(direction > 0 ? -180 : 0);
        if (!cancelled) {
          settleTo(nextIndex);
          scheduleNeighbors(nextIndex);
        }
      } finally {
        busyRef.current = false;
      }
    }

    turnRef.current = turn;

    function layoutBox() {
      const mobile = window.matchMedia("(max-width: 720px)").matches;
      if (!mobile) return { width: stage.clientWidth, height: stage.clientHeight };
      const side = 108;
      const width = Math.min(stage.clientWidth || window.innerWidth, window.innerWidth - side);
      const height = Math.max(220, window.innerHeight - 194);
      return { width, height };
    }

    async function renderBook() {
      const box = layoutBox();
      if (box.width < 2 || box.height < 2) return;
      if (
        Math.abs(box.width - laidOutWidth) < 24 &&
        Math.abs(box.height - laidOutHeight) < 24 &&
        (arranging || sheets[indexRef.current])
      ) {
        return;
      }

      const run = ++generation;
      arranging = true;
      try {
      cancelRenders();
      laidOutWidth = box.width;
      laidOutHeight = box.height;

      if (!pdfDoc && pageUrls.length === 0) {
        const response = await fetch(`${MENU_MANIFEST_PATH}?t=${Date.now()}`);
        if (!response.ok) throw new Error("menu manifest missing");
        const manifest = await response.json();
        if (!manifest?.src && !manifest?.pages?.length) throw new Error("menu file missing");
        if (cancelled || run !== generation) return;

        const src = manifest.src?.startsWith("/")
          ? `${import.meta.env.BASE_URL}${manifest.src.slice(1)}`
          : manifest.src;
        if (src) {
          menuSrc = src;
          setPdfUrl(src);
        }
        if (Array.isArray(manifest.pages) && manifest.pages.length > 0) {
          pageUrls = manifest.pages.map((page) =>
            page.startsWith("/") ? `${import.meta.env.BASE_URL}${page.slice(1)}` : page,
          );
        }
      }

      if (pageUrls.length > 0) {
        countRef.current = pageUrls.length;
        setCount(pageUrls.length);
        const first = await ensureImage(0);
        if (cancelled || run !== generation || !first) return;
        const frameScale = fitScale(first.naturalWidth, first.naturalHeight, box.width, box.height);
        frameWidth = Math.floor(first.naturalWidth * frameScale);
        frameHeight = Math.floor(first.naturalHeight * frameScale);
        page.style.width = `${frameWidth}px`;
        page.style.height = `${frameHeight}px`;
        stage.classList.toggle("is-wide", frameWidth > frameHeight);
        for (const image of sheets) {
          if (!image) continue;
          image.style.width = `${frameWidth}px`;
          image.style.height = `${frameHeight}px`;
        }
        await ensureImage(indexRef.current);
        if (cancelled || run !== generation) return;
        if (!busyRef.current && !interacting) showIdle();
        setStatus("ready");
        scheduleNeighbors(indexRef.current);
        return;
      }

      if (!pdfDoc) {
        loadingTask = getDocument({
          url: menuSrc,
          cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
          disableAutoFetch: true,
          disableStream: true,
          enableHWA: true,
        });
        pdfDoc = await loadingTask.promise;
      }

      if (cancelled || run !== generation) return;

      const first = await pdfDoc.getPage(1);
      if (cancelled || run !== generation) return;
      const firstBox = first.getViewport({ scale: 1 });
      const frameScale = fitScale(firstBox.width, firstBox.height, box.width, box.height);
      frameWidth = Math.floor(firstBox.width * frameScale);
      frameHeight = Math.floor(firstBox.height * frameScale);
      page.style.width = `${frameWidth}px`;
      page.style.height = `${frameHeight}px`;
      stage.classList.toggle("is-wide", frameWidth > frameHeight);

      const dpr = Math.min(window.devicePixelRatio || 1, 1.35);
      const pixelBudget = 900000;
      pixelRatio =
        frameWidth * frameHeight * dpr * dpr > pixelBudget
          ? Math.sqrt(pixelBudget / (frameWidth * frameHeight))
          : dpr;
      const pageCount = pdfDoc.numPages;
      countRef.current = pageCount;
      setCount(pageCount);
      sheetGeneration += 1;
      sheets = [];

      await ensureSheet(indexRef.current);
      if (cancelled || run !== generation) return;
      if (!busyRef.current && !interacting) showIdle();
      setStatus("ready");
      scheduleNeighbors(indexRef.current);
      } finally {
        if (run === generation) arranging = false;
      }
    }

    renderBook().catch((error) => {
      if (cancelled || error?.name === "RenderingCancelledException") return;
      setStatus("error");
    });

    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        renderBook().catch((error) => {
          if (cancelled || error?.name === "RenderingCancelledException") return;
          setStatus("error");
        });
      }, 150);
    };

    let startX = 0;
    let startY = 0;
    let panOrigin = { x: 0, y: 0 };
    let pinchStart = 0;
    let zoomStart = 1;
    let dragging = false;
    let interacting = false;
    let mode = "";
    let dragWidth = 1;
    const pointers = new Map();
    let samples = [];

    function noteSample(x, time) {
      samples.push({ x, time });
      const cutoff = time - 90;
      while (samples.length > 2 && samples[0].time < cutoff) samples.shift();
    }

    function releaseMotion() {
      if (samples.length < 2) return { pxPerMs: 0, degPerMs: 0 };
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.time - first.time;
      if (dt < 8) return { pxPerMs: 0, degPerMs: 0 };
      const pxPerMs = (last.x - first.x) / dt;
      return { pxPerMs, degPerMs: pxPerMs * (170 / dragSpan(dragWidth)) };
    }

    function pointerDistance() {
      const points = [...pointers.values()];
      if (points.length < 2) return 0;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }

    const onPointerDown = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        stage.setPointerCapture(event.pointerId);
        if (mode === "next" || mode === "prev" || mode === "resist") {
          setLeaf(0);
          leaf.classList.remove("is-lifted");
        }
        mode = "pinch";
        pinchStart = pointerDistance() || 1;
        zoomStart = zoomRef.current;
        dragging = true;
        interacting = true;
        return;
      }
      if (busyRef.current) return;
      dragging = true;
      interacting = true;
      mode = "";
      startX = event.clientX;
      startY = event.clientY;
      panOrigin = { ...panRef.current };
      dragWidth = book.clientWidth || 1;
      samples = [{ x: event.clientX, time: event.timeStamp }];
    };

    const onPointerMove = (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (mode === "pinch") {
        setZoom(zoomStart * (pointerDistance() / pinchStart));
        return;
      }
      if (!dragging || busyRef.current) return;
      noteSample(event.clientX, event.timeStamp);
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (zoomRef.current > 1.01) {
          mode = "pan";
        } else if (Math.abs(dy) > Math.abs(dx)) {
          mode = "ignore";
          return;
        } else if (dx < 0 && indexRef.current < countRef.current - 1) mode = "next";
        else if (dx > 0 && indexRef.current > 0) mode = "prev";
        else mode = "resist";

        if (mode !== "ignore") stage.setPointerCapture(event.pointerId);

        if (mode === "next") {
          place(front, sheets[indexRef.current]);
          place(base, sheets[indexRef.current + 1]);
          setLeaf(0);
          leaf.classList.add("is-lifted");
          void ensureSheet(indexRef.current + 1).then((canvas) => {
            if (!cancelled && mode === "next" && canvas) place(base, canvas);
          });
        } else if (mode === "prev") {
          place(base, sheets[indexRef.current]);
          place(front, sheets[indexRef.current - 1]);
          setLeaf(-180);
          leaf.classList.add("is-lifted");
          void ensureSheet(indexRef.current - 1).then((canvas) => {
            if (!cancelled && mode === "prev" && canvas) place(front, canvas);
          });
        }
      }

      if (mode === "pan") {
        panRef.current = { x: panOrigin.x + dx, y: panOrigin.y + dy };
        clampPan();
        applyView(false);
        return;
      }

      if (mode === "next" || mode === "prev" || mode === "resist") {
        pose(dragAngle(dx, dragWidth, mode));
      }
    };

    const onPointerUp = async (event) => {
      pointers.delete(event.pointerId);
      if (mode === "pinch") {
        if (pointers.size < 2) {
          dragging = false;
          interacting = false;
          mode = "";
        }
        return;
      }
      if (!dragging || pointers.size > 0) return;
      dragging = false;
      interacting = false;
      const dx = event.clientX - startX;
      const gesture = mode;
      const motion = releaseMotion();
      mode = "";
      if (gesture === "pan" || gesture === "ignore" || gesture === "") return;
      if (gesture !== "next" && gesture !== "prev" && gesture !== "resist") return;

      busyRef.current = true;
      try {
        if (gesture === "next") {
          const commit = dx <= -SWIPE_THRESHOLD || (dx < -16 && motion.pxPerMs < -FLICK_PX_PER_MS);
          if (commit && !sheets[indexRef.current + 1]) await ensureSheet(indexRef.current + 1);
          if (cancelled) return;
          await animateTo(commit ? -180 : 0, motion.degPerMs);
          if (cancelled) return;
          if (commit) {
            settleTo(indexRef.current + 1);
            scheduleNeighbors(indexRef.current);
          } else leaf.classList.remove("is-lifted");
        } else if (gesture === "prev") {
          const commit = dx >= SWIPE_THRESHOLD || (dx > 16 && motion.pxPerMs > FLICK_PX_PER_MS);
          if (commit && !sheets[indexRef.current - 1]) await ensureSheet(indexRef.current - 1);
          if (cancelled) return;
          await animateTo(commit ? 0 : -180, motion.degPerMs);
          if (cancelled) return;
          if (commit) {
            settleTo(indexRef.current - 1);
            scheduleNeighbors(indexRef.current);
          } else settleTo(indexRef.current);
        } else {
          await animateTo(0, motion.degPerMs);
          leaf.classList.remove("is-lifted");
        }
      } finally {
        busyRef.current = false;
      }
    };

    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(zoomRef.current * (event.deltaY < 0 ? 1.08 : 0.92));
    };

    const onKey = (event) => {
      const rect = stage.getBoundingClientRect();
      const middle = window.innerHeight / 2;
      if (rect.top > middle || rect.bottom < middle) return;
      if (event.key === "ArrowRight") turn(1);
      if (event.key === "ArrowLeft") turn(-1);
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    stage.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelled = true;
      turnRef.current = async () => {};
      zoomApiRef.current = () => {};
      stopMotion();
      window.clearTimeout(prefetchId);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      stage.removeEventListener("wheel", onWheel);
      cancelRenders();
      loadingTask?.destroy();
      pdfDoc?.destroy?.();
    };
  }, [pages, source]);

  const zoomed = zoomLevel > 1.01;

  return (
    <section className="volume">
      {status === "loading" && <p className="status">Loading menu…</p>}
      {status === "error" && (
        <p className="status">
          The menu could not be displayed.
          {pdfUrl ? (
            <>
              {" "}
              <a href={pdfUrl}>Open the PDF</a>
            </>
          ) : null}
        </p>
      )}
      <div ref={stageRef} className="stage">
        <div ref={pageRef} className="page">
          <div ref={shellRef} className="shell">
            <div ref={bookRef} className="book">
              <div ref={baseRef} className="sheet base" />
              <div ref={leafRef} className="leaf">
                <div ref={frontRef} className="face front" />
                <div className="face back" />
              </div>
            </div>
          </div>
          {status === "ready" && count > 1 && (
            <>
              <button
                type="button"
                className="turn prev"
                onClick={() => turnRef.current(-1)}
                disabled={index === 0}
                aria-label="Previous page"
              >
                ‹
              </button>
              <button
                type="button"
                className="turn next"
                onClick={() => turnRef.current(1)}
                disabled={index === count - 1}
                aria-label="Next page"
              >
                ›
              </button>
            </>
          )}
        </div>
      </div>
      {status === "ready" && (
        <footer className="foot">
            <div className="zoom">
              <button type="button" onClick={() => zoomApiRef.current(-1)} disabled={zoomLevel <= 1} aria-label="Zoom out">
                −
              </button>
              <button type="button" onClick={() => zoomApiRef.current(0)} aria-label="Fit page">
                Fit
              </button>
              <button type="button" onClick={() => zoomApiRef.current(1)} disabled={zoomLevel >= 2.8} aria-label="Zoom in">
                +
              </button>
              <a className="open-pdf" href={pdfUrl || "#"} target="_blank" rel="noopener noreferrer">
                Open PDF
              </a>
            </div>
            <p className="hint">
              {zoomed
                ? "Drag to look around. Press Fit to swipe between pages."
                : moreBelow
                  ? "Swipe to turn the page. Scroll down for more menus."
                  : "Swipe left or right to turn the page"}
            </p>
            {count > 0 && (
              <p className="pager" aria-live="polite">
                {index + 1} / {count}
              </p>
            )}
          </footer>
      )}
    </section>
  );
}

export default function App() {
  const [books, setBooks] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${MENU_MANIFEST_PATH}?t=${Date.now()}`)
      .then((response) => {
        if (!response.ok) throw new Error("menu manifest missing");
        return response.json();
      })
      .then((manifest) => {
        if (cancelled) return;
        const next = Array.isArray(manifest.books) && manifest.books.length
          ? manifest.books
          : manifest.pages?.length
            ? [{ title: "Menu", src: manifest.src, pages: manifest.pages }]
            : [];
        if (!next.length) throw new Error("menu file missing");
        setBooks(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <header className="topbar">
        <img className="logo" src="/logo.png" alt="On The Hill Karon Resort" />
      </header>
      {failed && <p className="status">The menu could not be displayed.</p>}
      {books?.map((book, index) => (
        <BookView
          key={book.id || book.title}
          pages={book.pages}
          source={book.src}
          moreBelow={index === 0 && books.length > 1}
        />
      ))}
    </main>
  );
}
