import {writeFileSync} from 'node:fs';
// Run with node --env-file=arduino/.env.wifi arduino/configure-wifi.mjs.
// Credentials are never printed and the generated header is ignored by Git.
const {SECRET_SSID,SECRET_PASS}=process.env;
if(!SECRET_SSID||SECRET_PASS===undefined)throw new Error('Provide SECRET_SSID and SECRET_PASS via the ignored Wi-Fi env file');
if(Buffer.byteLength(SECRET_SSID)>32||Buffer.byteLength(SECRET_PASS)>63)throw new Error('Invalid Wi-Fi credential length');
writeFileSync(new URL('./slot_controller/arduino_secrets.h',import.meta.url),`#pragma once\n#define SECRET_SSID ${JSON.stringify(SECRET_SSID)}\n#define SECRET_PASS ${JSON.stringify(SECRET_PASS)}\n`,{mode:0o600});
console.log('Created ignored arduino_secrets.h; credentials not displayed.');
