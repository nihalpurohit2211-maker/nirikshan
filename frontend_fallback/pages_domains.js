/* Air Quality, Land Reports and Reports (docs/FRONTEND_SPEC.md §5, rows 4-6).
   Every number on these pages is read from a served field; the UI computes no index,
   no category and no verdict. */
(function (NIRI) {
  'use strict';

  var el = NIRI.el, api = NIRI.api, ui = NIRI.ui;
  var pages = NIRI.pages;

  function nodeLink(id, label) { return el('a', { href: '#/nodes/' + id, class: 'link', text: label || id }); }
  function caseLink(id, label) { return el('a', { href: '#/cases/' + id, class: 'link', text: label || id }); }

  /* ------------------------------------------------------------------------ air */
  var POLLUTANTS = [
    { key: 'pm25', label: 'PM2.5', unit: 'µg/m³' },
    { key: 'pm10', label: 'PM10', unit: 'µg/m³' },
    { key: 'no2', label: 'NO₂', unit: 'µg/m³' },
    { key: 'so2', label: 'SO₂', unit: 'µg/m³' },
    { key: 'o3', label: 'O₃', unit: 'µg/m³' },
    { key: 'co', label: 'CO', unit: 'mg/m³' }
  ];

  function pollutantTable(latest) {
    return NIRI.table([
      { label: 'pollutant', get: function (p) { return p.label; } },
      { label: 'reading', num: true, get: function (p) { return latest[p.key]; } },
      { label: 'unit', get: function (p) { return p.unit; } },
      { label: 'sub-index', num: true,
        get: function (p) { return latest.__sub && latest.__sub[p.label] ? latest.__sub[p.label] : null; } }
    ], POLLUTANTS);
  }

  function stationCard(station, categories, onHistory, isWorst) {
    var aqi = station.aqi || {};
    var sub = aqi.subindices || {};
    var latest = Object.assign({ __sub: indexByPollutant(sub) }, station.latest || {});
    return el('div', { class: 'card station' + (isWorst ? ' is-worst' : '') }, [
      el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start' }, [
        el('div', {}, [el('h4', { text: station.name }),
          el('p', { class: 'small muted' }, [nodeLink(station.id, station.id),
            ' · ' + (station.zone_id || 'no ward')])]),
        isWorst ? NIRI.badge('worst', 'high', 'the station /api/air names as worst') : null
      ]),
      NIRI.gauge(aqi, categories),
      el('p', { class: 'small muted' }, 'reading at ' + api.time(station.latest.timestamp)
        + ' · NAQI from the served sub-indices'),
      NIRI.bars(POLLUTANTS.filter(function (p) { return sub[p.label]; }).map(function (p) {
        return { label: p.label, value: sub[p.label].subindex,
                 shown: sub[p.label].subindex + ' @ ' + sub[p.label].concentration,
                 color: sub[p.label].subindex >= (aqi.value || 0) ? (aqi.colour || '#EA4335') : '#9FB3A8' };
      })),
      pollutantTable(latest),
      el('div', { class: 'actions', style: 'margin-top:10px' }, [
        el('button', { class: 'ghost', text: 'monitor history', on: { click: function () { onHistory(station); } } })
      ])
    ]);
  }

  function indexByPollutant(subindices) {
    var out = {};
    Object.keys(subindices).forEach(function (label) { out[label] = subindices[label].subindex; });
    return out;
  }

  function historyPanel(station) {
    var host = el('div');
    host.appendChild(NIRI.loading('loading the monitor series…'));
    return api.stationReadings(station.id).then(function (out) {
      NIRI.clear(host);
      var rows = out.readings || [];
      var step = Math.max(1, Math.round(rows.length / 160));
      var kept = rows.filter(function (r, i) { return i % step === 0 || i === rows.length - 1; });
      host.appendChild(el('div', {}, [
        el('h4', { text: out.name + ' — ' + out.hours + ' hours' }),
        el('p', { class: 'small muted' }, rows.length + ' hourly rows from ' + out.station_id
          + ', thinned to ' + kept.length + '. The NAQI line is the server’s, not a re-computation.'),
        NIRI.lineChart({
          height: 240, count: kept.length, zeroBase: true, dual: true,
          series: [
            { name: 'NAQI', color: '#9B1C1C', values: kept.map(function (r) { return r.aqi; }), axis: 'left', lastDot: true },
            { name: 'PM10', color: '#2F855A', values: kept.map(function (r) { return r.pm10; }), axis: 'right' }
          ],
          xlabels: [
            { index: 0, text: api.time(kept[0].timestamp), anchor: 'start' },
            { index: kept.length - 1, text: 'now', anchor: 'end' }
          ],
          label: 'NAQI and PM10 history'
        }),
        NIRI.legend([{ color: '#9B1C1C', label: 'NAQI (left)' }, { color: '#2F855A', label: 'PM10 µg/m³ (right)' }]),
        el('div', { style: 'margin-top:12px' }, NIRI.table([
          { label: 'when', get: function (r) { return api.time(r.timestamp); } },
          { label: 'NAQI', num: true, get: function (r) { return r.aqi; } },
          { label: 'PM2.5', num: true, get: function (r) { return r.pm25; } },
          { label: 'PM10', num: true, get: function (r) { return r.pm10; } },
          { label: 'O₃', num: true, get: function (r) { return r.o3; } }
        ], rows.slice(-12).reverse(), { empty: 'no readings served for this monitor' }))
      ]));
      return host;
    });
  }

  pages.air = {
    title: 'Air Quality',
    sub: 'NAQI per monitor, the bands the server publishes, and the 24 h PM projection',
    render: function (host) {
      NIRI.clear(host);
      host.appendChild(NIRI.loading('reading the monitors…'));
      Promise.all([api.air(), api.cases()]).then(function (out) {
        var air = out[0], cases = out[1].cases;
        NIRI.clear(host);

        var worst = air.worst || {};
        var forecast = air.pm_forecast || {};
        var projected = (forecast.projected || []).map(function (v) { return typeof v === 'number' ? v : v.value; });

        host.appendChild(el('div', { class: 'grid cols-3' }, [
          NIRI.kpi('worst monitor', worst.aqi ? worst.aqi.value.toFixed(1) : '—',
                   [worst.name || '—', worst.aqi ? NIRI.badge(worst.aqi.category, 'high') : null,
                    worst.aqi ? NIRI.badge('drives ' + worst.aqi.driving_pollutant, 'plain') : null], 'bad'),
          NIRI.kpi('monitors reporting', String(air.stations.length),
                   'every station node in /api/air, none hidden'),
          NIRI.kpi('projected ' + (forecast.parameter || '—'),
                   projected.length ? projected[projected.length - 1].toFixed(1) : '—',
                   [el('span', { class: 'small', text: 'in ' + (forecast.horizon_hours || 0) + ' h from '
                                          + forecast.current }),
                    NIRI.badge('+' + forecast.slope_per_hour + ' per hour', 'plain')])
        ]));

        /* 24 h projection for the worst monitor — the only forecast /api/air serves. */
        var marker = null;
        host.appendChild(NIRI.section('24-hour PM projection',
          'GET /api/air · pm_forecast for ' + forecast.station_id + ' — a straight decay-and-slope '
          + 'projection of the served series; this endpoint publishes no NAQI limit, so no crossing '
          + 'is claimed',
          el('div', { class: 'card' }, [
            el('div', { class: 'row' }, [
              NIRI.badge('now ' + forecast.current + ' µg/m³ ' + (forecast.parameter || '').toUpperCase(), 'plain'),
              NIRI.badge('slope ' + forecast.slope_per_hour + ' µg/m³ per hour', 'plain'),
              nodeLink(forecast.station_id, api.nodeName(forecast.station_id))
            ]),
            NIRI.lineChart({
              height: 210, count: projected.length, zeroBase: false, markers: marker,
              series: [{ name: (forecast.parameter || 'pm').toUpperCase(), color: worst.aqi ? worst.aqi.colour : '#EA4335',
                         values: projected, lastDot: true }],
              xlabels: [{ index: 0, text: 'now', anchor: 'start' },
                        { index: projected.length - 1, text: '+' + forecast.horizon_hours + ' h', anchor: 'end' }],
              label: '24 hour PM projection'
            }),
            el('p', { class: 'small muted' }, projected.length
              ? 'the last projected value is ' + projected[projected.length - 1] + ' µg/m³ — every point '
                + 'on this line came from the response, none was interpolated'
              : 'no projection served right now')
          ])));

        var onHistory = function (station) {
          var box = el('div');
          box.appendChild(NIRI.loading('loading…'));
          ui.openPanel(station.name + ' — monitor history', box);
          historyPanel(station).then(function (filled) {
            NIRI.clear(box);
            box.appendChild(filled);
          }).catch(function (err) { NIRI.clear(box); box.appendChild(ui.errorBox(err)); });
        };

        host.appendChild(NIRI.section('Every monitor',
          'the gauge arc and its category colour are the server’s; the sub-index bars are the served '
          + 'sub-indices, and the one that drives the NAQI is highlighted',
          el('div', { class: 'station-grid' }, air.stations.map(function (station) {
            var isWorst = worst.id === station.id;
            return stationCard(station, air.categories, onHistory, isWorst);
          })),
          [el('span', { class: 'small muted', text: 'bands: ' + (air.categories || []).map(function (c) {
            return c.name; }).join(' · ') })]));

        var dust = cases.filter(function (c) { return c.domain === 'air'; });
        host.appendChild(NIRI.section('The dust case this became',
          'complaints at a monitor cluster into an air case the same way water complaints do',
          dust.length
            ? el('div', { class: 'grid cols-2' }, dust.map(function (c) {
                return el('div', { class: 'card' }, [
                  el('div', { class: 'row' }, [caseLink(c.id, c.id), NIRI.severity(c), NIRI.statusBadge(c.status),
                                               NIRI.overdueFlag(c)]),
                  el('h4', { text: c.title }),
                  el('p', { class: 'small muted' }, 'rule: ' + (c.evidence.rule || '—')),
                  el('div', { class: 'prox' }, [el('b', { text: String(c.evidence.aqi) }),
                    el('span', { class: 'small muted', text: 'NAQI in the case evidence · '
                      + (c.evidence.complaints || []).length + ' reports' })]),
                  el('div', { class: 'chips', style: 'margin-top:8px' },
                     (c.evidence.complaints || []).map(function (id) {
                       return el('code', { class: 'chip', text: id }); })),
                  el('div', { class: 'actions', style: 'margin-top:10px' }, [caseLink(c.id, 'open the case →')])
                ]);
              }))
            : NIRI.empty('no air case in the sample')));
      }).catch(function (err) { NIRI.clear(host); host.appendChild(ui.errorBox(err)); });
    }
  };

  /* ----------------------------------------------------------------------- land */
  var LAND_CATEGORIES = ['Open waste dump', 'Soil erosion', 'Construction debris',
                         'Blocked drain', 'Dead animal', 'Other'];

  function proximityBlock(prox, weights) {
    if (!prox) return NIRI.empty('no proximity served for this site');
    var host = el('div');
    host.appendChild(el('div', { class: 'prox' }, [
      el('b', { text: String(prox.score) }),
      el('span', { class: 'small muted', text: (prox.factors || []).length + ' factors · '
                   + (weights ? 'capped at ' + weights.cap : 'weights from /api/land/reports') })
    ]));
    host.appendChild(el('ul', { class: 'factors' }, (prox.factors || []).map(function (f) {
      return el('li', {}, [
        NIRI.badge(f.met ? '+' + f.points : 'not met', f.met ? 'high' : 'plain'),
        ' ' + f.label,
        f.days ? el('span', { class: 'small muted', text: ' (' + f.days + ' days observed)' }) : null,
        f.nearest ? el('div', { class: 'small muted', text: 'nearest ' + f.nearest.kind.replace(/_/g, ' ')
          + ' “' + f.nearest.feature + '” at ' + Math.round(f.nearest.distance_m) + ' m' }) : null
      ]);
    })));
    return host;
  }

  function reportCard(report, weights, casesById) {
    var linked = (report.cross_link && casesById[report.cross_link.water_node]) || [];
    return el('div', { class: 'card report-card' }, [
      report.image_url
        ? el('img', { src: report.image_url, alt: report.category + ' photo',
                      loading: 'lazy',
                      on: { error: function (ev) {
                        ev.target.outerHTML = '<div class="noimg">photo stored at<br>'
                          + report.image_path + '</div>';
                      } } })
        : el('div', { class: 'noimg', html: 'no photo<br>attached' }),
      el('div', {}, [
        el('div', { class: 'row' }, [
          el('code', { class: 'chip', text: report.id }),
          NIRI.badge(report.category, 'plain'),
          NIRI.statusBadge(report.status),
          nodeLink(report.node_id, api.nodeName(report.node_id))
        ]),
        el('p', { style: 'margin:8px 0' }, '“' + report.text + '”'),
        el('div', { class: 'row' }, [
          report.duration_days !== null && report.duration_days !== undefined
            ? NIRI.badge(report.duration_days + ' days', 'medium') : NIRI.badge('no duration given', 'plain'),
          report.area_m2 !== null && report.area_m2 !== undefined
            ? NIRI.badge(report.area_m2 + ' m²', 'medium') : NIRI.badge('no area given', 'plain'),
          el('span', { class: 'small muted', text: 'reported ' + api.time(report.timestamp)
                                   + ' · ' + api.since(report.timestamp) })
        ]),
        el('div', { style: 'margin-top:10px' }, proximityBlock(report.proximity, weights)),
        report.land_meta ? el('p', { class: 'small muted', style: 'margin-top:8px' },
          (report.land_meta.land_type || 'site') + ' — ' + (report.land_meta.note || 'no note served')) : null,
        report.cross_link ? el('div', { class: 'xlink' }, [
          el('strong', { text: 'this dump is in the water story:' }),
          nodeLink(report.cross_link.water_node, api.nodeName(report.cross_link.water_node)),
          el('span', { text: report.cross_link.direction + ' turbidity (trend '
                             + report.cross_link.trend + ')' }),
          linked.length ? el('span', {}, linked.map(function (id, i) {
            return [i ? ', ' : ' → ', caseLink(id, id)]; })) : null
        ]) : null,
        el('div', { class: 'actions', style: 'margin-top:10px' }, [
          nodeLink(report.node_id, 'site detail →'),
          el('a', { class: 'link', href: '#/map?n=' + report.node_id, text: 'show on map' })
        ])
      ])
    ]);
  }

  function landIntake(network, onDone) {
    var sites = network.nodes.filter(function (n) { return n.type === 'land_site'; });
    var site = el('select', {}, sites.map(function (n) {
      return el('option', { value: n.id, text: n.name + ' (' + n.id + ')' });
    }));
    var category = el('select', {}, LAND_CATEGORIES.map(function (c) {
      return el('option', { value: c, text: c });
    }));
    var text = el('textarea', { rows: 3, placeholder: 'Garbage pile beside the school compound since 12 days' });
    var duration = el('input', { type: 'number', min: 0, step: 1, placeholder: 'days' });
    var area = el('input', { type: 'number', min: 0, step: 1, placeholder: 'm²' });
    var imageState = { data: null };
    var drop = el('div', { class: 'drop', text: 'optional photo — jpg/png, read in this tab only' });
    var fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png', style: 'display:none' });
    var result = el('div', { style: 'margin-top:14px' });
    var submit = el('button', { class: 'primary', text: 'File the land report' });

    function readImage(file) {
      if (!file) return;
      if (!/image\/(jpeg|png)/.test(file.type)) { ui.toast('the API accepts jpg or png only', 'err'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        imageState.data = String(reader.result);
        NIRI.clear(drop);
        drop.appendChild(el('img', { src: reader.result, alt: file.name }));
        drop.appendChild(el('div', { class: 'small', text: file.name + ' — click to change' }));
      };
      reader.readAsDataURL(file);
    }
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('dragover', function (ev) { ev.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (ev) {
      ev.preventDefault(); drop.classList.remove('over');
      readImage(ev.dataTransfer.files && ev.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', function () { readImage(fileInput.files[0]); });

    submit.addEventListener('click', function () {
      var body = { node_id: site.value, category: category.value, text: text.value.trim() };
      if (duration.value) body.duration_days = Number(duration.value);
      if (area.value) body.area_m2 = Number(area.value);
      if (imageState.data) body.image = imageState.data;
      if (!body.text) { ui.toast('describe what is on the ground', 'err'); return; }
      submit.disabled = true;
      NIRI.clear(result);
      result.appendChild(NIRI.loading('filing and scoring proximity…'));
      api.landReport(body).then(function (out) {
        NIRI.clear(result);
        result.appendChild(el('div', { class: 'draft-card' }, [
          el('div', { class: 'stamp-row' }, [
            NIRI.badge(out.complaint.id, 'plain'), NIRI.statusBadge(out.complaint.status),
            el('span', { class: 'small muted', text: 'at ' + out.complaint.timestamp }),
            out.ai ? NIRI.badge('assistant: ' + out.ai, 'plain') : null
          ]),
          el('div', { class: 'row' }, [
            el('strong', { class: 'small', text: 'routed to: ' }),
            NIRI.badge(out.routed_to || 'no routing served', 'medium'),
            out.vision ? NIRI.badge(out.vision.analysed ? 'photo read' : 'photo: metadata only',
                                    'plain', out.vision.note) : null
          ]),
          proximityBlock(out.proximity, null),
          el('p', { class: 'small muted', style: 'margin-top:8px' },
            'the score is config/rules.json applied by the server — the form above only reported '
            + 'days and area'),
          out.cross_link ? el('div', { class: 'xlink' }, [
            el('strong', { text: 'cross-link:' }),
            nodeLink(out.cross_link.water_node, api.nodeName(out.cross_link.water_node)),
            el('span', { text: out.cross_link.direction + ' turbidity (trend ' + out.cross_link.trend + ')' })
          ]) : el('p', { class: 'small muted' }, 'no water cross-link for this site'),
          el('div', { style: 'margin-top:10px' }, [
            el('h4', { text: 'cases it joined' }),
            (out.cluster.created.length + out.cluster.updated.length)
              ? el('div', { class: 'chips' }, [].concat(out.cluster.created, out.cluster.updated)
                    .map(function (id) { return caseLink(id, id); }))
              : NIRI.empty('no case changed')
          ])
        ]));
        ui.toast(out.complaint.id + ' filed — proximity ' + out.proximity.score, 'ok');
        if (onDone) onDone();
      }).catch(function (err) {
        NIRI.clear(result);
        result.appendChild(ui.errorBox(err));
        ui.toast(err.detail, 'err');
      }).then(function () { submit.disabled = false; });
    });

    return el('div', { class: 'card' }, [
      el('h3', { text: 'File a land report' }),
      el('p', { class: 'small muted' }, 'POST /api/land/reports — the photo is sent as a data URL and '
        + 'written to data/images/ by the server; duration and area feed the proximity score.'),
      el('div', { class: 'grid cols-2' }, [
        el('div', { class: 'field' }, [el('label', { text: 'site' }), site,
          el('p', { class: 'hint' }, sites.length + ' land sites in /api/network')]),
        el('div', { class: 'field' }, [el('label', { text: 'category' }), category])
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'what a resident reported' }), text]),
      el('div', { class: 'grid cols-2' }, [
        el('div', { class: 'field' }, [el('label', { text: 'days standing' }), duration,
          el('p', { class: 'hint' }, '≥ ' + 7 + ' days scores the duration factor')]),
        el('div', { class: 'field' }, [el('label', { text: 'area (m²)' }), area])
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'photo (optional)' }), drop, fileInput]),
      el('div', { class: 'actions' }, [submit,
        el('span', { class: 'small muted', text: 'creates a complaint row in the land domain' })]),
      result
    ]);
  }

  pages.land = {
    title: 'Land Reports',
    sub: 'photo-reported dumps and erosion, scored by what is nearby',
    render: function (host) {
      NIRI.clear(host);
      host.appendChild(NIRI.loading('reading the land reports…'));
      function load() {
        Promise.all([api.land(), api.cases(), api.network()]).then(function (out) {
          var land = out[0], cases = out[1].cases, network = out[2];
          NIRI.clear(host);

          var casesByNode = {};
          cases.forEach(function (c) {
            var node = c.evidence && c.evidence.shared_node;
            if (!node) return;
            (casesByNode[node] = casesByNode[node] || []).push(c.id);
          });

          host.appendChild(el('div', { class: 'grid cols-3' }, [
            NIRI.kpi('land reports', String(land.count), 'rows served by GET /api/land/reports'),
            NIRI.kpi('with a photo', String(land.reports.filter(function (r) { return r.image_url; }).length),
                     'image_url points at /data/images/, served by the same process'),
            NIRI.kpi('with a water link', String(land.reports.filter(function (r) { return r.cross_link; }).length),
                     'erosion whose runoff shows up in a reservoir’s turbidity')
          ]));

          var eroding = land.reports.filter(function (r) { return r.cross_link; });
          if (eroding.length) {
            host.appendChild(NIRI.section('The cross-link that matters',
              'a dump is not only a dump: the server links erosion upstream of a water node',
              el('div', { class: 'grid cols-2' }, eroding.map(function (r) {
                var cl = r.cross_link;
                return el('div', { class: 'xlink' }, [
                  el('code', { class: 'chip', text: r.id }),
                  el('span', { text: r.category + ' at ' + api.nodeName(r.node_id) + ' →' }),
                  nodeLink(cl.water_node, api.nodeName(cl.water_node)),
                  el('span', { text: cl.direction + ' turbidity, trend ' + cl.trend }),
                  (casesByNode[cl.water_node] || []).length
                    ? el('span', {}, ['· cases on that node: ',
                        (casesByNode[cl.water_node] || []).map(function (id, i) {
                          return [i ? ', ' : '', caseLink(id, id)]; })])
                    : el('span', { class: 'small muted', text: '· no case on that water node yet' })
                ]);
              }))));
          }

          var grid = el('div', { class: 'grid cols-2', style: 'align-items:start' }, [
            landIntake(network, function () { setTimeout(load, 600); }),
            el('div', { class: 'card' }, [
              el('h3', { text: 'How the proximity score is built' }),
              el('p', { class: 'small muted' }, 'these weights are served by GET /api/land/reports — '
                + 'they are config/rules.json, shown so the score is explainable, not magic'),
              NIRI.table([
                { label: 'factor', get: function (w) { return w.label; } },
                { label: 'threshold', num: true, get: function (w) { return w.value; } },
                { label: 'points', num: true, get: function (w) { return w.points; } }
              ], weightRows(land.weights))
            ])
          ]);
          host.appendChild(grid);

          host.appendChild(NIRI.section('Every report',
            'GET /api/land/reports — sorted as the server returns it, newest first',
            el('div', { class: 'grid cols-2', style: 'align-items:start' },
              land.reports.map(function (r) { return reportCard(r, land.weights, casesByNode); }))));
        }).catch(function (err) { NIRI.clear(host); host.appendChild(ui.errorBox(err)); });
      }
      load();
    }
  };

  function weightRows(w) {
    if (!w) return [];
    return [
      { label: 'near a school', value: w.school_m + ' m', points: w.w_school },
      { label: 'near a water body', value: w.water_body_m + ' m', points: w.w_water },
      { label: 'near a main road', value: w.main_road_m + ' m', points: w.w_road },
      { label: 'standing longer than', value: w.w_duration_days + ' days', points: w.w_duration },
      { label: 'cap', value: w.cap, points: 'max score' }
    ];
  }

  /* -------------------------------------------------------------------- reports */
  var FUNNEL = ['Open', 'Investigating', 'Action Taken', 'Resolved'];

  pages.reports = {
    title: 'Reports',
    sub: 'the ward picture per domain, the case funnel, and the daily summary a human signs',
    render: function (host) {
      NIRI.clear(host);
      host.appendChild(NIRI.loading('loading the reporting payloads…'));
      Promise.all([api.overview(), api.cases(), api.complaints(), api.air(), api.land()])
      .then(function (out) {
        var overview = out[0], cases = out[1].cases, complaints = out[2].complaints;
        NIRI.clear(host);

        /* one KPI row per domain — counts of served rows, nothing derived */
        ['water', 'air', 'land'].forEach(function (domain) {
          var inDomain = cases.filter(function (c) { return c.domain === domain; });
          var rows = complaints.filter(function (c) { return c.domain === domain; });
          var host2 = el('div', { class: 'card tight' }, [
            el('div', { class: 'row', style: 'gap:14px;align-items:center' }, [
              el('strong', { text: domain }),
              NIRI.badge(inDomain.length + ' cases', inDomain.length ? 'plain' : 'low'),
              NIRI.badge(rows.length + ' reports', 'plain'),
              el('span', { class: 'small muted', text: inDomain.length
                ? 'worst severity ' + worstSeverity(inDomain) : 'no case open in this domain' }),
              el('span', { style: 'margin-left:auto' }, domain === 'water'
                ? NIRI.badge('triage ' + overview.triage.filter(function (t) { return t.domain === 'water'; }).length, 'plain')
                : domain === 'air' ? NIRI.badge('NAQI ' + (overview.kpis.worst_aqi
                                          ? overview.kpis.worst_aqi.value : '—'), 'plain')
                                  : NIRI.badge(out[4].count + ' sites', 'plain'))
            ])
          ]);
          host.appendChild(host2);
        });

        /* the funnel, in the order the workflow moves */
        var counts = {};
        cases.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
        var keys = FUNNEL.filter(function (s) { return counts[s]; })
          .concat(Object.keys(counts).filter(function (s) { return FUNNEL.indexOf(s) < 0; }));
        var overdue = cases.filter(function (c) { return c.overdue; });
        host.appendChild(NIRI.section('Case funnel',
          'status counts straight from GET /api/cases · demo clock ' + overview.demo_now,
          el('div', { class: 'grid cols-2', style: 'align-items:start' }, [
            el('div', {}, NIRI.bars(keys.map(function (s) {
              return { label: s, value: counts[s], shown: String(counts[s]), color: barColour(s) };
            }))),
            el('div', {}, [
              el('div', { class: 'row' }, [
                NIRI.kpi('open cases', String(overview.kpis.open_cases), 'cases not Resolved'),
                NIRI.kpi('overdue', String(overdue.length),
                         'rendered from the server’s `overdue` flag, never recomputed here')
              ]),
              el('p', { class: 'small muted', style: 'margin-top:10px' },
                'at the seeded clock nothing is 2 h actionless yet, because every case is created at '
                + 'the demo clock — the badge appears the moment the clock passes a case'),
              el('div', { style: 'margin-top:10px' }, NIRI.table([
                { label: 'case', get: function (c) { return caseLink(c.id, c.id); } },
                { label: 'status', get: function (c) { return NIRI.statusBadge(c.status); } },
                { label: 'severity', get: function (c) { return NIRI.severity(c); } },
                { label: 'last action', get: function (c) { return api.time(c.last_action); } },
                { label: 'flag', get: function (c) { return NIRI.overdueFlag(c); } }
              ], overview.triage.slice(0, 8), { empty: 'no open case in the sample' }))
            ])
          ])));

        /* the daily summary: draft, labelled, and signed on the case it summarises */
        var draftHost = el('div');
        draftHost.appendChild(NIRI.empty('no summary generated in this view yet — press the button'));
        var generate = el('button', { class: 'primary', text: 'Generate daily summary' });
        generate.addEventListener('click', function () {
          generate.disabled = true;
          NIRI.clear(draftHost);
          draftHost.appendChild(NIRI.loading('writing the summary…'));
          api.daily().then(function (out) {
            NIRI.clear(draftHost);
            draftHost.appendChild(summaryCard(out, cases));
            ui.toast('daily summary drafted as ' + out.status, 'ok');
          }).catch(function (err) {
            NIRI.clear(draftHost);
            draftHost.appendChild(ui.errorBox(err));
            ui.toast(err.detail, 'err');
          }).then(function () { generate.disabled = false; });
        });
        host.appendChild(NIRI.section('Daily summary',
          'POST /api/reports/daily — the text is the assistant’s, the numbers are /api/overview’s',
          draftHost, [generate, el('span', { class: 'small muted', text: 'nothing is sent anywhere' })]));

        host.appendChild(NIRI.section('Sign-off queue',
          'the daily summary is support text; the artefact a human signs is each case advisory. '
          + 'These buttons call the same endpoints as the case page.',
          signoffList(cases)));
      }).catch(function (err) { NIRI.clear(host); host.appendChild(ui.errorBox(err)); });
    }
  };

  function worstSeverity(rows) {
    var order = ['Emergency', 'High', 'Medium', 'Low'];
    for (var i = 0; i < order.length; i++) {
      if (rows.some(function (c) { return c.severity === order[i]; })) return order[i];
    }
    return '—';
  }
  function barColour(status) {
    return status === 'Action Taken' ? '#34A853' : status === 'Resolved' ? '#2F855A'
         : status === 'Investigating' ? '#F4B400' : status === 'NEW' ? '#EA4335' : '#EA4335';
  }

  function summaryCard(out, cases) {
    var snap = out.snapshot || {};
    var k = snap.kpis || {};
    return el('div', { class: 'draft-card' }, [
      el('div', { class: 'stamp-row' }, [
        el('span', { class: 'draft-stamp', text: 'DRAFT — ' + out.status + ', not sent' }),
        NIRI.badge('written by ' + (out.ai || 'offline') + ' provider', 'plain'),
        el('span', { class: 'small muted', text: 'snapshot at ' + snap.demo_now })
      ]),
      el('p', { class: 'draft-text', text: out.text }),
      el('div', { class: 'grid cols-4', style: 'margin-top:12px' }, [
        NIRI.kpi('open cases', String(k.open_cases != null ? k.open_cases : '—'), 'from the snapshot'),
        NIRI.kpi('worst WQI', k.worst_wqi ? k.worst_wqi.score.toFixed(1) : '—',
                 [k.worst_wqi ? k.worst_wqi.name : '', k.worst_wqi ? NIRI.bandBadge(k.worst_wqi) : null]),
        NIRI.kpi('worst NAQI', k.worst_aqi ? k.worst_aqi.value.toFixed(0) : '—',
                 [k.worst_aqi ? k.worst_aqi.name : '',
                  k.worst_aqi ? NIRI.badge(k.worst_aqi.category, 'plain') : null]),
        NIRI.kpi('complaints 24 h', String(k.complaints_24h != null ? k.complaints_24h : '—'), 'window from config')
      ]),
      el('details', { style: 'margin-top:12px' }, [
        el('summary', { class: 'small', text: 'the triage list the summary was written from' }),
        NIRI.table([
          { label: 'case', get: function (c) { return caseLink(c.id, c.id); } },
          { label: 'domain', get: function (c) { return c.domain; } },
          { label: 'scope', get: function (c) { return NIRI.scopeBadge(c.scope); } },
          { label: 'title', get: function (c) { return c.title; } },
          { label: 'reports', num: true, get: function (c) { return (c.complaints || []).length; } }
        ], snap.triage || [])
      ]),
      el('p', { class: 'small muted', style: 'margin-top:10px' }, out.disclaimer)
    ]);
  }

  function signoffList(cases) {
    var open = cases.filter(function (c) { return c.status !== 'Resolved'; });
    if (!open.length) return NIRI.empty('every case in the sample is resolved');
    return el('div', { class: 'grid cols-2', style: 'align-items:start' }, open.map(function (c) {
      var actor = el('input', { value: 'Officer R. Rao' });
      var statusLabel = NIRI.statusBadge(c.status);
      var log = el('div', { class: 'small muted', style: 'margin-top:6px' });
      var draftBtn = el('button', { class: 'ghost', text: 'Draft advisory' });
      var approveBtn = el('button', { class: 'primary', text: 'Approve', disabled: true });
      draftBtn.addEventListener('click', function () {
        draftBtn.disabled = true;
        api.draft(c.id).then(function (out) {
          approveBtn.disabled = false;
          log.textContent = 'drafted as ' + out.status + ' by the ' + out.ai + ' provider — '
            + 'the wording is support text, the severity and status come from the rules.';
          ui.toast(c.id + ' drafted', 'ok');
        }).catch(function (err) { log.textContent = err.detail; ui.toast(err.detail, 'err'); })
          .then(function () { draftBtn.disabled = false; });
      });
      approveBtn.addEventListener('click', function () {
        approveBtn.disabled = true;
        api.approve(c.id, { actor: actor.value || 'Officer', role: 'Ward Officer' }).then(function (out) {
          approveBtn.textContent = 'Approved';
          log.textContent = 'signed by ' + out.approved_by + ' · case status ' + out.case.status;
          NIRI.clear(statusLabel);
          statusLabel.appendChild(NIRI.statusBadge(out.case.status));
          ui.toast(c.id + ' approved — ' + out.case.status, 'ok');
        }).catch(function (err) {
          log.textContent = err.detail;
          ui.toast(err.detail, 'err');
          approveBtn.disabled = false;
        });
      });
      return el('div', { class: 'card' }, [
        el('div', { class: 'row' }, [caseLink(c.id, c.id), NIRI.severity(c), statusLabel, NIRI.overdueFlag(c)]),
        el('h4', { text: c.title }),
        el('div', { class: 'row', style: 'margin-top:8px' }, [actor, draftBtn, approveBtn]),
        log,
        el('p', { class: 'small muted', style: 'margin-top:6px' }, caseLink(c.id, 'full evidence, trace and history →'))
      ]);
    }));
  }

  /* the air history panel needs the shared panel close button — ui handles Escape */
}(window.NIRI));
