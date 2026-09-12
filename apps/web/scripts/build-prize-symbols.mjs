import {readFile,writeFile} from 'node:fs/promises';
// Retro slot tiles: cream card, brass double frame, coloured plaque per symbol.
const brands=[['nvidia',2,'NVIDIA','#9ccb7e'],['spacex',4,'SPACEX','#a9c3de'],['apple',5,'APPLE','#d9d4cb'],['alphabet',6,'ALPHABET','#f0b9a0'],['amazon',7,'AMAZON','#f3c46b'],['gold',11,'GOLD','#f2cf6e']];
function tile(name,color,body){return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 80 80"><rect x="4" y="2" width="72" height="76" rx="9" fill="#fbf1d8" stroke="#8a5f16" stroke-width="2"/><rect x="7.5" y="5.5" width="65" height="69" rx="7" fill="none" stroke="#d9a73a" stroke-width="1.5"/><rect x="12" y="10" width="56" height="52" rx="8" fill="${color}" stroke="#2a1a12" stroke-width="2.5"/><rect x="14" y="13" width="52" height="46" rx="6" fill="#fffaf0" opacity=".55"/>${body}<circle cx="9" cy="7" r="1.6" fill="#8a5f16"/><circle cx="71" cy="7" r="1.6" fill="#8a5f16"/><circle cx="9" cy="73" r="1.6" fill="#8a5f16"/><circle cx="71" cy="73" r="1.6" fill="#8a5f16"/><text x="40" y="71.5" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="7.5" font-weight="700" letter-spacing=".8" fill="#7d1418">${name}</text></svg>`;}
// Logo placement: the logo sits in a 44x40 window at (18,16) inside the 56x52 plaque. Drop a replacement as
// public/brands/<name>.png (preferred, any aspect ratio, transparent background)
// or public/brands/<name>.svg, then rerun this script. PNG wins when both exist.
import {access} from 'node:fs/promises';
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
for(const [name,id,label,color]of brands){let body;
  if(await exists('public/brands/'+name+'.png')){const data=await readFile('public/brands/'+name+'.png');body=`<image x="18" y="16" width="44" height="40" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${data.toString('base64')}"/>`;}
  else{const svg=await readFile('public/brands/'+name+'.svg','utf8');if(/<script|onload=|<foreignObject/i.test(svg))throw new Error('Unexpected active SVG');const vb=svg.match(/viewBox="([^"]+)"/)[1],inner=svg.slice(svg.indexOf('>',svg.indexOf('<svg'))+1,svg.lastIndexOf('</svg>'));body=`<svg x="19" y="16" width="42" height="40" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" fill="#2a1a12">${inner}</svg>`;}
  await writeFile('public/symbols/symbol-'+id+'.svg',tile(label,color,body));}
const placeholders=[
 [0,'MAGNET','#f0a094','<path d="M24 22v14a16 16 0 0 0 32 0V22H46v14a6 6 0 0 1-12 0V22Z" fill="#b8262b" stroke="#2a1a12" stroke-width="2.5"/><path d="M24 22h10v9H24zm22 0h10v9H46z" fill="#fff9e7" stroke="#2a1a12" stroke-width="2"/>'],
 [1,'FREE SPIN','#cfe08a','<path d="M53 26a17 17 0 1 0 3 21" fill="none" stroke="#2f6b45" stroke-width="5" stroke-linecap="round"/><path d="M56 16v15H41" fill="none" stroke="#2f6b45" stroke-width="4"/><path d="m40 26-8 15h8l-2 12 11-18h-9z" fill="#fff9e7" stroke="#2f6b45" stroke-width="1.5"/>'],
 [3,'HOPERA','#dba9cf','<path d="M23 30h34v24H23zM20 25h40v10H20z" fill="#f2cf6e" stroke="#2a1a12" stroke-width="2.5"/><path d="M40 26v28M40 25c-24-3-15-19-7-11l7 11c24-3 15-19 7-11z" fill="none" stroke="#7d1418" stroke-width="4"/>'],
 [8,'ENS','#b9c9ee','<path d="m28 15-10 19 10 18 10-18zM52 15 42 34l10 18 10-18z" fill="#5a6fc4" stroke="#2a1a12" stroke-width="2"/><path d="m28 15 24 37M52 15 28 52" stroke="#fff9e7" stroke-width="4"/>'],
 [9,'URBE PASS','#b7d5bc','<path d="M19 20h42v12a6 6 0 0 0 0 12v10H19V44a6 6 0 0 0 0-12z" fill="#fcf3d9" stroke="#2a1a12" stroke-width="2.5"/><path d="M49 22v29" stroke="#8aaa90" stroke-width="2" stroke-dasharray="3 3"/><path d="M27 29v9c0 10 14 10 14 0v-9" fill="none" stroke="#2f6b45" stroke-width="5"/>'],
 [10,'T-SHIRT','#f3c995','<path d="m30 18-13 8 7 12 6-4v20h20V34l6 4 7-12-13-8c-4 8-14 8-20 0z" fill="#f9f0d6" stroke="#2a1a12" stroke-width="2.5"/><path d="m40 30 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z" fill="#b8262b"/>']
];
for(const [id,label,color,body]of placeholders)await writeFile('public/symbols/symbol-'+id+'.svg',tile(label,color,body));
await writeFile('public/brands/usdc.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#2775ca"/><text x="32" y="46" fill="white" font-family="Arial,sans-serif" font-size="41" text-anchor="middle">$</text><path d="M18 17a22 22 0 0 0 0 30M46 17a22 22 0 0 1 0 30" stroke="white" stroke-width="3" fill="none"/></svg>');

// Reel-only artwork. symbol-11 remains Gold in inventories and payout details.
await writeFile('public/symbols/jackpot.svg',tile('JACKPOT','#f2cf6e','<path d="m22 24 8 7 10-14 10 14 8-7-4 18H26Z" fill="#fff3ab" stroke="#2a1a12" stroke-width="2.5"/><rect x="18" y="34" width="44" height="23" rx="5" fill="#7d1418" stroke="#2a1a12" stroke-width="1.5"/><text x="40" y="51" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-size="19" font-weight="900" fill="#f2cf6e">777</text><path d="m16 12 2 4 4 2-4 2-2 4-2-4-4-2 4-2zm48 5 2 3 4 2-4 2-2 4-2-4-3-2 3-2z" fill="#b8262b"/>'));
