import {writeFileSync} from 'node:fs';
// Run with both --env-file=arduino/.env.wifi and --env-file=arduino/.env.backend.
// Credentials are never printed and the generated header is ignored by Git.
const {SECRET_SSID,SECRET_PASS,SLOT_HARDWARE_TOKEN}=process.env;
const SLOT_BACKEND_HOST=process.env.SLOT_BACKEND_HOST || 'web-production-e2628.up.railway.app';
if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(SLOT_BACKEND_HOST) || SLOT_BACKEND_HOST.length>253 || !SLOT_BACKEND_HOST.includes('.')) throw new Error('SLOT_BACKEND_HOST must be a public DNS hostname, without scheme, port or path');
if(!SLOT_HARDWARE_TOKEN || !/^[A-Za-z0-9_-]{32,128}$/.test(SLOT_HARDWARE_TOKEN)) throw new Error('Set SLOT_HARDWARE_TOKEN to a random 32-128 character token');
if(!SECRET_SSID||SECRET_PASS===undefined)throw new Error('Provide SECRET_SSID and SECRET_PASS via the ignored Wi-Fi env file');
if(Buffer.byteLength(SECRET_SSID)>32||Buffer.byteLength(SECRET_PASS)>63)throw new Error('Invalid Wi-Fi credential length');
writeFileSync(new URL('./slot_controller/arduino_secrets.h',import.meta.url),`#pragma once\n#define SECRET_SSID ${JSON.stringify(SECRET_SSID)}\n#define SECRET_PASS ${JSON.stringify(SECRET_PASS)}\n#define SLOT_BACKEND_HOST ${JSON.stringify(SLOT_BACKEND_HOST)}\n#define SLOT_HARDWARE_TOKEN ${JSON.stringify(SLOT_HARDWARE_TOKEN)}\n`,{mode:0o600});
console.log('Created ignored arduino_secrets.h; credentials not displayed.');
