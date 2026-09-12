(function () {
  'use strict';
  var open = document.getElementById('leaderboard-open');
  var dialog = document.getElementById('leaderboard-dialog');
  var close = document.getElementById('leaderboard-close');
  var title = document.getElementById('leaderboard-title');
  var countdown = document.getElementById('leaderboard-countdown');
  var status = document.getElementById('leaderboard-status');
  var rows = document.getElementById('leaderboard-rows');
  var view = null, received = 0, stream = null, timer = null;
  function hide() {dialog.hidden = true; open.focus();}
  open.addEventListener('click', function () {dialog.hidden = false; close.focus();});
  close.addEventListener('click', hide);
  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') hide();
    if (event.key === 'Tab') {
      var focusable = dialog.querySelectorAll('a,button');
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
    }
  });
  function clock() {
    if (!view || view.status === 'disabled') {countdown.textContent = '';return;}
    if (view.status !== 'live' || Date.now() - received > 15000) {countdown.textContent = 'Waiting for connection';return;}
    var remaining = Math.max(0, view.remainingSeconds - Math.floor((Date.now() - received) / 1000));
    var formatted = remaining >= 86400 ? Math.floor(remaining / 86400) + 'd ' + Math.floor(remaining % 86400 / 3600) + 'h ' + Math.floor(remaining % 3600 / 60) + 'm' : remaining >= 3600 ? Math.floor(remaining / 3600) + 'h ' + Math.floor(remaining % 3600 / 60) + 'm ' + remaining % 60 + 's' : Math.floor(remaining / 60) + ':' + ('0' + remaining % 60).slice(-2);
    countdown.textContent = remaining ? (view.season ? 'Next season · ' : 'First season · ') + formatted : 'Waiting for season change';
  }
  function render(next) {
    view = next; received = Date.now();
    title.textContent = view.season ? 'Season ' + view.season.id : 'Seasons';
    status.textContent = view.message || 'Live standings · 3 matches: 30 pts · 5 matches: 100 pts';
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    for (var i = 0; i < view.rows.length; i++) {
      var row = view.rows[i], tr = document.createElement('tr');
      var player = document.createElement('td'), wins = document.createElement('td'), points = document.createElement('td');
      player.textContent = (i + 1) + '. ' + row.player.slice(0, 6) + '…' + row.player.slice(-4);
      wins.textContent = String(row.wins);points.textContent = String(row.points);
      tr.appendChild(player);tr.appendChild(wins);tr.appendChild(points);rows.appendChild(tr);
    }
    if (!view.rows.length && view.status === 'live' && view.season && !view.indexing) status.textContent = 'No spins in this season yet.';
    clock();
  }
  function connect() {
    if (stream || !window.EventSource) return;
    stream = new EventSource('/api/leaderboard/stream');
    stream.addEventListener('standings', function (event) {try {render(JSON.parse(event.data));} catch (error) {status.textContent = 'Standings are temporarily unavailable.';}});
    stream.onerror = function () {if (view) view.status = 'unavailable';status.textContent = 'Reconnecting. Standings may be out of date.';clock();};
    timer = setInterval(clock, 1000);
  }
  window.addEventListener('pagehide', function () {if (stream) stream.close();stream = null;clearInterval(timer);});
  window.addEventListener('pageshow', connect);
  connect();
}());
