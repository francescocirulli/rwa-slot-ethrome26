(function () {
  'use strict';
  function el(id) {return document.getElementById(id);}
  function text(id, value) {el(id).textContent = value;}
  function clear(node) {while (node.firstChild) node.removeChild(node.firstChild);}
  var labels = ['MAGNET','FREE SPIN','NVIDIA','HOPERA','SPACEX','APPLE','ALPHABET','AMAZON','ENS','URBE PASS','T-SHIRT','GOLD','BOOKS','WATER BOTTLE','CAPS','SYMBOL 15'];
  var wallet = '', mode = 'explore', page = 0, snapshot = '', applied = null, generation = 0, detailGeneration = 0, request = null, detailRequest = null, lastButton = null;
  var match = /(?:^#|&)player=(0x[0-9a-fA-F]{40})(?:&|$)/.exec(window.location.hash);
  if (match) wallet = match[1];
  var initialMode = /(?:^#|&)view=summary(?:&|$)/.test(window.location.hash);
  function short(value) {return value.slice(0, 6) + '…' + value.slice(-4);}
  function date(value) {return new Date(value * 1000).toLocaleString();}
  function get(url, done) {
    var xhr = new XMLHttpRequest();xhr.open('GET', url, true);xhr.timeout = 30000;
    xhr.onload = function () {var data;try {data = JSON.parse(xhr.responseText);} catch (error) {done('The archive is unavailable. Please retry.');return;}if(xhr.status !== 200) {done(data.error || 'The archive is unavailable. Please retry.');return;}done(null, data);};
    xhr.onerror = xhr.ontimeout = function () {done('Connection interrupted. Please retry.');};xhr.send();return xhr;
  }
  function query(params) {var parts = [];for(var key in params) if(Object.prototype.hasOwnProperty.call(params, key) && params[key] !== '') parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));return '/api/explorer?' + parts.join('&');}
  for(var i = 0; i < labels.length; i++) {var option = document.createElement('option');option.value = String(i);option.textContent = labels[i];el('symbol').appendChild(option);}
  function scopeChanged() {
    el('address-field').hidden = el('scope').value !== 'wallet';
    text('wallet-note', el('scope').value === 'mine' ? wallet ? 'Your wallet · ' + short(wallet) : 'Connect your wallet on the phone to see your results.' : 'Explore public, confirmed game results.');
  }
  function selectMode(value) {
    mode = value;el('explore-tab').className = mode === 'explore' ? 'selected' : '';el('summary-tab').className = mode === 'summary' ? 'selected' : '';
    el('explore-tab').setAttribute('aria-pressed', String(mode === 'explore'));el('summary-tab').setAttribute('aria-pressed', String(mode === 'summary'));
    el('advanced').hidden = mode === 'summary';el('scope').disabled = mode === 'summary';el('scope').value = mode === 'summary' ? 'mine' : 'all';scopeChanged();apply();
  }
  function filters() {
    var f = {mode:mode,period:el('period').value};
    if(el('scope').value === 'mine') {if(!wallet) throw new Error('Connect your wallet on the phone to see your summary and personal results.');f.player = wallet;}
    if(el('scope').value === 'wallet') {var address = el('address').value.replace(/^\s+|\s+$/g, '');if(!/^0x[0-9a-fA-F]{40}$/.test(address))throw new Error('Enter a complete wallet address.');f.player = address;}
    if(mode === 'explore') {f.won = el('result').value;f.matches = el('matches').value;f.symbol = el('symbol').value;f.prize = el('prize').value;}
    return f;
  }
  function busy(value) {document.body.className = value ? 'loading' : '';el('apply').disabled = value;el('refresh').disabled = value;}
  function invalidate() {generation++;if(request)request.abort();busy(false);el('results').hidden = true;closeDetail();}
  function apply() {
    invalidate();page = 0;snapshot = '';
    try {applied = filters();} catch(error) {applied = null;text('status', error.message);return;}
    load();
  }
  function load() {
    var token = ++generation, params = {}, key;
    if(!applied)return;
    for(key in applied) if(Object.prototype.hasOwnProperty.call(applied, key))params[key] = applied[key];
    params.page = String(page);if(snapshot)params.snapshot = snapshot;
    if(request)request.abort();busy(true);el('results').hidden = true;text('status', 'Querying the game archive…');
    request = get(query(params), function(error, data) {
      if(token !== generation)return;busy(false);
      if(error) {text('status', error);return;}
      snapshot = data.snapshot;render(data);
    });
  }
  function bar(parent, label, amount, total) {
    var row = document.createElement('div'), caption = document.createElement('div'), name = document.createElement('span'), count = document.createElement('span'), track = document.createElement('div'), fill = document.createElement('div');
    row.className = 'bar-row';caption.className = 'bar-label';name.textContent = label;count.textContent = String(amount);caption.appendChild(name);caption.appendChild(count);track.className = 'bar-track';fill.className = 'bar-fill';fill.style.width = (total ? amount / total * 100 : 0) + '%';track.appendChild(fill);row.appendChild(caption);row.appendChild(track);parent.appendChild(row);
  }
  function render(data) {
    el('results').hidden = false;
    text('status', data.indexing ? 'Some confirmed spins are still syncing. Refresh to check for updates.' : 'Snapshot ready · ' + date(data.timestamp));
    text('result-title', mode === 'summary' ? 'Your record.' : 'The results.');text('window-label', applied.period === 'season' ? data.season ? 'SEASON ' + data.season : 'SEASON NOT STARTED' : {day:'LAST 24 HOURS',week:'LAST 7 DAYS',month:'LAST 30 DAYS'}[applied.period]);
    text('spins', String(data.summary.spins));text('wins', String(data.summary.wins));text('points', String(data.summary.points));text('win-rate', data.summary.spins ? data.summary.winRate + '% of recorded spins' : 'No recorded spins');
    el('breakdown').hidden = mode !== 'summary';clear(el('combinations'));clear(el('symbol-bars'));
    bar(el('combinations'), '5 MATCHING', data.summary.five, data.summary.spins);bar(el('combinations'), '3 MATCHING', data.summary.three, data.summary.spins);bar(el('combinations'), 'NO WIN', data.summary.losses, data.summary.spins);
    for(var i = 0; i < data.summary.symbols.length; i++)bar(el('symbol-bars'), labels[data.summary.symbols[i].symbol], data.summary.symbols[i].wins, data.summary.wins);
    if(!data.summary.symbols.length)el('symbol-bars').textContent = 'Your winning symbols will appear here.';
    text('list-title', mode === 'summary' ? 'Your spin ledger' : 'Spin ledger');text('result-count', data.total + ' RESULTS');clear(el('rows'));
    for(var r = 0; r < data.rows.length; r++)addRow(data.rows[r]);
    el('empty').hidden = data.total !== 0;text('page-label', 'Page ' + (data.page + 1) + ' / ' + Math.max(1, Math.ceil(data.total / data.pageSize)));
    el('previous').disabled = data.page === 0;el('next').disabled = (data.page + 1) * data.pageSize >= data.total;
    text('coverage', applied.period === 'season' ? 'All matching current-season contributions, across every query page. Points follow the leaderboard. Contributions expire together at the season boundary.' : 'All matching records still retained in Arkiv. History retention: approximately ' + data.historyDays + ' days after publication. This is not a lifetime total.');
    text('snapshot', 'ARKIV SNAPSHOT #' + data.snapshot + ' · Use Refresh for the latest records.');
  }
  function addRow(row) {
    var button = document.createElement('button'), stamp = document.createElement('span'), main = document.createElement('span'), title = document.createElement('strong'), subtitle = document.createElement('small'), points = document.createElement('span'), unit = document.createElement('small');
    button.type = 'button';button.className = 'ledger-row';button.setAttribute('aria-label', 'View spin ' + row.gameId);stamp.className = 'game-stamp';stamp.textContent = '#' + row.gameId;main.className = 'row-main';title.textContent = row.won ? row.matches + ' MATCH · ' + labels[row.symbol] : 'NO WIN';subtitle.textContent = short(row.player) + ' · ' + date(row.playedAt);points.className = 'row-points';points.textContent = '+' + row.points;unit.textContent = 'PTS ↗';points.appendChild(unit);main.appendChild(title);main.appendChild(subtitle);button.appendChild(stamp);button.appendChild(main);button.appendChild(points);button.onclick = function () {openDetail(row, button);};el('rows').appendChild(button);
  }
  function grid(symbols) {
    clear(el('grid'));if(!symbols) {text('detail-status', 'The grid is no longer in the retained history. The Base receipt remains available.');return;}
    text('detail-status', 'Confirmed combination');
    for(var i = 0; i < symbols.length; i++) {var cell = document.createElement('div'), img = document.createElement('img'), name = document.createElement('span');cell.className = 'symbol-cell';img.src = '/symbols/symbol-' + symbols[i] + '.svg';img.alt = labels[symbols[i]];name.textContent = labels[symbols[i]];cell.appendChild(img);cell.appendChild(name);el('grid').appendChild(cell);}
  }
  function openDetail(row, button) {
    var token = ++detailGeneration;lastButton = button;el('detail').hidden = false;el('detail-close').focus();
    text('detail-title', 'Spin #' + row.gameId);text('detail-result', (row.won ? row.matches + ' matching · ' + labels[row.symbol] : 'No win') + ' · ' + row.points + ' points');text('detail-player', row.player);text('detail-time', date(row.playedAt));el('receipt-link').href = 'https://basescan.org/tx/' + row.transactionHash;
    if(row.symbols) {grid(row.symbols);return;}
    clear(el('grid'));text('detail-status', 'Loading the original grid…');
    detailRequest = get(query({game:row.gameId,player:row.player,period:'month'}), function(error, data) {
      if(token !== detailGeneration)return;
      if(error) {text('detail-status', 'Grid temporarily unavailable. You can still open the Base receipt.');return;}
      var original = data.rows[0];grid(original && original.transactionHash.toLowerCase() === row.transactionHash.toLowerCase() ? original.symbols : null);
    });
  }
  function closeDetail() {detailGeneration++;if(detailRequest)detailRequest.abort();el('detail').hidden = true;if(lastButton && document.body.contains(lastButton))lastButton.focus();lastButton = null;}
  function focusable() {
    var nodes = document.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])'), visible = [];
    for(var i = 0; i < nodes.length; i++)if(nodes[i].getClientRects().length)visible.push(nodes[i]);
    return visible;
  }
  window.addEventListener('message', function(event) {
    if(event.origin !== window.location.origin || event.source !== window.parent || !event.data || event.data.type !== 'arkiv-explorer-focus')return;
    var nodes = focusable();if(nodes.length)nodes[event.data.last ? nodes.length - 1 : 0].focus();
  });
  el('detail-close').onclick = closeDetail;
  document.addEventListener('keydown', function(event) {
    if(event.key === 'Escape') {if(!el('detail').hidden)closeDetail();else if(window.parent !== window)window.parent.postMessage({type:'arkiv-explorer-close'}, window.location.origin);}
    if(event.key === 'Tab' && el('detail').hidden && window.parent !== window) {
      var nodes = focusable(), firstNode = nodes[0], lastNode = nodes[nodes.length - 1];
      if(event.shiftKey && document.activeElement === firstNode || !event.shiftKey && document.activeElement === lastNode) {event.preventDefault();window.parent.postMessage({type:'arkiv-explorer-focus-close'}, window.location.origin);}
    }
    if(event.key === 'Tab' && !el('detail').hidden) {var first = el('detail-close'), last = el('receipt-link');if(event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}}
  });
  el('filters').onsubmit = function(event) {event.preventDefault();apply();};el('scope').onchange = scopeChanged;
  el('explore-tab').onclick = function () {selectMode('explore');};el('summary-tab').onclick = function () {selectMode('summary');};
  el('refresh').onclick = apply;el('reset').onclick = function () {el('filters').reset();selectMode(mode);};
  el('previous').onclick = function () {if(page > 0) {page--;load();}};el('next').onclick = function () {page++;load();};
  window.addEventListener('pagehide', function () {generation++;detailGeneration++;if(request)request.abort();if(detailRequest)detailRequest.abort();});
  scopeChanged();selectMode(initialMode ? 'summary' : 'explore');
  if(window.parent !== window)window.parent.postMessage({type:'arkiv-explorer-ready'}, window.location.origin);
}());
