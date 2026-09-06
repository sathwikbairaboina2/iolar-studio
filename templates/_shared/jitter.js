// Deterministic handwriting realism: per-character jitter + rough.js frames.
// Seeded so identical input yields identical pixels.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wraps every character of a [data-jitter] element in its own inline-block span (words stay
// unbreakable). `r` is the seeded RNG for rotation; null wraps without transforms — used by
// the layout measurer so measured heights match the jittered page exactly.
window.wrapForJitter = function (el, r) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('mark.hl') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach((n) => {
      // Atomic inline-blocks break parent text-decoration; copy it onto each span.
      const parent = n.parentElement || el;
      const cs = getComputedStyle(parent);
      const deco = cs.textDecorationLine !== 'none'
        ? cs.textDecorationLine + ' ' + cs.textDecorationStyle + ' ' + cs.textDecorationColor + ' ' + cs.textDecorationThickness
        : '';
      const frag = document.createDocumentFragment();
      for (const part of n.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        // One nowrap span per word so lines break only at spaces.
        const word = document.createElement('span');
        word.style.whiteSpace = 'nowrap';
        for (const ch of part) {
          const s = document.createElement('span');
          s.textContent = ch;
          s.style.display = 'inline-block';
          if (deco) {
            s.style.textDecoration = deco;
            s.style.textUnderlineOffset = cs.textUnderlineOffset;
          }
          if (r) s.style.transform =
            'rotate(' + ((r() * 2 - 1) * 1.6).toFixed(2) + 'deg) translateY(' + ((r() * 2 - 1) * 0.8).toFixed(2) + 'px)';
          word.append(s);
        }
        frag.append(word);
      }
      n.replaceWith(frag);
    });
};

// Generic icons ship as clean vector line art, which reads as clip-art dropped onto a
// handwritten page. Redrawing their geometry with rough.js puts them in the same hand as the
// frames and underlines. Brand marks (ic-brand, ic-aws) are never touched: a wobbly logo
// stops being the logo.
window.sketchIcons = function (r) {
  const NS = 'http://www.w3.org/2000/svg';
  const num = (el, a, d) => {
    const v = parseFloat(el.getAttribute(a));
    return isNaN(v) ? d : v;
  };
  const pts = (el) => (el.getAttribute('points') || '')
    .trim().split(/[\s,]+/).map(Number)
    .reduce((acc, n, i) => (i % 2 ? (acc[acc.length - 1].push(n), acc) : (acc.push([n]), acc)), [])
    .filter((p) => p.length === 2);

  document.querySelectorAll('svg.ic-ui').forEach((svg) => {
    const rc = rough.svg(svg, { options: { seed: Math.floor(r() * 1e6) + 1 } });
    const opts = {
      stroke: 'currentColor',
      strokeWidth: 1.7,
      roughness: 0.9,
      bowing: 1.4,
      fill: 'none',
      // One pass: at icon scale a second sketch stroke turns a 24-unit shape into a smudge.
      disableMultiStroke: true,
    };
    const drawn = [];
    svg.querySelectorAll('path,circle,ellipse,rect,line,polyline,polygon').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      try {
        if (tag === 'path') drawn.push(rc.path(el.getAttribute('d'), opts));
        else if (tag === 'circle') drawn.push(rc.circle(num(el, 'cx', 0), num(el, 'cy', 0), num(el, 'r', 1) * 2, opts));
        else if (tag === 'ellipse') drawn.push(rc.ellipse(num(el, 'cx', 0), num(el, 'cy', 0), num(el, 'rx', 1) * 2, num(el, 'ry', 1) * 2, opts));
        else if (tag === 'rect') drawn.push(rc.rectangle(num(el, 'x', 0), num(el, 'y', 0), num(el, 'width', 1), num(el, 'height', 1), opts));
        else if (tag === 'line') drawn.push(rc.line(num(el, 'x1', 0), num(el, 'y1', 0), num(el, 'x2', 0), num(el, 'y2', 0), opts));
        else if (tag === 'polyline') drawn.push(rc.linearPath(pts(el), opts));
        else if (tag === 'polygon') drawn.push(rc.polygon(pts(el), opts));
      } catch (e) { /* an odd shape keeps its clean original */ }
    });
    if (!drawn.length) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    drawn.forEach((g) => svg.appendChild(g));
    svg.style.overflow = 'visible';
    // Placed by hand, so never quite square to the page.
    svg.style.transform = 'rotate(' + ((r() * 2 - 1) * 2.2).toFixed(2) + 'deg)';
  });
};

