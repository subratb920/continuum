// continuum-site: the page's motion and its menu. Everything reads without it
// (search engines, no JavaScript, reduced motion); with it:
//   - the menu's groups open their panels on hover, click or keyboard
//   - a progress line, and a header that tightens once you scroll
//   - the hero's glow drifting slower than the page (parallax)
//   - cards easing in as they arrive, their columns sliding at different speeds
//   - a statement whose words light up as you scroll through it
//   - "Continuum for …" changing one phrase at a time, in one place
//   - the topics standing still and lighting up in reading order as you scroll
//   - "Everything Continuum does" as a workflow run: one dot travels a path
//     through every topic as you scroll, lighting each step it reaches
//   - a light that follows the cursor over cards, and a slight tilt
(() => {
  const root = document.documentElement;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");
  if (still) root.classList.add("still");

  // ── The menu: a group's panel opens on hover (CSS), click or Enter; Esc or a click elsewhere closes it
  const groups = [...document.querySelectorAll(".mn-group")];
  const setOpen = (g, open) => {
    g.classList.toggle("is-open", open);
    g.querySelector(".mn-btn").setAttribute("aria-expanded", String(open));
  };
  for (const g of groups) {
    g.querySelector(".mn-btn").addEventListener("click", () => {
      const open = !g.classList.contains("is-open");
      groups.forEach((o) => setOpen(o, o === g && open));
    });
    g.addEventListener("mouseleave", () => setOpen(g, false));
  }
  addEventListener("keydown", (e) => e.key === "Escape" && groups.forEach((g) => setOpen(g, false)));
  addEventListener("click", (e) => !e.target.closest(".mn-group") && groups.forEach((g) => setOpen(g, false)));

  // ── Arriving: each [data-reveal] eases in once (children by their data-i)
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

  const bar = document.querySelector(".progress");
  const glow = document.querySelector(".hero");
  const drifting = [...document.querySelectorAll("[data-speed]")];
  const statement = document.querySelector(".statement");
  const words = statement ? [...statement.querySelectorAll(".sw")] : [];
  const chipBox = document.querySelector(".topic-groups");
  const chips = chipBox ? [...chipBox.querySelectorAll(".chip")] : [];

  // ── The workflow run
  const flow = document.querySelector(".flow");
  const canvas = flow?.querySelector(".flow-canvas");
  const svg = flow?.querySelector(".flow-svg");
  const track = flow?.querySelector(".flow-track");
  const done = flow?.querySelector(".flow-done");
  const dot = flow?.querySelector(".flow-dot");
  const nodes = flow ? [...flow.querySelectorAll(".flow-node")] : [];
  // Scrolling per step (in screens): the run takes its time, a step at a time
  const STEP_SCROLL = 0.32;
  let map = null; // { total, at: [length of each step along the path] } when laid out on the path
  let runAt = 0; // where the dot is (it eases toward where the scroll says)
  let runTo = 0;

  /** Wide screens: the steps on a winding path (4 to a row, each row turning back); else a list. */
  function layoutFlow() {
    map = null;
    if (!flow) return;
    const wide = innerWidth > 900 && !still;
    canvas.classList.toggle("is-mapped", wide);
    flow.classList.toggle("is-pinned", wide);
    if (!wide) {
      flow.style.height = "";
      nodes.forEach((n) => (n.style.left = n.style.top = ""));
      return;
    }
    flow.style.height = `${innerHeight * (1 + nodes.length * STEP_SCROLL)}px`;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const cols = 4;
    const rows = Math.ceil(nodes.length / cols);
    const top = 40;
    const bottom = 96; // room for the last row's words
    const dy = rows > 1 ? (H - top - bottom) / (rows - 1) : 0;
    const r = dy / 2;
    const side = Math.max(110, r + 40);
    const dx = (W - side * 2) / (cols - 1);
    const rowLen = dx * (cols - 1) + Math.PI * r;
    let d = "";
    const at = [];
    nodes.forEach((n, i) => {
      const row = Math.floor(i / cols);
      const j = i % cols;
      const col = row % 2 ? cols - 1 - j : j;
      const x = side + col * dx;
      const y = top + row * dy;
      n.style.left = `${x}px`;
      n.style.top = `${y}px`;
      n.dataset.edge = col === 0 ? "start" : col === cols - 1 ? "end" : "";
      at.push(row * rowLen + j * dx);
      if (i === 0) d = `M${x} ${y}`;
      else if (j === 0) d += ` A${r} ${r} 0 0 ${row % 2 ? 1 : 0} ${x} ${y}`; // turning down into this row
      else d += ` L${x} ${y}`;
    });
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    track.setAttribute("d", d);
    done.setAttribute("d", d);
    const total = done.getTotalLength();
    done.style.strokeDasharray = `${total}`;
    map = { total, at };
    drawRun(runAt);
  }

  /** The dot at a length along the path; steps behind it lit, the one it's at open. */
  function drawRun(len) {
    const p = done.getPointAtLength(len);
    dot.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    done.style.strokeDashoffset = `${map.total - len}`;
    let now = -1;
    map.at.forEach((a, i) => {
      const lit = a <= len + 2;
      nodes[i].classList.toggle("lit", lit);
      if (lit) now = i;
    });
    nodes.forEach((n, i) => n.classList.toggle("now", i === now));
  }

  let ticking = false;
  function frame() {
    ticking = false;
    const y = scrollY;
    const max = root.scrollHeight - innerHeight;
    if (bar) bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    root.classList.toggle("scrolled", y > 24);
    if (still) return;
    if (glow) glow.style.setProperty("--drift", `${Math.min(y, innerHeight) * 0.35}px`);

    // Columns at their own speed (Capgemini's staggered rows)
    for (const el of drifting) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) continue;
      const off = (innerHeight / 2 - (r.top + r.height / 2)) / (innerHeight / 2 + r.height / 2);
      el.style.setProperty("--shift", `${(-off * Number(el.dataset.speed) * 60).toFixed(1)}px`);
    }

    // The statement lights up word by word while it crosses the screen
    if (words.length) {
      const r = statement.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
      const lit = Math.round(p * words.length);
      words.forEach((w, i) => w.classList.toggle("lit", i < lit));
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

    // The run: how far down the pinned section you are is how far along the path the dot goes
    if (map) {
      const r = flow.getBoundingClientRect();
      const run = flow.offsetHeight - innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(run, 1)));
      runTo = p * map.at[map.at.length - 1];
    } else if (flow && innerWidth <= 900) {
      // Phones: the line down the list fills as you go, the dot at its end
      const r = canvas.getBoundingClientRect();
      const fill = Math.min(r.height, Math.max(0, innerHeight * 0.6 - r.top));
      canvas.style.setProperty("--fill", `${fill}px`);
      let now = -1;
      nodes.forEach((n, i) => {
        const lit = n.offsetTop + 14 <= fill;
        n.classList.toggle("lit", lit);
        if (lit) now = i;
      });
      nodes.forEach((n, i) => n.classList.toggle("now", i === now));
    }
  }
  const onScroll = () => {
    if (!ticking) (ticking = true), requestAnimationFrame(frame);
  };

  // The dot glides after the scroll (eased), never jumping with it
  function glide() {
    if (map) {
      runAt += (runTo - runAt) * 0.08;
      if (Math.abs(runTo - runAt) < 0.3) runAt = runTo;
      drawRun(runAt);
    }
    requestAnimationFrame(glide);
  }

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => (layoutFlow(), onScroll()));
  layoutFlow();
  frame();
  if (still) {
    nodes.forEach((n) => n.classList.add("lit"));
    return;
  }
  requestAnimationFrame(glide);

  // "Continuum for …": the next phrase every few seconds (not while pointed at, or the tab is away)
  const rot = [...document.querySelectorAll(".rot-item")];
  const rotBox = document.querySelector(".rot");
  let rotAt = 0;
  let held = false;
  document.querySelector(".rotator")?.addEventListener("pointerenter", () => (held = true));
  document.querySelector(".rotator")?.addEventListener("pointerleave", () => (held = false));
  // The phrase's box takes the width of the phrase showing, so the line stays together
  const fit = () => rotBox && rot[rotAt] && (rotBox.style.width = `${rot[rotAt].scrollWidth}px`);
  addEventListener("resize", fit);
  fit();
  if (rot.length > 1) {
    setInterval(() => {
      if (held || document.hidden) return;
      const out = rot[rotAt];
      out.classList.replace("is-on", "is-out");
      setTimeout(() => out.classList.remove("is-out"), 700);
      rotAt = (rotAt + 1) % rot.length;
      rot[rotAt].classList.add("is-on");
      fit();
    }, 2800);
  }

  // A light under the cursor, and a slight tilt toward it
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.querySelectorAll(".card, .explore a, .mn-feature").forEach((el) => {
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

// Visitor beacon + lead form. First-party, no cookies; honors Do-Not-Track for
// the beacon. Reads the API's address from <meta name="api-base"> (left out
// when no API is configured, so this does nothing then). Self-contained so it
// runs whether or not the motion above did.
(() => {
  const api = document.querySelector('meta[name="api-base"]')?.content?.replace(/\/+$/, "");
  if (!api) return;

  // A real browser confirming this page view, with a little harmless enrichment.
  // Fires on load (not unload), so a normal fetch is reliable and uses the
  // server's CORS + JSON path cleanly. Suppressed under Do-Not-Track.
  const dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.msDoNotTrack === "1";
  if (!dnt) {
    try {
      fetch(`${api}/public/visits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          path: location.pathname,
          referer: document.referrer || null,
          client: {
            screen: `${screen.width}×${screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
            language: navigator.language || null,
          },
        }),
      }).catch(() => {});
    } catch {
      /* a beacon never matters enough to surface */
    }
  }

  // The "stay in touch" lead form: send by fetch, no page reload.
  const form = document.querySelector("form[data-lead]");
  if (form) {
    const msg = form.querySelector(".signup-msg");
    const btn = form.querySelector("button");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = form.email?.value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        if (msg) msg.textContent = "Enter an email we can reach you at.";
        return;
      }
      if (btn) btn.disabled = true;
      if (msg) msg.textContent = "Sending…";
      try {
        const r = await fetch(`${api}/public/leads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, company: form.company?.value || "", page: location.pathname }),
        });
        if (!r.ok) throw new Error();
        form.reset();
        if (msg) msg.textContent = "Thanks — we'll be in touch.";
      } catch {
        if (msg) msg.textContent = "That didn't go through. Please try again.";
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
})();
