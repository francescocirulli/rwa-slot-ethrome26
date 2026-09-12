/* Isolated ES5 simulation. Loaded before the real relay client, which exits in demo. */
(function () {
  'use strict';
  if (!/(?:^|[?&])demo=1(?:&|$)/.test(window.location.search)) return;
  var session = null, round = 0, credits = 2, cents = 25, spent = 0, started = 0, mode = '', result = null, deadline = 0;
  var model = window.slotDemoModel;
  function el(id) {return document.getElementById(id);}
  function show(id, visible) {el(id).hidden = !visible;}
  function emit(data) {var event = document.createEvent('CustomEvent'); event.initCustomEvent('slot-session', false, false, data); window.dispatchEvent(event);}
  function snapshot() {
    var game = null, operation = null, age = Date.now() - started;
    if (round) {
      var revealed = age >= 3200, confirmed = age >= 4300;
      game = {id: String(round), freeSpin: mode === 'free', pending: !revealed, hasResult: revealed, confirmed: confirmed,
        status: age < 2100 ? 'waiting' : !revealed ? 'revealable' : result.won ? 'won' : 'lost', targetBlock: '102',
        symbols: revealed ? result.symbols.slice() : [], won: revealed && result.won,
        matchCount: revealed ? result.matchCount : 0, winningLine: revealed ? result.winningLine : 255,
        winningSymbol: revealed ? result.winningSymbol : 255, payout: revealed ? result.payout : null};
      if (age < 900) operation = {stage: 'confirming', afterGameId: String(round - 1)};
      if (confirmed && spent !== round) {spent = round; if (result.payout && result.payout.kind === 3) credits += 1;}
    }
    return {configured: true, funding: {ready: true, assets: []}, sessionId: 'demo', block: String(!round || age < 900 ? 100 : age < 2100 ? 102 : age < 4300 ? 103 : 104), settings: {ticketPrice: '50000', paused: false, totalOutcomeWeight: 1000, configuredPrizeCount: 12}, keeper: {configured: true, canStartFreeSpin: true, balanceWei: '1'},
      player: {freeSpins: String(credits), allowance: '1000000', balance: String(cents >= 6 ? cents * 10000 : 0), latestGameId: String(round), historyReady: true, game: game, operation: operation}};
  }
  function balances() {el('balance').textContent = (cents / 100).toFixed(2); el('credit-display').textContent = el('balance').textContent;}
  function login() {
    round = 0; credits = 2; cents = 25; spent = 0; started = 0; result = null; deadline = Date.now() + 180000;
    session = {id: 'demo', state: 'active', expiresAt: deadline, serverTime: Date.now(), playGrant: {active: true}};
    document.body.className = 'is-connected'; show('welcome', false); show('wallet-panel', true);
    el('connection-light').textContent = 'DEMO'; el('balance-status').textContent = 'Simulated credit · no wallet';
    el('short-address').textContent = 'TEST ACCOUNT'; el('deposit-toggle').disabled = true;
    show('sign-button', false); document.querySelector('.signature-card').hidden = true;
    balances(); emit(session);
  }
  function logout() {
    session = null; deadline = 0; emit(null); document.body.className = ''; show('wallet-panel', false); show('welcome', true);
    el('balance').textContent = '—'; el('credit-display').textContent = '—'; el('connection-light').textContent = 'DEMO'; el('demo-outcome').disabled = false;
  }
  window.slotDemo = {request: function (path, body, callback) {
    window.setTimeout(function () {
      if (!session || Date.now() >= deadline) {callback('Demo session ended.', null, 401); return;}
      if (path === '/api/relay/tablet/spin') {
        if (round && Date.now() - started < 4300 || body.afterGameId !== String(round) || (body.mode === 'free' ? credits < 1 : cents < 6)) {callback('Demo spin unavailable.', null, 409); return;}
        if (body.mode !== 'free' && body.mode !== 'paid') {callback('Invalid demo mode.', null, 400); return;}
        try {result = model.draw(el('demo-outcome').value);} catch (error) {callback('Invalid demo outcome.', null, 400); return;}
        mode = body.mode; if (mode === 'free') credits--; else cents -= 6; // 5 cents + 1 cent illustrative gas, never a live quote.
        round++; started = Date.now(); deadline = Date.now() + 180000;
        session.serverTime = Date.now(); session.expiresAt = deadline; balances();
        callback(null, {operation: {stage: 'confirming', afterGameId: String(round - 1)}}, 202);
      } else callback(null, snapshot(), 200);
    }, 30);
  }};
  document.body.setAttribute('data-mode', 'demo');
  document.querySelector('.balance-heading h2').textContent = 'Demo player.';
  document.querySelector('.balance-label').textContent = 'SIMULATED CREDIT';
  el('footer-state').textContent = 'DEMO · NO TRANSACTIONS';
  show('transition-panel', false); show('welcome', true);
  el('welcome').innerHTML = '<div class="step-label">DEMO / NO REAL FUNDS</div><h2>Try your<br>luck.</h2><p class="panel-copy">Same slot, same odds as the contract, no transactions.<br>Simulate the login and pull the lever.</p><button id="demo-login" class="primary-button" type="button">ENTER AS DEMO PLAYER ↗</button><p class="qr-note">The QR code and wallet are used in live mode.</p>';
  var panel = document.createElement('div'); panel.className = 'demo-panel';
  var options = '<option value="random">Random · contract odds</option><option value="loss">No prize · 10.1%</option>';
  for (var symbol = 0; symbol < model.prizes.length; symbol++) {
    var prize = model.prizes[symbol], label = symbol === 11 ? 'JACKPOT (GOLD)' : prize.label;
    if (prize.three) options += '<option value="' + symbol + '-3">' + label + ' · 3/5 · ' + (prize.three / 10).toFixed(1) + '%</option>';
    if (prize.five) options += '<option value="' + symbol + '-5">' + label + ' · 5/5 · ' + (prize.five / 10).toFixed(1) + '%</option>';
  }
  panel.innerHTML = '<label for="demo-outcome">Next demo outcome</label><select id="demo-outcome">' + options + '</select><button id="demo-empty" class="text-button" type="button">Drain credits</button><button id="demo-reset" class="text-button" type="button">Reset demo</button>';
  document.querySelector('.control-panel').appendChild(panel);
  el('demo-login').onclick = login; el('logout').onclick = logout;
  el('demo-empty').onclick = function () {if (!session || !window.slotCanSwitchMode()) return; credits = 0; cents = 0; balances();};
  el('demo-reset').onclick = function () {if (!window.slotCanSwitchMode()) return; logout(); login();};
  document.querySelector('.panel-footnote p').textContent = 'DEMO · simulated prizes and credits. Logout after 3 minutes of inactivity.';
  window.addEventListener('slot-expired', logout);
  window.addEventListener('slot-game', function (event) {el('demo-outcome').disabled = event.detail.phase === 'spin';});
  function activity(event) {if (session && event.isTrusted && Date.now() < deadline) {deadline = Date.now() + 180000; session.expiresAt = deadline; session.serverTime = Date.now();}}
  document.addEventListener('mousedown', activity); document.addEventListener('touchstart', activity, {passive: true}); document.addEventListener('keydown', activity);
  window.setInterval(function () {if (!session) return; if (Date.now() >= deadline) {logout(); return;} var seconds = Math.ceil((deadline - Date.now()) / 1000); el('session-countdown').textContent = Math.floor(seconds / 60) + ':' + ('0' + seconds % 60).slice(-2);}, 500);
}());
