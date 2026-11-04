/* pages_landing.js — Workstream B: the #/welcome landing page and the demo role switch.
 *
 * No passwords, no backend, no real auth. The role is one localStorage key in this
 * browser; the integrator owns the route table, the <script>/<link> tags, the brand
 * link and the sidebar "Switch role" button. This file only defines NIRI.role and
 * NIRI.pages.welcome and must load after components.js.
 *
 * landing.css collapses the shell (#sidebar/#topbar/#banner/#foot) via
 * `#view:has(> .landing-block)` — pure CSS, so nothing here touches app.js.
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var el = NIRI.el;
  /* SVG helper from components.js — it already owns the namespace constant, so the
     only URL in this whole app stays that one line in components.js. */
  var s = NIRI.s;

  var ROLES = {
    officer: {
      label: 'Officer',
      desc: 'City overview, cases, hotspots, advisories.',
      home: '#/'
    },
    citizen: {
      label: 'Citizen',
      desc: 'File a complaint and follow what happened to it.',
      home: '#/complaints'
    },
    building: {
      label: 'Building admin',
      desc: 'Building-side cases and shared-cause evidence.',
      home: '#/cases'
    }
  };

  /* ------------------------------------------------------------ demo role switch */
  NIRI.role = {
    KEY: 'niri.role',
    get: function () {
      try {
        var v = localStorage.getItem(this.KEY);
        return ROLES[v] ? v : null;
      } catch (e) { return null; }
    },
    set: function (role) {
      try { localStorage.setItem(this.KEY, String(role)); } catch (e) { /* private mode */ }
      NIRI.state = NIRI.state || {};
      NIRI.state.role = role;
    },
    clear: function () {
      try { localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ }
      NIRI.state = NIRI.state || {};
      NIRI.state.role = null;
    },
    home: function (role) {
      var r = ROLES[role];
      return r ? r.home : '#/';
    }
  };

  function enterRole(role) {
    NIRI.role.set(role);
    var next = (NIRI.state && NIRI.state.nextHash) || NIRI.role.home(role);
    NIRI.nav(next);
  }

  /* -------------------------------------------------------------- decorative SVG */
  /* The sidebar brand mark, same circle-and-swoop visual language. */
  function brandMark() {
    return s('svg', { viewBox: '0 0 32 32', class: 'landing-mark', 'aria-hidden': 'true' }, [
      s('circle', { cx: 16, cy: 16, r: 13, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
      s('path', { d: 'M9 19c3-6 7-8 14-8-4 3-5 6-5 9', fill: 'none', stroke: 'currentColor',
                  'stroke-width': 2, 'stroke-linecap': 'round' })
    ]);
  }

  /* Stylised Mumbai island: silhouette, creek channel, complaint dots on a shared cause. */
  function mapMotif() {
    return s('svg', { viewBox: '0 0 240 150', class: 'landing-map', 'aria-hidden': 'true',
                     role: 'img',
                     'aria-label': 'Decorative stylised island map with clustered report points' }, [
      s('path', { class: 'landing-land',
                  d: 'M58 16c24-7 50-3 65 9 13 10 7 24 15 33 9 11 23 8 31 18 9 11 1 27-14 33'
                   + '-18 7-41 5-57-4-13-8-10-21-19-30-10-10-25-8-32-19-8-12-1-33 11-40z' }),
      s('path', { class: 'landing-creek',
                  d: 'M199 30c-14 3-22 13-32 17-13 5-23 1-32 8-11 8-12 23-22 31-9 7-23 6-31 14' }),
      s('line', { class: 'landing-link', x1: 76, y1: 62, x2: 118, y2: 84 }),
      s('line', { class: 'landing-link', x1: 96, y1: 104, x2: 118, y2: 84 }),
      s('line', { class: 'landing-link', x1: 148, y1: 56, x2: 118, y2: 84 }),
      s('line', { class: 'landing-link', x1: 156, y1: 108, x2: 118, y2: 84 }),
      s('circle', { class: 'landing-dot', cx: 76, cy: 62, r: 3.5 }),
      s('circle', { class: 'landing-dot', cx: 96, cy: 104, r: 3.5 }),
      s('circle', { class: 'landing-dot', cx: 148, cy: 56, r: 3.5 }),
      s('circle', { class: 'landing-dot', cx: 156, cy: 108, r: 3.5 }),
      s('circle', { class: 'landing-hub', cx: 118, cy: 84, r: 5.5 })
    ]);
  }

  /* ------------------------------------------------------------------ the page */
  var SELECTED = 'officer';
  var PAGE = { host: null, params: {} };
  var GLYPH = { officer: '▦', citizen: '✎', building: '⌂' };
  var EMAIL = { officer: 'officer@nirikshan.demo', citizen: 'citizen@nirikshan.demo',
                building: 'admin@nirikshan.demo' };

  function proofItem(n, title, line) {
    return el('li', { class: 'landing-proof-item' }, [
      el('span', { class: 'landing-proof-num', 'aria-hidden': 'true', text: String(n) }),
      el('div', {}, [
        el('p', { class: 'landing-proof-title', text: title }),
        el('p', { class: 'landing-proof-line', text: line })
      ])
    ]);
  }

  function roleCard(role) {
    var r = ROLES[role], on = role === SELECTED;
    return el('button', {
      type: 'button', class: 'auth-account' + (on ? ' on' : ''), 'data-role': role,
      'aria-pressed': on ? 'true' : 'false',
      on: { click: function () { SELECTED = role; paint(); } }
    }, [
      el('span', { class: 'auth-account-icon', 'aria-hidden': 'true', text: GLYPH[role] }),
      el('span', { class: 'auth-account-body' }, [
        el('span', { class: 'auth-account-name', text: r.label }),
        el('span', { class: 'auth-account-mail', text: EMAIL[role] }),
        el('span', { class: 'auth-account-desc', text: r.desc })
      ]),
      el('span', { class: 'auth-radio', 'aria-hidden': 'true' })
    ]);
  }

  function paint() {
    var host = PAGE.host;
    if (!host) return;
    NIRI.clear(host);
    host.appendChild(el('div', { class: 'landing-block auth-block' }, [
      el('div', { class: 'auth-grid' }, [
        el('aside', { class: 'auth-brand' }, [
          el('div', { class: 'landing-brand auth-brandline' }, [
            brandMark(),
            el('div', {}, [
              el('p', { class: 'landing-brand-name', text: 'Nirikshan' }),
              el('p', { class: 'landing-brand-tag', text: 'Mumbai civic intelligence' })
            ])
          ]),
          el('h1', { class: 'auth-pitch' }, [
            'The city files its complaints.',
            el('span', { text: ' Nirikshan finds the one cause.' })
          ]),
          el('p', { class: 'auth-lede' },
            'Reports on water, air, land and waste are read as instrument readings, '
            + 'grouped against the pipeline network, and turned into cases with a '
            + 'standard cited and an officer’s signature.'),
          el('div', { class: 'auth-face' }, [mapMotif()]),
          el('dl', { class: 'auth-stats', 'aria-label': 'served city totals' }),
          el('ul', { class: 'auth-proof' }, [
            proofItem(1, 'Complaint → pipe', 'five reports, one upstream cause'),
            proofItem(2, 'Standard → citation', 'IS 10500, CPCB, SWM rules'),
            proofItem(3, 'Draft → signature', 'the assistant drafts, an officer signs')
          ])
        ]),
        el('main', { class: 'auth-panel' }, [
          el('p', { class: 'auth-eyebrow', text: 'Sign in' }),
          el('h2', { class: 'auth-title', text: 'Choose your desk' }),
          el('p', { class: 'auth-sub' },
            'Three demo identities, one shared city record. No password is asked for '
            + 'and no server session is created.'),
          el('div', { class: 'auth-accounts' }, ['officer', 'citizen', 'building'].map(roleCard)),
          el('div', { class: 'auth-identity' }, [
            el('span', { text: 'Continuing as' }),
            el('b', { text: EMAIL[SELECTED] })
          ]),
          el('button', { type: 'button', class: 'auth-go',
            on: { click: function () { enterRole(SELECTED); } } },
            ['Enter the ' + ROLES[SELECTED].label + ' desk', el('span', { text: '→' })]),
          el('p', { class: 'auth-note' },
            'Demo build · the identity is stored in this browser only, so a refresh '
            + 'keeps the desk and “Switch role” clears it.')
        ])
      ]),
      el('footer', { class: 'landing-foot' }, [
        el('span', { text: 'Synthetic sample data · demo build' }),
        el('span', { text: 'Automated findings support human judgment. They are not '
          + 'official regulatory decisions. · WQI: higher = worse' })
      ])
    ]));
    fillStats();
  }

  /* The left panel states the city’s served totals, not invented ones: if the API
     does not answer, the block simply stays empty. */
  function fillStats() {
    var slot = PAGE.host && PAGE.host.querySelector('.auth-stats');
    if (!slot || slot.dataset.filled) return;
    NIRI.api.get('/api/overview').then(function (o) {
      var k = (o && o.kpis) || {};
      var worst = k.worst_wqi || null;
      var cells = [
        [k.complaints_24h, 'complaints · 24 h'],
        [k.open_cases, 'open cases'],
        [worst && worst.score, 'worst WQI · ' + (worst ? worst.band : '')]
      ].filter(function (c) { return c[0] !== undefined && c[0] !== null; });
      slot.dataset.filled = '1';
      cells.forEach(function (c) {
        slot.appendChild(el('div', { class: 'auth-stat' }, [
          el('dt', { text: c[1] }),
          el('dd', { text: String(c[0]) })
        ]));
      });
    }).catch(function () { /* numbers optional, the page is not */ });
  }

  NIRI.pages = NIRI.pages || {};
  NIRI.pages.welcome = {
    title: 'Sign in',
    sub: 'demo identity — no password, no server session',
    render: function (host, params) {
      PAGE.host = host;
      PAGE.params = params || {};
      var stored = NIRI.role.get();
      if (stored) SELECTED = stored;
      paint();
    }
  };
}(window.NIRI));
