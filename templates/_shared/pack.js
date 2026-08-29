// Pure block packer: decides span + column for each unit and reports what did not fit.
// Loaded as a classic script in templates and required directly by Node tests.
(function (root) {
  var SQUEEZE_LIMIT = 1.6;

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
    var rowGap = opts.rowGap || 0;

    var queue = units.slice();
    var rows = [];
    var used = 0;

    while (queue.length) {
      var first = queue.shift();
      var firstSpan = spanOf(first);
      var row = { items: [{ unit: first, span: firstSpan, col: 0 }], height: heightOf(first, firstSpan) };

      if (firstSpan === 'half') {
        var col = 1;
        while (col < columns && queue.length) {
          var pickIndex = -1;
          if (spanOf(queue[0]) === 'half') {
            pickIndex = 0;
          } else if (queue.length > 1 && spanOf(queue[1]) === 'half') {
            // Adjacent local swap: the next unit cannot pair, the one after it can.
            pickIndex = 1;
          }
          if (pickIndex === -1) break;
          var picked = queue.splice(pickIndex, 1)[0];
          row.items.push({ unit: picked, span: 'half', col: col });
          row.height = Math.max(row.height, heightOf(picked, 'half'));
          col++;
        }
      }

      var cost = row.height + (rows.length ? rowGap : 0);
      if (used + cost > pageHeight && rows.length) {
        // Row does not fit: this row's units and everything after it spill, in original order.
        var spill = row.items
          .map(function (i) { return i.unit; })
          .concat(queue)
          .sort(function (a, b) { return a.index - b.index; });
        return { rows: rows, spill: spill };
      }
      used += cost;
      rows.push(row);
    }

    return { rows: rows, spill: [] };
  }

  root.packUnits = packUnits;
  if (typeof module !== 'undefined' && module.exports) module.exports = { packUnits: packUnits };
})(typeof window !== 'undefined' ? window : globalThis);
