(() => {
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (window.Lenis && !reduced) lenis = new window.Lenis({ lerp: 0.1, wheelMultiplier: 0.9 });

  const fontsReady = Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((r) => setTimeout(r, 1500)),
  ]);

  /* ---------- centre of the enclosed counter of the "a" ----------
     Draw the glyph on a canvas, flood-fill the outside, and what is
     left unfilled is the counter. Its centroid is where the intro opens. */
  function counterCentre(span) {
    const word = span.parentElement;
    const cs = getComputedStyle(word);
    const fs = parseFloat(cs.fontSize);
    const pad = Math.ceil(fs * 0.15);
    const base = Math.ceil(fs * 1.1);
    const w = Math.ceil(fs * 0.9) + pad * 2;
    const h = Math.ceil(fs * 1.35);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('a', pad, base);
    const data = ctx.getImageData(0, 0, w, h).data;
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = data[i * 4 + 3] > 110 ? 1 : 0;

    const seen = new Uint8Array(w * h);
    const fill = (start) => {
      const stack = [start]; const pts = [];
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop(); pts.push(i);
        const x = i % w, y = (i / w) | 0;
        const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of n) if (j >= 0 && !seen[j] && !ink[j]) { seen[j] = 1; stack.push(j); }
      }
      return pts;
    };
    fill(0); // the outside
    let best = null;
    for (let i = 0; i < w * h; i++) {
      if (!seen[i] && !ink[i]) { const pts = fill(i); if (!best || pts.length > best.length) best = pts; }
    }
    const probe = $('.hero__probe', span);
    const baseline = probe.getBoundingClientRect().bottom;
    const left = span.getBoundingClientRect().left;
    if (!best) { // no enclosed counter (font failed to load): fall back to the glyph box
      const r = span.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: baseline - fs * 0.25 };
    }
    let sx = 0, sy = 0;
    best.forEach((i) => { sx += i % w; sy += (i / w) | 0; });
    return { x: left + sx / best.length - pad, y: baseline + sy / best.length - base };
  }

  /* ---------- intro: the site opens out of the "a" ---------- */
  const intro = $('.intro');
  const ring = $('.intro-ring');
  const letterA = $('.hero__a');

  function endIntro() {
    root.classList.remove('is-intro');
    root.classList.add('is-done');
    if (lenis) lenis.start();
  }

  function runIntro() {
    if (lenis) lenis.stop();
    const { x, y } = counterCentre(letterA);
    const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    [intro, ring].forEach((el) => { el.style.setProperty('--ix', `${x}px`); el.style.setProperty('--iy', `${y}px`); });

    if (reduced) {
      intro.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease', fill: 'forwards' });
      ring.style.display = 'none';
      root.classList.add('is-revealed');
      setTimeout(endIntro, 320);
      return;
    }

    // hold on "Finance." for a beat, then open
    setTimeout(() => {
      const t = '--r 1.3s cubic-bezier(.77, 0, .175, 1)';
      [intro, ring].forEach((el) => { el.style.transition = t; el.style.setProperty('--r', `${far + 2}px`); });
      ring.animate([{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 1300, easing: 'ease-out', fill: 'forwards' });
      setTimeout(() => root.classList.add('is-revealed'), 280);
      let done = false;
      const finish = () => { if (!done) { done = true; endIntro(); } };
      intro.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 1600); // if --r cannot transition, still finish
    }, 650);
  }

  /* ---------- intraday chart ---------- */
  const chartEl = $('.chart');
  const body = $('[data-chart]');
  const svg = body && $('.chart__svg', body);
  const read = $('[data-read]');
  const vLine = $('.xh--v'), hLine = $('.xh--h');
  const marker = $('.chart__marker');
  const tagX = $('.tag--x'), tagY = $('.tag--y'), tagLast = $('.tag--last');
  const dotEl = $('.hero__word em');
  const stage = $('.hero__stage');

  const V_MAX = 3, V_MIN = -4;          // percent
  const T_OPEN = 570, T_CLOSE = 960;   // 09:30 to 16:00, in minutes
  const G = {};                         // geometry and series
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false, ready: false };

  const pct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildChart() {
    if (!body) return;
    const br = body.getBoundingClientRect();
    const axisW = parseFloat(getComputedStyle(stage).getPropertyValue('--axis-w')) || 66;
    const xAxisH = parseFloat(getComputedStyle(stage).getPropertyValue('--xaxis-h')) || 28;
    const W = br.width, H = br.height;
    const P = { l: 0, t: 0, r: W - axisW, b: H - xAxisH };
    const ys = (v) => P.t + ((V_MAX - v) / (V_MAX - V_MIN)) * (P.b - P.t);
    const yv = (y) => V_MAX - ((y - P.t) / (P.b - P.t)) * (V_MAX - V_MIN);
    const xs = (m) => P.l + ((m - T_OPEN) / (T_CLOSE - T_OPEN)) * (P.r - P.l);
    const xm = (x) => T_OPEN + ((x - P.l) / (P.r - P.l)) * (T_CLOSE - T_OPEN);

    // the period of "Finance." is the last trade: find the square's ink, not its line box
    const d = dotEl.getBoundingClientRect();
    const wcs = getComputedStyle(dotEl.parentElement);
    const gctx = document.createElement('canvas').getContext('2d');
    gctx.font = `${wcs.fontWeight} ${wcs.fontSize} ${wcs.fontFamily}`;
    const gm = gctx.measureText('.');
    const baseline = $('.hero__probe').getBoundingClientRect().bottom;
    const inkL = d.left - gm.actualBoundingBoxLeft, inkR = d.left + gm.actualBoundingBoxRight;
    const inkT = baseline - gm.actualBoundingBoxAscent, inkB = baseline + gm.actualBoundingBoxDescent;
    const dot = {
      x: clamp((inkL + inkR) / 2 - br.left, P.l + 40, P.r),
      y: clamp((inkT + inkB) / 2 - br.top, P.t, P.b),
      half: (inkR - inkL) / 2,
    };
    const vEnd = yv(dot.y);

    // a seeded Brownian bridge from the open (0%) to the last trade
    const n = Math.max(40, Math.round((dot.x - P.l) / 4));
    const r = rng(11);
    const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
    const walk = [0];
    const sigma = 1.55 / Math.sqrt(n);
    for (let i = 1; i <= n; i++) walk.push(walk[i - 1] + gauss() * sigma);
    const series = walk.map((wv, i) => {
      const k = i / n;
      return clamp(wv - k * walk[n] + k * vEnd, V_MIN + 0.4, V_MAX - 0.4);
    });
    series[n] = vEnd;
    const pts = series.map((v, i) => [P.l + (i / n) * (dot.x - P.l), ys(v)]);

    // svg: grid, axes, labels, series
    const ns = [];
    for (let v = V_MAX; v >= V_MIN; v--) {
      const y = ys(v).toFixed(1);
      ns.push(`<line class="${v === 0 ? 'g-zero' : 'g-h'}" x1="${P.l}" x2="${P.r}" y1="${y}" y2="${y}"/>`);
      ns.push(`<text x="${W}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%</text>`);
    }
    const step = W < 700 ? 120 : 60;
    for (let m = T_OPEN; m < T_CLOSE; m += step) {
      const x = xs(m).toFixed(1);
      ns.push(`<line class="g-v" x1="${x}" x2="${x}" y1="${P.t}" y2="${P.b}"/>`);
      ns.push(`<text x="${x}" y="${H - 6}" text-anchor="${m === T_OPEN ? 'start' : 'middle'}">${hhmm(m)}</text>`);
    }
    ns.push(`<line class="axis" x1="${P.r}" x2="${P.r}" y1="${P.t}" y2="${P.b}"/>`);
    ns.push(`<line class="axis" x1="${P.l}" x2="${P.r}" y1="${P.b}" y2="${P.b}" opacity=".35"/>`);
    const dPath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    ns.push(`<defs><linearGradient id="fs-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#252422" stop-opacity=".07"/><stop offset="1" stop-color="#252422" stop-opacity="0"/></linearGradient></defs>`);
    ns.push(`<path class="area" fill="url(#fs-area)" d="${dPath}L${dot.x.toFixed(1)} ${P.b}L${P.l} ${P.b}Z"/>`);
    ns.push(`<path class="line" pathLength="1" d="${dPath}"/>`);
    ns.push(`<line class="last" x1="${(dot.x + dot.half + 8).toFixed(1)}" x2="${P.r}" y1="${dot.y.toFixed(1)}" y2="${dot.y.toFixed(1)}"/>`);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = ns.join('');

    body.style.setProperty('--plot-w', `${P.r - P.l}px`);
    body.style.setProperty('--plot-h', `${P.b - P.t}px`);
    tagLast.style.transform = `translate3d(${P.r}px, ${dot.y}px, 0)`;
    tagLast.textContent = `FS ${pct(vEnd)}`;

    let hi = -Infinity, lo = Infinity;
    series.forEach((v) => { hi = Math.max(hi, v); lo = Math.min(lo, v); });
    Object.assign(G, { W, H, P, ys, yv, xs, xm, dot, series, n, vEnd, hi, lo, br, tNow: xm(dot.x) });

    if (!pointer.ready || !pointer.active) { pointer.x = pointer.tx = dot.x; pointer.y = pointer.ty = dot.y; }
    pointer.ready = true;
    readout(dot.x, true);
  }

  // value of the series at plot x (clamped to the trading so far)
  function seriesAt(x) {
    const { P, dot, series, n } = G;
    const k = clamp((x - P.l) / (dot.x - P.l)) * n;
    const i = Math.floor(k), f = k - i;
    return i >= n ? series[n] : series[i] * (1 - f) + series[i + 1] * f;
  }

  let lastRead = '';
  function readout(x, force) {
    const xc = Math.min(x, G.dot.x);
    const v = seriesAt(xc);
    const t = hhmm(G.xm(xc));
    const key = `${t}${v.toFixed(2)}`;
    if (!force && key === lastRead) return;
    lastRead = key;
    read.innerHTML =
      `<span>${t} ET</span><span>Last <b class="${v < 0 ? 'dn' : ''}">${pct(v)}</b></span>` +
      `<span>High <b>${pct(G.hi)}</b></span><span>Low <b class="dn">${pct(G.lo)}</b></span>`;
  }

  function drawPointer() {
    if (!pointer.ready) return;
    const k = reduced ? 1 : 0.18; // eased follow, so the crosshair has weight
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    const { P, xm, yv } = G;
    const x = pointer.x, y = pointer.y;
    vLine.style.transform = `translate3d(${x}px, ${P.t}px, 0)`;
    hLine.style.transform = `translate3d(${P.l}px, ${y}px, 0)`;
    tagY.style.transform = `translate3d(${P.r}px, ${y}px, 0)`;
    tagY.textContent = pct(yv(y));
    tagX.textContent = `${hhmm(xm(x))}`;
    const tw = tagX.offsetWidth || 44;
    tagX.style.transform = `translate3d(${clamp(x - tw / 2, P.l, P.r - tw)}px, ${P.b + 4}px, 0)`;
    const mx = Math.min(x, G.dot.x);
    marker.style.transform = `translate3d(${mx}px, ${G.ys(seriesAt(mx))}px, 0)`;
    readout(x);
  }

  if (stage) {
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !pointer.ready || !root.classList.contains('is-done')) return;
      const { P } = G;
      const br = body.getBoundingClientRect();
      pointer.tx = clamp(e.clientX - br.left, P.l, P.r);
      pointer.ty = clamp(e.clientY - br.top, P.t, P.b);
      if (!pointer.active) { pointer.active = true; chartEl.classList.add('is-active'); }
    });
    stage.addEventListener('pointerleave', () => {
      // glide back to the last trade
      pointer.active = false;
      chartEl.classList.remove('is-active');
      pointer.tx = G.dot.x; pointer.ty = G.dot.y;
    });
  }

  fontsReady.then(() => {
    buildChart();
    if (intro && letterA) requestAnimationFrame(runIntro);
    else { root.classList.add('is-revealed'); endIntro(); }
  });
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(buildChart, 120); });

  /* ---------- statement words ---------- */
  const statement = $('[data-words]');
  let words = [];
  if (statement) {
    statement.innerHTML = statement.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
    words = $$('.w', statement);
  }

  /* ---------- marquee: duplicate the track for a seamless loop ---------- */
  $$('.marquee').forEach((m) => {
    const track = $('.marquee__track', m);
    const copy = track.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    $$('img', copy).forEach((img) => (img.alt = ''));
    m.appendChild(copy);
  });

  /* ---------- scroll reveals (fire once) ---------- */
  $$('.roles .role').forEach((el, i) => el.style.setProperty('--d', i));
  $$('.statement__row .fact').forEach((el, i) => el.style.setProperty('--d', i));
  // clipped headings have no visible area until revealed, so watch their parent
  const watched = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      (watched.get(e.target) || []).forEach((el) => el.classList.add('in'));
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  $$('.reveal, .reveal-clip').forEach((el) => {
    const target = el.classList.contains('reveal-clip') ? el.parentElement : el;
    if (!watched.has(target)) { watched.set(target, []); io.observe(target); }
    watched.get(target).push(el);
  });

  /* ---------- footer wordmark: same gap on both sides ---------- */
  const mega = $('[data-mega]');
  const measure = document.createElement('canvas').getContext('2d');
  function fitMega() {
    if (!mega) return;
    const box = mega.parentElement;
    const gap = parseFloat(getComputedStyle(box).paddingLeft);
    const avail = box.clientWidth - gap * 2;
    const base = 100;
    mega.style.fontSize = `${base}px`;
    mega.style.marginLeft = '0px';
    const layoutW = mega.getBoundingClientRect().width;
    // side bearings of the first and last glyphs, so the ink (not the box) is centred
    measure.font = `700 ${base}px "SK Modernist"`;
    const first = measure.measureText('T');
    const last = measure.measureText('t');
    const lsb = -first.actualBoundingBoxLeft;
    const rsb = last.width - last.actualBoundingBoxRight;
    const ink = layoutW - lsb - rsb;
    const k = avail / ink;
    mega.style.fontSize = `${base * k}px`;
    mega.style.marginLeft = `${-lsb * k}px`;
  }
  fontsReady.then(fitMega);
  window.addEventListener('resize', fitMega);

  /* ---------- per-frame scroll effects ---------- */
  const header = $('.header');
  const hero = $('.hero');
  const stack = $('[data-stack]');
  const panels = stack ? $$('.panel', stack) : [];
  const panelImgs = panels.map((p) => $('.panel__media img', p));
  if (stack) stack.style.setProperty('--n', panels.length);

  let lastY = 0;
  function onScroll() {
    const y = window.scrollY;
    const vh = window.innerHeight;

    if (header && root.classList.contains('is-done')) {
      header.classList.toggle('is-solid', y > 40);
      if (y > lastY + 2 && y > hero.offsetHeight * 0.6) header.classList.add('is-hidden');
      else if (y < lastY - 2 || y < 40) header.classList.remove('is-hidden');
    }
    lastY = y;

    if (statement && words.length) {
      const r = statement.getBoundingClientRect();
      const p = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.35));
      const on = Math.round(p * words.length);
      words.forEach((w, i) => w.classList.toggle('on', i < on));
    }

    if (stack && panels.length) {
      const scrolled = -stack.getBoundingClientRect().top;
      panels.forEach((panel, i) => {
        const local = i === 0 ? 1 : clamp((scrolled - (i - 1) * vh) / vh);
        if (i > 0) panel.style.transform = `translate3d(${((1 - local) * 100).toFixed(3)}%, 0, 0)`;
        // photo lags behind its panel, then settles
        const img = panelImgs[i];
        if (img && !reduced) img.style.transform = `translate3d(${(-(1 - local) * 18).toFixed(2)}%, 0, 0) scale(1.12)`;
      });
    }
  }

  function raf(time) {
    if (lenis) lenis.raf(time);
    onScroll();
    if (window.scrollY < innerHeight) drawPointer();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  /* ---------- anchors & placeholder links ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('href');
    if (id.length < 2) return; // placeholder buttons go nowhere for now
    const target = $(id);
    if (!target) return;
    if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
    else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });

  /* ---------- subscribe (UI only) ---------- */
  const form = $('.subscribe');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#sub-email').value.trim();
      const city = $('#sub-city').value;
      $('.subscribe__note').textContent = /^\S+@\S+\.\S+$/.test(email)
        ? `Almost done. Check your inbox to confirm ${city} alerts.`
        : 'Enter your email address to subscribe.';
    });
  }
})();
