// Flowchart edges: orthogonal arrows drawn over the placed nodes, after layout, before jitter.
(function () {
  var NS = 'http://www.w3.org/2000/svg';

  function center(rect, box) {
    return { x: rect.left - box.left + rect.width / 2, top: rect.top - box.top, bottom: rect.bottom - box.top };
  }

  function labelColor(label) {
    var l = (label || '').toLowerCase();
    if (l === 'yes' || l === 'true') return 'var(--ink-green)';
    if (l === 'no' || l === 'false') return 'var(--ink-red)';
    return 'var(--ink-black)';
  }

  window.drawFlowchartEdges = function (root) {
    var charts = (root || document).querySelectorAll('.dg-flowchart');
    charts.forEach(function (chart) {
      var svg = chart.querySelector('svg.fc-edges');
      if (!svg) return;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var box = chart.getBoundingClientRect();
      svg.setAttribute('width', box.width);
      svg.setAttribute('height', box.height);
      svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);

      var defs = document.createElementNS(NS, 'defs');
      var marker = document.createElementNS(NS, 'marker');
      marker.setAttribute('id', 'fc-arrow-' + Math.random().toString(36).slice(2, 8));
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7');
      marker.setAttribute('orient', 'auto-start-reverse');
      var head = document.createElementNS(NS, 'path');
      head.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      head.setAttribute('fill', 'var(--ink-black)');
      marker.appendChild(head); defs.appendChild(marker); svg.appendChild(defs);

      var edges = [];
      try { edges = JSON.parse(chart.getAttribute('data-edges') || '[]'); } catch (e) { edges = []; }
      var nodes = {};
      chart.querySelectorAll('.fc-node').forEach(function (n) { nodes[n.getAttribute('data-id')] = center(n.getBoundingClientRect(), box); });

      edges.forEach(function (edge) {
        var a = nodes[edge.from], b = nodes[edge.to];
        if (!a || !b) return;
        var down = b.top >= a.bottom;
        var x1 = a.x, y1 = down ? a.bottom : a.top;
        var x2 = b.x, y2 = down ? b.top : b.bottom;
        var points, lx, ly;
        if (Math.abs(x1 - x2) < 4) {
          points = [[x1, y1], [x2, y2]];
          lx = x1 + 6; ly = (y1 + y2) / 2;
        } else {
          var ym = (y1 + y2) / 2;
          points = [[x1, y1], [x1, ym], [x2, ym], [x2, y2]];
          lx = (x1 + x2) / 2; ly = ym - 4;
        }
        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', points.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--ink-black)');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('marker-end', 'url(#' + marker.getAttribute('id') + ')');
        svg.appendChild(path);
        if (edge.label) {
          var text = document.createElementNS(NS, 'text');
          text.setAttribute('x', lx); text.setAttribute('y', ly);
          text.setAttribute('class', 'fc-label');
          text.setAttribute('fill', labelColor(edge.label));
          text.textContent = edge.label;
          svg.appendChild(text);
        }
      });
    });
  };
})();
