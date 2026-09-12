/* Hardware, cabinet effects, dialogs and audio. Safari 12 / ES5, no wallet credentials. */
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
    req.onload = function () {var data; try {data = JSON.parse(req.responseText);} catch (ignore) {data = {}; } callback(req.status >= 200 && req.status < 300 ? null : data.error || 'Hardware unavailable.', data, req.status);};
    req.onerror = req.ontimeout = function () {callback('Hardware backend unreachable.', null, 0);};
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
    } catch (ignore) {el('audio-enable').title = 'Sound unavailable';}
  }
  function toolState(id, on, label) {var button = el(id); button.classList.toggle('is-on', on); button.setAttribute('aria-label', label); button.title = label; var caption = button.querySelector('small'); if (caption && button.getAttribute('data-caption')) caption.textContent = on ? button.getAttribute('data-caption') : caption.getAttribute('data-default') || caption.textContent;}
  function audioLabel() {toolState('audio-enable', !!(audioEnabled && audio && audio.state === 'running'), audioEnabled && audio && audio.state === 'running' ? 'Sound on' : 'Sound off');}
  el('audio-enable').onclick = function () {if (audioEnabled && audio && audio.state === 'running') {audioEnabled = false; audio.suspend(); audioLabel();} else unlockAudio();};
  // Browsers only start audio after a real touch, and the motion sensor is not one: the first touch anywhere
  // on the page arms the sound for the session, and the Sound button still mutes it.
  var armed = false;
  function armAudio(event) {if (armed || event.isTrusted === false) return; armed = true; if (!audioEnabled) unlockAudio();}
  document.addEventListener('touchstart', armAudio, {passive: true}); document.addEventListener('mousedown', armAudio);
  // Attract show: when the cabinet sees someone, the reels vibrate in place, the lights run, props rise
  // over the glass and a short tune plays (only after the Sound button unlocked audio). Display only.
  var attractTimer, tuneTimer, tuneRound = 0;
  function attractTune() {
    if (!audioEnabled || !audio || audio.state !== 'running' || active) return;
    var notes = [523, 659, 784, 1047, 784, 659, 523, 392, 523, 659, 784, 1047, 1319, 1047, 784, 1047];
    for (var i = 0; i < notes.length; i++) tone(notes[i], i * 0.19, 0.22, 0.07);
    tone(1568, notes.length * 0.19, 0.6, 0.08);
    if (++tuneRound < 3) tuneTimer = window.setTimeout(attractTune, notes.length * 190 + 900);
  }
  function hideAttract() {
    window.clearTimeout(attractTimer); window.clearTimeout(tuneTimer); tuneRound = 3;
    document.documentElement.classList.remove('attract-on'); el('attract').hidden = true;
  }
  function showAttract() {
    var fx = el('attract-fx'); fx.innerHTML = '';
    for (var i = 0; i < 24; i++) {
      var kind = i % 3, piece;
      if (kind === 0) {piece = document.createElement('img'); piece.src = '/decor/gold.svg'; piece.alt = ''; piece.style.width = (22 + Math.random() * 22) + 'px';}
      else {piece = document.createElement('span'); piece.textContent = kind === 1 ? '$' : '★'; piece.className = kind === 1 ? 'dollar' : 'star'; piece.style.fontSize = (16 + Math.random() * 18) + 'px';}
      piece.style.left = (2 + Math.random() * 94) + '%'; piece.style.animationDelay = (Math.random() * 2) + 's'; fx.appendChild(piece);
    }
    document.documentElement.classList.add('attract-on'); el('attract').hidden = false;
    tuneRound = 0; window.clearTimeout(tuneTimer); attractTune();
    window.clearTimeout(attractTimer); attractTimer = window.setTimeout(hideAttract, 12000);
  }
  function wake() {
    if (active || busy) return;
    awakeUntil = Date.now() + 45000;
    if (Date.now() - lastAttract > 9000) {lastAttract = Date.now(); phase = 'attract'; effectUntil = Date.now() + 9000; showAttract();}
    drawAttract();
  }
  // There is no attract screen any more: motion only drives cabinet lights and the LCD, the slot is always visible.
  function drawAttract() {if (Date.now() >= effectUntil) document.querySelector('.machine').removeAttribute('data-feedback');}
  window.addEventListener('slot-session', function (event) {
    var nextActive = !!event.detail && event.detail.state !== 'pending';
    if (active && !nextActive) {awakeUntil = 0; phase = 'idle'; effectUntil = 0; ready = false; gate = '';}
    active = nextActive; if (active) hideAttract(); drawAttract();
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
    if (phase === 'result' && Date.now() < effectUntil) return {cmd: 'result', tier: result.tier, hub: result.hub, l1: demo ? 'DEMO result' : result.tier ? 'You won!' : result.hub ? 'URBE PASS!' : 'No prize', l2: demo ? 'Demo prize' : result.hub ? 'Hub: 1 free day' : 'Pull to play'};
    if (busy) return {cmd: 'spin', l1: demo ? 'DEMO spinning..' : 'Spinning...', l2: demo ? 'Simulation' : 'Waiting onchain'};
    if (active) return {cmd: ready ? 'ready' : 'blocked', l1: demo ? 'DEMO' : 'Wall Street Slot', l2: ready ? 'Pull the lever!' : 'Wait / credits'};
    return {cmd: Date.now() < awakeUntil ? 'attract' : 'idle', l1: 'Wall Street Slot', l2: Date.now() < awakeUntil ? demo ? 'Enter the demo' : 'Scan the QR code' : 'Step right up!'};
  }
  function poll() {
    if (polling || pairBusy || document.hidden) return;
    polling = true;
    var sentGate = gate;
    call('tablet', {gate: ready ? gate : '', command: command()}, function (error, data, code) {
      polling = false; bound = !error; hardwareOnline = !!data && !!data.online;
      el('hardware-open').textContent = hardwareOnline && bound ? 'Arduino ON' : 'Hardware';
      if (error) {el('hardware-status').textContent = error; if (code === 401 || code === 503) {window.clearInterval(hardwareTimer); hardwareTimer = window.setInterval(poll, 4000);} return;}
      el('hardware-status').textContent = hardwareOnline ? 'Arduino linked.' : 'Arduino offline. Check power and Wi-Fi.';
      for (var i = 0; i < data.events.length; i++) {
        var event = data.events[i];
        if (event.evt === 'motion') wake();
        if (event.evt === 'lever' && hardwareOnline && ready && !busy && event.gate === gate && sentGate === gate) {gate = ''; window.slotPullLever();}
      }
    });
  }
  var hardwareTimer = window.setInterval(poll, 300); poll();
  // Dialogs and panel toggle are display-only: they never touch sessions, eligibility or transactions.
  function openDialog(id, focusId) {el(id).hidden = false; el(focusId).focus();}
  function closeDialog(id, focusId) {el(id).hidden = true; el(focusId).focus();}
  el('info-open').onclick = function () {openDialog('info-dialog', 'info-close');};
  el('info-close').onclick = function () {closeDialog('info-dialog', 'info-open');};
  el('settings-open').onclick = function () {openDialog('settings-dialog', 'settings-close');};
  el('settings-close').onclick = function () {closeDialog('settings-dialog', 'settings-open');};
  el('settings-logout').onclick = function () {el('settings-dialog').hidden = true; el('logout').click();};
  // The session scripts rewrite body.className on every redraw, so the panel state lives on <html>.
  el('panel-toggle').onclick = function () {
    var collapsed = document.documentElement.classList.toggle('panel-collapsed');
    toolState('panel-toggle', collapsed, collapsed ? 'Show wallet' : 'Hide wallet');
    el('panel-toggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };
  el('hardware-open').onclick = function () {el('settings-dialog').hidden = true; el('hardware-dialog').hidden = false; el('hardware-code').focus();};
  el('hardware-close').onclick = function () {el('hardware-dialog').hidden = true; el('hardware-open').focus();};
  el('hardware-pair').onclick = function () {
    if (pairBusy) return; pairBusy = true;
    call('pair', {code: el('hardware-code').value}, function (error) {pairBusy = false; el('hardware-status').textContent = error || 'Linked successfully.'; if (!error) {el('hardware-code').value = ''; window.clearInterval(hardwareTimer); hardwareTimer = window.setInterval(poll, 300); poll();}});
  };
  el('hardware-motion').hidden = !demo; el('hardware-motion').onclick = function () {el('hardware-dialog').hidden = true; wake();};
  // Full screen is a display preference: it never touches sessions, eligibility or audio state.
  var fullscreenButton = el('fullscreen-toggle'), root = document.documentElement;
  var fullscreenSupported = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  function fullscreenActive() {return !!(document.fullscreenElement || document.webkitFullscreenElement);}
  function fullscreenLabel() {var active = fullscreenActive(); toolState('fullscreen-toggle', active, active ? 'Exit full screen' : 'Full screen');}
  if (!fullscreenSupported) fullscreenButton.hidden = true;
  fullscreenButton.onclick = function () {
    var result;
    try {
      if (fullscreenActive()) result = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else result = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    } catch (ignore) {fullscreenButton.title = 'Full screen unavailable'; return;}
    if (result && result.then) result.then(fullscreenLabel, function () {fullscreenButton.title = 'Full screen unavailable';});
  };
  document.addEventListener('fullscreenchange', fullscreenLabel); document.addEventListener('webkitfullscreenchange', fullscreenLabel);
  fullscreenLabel();
  toolState('mode-switch', demo, demo ? 'Back to live' : 'Switch to demo');
  el('mode-switch').onclick = function () {if (window.slotCanSwitchMode && !window.slotCanSwitchMode()) return; window.location.href = demo ? '/' : '/?demo=1';};
  document.addEventListener('visibilitychange', function () {gate = ''; ready = false; if (document.hidden) {window.clearInterval(spinSound); spinSound = null;} else {audioLabel(); poll();}});
  window.setInterval(function () {drawAttract(); audioLabel();}, 500);
  document.addEventListener('keydown', function (event) {if (event.key === 'Escape') {el('hardware-dialog').hidden = true; el('info-dialog').hidden = true; el('settings-dialog').hidden = true; el('hardware-open').focus();}});
  drawAttract();
}());
