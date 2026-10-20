// continuum-site: the page's motion. Everything reads without it (search
// engines, no JavaScript, reduced motion); with it:
//   - a progress line, and a header that tightens once you scroll
//   - the hero's glow drifting slower than the page (parallax)
//   - cards easing in as they arrive, their columns sliding at different speeds
//   - a statement whose words light up as you scroll through it
//   - keyword rows sliding, faster while you scroll
//   - "Everything Continuum does" sliding sideways as you scroll down
//   - a light that follows the cursor over cards, and a slight tilt
(() => {
  const root = document.documentElement;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");
  if (still) root.classList.add("still");

  // Arriving: each [data-reveal] eases in once (children by their --i)
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        seen.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );
  document.querySelectorAll("[data-reveal]").forEach((el) => seen.observe(el));
  if (still) return;

  const bar = document.querySelector(".progress");
  const glow = document.querySelector(".hero");
  const drifting = [...document.querySelectorAll("[data-speed]")];
  const statement = document.querySelector(".statement");
  const words = statement ? [...statement.querySelectorAll(".sw")] : [];
  const rail = document.querySelector(".rail");
  const track = rail?.querySelector(".rail-track");
  const rows = [...document.querySelectorAll(".marquee-row")];
  const railCards = rail ? [...rail.querySelectorAll(".rail-card")] : [];
  // Sideways, the rail moves this much faster than the page scrolls down
  const RAIL_SPEED = 1.6;

  let lastY = scrollY;
  let velocity = 0;
  let ticking = false;

  // Where an element is: -1 (below the screen) … 0 (centred) … 1 (above)
  const offset = (el) => {
    const r = el.getBoundingClientRect();
    return (innerHeight / 2 - (r.top + r.height / 2)) / (innerHeight / 2 + r.height / 2);
  };

  function frame() {
    ticking = false;
    const y = scrollY;
    velocity = velocity * 0.8 + Math.abs(y - lastY) * 0.2;
    lastY = y;
    const max = root.scrollHeight - innerHeight;

    if (bar) bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    root.classList.toggle("scrolled", y > 24);
    if (glow) glow.style.setProperty("--drift", `${Math.min(y, innerHeight) * 0.35}px`);

    // Columns at their own speed (Capgemini's staggered rows)
    for (const el of drifting) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) continue;
      el.style.setProperty("--shift", `${(-offset(el) * Number(el.dataset.speed) * 60).toFixed(1)}px`);
    }

    // The statement lights up word by word while it crosses the screen
    if (words.length) {
      const r = statement.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
      const lit = Math.round(p * words.length);
      words.forEach((w, i) => w.classList.toggle("lit", i < lit));
    }

    // Down the page, sideways along the rail (wide screens; phones swipe it)
    if (rail && track && rail.classList.contains("is-pinned")) {
      const r = rail.getBoundingClientRect();
      const run = rail.offsetHeight - innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(run, 1)));
      track.style.transform = `translate3d(${(-p * (track.scrollWidth - track.clientWidth)).toFixed(1)}px,0,0)`;
      // The card nearest the middle comes forward; the others step back a little
      const mid = innerWidth / 2;
      for (const c of railCards) {
        const b = c.getBoundingClientRect();
        const d = Math.min(1, Math.abs(b.left + b.width / 2 - mid) / (innerWidth * 0.6));
        c.style.setProperty("--focus", (1 - d).toFixed(3));
      }
    }

    // Keyword rows: a little faster while the page moves
    const boost = 1 + Math.min(velocity / 6, 4);
    for (const row of rows) for (const a of row.getAnimations()) a.playbackRate = boost;
  }
  const onScroll = () => {
    if (!ticking) (ticking = true), requestAnimationFrame(frame);
  };

  // The rail is pinned when there's room: its height becomes the sideways distance
  function sizeRail() {
    if (!rail || !track) return;
    const wide = innerWidth > 900;
    rail.classList.toggle("is-pinned", wide);
    rail.style.height = wide ? `${innerHeight + Math.max(0, track.scrollWidth - track.clientWidth) / RAIL_SPEED}px` : "";
    if (!wide) track.style.transform = "";
  }

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => (sizeRail(), onScroll()));
  sizeRail();
  frame();
  // Settle the rows' speed back down when scrolling stops
  setInterval(() => velocity > 0.5 && onScroll(), 120);

  // A light under the cursor, and a slight tilt toward it
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (fine) {
    document.querySelectorAll(".card, .rail-card, .explore a").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const yy = (e.clientY - r.top) / r.height;
        el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${(yy * 100).toFixed(1)}%`);
        el.style.setProperty("--rx", `${((0.5 - yy) * 4).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${((x - 0.5) * 5).toFixed(2)}deg`);
      });
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
      });
    });

    // The main buttons lean toward the cursor
    document.querySelectorAll(".btn.big").forEach((b) => {
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        b.style.setProperty("--tx", `${((e.clientX - r.left - r.width / 2) * 0.15).toFixed(1)}px`);
        b.style.setProperty("--ty", `${((e.clientY - r.top - r.height / 2) * 0.25).toFixed(1)}px`);
      });
      b.addEventListener("pointerleave", () => (b.style.setProperty("--tx", "0px"), b.style.setProperty("--ty", "0px")));
    });
  }
})();
