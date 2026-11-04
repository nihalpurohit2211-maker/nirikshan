/* map.js — the signature screen: the SVG network map (docs/FRONTEND_SPEC.md §6).
 *
 * One bulk call (/api/network) draws everything: 98 nodes and 78 pipes. Node colour is the
 * WQI band the server computed, never a threshold re-derived here. Flow animates along
 * from_node → to_node, layers toggle, and Trace Upstream overlays a case's own path with a
 * red pulse running from the buildings back to the source.
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var s = NIRI.s, el = NIRI.el;
  var WATER = { source: 1, treatment_plant: 1, reservoir: 1, pump: 1, junction: 1, zone: 1, building: 1 };
  var SIZE = { source: 8.5, treatment_plant: 8.5, reservoir: 8, pump: 6.5, junction: 5.5,
               zone: 7, building: 3.4 };
  var NO_WQI = '#9FB3A8';
  /* /api/network carries no NAQI or land subtype, so these two shapes are fixed marks
     that match the legend exactly. */
  var AIR_FILL = '#7E9AA8';
  var LAND_FILL = '#C08A2E';
  /* Node fills read n.wqi.colour — every served WQI carries one. This table exists for the
     legend, which has no endpoint behind it, and as a fallback if a row ever arrives without a
     colour; it was checked against the live payload and matches it hex for hex
     (Good #34A853, Acceptable #A8D08D, Poor #F4B400, Unsafe #EA4335), so the legend cannot
     drift from the map. */
  var BAND_FILL = { Good: '#34A853', Acceptable: '#A8D08D', Poor: '#F4B400', Unsafe: '#EA4335' };

  function create(cfg) {
    var W = 1000, H = Math.round(W * (cfg.aspect || 0.72));
    var nodes = cfg.nodes, pipes = cfg.pipes;

    /* Projection: the shared schematic base map's study-area bounds, fitted to the
       SVG. Padding matches basemap.js exactly; the base layer is squeezed by the
       same H/720 factor so its roads and the pipes cannot drift apart. */
    var bounds = NIRI.basemap.BOUNDS.local;
    var pad = 0.065;
    var sx = (W * (1 - 2 * pad)) / (bounds.maxLon - bounds.minLon);
    var sy = (H * (1 - 2 * pad)) / (bounds.maxLat - bounds.minLat);

    function pos(node) {
      return [W * pad + (node.lon - bounds.minLon) * sx,
              H * pad + (bounds.maxLat - node.lat) * sy];
    }
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    var view = { scale: 1, x: 0, y: 0 };
    var layers = { pipes: true, air: true, land: true, labels: !cfg.preview };
    var selected = null;
    var traceIds = null;

    var surface = s('svg', { class: 'map-svg' + (cfg.preview ? ' preview' : ' network-svg'),
                             viewBox: '0 0 ' + W + ' ' + H,
                             role: 'img',
                             'aria-label': 'schematic Mumbai base map with the water network: '
                                           + nodes.length + ' nodes, ' + pipes.length + ' pipes' });
    var pan = s('g', {});
    surface.appendChild(pan);

    /* 0. the shared Mumbai base map, under every pipe and node */
    var base = NIRI.basemap.layer('local');
    base.setAttribute('transform', 'scale(1 ' + (H / 720).toFixed(5) + ')');
    pan.appendChild(base);

    /* 2. pipes — stroke width ∝ log(diameter) */
    var pipeLayer = s('g', {});
    var pipeNodes = {};
    pipes.forEach(function (p) {
      var a = byId[p.from_node], b = byId[p.to_node];
      if (!a || !b) return;
      var pa = pos(a), pb = pos(b);
      var width = 1.1 + (Math.log(Math.max(10, p.diameter_mm)) / Math.log(1000)) * 6.5;
      var line = s('line', { class: 'pipe flow', x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1],
                             'stroke-width': width.toFixed(2) });
      line.dataset.pipe = p.id;
      pipeNodes[p.id] = line;
      var title = s('title', { text: p.id + ' · ' + p.material + ' ' + p.diameter_mm + ' mm · '
                                     + p.length_m + ' m · laid ' + p.install_year });
      line.appendChild(title);
      pipeLayer.appendChild(line);
    });
    pan.appendChild(pipeLayer);

    /* 3. nodes */
    var nodeLayer = s('g', {});
    var traceLayer = s('g', {});
    var labelLayer = s('g', {});
    nodes.forEach(function (n) {
      var xy = pos(n);
      var shape;
      if (n.type === 'air_station') {
        shape = s('rect', { class: 'node-shape', x: -5, y: -5, width: 10, height: 10,
                            transform: 'translate(' + xy[0] + ' ' + xy[1] + ') rotate(45)',
                            fill: AIR_FILL });
      } else if (n.type === 'land_site') {
        shape = s('path', { class: 'node-shape',
                            d: 'M-4 6 L-4 -7 L6 -4 L-4 -1 Z',
                            transform: 'translate(' + xy[0] + ' ' + xy[1] + ')',
                            fill: LAND_FILL });
      } else {
        shape = s('circle', { class: 'node-shape', cx: xy[0], cy: xy[1],
                              r: (SIZE[n.type] || 4) * (cfg.preview ? 0.8 : 1),
                              fill: n.wqi ? (n.wqi.colour || BAND_FILL[n.wqi.band]) : NO_WQI });
      }
      shape.dataset.node = n.id;
      var bits = [n.id, n.name, n.type];
      if (n.wqi) bits.push('WQI ' + n.wqi.score + ' ' + n.wqi.band);
      if (n.latest && n.latest.turbidity_ntu !== undefined) {
        bits.push('turbidity ' + n.latest.turbidity_ntu + ' NTU');
        bits.push('chlorine ' + n.latest.residual_chlorine_mgl + ' mg/L');
      }
      shape.appendChild(s('title', { text: bits.join(' · ') }));
      if (!cfg.preview) {
        shape.addEventListener('click', function (ev) {
          ev.stopPropagation();
          select(n.id);
          if (cfg.onSelect) cfg.onSelect(n);
        });
      }
      nodeLayer.appendChild(shape);

      if (layers.labels && (n.type === 'zone' || n.type === 'source' || n.type === 'treatment_plant'
                            || n.type === 'reservoir' || n.type === 'pump')) {
        /* the short ward label keeps the map legible; the full name is in the title */
        var labelText = n.type === 'zone' ? n.name.split(' - ')[0]
                      : n.name.replace(/ (Booster|Reservoir|Plant|Intake|Cluster).*/, '');
        /* the five ward nodes sit close together, so their labels are pushed out in
           five different directions instead of stacking at the same +9/+3 offset */
        var ZONE_LABEL = { zone_1: [-42, 19], zone_2: [12, 19], zone_3: [-40, -11],
                           zone_4: [12, -11], zone_5: [-60, -14] };
        var off = (n.type === 'zone' && ZONE_LABEL[n.id]) || [9, 3];
        var label = s('text', { class: 'node-label' + (n.type === 'zone' ? ' key' : ''),
                                x: xy[0] + off[0], y: xy[1] + off[1], text: labelText });
        label.dataset.node = n.id;
        labelLayer.appendChild(label);
      }
    });
    pan.appendChild(nodeLayer);
    pan.appendChild(traceLayer);
    pan.appendChild(labelLayer);

    function select(id) {
      if (selected) {
        var previous = nodeLayer.querySelector('[data-node="' + CSS.escape(selected) + '"]');
        if (previous) previous.classList.remove('sel');
      }
      selected = id;
      var shape = nodeLayer.querySelector('[data-node="' + CSS.escape(id) + '"]');
      if (shape) shape.classList.add('sel');
    }

    function applyLayers() {
      pipeLayer.style.display = layers.pipes ? '' : 'none';
      labelLayer.style.display = layers.labels ? '' : 'none';
      nodeLayer.querySelectorAll('[data-node]').forEach(function (shape) {
        var node = byId[shape.dataset.node];
        var hide = (node.type === 'air_station' && !layers.air)
                || (node.type === 'land_site' && !layers.land);
        shape.style.display = hide ? 'none' : '';
      });
    }

    /* Trace Upstream: dim everything else, mark the case's own pipes, run a red pulse from
       the affected buildings/zone back to the source. */
    function showTrace(trace) {
      traceLayer.innerHTML = '';
      traceIds = {};
      (trace.path || []).forEach(function (id) { traceIds[id] = true; });
      var tracePipes = {};
      (trace.steps || []).forEach(function (step) {
        if (step.pipe && step.pipe.id) tracePipes[step.pipe.id] = true;
      });
      Object.keys(pipeNodes).forEach(function (pipeId) {
        pipeNodes[pipeId].classList.remove('trace');
        pipeNodes[pipeId].classList.toggle('trace-dim', !tracePipes[pipeId]);
      });
      nodeLayer.querySelectorAll('[data-node]').forEach(function (shape) {
        shape.style.opacity = traceIds[shape.dataset.node] ? '' : '.22';
      });
      labelLayer.querySelectorAll('[data-node]').forEach(function (text) {
        text.style.opacity = traceIds[text.dataset.node] ? '' : '.18';
      });

      var pts = [];
      (trace.steps || []).forEach(function (step, i) {
        var node = byId[step.node_id];
        if (!node) return;
        pts.push(pos(node));
        if (step.pipe && pipeNodes[step.pipe.id]) {
          pipeNodes[step.pipe.id].classList.add('trace');
        }
        var mark = s('g', { class: 'trace-hit',
                            transform: 'translate(' + pts[i][0] + ' ' + pts[i][1] + ')' });
        mark.appendChild(s('circle', { r: 9, fill: 'rgba(234,67,53,.12)', stroke: '#EA4335',
                                      'stroke-width': 1.4 }));
        mark.appendChild(s('title', {
          text: step.node_name + (step.pipe ? '  ← pipe ' + step.pipe.id + ' (' + step.pipe.material
                 + ' ' + step.pipe.install_year + ', ' + step.pipe.age_years + ' years old)' : '')
        }));
        if (!cfg.preview && cfg.onTraceStep) {
          mark.addEventListener('click', function () { cfg.onTraceStep(step); });
        }
        traceLayer.appendChild(mark);
      });

      if (traceIds.worst && byId[trace.worst_pipe.to_node]) {
        /* nothing extra: worst pipe is already on the path */
      }

      if (pts.length > 1) {
        var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' ');
        var pulse = s('g', {});
        var dot = s('circle', { class: 'pulse', r: 5.5, opacity: 0.95 },
                    s('animate', { attributeName: 'r', values: '4;7;4', dur: '1.6s',
                                   repeatCount: 'indefinite' }));
        dot.appendChild(s('animateMotion', { path: d, dur: '3.2s', repeatCount: 'indefinite' }));
        pulse.appendChild(dot);
        traceLayer.appendChild(pulse);
      }
      applyLayers();
    }

    function clearTrace() {
      traceIds = null;
      traceLayer.innerHTML = '';
      Object.keys(pipeNodes).forEach(function (id) {
        pipeNodes[id].classList.remove('trace');
        pipeNodes[id].classList.remove('trace-dim');
      });
      nodeLayer.querySelectorAll('[data-node]').forEach(function (shape) { shape.style.opacity = ''; });
      labelLayer.querySelectorAll('[data-node]').forEach(function (text) { text.style.opacity = ''; });
      applyLayers();
    }

    function zoom(factor) {
      view.scale = Math.max(1, Math.min(6, view.scale * factor));
      if (view.scale === 1) view.x = 0, view.y = 0;
      pan.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.scale + ')');
    }

    /* Drag to pan, wheel to zoom — plain handlers, no library. */
    if (!cfg.preview) {
      var drag = null;
      surface.addEventListener('pointerdown', function (ev) {
        drag = { x: ev.clientX, y: ev.clientY };
        surface.setPointerCapture(ev.pointerId);
      });
      surface.addEventListener('pointermove', function (ev) {
        if (!drag) return;
        var box = surface.getBoundingClientRect();
        var k = W / box.width;
        view.x += (ev.clientX - drag.x) * k;
        view.y += (ev.clientY - drag.y) * k;
        drag = { x: ev.clientX, y: ev.clientY };
        pan.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.scale + ')');
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        surface.addEventListener(ev, function () { drag = null; });
      });
      surface.addEventListener('wheel', function (ev) {
        ev.preventDefault();
        zoom(ev.deltaY < 0 ? 1.18 : 1 / 1.18);
      }, { passive: false });
    }

    var host = el('div', { class: 'map-wrap' }, [surface]);

    if (!cfg.preview) {
      var controls = el('div', { class: 'map-controls' }, [
        el('div', { class: 'row' }, [
          el('button', { class: 'chip', text: '+', title: 'Zoom in', on: { click: function () { zoom(1.3); } } }),
          el('button', { class: 'chip', text: '−', title: 'Zoom out', on: { click: function () { zoom(1 / 1.3); } } }),
          el('button', { class: 'chip ghost', text: 'reset', on: { click: function () {
            view.scale = 1; view.x = 0; view.y = 0;
            pan.removeAttribute('transform');
          } } })
        ]),
        el('label', { class: 'row', style: 'font-weight:500' }, [
          el('input', { type: 'checkbox', checked: true, style: 'width:auto',
                        on: { change: function (ev) { layers.pipes = ev.target.checked; applyLayers(); } } }),
          'pipes'
        ]),
        el('label', { class: 'row', style: 'font-weight:500' }, [
          el('input', { type: 'checkbox', checked: true, style: 'width:auto',
                        on: { change: function (ev) { layers.air = ev.target.checked; applyLayers(); } } }),
          'air stations'
        ]),
        el('label', { class: 'row', style: 'font-weight:500' }, [
          el('input', { type: 'checkbox', checked: true, style: 'width:auto',
                        on: { change: function (ev) { layers.land = ev.target.checked; applyLayers(); } } }),
          'land sites'
        ]),
        el('label', { class: 'row', style: 'font-weight:500' }, [
          el('input', { type: 'checkbox', checked: true, style: 'width:auto',
                        on: { change: function (ev) { layers.labels = ev.target.checked; applyLayers(); } } }),
          'labels'
        ])
      ]);
      /* Collapsed by default: an open two-hundred-pixel legend sat on top of Ward 5.
         The summary pill is one click away and the map stays readable. */
      var legend = el('details', { class: 'map-legend' }, [
        el('summary', { text: 'Legend' }),
        el('div', { class: 'map-legend-body' }, [
          el('strong', { text: 'Water quality band' }),
          el('div', { style: 'margin:6px 0' }, ['Good', 'Acceptable', 'Poor', 'Unsafe'].map(function (band) {
            return el('div', { class: 'k' }, [
              el('span', { class: 'sw', style: 'background:' + BAND_FILL[band] }), band,
              el('span', { class: 'muted', text: ' ' + NIRI.BANDS[band] })
            ]);
          })),
          el('div', { class: 'k' }, [el('span', { class: 'sw', style: 'background:' + NO_WQI }),
                                     'node, no sensor']),
          el('div', { class: 'k' }, [el('span', { class: 'sw',
              style: 'background:' + AIR_FILL + ';transform:rotate(45deg);border-radius:2px' }), 'air station']),
          el('div', { class: 'k' }, [el('span', { class: 'sw',
              style: 'background:' + LAND_FILL + ';border-radius:2px' }), 'land site']),
          el('p', { class: 'muted', style: 'margin:8px 0 0;font-size:11.5px' },
            'Pipe thickness ∝ log(diameter). On a trace, a higher decay k means a worse section.')
        ])
      ]);
      host.appendChild(controls);
      host.appendChild(legend);
    }

    applyLayers();

    return {
      element: host,
      showTrace: showTrace,
      clearTrace: clearTrace,
      select: select,
      focusNode: function (id) {
        var node = byId[id];
        if (!node) return;
        var xy = pos(node);
        view.scale = 2.4;
        view.x = W / 2 - xy[0] * view.scale;
        view.y = H / 2 - xy[1] * view.scale;
        pan.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.scale + ')');
        select(id);
      }
    };
  }

  NIRI.map = { create: create };
}(window.NIRI));
