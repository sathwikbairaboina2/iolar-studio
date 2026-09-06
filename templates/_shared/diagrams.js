// Browser overlays for diagrams whose lines need measured positions: flowchart edges,
// schema links and ER lines. All run after layout, before jitter.
(function () {
  var NS = 'http://www.w3.org/2000/svg';

  function box(el, root) {
    var r = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height,
      cx: r.left - b.left + r.width / 2, cy: r.top - b.top + r.height / 2 };
  }

  function prepare(chart, svgSel) {
    var svg = chart.querySelector(svgSel);
    if (!svg) return null;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var b = chart.getBoundingClientRect();
    svg.setAttribute('width', b.width);
    svg.setAttribute('height', b.height);
    svg.setAttribute('viewBox', '0 0 ' + b.width + ' ' + b.height);
    var defs = document.createElementNS(NS, 'defs');
    var marker = document.createElementNS(NS, 'marker');
    var id = 'arr-' + Math.random().toString(36).slice(2, 8);
    marker.setAttribute('id', id);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto-start-reverse');
    var head = document.createElementNS(NS, 'path');
    head.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    head.setAttribute('fill', 'var(--ink-black)');
    marker.appendChild(head); defs.appendChild(marker); svg.appendChild(defs);
    return { svg: svg, marker: id };
  }

  function line(ctx, points, opts) {
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', points.map(function (pt, i) { return (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join(' '));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', (opts && opts.stroke) || 'var(--ink-black)');
    p.setAttribute('stroke-width', (opts && opts.width) || '2');
    if (opts && opts.arrow) p.setAttribute('marker-end', 'url(#' + ctx.marker + ')');
    ctx.svg.appendChild(p);
    return p;
  }

  function label(ctx, x, y, text, cls, color) {
    var tx = document.createElementNS(NS, 'text');
    tx.setAttribute('x', x); tx.setAttribute('y', y);
    tx.setAttribute('class', cls || 'fc-label');
    tx.setAttribute('fill', color || 'var(--ink-black)');
    tx.textContent = text;
    ctx.svg.appendChild(tx);
  }

  function labelColor(l) {
    l = (l || '').toLowerCase();
    if (l === 'yes' || l === 'true') return 'var(--ink-green)';
    if (l === 'no' || l === 'false') return 'var(--ink-red)';
    return 'var(--ink-black)';
  }

  // ---------------------------------------------------------------- flowchart ----
  window.drawFlowchartEdges = function (root) {
    (root || document).querySelectorAll('.dg-flowchart').forEach(function (chart) {
      var ctx = prepare(chart, 'svg.fc-edges');
      if (!ctx) return;
      var edges = [];
      try { edges = JSON.parse(chart.getAttribute('data-edges') || '[]'); } catch (e) { edges = []; }
      var nodes = {};
      chart.querySelectorAll('.fc-node').forEach(function (n) { nodes[n.getAttribute('data-id')] = box(n, chart); });

      edges.forEach(function (edge) {
        var a = nodes[edge.from], b = nodes[edge.to];
        if (!a || !b) return;
        var sameRow = Math.abs(a.cy - b.cy) < Math.max(a.h, b.h) / 2;
        var points, lx, ly;
        if (sameRow) {
          // Neighbours in one row: a straight horizontal arrow between facing edges.
          var leftToRight = b.cx > a.cx;
          var x1 = leftToRight ? a.x + a.w : a.x, x2 = leftToRight ? b.x : b.x + b.w;
          points = [[x1, a.cy], [x2, b.cy]];
          // The gap between neighbours is short: the label sits above the whole row, never on a node.
          lx = (x1 + x2) / 2; ly = Math.min(a.y, b.y) - 4;
        } else if (b.cy > a.cy) {
          var y1 = a.y + a.h, y2 = b.y;
          if (Math.abs(a.cx - b.cx) < 4) {
            points = [[a.cx, y1], [b.cx, y2]];
            lx = a.cx + 6; ly = (y1 + y2) / 2;
          } else {
            var ym = (y1 + y2) / 2;
            points = [[a.cx, y1], [a.cx, ym], [b.cx, ym], [b.cx, y2]];
            // Label above the target's own drop, so two branches from one node never share a spot.
            lx = b.cx; ly = y2 - 6;
          }
        } else {
          // Back-edge: leave the bottom of a, run down the left margin, come in at b's side.
          var margin = 6;
          var yd = a.y + a.h + 8;
          points = [[a.cx, a.y + a.h], [a.cx, yd], [margin, yd], [margin, b.cy], [b.x, b.cy]];
          lx = margin + 4; ly = (yd + b.cy) / 2;
        }
        line(ctx, points, { arrow: true });
        if (edge.label) label(ctx, lx, ly, edge.label, 'fc-label', labelColor(edge.label));
      });
    });
  };

  // ------------------------------------------------------------------- schema ----
  window.drawSchemaLinks = function (root) {
    (root || document).querySelectorAll('.dg-schema').forEach(function (chart) {
      var ctx = prepare(chart, 'svg.sc-links');
      if (!ctx) return;
      var links = [];
      try { links = JSON.parse(chart.getAttribute('data-links') || '[]'); } catch (e) { links = []; }
      var tables = {};
      chart.querySelectorAll('.sc-table').forEach(function (n) { tables[n.getAttribute('data-id')] = box(n, chart); });
      links.forEach(function (l) {
        var a = tables[l.from], b = tables[l.to];
        if (!a || !b) return;
        var ltr = b.cx >= a.cx;
        var x1 = ltr ? a.x + a.w : a.x, x2 = ltr ? b.x : b.x + b.w;
        var y1 = a.cy, y2 = b.cy;
        var xm = (x1 + x2) / 2;
        line(ctx, [[x1, y1], [xm, y1], [xm, y2], [x2, y2]], { arrow: !!l.arrow, stroke: 'var(--ink-green)' });
        if (l.fromLabel) label(ctx, x1 + (ltr ? 4 : -14), y1 - 5, l.fromLabel, 'sc-label', 'var(--ink-red)');
        if (l.toLabel) label(ctx, x2 + (ltr ? -14 : 4), y2 - 5, l.toLabel, 'sc-label', 'var(--ink-red)');
      });
    });
  };

  // ----------------------------------------------------------------------- er ----
  window.drawErLines = function (root) {
    (root || document).querySelectorAll('.dg-er').forEach(function (chart) {
      var ctx = prepare(chart, 'svg.er-lines');
      if (!ctx) return;
      var ents = {};
      chart.querySelectorAll('.er-col').forEach(function (col) {
        var ent = col.querySelector('.er-ent');
        var eb = box(ent, chart);
        ents[col.getAttribute('data-id')] = eb;
        col.querySelectorAll('.er-attr').forEach(function (attr) {
          var ab = box(attr, chart);
          line(ctx, [[ab.cx, ab.cy], [eb.cx, eb.cy]], { width: '1.6' });
        });
      });
      chart.querySelectorAll('.er-rel').forEach(function (rel) {
        var rb = box(rel, chart);
        var a = ents[rel.getAttribute('data-from')], b = ents[rel.getAttribute('data-to')];
        var rels = [];
        try { rels = JSON.parse(chart.getAttribute('data-relations') || '[]'); } catch (e) { rels = []; }
        var spec = rels.find(function (r) { return r.from === rel.getAttribute('data-from') && r.to === rel.getAttribute('data-to'); });
        if (a) {
          line(ctx, [[a.cx, a.cy], [rb.cx, rb.cy]], { width: '1.6' });
          if (spec && spec.labels) label(ctx, (a.cx + rb.cx) / 2 - 6, a.cy - 6, spec.labels[0], 'fc-label', 'var(--ink-red)');
        }
        if (b) {
          line(ctx, [[rb.cx, rb.cy], [b.cx, b.cy]], { width: '1.6' });
          if (spec && spec.labels) label(ctx, (b.cx + rb.cx) / 2 - 6, b.cy - 6, spec.labels[1], 'fc-label', 'var(--ink-red)');
        }
      });
    });
  };

  window.drawDiagramOverlays = function (root) {
    window.drawFlowchartEdges(root);
    window.drawSchemaLinks(root);
    window.drawErLines(root);
  };
})();
