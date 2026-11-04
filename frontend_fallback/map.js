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

    /* shared markers/filters: downstream flow arrow and a soft glow for flow */
    var defs = s('defs', {}, [
      s('marker', { id: 'flow-arrow', markerWidth: 9, markerHeight: 9,
                    refX: 7, refY: 4.5, orient: 'auto', markerUnits: 'strokeWidth' },
          s('polygon', { points: '0,0 9,4.5 0,9', fill: '#5c5347' })),
      s('filter', { id: 'pipe-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
          s('feGaussianBlur', { stdDeviation: 1.2, result: 'blur' }),
          s('feComposite', { in: 'SourceGraphic', in2: 'blur', operator: 'over' })),
    ]);
    surface.appendChild(defs);

    /* 0. the shared Mumbai base map, under every pipe and node */
    var base = NIRI.basemap.layer('local');
    base.setAttribute('transform', 'scale(1 ' + (H / 720).toFixed(5) + ')');
    pan.appendChild(base);

    /* 1. quality field. Inverse-distance interpolation of the SERVED score, and
       of the SERVED colour: each cell is the weighted blend of the colours the
       server attached to its samples. No band is re-derived here — the field
       only smooths numbers that already exist, and the legend says so. */
    var heatLayer = s('g', { class: 'heat-layer' });
    (function buildHeat() {
      var samples = nodes.filter(function (n) { return n.wqi && n.wqi.colour && n.lon; });
      if (samples.length < 3) return;
      var COLS = 34, ROWS = Math.max(12, Math.round(COLS * (H / W) * 1.25));
      var cw = W / COLS, ch = H / ROWS;
      function rgb(hex) {
        var h = String(hex || '').replace('#', '');
        if (h.length !== 6) return null;
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
                parseInt(h.slice(4, 6), 16)];
      }
      var parsed = samples.map(function (n) {
        return { lon: n.lon, lat: n.lat, rgb: rgb(n.wqi.colour) };
      }).filter(function (x) { return x.rgb; });
      if (parsed.length < 3) return;
      for (var gy = 0; gy < ROWS; gy++) {
        for (var gx = 0; gx < COLS; gx++) {
          var px = (gx + 0.5) * cw, py = (gy + 0.5) * ch;
          var lon = bounds.minLon + (px - W * pad) / sx;
          var lat = bounds.maxLat - (py - H * pad) / sy;
          var wsum = 0, r = 0, g = 0, b = 0;
          for (var i = 0; i < parsed.length; i++) {
            var dx = (parsed[i].lon - lon) * 1000;
            var dy = (parsed[i].lat - lat) * 1000;
            var w = 1 / Math.pow(dx * dx + dy * dy + 4, 1.18);
            wsum += w;
            r += w * parsed[i].rgb[0];
            g += w * parsed[i].rgb[1];
            b += w * parsed[i].rgb[2];
          }
          if (!wsum) continue;
          var cell = s('rect', { class: 'heat-cell', x: (gx * cw).toFixed(1),
                                 y: (gy * ch).toFixed(1),
                                 width: (cw + 0.8).toFixed(1), height: (ch + 0.8).toFixed(1),
                                 fill: 'rgb(' + Math.round(r / wsum) + ','
                                       + Math.round(g / wsum) + ','
                                       + Math.round(b / wsum) + ')' });
          heatLayer.appendChild(cell);
        }
      }
    }());
    pan.appendChild(heatLayer);

    /* 2. pipes — stroke width ∝ log(diameter) */
    var pipeLayer = s('g', {});
    var pipeNodes = {};
    pipes.forEach(function (p) {
      var a = byId[p.from_node], b = byId[p.to_node];
      if (!a || !b) return;
      var pa = pos(a), pb = pos(b);
      var width = 1.1 + (Math.log(Math.max(10, p.diameter_mm)) / Math.log(1000)) * 6.5;
      var mat = (p.material || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      var line = s('line', { class: 'pipe flow material-' + mat, x1: pa[0], y1: pa[1],
                             x2: pb[0], y2: pb[1], 'stroke-width': width.toFixed(2),
                             'marker-end': 'url(#flow-arrow)' });
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
      if (n.wqi && n.wqi.band === 'Unsafe' && !cfg.preview) {
        var ring = s('circle', { class: 'breach-ring', cx: xy[0], cy: xy[1], r: 6,
                                 fill: 'none', stroke: n.wqi.colour || '#EA4335',
                                 'stroke-width': 1.2 },
                     s('animate', { attributeName: 'r', values: '6;16;6', dur: '3s',
                                    repeatCount: 'indefinite' }),
                     s('animate', { attributeName: 'opacity', values: '.55;0;.55',
                                    dur: '3s', repeatCount: 'indefinite' }));
        nodeLayer.appendChild(ring);
      }
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
        /* Prefer the human-readable served name and keep labels short enough to scan. */
        labelText = String(labelText || n.id).replace(/\s+/g, ' ').trim();
        if (labelText.length > 24) labelText = labelText.slice(0, 23) + '…';
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

    /* hover card: the same served fields the node page shows, without leaving the map */
    var tip = el('div', { class: 'map-tip', hidden: true });
    function tipFor(n) {
      NIRI.clear(tip);
      tip.appendChild(el('div', { class: 'map-tip-head' }, [
        el('strong', { text: n.name }),
        el('span', { class: 'map-tip-type', text: n.type.replace('_', ' ') })
      ]));
      if (n.wqi) {
        tip.appendChild(el('div', { class: 'map-tip-row' }, [
          el('span', { class: 'sw', style: 'background:' + (n.wqi.colour || '#9FB3A8') }),
          el('b', { text: 'WQI ' + n.wqi.score }),
          el('span', { class: 'muted', text: n.wqi.band + (n.wqi.override ? ' · ' + n.wqi.override : '') })
        ]));
      } else if (n.latest) {
        tip.appendChild(el('div', { class: 'map-tip-row muted', text: 'Air station' }));
      } else {
        tip.appendChild(el('div', { class: 'map-tip-row muted', text: 'no sensor at this node' }));
      }
      if (n.latest && n.latest.turbidity_ntu !== undefined) {
        tip.appendChild(el('div', { class: 'map-tip-row mono' ,
          text: 'turbidity ' + n.latest.turbidity_ntu + ' NTU' }));
        tip.appendChild(el('div', { class: 'map-tip-row mono',
          text: 'chlorine ' + n.latest.residual_chlorine_mgl + ' mg/L' }));
      }
      tip.appendChild(el('div', { class: 'map-tip-foot', text: 'click for the full node page' }));
    }
    function placeTip(ev) {
      var box = host.getBoundingClientRect();
      var x = ev.clientX - box.left + 14, y = ev.clientY - box.top + 14;
      if (x + 210 > box.width) x = ev.clientX - box.left - 206;
      tip.style.left = Math.max(6, x) + 'px';
      tip.style.top = Math.max(6, y) + 'px';
    }
    if (!cfg.preview) {
      nodeLayer.addEventListener('pointerover', function (ev) {
        var id = ev.target && ev.target.dataset && ev.target.dataset.node;
        if (!id || !byId[id]) return;
        tipFor(byId[id]);
        tip.hidden = false;
      });
      nodeLayer.addEventListener('pointermove', function (ev) {
        if (!tip.hidden) placeTip(ev);
      });
      nodeLayer.addEventListener('pointerout', function (ev) {
        var to = ev.relatedTarget;
        if (!to || !to.dataset || !to.dataset.node) tip.hidden = true;
      });
    }
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

    /* Anything that shows the zoom level subscribes here, so the panel readout and
       the canvas can never disagree. */
    var viewListeners = [];
    function notifyView() {
      viewListeners.forEach(function (fn) { fn(view.scale); });
    }

    function zoom(factor) {
      view.scale = Math.max(1, Math.min(6, view.scale * factor));
      if (view.scale === 1) view.x = 0, view.y = 0;
      pan.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.scale + ')');
      notifyView();
    }

    function resetView() {
      view.scale = 1; view.x = 0; view.y = 0;
      pan.removeAttribute('transform');
      notifyView();
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
    if (!cfg.preview) host.appendChild(tip);

    if (!cfg.preview) {
      var airCount = nodes.filter(function (n) { return n.type === 'air_station'; }).length;
      var landCount = nodes.filter(function (n) { return n.type === 'land_site'; }).length;
      var bandCounts = {};
      nodes.forEach(function (n) { if (n.wqi) bandCounts[n.wqi.band] = (bandCounts[n.wqi.band] || 0) + 1; });

      /* One switch row serves the panel and the floating toolbar, so a layer can only
         ever be wired in one place. */
      function switchRow(label, count, checked, onChange) {
        var input = el('input', { type: 'checkbox', checked: checked ? true : null });
        var row = el('label', { class: 'map-switch' + (checked ? ' is-on' : '') }, [
          input,
          el('span', { class: 'map-switch-track', 'aria-hidden': 'true' }, el('i')),
          el('span', { class: 'map-switch-label', text: label }),
          el('span', { class: 'map-switch-count',
                       text: count === null || count === undefined ? '' : String(count) })
        ]);
        input.addEventListener('change', function () {
          row.classList.toggle('is-on', input.checked);
          onChange(input.checked);
        });
        return row;
      }

      function layerSwitch(key, label, count) {
        return switchRow(label, count, !!layers[key], function (on) {
          layers[key] = on;
          applyLayers();
        });
      }

      function bandRow(band) {
        return el('div', { class: 'map-band-row' }, [
          el('span', { class: 'map-band-sw', style: 'background:' + BAND_FILL[band] }),
          el('span', { class: 'map-band-name', text: band }),
          el('b', { class: 'map-band-count', text: String(bandCounts[band] || 0) })
        ]);
      }

      function layerGroup() {
        return el('div', { class: 'map-panel-group map-layers-body' }, [
          el('p', { class: 'map-panel-label', text: 'Layers' }),
          layerSwitch('pipes', 'Pipes', pipes.length),
          layerSwitch('air', 'Air stations', airCount),
          layerSwitch('land', 'Land sites', landCount),
          layerSwitch('labels', 'Node labels', null),
          switchRow('Quality field', null, !heatLayer.classList.contains('off'), function (on) {
            heatLayer.classList.toggle('off', !on);
          })
        ]);
      }

      if (cfg.panelHost) {
        /* The map page puts its controls in the rail beside the canvas: a tool panel
           with room to label, group and count, instead of pills sitting on the map. */
        var zoomLevel = el('span', { class: 'map-zoom-level mono', text: '100%' });
        viewListeners.push(function (scale) {
          zoomLevel.textContent = Math.round(scale * 100) + '%';
        });
        var panel = el('section', { class: 'card map-panel' }, [
          el('div', { class: 'map-panel-head' }, [
            el('h3', { text: 'Map tools' }),
            el('span', { class: 'map-panel-note', text: 'applies live' })
          ]),
          el('div', { class: 'map-panel-group' }, [
            el('p', { class: 'map-panel-label', text: 'View' }),
            el('div', { class: 'map-zoom' }, [
              el('button', { class: 'map-panel-btn', type: 'button', text: '−',
                             title: 'Zoom out', 'aria-label': 'Zoom out',
                             on: { click: function () { zoom(1 / 1.3); } } }),
              zoomLevel,
              el('button', { class: 'map-panel-btn', type: 'button', text: '+',
                             title: 'Zoom in', 'aria-label': 'Zoom in',
                             on: { click: function () { zoom(1.3); } } }),
              el('button', { class: 'map-panel-btn ghost map-zoom-reset', type: 'button',
                             text: 'Reset', title: 'Reset the pan and zoom',
                             on: { click: resetView } })
            ])
          ]),
          layerGroup(),
          el('div', { class: 'map-panel-group' }, [
            el('p', { class: 'map-panel-label', text: 'Served WQI bands' }),
            ['Good', 'Acceptable', 'Poor', 'Unsafe'].map(bandRow),
            el('div', { class: 'map-band-row is-muted' }, [
              el('span', { class: 'map-band-sw', style: 'background:' + NO_WQI }),
              el('span', { class: 'map-band-name', text: 'no sensor' }),
              el('b', { class: 'map-band-count', text: '—' })
            ])
          ]),
          el('p', { class: 'map-panel-foot' }, 'node colour is the served WQI band · ',
            el('span', { class: 'mono', text: nodes.length + ' nodes · ' + pipes.length + ' pipes' }))
        ]);
        cfg.panelHost.appendChild(panel);
      } else {
        /* Floating controls for embedded use. The map page uses the panel above. */
        function layerToggle(key, label) {
          return el('label', { class: 'map-layer-row' }, [
            el('input', { type: 'checkbox', checked: layers[key] ? true : null,
                          on: { change: function (ev) {
                            layers[key] = ev.target.checked;
                            applyLayers();
                          } } }),
            el('span', { text: label })
          ]);
        }
        var controls = el('div', { class: 'map-controls' }, [
          el('div', { class: 'map-toolbar' }, [
            el('button', { class: 'chip', text: '+', title: 'Zoom in',
                           on: { click: function () { zoom(1.3); } } }),
            el('button', { class: 'chip', text: '−', title: 'Zoom out',
                           on: { click: function () { zoom(1 / 1.3); } } }),
            el('button', { class: 'chip ghost', text: 'reset', title: 'Reset the view',
                           on: { click: resetView } })
          ]),
          el('details', { class: 'map-layers' }, [
            el('summary', { class: 'chip', text: 'Layers' }),
            el('div', { class: 'map-layers-body' }, [
              el('p', { class: 'map-layers-title', text: 'show on the map' }),
              layerToggle('pipes', 'pipes'),
              layerToggle('air', 'air stations'),
              layerToggle('land', 'land sites'),
              layerToggle('labels', 'labels'),
              el('label', { class: 'map-layer-row' }, [
                el('input', { type: 'checkbox', checked: true,
                              on: { change: function (ev) {
                                heatLayer.classList.toggle('off', !ev.target.checked);
                              } } }),
                el('span', { text: 'quality field' })
              ])
            ])
          ])
        ]);
        var legend = el('details', { class: 'map-legend' }, [
          el('summary', { text: 'Legend' }),
          el('div', { class: 'map-legend-body' }, [
            el('strong', { text: 'Water quality band' }),
            el('div', { style: 'margin:6px 0' }, ['Good', 'Acceptable', 'Poor', 'Unsafe'].map(function (band) {
              return el('div', { class: 'k' }, [
                el('span', { class: 'sw', style: 'background:' + BAND_FILL[band] }), band,
                el('span', { class: 'muted', text: ' · ' + (bandCounts[band] || 0) + ' nodes' })
              ]);
            })),
            el('div', { class: 'k' }, [el('span', { class: 'sw', style: 'background:' + NO_WQI }),
                                       'node, no sensor']),
            el('div', { class: 'k' }, [el('span', { class: 'sw',
                style: 'background:' + AIR_FILL + ';transform:rotate(45deg);border-radius:2px' }), 'air station']),
            el('div', { class: 'k' }, [el('span', { class: 'sw',
                style: 'background:' + LAND_FILL + ';border-radius:2px' }), 'land site']),
            el('p', { class: 'muted', style: 'margin:8px 0 0;font-size:11.5px' },
              'Pipe thickness ∝ log(diameter). The quality field is interpolated from the'
              + ' served WQI colours, not re-banded here. On a trace, a higher decay k'
              + ' means a worse section.')
          ])
        ]);
        var KM_PER_UNIT = ((bounds.maxLon - bounds.minLon) * 111.32
                           * Math.cos(19 * Math.PI / 180)) / W;
        var scaleKm = KM_PER_UNIT * W > 20 ? 10 : 5;
        var coords = el('div', { class: 'map-coords mono', text: 'lon — · lat —' });
        surface.addEventListener('pointermove', function (ev) {
          var box = surface.getBoundingClientRect();
          var x = (ev.clientX - box.left) * (W / box.width);
          var y = (ev.clientY - box.top) * (H / box.height);
          var lon = bounds.minLon + (x - W * pad) / sx;
          var lat = bounds.maxLat - (y - H * pad) / sy;
          coords.textContent = 'lon ' + lon.toFixed(4) + ' · lat ' + lat.toFixed(4);
        });
        var mix = el('div', { class: 'map-mix' }, ['Good', 'Acceptable', 'Poor', 'Unsafe']
          .map(function (band) {
            return el('div', { class: 'map-mix-row' }, [
              el('span', { class: 'sw', style: 'background:' + BAND_FILL[band] }),
              el('span', { class: 'map-mix-label', text: band }),
              el('b', { text: String(bandCounts[band] || 0) })
            ]);
          }));
        host.appendChild(controls);
        host.appendChild(legend);
        host.appendChild(el('div', { class: 'map-chrome' }, [
          el('div', { class: 'map-compass', title: 'north is up' }, [
            el('span', { class: 'map-compass-n', text: 'N' }),
            el('span', { class: 'map-compass-arrow', title: 'north' })
          ]),
          el('div', { class: 'map-scale' }, [
            el('div', { class: 'map-scale-bar',
                        style: 'width:' + Math.round(scaleKm / KM_PER_UNIT) + 'px' }),
            el('span', { class: 'mono', text: scaleKm + ' km' })
          ]),
          coords
        ]));
        host.appendChild(el('div', { class: 'map-bands' }, [
          el('span', { class: 'map-bands-label', text: 'served bands' }), mix
        ]));
      }
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
        notifyView();
        select(id);
      }
    };
  }

  NIRI.map = { create: create };
}(window.NIRI));
