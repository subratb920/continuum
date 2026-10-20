// continuum-site: the page's motion. Everything reads without it (search
// engines, no JavaScript, reduced motion); with it:
//   - a progress line, and a header that tightens once you scroll
//   - the hero's glow drifting slower than the page (parallax)
//   - cards easing in as they arrive, their columns sliding at different speeds
//   - a statement whose words light up as you scroll through it
//   - "Continuum for …" changing one phrase at a time, in one place
//   - the topics staying still and lighting up in reading order as you scroll
//   - "Everything Continuum does" gliding sideways as you scroll down
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
  const chipBox = document.querySelector(".topic-groups");
  const chips = chipBox ? [...chipBox.querySelectorAll(".chip")] : [];
  const railCards = rail ? [...rail.querySelectorAll(".rail-card")] : [];
  // Sideways, the rail moves this much faster than the page scrolls down
  const RAIL_SPEED = 1.25;

  let ticking = false;
  let railAt = 0; // where the rail is (it eases toward where the scroll says)
  let railTo = 0;

  // Where an element is: -1 (below the screen) … 0 (centred) … 1 (above)
  const offset = (el) => {
    const r = el.getBoundingClientRect();
    return (innerHeight / 2 - (r.top + r.height / 2)) / (innerHeight / 2 + r.height / 2);
  };

  function frame() {
    ticking = false;
    const y = scrollY;
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
      railTo = -p * (track.scrollWidth - track.clientWidth);
    }

    // The topics light up in reading order while their box crosses the screen; the newest glows
    if (chips.length) {
      const r = chipBox.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight * 0.8 - r.top) / (r.height + innerHeight * 0.2)));
      const lit = Math.round(p * chips.length);
      chips.forEach((c, i) => {
        c.classList.toggle("lit", i < lit);
        c.classList.toggle("now", i === lit - 1 && p < 1);
      });
    }
  }

  // The rail glides after the scroll (eased), never jumping with it
  function glide() {
    if (track && rail.classList.contains("is-pinned")) {
      railAt += (railTo - railAt) * 0.09;
      if (Math.abs(railTo - railAt) < 0.3) railAt = railTo;
      track.style.transform = `translate3d(${railAt.toFixed(1)}px,0,0)`;
      // The card nearest the middle comes forward; the others step back a little
      const mid = innerWidth / 2;
      for (const c of railCards) {
        const b = c.getBoundingClientRect();
        const d = Math.min(1, Math.abs(b.left + b.width / 2 - mid) / (innerWidth * 0.6));
        c.style.setProperty("--focus", (1 - d).toFixed(3));
      }
    }
    requestAnimationFrame(glide);
  }
  if (rail) requestAnimationFrame(glide);

  // "Continuum for …": the next phrase every few seconds (not while pointed at, or the tab is away)
  const rot = [...document.querySelectorAll(".rot-item")];
  let rotAt = 0;
  let held = false;
  document.querySelector(".rotator")?.addEventListener("pointerenter", () => (held = true));
  document.querySelector(".rotator")?.addEventListener("pointerleave", () => (held = false));
  const rotBox = document.querySelector(".rot");
  // The phrase's box takes the width of the phrase showing, so the line stays together
  const fit = () => rotBox && rot[rotAt] && (rotBox.style.width = `${rot[rotAt].scrollWidth}px`);
  addEventListener("resize", fit);
  fit();
  if (rot.length > 1) {
    setInterval(() => {
      if (held || document.hidden) return;
      rot[rotAt].classList.replace("is-on", "is-out");
      const out = rot[rotAt];
      setTimeout(() => out.classList.remove("is-out"), 700);
      rotAt = (rotAt + 1) % rot.length;
      rot[rotAt].classList.add("is-on");
      fit();
    }, 2800);
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
