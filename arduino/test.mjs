import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
mkdirSync(root+'artifacts',{recursive:true});
const binary=root+'artifacts/arduino-transport-test';
let result=spawnSync('c++',['-std=c++11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',root+'arduino/tests/transport.cpp','-o',binary],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
result=spawnSync(binary,[],{stdio:'inherit'});process.exit(result.status||0);
