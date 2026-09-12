/* Safari 12 / ES5. No React, Privy SDK, wallet key, or phone auth token here. */
(function () {
  'use strict';
  if (window.slotDemo) return;
  var session = null, generation = 0, deadline = 0, lastServerTime = 0;
  var polling = false, pairing = false, leaving = false, signing = false, connected = true, timer, balanceTimer;
  var lastActivity = 0, feedback = '', needsPair = false;
  function emitSession(data) { var event = document.createEvent('CustomEvent'); event.initCustomEvent('slot-session', false, false, data); window.dispatchEvent(event); }
  function el(id) { return document.getElementById(id); }
  function show(id, visible) { el(id).hidden = !visible; }
  function notice(message) { el('notice').textContent = message || ''; show('notice', !!message); }
  function request(path, data, callback) {
    var xhr = new XMLHttpRequest(), current = generation;
    xhr.open(data === null ? 'GET' : 'POST', '/api/relay' + path, true);
    xhr.timeout = 25000;
    if (data !== null) { xhr.setRequestHeader('Content-Type', 'application/json'); xhr.setRequestHeader('X-Slot-Request', '1'); }
    xhr.onload = function () {
      if (current !== generation) return;
      var result;
      try { result = JSON.parse(xhr.responseText); } catch (ignore) { callback('Response unavailable. Try again.', null, xhr.status); return; }
      callback(xhr.status >= 200 && xhr.status < 300 ? null : result.error || 'Operation not completed.', result, xhr.status);
    };
    xhr.onerror = xhr.ontimeout = function () { if (current === generation) callback('Connection lost. Check the Wi-Fi.', null, 0); };
    xhr.send(data === null ? null : JSON.stringify(data));
  }
  function updateDeadline(data) {
    if (data.serverTime >= lastServerTime) {
      lastServerTime = data.serverTime;
      deadline = Date.now() + Math.max(0, data.expiresAt - data.serverTime);
    }
  }
  function state(name, label, tone) {
    document.body.setAttribute('data-wallet-state', name);
    el('connection-light').className = 'status-tag ' + (tone || '');
    el('connection-light').textContent = label;
  }
  function transition(title, copy, label) {
    show('transition-panel', true); show('welcome', false); show('wallet-panel', false);
    el('transition-title').textContent = title; el('transition-copy').textContent = copy;
    el('transition-label').textContent = label || 'UN MOMENTO';
  }
  function network(ok) {
    connected = ok;
    show('connection-banner', !ok); show('retry', !ok);
    el('retry').textContent = 'Retry the connection ↗';
    if (session) draw();
    else if (!ok) {
      state('offline', 'OFFLINE', 'warning');
      transition('No signal.', 'Check the Wi-Fi. We will recover the session as soon as the connection is back.', 'CONNECTION LOST');
    }
  }
  function clearUser() {
    emitSession(null);
    session = null; deadline = 0; lastServerTime = 0; signing = false;
    show('wallet-panel', false); show('idle-warning', false); show('proof-dialog', false); show('deposit-panel', false);
    show('login-qr', false); show('qr-loading', true); show('proof-toggle', false); show('retry', false);
    el('login-qr').removeAttribute('src'); el('deposit-qr').removeAttribute('src');
    el('pair-code').textContent = '— — —'; el('balance').textContent = '—'; el('credit-display').textContent = '—';
    el('balance').removeAttribute('title'); el('balance').style.fontSize = '';
    el('short-address').textContent = ''; el('full-address').textContent = '';
    el('proof-value').textContent = ''; el('proof-message').textContent = '';
    el('machine-status').textContent = 'EVERY SPIN IS A TRANSACTION.';
    el('cabinet-label').textContent = 'YOUR SEAT IS WAITING';
    el('cabinet-copy').textContent = 'Scan the QR code with your phone to link your wallet.';
    el('footer-state').textContent = 'SCAN. LINK. SPIN.';
    el('sign-button').disabled = true; el('deposit-toggle').disabled = true;
    document.body.className = '';
    el('balance-status').textContent = 'Reading balance on Base…';
    window.clearTimeout(balanceTimer);
  }
  function draw() {
    if (!session || leaving) return;
    var data = session, authorized = data.grant && data.grant.active, proof = data.proof;
    show('session-feedback', !!feedback && data.state === 'pending'); el('session-feedback').textContent = feedback;
    if (data.state === 'pending') {
      document.body.className = feedback ? 'has-feedback' : '';
      state(connected ? 'signed-out' : 'offline', connected ? 'OPEN' : 'OFFLINE', connected ? '' : 'warning');
      show('transition-panel', false); show('welcome', true); show('wallet-panel', false);
      if (data.qr && el('login-qr').getAttribute('src') !== data.qr) el('login-qr').src = data.qr;
      show('login-qr', connected && !!data.qr); show('qr-loading', !connected || !data.qr);
      el('pair-code').textContent = connected ? data.code.slice(0, 3) + ' ' + data.code.slice(3) : '— — —';
      return;
    }
    el('login-qr').removeAttribute('src'); show('welcome', false);
    if (data.state === 'approved') {
      state('linking', 'LINKING', 'warning');
      transition('Your seat is opening.', 'Your phone confirmed the wallet. Finishing the link on this iPad.', 'WALLET RECOGNIZED');
      return;
    }
    show('transition-panel', false); show('wallet-panel', true);
    document.body.className = 'is-connected';
    var verified = proof && proof.status === 'verified';
    state(!connected ? 'offline' : verified ? 'verified' : authorized ? 'authorized' : 'awaiting-permission',
      !connected ? 'OFFLINE' : verified ? 'VERIFIED' : authorized ? 'LINKED' : 'LINKED', !connected ? 'warning' : 'connected');
    el('machine-status').textContent = !connected ? 'CONNECTION LOST' : 'THIS SEAT IS YOURS.';
    el('cabinet-label').textContent = 'WALLET LINKED';
    el('cabinet-copy').textContent = !connected ? 'Reconnecting…' : verified ? 'Link verified. Welcome aboard.' : authorized ? 'The signature proof is available on the iPad.' : 'Finish the approval on your phone.';
    el('footer-state').textContent = 'YOUR WALLET. YOUR SESSION. ONCHAIN.';
    var address = data.address || '';
    el('short-address').textContent = address.slice(0, 6) + ' ··· ' + address.slice(-6);
    el('full-address').textContent = address;
    if (data.depositQr && el('deposit-qr').getAttribute('src') !== data.depositQr) el('deposit-qr').src = data.depositQr;
    el('deposit-toggle').disabled = !address;
    el('sign-button').disabled = !connected || !authorized || !!proof || signing;
    show('sign-button', !verified); show('proof-toggle', !!verified);
    el('sign-button-label').textContent = signing || (proof && proof.status === 'pending') ? 'SIGNING…' : !authorized ? 'WAIT FOR YOUR PHONE' : proof ? 'PROOF NOT COMPLETED' : 'TEST THE LINK';
    el('signature-icon').textContent = verified ? '✓' : authorized ? '↗' : '02';
    el('signature-title').textContent = verified ? 'Signature verified.' : proof ? (proof.status === 'pending' ? 'Verifying…' : 'Proof not completed.') : authorized ? 'Your phone can rest.' : 'Approval pending.';
    el('signature-description').textContent = verified ? 'Link successful. No funds moved.' : proof ? (proof.status === 'pending' ? 'The wallet is signing the proof message.' : 'Log out and link the wallet again for a new proof.') : authorized ? 'Test the signature, even with your phone closed.' : 'The wallet is linked. Confirm on your phone to enable the signature proof.';
    if (verified) { el('proof-message').textContent = proof.message; el('proof-value').textContent = proof.signature; }
    checkDeadline();
  }
  function render(data) {
    if (leaving) return;
    if (session && session.id === data.id && data.serverTime < lastServerTime) return;
    var becameActive = data.state === 'active' && (!session || session.id !== data.id || session.state !== 'active');
    if (!session || session.id !== data.id) clearUser();
    session = data; updateDeadline(data); draw(); emitSession(data);
    if (becameActive) refreshBalance();
  }
  function refreshBalance() {
    window.clearTimeout(balanceTimer);
    if (!session || session.state !== 'active' || leaving) return;
    var id = session.id;
    request('/tablet/balance', null, function (error, result, status) {
      if (!session || session.id !== id) return;
      if (status === 401) { leave('expired'); return; }
      if (!error && result.sessionId === id) {
        var balance = result.balance;
        if (balance.amount !== null) {
          var parts = balance.amount.split('.'), fraction = (parts[1] || '') + '00';
          el('balance').textContent = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction.slice(0, 2);
          el('credit-display').textContent = el('balance').textContent;
          el('balance').title = balance.amount + ' USDC';
          el('balance').style.fontSize = parts[0].length > 6 ? '28px' : '';
        }
        el('balance-status').textContent = balance.stale ? (balance.amount === null ? 'Balance unavailable · retrying shortly' : 'Last known balance · update pending') : 'USDC on Base · balance up to date';
      } else el('balance-status').textContent = 'Last known balance · waiting for connection';
      balanceTimer = window.setTimeout(refreshBalance, 12000);
    });
  }
  function schedule() { window.clearTimeout(timer); if (!leaving) timer = window.setTimeout(poll, 2000); }
  function pair() {
    if (pairing || leaving) return;
    pairing = true; show('retry', false);
    if (connected) {state('restoring', 'ONE MOMENT'); transition('The seat is open.', 'Preparing a new QR code to link your wallet.', 'WELCOME TO THE FLOOR');}
    request('/pair', {}, function (error, data) {
      pairing = false;
      if (error) { network(false); notice(error); timer = window.setTimeout(pair, 8000); return; }
      needsPair = false; connected = true; show('connection-banner', false); notice(''); render(data); schedule();
    });
  }
  function poll() {
    if (polling || pairing || leaving || document.hidden) { schedule(); return; }
    // An offline logout can leave the old cookie alive. Retire it through /pair
    // before attempting session recovery, even when the network returns first.
    if (needsPair) { pair(); return; }
    polling = true;
    request('/tablet', null, function (error, data, status) {
      polling = false;
      if (status === 401) {
        connected = true; show('connection-banner', false);
        if (session && session.state !== 'pending') { leave('ended'); return; }
        clearUser(); pair(); return;
      }
      if (error) { network(false); schedule(); return; }
      connected = true; show('connection-banner', false); show('retry', false); notice('');
      render(data);
      if (data.state === 'approved') {
        request('/tablet/claim', {}, function (claimError, claimed, claimStatus) {
          if (claimStatus === 401) { leave('ended'); return; }
          if (claimError) {network(false); notice(claimError);} else {network(true); render(claimed);}
          schedule();
        });
      } else schedule();
    });
  }
  function leave(reason) {
    if (leaving) return;
    feedback = reason === 'expired' ? 'Session expired after 3 minutes of inactivity.' : reason === 'ended' ? 'The session was closed. The seat is open.' : reason === 'refresh' ? '' : 'You logged out. The wallet stays in your account.';
    leaving = true; needsPair = true; generation += 1; polling = false; pairing = false;
    window.clearTimeout(timer); clearUser(); notice('');
    state('ending', 'LEAVING'); transition('Freeing the seat.', 'Wallet data has been removed from this screen.', 'SEE YOU SOON, PLAYER');
    show('session-feedback', false);
    request('/tablet/logout', {}, function () { leaving = false; pair(); });
  }
  function activity(force) {
    if (!session || session.state !== 'active' || leaving) return;
    if (deadline && Date.now() >= deadline) { leave('expired'); return; }
    if (!force && Date.now() - lastActivity < 800) return;
    lastActivity = Date.now();
    var id = session.id;
    request('/tablet/activity', {}, function (error, data, status) {
      if (!session || session.id !== id) return;
      if (status === 401) { leave('ended'); return; }
      if (!error && data.sessionId === id) { updateDeadline(data); checkDeadline(); }
    });
  }
  function checkDeadline() {
    if (!session || !deadline || leaving) return;
    var left = deadline - Date.now(), seconds = Math.max(0, Math.ceil(left / 1000));
    if (left <= 0) { leave(session.state === 'pending' ? 'refresh' : 'expired'); return; }
    el('session-countdown').textContent = Math.floor(seconds / 60) + ':' + ('0' + seconds % 60).slice(-2);
    var warn = session.state === 'active' && left <= 30000;
    var wasHidden = el('idle-warning').hidden;
    show('idle-warning', warn);
    if (warn) { el('idle-seconds').textContent = String(seconds); if (wasHidden) el('stay').focus(); }
  }
  el('logout').onclick = el('idle-logout').onclick = function () {leave('manual');};
  el('retry').onclick = function () { window.clearTimeout(timer); poll(); };
  el('stay').onclick = function () { activity(true); };
  el('deposit-toggle').onclick = function () { if (!session || session.state !== 'active') return; show('deposit-panel', true); el('deposit-close').focus(); };
  el('deposit-close').onclick = function () {show('deposit-panel', false); el('deposit-toggle').focus();};
  el('sign-button').onclick = function () {
    if (!session || !session.grant || !session.grant.active || signing || !connected) return;
    signing = true; draw(); notice('');
    request('/tablet/sign', {}, function (error, data, status) {
      signing = false;
      if (status === 401) { leave('ended'); return; }
      if (error) { notice(error); if (!status) network(false); draw(); schedule(); } else render(data);
    });
  };
  el('proof-toggle').onclick = function () { show('proof-dialog', true); el('proof-close').focus(); };
  el('proof-close').onclick = function () { show('proof-dialog', false); el('proof-toggle').focus(); };
  function interaction(event) { if (event.isTrusted !== false) activity(false); }
  document.addEventListener('touchstart', interaction, {passive: true});
  document.addEventListener('mousedown', interaction);
  document.addEventListener('keydown', function (event) {
    interaction(event);
    if (event.key === 'Escape') { show('proof-dialog', false); show('deposit-panel', false); }
    var dialog = !el('idle-warning').hidden ? el('idle-warning') : !el('proof-dialog').hidden ? el('proof-dialog') : !el('deposit-panel').hidden ? el('deposit-panel') : null;
    if (event.key === 'Tab' && dialog) {
      var buttons = dialog.querySelectorAll('button:not([disabled])'), first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('offline', function () {network(false);});
  window.addEventListener('online', function () {poll();});
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { checkDeadline(); if (!leaving) poll(); } });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) { generation += 1; polling = false; pairing = false; leaving = false; clearUser(); state('restoring', 'CHECKING'); transition('Finding your seat.', 'Checking the session on this iPad.'); poll(); }
  });
  window.addEventListener('slot-expired', function () {leave('ended');});
  window.setInterval(checkDeadline, 500);
  poll();
}());
