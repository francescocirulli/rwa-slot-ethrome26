import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const upload=process.argv.indexOf('--upload');
const port=upload>=0?process.argv[upload+1]:null;
if(upload>=0&&(!port||!port.startsWith('/dev/')))throw new Error('Usage: node arduino/build.mjs [--upload /dev/cu.usbmodem...]');
const config=process.env.ARDUINO_CONFIG_FILE;
const common=config?['--config-file',config]:[];
const build=resolve(here,'../artifacts/arduino-build');
const result=spawnSync('arduino-cli',[...common,'compile','--fqbn','arduino:renesas_uno:unor4wifi','--build-path',build,resolve(here,'slot_controller')],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
if(port){const result=spawnSync('arduino-cli',[...common,'upload','--fqbn','arduino:renesas_uno:unor4wifi','--port',port,'--input-dir',build,resolve(here,'slot_controller')],{stdio:'inherit'});process.exit(result.status||0);}
