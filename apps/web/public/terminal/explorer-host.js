(function () {
  'use strict';
  var open = document.getElementById('explorer-open'), close = document.getElementById('explorer-close'), dialog = document.getElementById('explorer-dialog'), frame = document.getElementById('explorer-frame'), player = '';
  function hide() {dialog.hidden = true;frame.removeAttribute('src');open.focus();}
  open.onclick = function () {frame.src = '/terminal/explorer.html' + (player ? '#player=' + encodeURIComponent(player) : '');dialog.hidden = false;close.focus();};
  close.onclick = hide;
  window.addEventListener('slot-session', function (event) {
    var next = event.detail && event.detail.address || '';
    if(!/^0x[0-9a-fA-F]{40}$/.test(next))next = '';
    if(player !== next) {player = next;if(!dialog.hidden)hide();}
  });
  window.addEventListener('message', function (event) {if(event.origin === window.location.origin && event.source === frame.contentWindow && event.data && event.data.type === 'arkiv-explorer-close')hide();else if(event.origin === window.location.origin && event.source === frame.contentWindow && event.data && event.data.type === 'arkiv-explorer-focus-close')close.focus();});
  dialog.addEventListener('keydown', function (event) {if(event.key === 'Escape')hide();if(event.key === 'Tab' && document.activeElement === close) {event.preventDefault();frame.contentWindow.postMessage({type:'arkiv-explorer-focus',last:event.shiftKey}, window.location.origin);}});
}());
