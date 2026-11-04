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
    location.hash = next;
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
    var r = ROLES[role];
    /* a <button> fires click for Enter and Space natively, so no key handler is needed */
    return el('button', {
      type: 'button',
      class: 'landing-role',
      'data-role': role,
      'aria-label': 'Enter as ' + r.label,
      on: { click: function () { enterRole(role); } }
    }, [
      el('span', { class: 'landing-role-glyph', 'aria-hidden': 'true',
                   text: role === 'officer' ? '▦' : role === 'citizen' ? '✎' : '⌂' }),
      el('span', { class: 'landing-role-body' }, [
        el('span', { class: 'landing-role-title', text: r.label }),
        el('span', { class: 'landing-role-desc', text: r.desc })
      ]),
      el('span', { class: 'landing-role-arrow', 'aria-hidden': 'true', text: '→' })
    ]);
  }

  NIRI.pages = NIRI.pages || {};
  NIRI.pages.welcome = {
    title: 'Welcome',
    sub: 'demo role switch — pick a pair of eyes and step inside',
    render: function (host, params) {
      var stored = NIRI.role.get();

      var continueSlot = el('div', { class: 'landing-continue' });
      if (stored) {
        continueSlot.appendChild(el('a', {
          class: 'landing-continue-btn',
          href: (params && params.next) || NIRI.role.home(stored),
          text: 'Continue as ' + ROLES[stored].label + ' →'
        }));
        /* local convenience; the persistent sidebar "Switch role" is wired by the
           integrator and is the only other place NIRI.role.clear() is called. */
        continueSlot.appendChild(el('button', {
          type: 'button', class: 'ghost landing-switch',
          title: 'Forget the stored role in this browser',
          on: { click: function () {
            NIRI.role.clear();
            NIRI.clear(host);
            NIRI.pages.welcome.render(host, params);
          } }
        }, 'Change'));
      }

      host.appendChild(el('div', { class: 'landing-block' }, [
        el('div', { class: 'landing-grid' }, [
          /* LEFT — what the product is */
          el('div', { class: 'landing-left' }, [
            el('div', { class: 'landing-brand' }, [
              brandMark(),
              el('div', {}, [
                el('p', { class: 'landing-brand-name', text: 'Nirikshan' }),
                el('p', { class: 'landing-brand-tag', text: 'Mumbai civic intelligence · demo build' })
              ])
            ]),
            el('h1', { class: 'landing-pitch' }, [
              'Complaints are sensors',
              el('br', {}),
              el('span', { class: 'landing-pitch-accent',
                           text: 'find the shared cause, route it, track it to closure' })
            ]),
            el('p', { class: 'landing-support' },
               'Citizen reports on water, air, land and waste are clustered against the '
             + 'drain and pipeline network, turned into investigated cases with standards '
             + 'citations, and followed to closure by a named officer.'),
            mapMotif(),
            el('ul', { class: 'landing-proof' }, [
              proofItem(1, 'Complaint-to-pipe clustering',
                        'five reports become one upstream cause'),
              proofItem(2, 'Standards with citations',
                        'every finding cites IS 10500 / CPCB / SWM'),
              proofItem(3, 'Human-approved advisory',
                        'the assistant drafts; an officer signs')
            ])
          ]),

          /* RIGHT — enter as */
          el('div', { class: 'landing-right' }, [
            continueSlot,
            el('div', { class: 'landing-right-head' }, [
              el('h2', { class: 'landing-enter', text: 'Enter as' }),
              el('span', { class: 'landing-badge', text: 'DEMO' })
            ]),
            el('div', { class: 'landing-roles' }, [
              roleCard('officer'), roleCard('citizen'), roleCard('building')
            ]),
            el('p', { class: 'landing-note' },
               'Demo role switch — stored in this browser only. No passwords.')
          ])
        ]),
        /* The landing hides the app banner, so it carries the same two promises itself. */
        el('footer', { class: 'landing-foot' }, [
          el('span', { text: 'Synthetic sample data · demo build' }),
          el('span', { text: 'Automated findings support human judgment. They are not '
            + 'official regulatory decisions. · WQI: higher = worse' })
        ])
      ]));
    }
  };
}(window.NIRI));
