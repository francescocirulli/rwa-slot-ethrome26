/* Hardware, attract screen and audio. Safari 12 / ES5, no wallet credentials. */
(function () {
  'use strict';
  var demo = !!window.slotDemo, active = false, awakeUntil = 0, ready = false, busy = false, gate = '', serial = 0;
  var phase = 'idle', effectUntil = 0, result = null, bound = false, hardwareOnline = false, polling = false, pairBusy = false;
  var audio = null, audioEnabled = false, spinSound = null, lastAttract = 0;
  var tab = String(Date.now()) + '-' + String(Math.random()).slice(2);
  function el(id) {return document.getElementById(id);}
  function call(path, body, callback) {
    var req = new XMLHttpRequest(); req.open('POST', '/api/hardware/' + path, true); req.timeout = 1800;
    req.setRequestHeader('Content-Type', 'application/json'); req.setRequestHeader('X-Slot-Request', '1');
    req.onload = function () {var data; try {data = JSON.parse(req.responseText);} catch (ignore) {data = {}; } callback(req.status >= 200 && req.status < 300 ? null : data.error || 'Hardware non disponibile.', data, req.status);};
    req.onerror = req.ontimeout = function () {callback('Bridge non raggiungibile.', null, 0);};
    req.send(JSON.stringify(body));
  }
  function tone(frequency, offset, duration, volume) {
    if (!audioEnabled || !audio || audio.state !== 'running' || document.hidden) return;
    var oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + offset;
    oscillator.type = 'triangle'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume || 0.09, start + 0.01); gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start); oscillator.stop(start + duration + 0.02);
    oscillator.onended = function () {oscillator.disconnect(); gain.disconnect();};
  }
  function melody(tier, hub) {
    var notes = tier >= 3 ? [523,659,784,1047,1319,1568,2093,1568,2093] : tier === 2 || hub ? [659,784,1047,1319] : tier === 1 ? [880,1175] : [220,160];
    for (var i = 0; i < notes.length; i++) tone(notes[i], i * 0.16, 0.27);
  }
  function unlockAudio() {
    try {
      if (!audio) {var Context = window.AudioContext || window.webkitAudioContext; if (!Context) return; audio = new Context(); audio.onstatechange = audioLabel;}
      audioEnabled = true;
      if (audio.resume) audio.resume().then(audioLabel, audioLabel);
      tone(660, 0, 0.12); audioLabel();
    } catch (ignore) {el('audio-enable').textContent = 'Audio non disponibile';}
  }
  function audioLabel() {el('audio-enable').textContent = audioEnabled && audio && audio.state === 'running' ? 'Audio ON · silenzia' : 'Attiva audio';}
  el('audio-enable').onclick = function () {if (audioEnabled && audio && audio.state === 'running') {audioEnabled = false; audio.suspend(); audioLabel();} else unlockAudio();};
  function wake() {
    if (active || busy) return;
    awakeUntil = Date.now() + 45000;
    if (Date.now() - lastAttract > 9000) {lastAttract = Date.now(); phase = 'attract'; effectUntil = Date.now() + 9000; melody(2, false);}
    drawAttract();
  }
  function drawAttract() {if (Date.now() >= effectUntil) document.querySelector('.machine').removeAttribute('data-feedback'); el('attract-screen').hidden = active || Date.now() < awakeUntil;}
  el('attract-wake').onclick = function () {unlockAudio(); wake();};
  window.addEventListener('slot-session', function (event) {
    var nextActive = !!event.detail && event.detail.state !== 'pending';
    if (active && !nextActive) {awakeUntil = 0; phase = 'idle'; effectUntil = 0; ready = false; gate = '';}
    active = nextActive; drawAttract();
  });
  window.addEventListener('slot-game', function (event) {
    var data = event.detail;
    if (data.ready && !ready) gate = tab + '-' + (++serial);
    if (!data.ready) gate = '';
    ready = !!data.ready; busy = data.phase === 'spin';
    if (busy) {document.querySelector('.machine').removeAttribute('data-feedback'); phase = 'spin'; effectUntil = 0; if (!spinSound) spinSound = window.setInterval(function () {tone(700 + Math.random() * 700, 0, 0.055, 0.045);}, 100);}
    else {window.clearInterval(spinSound); spinSound = null;
      if (data.phase === 'result') {phase = 'result'; result = data; document.querySelector('.machine').setAttribute('data-feedback', data.tier || data.hub ? 'win' : 'loss'); effectUntil = Date.now() + (data.tier >= 3 ? 6000 : 4500); melody(data.tier, data.hub);}
      else if (phase !== 'result' || Date.now() >= effectUntil) phase = active ? ready ? 'ready' : 'blocked' : 'idle';
    }
    el('mode-switch').disabled = busy;
  });
  function command() {
    if (document.hidden) return {cmd: 'idle'};
    if (phase === 'result' && Date.now() < effectUntil) return {cmd: 'result', tier: result.tier, hub: result.hub, l1: demo ? 'DEMO risultato' : result.tier ? 'Hai vinto!' : result.hub ? 'URBE PASS!' : 'Nessun premio', l2: demo ? 'Premio simulato' : result.hub ? 'Hub: 1 gg gratis' : 'Tira per giocare'};
    if (busy) return {cmd: 'spin', l1: demo ? 'DEMO gira...' : 'Gira gira...', l2: demo ? 'Simulazione' : 'Attesa onchain'};
    if (active) return {cmd: ready ? 'ready' : 'blocked', l1: demo ? 'DEMO' : 'Lucky Signal', l2: ready ? 'Tira la leva!' : 'Attendi / crediti'};
    return {cmd: Date.now() < awakeUntil ? 'attract' : 'idle', l1: 'Lucky Signal', l2: Date.now() < awakeUntil ? demo ? 'Entra nella demo' : 'Scansiona il QR' : 'Avvicinati!'};
  }
  function poll() {
    if (polling || pairBusy || document.hidden) return;
    polling = true;
    var sentGate = gate;
    call('tablet', {gate: ready ? gate : '', command: command()}, function (error, data, code) {
      polling = false; bound = !error; hardwareOnline = !!data && !!data.online;
      el('hardware-open').textContent = hardwareOnline && bound ? 'Arduino ON' : 'Hardware';
      if (error) {el('hardware-status').textContent = error; if (code === 401 || code === 503) {window.clearInterval(hardwareTimer); hardwareTimer = window.setInterval(poll, 4000);} return;}
      el('hardware-status').textContent = hardwareOnline ? 'Arduino collegato.' : 'Bridge collegato. Arduino offline.';
      for (var i = 0; i < data.events.length; i++) {
        var event = data.events[i];
        if (event.evt === 'motion') wake();
        if (event.evt === 'lever' && hardwareOnline && ready && !busy && event.gate === gate && sentGate === gate) {gate = ''; window.slotPullLever();}
      }
    });
  }
  var hardwareTimer = window.setInterval(poll, 300); poll();
  el('hardware-open').onclick = function () {el('hardware-dialog').hidden = false; el('hardware-code').focus();};
  el('hardware-close').onclick = function () {el('hardware-dialog').hidden = true; el('hardware-open').focus();};
  el('hardware-pair').onclick = function () {
    if (pairBusy) return; pairBusy = true;
    call('pair', {code: el('hardware-code').value}, function (error) {pairBusy = false; el('hardware-status').textContent = error || 'Collegamento riuscito.'; if (!error) {el('hardware-code').value = ''; window.clearInterval(hardwareTimer); hardwareTimer = window.setInterval(poll, 300); poll();}});
  };
  el('hardware-motion').hidden = !demo; el('hardware-motion').onclick = function () {el('hardware-dialog').hidden = true; wake();};
  el('mode-switch').textContent = demo ? 'DEMO · torna al reale' : 'REALE · passa a demo';
  el('mode-switch').onclick = function () {if (window.slotCanSwitchMode && !window.slotCanSwitchMode()) return; window.location.href = demo ? '/' : '/?demo=1';};
  document.addEventListener('visibilitychange', function () {gate = ''; ready = false; if (document.hidden) {window.clearInterval(spinSound); spinSound = null;} else {audioLabel(); poll();}});
  window.setInterval(function () {drawAttract(); audioLabel();}, 500);
  document.addEventListener('keydown', function (event) {if (event.key === 'Escape') {el('hardware-dialog').hidden = true; el('hardware-open').focus();}});
  drawAttract();
}());
