/* components.js — shared rendering pieces. No page logic and no numbers of its own:
 * every value it paints is handed to it from an API response. Charts are drawn as plain
 * SVG so the app stays dependency-free and works with the network off.
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'on') Object.keys(value).forEach(function (ev) {
          node.addEventListener(ev, value[ev]);
        });
        else if (key.slice(0, 2) === 'da') node.setAttribute(key, value);
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    append(node, children);
    return node;
  }

  function s(tag, attrs, children) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    append(node, children);
    return node;
  }

  /* Nested arrays are legal anywhere a child list is built (case chips, timeline rows),
   * so flatten them instead of letting String() paint an object into the page. */
  function append(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) append(node, children[i]);
      return;
    }
    node.appendChild(typeof children === 'object' && children.nodeType
                     ? children : document.createTextNode(String(children)));
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* ---------------------------------------------------------------- labels */
  var BANDS = { Good: '#34A853', Acceptable: '#A8D08D', Poor: '#F4B400', Unsafe: '#EA4335' };
  /* The NAQI category names served by the backend (config/aqi.json) that mean "unhealthy".
     Matching a served label — no number is compared to a threshold in the browser. */
  var BAD_AQI = ['Poor', 'Very Poor', 'Severe'];
  var STATUS_CLASS = {
    Open: 'open', Investigating: 'investigating', 'Action Taken': 'action', Resolved: 'resolved'
  };
  var SEVERITY_CLASS = { Emergency: 'emergency', High: 'high', Medium: 'medium', Low: 'low' };

  function badge(text, cls, title) {
    return el('span', { class: 'badge' + (cls ? ' ' + cls : ''), title: title || null,
                        text: text === null || text === undefined ? '—' : text });
  }

  /* Colours always come from the payload (aqi.colour / wqi.colour); nothing is re-derived. */
  function bandBadge(wqi) {
    if (!wqi) return el('span', { class: 'badge plain', text: 'no sensor' });
    var node = badge(wqi.band + ' · ' + Number(wqi.score).toFixed(1), 'plain');
    node.style.background = (wqi.colour || BANDS[wqi.band] || '#EEF3F0') + '1a';
    node.style.borderColor = wqi.colour || BANDS[wqi.band] || '#D9E3DC';
    node.style.color = wqi.band === 'Good' || wqi.band === 'Acceptable' ? '#1F5E3F' : '#8B2018';
    node.title = wqi.override ? 'WQI override: ' + wqi.override : 'WQI from the server';
    return node;
  }
  function severity(row) { return badge(row.severity, SEVERITY_CLASS[row.severity]); }
  function statusBadge(status) { return badge(status, STATUS_CLASS[status] || 'plain'); }
  function scopeBadge(scope) {
    return badge(scope === 'BUILDING_SIDE' ? 'building-side' : 'municipal',
                 scope === 'BUILDING_SIDE' ? 'side' : 'plain',
                 'scope, from the server: ' + scope);
  }
  function overdueFlag(row) {
    /* Rendered, never recomputed — the server owns the 2 h rule. */
    if (!row.overdue) return null;
    return el('span', { class: 'overdue', title: 'High/Emergency case with no action for 2 h',
                        text: 'Overdue' });
  }

  function kv(key, valueNode) {
    return el('div', { class: 'kv' }, [el('div', { class: 'k', text: key }),
                                       typeof valueNode === 'string'
                                       ? el('div', { text: valueNode }) : valueNode]);
  }

  function section(title, sub, body, actions) {
    return el('section', { class: 'section' }, [
      el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-end' }, [
        el('div', {}, [el('h3', { text: title }), sub ? el('p', { class: 'muted small', text: sub }) : null]),
        actions ? el('div', { class: 'row' }, actions) : null
      ]),
      body
    ]);
  }

  function card(headline, body, cls) {
    return el('div', { class: 'card' + (cls ? ' ' + cls : '') },
              [headline ? el('h4', { text: headline }) : null, body]);
  }

  function kpi(label, value, meta, tone) {
    return el('div', { class: 'card kpi' }, [
      el('span', { class: 'label', text: label }),
      el('span', { class: 'value' + (tone ? ' ' + tone : ''), text: value }),
      el('span', { class: 'meta' }, Array.isArray(meta) ? meta : [meta || ''])
    ]);
  }

  function empty(message) { return el('div', { class: 'empty', text: message }); }
  function note(message, cls) { return el('div', { class: 'note' + (cls ? ' ' + cls : ''), text: message }); }
  function loading(text) { return el('p', { class: 'loading', text: text || 'loading…' }); }

  function errorBox(err) {
    var status = err && err.status ? err.status : 0;
    var detail = (err && (err.detail || err.message)) || 'something went wrong';
    return el('div', { class: 'error-box' }, [
      el('div', {}, [el('strong', { text: 'The server answered ' + (status || 'no response') + ' — ' }),
                     String(detail)]),
      err && err.requestId
        ? el('div', { class: 'small', style: 'margin-top:6px' },
            [el('code', { text: 'X-Request-Id: ' + err.requestId })])
        : null
    ]);
  }

  function table(columns, rows, opts) {
    opts = opts || {};
    var head = el('thead', {}, el('tr', {}, columns.map(function (c) {
      return el('th', { class: c.num ? 'num' : null, text: c.label, title: c.title || null });
    })));
    var body = el('tbody', {}, rows.map(function (row, i) {
      return el('tr', { class: opts.rowClass ? opts.rowClass(row, i) : null,
                        on: opts.onRow ? { click: function () { opts.onRow(row); } } : null,
                        style: opts.onRow ? 'cursor:pointer' : null },
                  columns.map(function (c) {
                    var value = c.get(row, i);
                    return el('td', { class: c.num ? 'num' : null },
                              value === null || value === undefined
                              ? [el('span', { class: 'muted', text: '—' })]
                              : [typeof value === 'object' && value.nodeType ? value
                                 : el('span', { class: c.cls, text: String(value) })]);
                  }));
    }));
    if (!rows.length) {
      return el('div', { class: 'card-table' }, [head, el('tbody', {},
        el('tr', {}, el('td', { colspan: columns.length, class: 'muted',
                                text: opts.empty || 'nothing here' })))]);
    }
    return el('div', { class: 'card-table scroll-x' }, [head, body]);
  }

  /* ---------------------------------------------------------------- charts */
  function scale(values, padTop) {
    var nums = [].concat.apply([], values.filter(Boolean));
    var min = Math.min.apply(null, nums.concat([0]));
    var max = Math.max.apply(null, nums.concat([1]));
    if (min === max) max = min + 1;
    if (padTop) max += (max - min) * 0.08;
    return { min: min, max: max };
  }

  function path(points) {
    return points.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); })
                 .join(' ');
  }

  /* Dual-axis line chart. Each series carries its own axis, colour and unit; bands, limit
     lines and the forecast crossing marker are drawn from the values the server sent. */
  function lineChart(cfg) {
    var W = cfg.width || 760, H = cfg.height || 250;
    var pad = { l: 46, r: cfg.dual ? 52 : 16, t: 16, b: 30 };
    var plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    var n = Math.max(1, (cfg.count || 1) - 1);
    var axes = { left: scale(cfg.series.filter(function (x) { return x.axis !== 'right'; })
                             .map(function (x) { return x.values; }), true),
                 right: scale(cfg.series.filter(function (x) { return x.axis === 'right'; })
                              .map(function (x) { return x.values; }), true) };
    if (cfg.zeroBase) { axes.left = { min: 0, max: axes.left.max }; }

    function xy(index, value, axis) {
      var sc = axes[axis === 'right' ? 'right' : 'left'];
      return [pad.l + (index / n) * plotW,
              pad.t + plotH - ((value - sc.min) / (sc.max - sc.min)) * plotH];
    }

    var svg = s('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H,
                         role: 'img', 'aria-label': cfg.label || 'line chart' });
    svg.appendChild(s('line', { class: 'axis', x1: pad.l, y1: pad.t + plotH,
                                x2: W - pad.r, y2: pad.t + plotH }));
    svg.appendChild(s('line', { class: 'axis', x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + plotH }));
    if (cfg.dual) {
      svg.appendChild(s('line', { class: 'axis', x1: W - pad.r, y1: pad.t,
                                  x2: W - pad.r, y2: pad.t + plotH }));
    }

    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = pad.t + plotH - f * plotH;
      svg.appendChild(s('line', { class: 'grid', x1: pad.l, y1: y, x2: W - pad.r, y2: y }));
      var sc = axes.left;
      svg.appendChild(s('text', { x: pad.l - 7, y: y + 3, 'text-anchor': 'end',
                                  text: (sc.min + f * (sc.max - sc.min)).toFixed(sc.max < 5 ? 2 : 0) }));
      if (cfg.dual) {
        var rc = axes.right;
        svg.appendChild(s('text', { x: W - pad.r + 7, y: y + 3,
                                    text: (rc.min + f * (rc.max - rc.min)).toFixed(rc.max < 5 ? 2 : 0) }));
      }
    });

    (cfg.bands || []).forEach(function (band) {
      var y1 = xy(0, band.high, band.axis || 'left')[1];
      var y2 = xy(0, band.low, band.axis || 'left')[1];
      svg.appendChild(s('rect', { class: 'band', x: pad.l, y: Math.min(y1, y2),
                                  width: plotW, height: Math.abs(y2 - y1) }));
      if (band.label) {
        svg.appendChild(s('text', { x: pad.l + 6, y: Math.min(y1, y2) - 4, class: 'cap',
                                    text: band.label }));
      }
    });

    (cfg.limits || []).forEach(function (limit) {
      var y = xy(0, limit.value, limit.axis || 'left')[1];
      svg.appendChild(s('line', { class: 'limit', x1: pad.l, y1: y, x2: W - pad.r, y2: y }));
      svg.appendChild(s('text', { x: W - pad.r - 4, y: y - 5, 'text-anchor': 'end',
                                  class: 'cap', text: limit.label }));
    });

    cfg.series.forEach(function (series) {
      var pts = [];
      for (var i = 0; i < series.values.length; i++) {
        var v = series.values[i];
        if (v === null || v === undefined) continue;
        pts.push(xy(series.startIndex === undefined ? i : i + series.startIndex, v, series.axis));
      }
      if (!pts.length) return;
      svg.appendChild(s('path', { class: 'line', d: path(pts), stroke: series.color,
                                  'stroke-dasharray': series.dash || null }));
      if (series.lastDot) {
        var last = pts[pts.length - 1];
        svg.appendChild(s('circle', { class: 'dot', cx: last[0], cy: last[1], r: 3.4,
                                      fill: series.color }));
      }
    });

    (cfg.markers || []).forEach(function (m) {
      var p = xy(m.index, m.value, m.axis || 'left');
      svg.appendChild(s('circle', { class: 'cross', cx: p[0], cy: p[1], r: 5,
                                    fill: 'none', stroke: '#EA4335', 'stroke-width': 2 }));
      svg.appendChild(s('circle', { cx: p[0], cy: p[1], r: 2, fill: '#EA4335' }));
      svg.appendChild(s('text', { x: p[0] + 8, y: p[1] - 8, class: 'cap', text: m.label }));
    });

    (cfg.xlabels || []).forEach(function (x) {
      var p = xy(x.index, axes.left.min);
      svg.appendChild(s('text', { x: p[0], y: pad.t + plotH + 16,
                                  'text-anchor': x.anchor || 'middle', text: x.text }));
    });
    return svg;
  }

  function legend(items) {
    return el('div', { class: 'legend-inline' }, items.map(function (i) {
      return el('span', {}, [el('i', { style: 'background:' + i.color }), i.label]);
    }));
  }

  function sparkline(values, color, height) {
    var W = 220, H = height || 34;
    var sc = scale([values], false);
    var n = Math.max(1, values.length - 1);
    var pts = values.map(function (v, i) {
      return [4 + (i / n) * (W - 8), H - 4 - ((v - sc.min) / ((sc.max - sc.min) || 1)) * (H - 8)];
    });
    var svg = s('svg', { class: 'spark', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none',
                         'aria-hidden': 'true' });
    svg.appendChild(s('path', { d: path(pts), fill: 'none', stroke: color || '#2F855A',
                                'stroke-width': 1.8 }));
    return svg;
  }

  function bars(items, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, items.map(function (i) { return i.value || 0; }).concat([1]));
    return el('div', { class: 'bars' }, items.map(function (item) {
      var track = el('div', { class: 'bar-track' },
                     el('div', { class: 'bar-fill',
                                 style: 'width:' + Math.min(100, (item.value / max) * 100)
                                        + '%;background:' + (item.color || 'var(--green-500)') }));
      return el('div', { class: 'b' }, [
        el('span', { text: item.label }), track,
        el('span', { class: 'num muted', text: opts.fmt ? opts.fmt(item) : item.shown })
      ]);
    }));
  }

  /* AQI gauge: the arc colour and category are the server's, not computed here. */
  function gauge(aqi, categories) {
    var value = aqi.value;
    var colour = aqi.colour || '#6B8278';
    var cap = 480;                                   // NAQI scale shown on the dial
    var frac = Math.max(0, Math.min(1, value / cap));
    var r = 54, cx = 70, cy = 66;
    function point(deg) {
      var rad = (180 - deg) * Math.PI / 180;
      return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
    }
    var arc = s('path', { d: 'M' + point(0).join(' ') + ' A' + r + ' ' + r + ' 0 0 1 '
                             + point(180 * frac).join(' '),
                          fill: 'none', stroke: colour, 'stroke-width': 12,
                          'stroke-linecap': 'round' });
    var back = s('path', { d: 'M' + point(0).join(' ') + ' A' + r + ' ' + r + ' 0 0 1 '
                              + point(180).join(' '),
                           fill: 'none', stroke: '#EDF3EF', 'stroke-width': 12 });
    var svg = s('svg', { viewBox: '0 0 140 84', width: '140', height: '84',
                         role: 'img', 'aria-label': 'AQI ' + value + ' ' + aqi.category });
    svg.appendChild(back);
    svg.appendChild(arc);
    svg.appendChild(s('text', { x: cx, y: cy - 6, 'text-anchor': 'middle',
                                style: 'font-size:20px;font-weight:700;fill:#1B2B22',
                                /* the served NAQI, printed as sent — a 312.5 must not read 313 */
                                text: value }));
    svg.appendChild(s('text', { x: cx, y: cy + 10, 'text-anchor': 'middle',
                                style: 'font-size:9.5px;fill:#6B8278', text: aqi.category }));
    var host = el('div', { class: 'gauge-host' }, [svg,
      el('div', { class: 'small muted', text: 'driving pollutant ' + aqi.driving_pollutant })]);
    if (categories) {
      host.appendChild(el('div', { class: 'small muted', title: categories.map(function (c) {
        return c.name + ' ' + c.min + '–' + c.max + ' ' + c.colour;
      }).join(' · ') }, ['scale from /api/air']));
    }
    return host;
  }

  /* ---------------------------------------------------------------- shell bits */
  var ui = {
    errorBox: errorBox,
    lastRequest: function (id) {
      var node = document.getElementById('request-id');
      if (node) node.textContent = id;
    },
    toast: function (message, kind) {
      var host = document.getElementById('toasts');
      var toast = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: message });
      host.appendChild(toast);
      setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () { host.removeChild(toast); }, 220);
      }, kind === 'err' ? 6000 : 3600);
    },
    openPanel: function (title, body, fullHref) {
      var host = document.getElementById('panel');
      document.getElementById('panel-title').textContent = title;
      clear(document.getElementById('panel-body')).appendChild(body);
      var link = document.getElementById('panel-full');
      if (fullHref) { link.setAttribute('href', fullHref); link.hidden = false; } else { link.hidden = true; }
      host.hidden = false;
    },
    closePanel: function () { document.getElementById('panel').hidden = true; }
  };

  document.addEventListener('click', function (ev) {
    if (ev.target.id === 'panel-close' || (ev.target.id === 'panel' && ev.target === document.getElementById('panel'))) {
      ui.closePanel();
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') ui.closePanel();
  });

  NIRI.ui = ui;
  NIRI.el = el; NIRI.s = s; NIRI.clear = clear; NIRI.append = append;
  NIRI.badge = badge; NIRI.bandBadge = bandBadge; NIRI.severity = severity;
  NIRI.statusBadge = statusBadge; NIRI.scopeBadge = scopeBadge; NIRI.overdueFlag = overdueFlag;
  NIRI.kv = kv; NIRI.section = section; NIRI.card = card; NIRI.kpi = kpi; NIRI.table = table;
  NIRI.empty = empty; NIRI.note = note; NIRI.loading = loading; NIRI.errorBox = errorBox;
  NIRI.lineChart = lineChart; NIRI.legend = legend; NIRI.sparkline = sparkline;
  NIRI.bars = bars; NIRI.gauge = gauge;
  NIRI.BANDS = BANDS;
  /* true when a served NAQI category name is one of the unhealthy bands. */
  NIRI.isBadAqi = function (category) { return BAD_AQI.indexOf(category) >= 0; };
}(window.NIRI));
