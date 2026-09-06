// DOM side of the grid engine: measure every unit at both widths, pack, place, publish spill.
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
      clone.style.display = 'block';
      probe.appendChild(clone);

      probe.style.width = width + 'px';
      u.fullH = clone.getBoundingClientRect().height;
      probe.style.width = halfWidth + 'px';
      u.halfH = clone.getBoundingClientRect().height;
    }

    probe.parentNode.removeChild(probe);
  }

  window.applyLayout = function (opts) {
    opts = opts || {};
    var columns = opts.columns || 2;
    var rowGapPx = opts.rowGapPx || 0;
    var container = document.getElementById('content');
    var pageEl = document.getElementById('page');
    if (!container || !pageEl) return;

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
    var neededPx = 0;
    for (var q = 0; q < unconstrained.rows.length; q++) {
      neededPx += unconstrained.rows[q].height + (q ? rowGapPx : 0);
    }

    // Fill each page to capacity and let the remainder spill forward. Content is never
    // trimmed and never spread thin: a full page beats two half-empty ones.
    var packed = window.packUnits(units, { columns: columns, pageHeight: usable, rowGap: rowGapPx });

    var spillIndexes = [];
    for (var s = 0; s < packed.spill.length; s++) {
      var su = packed.spill[s];
      spillIndexes = spillIndexes.concat(su.boundIndexes);
      su.el.parentNode.removeChild(su.el);
    }
    spillIndexes.sort(function (a, b) { return a - b; });

    var used = 0;
    for (var r = 0; r < packed.rows.length; r++) {
      var row = packed.rows[r];
      for (var c = 0; c < row.items.length; c++) {
        var item = row.items[c];
        item.unit.el.classList.add(item.span === 'full' ? 'span-full' : 'span-half');
        item.unit.el.style.gridColumnStart = String(item.col + 1);
        container.appendChild(item.unit.el); // reorder DOM to packed order
      }
      used += row.height + (r ? rowGapPx : 0);
    }

    if (window.drawFlowchartEdges) window.drawFlowchartEdges(document);

    window.LAYOUT = {
      spillIndexes: spillIndexes,
      usedPx: Math.round(used),
      usablePx: Math.round(usable),
      neededPct: Math.round((neededPx / usable) * 100)
    };
    document.body.dataset.layoutDone = '1';
  };
})();
