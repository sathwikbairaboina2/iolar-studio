// Pure block packer: column flow. Each half-width unit drops into the shorter column, a
// full-width unit closes both. Reports what did not fit. Loaded as a classic script in
// templates and required directly by Node tests.
(function (root) {
  // Half-width wins on area while halfH < 2 x fullH, so the break-even is 2.0.
  // Sit just under it: a unit that more than doubles when squeezed goes full width.
  var SQUEEZE_LIMIT = 1.95;

  function spanOf(unit) {
    if (unit.forceFull) return 'full';
    if (unit.halfH > unit.fullH * SQUEEZE_LIMIT) return 'full';
    return 'half';
  }

  function heightOf(unit, span) {
    return span === 'full' ? unit.fullH : unit.halfH;
  }

  function packUnits(units, opts) {
    var columns = opts.columns || 2;
    var pageHeight = opts.pageHeight;
    var gap = opts.rowGap || 0;

    var colY = [];
    for (var c = 0; c < columns; c++) colY.push(0);
    var placed = [];

    // Once a unit fails to fit, later units may still fill the gap left under the shorter
    // column. Look a few units ahead for one that fits; whatever is never placed spills in
    // its original order, so the next page starts with the first thing that did not fit.
    var LOOKAHEAD = 6;
    var spill = [];
    var blocked = false;
    var skipped = 0;

    for (var i = 0; i < units.length; i++) {
      var unit = units[i];
      if (unit.__placed) { delete unit.__placed; continue; }
      if (blocked && skipped >= LOOKAHEAD) { spill.push(unit); continue; }
      var span = spanOf(unit);
      var h = heightOf(unit, span);
      var col = 0;
      var top;

      if (span === 'full') {
        // Before closing both columns, fill the shorter one with upcoming half-width units
        // that fit the difference, so a full-width block never strands empty space above it.
        if (!blocked) {
          var tallest = 0, shortestCol = 0;
          for (var t = 0; t < columns; t++) { if (colY[t] > tallest) tallest = colY[t]; if (colY[t] < colY[shortestCol]) shortestCol = t; }
          var room = tallest - colY[shortestCol];
          for (var k = i + 1; k < units.length && k <= i + LOOKAHEAD && room > gap; k++) {
            var cand = units[k];
            if (cand.__placed) continue;
            // A heading-bound unit starts a section: it stays in reading order. Loose blocks may move up.
            if (cand.boundIndexes && cand.boundIndexes.length > 1) continue;
            if (spanOf(cand) !== 'full' && cand.halfH + gap <= room) {
              var cy = colY[shortestCol] + (colY[shortestCol] > 0 ? gap : 0);
              if (cy + cand.halfH > pageHeight) break;
              placed.push({ unit: cand, span: 'half', col: shortestCol, y: cy, height: cand.halfH });
              cand.__placed = true;
              colY[shortestCol] = cy + cand.halfH;
              room = tallest - colY[shortestCol];
            }
          }
        }
        top = 0;
        for (var a = 0; a < columns; a++) if (colY[a] > top) top = colY[a];
      } else {
        for (var b = 1; b < columns; b++) if (colY[b] < colY[col]) col = b;
        top = colY[col];
      }
      var y = top + (top > 0 ? gap : 0);

      if (y + h > pageHeight && placed.length) {
        spill.push(unit);
        blocked = true;
        skipped++;
        continue;
      }

      placed.push({ unit: unit, span: span, col: col, y: y, height: h });
      if (span === 'full') {
        for (var d = 0; d < columns; d++) colY[d] = y + h;
      } else {
        colY[col] = y + h;
      }
    }
    return finish(placed, spill, colY);
  }

  function finish(placed, spill, colY) {
    var used = 0, min = Infinity;
    for (var i = 0; i < colY.length; i++) { if (colY[i] > used) used = colY[i]; if (colY[i] < min) min = colY[i]; }
    return { placed: placed, spill: spill, usedPx: used, shortestPx: min === Infinity ? 0 : min };
  }

  root.packUnits = packUnits;
  if (typeof module !== 'undefined' && module.exports) module.exports = { packUnits: packUnits };
})(typeof window !== 'undefined' ? window : globalThis);
