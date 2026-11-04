/* map_google.js — the optional real basemap.
 *
 * The schematic SVG is the product and the offline proof: it needs no key, no
 * tiles and no network. This file upgrades that same map to Google Maps when the
 * server reports a key, and does nothing at all otherwise. Every overlay below
 * is fed from the served payload: ward polygons from /api/wards, pipe geometry
 * and node colours from /api/network. Nothing here decides a band.
 *
 * If the script, the key or a tile fails, the schematic map is untouched, so the
 * demo can never end up on a blank canvas.
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var CACHE = null, LOADING = null, active = null;

  function config() {
    if (!CACHE) {
      CACHE = NIRI.api.get('/api/map-config').catch(function () {
        return { provider: 'schematic' };
      });
    }
    return CACHE;
  }

  function load(key) {
    if (LOADING) return LOADING;
    LOADING = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key='
            + encodeURIComponent(key) + '&libraries=visualization&v=weekly';
      s.async = true;
      s.onload = function () { resolve(window.google); };
      s.onerror = function () { reject(new Error('maps script failed')); };
      document.head.appendChild(s);
      window.setTimeout(function () { reject(new Error('maps timeout')); }, 12000);
    });
    return LOADING;
  }

  /* Warm paper with forest ink, so the basemap reads as the same product. */
  var STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#f2efe6' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#57534e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f5ef' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke',
      stylers: [{ color: '#d8d3c4' }] },
    { featureType: 'landscape.natural', elementType: 'geometry',
      stylers: [{ color: '#eaf1ea' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e4ebdf' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#fffdf7' }] },
    { featureType: 'road', elementType: 'geometry.stroke',
      stylers: [{ color: '#e2ddd0' }] },
    { featureType: 'road.highway', elementType: 'geometry',
      stylers: [{ color: '#f6e7c8' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#e8e2d4' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe3e7' }] }
  ];

  /* Offered, never forced: the schematic map is the default and the offline
     proof. A key only adds a "real basemap" switch to the Layers menu, so a bad
     key, a quota error or a dead network costs the demo nothing. */
  function offer(wrap, cfg) {
    if (!wrap || (cfg && cfg.preview)) return;
    config().then(function (out) {
      if (!out || out.provider !== 'google' || !out.key) return;
      var body = wrap.querySelector('.map-layers-body');
      if (!body) return;
      var row = document.createElement('label');
      row.className = 'map-layer-row';
      row.innerHTML = '<input type="checkbox"><span>real basemap</span>';
      var box = row.querySelector('input');
      box.addEventListener('change', function () {
        if (box.checked) enhance(wrap, cfg);
        else ungoogle(wrap);
      });
      body.appendChild(row);
    }).catch(function () { /* schematic stays */ });
  }

  function enhance(wrap, cfg) {
    if (!wrap || (cfg && cfg.preview) || active) return;
    config().then(function (out) {
      if (!out || out.provider !== 'google' || !out.key) return;
      attach(wrap, cfg, out.key);
    }).catch(function () { /* schematic stays */ });
  }

  function ungoogle(wrap) {
    var div = wrap.querySelector('.gmap');
    if (div) div.remove();
    var status = wrap.querySelector('.map-google-status');
    if (status) status.remove();
    wrap.classList.remove('google-on');
    active = null;
  }

  function attach(wrap, cfg, key) {
    var status = document.createElement('div');
    status.className = 'map-google-status';
    status.textContent = 'loading the real basemap\u2026';
    wrap.appendChild(status);

    load(key).then(function (google) {
      var nodes = (cfg.nodes || []).filter(function (n) { return n.lat && n.lon; });
      if (!nodes.length) throw new Error('no coordinates');
      var div = document.createElement('div');
      div.className = 'gmap';
      wrap.appendChild(div);

      var map = new google.maps.Map(div, {
        zoom: 13, center: { lat: nodes[0].lat, lng: nodes[0].lon },
        styles: STYLE, mapTypeControl: false, streetViewControl: false,
        fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy'
      });
      var bounds = new google.maps.LatLngBounds();
      nodes.forEach(function (n) { bounds.extend({ lat: n.lat, lng: n.lon }); });
      map.fitBounds(bounds, 28);

      (cfg.pipes || []).forEach(function (p) {
        var a = byId(nodes, p.from_node), b = byId(nodes, p.to_node);
        if (!a || !b) return;
        new google.maps.Polyline({
          map: map, path: [{ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon }],
          strokeColor: '#7a8f84', strokeOpacity: 0.55,
          strokeWeight: 1 + Math.log(Math.max(10, p.diameter_mm)) / Math.log(1000) * 1.6
        });
      });

      var info = new google.maps.InfoWindow();
      nodes.forEach(function (n) {
        if (n.type === 'zone') {
          new google.maps.Circle({
            map: map, center: { lat: n.lat, lng: n.lon }, radius: 620,
            fillColor: n.wqi ? (n.wqi.colour || '#9FB3A8') : '#9FB3A8',
            fillOpacity: 0.1, strokeColor: '#14532d', strokeOpacity: 0.35,
            strokeWeight: 1
          });
        }
        var mark = new google.maps.Marker({
          map: map, position: { lat: n.lat, lng: n.lon },
          title: n.name,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: n.type === 'building' ? 3.2 : 6,
            fillColor: n.wqi ? (n.wqi.colour || '#9FB3A8')
                     : (n.type === 'air_station' ? '#7E9AA8' : '#9FB3A8'),
            fillOpacity: 1, strokeColor: '#fffdf7', strokeWeight: 1.2
          }
        });
        mark.addListener('click', function () {
          var bits = ['<strong>' + esc(n.name) + '</strong>'];
          if (n.wqi) {
            bits.push('WQI ' + n.wqi.score + ' \u00b7 ' + esc(n.wqi.band));
          }
          if (n.latest && n.latest.turbidity_ntu !== undefined) {
            bits.push('turbidity ' + n.latest.turbidity_ntu + ' NTU');
            bits.push('chlorine ' + n.latest.residual_chlorine_mgl + ' mg/L');
          }
          info.setContent('<div class="gmap-info">' + bits.join('<br>') + '</div>');
          info.open({ map: map, anchor: mark });
          if (cfg.onSelect) cfg.onSelect(n);
        });
      });

      /* Ward zones from /api/wards: real lon/lat polygons, served fill. */
      NIRI.api.get('/api/wards').then(function (wardOut) {
        (wardOut.wards || []).forEach(function (w) {
          if (!w.polygon || w.polygon.length < 3) return;
          new google.maps.Polygon({
            map: map, paths: w.polygon.map(function (p) { return { lng: p[0], lat: p[1] }; }),
            fillColor: w.wqi ? (w.wqi.colour || '#9FB3A8') : '#9FB3A8',
            fillOpacity: 0.13, strokeColor: '#14532d', strokeOpacity: 0.45,
            strokeWeight: 1.2,
            label: { text: 'Ward ' + String(w.id).split('_').pop(), color: '#14532d',
                     fontSize: '11px', fontWeight: '600' }
          });
        });
      }).catch(function () { /* polygons are optional */ });

      /* Interpolated field: weights are the served score, never a new band. */
      var viz = google.maps.visualization;
      if (viz && viz.HeatmapLayer) {
        new viz.HeatmapLayer({
          map: map, radius: 38, opacity: 0.5,
          data: nodes.filter(function (n) { return n.wqi; }).map(function (n) {
            return { location: new google.maps.LatLng(n.lat, n.lon),
                     weight: Math.max(1, n.wqi.score) };
          }),
          gradient: ['rgba(52,168,83,0)', '#34A853', '#A8D08D', '#F4B400', '#EA4335']
        });
      }

      google.maps.event.addListenerOnce(map, 'idle', function () {
        wrap.classList.add('google-on');
        status.remove();
        active = { map: map, div: div };
      });
    }).catch(function () {
      status.remove();
      var stale = wrap.querySelector('.gmap');
      if (stale) stale.remove();
    });
  }

  function byId(nodes, id) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
    return null;
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  NIRI.mapGoogle = { offer: offer, config: config };
}(window.NIRI));
