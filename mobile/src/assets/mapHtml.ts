export const MAP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>Festival Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var INK = '#1A1A2E';
    var AMBER = '#E8A838';
    var map = L.map('map', { zoomControl: true }).setView([51.9000, -2.0800], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '\\u00a9 OpenStreetMap contributors'
    }).addTo(map);
    var markers = [];
    function clearMarkers() { markers.forEach(function(m) { map.removeLayer(m); }); markers = []; }
    function addPins(pins) {
      clearMarkers();
      pins.forEach(function(pin) {
        if (!pin.lat || !pin.lng) return;
        var marker = L.circleMarker([pin.lat, pin.lng], {
          radius: 10, fillColor: AMBER, color: INK, weight: 2, opacity: 1, fillOpacity: 0.9
        }).addTo(map);
        marker.bindPopup('<b style="color:' + INK + '">' + (pin.name || 'Artist') + '<\\/b>');
        marker.on('click', function() {
          var msg = JSON.stringify({ type: 'ARTIST_TAPPED', profileID: pin.artist_id });
          if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
        });
        markers.push(marker);
      });
    }
    function handleMessage(event) {
      try {
        var msg = JSON.parse(event.data || event);
        if (msg.type === 'SET_PINS') addPins(msg.pins || []);
        else if (msg.type === 'SET_CENTER') map.setView([msg.lat, msg.lng], msg.zoom || 14);
      } catch (e) {}
    }
    window.addEventListener('message', handleMessage);
    document.addEventListener('message', handleMessage);
  </script>
</body>
</html>`
