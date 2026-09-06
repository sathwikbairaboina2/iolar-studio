// DOM side of the layout engine: measure every unit at both widths, pack into column flow,
// place each unit absolutely from the measured heights, publish spill.
(function () {
  function measure(container, units, columns, colGapPx) {
    var width = container.clientWidth;
    var halfWidth = (width - colGapPx * (columns - 1)) / columns;
    var probe = document.createElement('div');
    probe.className = 'pk-measure';
    container.appendChild(probe);

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      probe.innerHTML = '';
      var clone = u.el.cloneNode(true);
      clone.classList.remove('span-half', 'span-full');
      clone.style.gridColumn = '';
      clone.style.display = 'flow-root'; // same as the placed unit, so child margins count in both
      probe.appendChild(clone);
      // Measure the text the way it will be drawn: jitter wraps characters and text grows a little.
      if (window.wrapForJitter) clone.querySelectorAll('[data-jitter]').forEach(function (j) { window.wrapForJitter(j, null); });

      probe.style.width = width + 'px';
      u.fullH = clone.getBoundingClientRect().height;
      probe.style.width = halfWidth + 'px';
      u.halfH = clone.getBoundingClientRect().height;
    }

    probe.parentNode.removeChild(probe);
  }

  window.reflowLayout = function () {
    var placed = window.__placed, meta = window.__layoutMeta, container = document.getElementById('content');
    if (!placed || !meta || !container) return;
    var colY = [];
    for (var c = 0; c < meta.columns; c++) colY.push(0);
    var used = 0;
    for (var i = 0; i < placed.length; i++) {
      var item = placed[i], el = item.unit.el;
      var h = el.offsetHeight;
      var top = 0;
      if (item.span === 'full') { for (var a = 0; a < meta.columns; a++) if (colY[a] > top) top = colY[a]; }
      else top = colY[item.col];
      var y = top + (top > 0 ? meta.rowGapPx : 0);
      el.style.top = y + 'px';
      if (item.span === 'full') { for (var d = 0; d < meta.columns; d++) colY[d] = y + h; }
      else colY[item.col] = y + h;
      if (y + h > used) used = y + h;
    }
    container.style.height = Math.round(used) + 'px';
    if (window.LAYOUT) window.LAYOUT.usedPx = Math.round(used);
    if (window.drawDiagramOverlays) window.drawDiagramOverlays(document);
  };

  window.applyLayout = function (opts) {
    opts = opts || {};
    var columns = opts.columns || 2;
    var rowGapPx = opts.rowGapPx || 0;
    var container = document.getElementById('content');
    var pageEl = document.getElementById('page');
    if (!container || !pageEl) return;

    // A cover page is one flowing block, not packed units: report it as full and stop.
    if (pageEl.classList.contains('cover-page')) {
      var coverUsable = pageEl.clientHeight - parseFloat(getComputedStyle(pageEl).paddingBottom) - container.offsetTop;
      container.style.height = Math.round(coverUsable) + 'px';
      window.LAYOUT = { spillIndexes: [], usedPx: Math.round(coverUsable), usablePx: Math.round(coverUsable), neededPct: 100 };
      document.body.dataset.layoutDone = '1';
      return;
    }

    var els = [].slice.call(container.querySelectorAll('.pk-unit'));

    // Bind each heading to the block that follows it so the pair never splits.
    var units = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var idx = parseInt(el.getAttribute('data-block-index'), 10);
      var isHeading = el.getAttribute('data-block-type') === 'heading';
      if (isHeading && i + 1 < els.length) {
        var next = els[i + 1];
        var wrap = document.createElement('div');
        wrap.className = 'pk-unit';
        wrap.setAttribute('data-block-index', String(idx));
        if (next.getAttribute('data-force-full')) wrap.setAttribute('data-force-full', '1');
        container.insertBefore(wrap, el);
        wrap.appendChild(el);
        wrap.appendChild(next);
        units.push({
          el: wrap,
          index: idx,
          boundIndexes: [idx, parseInt(next.getAttribute('data-block-index'), 10)],
          forceFull: !!next.getAttribute('data-force-full'),
          fullH: 0,
          halfH: 0
        });
        i++;
        continue;
      }
      units.push({
        el: el,
        index: idx,
        boundIndexes: [idx],
        forceFull: !!el.getAttribute('data-force-full'),
        fullH: 0,
        halfH: 0
      });
    }

    var style = getComputedStyle(pageEl);
    var usable = pageEl.clientHeight - parseFloat(style.paddingBottom) - container.offsetTop;
    var colGapPx = parseFloat(getComputedStyle(container).columnGap) || 0;

    measure(container, units, columns, colGapPx);

    // What fraction of one page ALL of this slide's content needs. >100% means the author
    // wrote more than a page holds; the fit pass uses this to trim by a measured amount.
    var unconstrained = window.packUnits(units, {
      columns: columns, pageHeight: Number.MAX_SAFE_INTEGER, rowGap: rowGapPx
    });
    var neededPx = unconstrained.usedPx;

    // Fill each column to capacity and let the remainder spill forward. Content is never
    // trimmed and never spread thin: a full page beats two half-empty ones.
    // A few pixels of slack: rough frames and sub-pixel rounding after jitter must never spill over.
    var packed = window.packUnits(units, { columns: columns, pageHeight: usable - 8, rowGap: rowGapPx });

    var spillIndexes = [];
    for (var s = 0; s < packed.spill.length; s++) {
      var su = packed.spill[s];
      spillIndexes = spillIndexes.concat(su.boundIndexes);
      su.el.parentNode.removeChild(su.el);
    }
    spillIndexes.sort(function (a, b) { return a - b; });

    // Column flow cannot be expressed as grid rows: position every unit from its measured
    // height. The container becomes a plain relatively-positioned box of the used height.
    var width = container.clientWidth;
    var halfW = (width - colGapPx * (columns - 1)) / columns;
    container.style.display = 'block';
    container.style.position = 'relative';
    for (var r = 0; r < packed.placed.length; r++) {
      var item = packed.placed[r];
      var el = item.unit.el;
      el.classList.add(item.span === 'full' ? 'span-full' : 'span-half');
      el.style.position = 'absolute';
      el.style.top = item.y + 'px';
      el.style.left = (item.span === 'full' ? 0 : item.col * (halfW + colGapPx)) + 'px';
      el.style.width = (item.span === 'full' ? width : halfW) + 'px';
      container.appendChild(el); // DOM order = placement order (left column first)
    }
    container.style.height = Math.round(packed.usedPx) + 'px';
    var used = packed.usedPx;

    // Jitter wraps characters in spans and text can reflow a line taller than measured.
    // reflowLayout re-stacks every column from the real heights, same order, same columns.
    window.__placed = packed.placed;
    window.__layoutMeta = { columns: columns, rowGapPx: rowGapPx };

    if (window.drawDiagramOverlays) window.drawDiagramOverlays(document);
    else if (window.drawFlowchartEdges) window.drawFlowchartEdges(document);

    window.LAYOUT = {
      spillIndexes: spillIndexes,
      usedPx: Math.round(used),
      usablePx: Math.round(usable),
      neededPct: Math.round((neededPx / usable) * 100)
    };
    document.body.dataset.layoutDone = '1';
  };
})();
