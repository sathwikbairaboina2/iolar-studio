// Pure block packer: column flow. Each half-width unit drops into the shorter column, a
// full-width unit closes both. Reports what did not fit. Loaded as a classic script in
// templates and required directly by Node tests.
//
// Order is never traded for fill: a unit is placed only after every unit before it, and the
// first one that does not fit spills along with everything after it. Looking ahead for a small
// unit that still fits, or filling the shorter column from behind a full-width unit, looked like
// free space and printed Q34 before Q33 on real pages.
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

    var spill = [];
    var blocked = false;

    for (var i = 0; i < units.length; i++) {
      var unit = units[i];
      if (blocked) { spill.push(unit); continue; }
      var span = spanOf(unit);
      var h = heightOf(unit, span);
      var col = 0;
      var top;

      if (span === 'full') {
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
