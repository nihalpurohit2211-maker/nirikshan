/* pages_city.js — the city overview at #/ (overrides NIRI.pages.dashboard).
 *
 * One story on one screen: where the city hurts, what the engine says about it,
 * and which human decision is waiting. The map is the shared schematic basemap;
 * every colour and every score is a field the API served. The only arithmetic in
 * this file is counting rows and scaling a bar to its own on-screen maximum —
 * display joins, never a new verdict.
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var el = NIRI.el, api = NIRI.api, ui = NIRI.ui;

  /* Display-only locality labels for the five fictional wards. They name the real
     Mumbai neighbourhood each ward sits in; they do not change any served value. */
  var LOCALITY = {
    zone_1: 'Chembur',
    zone_2: 'Kurla East',
    zone_3: 'Govandi',
    zone_4: 'Chembur East',
    zone_5: 'Mankhurd'
  };
  var DOMAIN_COLOUR = { water: '#0e7490', air: '#7e9aa8', land: '#b45309' };
  var DOMAIN_LABEL = { water: 'water', air: 'air', land: 'land & waste' };

  function link(href, text, cls) {
    return el('a', { href: href, class: cls || 'link', text: text });
  }

  function zoneShort(id) {
    var hit = /^zone_(\d+)$/.exec(id || '');
    return hit ? 'Ward ' + hit[1] : id;
  }

  function buildZones(network, hotspots, air, cases, complaints) {
    var byId = {};
    network.nodes.forEach(function (n) { byId[n.id] = n; });
    var zoneNodes = network.nodes.filter(function (n) { return n.type === 'zone'; });
    var spotByZone = {};
    (hotspots.hotspots || []).forEach(function (h) { spotByZone[h.node_id] = h; });

    var airByZone = {};
    (air.stations || []).forEach(function (station) {
      var zid = station.zone_id;
      if (!zid || !station.aqi) return;
      if (!airByZone[zid] || station.aqi.value > airByZone[zid].value) {
        airByZone[zid] = { value: station.aqi.value, category: station.aqi.category,
                           colour: station.aqi.colour,
                           driving: station.aqi.driving_pollutant,
                           name: station.name, id: station.id };
      }
    });

    var casesByZone = {};
    var openCases = (cases.cases || []).filter(function (c) { return c.status !== 'Resolved'; });
    openCases.forEach(function (c) {
      var node = byId[c.node_id];
      var zid = node ? (node.type === 'zone' ? node.id : node.zone_id) : null;
      if (!zid) return;
      casesByZone[zid] = casesByZone[zid] || [];
      casesByZone[zid].push(c);
    });

    var complaintsByZone = {};
    var buildingZone = {};
    network.nodes.forEach(function (n) {
      if (n.zone_id) buildingZone[n.id] = n.zone_id;
    });
    (complaints.complaints || []).forEach(function (c) {
      var zid = buildingZone[c.node_id] || (byId[c.node_id] && byId[c.node_id].zone_id);
      if (!zid) return;
      complaintsByZone[zid] = (complaintsByZone[zid] || 0) + 1;
    });

    return zoneNodes.map(function (n) {
      return {
        id: n.id,
        name: n.name,
        short: zoneShort(n.id),
        locality: LOCALITY[n.id] || '',
        lat: n.lat,
        lon: n.lon,
        wqi: n.wqi,
        air: airByZone[n.id] || null,
        complaints: complaintsByZone[n.id] || 0,
        cases: casesByZone[n.id] || [],
        hotspot: spotByZone[n.id] || null
      };
    });
  }

  function zoneOfCase(c, networkById) {
    var node = networkById[c.node_id];
    return node ? (node.type === 'zone' ? node.id : node.zone_id) : null;
  }

  function statCard(label, value, meta, href, swatch) {
    return el('a', { class: 'city-stat', href: href }, [
      el('span', { class: 'k', text: label }),
      el('span', { class: 'v' }, [String(value)]),
      el('span', { class: 'm' }, [
        swatch ? el('span', { class: 'sw', style: 'background:' + swatch }) : null,
        meta
      ])
    ]);
  }

  function legend(mode, zones) {
    var row = el('div', { class: 'city-legend' });
    if (mode === 'air') {
      var seen = {};
      zones.forEach(function (z) {
        var a = z.air;
        if (!a || seen[a.category]) return;
        seen[a.category] = true;
        row.appendChild(el('span', { class: 'k' }, [
          el('span', { class: 'sw', style: 'background:' + a.colour +
                       ';border-radius:2px;transform:rotate(45deg)' }),
          a.category
        ]));
      });
      row.appendChild(el('span', { class: 'k muted', text: 'worst station in each ward' }));
      return row;
    }
    if (mode === 'complaints') {
      row.appendChild(el('span', { class: 'k' }, [
        el('span', { class: 'sw', style: 'background:#b45309' }),
        'complaints on record'
      ]));
      row.appendChild(el('span', { class: 'k muted',
                                   text: 'bubble = count, fill = share of the busiest ward' }));
      return row;
    }
    ['Good', 'Acceptable', 'Poor', 'Unsafe'].forEach(function (band) {
      row.appendChild(el('span', { class: 'k' }, [
        el('span', { class: 'sw', style: 'background:' + (NIRI.BANDS[band] || '#9FB3A8') }),
        band
      ]));
    });
    row.appendChild(el('span', { class: 'k muted', text: 'WQI: higher = worse' }));
    return row;
  }

  function tooltipBody(zone) {
    var rows = [];
    if (zone.wqi) {
      rows.push(el('div', { class: 'tip-row' }, [
        el('span', { text: 'water' }),
        el('b', { class: 'tip-band', style: 'color:' + (zone.wqi.colour || '#fff'),
                  text: zone.wqi.band + ' · ' + zone.wqi.score })
      ]));
      if (zone.wqi.override) {
        rows.push(el('div', { class: 'tip-sub', text: 'override: ' + zone.wqi.override }));
      }
    }
    if (zone.air) {
      rows.push(el('div', { class: 'tip-row' }, [
        el('span', { text: 'air' }),
        el('b', { style: 'color:' + (zone.air.colour || '#fff'),
                  text: zone.air.value + ' · ' + zone.air.category })
      ]));
    }
    rows.push(el('div', { class: 'tip-row' }, [
      el('span', { text: 'open cases' }),
      el('b', { text: String(zone.cases.length) })
    ]));
    rows.push(el('div', { class: 'tip-row' }, [
      el('span', { text: 'complaints' }),
      el('b', { text: String(zone.complaints) })
    ]));
    return [el('strong', { text: zone.name }),
            el('div', { class: 'tip-sub', text: zone.locality }), rows];
  }

  NIRI.pages = NIRI.pages || {};
  NIRI.pages.dashboard = {
    title: 'City overview',
    sub: 'every layer on one page — pick a ward, follow the evidence',
    render: function (host) {
      host.appendChild(el('div', { class: 'city-page' }, [
        el('div', { class: 'city-hero skeleton', style: 'height:190px' })
      ]));
      Promise.all([api.overview(), api.hotspots(), api.network(), api.air(),
                   api.cases(), api.complaints()]).then(function (out) {
        var overview = out[0], hotspots = out[1], network = out[2];
        var air = out[3], cases = out[4], complaints = out[5];
        var kpi = overview.kpis;
        var zones = buildZones(network, hotspots, air, cases, complaints);
        var byZone = {};
        zones.forEach(function (z) { byZone[z.id] = z; });
        var networkById = {};
        network.nodes.forEach(function (n) { networkById[n.id] = n; });

        NIRI.clear(host);
        var page = el('div', { class: 'city-page' });
        host.appendChild(page);

        /* ------------------------------------------------------------ hero */
        var hero = el('section', { class: 'city-hero' }, [
          el('div', {}, [
            el('p', { class: 'city-eyebrow',
                      text: 'Mumbai · eastern suburbs · demo clock ' + overview.demo_now }),
            el('h1', { class: 'city-display' }, [
              'The city, ', el('em', { text: 'one layer at a time.' })
            ]),
            el('p', { class: 'city-lede' },
              'Complaints are sensors. Nirikshan groups them against the drain and pipeline '
              + 'network, so five reports become one upstream cause — with a standard cited, '
              + 'a case opened, and a human signature before anything ships.'),
            el('span', { class: 'city-live' }, [
              el('span', { class: 'city-live-dot' }),
              network.nodes.length + ' nodes · ' + network.pipes.length + ' pipes · '
              + network.nodes.filter(function (n) { return n.type === 'zone'; }).length
              + ' wards · live as of ' + overview.demo_now
            ])
          ]),
          el('div', { class: 'city-stats' }, [
            statCard('open cases', kpi.open_cases,
                     kpi.open_cases + ' need a human decision', '#/cases'),
            statCard('complaints · 24 h', kpi.complaints_24h,
                     'as of ' + overview.demo_now, '#/complaints'),
            statCard('worst water', kpi.worst_wqi ? kpi.worst_wqi.score : '—',
                     kpi.worst_wqi ? kpi.worst_wqi.band + ' · ' + kpi.worst_wqi.name : 'no sensor',
                     kpi.worst_wqi ? '#/nodes/' + kpi.worst_wqi.node_id : '#/',
                     kpi.worst_wqi ? kpi.worst_wqi.colour : null),
            statCard('worst air', kpi.worst_aqi ? kpi.worst_aqi.value : '—',
                     kpi.worst_aqi ? kpi.worst_aqi.category + ' · ' +
                       kpi.worst_aqi.driving_pollutant : 'no station',
                     '#/air',
                     kpi.worst_aqi ? kpi.worst_aqi.colour : null)
          ])
        ]);
        page.appendChild(hero);

        /* ------------------------------------- the last 24 hours of reports */
        var clock = new Date(overview.demo_now);
        var reportRows = (complaints && complaints.complaints) || [];
        if (!isNaN(clock.getTime()) && reportRows.length) {
          var bins = [];
          for (var hh = 0; hh < 24; hh++) bins.push(0);
          var edgeHour = new Date(clock.getTime());
          edgeHour.setMinutes(0, 0, 0);
          reportRows.forEach(function (c) {
            var d = new Date(c.timestamp || c.created_at);
            if (isNaN(d.getTime())) return;
            var slot = 23 - Math.floor((edgeHour.getTime() - d.getTime()) / 3600000);
            if (slot >= 0 && slot < 24) bins[slot] += 1;
          });
          var total = bins.reduce(function (a, b) { return a + b; }, 0);
          var peak = Math.max.apply(null, bins);
          var hourly = bins.map(function (v, i) {
            var d = new Date(edgeHour.getTime() - (23 - i) * 3600000);
            var label = ('0' + d.getHours()).slice(-2) + ':00';
            return { value: v, label: i % 6 === 0 ? label : '',
                     tick: true,
                     title: label + ' · ' + v + ' report' + (v === 1 ? '' : 's') };
          });
          page.appendChild(el('section', { class: 'card pulse-card' }, [
            el('div', { class: 'pulse-head' }, [
              el('div', {}, [
                el('h3', { text: 'The last 24 hours' }),
                el('p', { class: 'sub', text: 'resident reports by the hour they were filed — '
                  + 'each column is a served row, so a flat hour is a quiet hour' })
              ]),
              el('div', { class: 'pulse-figs' }, [
                el('span', { class: 'pulse-fig' }, [el('b', { text: String(total) }),
                  el('span', { text: 'reports' })]),
                el('span', { class: 'pulse-fig' }, [el('b', { text: String(peak) }),
                  el('span', { text: 'busiest hour' })])
              ])
            ]),
            NIRI.columns(hourly, { tight: true })
          ]));
        }

        /* ------------------------------------------------------------- map */
        var MAP_MODES = [
          { key: 'water', label: 'Water' },
          { key: 'air', label: 'Air' },
          { key: 'complaints', label: 'Complaints' },
          { key: 'all', label: 'All' }
        ];
        var activeMode = 'water';
        var filterZone = null;
        var tip = el('div', { class: 'city-tip' });
        var mapBody = el('div', { class: 'city-map-body' });
        var legendSlot = el('div');
        var filterSlot = el('div', { class: 'row' });
        var tableSlot = el('div', { class: 'city-table-wrap' });

        var map = NIRI.basemap.create({
          zones: zones,
          mode: activeMode,
          onZoneHover: function (zone, ev) {
            if (!zone) { tip.classList.remove('on'); return; }
            NIRI.clear(tip);
            NIRI.append(tip, tooltipBody(zone));
            var box = mapBody.getBoundingClientRect();
            var x = Math.max(130, Math.min(box.width - 130, ev.clientX - box.left));
            var y = Math.max(130, ev.clientY - box.top);
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
            tip.classList.add('on');
          },
          onZoneClick: function (zone) {
            selectZone(filterZone === zone.id ? null : zone.id);
          }
        });
        mapBody.appendChild(map.element);
        mapBody.appendChild(tip);

        function paintLegend() {
          NIRI.clear(legendSlot);
          legendSlot.appendChild(legend(activeMode, zones));
        }

        function selectZone(zoneId) {
          filterZone = zoneId;
          map.highlight(zoneId);
          paintTriage();
          NIRI.clear(filterSlot);
          if (zoneId) {
            var z = byZone[zoneId];
            filterSlot.appendChild(el('button', {
              class: 'city-filter', type: 'button',
              title: 'clear the ward filter',
              on: { click: function () { selectZone(null); } }
            }, [(z ? z.short + ' · ' + z.name : zoneId) + '  ×']));
          }
          /* keep the side rail in sync */
          if (sideHost) {
            Array.prototype.forEach.call(sideHost.querySelectorAll('.hotspot'), function (btn) {
              btn.classList.toggle('is-active', btn.dataset.zone === zoneId);
            });
          }
        }

        function paintTriage() {
          var rows = overview.triage.filter(function (c) {
            return !filterZone || zoneOfCase(c, networkById) === filterZone;
          });
          NIRI.clear(tableSlot);
          if (filterZone && !rows.length) {
            tableSlot.appendChild(NIRI.empty('No open case sits on this ward right now. '
              + 'The map still shows its sensor and complaint load.'));
            return;
          }
          tableSlot.appendChild(NIRI.table([
            { label: 'severity', get: function (c) { return NIRI.severity(c); } },
            { label: 'case', get: function (c) { return link('#/cases/' + c.id, c.title); } },
            { label: 'ward / node', get: function (c) {
                return link('#/nodes/' + c.node_id, api.nodeName(c.node_id)); } },
            { label: 'status', get: function (c) { return NIRI.statusBadge(c.status); } },
            { label: 'reports', num: true,
              get: function (c) {
                return (c.complaints || []).length
                  || (c.evidence && c.evidence.complaints || []).length; } },
            { label: 'flag', get: function (c) { return NIRI.overdueFlag(c); } }
          ], rows, { onRow: function (c) { location.hash = '#/cases/' + c.id; } }));
        }

        var seg = el('div', { class: 'city-seg', role: 'group', 'aria-label': 'map layer' },
          MAP_MODES.map(function (m) {
            return el('button', {
              type: 'button', text: m.label, 'data-mode': m.key,
              'aria-pressed': m.key === activeMode ? 'true' : 'false',
              on: { click: function (ev) {
                activeMode = m.key;
                map.setMode(m.key);
                paintLegend();
                Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
                  b.setAttribute('aria-pressed', b.dataset.mode === activeMode ? 'true' : 'false');
                });
              } }
            });
          }));

        var mapCard = el('section', { class: 'card city-map-card' }, [
          el('div', { class: 'city-map-head' }, [
            el('div', {}, [
              el('h3', { text: 'Ward signal map' }),
              el('p', { class: 'sub',
                        text: 'the schematic city, with the layer you choose painted on the wards' })
            ]),
            el('div', { class: 'city-map-tools' }, [seg])
          ]),
          mapBody,
          el('div', { class: 'city-map-foot' }, [
            legendSlot,
            el('span', { class: 'city-seg-note',
                         text: 'colour is served by the engine · hover a ward for its numbers' })
          ])
        ]);
        paintLegend();

        /* --------------------------------------------------------- side rail */
        var ranked = hotspots.hotspots.slice(0, 4);
        var topScore = Math.max.apply(null, ranked.map(function (h) { return h.score; }).concat([1]));
        var sideHost = el('aside', { class: 'card city-side' });
        sideHost.appendChild(el('div', { class: 'city-side-head' }, [
          el('h3', { text: 'Hotspots' }),
          el('span', { text: 'engine rank' })
        ]));
        ranked.forEach(function (h, i) {
          var z = byZone[h.node_id];
          var btn = el('button', {
            class: 'hotspot', type: 'button', 'data-zone': h.node_id,
            on: { click: function () {
              var next = filterZone === h.node_id ? null : h.node_id;
              selectZone(next);
              if (next && activeMode !== 'all') {
                activeMode = 'all';
                map.setMode('all');
                paintLegend();
                syncSeg();
              }
            } }
          }, [
            el('span', { class: 'hotspot-rank', text: String(i + 1).padStart(2, '0') }),
            el('span', {}, [
              el('span', { class: 'hotspot-name', text: h.name }),
              el('span', { class: 'hotspot-loc',
                           text: (z && z.locality) || (h.band + ' · WQI ' +
                             (h.factors ? h.factors.wqi : '—')) }),
              el('span', { class: 'hotspot-track' }, [
                el('i', { style: 'width:' + Math.max(4, (h.score / topScore) * 100) + '%' })
              ]),
              el('span', { class: 'hotspot-meta',
                           text: 'WQI ' + (h.factors ? h.factors.wqi : '—') + ' · '
                             + (h.cases || []).length + ' open case'
                             + ((h.cases || []).length === 1 ? '' : 's') + ' · '
                             + (h.factors ? h.factors.complaints_24h : 0) + ' reports' })
            ]),
            el('span', { class: 'hotspot-score', text: h.score.toFixed(1) })
          ]);
          sideHost.appendChild(btn);
        });

        /* the five served WQI scores as a compact bar chart — a second read of the map */
        var wqiRanked = zones.slice().sort(function (a, b) {
          return (b.wqi ? b.wqi.score : -1) - (a.wqi ? a.wqi.score : -1);
        });
        sideHost.appendChild(el('div', { class: 'city-side-sub' }, [
          el('h4', { text: 'Ward WQI' }),
          el('p', { class: 'city-side-subnote', text: 'served index, 0 clean — 100 worst' }),
          wqiRanked.map(function (z) {
            return el('div', { class: 'city-wqi-row', title: z.name }, [
              el('span', { class: 't', text: z.short }),
              el('span', { class: 'city-wqi-track' }, [
                el('i', { style: 'width:' + (z.wqi ? Math.max(3, z.wqi.score) : 0) + '%;background:'
                          + (z.wqi ? z.wqi.colour : '#d6d0c0') })
              ]),
              el('b', { text: z.wqi ? String(z.wqi.score) : '—' })
            ]);
          })
        ]));

        sideHost.appendChild(el('div', { class: 'city-side-foot' }, [
          el('a', { class: 'city-side-link', href: '#/map' },
             [el('span', { text: 'Open the network map' }), el('span', { text: '→' })]),
          el('p', { class: 'city-side-note' },
            'Ranking, scores and bands are the backend’s. The bars are the served score '
            + 'share, not a threshold computed here.')
        ]));

        var mapGrid = el('div', { class: 'city-map-grid' }, [mapCard, sideHost]);
        page.appendChild(mapGrid);

        /* --------------------------------------------- triage + signal charts */
        var mix = {};
        (complaints.complaints || []).forEach(function (c) {
          mix[c.domain] = (mix[c.domain] || 0) + 1;
        });
        var mixMax = Math.max.apply(null, Object.keys(mix).map(function (k) { return mix[k]; })
                                           .concat([1]));
        var mixCard = el('div', { class: 'card city-mini' }, [
          el('h3', { text: 'Complaint mix' }),
          el('p', { class: 'sub', text: (complaints.complaints || []).length
            + ' complaints on record, by domain' }),
          Object.keys(DOMAIN_COLOUR).map(function (domain) {
            var n = mix[domain] || 0;
            return el('div', { class: 'city-mix-row' }, [
              el('span', { class: 't', text: DOMAIN_LABEL[domain] }),
              el('span', { class: 'city-mix-track' }, [
                el('i', { style: 'width:' + Math.max(2, (n / mixMax) * 100) + '%;background:'
                          + DOMAIN_COLOUR[domain] })
              ]),
              el('span', { class: 'n', text: String(n) })
            ]);
          })
        ]);

        var worstAir = (air.stations || []).slice().sort(function (a, b) {
          return (b.aqi ? b.aqi.value : 0) - (a.aqi ? a.aqi.value : 0);
        }).slice(0, 4);
        var airCard = el('div', { class: 'card city-mini' }, [
          el('h3', { text: 'Air now' }),
          el('p', { class: 'sub', text: 'worst four stations by the served NAQI' }),
          worstAir.map(function (s) {
            return el('div', { class: 'city-air-row' }, [
              el('span', { class: 'city-air-dot', style: 'background:' +
                           (s.aqi ? s.aqi.colour : '#9FB3A8') }),
              el('span', { class: 'name', text: s.name }),
              el('span', { class: 'val', style: 'color:' + (s.aqi ? s.aqi.colour : '#1c1917') },
                 [String(s.aqi ? s.aqi.value : '—'),
                  el('small', { text: ' ' + (s.aqi ? s.aqi.category : '') })])
            ]);
          })
        ]);

        var triageCard = el('section', { class: 'card city-panel' }, [
          el('div', { class: 'city-panel-head' }, [
            el('div', {}, [
              el('h3', { text: 'Triage — worst first' }),
              el('p', { class: 'sub', text: 'the OVERDUE flag is the server’s 2-hour rule; '
                + 'the case, severity and status are served too' })
            ]),
            filterSlot
          ]),
          tableSlot
        ]);
        paintTriage();

        var lower = el('div', { class: 'city-lower' }, [
          triageCard,
          el('div', { class: 'grid', style: 'gap:16px' }, [mixCard, airCard])
        ]);
        page.appendChild(lower);

        /* ------------------------------------------------- network preview */
        var preview = NIRI.map.create({
          nodes: network.nodes, pipes: network.pipes, preview: true, aspect: 0.40
        });
        var netCard = el('section', { class: 'card city-net' }, [
          el('div', { class: 'city-net-head' }, [
            el('div', {}, [
              el('h3', { text: 'The distribution tree' }),
              el('p', { class: 'sub', text: network.nodes.length + ' nodes and '
                + network.pipes.length + ' pipes from one /api/network call — the same '
                + 'schematic base map, zoomed to the study area' })
            ]),
            el('a', { class: 'chip', href: '#/map', text: 'full map →' })
          ]),
          el('div', { class: 'city-net-body', title: 'open the network map',
                      on: { click: function () { location.hash = '#/map'; } } },
             [preview.element])
        ]);
        /* Keep the distribution tree close to the summary: it is the primary evidence surface. */
        page.insertBefore(netCard, mapGrid);

        function syncSeg() {
          Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
            b.setAttribute('aria-pressed', b.dataset.mode === activeMode ? 'true' : 'false');
          });
        }
      }).catch(function (err) {
        NIRI.clear(host);
        host.appendChild(ui.errorBox(err));
      });
    }
  };
}(window.NIRI));
