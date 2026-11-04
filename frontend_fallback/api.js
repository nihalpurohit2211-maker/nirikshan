/* api.js — the only place that talks to the backend.
 *
 * Rules this file enforces (docs/FRONTEND_SPEC.md §1 and §8):
 *  - errors are always the {"detail": "…"} envelope; a failed call rejects with those words
 *  - every call sends and remembers X-Request-Id
 *  - bulk endpoints are fetched once and shared; nothing loops /api/nodes/{id} per node
 *  - the demo clock (demo_now) is the only "now" the UI knows
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var cache = {};
  var inflight = {};

  function rid() {
    return 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function ApiError(status, detail, requestId) {
    this.status = status;
    this.detail = detail || ('request failed with HTTP ' + status);
    this.requestId = requestId;
    this.name = 'ApiError';
  }
  ApiError.prototype = Object.create(Error.prototype);

  function request(path, method, body) {
    var id = rid();
    var init = { method: method || 'GET', headers: { 'X-Request-Id': id } };
    if (body !== undefined && body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (resp) {
      var returned = resp.headers.get('X-Request-Id') || id;
      NIRI.ui && NIRI.ui.lastRequest(returned);
      return resp.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (!resp.ok) {
          var detail = payload && payload.detail ? payload.detail
                     : (text && text.slice(0, 200) || ('HTTP ' + resp.status));
          if (detail && typeof detail === 'object') detail = JSON.stringify(detail);
          throw new ApiError(resp.status, detail, returned);
        }
        if (payload === null && resp.status !== 204) {
          throw new ApiError(resp.status, 'the server sent a body this UI cannot read', returned);
        }
        return payload;
      });
    }, function (networkErr) {
      throw new ApiError(0, 'backend not reachable at ' + path + ' (' + networkErr + ')', id);
    });
  }

  /* A cached read: the same promise for the same key until something invalidates it,
     so two widgets asking for /api/network cause one request. */
  function cached(key, make) {
    if (key in cache) return Promise.resolve(cache[key]);
    if (inflight[key]) return inflight[key];
    inflight[key] = make().then(function (value) {
      cache[key] = value;
      delete inflight[key];
      return value;
    }, function (err) {
      delete inflight[key];
      throw err;
    });
    return inflight[key];
  }

  var api = {
    ApiError: ApiError,
    get: function (path) { return request(path, 'GET'); },
    post: function (path, body) { return request(path, 'POST', body === undefined ? {} : body); },
    patch: function (path, body) { return request(path, 'PATCH', body); },
    invalidate: function (prefix) {
      Object.keys(cache).forEach(function (key) {
        if (!prefix || key.indexOf(prefix) === 0) delete cache[key];
      });
    },
    cached: cached,

    health: function () { return cached('health', function () { return request('/api/health'); }); },
    overview: function () { return cached('overview', function () { return request('/api/overview'); }); },
    /* The node table is one bulk call, so every screen that shows a node gets its real
       name for free — nodeName() must never fall back to a bare id on a page that
       loaded the network itself (the map panel used to read "zone_3 · zone_3"). */
    network: function () {
      return cached('network', function () {
        return request('/api/network').then(function (net) {
          var byId = {};
          net.nodes.forEach(function (n) { byId[n.id] = n; });
          api._byId = byId;
          return net;
        });
      });
    },
    cases: function (query) {
      var key = 'cases' + (query || '');
      return cached(key, function () { return request('/api/cases' + (query || '')); });
    },
    complaints: function (query) {
      var key = 'complaints' + (query || '');
      return cached(key, function () { return request('/api/complaints' + (query || '')); });
    },
    air: function () { return cached('air', function () { return request('/api/air'); }); },
    land: function () { return cached('land', function () { return request('/api/land/reports'); }); },
    hotspots: function () { return cached('hotspots', function () { return request('/api/hotspots'); }); },

    /* Per-object reads are not cached forever — the case list may have moved on. */
    caseDetail: function (id) { return request('/api/cases/' + encodeURIComponent(id)); },
    nodeDetail: function (id) { return request('/api/nodes/' + encodeURIComponent(id)); },
    nodeReadings: function (id) { return request('/api/nodes/' + encodeURIComponent(id) + '/readings'); },
    nodeForecast: function (id) { return request('/api/nodes/' + encodeURIComponent(id) + '/forecast'); },
    stationReadings: function (id) {
      return request('/api/air/' + encodeURIComponent(id) + '/readings');
    },
    trace: function (id) { return request('/api/trace/' + encodeURIComponent(id)); },

    /* Every write invalidates the reads it can change, so the next render is honest. */
    fileComplaint: function (body) {
      return request('/api/complaints', 'POST', body).then(function (out) {
        api.invalidate('complaints'); api.invalidate('cases'); api.invalidate('overview');
        api.invalidate('network'); api.invalidate('land'); api.invalidate('hotspots');
        return out;
      });
    },
    runClustering: function () {
      return request('/api/cluster/run', 'POST', {}).then(function (out) {
        api.invalidate('cases'); api.invalidate('overview'); api.invalidate('hotspots');
        api.invalidate('complaints');
        return out;
      });
    },
    landReport: function (body) {
      return request('/api/land/reports', 'POST', body).then(function (out) {
        api.invalidate('land'); api.invalidate('complaints'); api.invalidate('cases');
        api.invalidate('overview'); api.invalidate('hotspots');
        return out;
      });
    },
    draft: function (id) {
      return request('/api/cases/' + encodeURIComponent(id) + '/draft', 'POST', {}).then(function (out) {
        api.invalidate('cases'); api.invalidate('overview');
        return out;
      });
    },
    setStatus: function (id, body) {
      return request('/api/cases/' + encodeURIComponent(id) + '/status', 'PATCH', body)
        .then(function (out) {
          api.invalidate('cases'); api.invalidate('overview');
          return out;
        });
    },
    approve: function (id, body) {
      return request('/api/cases/' + encodeURIComponent(id) + '/approve', 'POST', body)
        .then(function (out) {
          api.invalidate('cases'); api.invalidate('overview');
          return out;
        });
    },
    daily: function () { return request('/api/reports/daily', 'POST', {}); },

    /* Names come from the bulk payload — the UI never guesses a ward label. */
    names: function () {
      return cached('names', function () {
        return api.network().then(function (net) {
          var byId = {};
          net.nodes.forEach(function (n) { byId[n.id] = n; });
          api._byId = byId;
          return byId;
        });
      });
    },
    nodeName: function (id) {
      var n = api._byId && api._byId[id];
      return n ? n.name : (id || '—');
    },
    node: function (id) { return (api._byId && api._byId[id]) || null; },

    /* The demo clock, exactly as the server frames it. */
    demoNow: function () { return NIRI.state && NIRI.state.demoNow; },
    hoursSince: function (timestamp) {
      var now = Date.parse(api.demoNow().replace(' ', 'T'));
      var then = Date.parse(String(timestamp).replace(' ', 'T'));
      if (isNaN(now) || isNaN(then)) return null;
      return (now - then) / 3600000;
    },
    since: function (timestamp) {
      var h = api.hoursSince(timestamp);
      if (h === null) return '—';
      if (h < 0) return 'in ' + Math.abs(h).toFixed(1) + ' h';
      if (h < 1) return Math.round(h * 60) + ' min ago';
      if (h < 48) return h.toFixed(1) + ' h ago';
      return (h / 24).toFixed(1) + ' days ago';
    },
    time: function (stamp) {
      var s = String(stamp || '').replace(' ', 'T');
      var d = new Date(s);
      if (isNaN(d.getTime())) return stamp || '—';
      return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit',
                                        minute: '2-digit' })
             .replace(',', '');
    }
  };

  NIRI.api = api;
  NIRI.state = NIRI.state || {};
}(window.NIRI));
