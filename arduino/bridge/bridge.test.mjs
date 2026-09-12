import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocketServer} from 'ws';
async function until(check) {for(let i=0;i<80;i++){if(check())return;await sleep(50);}assert.fail('Timed out waiting for bridge');}
test('real bridge WebSocket and HTTP loop: commands, fresh input, heartbeat and no retry of uncertain lever',async()=>{
  let gate='turn-1', fail=false, received=[],commands=[],client;
  const http=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;assert.equal(req.headers.authorization,'Bearer test-only-hardware-token-32-characters');const data=JSON.parse(body);received.push(data);if(data.events.some(e=>e.evt==='lever'))gate='';res.setHeader('Content-Type','application/json');res.statusCode=fail?503:200;res.end(JSON.stringify({gate,code:'12345678',bound:true,command:{cmd:'ready',l1:'Test',l2:'Tira la leva'}}));});
  http.listen(0,'127.0.0.1');await once(http,'listening');
  const ws=new WebSocketServer({port:0,host:'127.0.0.1'});await once(ws,'listening');
  ws.on('connection',socket=>{client=socket;socket.on('message',raw=>{const data=JSON.parse(String(raw));commands.push(data);if(data.cmd==='ping')socket.send('{"evt":"pong"}');});});
  const child=spawn(process.execPath,[new URL('./bridge.mjs',import.meta.url).pathname],{env:{...process.env,APP_ORIGIN:'http://127.0.0.1:'+http.address().port,ARDUINO_WS_URL:'ws://127.0.0.1:'+ws.address().port,SLOT_HARDWARE_TOKEN:'test-only-hardware-token-32-characters'},stdio:'ignore'});
  try {
    await until(()=>commands.some(c=>c.cmd==='ready'));
    client.send('{"evt":"motion"}');await until(()=>received.some(d=>d.events.some(e=>e.evt==='motion')));
    fail=true;client.send('{"evt":"lever"}');await until(()=>received.some(d=>d.events.some(e=>e.evt==='lever')));
    await until(()=>commands.some(c=>c.cmd==='blocked'));fail=false;
    await until(()=>commands.filter(c=>c.cmd==='ready').length>=2);
    await sleep(600);assert.equal(received.flatMap(d=>d.events).filter(e=>e.evt==='lever').length,1);
    assert.ok(received.flatMap(d=>d.events).find(e=>e.evt==='lever').gate==='turn-1');
  } finally {child.kill('SIGTERM');await once(child,'exit');ws.close();http.close();http.closeAllConnections();}
});
