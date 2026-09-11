// Live shared-wallet check; credentials are loaded only inside the child process.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const result=spawnSync(process.execPath,['--env-file=.env.local','--import','tsx',fileURLToPath(new URL('./live-shared-admin-check.ts',import.meta.url))],{stdio:'inherit',env:process.env});
process.exitCode=result.status??1;
