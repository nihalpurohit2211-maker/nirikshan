/* pages_core.js — Dashboard, Network Map, Complaints, Cases, Case detail, Node detail.
 *
 * One page = one export in NIRI.pages, rendered into the shell's #view by the router.
 * Pages read bulk endpoints, never loop the API over nodes, and paint only what the
 * server sent: severity, status, overdue, WQI band, limits and the rule string are all
 * the backend's conclusions (§1 rule 4: the LLM and the browser both never decide).
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var el = NIRI.el, api = NIRI.api, ui = NIRI.ui;
  var pages = {};

  function link(href, label, cls) {
    return el('a', { href: href, class: cls || null, text: label });
  }
  function caseLink(id, label) {
    return link('#/cases/' + id, label || id, 'link');
  }
  function nodeLink(id, label) {
    return link('#/nodes/' + id, label || id, 'link');
  }

  /* Complaints are joined to cases client-side from two bulk payloads — a display join,
     not a decision: the case's own evidence.complaints list is the server's answer. */
  function complaintCaseMap(cases) {
    var map = {};
    cases.forEach(function (c) {
      (c.evidence && c.evidence.complaints ? c.evidence.complaints : []).forEach(function (cid) {
        if (!map[cid]) map[cid] = [];
        map[cid].push(c.id);
      });
    });
    return map;
  }

  function rowsByDomain(complaints, domain) {
    return complaints.filter(function (c) { return c.domain === domain; });
  }

  /* ------------------------------------------------------------------ dashboard */
  pages.dashboard = {
    title: 'Officer dashboard',
    sub: 'what a ward reported, what it points at, and what is waiting on a human',
    render: function (host) {
      host.appendChild(NIRI.loading('loading the ward picture…'));
      Promise.all([api.overview(), api.hotspots(), api.network()]).then(function (out) {
        var overview = out[0], hotspots = out[1], network = out[2];
        NIRI.clear(host);
        var kpi = overview.kpis;

        host.appendChild(el('div', { class: 'grid cols-4 section' }, [
          NIRI.kpi('open cases', kpi.open_cases,
                   'cases that are not Resolved yet'),
          NIRI.kpi('worst water quality', kpi.worst_wqi ? kpi.worst_wqi.score : '—',
                   [el('span', {}, [kpi.worst_wqi ? nodeLink(kpi.worst_wqi.node_id,
                        kpi.worst_wqi.name) : 'no sensor data']),
                    kpi.worst_wqi ? NIRI.bandBadge(kpi.worst_wqi) : null],
                   kpi.worst_wqi && kpi.worst_wqi.band === 'Unsafe' ? 'bad' : ''),
          NIRI.kpi('worst air quality', kpi.worst_aqi ? kpi.worst_aqi.value : '—',
                   [el('span', {}, [kpi.worst_aqi ? link('#/air', kpi.worst_aqi.name) : '—']),
                    kpi.worst_aqi ? NIRI.badge(kpi.worst_aqi.category, 'plain',
                        'driven by ' + kpi.worst_aqi.driving_pollutant) : null],
                   /* the served NAQI category drives the alert tone; no number is compared
                      against a threshold in the browser. */
                   kpi.worst_aqi && NIRI.isBadAqi(kpi.worst_aqi.category) ? 'bad' : ''),
          NIRI.kpi('complaints in 24 h', kpi.complaints_24h,
                   'as of ' + overview.demo_now)
        ]));

        var triage = NIRI.table([
          { label: 'severity', get: function (c) { return c.severity; }, title: 'from the rules engine' },
          { label: 'case', get: function (c) { return caseLink(c.id, c.title); } },
          { label: 'ward / node', get: function (c) { return nodeLink(c.node_id, api.nodeName(c.node_id)); } },
          { label: 'scope', get: function (c) { return c.scope === 'BUILDING_SIDE' ? 'building-side' : 'municipal'; } },
          { label: 'status', get: function (c) { return c.status; } },
          { label: 'reports', num: true, get: function (c) { return (c.complaints || []).length || (c.evidence && c.evidence.complaints || []).length; } },
          { label: 'last action', get: function (c) {
              /* last_action is a timestamp string from the server, not an object. */
              var stamp = c.last_action || c.updated_at;
              return el('span', {}, [api.time(stamp), ' ',
                       el('span', { class: 'muted', text: '· ' + api.since(stamp) })]); } },
          { label: 'flag', get: function (c) { return NIRI.overdueFlag(c); } }
        ], overview.triage);
        host.appendChild(NIRI.section('Triage — worst first',
          'the OVERDUE badge is the server’s 2-hour rule, not a client-side timer',
          triage,
          [el('button', { class: 'chip', text: 'all cases', on: { click: function () {
            location.hash = '#/cases'; } } })]));

        var ranked = NIRI.el('div', { class: 'grid cols-2' }, hotspots.hotspots.map(function (h, i) {
          return NIRI.card('' + (i + 1) + '. ' + h.name, el('div', {}, [
            el('div', { class: 'row' }, [
              NIRI.badge('score ' + h.score.toFixed(1), 'plain'),
              NIRI.bandBadge(h.band ? { band: h.band, score: h.score } : null)
            ]),
            el('div', { style: 'margin-top:10px' }, NIRI.bars(
              Object.keys(h.factors).map(function (key) {
                /* One colour for every factor: the factors are the served decomposition of
                   the score and each is on its own unit (a WQI of 94.4 and an open-case count
                   of 1 are not comparable), so painting wqi red and the rest green would be
                   this file inventing which factor is "the alarm". */
                return { label: key.replace(/_/g, ' '), value: h.factors[key],
                         shown: String(h.factors[key]), color: '#7E9AA8' };
              }))),
            el('p', { class: 'small muted', style: 'margin-top:8px' },
              [nodeLink(h.node_id, 'open ' + h.node_id), ' · cases: ',
               (h.cases || []).map(function (id, j) {
                 return [j ? ', ' : null, caseLink(id, id)];
               })])
          ]));
        }));
        host.appendChild(NIRI.section('Hotspots',
          'ranked by the backend: complaint load, open cases, severity and water quality. '
          + 'The bars are each hotspot’s served factor decomposition, and the factors keep '
          + 'their own units — the length is that factor’s share of the row, not a verdict',
          ranked));

        var preview = NIRI.map.create({
          nodes: network.nodes, pipes: network.pipes, preview: true, aspect: 0.44
        });
        var previewHost = el('div', { style: 'cursor:pointer', on: { click: function () {
          location.hash = '#/map';
        } } }, preview.element);
        host.appendChild(NIRI.section('Network preview',
          network.nodes.length + ' nodes and ' + network.pipes.length +
          ' pipes from one /api/network call — click for the full map', previewHost));
      }).catch(function (err) { NIRI.clear(host); host.appendChild(ui.errorBox(err)); });
    }
  };

  /* ------------------------------------------------------------------ network map */
  pages.map = {
    title: 'Network map',
    sub: 'the whole distribution tree, the air grid and the land sites in one bulk call',
    render: function (host, params) {
      params = params || {};
      host.appendChild(NIRI.loading('drawing 98 nodes and 78 pipes…'));
      Promise.all([api.network(), api.cases()]).then(function (out) {
        var network = out[0], cases = out[1].cases;
        NIRI.clear(host);

        var traceCard = el('div', { class: 'card' });
        var map = NIRI.map.create({
          nodes: network.nodes, pipes: network.pipes, aspect: 0.72,
          onSelect: function (node) { openNodePanel(node.id); },
          onTraceStep: function (step) { openNodePanel(step.node_id); }
        });

        host.appendChild(el('div', { class: 'split-rail section', style: '--rail:340px' }, [
          el('div', {}, [map.element,
            el('p', { class: 'small muted', style: 'margin-top:8px' },
              'schematic base map — not to scale; synthetic city data · drag to pan · wheel '
              + 'or +/− to zoom · click a node for its panel · pipe thickness ∝ log(diameter)')]),
          traceCard
        ]));

        var waterCases = cases.filter(function (c) { return c.domain === 'water'; });
        var select = el('select', {}, waterCases.map(function (c) {
          return el('option', { value: c.id, text: c.id + ' — ' + c.title });
        }));
        var body = el('div', {}, [
          el('h3', { text: 'Trace Upstream' }),
          el('p', { class: 'small muted' }, 'follow a case’s complaints up the tree to the shared '
            + 'cause. Only water cases have a network trace; air and land answers 400.'),
          el('div', { class: 'field' }, [el('label', { text: 'case' }), select]),
          el('div', { class: 'row' }, [
            el('button', { class: 'primary', text: 'Trace it', on: { click: run } }),
            el('button', { class: 'ghost', text: 'clear', on: { click: function () {
              map.clearTrace(); NIRI.clear(body2); body2.appendChild(el('p', { class: 'muted small',
                text: 'no trace on screen' }));
            } } })
          ])
        ]);
        var body2 = el('div', { style: 'margin-top:12px' },
                       el('p', { class: 'muted small', text: 'no trace on screen' }));

        function run() {
          api.trace(select.value).then(function (trace) {
            map.showTrace(trace);
            var worst = trace.worst_pipe;
            NIRI.clear(body2);
            body2.appendChild(el('div', { class: 'draft-card' }, [
              el('div', { class: 'stamp-row' }, [
                NIRI.badge(trace.hops + ' hops', 'plain'),
                worst ? NIRI.badge('worst ' + worst.id, 'high',
                        'decay k = ' + trace.worst_pipe_decay_k) : null
              ]),
              el('p', { class: 'draft-text', style: 'font-size:13.5px', text: trace.explanation }),
              el('p', { class: 'small muted' }, [
                'path: ', trace.path.map(function (id, i) {
                  return [i ? ' → ' : null, nodeLink(id, api.nodeName(id))];
                })])
            ]));
            ui.toast('traced ' + trace.hops + ' hops to ' + api.nodeName(trace.path[trace.path.length - 1]), 'ok');
          }).catch(function (err) {
            NIRI.clear(body2);
            body2.appendChild(ui.errorBox(err));
            ui.toast(err.detail, 'err');
          });
        }

        traceCard.appendChild(body);
        traceCard.appendChild(body2);

        /* start on the hero case so the demo's first click is one click, and honour
           ?t=<case> / ?n=<node> (the router keeps the query keys the hash uses) */
        var traceId = params.t || params.trace;
        var focusId = params.n || params.node;
        if (waterCases.length) { select.value = waterCases[0].id; }
        if (traceId && waterCases.some(function (c) { return c.id === traceId; })) {
          select.value = traceId;
          run();
        }
        if (focusId) {
          map.focusNode(focusId);
          openNodePanel(focusId);
        }
      }).catch(function (err) { NIRI.clear(host); host.appendChild(ui.errorBox(err)); });
    }
  };

  function openNodePanel(nodeId, keepSelection) {
    var box = el('div', {}, NIRI.loading('loading ' + nodeId + '…'));
    ui.openPanel(api.nodeName(nodeId) + ' · ' + nodeId, box, '#/nodes/' + nodeId);
    Promise.all([api.nodeDetail(nodeId), api.complaints(), api.cases()]).catch(function () { return []; })
      .then(function (out) { return buildNodePanel(NIRI.clear(box), out[0], out[1], out[2], false); })
      .catch(function (err) { NIRI.clear(box); box.appendChild(ui.errorBox(err)); });
  }
  NIRI.openNodePanel = openNodePanel;

  /* The node panel and the node page share this builder; `full` widens the charts. */
  function buildNodePanel(host, detail, complaintsPayload, casesPayload, full) {
    if (!detail) { return host; }
    var node = detail.node;
    NIRI.clear(host);

    host.appendChild(el('div', { class: 'row', style: 'margin-bottom:10px' }, [
      NIRI.badge(node.type.replace(/_/g, ' '), 'plain'),
      /* The WQI is served at the top of the payload, not on node — /api/nodes/{id} puts
         score/band/colour in detail.wqi and leaves node as the bare graph row. */
      detail.wqi ? NIRI.bandBadge(detail.wqi) : NIRI.badge('no WQI — no sensor here', 'plain'),
      node.zone_id && node.zone_id !== node.id ? NIRI.badge('in ' + node.zone_id, 'plain') : null,
      el('span', { class: 'muted small', text: node.lat.toFixed(4) + ', ' + node.lon.toFixed(4) })
    ]));

    if (detail.latest) {
      var readings = [
        { label: 'turbidity', value: detail.latest.turbidity_ntu, unit: 'NTU' },
        { label: 'residual chlorine', value: detail.latest.residual_chlorine_mgl, unit: 'mg/L' },
        { label: 'pH', value: detail.latest.ph, unit: '' },
        { label: 'TDS', value: detail.latest.tds_mgl, unit: 'mg/L' }
      ].filter(function (r) { return r.value !== null && r.value !== undefined; });
      host.appendChild(el('div', { class: 'grid cols-4' }, readings.map(function (r) {
        return el('div', { class: 'card tight kpi' }, [
          el('span', { class: 'label', text: r.label }),
          el('span', { class: 'value', style: 'font-size:19px', text: String(r.value) }),
          el('span', { class: 'meta', text: (r.unit + ' at ' + detail.latest.timestamp) })
        ]);
      })));
    } else {
      host.appendChild(NIRI.empty('no sensor on this node — the readings an officer sees here come '
        + 'from the ward’s sensor, not the building itself'));
    }

    if (detail.coliform_present === true) {
      host.appendChild(el('div', { class: 'row', style: 'margin-top:10px' },
                          [NIRI.badge('coliform PRESENT', 'emergency'),
                           el('span', { class: 'small muted', text: 'lab test, not a model guess' })]));
    }

    if (detail.wqi && detail.wqi.subindices) {
      var subs = detail.wqi.subindices;
      /* No per-sub-index band is served, so the only claim made here is the one the data
         supports: the parameter with the highest served QI is the worst contributor. */
      var worstQi = Object.keys(subs).reduce(function (m, k) {
        return Math.max(m, subs[k].qi);
      }, 0);
      host.appendChild(el('div', { style: 'margin-top:14px' }, [
        el('h4', { text: 'WQI sub-indices' }),
        NIRI.bars(Object.keys(subs).map(function (key) {
          var sub = subs[key];
          return { label: key.replace(/_/g, ' ') + ' (' + sub.value + ')',
                   value: sub.qi, shown: sub.qi + ' · weight ' + sub.weight,
                   color: sub.qi === worstQi ? (detail.wqi.colour || '#EA4335') : '#9FB3A8' };
        }))
      ]));
    }

    if (detail.anomaly) {
      host.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [
        NIRI.badge(detail.anomaly.flag ? 'anomaly flagged' : 'within baseline',
                   detail.anomaly.flag ? 'high' : 'plain'),
        el('code', { text: 'z = ' + detail.anomaly.z + ' on ' + detail.anomaly.parameter })
      ]));
      host.appendChild(el('p', { class: 'small muted' },
        'baseline ' + detail.anomaly.baseline_mean + ' ± ' + detail.anomaly.baseline_std +
        ' — the shaded band on the chart is that range, as the server computed it'));
    }

    if (detail.maintenance && detail.maintenance.length) {
      host.appendChild(el('div', { style: 'margin-top:14px' }, NIRI.table(
        [{ label: 'date', get: function (m) { return m.date; } },
         { label: 'check', get: function (m) { return m.check_type.replace(/_/g, ' '); } },
         { label: 'result', get: function (m) { return m.result; } }],
        detail.maintenance)));
    }

    if (detail.lab_tests && detail.lab_tests.length) {
      host.appendChild(el('div', { style: 'margin-top:14px' }, [
        el('h4', { text: 'lab tests' }),
        NIRI.table(
          [{ label: 'sample', get: function (t) { return t.id; } },
           { label: 'date', get: function (t) { return api.time(t.date); } },
           { label: 'total coliform', get: function (t) { return t.total_coliform; } },
           { label: 'E. coli', get: function (t) { return t.e_coli; } },
           { label: 'method', get: function (t) { return t.note; } }],
          detail.lab_tests)]));
    }

    var here = (complaintsPayload && complaintsPayload.complaints || []).filter(function (c) {
      return c.node_id === node.id || (node.parent_id && c.node_id === node.parent_id);
    });
    if (here.length) {
      var map = complaintCaseMap(casesPayload && casesPayload.cases || []);
      host.appendChild(el('div', { style: 'margin-top:14px' }, [
        el('h4', { text: 'reports from here (' + here.length + ')' }),
        NIRI.table([{ label: 'id', get: function (c) { return c.id; } },
                    { label: 'when', get: function (c) { return api.time(c.timestamp); } },
                    { label: 'said', get: function (c) { return c.text; } },
                    { label: 'case', get: function (c) {
                        var ids = map[c.id];
                        return ids && ids.length
                               ? el('span', {}, ids.map(function (id, i) {
                                   return [i ? ', ' : null, caseLink(id, id)]; }))
                               : el('span', { class: 'muted', text: 'not clustered' }); } }],
                   here.slice(0, full ? 20 : 5))
      ]));
    }

    if (detail.open_cases && detail.open_cases.length) {
      host.appendChild(el('div', { class: 'row', style: 'margin-top:14px' },
        [el('strong', { class: 'small', text: 'open cases: ' })].concat(
          detail.open_cases.map(function (c) {
            return el('span', { class: 'row' }, [caseLink(c.id, c.id + ' — ' + c.title),
                                                 NIRI.severity(c)]);
          }))));
    }
    return host;
  }

  /* ------------------------------------------------------------------ complaints */
  pages.complaints = {
    title: 'Complaints',
    sub: 'a report is a sensor reading on a ward — file it, check what the assistant read, cluster it',
    render: function (host) {
      Promise.all([api.network(), api.complaints(), api.cases()]).then(function (out) {
        var network = out[0], complaints = out[1].complaints, cases = out[2].cases;
        NIRI.clear(host);
        host.appendChild(intakeForm(network, complaints));
        host.appendChild(tracker(complaints, cases));
      }).catch(function (err) { NIRI.clear(host); host.appendChild(ui.errorBox(err)); });
    }
  };

  var DOMAIN_TABS = [
    { domain: 'water', label: 'Water', types: ['building', 'zone'],
      hint: 'a society or a ward; the graph decides what it shares upstream' },
    { domain: 'air', label: 'Air', types: ['air_station'],
      hint: 'pick the monitor whose block you mean' },
    { domain: 'land', label: 'Land', types: ['land_site'],
      hint: 'how long has it been there, and how big — both feed the proximity score' }
  ];

  function intakeForm(network, complaints) {
    var state = { domain: 'water' };
    var byType = {};
    DOMAIN_TABS.forEach(function (tab) {
      byType[tab.domain] = network.nodes.filter(function (n) {
        return tab.types.indexOf(n.type) >= 0;
      });
    });
    var categories = {};
    complaints.forEach(function (c) {
      if (!c.category) return;
      categories[c.domain] = categories[c.domain] || {};
      categories[c.domain][c.category] = true;
    });

    var nodeSelect = el('select');
    var categorySelect = el('select');
    var textInput = el('textarea', { placeholder: 'Brown water from the tap since 3 days, smells of sewage',
                                     rows: 3 });
    var duration = el('input', { type: 'number', min: 0, step: 1, placeholder: 'days' });
    var area = el('input', { type: 'number', min: 0, step: 1, placeholder: 'm²' });
    var extras = el('div', { class: 'grid cols-2' }, [
      el('div', { class: 'field' }, [el('label', { text: 'how many days' }), duration]),
      el('div', { class: 'field' }, [el('label', { text: 'how large (m²)' }), area])
    ]);
    var imageState = { b64: null };
    var drop = el('div', { class: 'drop', text: 'optional photo — jpg/png, kept in this browser tab only' });
    var fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png',
                                 style: 'display:none' });
    var result = el('div', { style: 'margin-top:14px' });
    var hint = el('p', { class: 'hint' });

    function fillNodeOptions() {
      NIRI.clear(nodeSelect);
      byType[state.domain].forEach(function (n) {
        nodeSelect.appendChild(el('option', { value: n.id, text: n.name + ' (' + n.id + ')' }));
      });
      if (state.domain === 'water') {
        var hero = byType.water.filter(function (n) { return n.id === 'B21'; })[0];
        if (hero) nodeSelect.value = 'B21';
      }
    }
    function fillCategories() {
      NIRI.clear(categorySelect);
      categorySelect.appendChild(el('option', { value: '', text: 'leave blank — the assistant reads it' }));
      Object.keys(categories[state.domain] || {}).sort().forEach(function (name) {
        categorySelect.appendChild(el('option', { value: name, text: name }));
      });
    }

    function paintTabs(bar) {
      NIRI.clear(bar);
      DOMAIN_TABS.forEach(function (tab) {
        bar.appendChild(el('button', {
          class: tab.domain === state.domain ? 'active' : '', text: tab.label,
          on: { click: function () {
            state.domain = tab.domain;
            paintTabs(bar); fillNodeOptions(); fillCategories();
            extras.style.display = tab.domain === 'land' ? '' : 'none';
            hint.textContent = tab.hint;
          } }
        }));
      });
    }

    var bar = el('div', { class: 'tabs' });
    paintTabs(bar);
    fillNodeOptions();
    fillCategories();
    extras.style.display = 'none';
    hint.textContent = DOMAIN_TABS[0].hint;

    function readImage(file) {
      if (!file) return;
      if (!/image\/(jpeg|png)/.test(file.type)) {
        ui.toast('the API accepts jpg or png only', 'err');
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        /* the API wants the whole data URL — _store_upload keys off the "data:image/…" prefix */
        imageState.b64 = String(reader.result);
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

    var submit = el('button', { class: 'primary', text: 'File the complaint' });
    var clusterBtn = el('button', { text: 'Run clustering' });

    submit.addEventListener('click', function () {
      var body = { domain: state.domain, node_id: nodeSelect.value,
                   text: textInput.value.trim() };
      if (categorySelect.value) body.category = categorySelect.value;
      if (imageState.b64) body.image = imageState.b64;
      if (state.domain === 'land') {
        if (duration.value) body.duration_days = Number(duration.value);
        if (area.value) body.area_m2 = Number(area.value);
      }
      if (!body.text) { ui.toast('write what the resident reported', 'err'); return; }
      submit.disabled = true;
      NIRI.clear(result);
      result.appendChild(NIRI.loading('filing…'));
      api.fileComplaint(body).then(function (out) {
        NIRI.clear(result);
        result.appendChild(intakeResult(out, body, state.domain));
        ui.toast(out.complaint.id + ' filed', 'ok');
      }).catch(function (err) {
        NIRI.clear(result);
        result.appendChild(ui.errorBox(err));
        ui.toast(err.detail, 'err');
      }).then(function () { submit.disabled = false; });
    });

    clusterBtn.addEventListener('click', function () {
      clusterBtn.disabled = true;
      api.runClustering().then(function (out) {
        ui.toast('clustering: ' + out.created.length + ' created, ' + out.updated.length +
                 ' updated — deterministic, so pressing it again changes nothing', 'ok');
        location.hash = '#/complaints?r=' + Date.now();
      }).catch(function (err) { ui.toast(err.detail, 'err'); })
        .then(function () { clusterBtn.disabled = false; });
    });

    return NIRI.section('Intake', null, el('div', { class: 'split-rail',
      style: '--rail:380px' }, [
      el('div', { class: 'card' }, [
        bar,
        el('div', { class: 'field' }, [el('label', { text: 'where' }), nodeSelect, hint]),
        el('div', { class: 'field' }, [el('label', { text: 'category (optional)' }), categorySelect,
          el('p', { class: 'hint' }, 'the assistant suggests one from the text; pick a value to '
            + 'override it before filing')]),
        el('div', { class: 'field' }, [el('label', { text: 'what the resident said' }), textInput]),
        extras,
        el('div', { class: 'field' }, [el('label', { text: 'photo (optional)' }), drop, fileInput]),
        el('div', { class: 'actions' }, [submit, clusterBtn,
          el('span', { class: 'small muted', text: 'POST /api/complaints · POST /api/cluster/run' })])
      ]),
      result
    ]));
  }

  function intakeResult(out, filedBody, domain) {
    var card = el('div', { class: 'draft-card' });
    var sug = out.suggestion || {};
    card.appendChild(el('div', { class: 'stamp-row' }, [
      NIRI.badge(out.complaint.id, 'plain'),
      NIRI.statusBadge(out.complaint.status),
      el('span', { class: 'small muted', text: 'filed at ' + out.complaint.timestamp }),
      out.ai ? NIRI.badge('assistant: ' + out.ai, 'plain') : null
    ]));
    card.appendChild(el('p', { class: 'small', text: '“' + out.complaint.text + '”' }));

    var fields = el('div', { class: 'grid cols-2', style: 'gap:10px' }, [
      el('div', { class: 'field' }, [el('label', { text: 'category read from the text' }),
                                     el('input', { value: sug.category || '', readOnly: true })]),
      el('div', { class: 'field' }, [el('label', { text: 'severity hint (a hint, not a verdict)' }),
                                     el('input', { value: sug.severity_hint || '', readOnly: true })]),
      el('div', { class: 'field' }, [el('label', { text: 'duration in days' }),
                                     el('input', { value: sug.duration_days === null ? '' : sug.duration_days,
                                                   readOnly: domain !== 'land' })]),
      el('div', { class: 'field' }, [el('label', { text: 'area in m²' }),
                                     el('input', { value: sug.area_m2 === null ? '' : sug.area_m2,
                                                   readOnly: domain !== 'land' })])
    ]);
    card.appendChild(el('h4', { text: 'confirm the extraction' }));
    card.appendChild(fields);
    card.appendChild(el('p', { class: 'small muted' },
      'the suggestion above is the assistant’s reading of your text. Complaints are append-only — '
      + 'if the reading is wrong, correct the field and re-file; the corrected row is the one an '
      + 'officer will see in the tracker.'));

    var override = el('input', { value: sug.category || '', placeholder: 'correct the category' });
    card.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [
      override,
      el('button', { class: 'ghost', text: 're-file with this category', on: { click: function () {
        var body = JSON.parse(JSON.stringify(filedBody));
        body.category = override.value;
        api.fileComplaint(body).then(function (again) {
          ui.toast(again.complaint.id + ' filed with category “' + body.category + '”', 'ok');
          location.hash = '#/complaints?r=' + Date.now();
        }).catch(function (err) { ui.toast(err.detail, 'err'); });
      } } })
    ]));

    if (out.nearest_sensor) {
      var near = out.nearest_sensor;
      card.appendChild(el('div', { style: 'margin-top:12px' }, [
        el('h4', { text: 'the pipes under that address' }),
        el('div', { class: 'row' }, [
          nodeLink(near.node_id, near.name),
          NIRI.badge(Math.round(near.distance_m) + ' m away', 'plain'),
          near.wqi ? NIRI.bandBadge(near.wqi) : NIRI.badge('no sensor reading', 'plain')
        ])
      ]));
    }
    /* out.cases = the cases this complaint now appears in; cluster.created/updated =
     * every case the whole re-run touched. They are different claims, so they are shown
     * separately instead of one list with a vague label on each chip. */
    var mine = out.cases || [];
    var touched = [].concat(out.cluster.created || [], out.cluster.updated || [])
      .filter(function (id, i, all) { return all.indexOf(id) === i && mine.indexOf(id) < 0; });
    card.appendChild(el('div', { style: 'margin-top:12px' }, [
      el('h4', { text: 'which cases it joined' }),
      mine.length
        ? el('div', { class: 'chips' }, mine.map(function (id) {
            return el('span', { class: 'row' }, [caseLink(id, id), ' ',
              NIRI.badge('this complaint', 'action')]); }))
        : NIRI.empty('it is on file but no case claims it yet — clustering runs on the whole '
                     + 'sample, so shared causes only collapse into a case when several reports '
                     + 'point at the same node'),
      touched.length
        ? el('p', { class: 'small muted', style: 'margin-top:8px' }, [
            'the same run revisited ', el('span', { class: 'chips' },
              touched.map(function (id) { return caseLink(id, id); })) ])
        : null
    ]));
    if (out.vision) {
      card.appendChild(el('p', { class: 'small muted' }, [
        NIRI.badge(out.vision.analysed ? 'image read by the assistant' : 'image: metadata only',
                   'plain', 'provider ' + out.vision.ai + ' · ' + out.vision.bytes + ' bytes'),
        ' ' + out.vision.note]));
    }
    return card;
  }

  function tracker(complaints, cases) {
    var map = complaintCaseMap(cases);
    var sorted = complaints.slice().sort(function (a, b) {
      return a.timestamp < b.timestamp ? 1 : -1;
    });
    return NIRI.section('Tracker', complaints.length + ' reports in the sample, newest first — '
      + 'status moves with the case it belongs to',
      NIRI.table([
        { label: 'id', get: function (c) { return c.id; } },
        { label: 'when', get: function (c) { return api.time(c.timestamp); } },
        { label: 'domain', get: function (c) { return c.domain; } },
        { label: 'where', get: function (c) { return nodeLink(c.node_id, api.nodeName(c.node_id)); } },
        { label: 'category', get: function (c) { return c.category; } },
        { label: 'report', get: function (c) { return c.text; } },
        { label: 'status', get: function (c) { return NIRI.statusBadge(c.status); } },
        { label: 'in case', get: function (c) {
            var ids = map[c.id];
            return ids && ids.length
                   ? el('span', {}, ids.map(function (id, i) { return [i ? ', ' : null, caseLink(id, id)]; }))
                   : el('span', { class: 'muted', text: 'not clustered' }); } }
      ], sorted));
  }

  /* ------------------------------------------------------------------ cases list */
  pages.cases = {
    title: 'Cases',
    sub: 'grouped complaints — the clustering decision is the rules engine’s, shown here verbatim',
    render: function (host, params) {
      host.appendChild(NIRI.loading('loading cases…'));
      var domain = params.domain || '';
      var status = params.status || '';
      Promise.all([api.cases(domain ? '?domain=' + encodeURIComponent(domain) : ''),
                   api.network()]).then(function (out) {
        var rows = out[0].cases;
        NIRI.clear(host);

        var filters = el('div', { class: 'row' }, [
          NIRI.badge(rows.length + ' cases', 'plain'),
          el('span', { class: 'muted small', text: 'domain:' }),
        ].concat(['', 'water', 'air', 'land'].map(function (value) {
          return el('button', { class: 'chip' + (domain === value ? ' active' : ''),
                                text: value || 'all', on: { click: function () {
            location.hash = '#/cases' + (value || status ? '?' + (domain ? 'domain=' + domain + '&' : '')
                + (status ? 'status=' + status : '') : '');
          } } });
        })));
        filters.appendChild(el('span', { class: 'muted small', text: 'status:' }));
        ['', 'Open', 'Investigating', 'Action Taken', 'Resolved'].forEach(function (value) {
          filters.appendChild(el('button', { class: 'chip' + (status === value ? ' active' : ''),
            text: value || 'all', on: { click: function () {
              var query = [];
              if (domain) query.push('domain=' + domain);
              if (value) query.push('status=' + value);
              location.hash = '#/cases' + (query.length ? '?' + query.join('&') : '');
            } } }));
        });
        host.appendChild(filters);

        host.appendChild(el('div', { style: 'margin-top:12px' }, NIRI.table([
          { label: 'severity', get: function (c) {
              return el('span', { class: 'row' }, [NIRI.severity(c), NIRI.overdueFlag(c)]); } },
          { label: 'case', get: function (c) {
              return el('div', {}, [caseLink(c.id, c.title),
                el('div', { class: 'small muted', text: c.id + ' · opened ' + api.time(c.created_at) })]); } },
          { label: 'domain', get: function (c) { return c.domain; } },
          { label: 'ward / node', get: function (c) { return nodeLink(c.node_id, api.nodeName(c.node_id)); } },
          { label: 'scope', get: function (c) { return NIRI.scopeBadge(c.scope); } },
          { label: 'status', get: function (c) { return NIRI.statusBadge(c.status); } },
          { label: 'reports', num: true, get: function (c) {
              return (c.evidence && c.evidence.complaints || []).length; } },
          { label: 'rule that made it', get: function (c) {
              return el('code', { class: 'small', text: (c.evidence && c.evidence.rule || '').slice(0, 90) }); } },
          { label: 'last action', get: function (c) {
              /* the escalation rule measures the action log, not the case row, so this
                 column shows the same stamp the OVERDUE badge was decided from. */
              return el('span', {}, [api.since(c.last_action || c.updated_at), ' ',
                       el('span', { class: 'muted small',
                                    text: '· row updated ' + api.since(c.updated_at) })]); } }
        ], rows)));
      }).catch(function (err) { NIRI.clear(host); host.appendChild(ui.errorBox(err)); });
    }
  };

  /* ------------------------------------------------------------------ case detail */
  pages.case = {
    title: 'Case',
    sub: 'evidence, trace, the standard it breaches, and a draft a human signs',
    render: function (host, params, caseId) {
      NIRI.clear(host);
      host.appendChild(NIRI.loading('loading ' + caseId + '…'));
      api.caseDetail(caseId).then(function (detail) {
        NIRI.clear(host);
        renderCase(host, detail);
      }).catch(function (err) {
        NIRI.clear(host);
        host.appendChild(ui.errorBox(err));
        host.appendChild(el('p', { style: 'margin-top:12px' },
                             link('#/cases', 'back to all cases')));
      });
    }
  };

  function renderCase(host, detail) {
    var row = detail.case;
    var ev = detail.evidence;

    host.appendChild(el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:14px' }, [
      el('div', {}, [
        el('div', { class: 'row' }, [NIRI.severity(row), NIRI.statusBadge(row.status),
                                     NIRI.scopeBadge(row.scope), NIRI.overdueFlag(row),
                                     NIRI.badge(row.domain + ' case', 'plain')]),
        el('h2', { style: 'margin-top:8px', text: row.title }),
        el('p', { class: 'muted small' }, [
          row.id + ' · at ', nodeLink(row.node_id, api.nodeName(row.node_id)),
          ' · opened ' + api.time(row.created_at)
          + ' · last action ' + api.since(row.last_action || row.updated_at)])
      ]),
      el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
        link('#/ask?case=' + encodeURIComponent(row.id), '✦ Explain this case', 'chip'),
        row.domain === 'water'
          ? el('button', { class: 'primary', text: 'Trace Upstream', on: { click: function () {
              location.hash = '#/map?t=' + encodeURIComponent(row.id);
            } } })
          : null
      ])
    ]));

    host.appendChild(el('div', { class: 'split-rail', style: '--rail:400px' }, [
      el('div', {}, [evidencePanel(row, ev, detail), standardsPanel(detail), traceSummary(row, detail)]),
      el('div', {}, [draftPanel(row, detail), timelinePanel(detail), transitionsPanel(row, detail)])
    ]));
  }

  function evidencePanel(row, ev, detail) {
    var bits = [];
    bits.push(NIRI.kv('shared cause', el('span', {}, [
      nodeLink(ev.shared_node, api.nodeName(ev.shared_node)),
      el('span', { class: 'muted small', text: ' — every report below it is in this one case' })])));
    bits.push(NIRI.kv('rule that fired', el('div', { class: 'rule-box', text: ev.rule })));
    if (ev.confidence !== null && ev.confidence !== undefined) {
      bits.push(NIRI.kv('confidence (0–1)', el('span', {}, [String(ev.confidence),
                  el('span', { class: 'muted', text: ' · from the rules engine' })])));
    }

    if (row.domain === 'water') {
      bits.push(NIRI.kv('readings vs limits', readingsVsLimits(ev)));
      if (ev.wqi) bits.push(NIRI.kv('water quality', NIRI.bandBadge(ev.wqi)));
      if (ev.coliform !== null && ev.coliform !== undefined) {
        bits.push(NIRI.kv('coliform', ev.coliform
                          ? NIRI.badge('PRESENT', 'emergency') : NIRI.badge('absent', 'action')));
      }
      if (ev.anomaly) {
        bits.push(NIRI.kv('anomaly', el('div', {}, [
          NIRI.badge(ev.anomaly.anomaly_flag ? 'flagged on ' + ev.anomaly.parameter : 'no anomaly',
                     ev.anomaly.anomaly_flag ? 'high' : 'plain'),
          el('div', { class: 'small muted', text: 'z = ' + ev.anomaly.z +
            (ev.anomaly.breach ? ' · limit breached' : '') }),
          ev.anomaly.ops_note ? el('div', { class: 'small', text: ev.anomaly.ops_note }) : null
        ])));
      }
      if (ev.flow_changed) {
        bits.push(NIRI.kv('supply change', el('div', {}, [
          el('code', { text: JSON.stringify(ev.flow_changed) }),
          el('div', { class: 'small muted', text: 'maintenance record: the feed to this ward changed' })
        ])));
      }
      if (ev.sibling_status) {
        bits.push(NIRI.kv('neighbouring wards', el('pre', { class: 'mono small',
          text: JSON.stringify(ev.sibling_status, null, 1) })));
      }
    } else if (row.domain === 'air') {
      if (typeof ev.aqi === 'number') {
        var band = aqiBand((ev.limits || {}).categories, ev.aqi);
        bits.push(NIRI.kv('air quality at the monitor', el('div', {}, [
          NIRI.badge(ev.aqi.toFixed(1) + (band ? ' · ' + band.name : ''),
                     band ? 'high' : 'plain',
                     band ? 'NAQI band ' + band.min + '–' + band.max + ' (' + band.colour + ')' : null),
          el('div', { class: 'small muted', text: 'reading taken ' + api.time(ev.readings.timestamp)
                                   + ' at ' + api.nodeName(ev.shared_node) }),
          el('div', { style: 'margin-top:8px' }, monitorTable(ev))
        ])));
      } else {
        bits.push(NIRI.kv('monitor readings', monitorTable(ev)));
      }
    } else {
      var landReadings = ev.readings || {};
      if (landReadings.duration_days !== undefined || landReadings.area_m2 !== undefined) {
        bits.push(NIRI.kv('what the report measured', el('div', { class: 'row' }, [
          NIRI.badge(landReadings.duration_days + ' days standing', 'plain'),
          NIRI.badge(landReadings.area_m2 + ' m²', 'plain')
        ])));
      }
      if (ev.proximity) {
        bits.push(NIRI.kv('proximity score', el('div', {}, [
          NIRI.badge(String(ev.proximity.score), 'high', 'weighted from config/rules.json'),
          el('ul', { class: 'factors' }, (ev.proximity.factors || []).map(function (f) {
            return el('li', {}, [
              NIRI.badge(f.met ? '+' + f.points : 'not met', f.met ? 'high' : 'plain'),
              ' ' + f.label + (f.within_m ? ' (within ' + f.within_m + ' m)' : ''),
              f.nearest ? el('div', { class: 'small muted',
                text: 'nearest ' + f.nearest.kind.replace(/_/g, ' ') + ' “' + f.nearest.feature
                      + '” at ' + Math.round(f.nearest.distance_m) + ' m' }) : null
            ]);
          }))
        ])));
      }
      if (ev.cross_link) {
        bits.push(NIRI.kv('link to the water', el('div', {}, [
          nodeLink(ev.cross_link.water_node, api.nodeName(ev.cross_link.water_node)),
          el('div', { class: 'small muted', text: ev.cross_link.direction + ' turbidity, trend '
                                   + ev.cross_link.trend })
        ])));
      }
    }

    bits.push(NIRI.kv('the reports behind it', el('div', {},
      (ev.complaints || []).map(function (id, i) {
        var complaint = (detail.complaints || []).filter(function (c) { return c.id === id; })[0] || {};
        return el('div', { class: 'row', style: 'padding:3px 0;gap:8px' }, [
          el('code', { text: id }),
          el('span', { class: 'small', text: complaint.text || '' }),
          complaint.node_id ? nodeLink(complaint.node_id, api.nodeName(complaint.node_id)) : null
        ]);
      }))));

    return el('section', { class: 'card section' }, [
      el('h3', { text: 'Evidence panel' }),
      el('p', { class: 'small muted', style: 'margin-bottom:10px' },
        'everything here is the server’s finding; the UI adds no judgement'),
      el('div', { class: 'evidence' }, bits)
    ]);
  }

  function readingsVsLimits(ev) {
    var readings = ev.readings || {};
    var limits = ev.limits || {};
    var flagged = ev.anomaly && ev.anomaly.breach ? ev.anomaly.parameter : null;
    var keys = Object.keys(readings).filter(function (k) { return k !== 'timestamp'; });
    if (!keys.length) return NIRI.empty('no sensor readings attached to this case');
    return NIRI.table([
      { label: 'parameter', get: function (k) { return k.replace(/_/g, ' '); } },
      { label: 'measured', num: true, get: function (k) { return readings[k]; } },
      { label: 'acceptable', num: true, get: function (k) {
          var l = limits[k]; return l ? fmtLimit(l.acceptable) : null; } },
      { label: 'permissible', num: true, get: function (k) {
          var l = limits[k]; return l ? fmtLimit(l.permissible) : null; } },
      { label: 'unit', get: function (k) { var l = limits[k]; return l ? l.unit : null; } },
      /* 'server flag' repeats what the payload already says — anomaly.parameter for the
         anomaly, and the `standards` rows for the breach. The UI decides nothing. */
      { label: 'server flag', get: function (k) {
          if (k === flagged) return NIRI.badge('anomaly on this parameter', 'high');
          var l = limits[k];
          return l && l.note ? el('span', { class: 'small muted', text: l.note }) : null; } }
    ], keys, {
      rowClass: function (k) { return k === flagged ? 'breach' : null; }
    });
  }
  function fmtLimit(value) {
    if (Array.isArray(value)) return value[1] === null ? value[0] + ' and up' : value[0] + '–' + value[1];
    return value;
  }

  /* NAQI category for a case: the number is served in evidence.aqi, the band table is served
     in evidence.limits.categories — this only picks the served row that contains the number. */
  function aqiBand(categories, value) {
    var hit = (categories || []).filter(function (c) { return value >= c.min && value <= c.max; })[0];
    return hit || null;
  }

  function monitorTable(ev) {
    var readings = ev.readings || {};
    /* an air reading row carries its station id and timestamp alongside the pollutants */
    var keys = Object.keys(readings).filter(function (k) {
      return k !== 'timestamp' && k !== 'station_id';
    });
    return NIRI.table([
      /* the served key carries the unit for water (turbidity_ntu, tds_mgl); air readings
         arrive as bare pollutant codes, so no unit column is asserted here. */
      { label: 'parameter', get: function (k) { return k.toUpperCase().replace(/_/g, ' '); } },
      { label: 'value', num: true, get: function (k) { return readings[k]; } }
    ], keys);
  }

  function standardsPanel(detail) {
    var rows = detail.standards || [];
    return el('section', { class: 'card section' }, [
      el('h3', { text: 'The standard it breaches' }),
      rows.length ? NIRI.table([
        { label: 'parameter', get: function (r) { return r.parameter; } },
        { label: 'acceptable', get: function (r) { return r.acceptable; } },
        { label: 'permissible', get: function (r) { return r.permissible; } },
        { label: 'unit', get: function (r) { return r.unit; } },
        { label: 'cited', get: function (r) { return el('code', { class: 'small', text: r.citation }); } }
      ], rows) : NIRI.empty('no breach against the shipped standards for this case'),
      detail.standards_excerpt
        ? el('details', { style: 'margin-top:10px' }, [
            el('summary', { class: 'small', text: 'the excerpt the citation comes from' }),
            el('pre', { class: 'rule-box', text: detail.standards_excerpt })])
        : null
    ]);
  }

  function traceSummary(row, detail) {
    if (row.domain !== 'water') {
      return el('section', { class: 'card section' }, [
        el('h3', { text: 'Trace' }),
        NIRI.empty('not a water case: the network trace answers 400 for ' + row.domain +
                   ', so there is no upstream path to draw')
      ]);
    }
    /* GET /api/cases/{id} already carries the trace, so the case page paints it from that
       payload instead of asking /api/trace/{id} for the same rows a second time. */
    var trace = detail.trace;
    if (!trace) {
      return el('section', { class: 'card section' }, [
        el('h3', { text: 'Trace Upstream' }),
        NIRI.empty('no upstream path on this case')
      ]);
    }
    return el('section', { class: 'card section' }, [
      el('h3', { text: 'Trace Upstream' }),
      el('div', { class: 'row' }, [
        NIRI.badge(trace.hops + ' hops', 'plain'),
        trace.worst_pipe ? NIRI.badge('worst section ' + trace.worst_pipe.id +
                                      ' · k=' + trace.worst_pipe_decay_k, 'high') : null
      ]),
      el('p', { class: 'draft-text', style: 'font-size:13.5px;margin-top:8px',
                text: trace.explanation }),
      NIRI.table([
        { label: '#', num: true, get: function (s, i) { return i + 1; } },
        { label: 'node', get: function (s) { return nodeLink(s.node_id, s.node_name); } },
        { label: 'type', get: function (s) { return s.node_type.replace(/_/g, ' '); } },
        { label: 'fed by', get: function (s) {
            return s.pipe ? el('code', { text: s.pipe.id + ' ' + s.pipe.material + ' '
                                  + s.pipe.diameter_mm + ' mm, laid ' + s.pipe.install_year })
                          : el('span', { class: 'muted', text: 'source end' }); } }
      ], trace.steps || []),
      el('p', { style: 'margin-top:8px' },
          link('#/map?t=' + row.id, 'draw this on the map →'))
    ]);
  }

  /* Draft + approve. The stamp is a fact about the payload, not a style choice. */
  function draftPanel(row, detail) {
    var card = el('section', { class: 'draft-card section' });
    var actor = el('input', { value: 'Officer R. Rao', placeholder: 'who is signing' });
    var role = el('input', { value: 'Ward Officer', placeholder: 'role' });
    var advance = el('select', {}, [el('option', { value: '', text: 'keep current status' })]
      .concat((detail.allowed_transitions || []).map(function (value) {
        return el('option', { value: value, text: 'advance to ' + value });
      })));
    var body = el('div');
    var actionsHost = el('div', { class: 'actions', style: 'margin-top:10px' });
    var draft = null;

    /* The advisory wording itself is not stored, but the signature is: read the action log
     * so a reload still shows that a human signed this case, instead of pretending the
     * case was never acted on. */
    var signed = (detail.actions || []).filter(function (a) { return /approved/i.test(a.action); }).pop();
    if (signed) {
      draft = { text: null, explanation: null, status: row.status, ai: null,
                approved: true, approved_by: signed.actor, role: signed.role };
      actor.value = signed.actor;
      if (signed.role) role.value = signed.role;
    }

    /* The buttons depend on `draft`, so they repaint with the draft — otherwise Approve
     * stays disabled after a re-draft and the demo dead-ends on the hero case. */
    function paintDraft() {
      NIRI.clear(body);
      NIRI.clear(actionsHost);
      buttons().forEach(function (node) { actionsHost.appendChild(node); });
      if (!draft) {
        body.appendChild(NIRI.empty('no advisory drafted for this case yet'));
        return;
      }
      var approved = draft.approved;
      body.appendChild(el('div', { class: 'stamp-row' }, [
        approved ? el('span', { class: 'approved-stamp', text: 'approved · ' + draft.status })
                 : el('span', { class: 'draft-stamp', text: 'draft — not sent' }),
        draft.ai ? NIRI.badge('written by ' + draft.ai + ' provider', 'plain') : null,
        el('span', { class: 'small muted', text: approved
                        ? 'signed by ' + draft.approved_by + (draft.role ? ' (' + draft.role + ')' : '')
                        : 'awaits a human signature' })
      ]));
      if (draft.text) {
        body.appendChild(el('p', { class: 'draft-text' + (approved ? ' approved' : ''),
                                  text: draft.text }));
      } else {
        body.appendChild(NIRI.empty('the signed wording is not kept on the case — the '
          + 'signature is in the history below. Re-draft to see what the current readings '
          + 'produce today.'));
      }
      if (draft.explanation) {
        body.appendChild(el('details', { style: 'margin-top:8px' }, [
          el('summary', { class: 'small', text: 'why this wording' }),
          el('p', { class: 'small', text: draft.explanation })]));
      }
    }

    function buttons() {
      return [
        el('button', { class: 'primary', text: draft ? 're-draft' : 'Draft advisory',
          on: { click: function () {
            api.draft(row.id).then(function (out) {
              draft = { text: out.text, explanation: out.explanation, status: out.status,
                        ai: out.ai, approved: false };
              paintDraft();
              ui.toast('drafted as ' + out.status + ' — nothing was sent', 'ok');
              reloadTimeline();
            }).catch(function (err) { ui.toast(err.detail, 'err'); });
          } } }),
        el('button', { text: 'Approve', disabled: !draft || draft.approved, on: { click: function () {
          var body2 = { actor: actor.value, role: role.value };
          if (advance.value) body2.advance_to = advance.value;
          api.approve(row.id, body2).then(function (out) {
            draft.approved = true;
            draft.status = out.status || out.case.status;
            draft.approved_by = out.approved_by;
            draft.role = role.value;
            paintDraft();
            ui.toast('approved by ' + out.approved_by + ' — case is ' + out.case.status, 'ok');
            reloadTimeline();
            setTimeout(function () { location.hash = '#/cases/' + row.id + '?r=' + Date.now(); }, 900);
          }).catch(function (err) { ui.toast(err.detail, 'err'); });
        } } }),
        el('span', { class: 'small muted', text: 'POST …/draft · POST …/approve' })
      ];
    }

    function reloadTimeline() {
      api.caseDetail(row.id).then(function (again) {
        NIRI.clear(timelineHost);
        timelineHost.appendChild(timelinePanel(again));
      }).catch(function () {});
    }

    card.appendChild(el('h3', { text: 'Advisory' }));
    card.appendChild(el('p', { class: 'small muted' },
      'the model writes support text only; severity, status and routing come from the rules. '
      + 'Nothing leaves as a notice until a human signs it.'));
    card.appendChild(body);
    card.appendChild(el('div', { class: 'grid cols-2', style: 'margin-top:10px' }, [
      el('div', { class: 'field' }, [el('label', { text: 'signing officer' }), actor]),
      el('div', { class: 'field' }, [el('label', { text: 'role' }), role])
    ]));
    card.appendChild(el('div', { class: 'field' }, [el('label', { text: 'on approval, advance to' }), advance]));
    card.appendChild(actionsHost);

    var timelineHost = el('div');
    paintDraft();
    /* look for an existing draft in the action log so a refreshed page stays honest */
    var drafted = (detail.actions || []).filter(function (a) { return /draft/i.test(a.action); });
    if (drafted.length) {
      card.insertBefore(el('p', { class: 'small muted',
        text: 'action log shows ' + drafted.length + ' draft(s) — re-draft to see the current wording' }), body);
    }
    return card;
  }

  function timelinePanel(detail) {
    var actions = (detail.actions || []).slice().reverse();
    return el('section', { class: 'card section' }, [
      el('h3', { text: 'History — who did what, when' }),
      actions.length
        ? el('ul', { class: 'timeline' }, actions.map(function (a) {
            return el('li', {}, [
              el('div', { class: 'who', text: a.action }),
              el('div', { class: 'small' }, a.actor + ' · ' + a.role),
              el('div', { class: 'when', text: api.time(a.timestamp) + ' (' + a.timestamp + ')' }),
              a.note ? el('div', { class: 'small muted', text: a.note }) : null
            ]);
          }))
        : NIRI.empty('no actions recorded yet')
    ]);
  }

  function transitionsPanel(row, detail) {
    var allowed = detail.allowed_transitions || [];
    var all = ['Open', 'Investigating', 'Action Taken', 'Resolved'];
    var actor = el('input', { value: 'Officer R. Rao' });
    var role = el('input', { value: 'Ward Officer' });
    var note = el('input', { value: 'Crew dispatched.' });
    var box = el('div');
    all.forEach(function (status) {
      var legal = allowed.indexOf(status) >= 0;
      box.appendChild(el('div', { class: 'row', style: 'margin-bottom:6px' }, [
        el('button', {
          text: status, disabled: !legal,
          title: legal ? 'legal next step from ' + row.status
                       : 'the server refuses ' + row.status + ' → ' + status,
          on: { click: function () {
            api.setStatus(row.id, { status: status, actor: actor.value, role: role.value,
                                    note: note.value })
              .then(function (out) {
                ui.toast(row.id + ' is now ' + out.case.status, 'ok');
                location.hash = '#/cases/' + row.id + '?r=' + Date.now();
              })
              .catch(function (err) {
                ui.toast('server refused: ' + err.detail, 'err');
              });
          } }
        }),
        el('span', { class: 'small muted', text: legal ? 'allowed' : 'not in allowed_transitions' })
      ]));
    });
    return el('section', { class: 'card section' }, [
      el('h3', { text: 'Status flow' }),
      el('p', { class: 'small muted' }, 'one step forward only — the server owns the whitelist. '
        + 'The reports that made this case move with it.'),
      el('div', { class: 'grid cols-2' }, [
        el('div', { class: 'field' }, [el('label', { text: 'actor' }), actor]),
        el('div', { class: 'field' }, [el('label', { text: 'role' }), role])
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'note for the log' }), note]),
      box,
      el('p', { class: 'small muted', style: 'margin-top:8px' },
        'PATCH /api/cases/' + row.id + '/status')
    ]);
  }

  /* ------------------------------------------------------------------ node detail page */
  pages.node = {
    title: 'Node detail',
    sub: 'the fourteen days behind the number, plus what the ward reported',
    render: function (host, params, nodeId) {
      NIRI.clear(host);
      host.appendChild(NIRI.loading('loading ' + nodeId + '…'));
      Promise.all([
        api.nodeDetail(nodeId),
        api.nodeReadings(nodeId).catch(function () { return null; }),
        api.nodeForecast(nodeId).catch(function () { return null; }),
        api.complaints(), api.cases(), api.network()
      ]).then(function (out) {
        var detail = out[0], readings = out[1], forecast = out[2];
        NIRI.clear(host);
        host.appendChild(el('div', { class: 'row', style: 'justify-content:space-between' }, [
          el('div', {}, [el('h2', { text: detail.node.name }),
            el('p', { class: 'muted small', text: detail.node.id + ' · '
              + detail.node.type.replace(/_/g, ' ')
              + (detail.node.zone_id ? ' · ward ' + detail.node.zone_id : '') })]),
          el('button', { class: 'ghost', text: 'show on map', on: { click: function () {
            location.hash = '#/map?n=' + encodeURIComponent(nodeId);
          } } })
        ]));

        var series = readings && readings.readings ? readings : null;
        if (series) {
          host.appendChild(readingsChart(detail, series));
        } else {
          host.appendChild(el('div', { class: 'card section' },
            [el('h3', { text: 'Readings' }),
             NIRI.empty(readings && readings.readings !== undefined
               ? 'this node has no sensor history — nothing to plot, and no invented line'
               : 'no sensor series for this node')]));
        }

        if (forecast) host.appendChild(forecastCard(nodeId, forecast));

        var detailCol = el('div', { class: 'card' });
        buildNodePanel(detailCol, detail, out[3], out[4], true);
        host.appendChild(el('div', { class: 'grid cols-2', style: 'align-items:start' }, [
          detailCol, networkColumn(out[5], nodeId)
        ]));
      }).catch(function (err) {
        NIRI.clear(host);
        host.appendChild(ui.errorBox(err));
        host.appendChild(el('p', { style: 'margin-top:12px' }, link('#/map', 'back to the map')));
      });
    }
  };

  function readingsChart(detail, payload) {
    var series = payload.readings;
    var step = Math.max(1, Math.round(series.length / 160));
    var kept = series.filter(function (r, i) { return i % step === 0 || i === series.length - 1; });
    var turbidity = kept.map(function (r) { return r.turbidity_ntu; });
    var chlorine = kept.map(function (r) { return r.residual_chlorine_mgl; });
    var anomaly = detail.anomaly;
    var bands = [];
    if (anomaly && anomaly.baseline_mean !== undefined) {
      bands.push({ low: anomaly.baseline_mean - anomaly.baseline_std,
                   high: anomaly.baseline_mean + anomaly.baseline_std,
                   label: 'baseline ± 1σ (' + anomaly.baseline_mean + ' ± ' + anomaly.baseline_std + ')' });
    }
    var chart = NIRI.lineChart({
      height: 260, dual: true, count: kept.length,
      series: [
        { name: 'turbidity', color: '#EA4335', values: turbidity, axis: 'left', lastDot: true },
        { name: 'chlorine', color: '#2F855A', values: chlorine, axis: 'right', lastDot: true }
      ],
      bands: bands,
      xlabels: [
        { index: 0, text: api.time(kept[0].timestamp), anchor: 'start' },
        { index: kept.length - 1, text: 'now ' + api.time(kept[kept.length - 1].timestamp), anchor: 'end' }
      ],
      label: 'turbidity and residual chlorine over ' + (payload.hours || kept.length * step) + ' hours'
    });
    return el('section', { class: 'card section' }, [
      el('h3', { text: (detail.node.name || '') + ' — ' + (payload.hours || 'history') + ' h of readings' }),
      NIRI.legend([{ color: '#EA4335', label: 'turbidity NTU (left axis)' },
                   { color: '#2F855A', label: 'residual chlorine mg/L (right axis)' }]),
      el('p', { class: 'small muted' }, series.length + ' hourly rows from '
        + (payload.sensor_id || 'the ward sensor') + ', thinned to ' + kept.length
        + ' points so the line stays readable — every value shown is a served value'),
      chart,
      anomaly && anomaly.flag
        ? el('p', { class: 'small' }, [NIRI.badge('anomaly', 'high', 'flagged by the server'),
            ' z = ' + anomaly.z + ' on ' + anomaly.parameter + ' at the demo clock'])
        : null
    ]);
  }

  function forecastCard(nodeId, forecast) {
    var projected = forecast.projected || [];
    var values = projected.map(function (p) { return p.value !== undefined ? p.value : p; });
    var marker = null;
    if (forecast.crossing_hours !== null && forecast.crossing_hours !== undefined) {
      var idx = Math.min(values.length - 1, Math.round(forecast.crossing_hours));
      marker = [{ index: idx, value: forecast.limit, label: 'crosses ' + forecast.limit + ' mg/L in '
                                + forecast.crossing_hours + ' h' }];
    }
    var chart = NIRI.lineChart({
      height: 200, count: values.length, zeroBase: false,
      series: [{ name: 'chlorine', color: forecast.breached_now ? '#EA4335' : '#2F855A',
                 values: values, lastDot: true }],
      limits: [{ value: forecast.limit, label: 'minimum ' + forecast.limit + ' mg/L (IS 10500)' }],
      markers: marker,
      xlabels: [{ index: 0, text: 'now', anchor: 'start' },
                { index: values.length - 1, text: '+' + forecast.horizon_hours + ' h', anchor: 'end' }],
      label: 'chlorine forecast'
    });
    return el('section', { class: 'card section' }, [
      el('h3', { text: 'Chlorine forecast — ' + api.nodeName(nodeId) }),
      el('div', { class: 'row' }, [
        NIRI.badge('now ' + forecast.current + ' mg/L', forecast.breached_now ? 'emergency' : 'plain'),
        NIRI.badge('crosses ' + forecast.limit + ' in ' + forecast.crossing_hours + ' h',
                   forecast.breached_now ? 'emergency' : 'medium'),
        NIRI.badge('method: ' + forecast.method + (forecast.decay_k ? ' · k=' + forecast.decay_k : ''), 'plain')
      ]),
      chart,
      el('p', { class: 'small muted' }, forecast.breached_now
        ? 'already below the minimum — this is an alarm, not a warning'
        : 'not breached yet: the dashed line is the minimum the standard publishes, the marker is '
          + 'where the projection crosses it')
    ]);
  }

  /* Where the node sits in the served graph — read off /api/network, not inferred. */
  function networkColumn(net, nodeId) {
    var host = el('div', { class: 'card' });
    if (!net) { host.appendChild(NIRI.empty('the network payload did not load')); return host; }
    var byId = {};
    net.nodes.forEach(function (n) { byId[n.id] = n; });
    var self = byId[nodeId];
    host.appendChild(el('h3', { text: 'Position in the network' }));
    if (!self) {
      host.appendChild(NIRI.empty('this id is not in /api/network — nothing to place'));
      return host;
    }

    var up = [];
    var walk = self;
    var guard = 0;
    while (walk && walk.parent_id && byId[walk.parent_id] && guard++ < 12) {
      walk = byId[walk.parent_id];
      up.push(walk);
    }
    host.appendChild(el('div', { class: 'field' }, [
      el('label', { text: 'upstream chain (served parent_id)' }),
      up.length
        ? el('div', { class: 'chips' }, up.map(function (n) { return nodeLink(n.id, n.name); }))
        : el('p', { class: 'small muted', text: 'nothing upstream of it — this is a source end' })
    ]));

    var down = net.nodes.filter(function (n) { return n.parent_id === self.id; });
    host.appendChild(el('div', { class: 'field' }, [
      el('label', { text: 'what it feeds (' + down.length + ')' }),
      down.length
        ? el('div', { class: 'chips' }, down.slice(0, 24).map(function (n) {
            return nodeLink(n.id, n.name + ' · ' + n.type.replace(/_/g, ' ')); }))
        : el('p', { class: 'small muted', text: 'a terminal — nothing is downstream' })
    ]));

    var touching = net.pipes.filter(function (p) {
      return p.from_node === self.id || p.to_node === self.id;
    });
    host.appendChild(el('div', { style: 'margin-top:12px' }, NIRI.table([
      { label: 'pipe', get: function (p) { return p.id; } },
      { label: 'direction', get: function (p) {
          return p.from_node === self.id ? 'out → ' + p.to_node : 'in ← ' + p.from_node; } },
      { label: 'mm', num: true, get: function (p) { return p.diameter_mm; } },
      { label: 'm', num: true, get: function (p) { return Math.round(p.length_m); } },
      { label: 'material', get: function (p) { return p.material; } },
      { label: 'laid', num: true, get: function (p) { return p.install_year; } }
    ], touching, { empty: 'no pipe record touches this node' })));

    var mini = NIRI.map.create({ nodes: net.nodes, pipes: net.pipes, preview: true, aspect: 1.5 });
    mini.focusNode(self.id);
    host.appendChild(el('div', { style: 'margin-top:14px' }, [
      el('h4', { text: 'on the map' }),
      mini.element,
      el('p', { class: 'small muted' }, el('span', {}, [link('#/map', 'open the full map →'),
                                    ' or ', el('a', { class: 'link', href: '#/map?n=' + encodeURIComponent(self.id),
                                                       text: 'centre it' })]))
    ]));
    return host;
  }

  NIRI.pages = pages;
}(window.NIRI));
