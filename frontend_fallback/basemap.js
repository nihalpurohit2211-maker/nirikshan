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
    [[72.892, 19.027], [72.895, 19.038], [72.899, 19.048], [72.902, 19.058]]
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

  function baseGeometry(mode) {
    var g = s('g', { class: 'bm-base' });
    g.appendChild(s('rect', { class: 'bm-land', x: 0, y: 0, width: VIEW.w, height: VIEW.h }));
    g.appendChild(shape(CREEK, 'bm-sea', mode));
    g.appendChild(shape(MAHIM, 'bm-sea', mode));
    g.appendChild(stroke(CREEK_EDGE, 'bm-coast', mode));
    g.appendChild(stroke(MITHI, 'bm-river-bank', mode));
    g.appendChild(stroke(MITHI, 'bm-river', mode));
    g.appendChild(shape(POWAI, 'bm-sea bm-lake', mode));

    PARKS.forEach(function (p) { g.appendChild(shape(p, 'bm-park', mode)); });

    g.appendChild(stroke(LBS, 'bm-road bm-road-minor', mode));
    g.appendChild(stroke(SION_MANKHURD, 'bm-road bm-road-minor', mode));
    STREETS.forEach(function (p) { g.appendChild(stroke(p, 'bm-street', mode)); });
    g.appendChild(stroke(EEH, 'bm-road bm-road-major', mode));
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

    /* a small north arrow, always in the top-right of the frame */
    var north = s('g', { class: 'bm-north', transform: 'translate(' + (VIEW.w - 42) + ' 38)' });
    north.appendChild(s('path', { d: 'M0 12 L0 -12 L-5 -3 M0 -12 L5 -3' }));
    north.appendChild(s('text', { x: 0, y: 25, 'text-anchor': 'middle', text: 'N' }));
    g.appendChild(north);
    return g;
  }

  function layer(mode) {
    return baseGeometry(mode === 'local' ? 'local' : 'city');
  }

  /* -------------------------------------------------------------- zone blobs */
  function hashSeed(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function blob(cx, cy, rx, ry, seed) {
    var rand = seed;
    function next() {
      rand = (Math.imul(rand, 1664525) + 1013904223) >>> 0;
      return rand / 4294967296;
    }
    var pts = [];
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * Math.PI * 2;
      var wobble = 0.82 + next() * 0.32;
      pts.push([cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble]);
    }
    return 'M' + pts.map(function (p, i) {
      return (i ? 'L' : '') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ') + ' Z';
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
    svg.appendChild(zoneLayer);

    var host = el('div', { class: 'basemap-host' }, [
      svg,
      el('p', { class: 'map-caption',
                text: 'schematic base map — not to scale; synthetic city data' })
    ]);

    function fillFor(zone) {
      if (!zone.wqi) return { fill: '#9FB3A8', stroke: '#7c8f86', opacity: 0.14 };
      return { fill: zone.wqi.colour || NIRI.BANDS[zone.wqi.band] || '#9FB3A8',
               stroke: zone.wqi.colour || '#6b8f71', opacity: 0.28 };
    }

    function applyMode() {
      var max = maxComplaints || 1;
      svg.setAttribute('data-mode', mode);
      Object.keys(zoneNodes).forEach(function (id) {
        var z = zoneNodes[id];
        var blobEl = z.blob, airEl = z.air, countEl = z.count;
        var f = fillFor(z.zone);
        if (mode === 'water' || mode === 'all') {
          blobEl.setAttribute('fill', f.fill);
          blobEl.setAttribute('fill-opacity', mode === 'all' ? 0.20 : 0.30);
          blobEl.setAttribute('stroke', f.stroke);
          blobEl.setAttribute('stroke-opacity', 0.85);
        } else if (mode === 'air') {
          blobEl.setAttribute('fill', '#6b8f71');
          blobEl.setAttribute('fill-opacity', 0.07);
          blobEl.setAttribute('stroke', '#6b8f71');
          blobEl.setAttribute('stroke-opacity', 0.22);
        } else {
          var n = z.zone.complaints || 0;
          blobEl.setAttribute('fill', '#b45309');
          blobEl.setAttribute('fill-opacity', 0.10 + 0.32 * (n / max));
          blobEl.setAttribute('stroke', '#b45309');
          blobEl.setAttribute('stroke-opacity', 0.55);
        }
        if (airEl) airEl.style.display = (mode === 'air' || mode === 'all') ? '' : 'none';
        if (countEl) countEl.style.display = (mode === 'complaints' || mode === 'all') ? '' : 'none';
      });
    }

    function setZones(next) {
      zones = next || [];
      zoneNodes = {};
      NIRI.clear(zoneLayer);
      maxComplaints = Math.max.apply(null, zones.map(function (z) { return z.complaints || 0; })
                                          .concat([1]));
      zones.forEach(function (zone) {
        var xy = project(zone.lon, zone.lat, 'city');
        var g = s('g', { class: 'bm-zone-group', 'data-zone': zone.id, tabindex: '0',
                         role: 'button',
                         'aria-label': zone.name + ' — open its cases' });
        var path = s('path', { class: 'bm-zone', d: blob(xy[0], xy[1], 58, 38,
                                                        hashSeed(zone.id)) });
        g.appendChild(path);

        /* Label plate: short ward number + the real locality. The five ward centres
           are close together, so each label is nudged out on its own side with a
           leader line; without this the plates stack on top of each other. */
        var title = zone.short || zone.name;
        var sub = zone.locality || '';
        var w = Math.max(title.length * 7.4, sub.length * 5.9) + 20;
        var h = sub ? 34 : 22;
        var NUDGE = { zone_1: [-52, 44], zone_2: [52, 44], zone_3: [-48, -44],
                      zone_4: [48, -44], zone_5: [40, 14] };
        var nudge = NUDGE[zone.id] || [0, 0];
        var tx = Math.max(w / 2 + 6, Math.min(VIEW.w - w / 2 - 6, xy[0] + nudge[0]));
        var ty = Math.max(h / 2 + 6, Math.min(VIEW.h - h / 2 - 6, xy[1] + nudge[1]));
        if (nudge[0] || nudge[1]) {
          g.appendChild(s('line', { class: 'bm-zone-leader', x1: xy[0], y1: xy[1],
                                    x2: tx, y2: ty }));
        }
        var plate = s('g', { class: 'bm-zone-tag',
                             transform: 'translate(' + (tx - w / 2) + ' ' + (ty - h / 2) + ')' });
        plate.appendChild(s('rect', { x: 0, y: 0, width: w, height: h, rx: 7 }));
        plate.appendChild(s('text', { x: 10, y: 14, text: title }));
        if (sub) plate.appendChild(s('text', { x: 10, y: 27, class: 'bm-zone-sub', text: sub }));
        g.appendChild(plate);

        var AIR_NUDGE = { zone_1: [-38, -28], zone_2: [38, -28], zone_3: [-38, 28],
                          zone_4: [38, 28], zone_5: [0, -34] };
        var air = null;
        if (zone.air) {
          var an = AIR_NUDGE[zone.id] || [38, -28];
          var ax = xy[0] + an[0], ay = xy[1] + an[1];
          air = s('g', { class: 'bm-air', transform: 'translate(' + ax + ' ' + ay + ')' });
          air.appendChild(s('rect', { x: -7, y: -7, width: 14, height: 14, rx: 2,
                                      transform: 'rotate(45)',
                                      fill: zone.air.colour || '#7E9AA8' }));
          air.appendChild(s('title', { text: 'air ' + zone.air.value + ' · ' +
                                            (zone.air.category || '') }));
          g.appendChild(air);
        }

        var COUNT_NUDGE = { zone_1: [-40, 30], zone_2: [40, 30], zone_3: [-40, 30],
                            zone_4: [40, 30], zone_5: [0, 32] };
        var count = null;
        if (zone.complaints) {
          var cn = COUNT_NUDGE[zone.id] || [-46, 27];
          var cx = xy[0] + cn[0], cy = xy[1] + cn[1];
          count = s('g', { class: 'bm-count', transform: 'translate(' + cx + ' ' + cy + ')' });
          count.appendChild(s('circle', { r: 11 }));
          count.appendChild(s('text', { x: 0, y: 4, 'text-anchor': 'middle',
                                        text: String(zone.complaints) }));
          count.appendChild(s('title', { text: zone.complaints + ' complaints on record' }));
          g.appendChild(count);
        }

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

        zoneNodes[zone.id] = { group: g, blob: path, air: air, count: count, zone: zone };
        zoneLayer.appendChild(g);
      });
      applyMode();
    }

    function setMode(next) { mode = next; applyMode(); }
    function highlight(zoneId) {
      Object.keys(zoneNodes).forEach(function (id) {
        zoneNodes[id].group.classList.toggle('is-active', id === zoneId);
        zoneNodes[id].group.classList.toggle('is-dim', !!zoneId && id !== zoneId);
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
