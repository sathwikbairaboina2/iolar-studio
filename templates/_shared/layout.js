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

    // How many pages this content needs when each page is filled to `frac` of the sheet.
    function pagesFor(frac) {
      var remaining = units.slice();
      var count = 0;
      while (remaining.length && count < 40) {
        var r = window.packUnits(remaining, {
          columns: columns, pageHeight: usable * frac, rowGap: rowGapPx
        });
        var placed = remaining.length - r.spill.length;
        if (placed <= 0) return 99; // a single unit is taller than the budget
        remaining = r.spill;
        count++;
      }
      return count;
    }

    // Balance: greedy packing fills page 1 and starves the last page. Find the smallest
    // page budget that still needs the same number of pages, so every page carries an
    // equal share instead.
    var pageCount = pagesFor(1);
    var frac = 1;
    if (pageCount > 1) {
      var lo = 0.35;
      var hi = 1;
      for (var it = 0; it < 12; it++) {
        var mid = (lo + hi) / 2;
        if (pagesFor(mid) <= pageCount) hi = mid; else lo = mid;
      }
      frac = hi;
    }

    var packed = window.packUnits(units, { columns: columns, pageHeight: usable * frac, rowGap: rowGapPx });

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

    window.LAYOUT = { spillIndexes: spillIndexes, usedPx: Math.round(used), usablePx: Math.round(usable) };
    document.body.dataset.layoutDone = '1';
  };
})();
