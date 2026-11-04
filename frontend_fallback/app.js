/* Boot + router — docs/FRONTEND_SPEC.md §5. Hash routes only, no build step, no CDN.
     #/            officer dashboard
     #/map         network map (?t=<case> traces it, ?n=<node> centres and opens its panel)
     #/complaints  intake + tracker
     #/cases       case list, worst first
     #/cases/<id>  case detail
     #/nodes/<id>  node detail
     #/air         air quality
     #/land        land reports
     #/reports     reporting + daily summary
   Every page is rendered into #view by NIRI.pages; this file owns the shell, the demo
   clock, the AI badge, the disclaimer banner and the nav counts. */
(function (NIRI) {
  'use strict';

  var el = NIRI.el, api = NIRI.api, ui = NIRI.ui;

  var ROUTES = [
    { page: 'welcome', hash: '#/welcome', match: /^\/welcome$/, nav: 'Welcome', glyph: '✳',
      hidden: true },
    { page: 'dashboard', hash: '#/', match: /^\/$/, nav: 'City overview', glyph: '▦' },
    { page: 'map', hash: '#/map', match: /^\/map$/, nav: 'Network map', glyph: '⌗' },
    { page: 'complaints', hash: '#/complaints', match: /^\/complaints$/, nav: 'Complaints', glyph: '✎',
      count: function () { return api.complaints().then(function (d) { return d.count; }); } },
    { page: 'cases', hash: '#/cases', match: /^\/cases$/, nav: 'Cases', glyph: '⚑',
      count: function () { return api.cases().then(function (d) { return d.count; }); } },
    { page: 'air', hash: '#/air', match: /^\/air$/, nav: 'Air quality', glyph: '≈',
      count: function () { return api.air().then(function (d) { return d.stations.length; }); } },
    { page: 'land', hash: '#/land', match: /^\/land$/, nav: 'Land reports', glyph: '▲',
      count: function () { return api.land().then(function (d) { return d.count; }); } },
    { page: 'reports', hash: '#/reports', match: /^\/reports$/, nav: 'Reports', glyph: '☰' },
    { page: 'ask', hash: '#/ask', match: /^\/ask$/, nav: 'Ask Nirikshan', glyph: '✦' }
  ];
  /* detail screens are matched by prefix, then the rest of the path is the id */
  var DEEP = [{ prefix: '/cases/', page: 'case' }, { prefix: '/nodes/', page: 'node' }];

  var view = document.getElementById('view');
  var navHost = document.getElementById('nav');
  var titleEl = document.getElementById('page-title');
  var subEl = document.getElementById('page-sub');

  function parseHash() {
    var raw = String(location.hash || '#/').replace(/^#/, '');
    var q = raw.indexOf('?');
    var path = q < 0 ? raw : raw.slice(0, q);
    var query = {};
    if (q >= 0) {
      raw.slice(q + 1).split('&').forEach(function (pair) {
        if (!pair) return;
        var kv = pair.split('=');
        query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
    }
    if (!path || path === '/') path = '/';
    return { path: path, query: query };
  }

  function resolve(route) {
    for (var i = 0; i < ROUTES.length; i++) {
      if (ROUTES[i].match.test(route.path)) {
        return { def: ROUTES[i], params: route.query, arg: null };
      }
    }
    for (var j = 0; j < DEEP.length; j++) {
      if (route.path.indexOf(DEEP[j].prefix) === 0) {
        var id = decodeURIComponent(route.path.slice(DEEP[j].prefix.length));
        if (id) return { def: { page: DEEP[j].page }, params: route.query, arg: id };
      }
    }
    return null;
  }

  function paintNav(activePage) {
    NIRI.clear(navHost);
    ROUTES.forEach(function (def) {
      if (def.hidden) return;
      var counter = el('span', { class: 'count' });
      var a = el('a', { href: def.hash, class: def.page === activePage ? 'active' : null },
                 [def.glyph + ' ' + def.nav, counter]);
      navHost.appendChild(a);
      if (def.count) {
        def.count().then(function (n) { counter.textContent = String(n); })
          .catch(function () { counter.textContent = ''; });
      }
    });
  }

  /* An unknown hash is a bug in the UI, not the API — but the API's 404 envelope is shown
     anyway, because §11 asks for the server's `detail` on screen rather than a blank page. */
  function unknownRoute(path) {
    NIRI.clear(view);
    titleEl.textContent = 'No such screen';
    subEl.textContent = 'the hash you typed is not one of the nine pages';
    paintNav(null);
    var slot = el('div');
    view.appendChild(el('div', { class: 'card section' }, [
      el('h2', { text: 'No such screen' }),
      el('p', { class: 'muted small' }, '“#' + path + '” is not one of the nine pages in §5. '
        + 'Here is what the server says about that path, in its own words:'),
      slot
    ]));
    api.get('/api/nodes' + path).then(function (out) {
      slot.appendChild(el('pre', { class: 'mono small', text: JSON.stringify(out, null, 2) }));
    }).catch(function (err) {
      slot.appendChild(ui.errorBox(err));
    });
  }

  var ROLE_LABEL = { officer: 'Officer', citizen: 'Citizen', building: 'Building admin' };

  /* The role is a demo flag in localStorage only; nothing here is security. */
  function paintRole() {
    var role = NIRI.role ? NIRI.role.get() : null;
    var chip = document.getElementById('role-chip');
    var button = document.getElementById('switch-role');
    if (!chip || !button) return;
    chip.hidden = !role;
    button.hidden = !role;
    if (role) chip.textContent = ROLE_LABEL[role] + ' · demo';
  }

  function render() {
    var route = parseHash();
    var hit = resolve(route);
    if (!hit) { unknownRoute(route.path); return; }
    var page = NIRI.pages[hit.def.page];
    if (!page) { unknownRoute(route.path); return; }

    /* The deep link is remembered once, for the role picker; after the picker sends us
       somewhere it must not hijack the next role switch. */
    if (route.path !== '/welcome') NIRI.state.nextHash = null;

    document.body.dataset.page = hit.def.page;
    titleEl.textContent = page.title;
    subEl.textContent = page.sub || '';
    paintNav(hit.def.page);
    paintRole();
    ui.closePanel();
    NIRI.clear(view);
    page.render(view, hit.params, hit.arg);
    window.scrollTo(0, 0);
  }

  function paintShell(health) {
    NIRI.state.demoNow = health.demo_now;
    NIRI.state.ai = health.ai;
    NIRI.state.counts = health.counts || {};

    document.getElementById('clock').textContent = health.demo_now;
    var ai = document.getElementById('ai-mode');
    ai.textContent = 'AI: ' + health.ai;
    ai.className = 'ai-badge ' + (health.ai === 'online' ? 'online' : 'offline');
    ai.title = health.ai === 'online'
      ? 'a provider key is set — the drafts come from it; severity, status and routing still come from the rules'
      : 'no key — the deterministic fallback writer drafts the text, and every drafted block says so';

    var sentence = String(health.disclaimer || 'Automated findings support human judgment.');
    var split = sentence.indexOf('. ');
    document.getElementById('banner-strong').textContent =
      split > 0 ? sentence.slice(0, split + 1) : sentence;
    document.getElementById('banner-text').textContent =
      split > 0 ? sentence.slice(split + 2) : 'They are not official regulatory decisions.';
    document.getElementById('banner-data').textContent = health.data || 'synthetic sample data';
    document.getElementById('foot-disclaimer').textContent = sentence;
    document.getElementById('foot-data').textContent = 'data: ' + (health.data || 'synthetic sample data');

    var counts = health.counts || {};
    document.getElementById('foot-counts').textContent = Object.keys(counts).map(function (k) {
      return counts[k] + ' ' + k;
    }).join(' · ');
  }

  function boot() {
    api.health().then(paintShell).catch(function (err) {
      document.getElementById('clock').textContent = 'backend not reachable';
      document.getElementById('ai-mode').textContent = 'AI: unknown';
      NIRI.state.demoNow = null;
      view.appendChild(ui.errorBox(err));
      view.appendChild(el('p', { class: 'small muted', style: 'margin-top:12px' },
        'seed then serve:  ./.venv/Scripts/python.exe seed.py && '
        + './.venv/Scripts/python.exe -m uvicorn backend.app:app --port 8000'));
    }).then(function () {
      /* A demo link may carry ?role=officer so the page opens straight in that role.
         It writes the same localStorage flag the picker writes; there is no auth. */
      var roleParam = parseHash().query.role;
      if (roleParam && NIRI.role && /^(officer|citizen|building)$/.test(roleParam)) {
        NIRI.role.set(roleParam);
      }

      /* First visit wears the landing page. Any hash that was open is remembered and
         handed back after the role picker; an existing role goes straight in. */
      var stored = NIRI.role ? NIRI.role.get() : null;
      var raw = location.hash || '#/';
      if (!stored && raw.indexOf('#/welcome') !== 0) {
        if (raw !== '#/' && raw !== '') NIRI.state.nextHash = raw;
        location.hash = '#/welcome';
        return;
      }
      render();
    });
  }

  /* Demo role switch: keep the page under the picker, then give it back. */
  var switchRole = document.getElementById('switch-role');
  if (switchRole) {
    switchRole.addEventListener('click', function () {
      var raw = location.hash || '#/';
      if (raw.indexOf('#/welcome') !== 0) NIRI.state.nextHash = raw;
      if (NIRI.role) NIRI.role.clear();
      location.hash = '#/welcome';
    });
  }

  /* A write changes the numbers on three screens, so the next read is never a stale cache. */
  window.addEventListener('hashchange', function () {
    render();
  });

  /* clicking the page you are already on re-reads it — the demo uses this after a seed */
  navHost.addEventListener('click', function (ev) {
    var a = ev.target.closest ? ev.target.closest('a') : null;
    if (a && a.getAttribute('href') === location.hash) {
      ev.preventDefault();
      api.invalidate('');
      render();
      ui.toast('re-read from the server', 'ok');
    }
  });

  boot();
}(window.NIRI));