window.applyJitter = function (seed) {
  const r = mulberry32(seed);

  document.querySelectorAll('[data-jitter]').forEach((el) => window.wrapForJitter(el, r));

  // Sticky notes lean a little. Drawn from the same stream, after character jitter and before
  // rough frames, so a page without stickies keeps its exact pixels.
  document.querySelectorAll('.co-sticky').forEach((el) => {
    el.style.transform = 'rotate(' + ((r() * 2 - 1) * 2).toFixed(2) + 'deg)';
  });

  window.sketchIcons(r);

  // Text may have grown a line: re-stack the columns before frames are measured.
  if (window.reflowLayout) window.reflowLayout();

  document.querySelectorAll('[data-rough]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', rect.width + 8);
    svg.setAttribute('height', rect.height + 8);
    svg.style.cssText =
      'position:absolute;left:-4px;top:-4px;z-index:-1;overflow:visible;pointer-events:none';
    const rc = rough.svg(svg, { options: { seed: Math.floor(r() * 1e6) + 1 } });
    const opts = {
      stroke: el.dataset.rough || '#333',
      strokeWidth: 2.2,
      roughness: 1.6,
      bowing: 1.2,
      fill: 'none',
    };
    if (el.dataset.roughDash) opts.strokeLineDash = [9, 7];
    const w = rect.width + 4, h = rect.height + 4;
    const shape = el.dataset.roughShape || 'box';
    if (shape !== 'box') {
      // A non-rectangular outline runs inside the element's box, where its background would
      // cover the stroke. Move the paper onto the shape itself and clear the element.
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        opts.fill = bg; opts.fillStyle = 'solid';
        el.style.background = 'transparent';
      }
    }
    if (shape === 'cloud') {
      // Scalloped thought cloud: bumps around the box, drawn as one rough path.
      var pad = 3, bump = Math.max(12, Math.min(20, h / 4));
      var x0 = 2 - pad, y0 = 2 - pad, x1 = 2 + w + pad, y1 = 2 + h + pad;
      var d = 'M ' + x0 + ' ' + (y0 + bump / 2);
      for (var x = x0; x < x1 - bump / 2; x += bump) d += ' A ' + (bump / 2) + ' ' + (bump / 2) + ' 0 0 1 ' + Math.min(x + bump, x1) + ' ' + y0;
      for (var y = y0; y < y1 - bump / 2; y += bump) d += ' A ' + (bump / 2) + ' ' + (bump / 2) + ' 0 0 1 ' + x1 + ' ' + Math.min(y + bump, y1);
      for (var xb = x1; xb > x0 + bump / 2; xb -= bump) d += ' A ' + (bump / 2) + ' ' + (bump / 2) + ' 0 0 1 ' + Math.max(xb - bump, x0) + ' ' + y1;
      for (var yb = y1; yb > y0 + bump / 2; yb -= bump) d += ' A ' + (bump / 2) + ' ' + (bump / 2) + ' 0 0 1 ' + x0 + ' ' + Math.max(yb - bump, y0);
      d += ' Z';
      svg.appendChild(rc.path(d, opts));
    } else if (shape === 'diamond') {
      svg.appendChild(rc.polygon([[2 + w / 2, 2], [2 + w, 2 + h / 2], [2 + w / 2, 2 + h], [2, 2 + h / 2]], opts));
    } else if (shape === 'pill') {
      const rr = h / 2;
      svg.appendChild(rc.path(
        'M ' + (2 + rr) + ' 2 H ' + (2 + w - rr) + ' A ' + rr + ' ' + rr + ' 0 0 1 ' + (2 + w - rr) + ' ' + (2 + h) +
        ' H ' + (2 + rr) + ' A ' + rr + ' ' + rr + ' 0 0 1 ' + (2 + rr) + ' 2 Z', opts));
    } else {
      svg.appendChild(rc.rectangle(2, 2, w, h, opts));
    }
    el.style.position = 'relative';
    el.appendChild(svg);
  });

  document.body.dataset.jitterDone = '1';
};
