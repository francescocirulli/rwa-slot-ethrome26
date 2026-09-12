import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../../../contracts/',import.meta.url);
execFileSync('forge',['build','--root',root.pathname],{stdio:'inherit'});
const artifacts={};
for(const name of ['SlotENSRegistrar']){
 const source=readFileSync(new URL('src/'+name+'.sol',root));
 const output=JSON.parse(readFileSync(new URL('out/'+name+'.sol/'+name+'.json',root)));
 artifacts[name]={sourceHash:createHash('sha256').update(source).digest('hex'),abi:output.abi,bytecode:output.bytecode.object};
 writeFileSync(new URL('abi/'+name+'.json',root),JSON.stringify(output.abi,null,2)+'\n');
}
writeFileSync(new URL('ens-artifacts.json',import.meta.url),JSON.stringify(artifacts)+'\n');
