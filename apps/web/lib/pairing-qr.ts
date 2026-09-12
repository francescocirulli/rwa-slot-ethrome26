// A scanned QR is data, never a navigation instruction. Only this app can pair.
export function pairingSecretFromQr(value:string,origin:string):string {
  let url:URL;
  try {url=new URL(value);}catch{throw new Error('Questo non è un QR di collegamento della slot.');}
  const fragment=new URLSearchParams(url.hash.slice(1)),secret=fragment.get('pair');
  if(url.origin!==new URL(origin).origin||url.pathname!=='/phone'||url.username||url.password||
    fragment.getAll('pair').length!==1||!secret||!/^[a-f0-9]{64}$/.test(secret)) {
    throw new Error('Scansiona il QR mostrato da questa app sull’iPad.');
  }
  return secret;
}
