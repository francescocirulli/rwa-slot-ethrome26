/* Onchain slot controller, deliberately ES5 for the shared Safari 12 terminal. */
(function () {
  'use strict';
  var currentSession = null, revision = 0, snapshot = null, fetching = false, sending = false, timer, online = true, shownResult = '', settleTimer;
  var lines = [[5,6,7,8,9], [0,1,7,13,14], [10,11,7,3,4]];
  var labels = ['MAGNETE','FREE SPIN','NVIDIA','GADGET','SPACEX','APPLE','ALPHABET','AMAZON','ENS','URBE PASS','T-SHIRT','GOLD','SYMBOL 12','SYMBOL 13','SYMBOL 14','SYMBOL 15'];
  function el(id) {return document.getElementById(id);}
  function show(id, value) {el(id).hidden = !value;}
  function xhr(path, body, callback) {
    var request = new XMLHttpRequest(), generation = revision;
    request.open(body ? 'POST' : 'GET', path, true); request.timeout = 25000;
    if (body) {request.setRequestHeader('Content-Type', 'application/json'); request.setRequestHeader('X-Slot-Request', '1');}
    request.onload = function () {if (generation !== revision) return; var data; try {data = JSON.parse(request.responseText);} catch (ignore) {callback('Risposta onchain non disponibile.', null, request.status); return;} callback(request.status >= 200 && request.status < 300 ? null : data.error || 'Operazione non disponibile.', data, request.status);};
    request.onerror = request.ontimeout = function () {if (generation === revision) callback('Connessione onchain interrotta.', null, 0);};
    request.send(body ? JSON.stringify(body) : null);
  }
  function amount(units) {
    var value = String(units || '0'); while (value.length < 7) value = '0' + value;
    var integer = value.slice(0,-6), decimals = value.slice(-6).replace(/0+$/, '');
    return integer + (decimals ? ',' + decimals : '');
  }
  function atLeast(left, right) {left = String(left).replace(/^0+/, '') || '0'; right = String(right).replace(/^0+/, '') || '0'; return left.length > right.length || left.length === right.length && left >= right;}
  function status(phase, title, detail) {el('game-phase').textContent = phase; el('game-title').textContent = title; el('game-detail').textContent = detail || '';}
  function spin(value) {document.querySelector('.machine').classList.toggle('is-spinning', value); document.querySelector('.reels').setAttribute('aria-busy', value ? 'true' : 'false');}
  function resetGrid() {
    var cells = document.querySelectorAll('.cell');
    for (var index = 0; index < cells.length; index++) {cells[index].classList.remove('winner'); cells[index].removeAttribute('data-result-symbol');}
  }
  function finalGrid(game) {
    var reels = document.querySelectorAll('.reel'), winning = game.won && lines[game.winningLine] ? lines[game.winningLine].slice(0, game.matchCount) : [];
    for (var column = 0; column < 5; column++) for (var row = 0; row < 3; row++) {
      var index = row * 5 + column, symbol = game.symbols[index], cell = reels[column].children[row], picture = cell.querySelector('img');
      picture.src = '/symbols/symbol-' + symbol + '.svg'; picture.alt = labels[symbol] || 'Simbolo ' + symbol;
      cell.setAttribute('data-result-symbol', String(symbol)); cell.classList.toggle('winner', winning.indexOf(index) !== -1);
    }
  }
  function clear() {
    revision++; snapshot = null; fetching = false; sending = false; shownResult = ''; window.clearTimeout(timer); timer = null; window.clearTimeout(settleTimer);
    spin(false); resetGrid(); show('game-controls', false); show('game-unconfigured', true); show('play-consent-status', false);
    document.body.classList.remove('game-enabled');
    document.body.classList.remove('has-free-spins'); show('free-spin-summary', false);
    el('free-spin-balance').textContent = '—'; el('free-spin-count').textContent = '—'; el('free-spin-note').textContent = '';
    el('spin-paid').disabled = true; el('spin-free').disabled = true;
    var originals = [2, 1, 0, 4, 3, 5, 6, 11, 8, 7, 9, 10, 11, 2, 1];
    var images = document.querySelectorAll('.cell img');
    for (var i = 0; i < images.length; i++) {images[i].src = '/symbols/symbol-' + originals[i] + '.svg'; images[i].alt = labels[originals[i]];}
  }
  function resultText(game) {
    if (!game.won) {status('GIOCATA #' + game.id + ' · CONCLUSA', 'Questa volta, nessun premio.', 'Il risultato è stato confermato su Base.'); return;}
    var prize = game.payout;
    if (!prize) {status('GIOCATA #' + game.id + ' · VINTA', 'Hai vinto!', 'Premio confermato. Recuperiamo i dettagli dal contratto.'); return;}
    var name = prize.kind === 3 ? 'free spin' : prize.kind === 2 ? labels[game.winningSymbol] : prize.tokenSymbol || 'unità token';
    status('GIOCATA #' + game.id + ' · ' + game.matchCount + '/5', 'Hai vinto ' + prize.formattedAmount + ' ' + name + '!', prize.kind === 3 ? 'I crediti sono già disponibili per questo wallet.' : 'Il premio è già stato inviato al tuo wallet.');
  }
  function render() {
    if (!snapshot || !snapshot.configured || !currentSession) return;
    document.body.classList.add('game-enabled'); show('game-controls', true); show('game-unconfigured', false); show('play-consent-status', true);
    var player = snapshot.player, game = player.game, operation = player.operation, grant = currentSession.playGrant;
    var inFlight = sending || operation && ['submitting','confirming','uncertain'].indexOf(operation.stage) !== -1 && operation.afterGameId === player.latestGameId;
    var pending = game && game.pending, waitingConfirmation = game && game.hasResult && !game.confirmed;
    var unavailable = !online || inFlight || pending || waitingConfirmation || !player.historyReady || snapshot.settings.paused || snapshot.settings.totalOutcomeWeight !== 1000 || snapshot.settings.configuredPrizeCount < 3 || !snapshot.keeper.configured || snapshot.keeper.balanceWei === '0';
    var hasFreeSpins = atLeast(player.freeSpins, '1'), welcome = player.welcome || currentSession.welcome;
    show('free-spin-summary', true); document.body.classList.toggle('has-free-spins', hasFreeSpins && online);
    el('free-spin-summary').classList.toggle('bonus-pending', !!welcome && (welcome.status === 'checking' || welcome.status === 'pending'));
    el('ticket-label').textContent = amount(snapshot.settings.ticketPrice) + ' USDC';
    el('free-spin-count').textContent = online ? player.freeSpins : '—'; el('free-spin-balance').textContent = online ? player.freeSpins : '—';
    el('free-spin-note').textContent = !online ? 'Saldo da aggiornare.' : welcome && welcome.status === 'checking' ? 'Verifica bonus di benvenuto…' : welcome && welcome.status === 'pending' ? 'Bonus di benvenuto: +2 in arrivo.' : hasFreeSpins ? 'La leva li usa per primi. Gas incluso.' : 'Nessun free spin disponibile.';
    el('spin-paid').disabled = !!unavailable || !grant || !grant.active || !atLeast(player.allowance, snapshot.settings.ticketPrice) || !atLeast(player.balance, snapshot.settings.ticketPrice);
    el('spin-free').disabled = !!unavailable || !snapshot.keeper.canStartFreeSpin || player.freeSpins === '0';
    var hasBudget = atLeast(player.allowance, snapshot.settings.ticketPrice);
    el('play-consent-title').textContent = hasFreeSpins && !(grant && grant.active) ? 'Puoi già giocare gratis.' : grant && grant.active ? hasBudget ? 'Giocate autorizzate.' : 'Budget da rinnovare.' : 'Autorizza il budget sul telefono.';
    el('play-consent-copy').textContent = hasFreeSpins && !(grant && grant.active) ? 'Tira la leva o premi USA FREE SPIN. Non serve ricaricare né autorizzare USDC.' : grant && grant.active ? hasBudget ? 'Budget USDC residuo: ' + amount(player.allowance) + '. Il telefono può restare chiuso.' : 'Budget residuo: ' + amount(player.allowance) + ' USDC. Per sceglierne uno nuovo, esci e ricollegati dal telefono. I free spin restano disponibili.' : 'Scegli quanto autorizzare per giocare dall’iPad. I free spin non usano USDC.';
    if (inFlight || pending && game.status !== 'expired' || waitingConfirmation) {
      spin(true); resetGrid(); shownResult = '';
      if (!online) status('ATTESA ONCHAIN', 'Cerchiamo il segnale.', 'La giocata continua sul contratto. Non inviare una nuova richiesta.');
      else if (inFlight) status('01 / INVIO GIOCATA', operation && operation.stage === 'uncertain' ? 'Verifica della transazione…' : 'Si parte. Buona fortuna!', operation && operation.error || 'Attendiamo la conferma della prima transazione.');
      else if (waitingConfirmation) status('03 / CONFERMA RISULTATO', 'Ci siamo quasi…', 'Aspettiamo le conferme del reveal su Base.');
      else if (game.status === 'waiting') status('02 / ATTESA BLOCCO', 'Lascia girare la fortuna.', 'Giocata #' + game.id + ' · blocco ' + snapshot.block + ' / ' + (Number(game.targetBlock) + 1));
      else status('03 / REVEAL', 'Un ultimo giro…', 'Il backend sta rivelando la giocata #' + game.id + '.');
      return;
    }
    if (game && game.hasResult && game.confirmed) {
      if (shownResult !== game.id) {shownResult = game.id; finalGrid(game); spin(false);}
      resultText(game);
    } else {
      spin(false);
      if (game && (game.status === 'expired' || game.status === 'invalidated')) {resetGrid(); status('GIOCATA #' + game.id + ' · SCADUTA', 'Il reveal non è arrivato in tempo.', game.invalidated ? 'Giocata invalidata. Il contratto non rimborsa il biglietto.' : 'Attendiamo la chiusura onchain della giocata.');}
      else if (!player.historyReady) status('RECUPERO SESSIONE', 'Ritroviamo le tue giocate.', 'Stiamo leggendo lo storico onchain.');
      else if (operation && operation.stage === 'failed') status('GIOCATA NON APERTA', 'Riprova quando sei pronto.', operation.error);
      else status('IL TUO TURNO', 'Un tiro. Un po’ di fortuna.', 'Gioca con USDC o usa un free spin disponibile.');
    }
    if (!online) status('CONNESSIONE INTERROTTA', 'Cerchiamo il segnale.', 'Le nuove giocate saranno disponibili al ritorno della rete.');
    else if (snapshot.settings.paused) status('MACCHINA IN PAUSA', 'Una piccola pausa.', 'Le giocate già aperte continuano fino al reveal.');
    else if (!snapshot.keeper.configured || snapshot.keeper.balanceWei === '0') status('SERVIZIO DA CONFIGURARE', 'Il tuo posto ti aspetta.', 'Il wallet backend deve essere configurato e avere ETH per il reveal.');
  }
  function poll() {
    if (!currentSession || currentSession.state !== 'active' || fetching) return;
    fetching = true;
    xhr('/api/relay/tablet/game', null, function (error, data, code) {
      fetching = false;
      if (code === 401) {var event = document.createEvent('Event'); event.initEvent('slot-expired', false, false); window.dispatchEvent(event); return;}
      if (error) {online = false; if (snapshot) render();}
      else if (data.configured && data.sessionId === currentSession.id) {online = true; snapshot = data; render();}
      else if (!data.configured) {show('free-spin-summary', true); el('free-spin-note').textContent = 'La slot non è ancora attiva.';}
      timer = window.setTimeout(poll, 2000);
    });
  }
  function start(mode) {
    if (!currentSession || !snapshot || sending || el(mode === 'free' ? 'spin-free' : 'spin-paid').disabled) return;
    sending = true; render();
    xhr('/api/relay/tablet/spin', {mode: mode, afterGameId: snapshot.player.latestGameId}, function (error, data, code) {
      sending = false;
      if (code === 401) {var event = document.createEvent('Event'); event.initEvent('slot-expired', false, false); window.dispatchEvent(event); return;}
      if (error) {if (!code) online = false; render(); status('VERIFICA GIOCATA', 'Controlliamo prima di riprovare.', error);}
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
    if (!snapshot && !el('free-spin-note').textContent) el('free-spin-note').textContent = 'Lettura del saldo…';
    if (snapshot) render();
    if (changed || !timer) poll();
  });
  window.addEventListener('offline', function () {online = false; render();});
  window.addEventListener('online', function () {window.clearTimeout(timer); poll();});
  el('spin-paid').onclick = function () {start('paid');}; el('spin-free').onclick = function () {start('free');};
  // Future Arduino adapter can call this after validating its physical lever input.
  window.slotPullLever = function () {start(snapshot && snapshot.player.freeSpins !== '0' ? 'free' : 'paid');};
}());
