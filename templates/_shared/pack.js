// Pure block packer: flows units down one column, then the next, and reports what did not fit.
// Loaded as a classic script in templates and required directly by Node tests.
//
// Rows were the old model: pair two units side by side, give the row the height of the taller
// one, move on. That left a hole under every short unit, and it scattered the reading order
// across columns — page ten of one chapter opened with section 6 beside section 1. Column flow
// keeps the order strictly top-to-bottom then left-to-right, and holes only appear at the
// bottom of the last column.
(function (root) {
  // Half-width wins on area while halfH < 2 x fullH, so the break-even is 2.0.
  // Sit just under it: a unit that more than doubles when squeezed goes full width.
  var SQUEEZE_LIMIT = 1.95;

  function isFull(unit) {
    return !!unit.forceFull || unit.halfH > unit.fullH * SQUEEZE_LIMIT;
  }

  function heightOf(unit) {
    return isFull(unit) ? unit.fullH : unit.halfH;
  }

  /**
   * Sequentially fill `columns` columns, moving to the next column when the current one
   * would pass `limit`. Returns null when the units do not fit in that many columns.
   */
  function fillAt(units, columns, limit) {
    var cols = [];
    for (var c = 0; c < columns; c++) cols.push([]);
    var heights = [];
    for (var z = 0; z < columns; z++) heights.push(0);
    var col = 0;

    for (var i = 0; i < units.length; i++) {
      var h = heightOf(units[i]);
      while (col < columns && heights[col] + h > limit) col++;
      if (col >= columns) return null;
      cols[col].push(units[i]);
      heights[col] += h;
    }
    // Trailing empties would place a column div nothing was flowed into.
    while (cols.length > 1 && !cols[cols.length - 1].length) cols.pop();
    return { cols: cols, height: Math.max.apply(null, heights) };
  }

  function heightSum(units) {
    var total = 0;
    for (var i = 0; i < units.length; i++) total += heightOf(units[i]);
    return total;
  }

  /** The longest run of leading units that still fits in `columns` columns of `limit`. */
  function prefixThatFits(units, columns, limit) {
    var lo = 0;
    var hi = units.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (fillAt(units.slice(0, mid), columns, limit)) lo = mid; else hi = mid - 1;
    }
    return units.slice(0, lo);
  }

  /**
   * The shortest the run can be drawn in this many columns. Compacting a run that fits
   * leaves the space it saves to the bands below it, and it is what balances the final
   * page of a part instead of leaving one full column beside one empty one.
   */
  function balanced(units, columns, limit) {
    var total = 0;
    var tallest = 0;
    for (var i = 0; i < units.length; i++) {
      var h = heightOf(units[i]);
      total += h;
      if (h > tallest) tallest = h;
    }
    var lo = Math.max(tallest, Math.ceil(total / columns));
    var hi = Math.min(total, limit);
    if (fillAt(units, columns, hi) === null) return null;

    var best = fillAt(units, columns, hi);
    // Heights are fractional pixels; a pixel of precision is finer than anything visible.
    while (hi - lo > 1) {
      var mid = (lo + hi) / 2;
      var attempt = fillAt(units, columns, mid);
      if (attempt) { best = attempt; hi = mid; } else { lo = mid; }
    }
    return best;
  }

  /**
   * Packs units into bands: a full-width unit is its own band, and each run of half-width
   * units becomes one multi-column band. Whatever passes the page height spills, in the
   * original order, along with everything after it.
   */
  function packUnits(units, opts) {
    var columns = opts.columns || 2;
    var pageHeight = opts.pageHeight;
    var rowGap = opts.rowGap || 0;

    var bands = [];
    var used = 0;
    var i = 0;

    function spillFrom(index) {
      return { bands: widenLonelyBands(bands), spill: units.slice(index) };
    }

    while (i < units.length) {
      var gap = bands.length ? rowGap : 0;

      if (isFull(units[i])) {
        var fullH = units[i].fullH;
        if (used + gap + fullH > pageHeight && bands.length) return spillFrom(i);
        bands.push({ span: 'full', cols: [[units[i]]], height: fullH });
        used += gap + fullH;
        i++;
        continue;
      }

      var run = [];
      var j = i;
      while (j < units.length && !isFull(units[j])) { run.push(units[j]); j++; }

      var available = pageHeight - used - gap;
      var placed = balanced(run, columns, available);

      if (placed) {
        bands.push({ span: 'cols', cols: placed.cols, height: placed.height });
        used += gap + placed.height;
        i = j;
        continue;
      }

      // The run does not fit: fill this page to the bottom and spill the remainder.
      var kept = prefixThatFits(run, columns, available);
      if (!kept.length) {
        // Nothing fits under what is already on the page — unless the page is still empty,
        // in which case one oversized unit goes on it alone rather than looping forever.
        if (bands.length) return spillFrom(i);
        kept = [run[0]];
      }
      var partial = fillAt(kept, columns, available) || fillAt(kept, columns, heightSum(kept));
      bands.push({ span: 'cols', cols: partial.cols, height: partial.height });
      return { bands: widenLonelyBands(bands), spill: units.slice(i + kept.length) };
    }

    return { bands: widenLonelyBands(bands), spill: [] };
  }

  /**
   * A band that flowed into one column leaves the other one empty, which on a short page reads
   * as a layout accident rather than a design. One unit alone in a band takes the full width —
   * it is never taller there, so nothing it sat above can be pushed off the page.
   */
  function widenLonelyBands(bands) {
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      if (b.span !== 'cols' || b.cols.length !== 1 || b.cols[0].length !== 1) continue;
      b.span = 'full';
      b.height = Math.min(b.height, b.cols[0][0].fullH);
    }
    return bands;
  }

  /** Total height of a packed result, gaps included. */
  function packedHeight(bands, rowGap) {
    var total = 0;
    for (var i = 0; i < bands.length; i++) total += bands[i].height + (i ? rowGap : 0);
    return total;
  }

  root.packUnits = packUnits;
  root.packedHeight = packedHeight;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { packUnits: packUnits, packedHeight: packedHeight };
  }
})(typeof window !== 'undefined' ? window : globalThis);
