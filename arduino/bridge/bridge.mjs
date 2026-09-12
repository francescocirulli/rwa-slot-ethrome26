import WebSocket from 'ws';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
const token = process.env.SLOT_HARDWARE_TOKEN || '';
const address = new URL(process.env.ARDUINO_WS_URL || 'ws://192.168.1.100:81');
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('APP_ORIGIN must use HTTPS outside localhost');
if (!['ws:', 'wss:'].includes(address.protocol) || token.length < 32) throw new Error('Configure ARDUINO_WS_URL and SLOT_HARDWARE_TOKEN');
const bridgeId = randomBytes(16).toString('hex');
let socket, gate = '', gateAt = 0, events = [], seq = 0, lastCode = '', lastCommand = '', lastSend = 0, running = true, lastPong = 0;
function connect() {
  socket = new WebSocket(address, {handshakeTimeout: 4000, maxPayload: 1024});
  socket.on('open', () => {console.log('Arduino connected'); lastPong = Date.now(); lastCommand = '';});
  socket.on('message', raw => {
    let data; try {data = JSON.parse(String(raw));} catch {return;}
    if (data.evt === 'pong' || data.evt === 'hello') lastPong = Date.now();
    if (data.evt === 'motion' && Date.now() - gateAt < 1500) events.push({evt: 'motion', at: Date.now()});
    if (data.evt === 'lever' && gate && Date.now() - gateAt < 1000) {events.push({evt: 'lever', gate, at: Date.now()}); gate = '';}
    events = events.slice(-8);
  });
  socket.on('error', () => {});
  socket.on('close', () => {gate = ''; events = []; console.log('Arduino disconnected; retrying'); if (running) setTimeout(connect, 2000);});
}
connect();
const heartbeat = setInterval(() => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  if (Date.now() - lastPong > 8000) {socket.terminate(); return;}
  socket.send(JSON.stringify({cmd: 'ping'}));
}, 2000);
process.on('SIGINT', () => {running = false; clearInterval(heartbeat); socket?.close();});
process.on('SIGTERM', () => {running = false; clearInterval(heartbeat); socket?.close();});
while (running) {
  const online = socket?.readyState === WebSocket.OPEN && Date.now() - lastPong < 8000;
  const batch = events.filter(e => Date.now() - e.at < 750).map(({at, ...e}) => e); events = [];
  try {
    const response = await fetch(new URL('/api/hardware/device', origin), {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1800),
      headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify({bridgeId, seq: ++seq, online, events: batch})});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json(); gate = online ? data.gate : ''; gateAt = Date.now();
    if (!data.bound && data.code !== lastCode) {lastCode = data.code; console.log('iPad → Hardware → pairing code: ' + data.code + ' (5 minutes)');}
    const command = JSON.stringify(data.command);
    if (online && (command !== lastCommand || Date.now() - lastSend > 1000)) {socket.send(command); lastCommand = command; lastSend = Date.now();}
  } catch {
    gate = ''; events = []; // Never retry or queue a physical lever after an uncertain upload.
    if (online) socket.send(JSON.stringify({cmd: 'blocked', l1: 'Connessione...', l2: 'Attendi la app'}));
    await sleep(1000);
  }
  await sleep(200);
}
