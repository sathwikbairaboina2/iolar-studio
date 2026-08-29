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

window.applyJitter = function (seed) {
  const r = mulberry32(seed);

  document.querySelectorAll('[data-jitter]').forEach((el) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach((n) => {
      const frag = document.createDocumentFragment();
      for (const ch of n.textContent) {
        if (ch === ' ') { frag.append(' '); continue; }
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.display = 'inline-block';
        s.style.transform =
          'rotate(' + ((r() * 2 - 1) * 1.6).toFixed(2) + 'deg) translateY(' + ((r() * 2 - 1) * 0.8).toFixed(2) + 'px)';
        frag.append(s);
      }
      n.replaceWith(frag);
    });
  });

  document.querySelectorAll('[data-rough]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', rect.width + 8);
    svg.setAttribute('height', rect.height + 8);
    svg.style.cssText =
      'position:absolute;left:-4px;top:-4px;z-index:-1;overflow:visible;pointer-events:none';
    const rc = rough.svg(svg, { options: { seed: Math.floor(r() * 1e6) + 1 } });
    svg.appendChild(
      rc.rectangle(2, 2, rect.width + 4, rect.height + 4, {
        stroke: el.dataset.rough || '#333',
        strokeWidth: 2.2,
        roughness: 1.6,
        bowing: 1.2,
        fill: 'none',
      })
    );
    el.style.position = 'relative';
    el.appendChild(svg);
  });

  document.body.dataset.jitterDone = '1';
};
