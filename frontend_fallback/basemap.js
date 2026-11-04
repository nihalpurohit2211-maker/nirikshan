/* basemap.js — one hand-authored schematic Mumbai base map, shared by the city
 * overview and the network graph.
 *
 * There are no tiles, keys, downloads or external images: every coastline, creek,
 * lake, road and rail line below is a hand-written lon/lat path, projected into the
 * 1000x720 SVG view. The caption says "not to scale" because it is a diagram, not a
 * survey. The only data drawn on top is served by the API: zone WQI colours, AQI
 * categories and complaint counts (counted for display, never turned into a verdict).
 *
 *   NIRI.basemap.layer('city'|'local', opts) -> <g>   base geometry only
 *   NIRI.basemap.project(lon, lat, mode)     -> [x, y]
 *   NIRI.basemap.create(opts)                -> interactive city map with zones
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var s = NIRI.s, el = NIRI.el;

  var VIEW = { w: 1000, h: 720 };
  var BOUNDS = {
    /* the wider city picture: Sion / Mahim Bay in the south-west, Powai and
       Vikhroli in the north-east, Thane Creek on the eastern edge. */
    city: { minLon: 72.850, maxLon: 72.946, minLat: 19.010, maxLat: 19.100 },
    /* the network itself: the five wards around Chembur / Kurla East / Govandi. */
    local: { minLon: 72.862, maxLon: 72.930, minLat: 19.030, maxLat: 19.064 }
  };

  function projector(bounds, pad) {
    var sx = (VIEW.w * (1 - 2 * pad)) / (bounds.maxLon - bounds.minLon);
    var sy = (VIEW.h * (1 - 2 * pad)) / (bounds.maxLat - bounds.minLat);
    return function (lon, lat) {
      return [VIEW.w * pad + (lon - bounds.minLon) * sx,
              VIEW.h * pad + (bounds.maxLat - lat) * sy];
    };
  }

  var PROJ = { city: projector(BOUNDS.city, 0.045), local: projector(BOUNDS.local, 0.065) };

  function project(lon, lat, mode) {
    return (PROJ[mode] || PROJ.city)(lon, lat);
  }

  function d(points, close, mode) {
    var proj = PROJ[mode] || PROJ.city;
    var out = points.map(function (p, i) {
      var xy = proj(p[0], p[1]);
      return (i ? 'L' : 'M') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
    }).join(' ');
    return out + (close ? ' Z' : '');
  }

  function shape(points, cls, mode) {
    return s('path', { class: cls, d: d(points, true, mode) });
  }

  function stroke(points, cls, mode) {
    return s('path', { class: cls, d: d(points, false, mode), fill: 'none' });
  }

  function label(g, mode, lon, lat, text, cls, dx, dy, anchor, rotate) {
    var b = BOUNDS[mode] || BOUNDS.city;
    var padLon = (b.maxLon - b.minLon) * 0.02;
    var padLat = (b.maxLat - b.minLat) * 0.02;
    if (lon < b.minLon - padLon || lon > b.maxLon + padLon ||
        lat < b.minLat - padLat || lat > b.maxLat + padLat) return;
    var xy = PROJ[mode](lon, lat);
    var attrs = { class: cls, x: xy[0] + (dx || 0), y: xy[1] + (dy || 0), text: text };
    if (anchor) attrs['text-anchor'] = anchor;
    if (rotate) attrs.transform = 'rotate(' + rotate + ' ' + (xy[0] + (dx || 0)) + ' ' +
                                  (xy[1] + (dy || 0)) + ')';
    g.appendChild(s('text', attrs));
  }

  /* ---------------------------------------------------------------- geometry */
  /* Land is the page; the sea is painted on top where the city meets it. The
     eastern edge of the frame is Thane Creek, the south-west corner is Mahim Bay
     and the Mithi river runs through the middle of the study area. */

  var CREEK = [
    [72.960, 19.112], [72.944, 19.112], [72.939, 19.099], [72.935, 19.086],
    [72.930, 19.073], [72.924, 19.060], [72.918, 19.047], [72.912, 19.034],
    [72.906, 19.022], [72.901, 19.010], [72.960, 19.000]
  ];
  var CREEK_EDGE = [
    [72.944, 19.112], [72.939, 19.099], [72.935, 19.086], [72.930, 19.073],
    [72.924, 19.060], [72.918, 19.047], [72.912, 19.034], [72.906, 19.022],
    [72.901, 19.010]
  ];
  var MAHIM = [
    [72.840, 19.000], [72.840, 19.026], [72.845, 19.031], [72.851, 19.034],
    [72.857, 19.035], [72.863, 19.031], [72.868, 19.024], [72.872, 19.016],
    [72.874, 19.006], [72.874, 19.000]
  ];
  var MITHI = [
    [72.910, 19.105], [72.906, 19.094], [72.902, 19.084], [72.897, 19.074],
    [72.892, 19.066], [72.886, 19.058], [72.880, 19.050], [72.873, 19.043],
    [72.866, 19.036], [72.859, 19.033]
  ];
  var POWAI = [
    [72.903, 19.099], [72.908, 19.100], [72.912, 19.097], [72.913, 19.092],
    [72.909, 19.089], [72.904, 19.090], [72.901, 19.094]
  ];
  var PARKS = [
    [[72.883, 19.043], [72.894, 19.043], [72.895, 19.051], [72.884, 19.052]],
    [[72.897, 19.048], [72.904, 19.048], [72.906, 19.056], [72.899, 19.057]],
    [[72.908, 19.084], [72.919, 19.084], [72.920, 19.093], [72.909, 19.094]],
    [[72.863, 19.051], [72.870, 19.051], [72.870, 19.058], [72.863, 19.058]]
  ];
  var EEH = [
    [72.869, 19.005], [72.876, 19.020], [72.883, 19.035], [72.890, 19.050],
    [72.896, 19.065], [72.901, 19.080], [72.906, 19.095], [72.910, 19.106]
  ];
  var LBS = [
    [72.857, 19.008], [72.865, 19.028], [72.874, 19.046], [72.882, 19.062],
    [72.888, 19.077], [72.893, 19.093]
  ];
  var SION_MANKHURD = [
    [72.858, 19.038], [72.874, 19.034], [72.888, 19.030], [72.902, 19.026],
    [72.918, 19.021]
  ];
  var RAIL = [
    [72.860, 19.006], [72.871, 19.025], [72.880, 19.042], [72.889, 19.057],
    [72.897, 19.072], [72.905, 19.087], [72.912, 19.101]
  ];
  var STREETS = [
    [[72.870, 19.038], [72.882, 19.044], [72.892, 19.052], [72.902, 19.061]],
    [[72.868, 19.052], [72.879, 19.050], [72.891, 19.047], [72.902, 19.043]],
    [[72.879, 19.033], [72.888, 19.041], [72.896, 19.050], [72.906, 19.056]],
    [[72.883, 19.058], [72.892, 19.061], [72.903, 19.065], [72.913, 19.067]],
    [[72.892, 19.027], [72.895, 19.038], [72.899, 19.048], [72.902, 19.058]],
    [[72.868, 19.030], [72.880, 19.036], [72.892, 19.042], [72.904, 19.048]],
    [[72.874, 19.060], [72.886, 19.058], [72.898, 19.056], [72.910, 19.052]],
    [[72.882, 19.066], [72.892, 19.062], [72.902, 19.058], [72.912, 19.054]],
    [[72.890, 19.024], [72.894, 19.036], [72.898, 19.048], [72.902, 19.060]],
    [[72.900, 19.030], [72.904, 19.040], [72.908, 19.050], [72.912, 19.060]],
    [[72.878, 19.070], [72.888, 19.068], [72.898, 19.066], [72.908, 19.064]],
    [[72.866, 19.042], [72.878, 19.046], [72.890, 19.050], [72.902, 19.054]],
    /* more local streets for a finer grain */
    [[72.862, 19.040], [72.874, 19.042], [72.886, 19.045], [72.898, 19.047]],
    [[72.876, 19.054], [72.887, 19.052], [72.900, 19.051], [72.912, 19.050]],
    [[72.861, 19.062], [72.872, 19.060], [72.884, 19.059], [72.896, 19.057], [72.908, 19.056]],
    [[72.880, 19.034], [72.890, 19.036], [72.900, 19.038], [72.910, 19.039]],
    [[72.866, 19.070], [72.876, 19.068], [72.888, 19.066], [72.900, 19.065]],
    [[72.894, 19.030], [72.902, 19.032], [72.910, 19.033]],
    [[72.856, 19.028], [72.868, 19.030], [72.880, 19.032], [72.892, 19.033]],
    [[72.913, 19.076], [72.922, 19.074], [72.929, 19.072]]
  ];
  /* Light built-up patches: enough texture to read as a city, never loud enough to
     compete with the ward fills that sit on top. */
  var BLOCKS = [
    [[72.876, 19.064], [72.884, 19.064], [72.884, 19.069], [72.876, 19.069]],
    [[72.884, 19.046], [72.897, 19.046], [72.897, 19.052], [72.884, 19.052]],
    [[72.900, 19.074], [72.910, 19.074], [72.910, 19.080], [72.900, 19.080]],
    [[72.858, 19.036], [72.867, 19.036], [72.867, 19.042], [72.858, 19.042]],
    [[72.885, 19.026], [72.895, 19.026], [72.895, 19.032], [72.885, 19.032]],
    [[72.906, 19.086], [72.914, 19.086], [72.914, 19.091], [72.906, 19.091]],
    [[72.918, 19.092], [72.926, 19.092], [72.926, 19.098], [72.918, 19.098]],
    [[72.852, 19.044], [72.860, 19.044], [72.860, 19.050], [72.852, 19.050]],
    [[72.895, 19.036], [72.905, 19.036], [72.905, 19.042], [72.895, 19.042]],
    /* more built-up patches, denser near the highway and rail corridor */
    [[72.866, 19.028], [72.875, 19.028], [72.875, 19.033], [72.866, 19.033]],
    [[72.892, 19.054], [72.903, 19.054], [72.903, 19.060], [72.892, 19.060]],
    [[72.908, 19.034], [72.918, 19.034], [72.918, 19.039], [72.908, 19.039]],
    [[72.860, 19.052], [72.870, 19.052], [72.870, 19.057], [72.860, 19.057]],
    [[72.900, 19.082], [72.911, 19.082], [72.911, 19.087], [72.900, 19.087]],
    [[72.878, 19.048], [72.889, 19.048], [72.889, 19.053], [72.878, 19.053]],
    [[72.924, 19.012], [72.932, 19.012], [72.932, 19.017], [72.924, 19.017]]
  ];

  var CITY_LABELS = [
    ['Dharavi', 72.856, 19.048, 'bm-label', 0, 0, null],
    ['Sion', 72.862, 19.039, 'bm-label', 0, 0, null],
    ['Kurla', 72.882, 19.071, 'bm-label', 0, 0, null],
    ['Ghatkopar', 72.908, 19.082, 'bm-label', 0, 0, null],
    ['Vikhroli', 72.923, 19.096, 'bm-label', 0, 0, null],
    ['Powai', 72.916, 19.091, 'bm-label', 0, 9, null],
    ['Mankhurd', 72.891, 19.021, 'bm-label', 0, 0, null],
    ['Govandi', 72.906, 19.026, 'bm-label', 0, 0, null],
    ['MUMBAI', 72.864, 19.094, 'bm-ghost', 0, 0, null],
    ['EASTERN SUBURBS · STUDY AREA', 72.857, 19.016, 'bm-ghost bm-ghost-small', 0, 0, null]
  ];
  var LOCAL_LABELS = [
    ['Kurla East', 72.886, 19.061, 'bm-label', 0, 0, null],
    ['Chembur', 72.893, 19.053, 'bm-label bm-label-strong', 0, 0, null],
    ['Govandi', 72.906, 19.034, 'bm-label', 0, 0, null],
    ['Mankhurd', 72.890, 19.031, 'bm-label', 0, 0, null],
    ['Thane Creek', 72.926, 19.044, 'bm-label bm-label-water', 0, 0, null],
    ['STUDY AREA', 72.872, 19.059, 'bm-ghost bm-ghost-small', 0, 0, null]
  ];

  /* ---------------------------------------------------------------- compass */
  /* A small professional compass rose (true north is up in this projection). */
  function compassRose() {
    var c = s('g', { class: 'bm-compass', transform: 'translate(' + (VIEW.w - 86) + ' 66)' });
    c.appendChild(s('circle', { class: 'bm-compass-ring', r: 24, fill: '#fffdf7',
                                stroke: '#5c5347', 'stroke-width': 1.2 }));
    c.appendChild(s('circle', { class: 'bm-compass-dot', cx: 0, cy: 0, r: 2.2, fill: '#1c1917' }));
    /* cardinal and intercardinal ticks */
    ['N', 'E', 'S', 'W'].forEach(function (name, i) {
      var a = i * Math.PI / 2;
      c.appendChild(s('line', { x1: Math.sin(a) * 18, y1: -Math.cos(a) * 18,
                              x2: Math.sin(a) * 22, y2: -Math.cos(a) * 22,
                              stroke: '#5c5347', 'stroke-width': 1.4 }));
      c.appendChild(s('text', { x: Math.sin(a) * 30, y: -Math.cos(a) * 30 + 3,
                                'text-anchor': 'middle',
                                'font-family': 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                                'font-weight': '700', 'font-size': 9, fill: '#3d372d',
                                'letter-spacing': '.05em', text: name }));
    });
    /* the north needle */
    c.appendChild(s('path', { class: 'bm-compass-needle',
                              d: 'M-5 -6 L0 -22 L5 -6 L0 -10 Z', fill: '#14532d' }));
    return c;
  }

  /* --------------------------------------------------------------- scale bar */
  /* Offline scale bar: kilometres per pixel come from the projected bounds, so
     the bar stays truthful without any tiles or external data. */
  function scaleBar(mode) {
    var b = BOUNDS[mode] || BOUNDS.city;
    var mPerPx = ((b.maxLon - b.minLon) * 111320 *
                  Math.cos(((b.minLat + b.maxLat) / 2) * Math.PI / 180)) / VIEW.w;
    var targetKm = 2;
    var barPx = Math.round((targetKm * 1000) / mPerPx / 10) * 10; /* snap to 10px */
    var seg = barPx / 4;
    var g = s('g', { class: 'bm-scale', transform: 'translate(30 ' + (VIEW.h - 44) + ')' });
    for (var i = 0; i < 4; i++) {
      g.appendChild(s('rect', { x: i * seg, y: 0, width: seg - 0.6, height: 7,
                              fill: i % 2 ? '#fffdf7' : '#1c1917',
                              stroke: '#3d372d', 'stroke-width': 0.6 }));
    }
    [0, 1, 2, 3, 4].forEach(function (i) {
      g.appendChild(s('line', { x1: i * seg, y1: 8, x2: i * seg, y2: 13,
                              stroke: '#3d372d', 'stroke-width': 0.8 }));
    });
    g.appendChild(s('text', { x: 0, y: 26, 'text-anchor': 'start',
                              'font-family': 'ui-monospace, "Cascadia Mono", "SF Mono", monospace',
                              'font-size': 9, fill: '#3d372d', text: '0' }));
    g.appendChild(s('text', { x: barPx / 2, y: 26, 'text-anchor': 'middle',
                              'font-family': 'ui-monospace, "Cascadia Mono", "SF Mono", monospace',
                              'font-size': 9, fill: '#3d372d', text: targetKm / 2 + ' km' }));
    g.appendChild(s('text', { x: barPx, y: 26, 'text-anchor': 'end',
                              'font-family': 'ui-monospace, "Cascadia Mono", "SF Mono", monospace',
                              'font-size': 9, fill: '#3d372d', text: targetKm + ' km' }));
    return g;
  }

  function baseGeometry(mode) {
    var g = s('g', { class: 'bm-base' });
    g.appendChild(s('rect', { class: 'bm-land', x: 0, y: 0, width: VIEW.w, height: VIEW.h }));
    g.appendChild(shape(CREEK, 'bm-sea', mode));
    g.appendChild(shape(MAHIM, 'bm-sea', mode));
    g.appendChild(shape(POWAI, 'bm-sea bm-lake', mode));
    /* water depth: shore feather, bank, then the river itself */
    g.appendChild(stroke(MITHI, 'bm-river-shore', mode));
    g.appendChild(stroke(MITHI, 'bm-river-bank', mode));
    g.appendChild(stroke(MITHI, 'bm-river', mode));
    g.appendChild(stroke(CREEK_EDGE, 'bm-coast', mode));

    PARKS.forEach(function (p) { g.appendChild(shape(p, 'bm-park', mode)); });
    /* Built-up patches: alternate light and dense tones so neighbourhoods read
       as texture rather than empty plots, never loud enough to fight the wards. */
    var proj = PROJ[mode] || PROJ.city;
    BLOCKS.forEach(function (p, i) {
      var pts = p.map(function (ll) { return proj(ll[0], ll[1]); });
      g.appendChild(s('path', { class: 'bm-block' + (i % 2 ? ' bm-block-dense' : ''),
                                d: roundedPath(pts, 11) }));
    });

    /* road hierarchy: major roads get a casing (thick light halo) plus a thinner
       centreline; minor roads and local streets sit below them in weight. */
    g.appendChild(stroke(EEH, 'bm-road-casing', mode));
    g.appendChild(stroke(EEH, 'bm-road-center', mode));
    g.appendChild(stroke(LBS, 'bm-road-minor', mode));
    g.appendChild(stroke(SION_MANKHURD, 'bm-road-minor', mode));
    STREETS.forEach(function (p) { g.appendChild(stroke(p, 'bm-street', mode)); });
    g.appendChild(stroke(RAIL, 'bm-rail', mode));

    var labels = s('g', { class: 'bm-labels' });
    (mode === 'local' ? LOCAL_LABELS : CITY_LABELS).forEach(function (row) {
      label(labels, mode, row[1], row[2], row[0], row[3], row[4], row[5], row[6]);
    });
    label(labels, mode, 72.932, 19.050, 'Thane Creek', 'bm-label bm-label-water', 0, 0,
          'middle', -68);
    label(labels, mode, 72.882, 19.057, 'Mithi River', 'bm-label bm-label-water', 0, -5,
          'middle', -55);
    label(labels, mode, 72.856, 19.019, 'Mahim Bay', 'bm-label bm-label-water', 0, 0,
          'middle', -18);
    label(labels, mode, 72.907, 19.088, 'Powai Lake', 'bm-label bm-label-water', 0, 0,
          null, null);
    label(labels, mode, 72.878, 19.023, 'Harbour line', 'bm-label bm-label-rail', 7, 4,
          null, -32);
    label(labels, mode, 72.898, 19.071, 'Eastern Express Hwy', 'bm-label bm-label-road',
          6, -5, null, -72);
    g.appendChild(labels);

    /* city view gets a real compass and scale bar; the local (network) view keeps
       its own HTML chrome so nothing collides with pipes and nodes. */
    if (mode === 'city') {
      g.appendChild(compassRose());
      g.appendChild(scaleBar(mode));
    }
    return g;
  }

  function layer(mode) {
    return baseGeometry(mode === 'local' ? 'local' : 'city');
  }

  /* ----------------------------------------------------------- ward mosaic */
  /* The five served ward centres sit within a few kilometres of one another, so
     literal blobs at those coordinates overlap into one stain. The city view uses
     a schematic ward mosaic instead: a hand-placed Voronoi tessellation that gives
     every ward a large, readable cell. The layout is presentation only — the fill,
     label and numbers in each cell are still the served values. The network map
     keeps plotting nodes at their real coordinates. */
  var WARD_SEED = {
    zone_1: [305, 520],
    zone_2: [455, 500],
    zone_3: [330, 365],
    zone_4: [490, 305],
    zone_5: [590, 425]
  };
  var MOSAIC = [
    [258, 330], [296, 258], [392, 228], [506, 242], [600, 296], [648, 380],
    [596, 462], [520, 524], [452, 562], [362, 554], [286, 506], [248, 420]
  ];

  /* Keep the half-plane closer to `own` than to `other` (Sutherland-Hodgman). */
  function clipCell(poly, own, other) {
    var a = 2 * (other[0] - own[0]);
    var b = 2 * (other[1] - own[1]);
    var c = own[0] * own[0] + own[1] * own[1] -
            other[0] * other[0] - other[1] * other[1];
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      var fp = a * p[0] + b * p[1] + c;
      var fq = a * q[0] + b * q[1] + c;
      if (fp <= 0) out.push(p);
      if ((fp <= 0) !== (fq <= 0)) {
        var t = fp / (fp - fq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    return out;
  }

  function cellFor(seed, seeds) {
    var poly = MOSAIC.slice();
    seeds.forEach(function (other) {
      if (other[0] === seed[0] && other[1] === seed[1]) return;
      poly = clipCell(poly, seed, other);
    });
    return poly.length > 2 ? poly : [[seed[0] - 40, seed[1] - 30],
                                    [seed[0] + 40, seed[1] - 30],
                                    [seed[0] + 40, seed[1] + 30],
                                    [seed[0] - 40, seed[1] + 30]];
  }

  /* Straight Voronoi edges, softened at the corners so the mosaic reads organic. */
  function roundedPath(points, radius) {
    var n = points.length;
    if (n < 3) return '';
    var out = '';
    for (var i = 0; i < n; i++) {
      var prev = points[(i - 1 + n) % n], cur = points[i], next = points[(i + 1) % n];
      var v1x = prev[0] - cur[0], v1y = prev[1] - cur[1];
      var v2x = next[0] - cur[0], v2y = next[1] - cur[1];
      var l1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
      var l2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
      var r1 = Math.min(radius, l1 / 2), r2 = Math.min(radius, l2 / 2);
      var ax = cur[0] + v1x / l1 * r1, ay = cur[1] + v1y / l1 * r1;
      var bx = cur[0] + v2x / l2 * r2, by = cur[1] + v2y / l2 * r2;
      out += (i ? 'L' : 'M') + ax.toFixed(1) + ' ' + ay.toFixed(1);
      out += ' Q' + cur[0].toFixed(1) + ' ' + cur[1].toFixed(1) + ' ' +
             bx.toFixed(1) + ' ' + by.toFixed(1);
    }
    return out + ' Z';
  }

  function statText(zone, mode) {
    if (mode === 'air') {
      return zone.air ? 'AQI ' + zone.air.value +
                        (zone.air.category ? ' · ' + zone.air.category : '')
                       : 'no air station';
    }
    if (mode === 'complaints') {
      var n = zone.complaints || 0;
      return n + ' complaint' + (n === 1 ? '' : 's');
    }
    return zone.wqi ? 'WQI ' + zone.wqi.score + ' · ' + zone.wqi.band : 'no reading';
  }

  function create(opts) {
    opts = opts || {};
    var mode = opts.mode || 'water';
    var zones = opts.zones || [];
    var zoneNodes = {};
    var maxComplaints = 1;

    var svg = s('svg', { class: 'map-svg basemap-map', viewBox: '0 0 ' + VIEW.w + ' ' + VIEW.h,
                         role: 'img',
                         'aria-label': 'schematic Mumbai base map with ward overlays' });
    svg.appendChild(baseGeometry('city'));
    var zoneLayer = s('g', { class: 'bm-zones' });
    var labelLayer = s('g', { class: 'bm-zone-labels', 'pointer-events': 'none' });
    svg.appendChild(zoneLayer);
    svg.appendChild(labelLayer);

    var host = el('div', { class: 'basemap-host' }, [
      svg,
      el('p', { class: 'map-caption',
                text: 'municipal base map — synthetic city data; scale bar and north up' })
    ]);

    function fillFor(zone) {
      if (!zone.wqi) return { fill: '#9FB3A8', stroke: '#7c8f86' };
      return { fill: zone.wqi.colour || NIRI.BANDS[zone.wqi.band] || '#9FB3A8',
               stroke: zone.wqi.colour || '#6b8f71' };
    }

    function applyMode() {
      var max = maxComplaints || 1;
      svg.setAttribute('data-mode', mode);
      Object.keys(zoneNodes).forEach(function (id) {
        var z = zoneNodes[id];
        var f = fillFor(z.zone);
        var accent = f.stroke;
        if (mode === 'water' || mode === 'all') {
          z.blob.setAttribute('fill', f.fill);
          z.blob.setAttribute('fill-opacity', mode === 'all' ? 0.52 : 0.58);
          z.blob.setAttribute('stroke', f.stroke);
          z.blob.setAttribute('stroke-opacity', 0.95);
        } else if (mode === 'air') {
          z.blob.setAttribute('fill', '#6b8f71');
          z.blob.setAttribute('fill-opacity', 0.12);
          z.blob.setAttribute('stroke', '#8aa393');
          z.blob.setAttribute('stroke-opacity', 0.75);
          accent = (z.zone.air && z.zone.air.colour) || '#6b8f71';
        } else {
          var n = z.zone.complaints || 0;
          z.blob.setAttribute('fill', '#b45309');
          z.blob.setAttribute('fill-opacity', 0.16 + 0.40 * (n / max));
          z.blob.setAttribute('stroke', '#b45309');
          z.blob.setAttribute('stroke-opacity', 0.8);
          accent = '#b45309';
        }
        z.accent.setAttribute('fill', accent);
        z.stat.textContent = statText(z.zone, mode);
        if (z.air) z.air.style.display = (mode === 'air' || mode === 'all') ? '' : 'none';
        if (z.count) z.count.style.display = (mode === 'complaints' || mode === 'all')
                                              ? '' : 'none';
      });
    }

    function setZones(next) {
      zones = next || [];
      zoneNodes = {};
      NIRI.clear(zoneLayer);
      NIRI.clear(labelLayer);
      maxComplaints = Math.max.apply(null, zones.map(function (z) { return z.complaints || 0; })
                                          .concat([1]));
      var seeds = zones.map(function (z) {
        return WARD_SEED[z.id] || project(z.lon, z.lat, 'city');
      });

      zones.forEach(function (zone, index) {
        var seed = seeds[index];
        var d = roundedPath(cellFor(seed, seeds), 14);
        var g = s('g', { class: 'bm-zone-group', 'data-zone': zone.id, tabindex: '0',
                         role: 'button',
                         'aria-label': zone.name + ' — open its cases' });
        g.appendChild(s('path', { class: 'bm-zone-gap', d: d }));
        var path = s('path', { class: 'bm-zone', d: d });
        g.appendChild(path);

        g.appendChild(s('title', {
          text: zone.name + (zone.locality ? ' · ' + zone.locality : '') +
                (zone.wqi ? ' · WQI ' + zone.wqi.score + ' ' + zone.wqi.band : '') +
                ' · ' + (zone.cases || []).length + ' open case(s) · ' +
                (zone.complaints || 0) + ' complaint(s)'
        }));

        function hover(ev) { if (opts.onZoneHover) opts.onZoneHover(zone, ev); }
        g.addEventListener('mouseenter', hover);
        g.addEventListener('mousemove', hover);
        g.addEventListener('mouseleave', function () {
          if (opts.onZoneHover) opts.onZoneHover(null);
        });
        g.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (opts.onZoneClick) opts.onZoneClick(zone);
        });
        g.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            if (opts.onZoneClick) opts.onZoneClick(zone);
          }
        });

        /* The plate and markers live above every cell, so a neighbouring gutter
           can never clip another ward's label. */
        var label = s('g', { class: 'bm-zone-label', 'data-zone': zone.id });
        var plate = s('g', { class: 'bm-zone-tag',
                             transform: 'translate(' + seed[0] + ' ' + seed[1] + ')' });
        plate.appendChild(s('rect', { class: 'bm-plate', x: -56, y: -25, width: 112,
                                      height: 50, rx: 9 }));
        var accent = s('rect', { class: 'bm-plate-accent', x: -56, y: -25, width: 4,
                                 height: 50, rx: 2 });
        plate.appendChild(accent);
        plate.appendChild(s('text', { class: 'bm-zone-kicker', x: -45, y: -10,
                                      text: (zone.short || zone.name).toUpperCase() }));
        plate.appendChild(s('text', { class: 'bm-zone-name', x: -45, y: 4,
                                      text: zone.locality || zone.name }));
        var stat = s('text', { class: 'bm-zone-stat', x: -45, y: 18 });
        plate.appendChild(stat);
        label.appendChild(plate);

        var air = null;
        if (zone.air) {
          air = s('g', { class: 'bm-air',
                         transform: 'translate(' + (seed[0] - 46) + ' ' + (seed[1] - 40) + ')' });
          air.appendChild(s('rect', { x: -8, y: -8, width: 16, height: 16, rx: 2,
                                      transform: 'rotate(45)',
                                      fill: zone.air.colour || '#7E9AA8' }));
          air.appendChild(s('title', { text: 'air ' + zone.air.value + ' · ' +
                                            (zone.air.category || '') }));
          label.appendChild(air);
        }

        var count = null;
        if (zone.complaints) {
          count = s('g', { class: 'bm-count',
                           transform: 'translate(' + (seed[0] + 46) + ' ' + (seed[1] - 40) + ')' });
          count.appendChild(s('circle', { r: 11 }));
          count.appendChild(s('text', { x: 0, y: 4, 'text-anchor': 'middle',
                                        text: String(zone.complaints) }));
          count.appendChild(s('title', { text: zone.complaints + ' complaints on record' }));
          label.appendChild(count);
        }

        zoneNodes[zone.id] = { group: g, label: label, blob: path, accent: accent,
                               air: air, count: count, stat: stat, zone: zone };
        zoneLayer.appendChild(g);
        labelLayer.appendChild(label);
      });
      applyMode();
    }

    function setMode(next) { mode = next; applyMode(); }
    function highlight(zoneId) {
      Object.keys(zoneNodes).forEach(function (id) {
        var node = zoneNodes[id];
        node.group.classList.toggle('is-active', id === zoneId);
        node.group.classList.toggle('is-dim', !!zoneId && id !== zoneId);
        node.label.classList.toggle('is-active', id === zoneId);
        node.label.classList.toggle('is-dim', !!zoneId && id !== zoneId);
      });
    }

    setZones(zones);
    return { element: host, svg: svg, project: function (lon, lat) {
      return project(lon, lat, 'city');
    }, setMode: setMode, setZones: setZones, highlight: highlight,
             bounds: BOUNDS.city };
  }

  NIRI.basemap = {
    VIEW: VIEW,
    BOUNDS: BOUNDS,
    project: project,
    layer: layer,
    create: create
  };
}(window.NIRI));
