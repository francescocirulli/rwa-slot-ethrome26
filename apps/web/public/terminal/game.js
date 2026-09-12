/* Onchain slot controller, deliberately ES5 for the shared Safari 12 terminal. */
(function () {
  'use strict';
  var currentSession = null, revision = 0, snapshot = null, fetching = false, sending = false, timer, online = true, shownResult = '', settleTimer, hardwareState = '', observedPending = false, configuredState = null;
  var lines = [[5,6,7,8,9], [0,1,7,13,14], [10,11,7,3,4]];
  var labels = ['MAGNET','FREE SPIN','NVIDIA','HOPERA','SPACEX','APPLE','ALPHABET','AMAZON','ENS','URBE PASS','T-SHIRT','GOLD','BOOKS','WATER BOTTLE','CAPS','SYMBOL 15'];
  function el(id) {return document.getElementById(id);}
  function show(id, value) {el(id).hidden = !value;}
  function xhr(path, body, callback) {
    var generation = revision;
    if (window.slotDemo) {window.slotDemo.request(path, body, function (error, data, code) {if (generation === revision) callback(error, data, code);}); return;}
    var request = new XMLHttpRequest();
    request.open(body ? 'POST' : 'GET', path, true); request.timeout = 25000;
    if (body) {request.setRequestHeader('Content-Type', 'application/json'); request.setRequestHeader('X-Slot-Request', '1');}
    request.onload = function () {if (generation !== revision) return; var data; try {data = JSON.parse(request.responseText);} catch (ignore) {callback('Onchain response unavailable.', null, request.status); return;} callback(request.status >= 200 && request.status < 300 ? null : data.error || 'Operation unavailable.', data, request.status);};
    request.onerror = request.ontimeout = function () {if (generation === revision) callback('Onchain connection lost.', null, 0);};
    request.send(body ? JSON.stringify(body) : null);
  }
  function amount(units) {
    var value = String(units || '0'); while (value.length < 7) value = '0' + value;
    var integer = value.slice(0,-6), decimals = value.slice(-6).replace(/0+$/, '');
    return integer + (decimals ? '.' + decimals : '');
  }
  function atLeast(left, right) {left = String(left).replace(/^0+/, '') || '0'; right = String(right).replace(/^0+/, '') || '0'; return left.length > right.length || left.length === right.length && left >= right;}
  function status(phase, title, detail) {el('game-phase').textContent = phase; el('game-title').textContent = title; el('game-detail').textContent = detail || '';}
  function feedback(data) {var key = JSON.stringify(data); if (key === hardwareState) return; hardwareState = key; var event = document.createEvent('CustomEvent'); event.initCustomEvent('slot-game', false, false, data); window.dispatchEvent(event);}
  function spin(value) {document.querySelector('.machine').classList.toggle('is-spinning', value); document.querySelector('.reels').setAttribute('aria-busy', value ? 'true' : 'false');}
  function resetGrid() {
    var cells = document.querySelectorAll('.cell');
    for (var index = 0; index < cells.length; index++) {cells[index].classList.remove('winner'); cells[index].removeAttribute('data-result-symbol');}
  }
  function reelSource(symbol) {return symbol === 11 ? '/symbols/jackpot.svg' : '/symbols/symbol-' + symbol + '.svg';}
  function hideResult() {show('game-tx', false); el('game-tx').removeAttribute('href'); el('game-tx').removeAttribute('title'); el('game-tx').textContent = ''; show('won-prize', false); document.querySelector('.game-progress').classList.remove('game-won');}
  function finalGrid(game) {
    var reels = document.querySelectorAll('.reel'), winning = game.won && lines[game.winningLine] ? lines[game.winningLine].slice(0, game.matchCount) : [];
    for (var column = 0; column < 5; column++) for (var row = 0; row < 3; row++) {
      var index = row * 5 + column, symbol = game.symbols[index], cell = reels[column].children[row], picture = cell.querySelector('img');
      picture.src = reelSource(symbol); picture.alt = symbol === 11 ? 'JACKPOT' : labels[symbol] || 'Symbol ' + symbol;
      cell.setAttribute('data-result-symbol', String(symbol)); cell.classList.toggle('winner', winning.indexOf(index) !== -1);
    }
  }
  function clear() {
    observedPending = false; configuredState = null; feedback({phase: 'idle', ready: false});
    revision++; snapshot = null; fetching = false; sending = false; shownResult = ''; window.clearTimeout(timer); timer = null; window.clearTimeout(settleTimer);
    spin(false); resetGrid(); hideResult(); hideOutcome(); show('game-availability', false); show('game-controls', false); show('game-unconfigured', true); show('play-consent-status', false);
    document.body.classList.remove('game-enabled');
    document.body.classList.remove('has-free-spins'); show('free-spin-summary', false);
    el('free-spin-balance').textContent = '—'; el('free-spin-count').textContent = '—'; el('free-spin-note').textContent = '';
    el('spin-paid').disabled = true; el('spin-free').disabled = true; el('ticket-display').textContent = '—'; el('wins-display').textContent = '—';
    var originals = [2, 1, 0, 4, 3, 5, 6, 11, 8, 7, 9, 10, 11, 2, 1];
    var images = document.querySelectorAll('.cell img');
    for (var i = 0; i < images.length; i++) {images[i].src = reelSource(originals[i]); images[i].alt = originals[i] === 11 ? 'JACKPOT' : labels[originals[i]];}
  }
  function prizeName(game, prize) {
    var isGold = prize.kind === 1 && String(prize.token || '').toLowerCase() === '0xe908475f8beb7a138b0dc6eb5a05cb27068ffb9a';
    if (prize.kind === 1 && prize.decimals === null) return 'base units of ' + (isGold ? 'Gold (DGLD)' : prize.tokenSymbol || 'token');
    if (isGold) return 'Gold (DGLD)';
    if (prize.kind === 3) return 'free spin';
    if (prize.kind === 2) return labels[game.winningSymbol];
    // Tokenized stocks: a 3/5 pays the half-share dividend, a 5/5 pays the full stock amount.
    if (prize.kind === 1 && labels[game.winningSymbol]) return labels[game.winningSymbol] + (game.matchCount === 3 ? '_Dividend' : '_Stock');
    return prize.tokenSymbol || 'token units';
  }
  var outcomeTimer;
  function hideOutcome() {
    window.clearTimeout(outcomeTimer); show('outcome', false); el('outcome').className = 'outcome';
    var machine = document.querySelector('.machine'); machine.classList.remove('tier-3'); machine.classList.remove('tier-5'); machine.classList.remove('tier-jackpot'); machine.classList.remove('tier-loss');
    document.documentElement.classList.remove('jackpot-on');
  }
  // Display only: the big result card and the cabinet lights for the confirmed onchain outcome.
  function showOutcome(game) {
    var jackpot = !!game.won && game.matchCount === 5 && game.winningSymbol === 11;
    var tier = !game.won ? 'loss' : jackpot ? 'jackpot' : game.matchCount === 5 ? '5' : '3';
    var box = el('outcome'); box.className = 'outcome outcome-' + tier;
    var fx = el('outcome-fx'); fx.innerHTML = '';
    if (game.won) {
      // Stars for a 3 of 5, dollars for a 5 of 5, gold bars raining for the jackpot.
      var count = jackpot ? 26 : 10;
      for (var i = 0; i < count; i++) {
        var piece;
        if (jackpot) {piece = document.createElement('img'); piece.src = '/decor/gold.svg'; piece.alt = ''; piece.style.width = (28 + Math.random() * 30) + 'px';}
        else {piece = document.createElement('span'); piece.textContent = game.matchCount === 5 ? '$' : '★'; piece.style.fontSize = (14 + Math.random() * 12) + 'px';}
        piece.style.left = (2 + Math.random() * 94) + '%'; piece.style.animationDelay = (Math.random() * 1.6) + 's'; fx.appendChild(piece);
      }
    }
    el('outcome-kicker').textContent = jackpot ? 'GOLD · 5 OF A KIND' : game.won ? (game.matchCount === 5 ? '5 OF A KIND' : '3 OF A KIND') : 'NO PRIZE';
    el('outcome-title').textContent = jackpot ? 'JACKPOT!' : game.won ? 'YOU WIN' : 'YOU LOST';
    if (jackpot) document.documentElement.classList.add('jackpot-on');
    el('outcome-copy').textContent = game.won ? 'Congrats, you win ' + (game.payout ? game.payout.formattedAmount + ' ' + prizeName(game, game.payout) : 'a prize') + '!' : 'Sorry, the market was not on your side. Spin again!';
    if (game.won) {el('outcome-prize').src = game.winningSymbol === 11 ? '/symbols/jackpot.svg' : '/symbols/symbol-' + game.winningSymbol + '.svg'; show('outcome-prize', true);} else show('outcome-prize', false);
    document.querySelector('.machine').classList.add('tier-' + tier);
    show('outcome', true);
    window.clearTimeout(outcomeTimer); outcomeTimer = window.setTimeout(hideOutcome, jackpot ? 9000 : game.won ? 5000 : 3000);
  }
  function resultText(game) {
    var hash = game.transactionHash;
    if (/^0x[0-9a-fA-F]{64}$/.test(hash || '')) {el('game-tx').href = 'https://basescan.org/tx/' + hash; el('game-tx').title = hash; el('game-tx').textContent = 'Transaction ' + hash.slice(0, 8) + '…' + hash.slice(-6) + ' ↗'; show('game-tx', true);} else {show('game-tx', false); el('game-tx').removeAttribute('href'); el('game-tx').removeAttribute('title');}
    show('won-prize', !!game.won && !!game.payout);
    document.querySelector('.game-progress').classList.toggle('game-won', !!game.won);
    if (game.won && game.payout) {el('won-prize').src = '/symbols/symbol-' + game.winningSymbol + '.svg'; el('won-prize').alt = labels[game.winningSymbol] || 'Prize'; show('won-prize', true);}
    if (!game.won) {el('wins-display').textContent = '0'; status('SPIN #' + game.id + ' · SETTLED', 'No prize this time.', 'Result confirmed on Base.'); return;}
    var prize = game.payout;
    if (!prize) {el('wins-display').textContent = 'WIN'; status('SPIN #' + game.id + ' · WON', 'You won!', 'Prize confirmed. Reading the details from the contract.'); return;}
    var name = prizeName(game, prize);
    el('wins-display').textContent = prize.formattedAmount + ' ' + name;
    status('SPIN #' + game.id + ' · ' + game.matchCount + '/5', 'You won ' + prize.formattedAmount + ' ' + name + '!', prize.kind === 3 ? 'Credits are already available for this wallet.' : 'The prize has already been sent to your wallet.');
  }
  function render() {
    if (!snapshot || !snapshot.configured || !currentSession) return;
    document.body.classList.add('game-enabled'); show('game-controls', true); show('game-unconfigured', false); show('play-consent-status', true);
    var player = snapshot.player, game = player.game, operation = player.operation, grant = currentSession.playGrant;
    var inFlight = sending || operation && ['submitting','confirming','uncertain'].indexOf(operation.stage) !== -1 && operation.afterGameId === player.latestGameId;
    var pending = game && game.pending, waitingConfirmation = game && game.hasResult && !game.confirmed;
    var unavailable = !online || inFlight || pending || waitingConfirmation || !player.historyReady || snapshot.settings.paused || snapshot.settings.totalOutcomeWeight !== 1000 || snapshot.settings.configuredPrizeCount < 3 || !snapshot.funding || !snapshot.funding.ready || !snapshot.keeper.configured || snapshot.keeper.balanceWei === '0';
    var availability = !online ? 'Connection lost. New spins resume when the network is back.' : snapshot.settings.paused ? 'Machine paused. Open spins still settle onchain.' : snapshot.settings.totalOutcomeWeight !== 1000 || snapshot.settings.configuredPrizeCount < 3 ? 'The slot is getting ready. The prize table is not complete yet.' : !snapshot.funding ? 'Checking prize reserves. Please wait before you spin.' : !snapshot.funding.ready ? 'Prize restock in progress. New spins are paused; your balance and free spins stay available.' : !snapshot.keeper.configured || snapshot.keeper.balanceWei === '0' ? 'The game service is not ready. Please wait for the operator.' : '';
    el('game-availability').textContent = availability; show('game-availability', !!availability);
    var hasFreeSpins = atLeast(player.freeSpins, '1'), welcome = player.welcome || currentSession.welcome;
    show('free-spin-summary', true); document.body.classList.toggle('has-free-spins', hasFreeSpins && online);
    el('free-spin-summary').classList.toggle('bonus-pending', !!welcome && (welcome.status === 'checking' || welcome.status === 'pending'));
    el('ticket-label').textContent = amount(snapshot.settings.ticketPrice) + ' USDC'; el('ticket-display').textContent = amount(snapshot.settings.ticketPrice);
    el('free-spin-count').textContent = online ? player.freeSpins : '—'; el('free-spin-balance').textContent = online ? player.freeSpins : '—';
    el('free-spin-note').textContent = !online ? 'Balance pending update.' : welcome && welcome.status === 'checking' ? 'Checking welcome bonus…' : welcome && welcome.status === 'pending' ? 'Welcome bonus: +2 on the way.' : hasFreeSpins ? 'The lever uses them first. Gas included.' : 'No free spins available.';
    el('spin-paid').disabled = !!unavailable || !grant || !grant.active || !atLeast(player.allowance, snapshot.settings.ticketPrice) || !atLeast(player.balance, snapshot.settings.ticketPrice);
    el('spin-free').disabled = !!unavailable || !snapshot.keeper.canStartFreeSpin || player.freeSpins === '0';
    var hasBudget = atLeast(player.allowance, snapshot.settings.ticketPrice);
    el('play-consent-title').textContent = hasFreeSpins && !(grant && grant.active) ? 'You can already play for free.' : grant && grant.active ? hasBudget ? 'Spins approved.' : 'Budget needs a top-up.' : 'Approve a budget on your phone.';
    el('play-consent-copy').textContent = hasFreeSpins && !(grant && grant.active) ? 'Pull the lever or press USE FREE SPIN. No USDC top-up or approval needed.' : grant && grant.active ? hasBudget ? 'Remaining USDC budget: ' + amount(player.allowance) + '. Your phone can stay closed.' : 'Remaining budget: ' + amount(player.allowance) + ' USDC. To set a new one, log out and link again from your phone. Free spins stay available.' : 'Choose how much USDC to approve for spins from this iPad. Free spins do not use USDC.';
    if (availability) {el('play-consent-title').textContent = 'Waiting for the machine.'; el('play-consent-copy').textContent = 'New spins resume when the service is ready. Your balance and free spins are safe.';}
    if (window.slotDemo) {el('play-consent-title').textContent = 'Test credits only.'; el('play-consent-copy').textContent = '5 cents + 1 cent of simulated gas. No real funds.';}
    if (inFlight || pending && game.status !== 'expired' || waitingConfirmation) {
      observedPending = true; feedback({phase: 'spin', ready: false});
      spin(true); resetGrid(); hideResult(); hideOutcome(); shownResult = '';
      if (!online) status('WAITING ONCHAIN', 'Looking for the signal.', 'Your spin continues on the contract. Do not send a new request.');
      else if (inFlight) status('01 / SENDING SPIN', operation && operation.stage === 'uncertain' ? 'Verifying the transaction…' : 'Here we go. Good luck!', operation && operation.error || 'Waiting for the first transaction to confirm.');
      else if (waitingConfirmation) status('03 / CONFIRMING RESULT', 'Almost there…', 'Waiting for the reveal confirmations on Base.');
      else if (game.status === 'waiting') status('02 / WAITING FOR BLOCK', 'Let the reels run.', 'Spin #' + game.id + ' · block ' + snapshot.block + ' / ' + (Number(game.targetBlock) + 1));
      else status('03 / REVEAL', 'One last turn…', 'The keeper is revealing spin #' + game.id + '.');
      if (window.slotDemo) {el('game-phase').textContent = 'DEMO · ' + el('game-phase').textContent; el('game-detail').textContent = 'Both transactions simulated. Nothing sent to Base.';}
      return;
    }
    if (game && game.hasResult && game.confirmed) {
      if (shownResult !== game.id) {shownResult = game.id; finalGrid(game); spin(false); showOutcome(game); if (observedPending) {observedPending = false; feedback({phase: 'result', id: game.id, tier: game.won ? Math.max(0, Math.min(3, game.matchCount - 2)) : 0, hub: !!game.won && game.winningSymbol === 9, ready: !el('spin-free').disabled || !el('spin-paid').disabled});}}
      resultText(game);
      if (window.slotDemo) {el('game-phase').textContent = 'DEMO · SIMULATED RESULT'; el('game-detail').textContent = 'No transaction, no real prize.';}
    } else {
      spin(false); hideResult();
      if (game && (game.status === 'expired' || game.status === 'invalidated')) {resetGrid(); status('SPIN #' + game.id + ' · EXPIRED', 'The reveal did not arrive in time.', game.invalidated ? 'Spin invalidated. The contract does not refund the ticket.' : 'Waiting for the onchain close of this spin.');}
      else if (!player.historyReady) status('RESTORING SESSION', 'Recovering your spins.', 'Reading your onchain history.');
      else if (operation && operation.stage === 'failed') status('SPIN NOT OPENED', 'Try again when you are ready.', operation.error);
      else status('YOUR TURN', 'One pull. A little luck.', 'Spin with USDC or use an available free spin.');
    }
    feedback({phase: 'ready', ready: !el('spin-free').disabled || !el('spin-paid').disabled});
    if (availability && !(game && game.hasResult && game.confirmed)) status('NEW SPINS ON HOLD', 'Your seat is waiting.', 'We resume as soon as the machine is ready.');
  }
  function poll() {
    if (!currentSession || currentSession.state !== 'active' || fetching) return;
    fetching = true;
    xhr('/api/relay/tablet/game', null, function (error, data, code) {
      fetching = false;
      if (code === 401) {var event = document.createEvent('Event'); event.initEvent('slot-expired', false, false); window.dispatchEvent(event); return;}
      if (error) {online = false; if (snapshot) render();}
      else if (data.configured && data.sessionId === currentSession.id) {online = true; configuredState = true; snapshot = data; render();}
      else if (!data.configured) {configuredState = false; show('free-spin-summary', true); el('free-spin-note').textContent = 'The slot is not live yet.';}
      timer = window.setTimeout(poll, 2000);
    });
  }
  function start(mode) {
    if (document.hidden || !currentSession || !snapshot || sending || el(mode === 'free' ? 'spin-free' : 'spin-paid').disabled) return;
    sending = true; render();
    xhr('/api/relay/tablet/spin', {mode: mode, afterGameId: snapshot.player.latestGameId}, function (error, data, code) {
      sending = false;
      if (code === 401) {var event = document.createEvent('Event'); event.initEvent('slot-expired', false, false); window.dispatchEvent(event); return;}
      if (error) {if (!code) online = false; render(); status('CHECKING SPIN', 'Let us check before you retry.', error);}
      else {snapshot.player.operation = data.operation; render();}
      window.clearTimeout(timer); poll();
    });
  }
  window.addEventListener('slot-session', function (event) {
    var data = event.detail, changed = !data || !currentSession || data.id !== currentSession.id;
    if (changed) clear();
    currentSession = data;
    if (!data || data.state !== 'active') return;
    show('free-spin-summary', true);
    if (!snapshot && !el('free-spin-note').textContent) el('free-spin-note').textContent = 'Reading balance…';
    if (snapshot) render();
    if (changed || !timer) poll();
  });
  document.addEventListener('visibilitychange', function () {if (!document.hidden) {hardwareState = ''; window.clearTimeout(timer); poll();}});
  window.addEventListener('offline', function () {online = false; render();});
  window.addEventListener('online', function () {window.clearTimeout(timer); poll();});
  el('outcome').onclick = hideOutcome;
  el('spin-paid').onclick = function () {start('paid');}; el('spin-free').onclick = function () {start('free');};
  window.slotCanSwitchMode = function () {return !sending && !fetching && (!currentSession || currentSession.state !== 'active' || configuredState === false || !!snapshot && online && !document.querySelector('.machine').classList.contains('is-spinning'));};
  // Hardware and touch share exactly the same eligibility and submission lock.
  window.slotPullLever = function () {start(snapshot && snapshot.player.freeSpins !== '0' ? 'free' : 'paid');};
}());
