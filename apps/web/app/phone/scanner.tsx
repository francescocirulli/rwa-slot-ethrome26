'use client';
import {useEffect,useRef,useState} from 'react';
import {pairingSecretFromQr} from '@/lib/pairing-qr';

export function PairingScanner({onRead,onClose}:{onRead:(secret:string)=>void;onClose:()=>void}) {
  const video=useRef<HTMLVideoElement>(null),panel=useRef<HTMLElement>(null),stream=useRef<MediaStream|null>(null);
  const callbacks=useRef({onRead,onClose});callbacks.current={onRead,onClose};
  const alive=useRef(true),accepted=useRef(false);
  const [error,setError]=useState(''),[status,setStatus]=useState('Avvio fotocamera…'),[reading,setReading]=useState(false);
  function stopCamera(){stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;}
  function accept(value:string) {
    if(!alive.current||accepted.current)return;
    try {
      const secret=pairingSecretFromQr(value,window.location.origin);
      accepted.current=true;stopCamera();callbacks.current.onRead(secret);
    }catch(cause){setError(cause instanceof Error?cause.message:'QR non valido.');}
  }
  useEffect(()=>{
    alive.current=true;
    let timer:ReturnType<typeof setTimeout>|undefined,disposed=false;
    const previous=document.activeElement as HTMLElement|null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function hidden(){if(document.hidden)callbacks.current.onClose();}
    document.addEventListener('visibilitychange',hidden);
    async function start(){
      try {
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('CameraUnavailable');
        const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
        if(disposed){media.getTracks().forEach(track=>track.stop());return;}
        stream.current=media;
        const view=video.current!;view.srcObject=media;await view.play();
        const {default:decode}=await import('jsqr');
        if(disposed)return;
        setStatus('Inquadra il QR sullo schermo dell’iPad.');
        const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true})!;
        function frame(){
          if(disposed||accepted.current||!stream.current)return;
          if(view.readyState>=2&&view.videoWidth){
            const scale=Math.min(1,960/view.videoWidth);canvas.width=Math.round(view.videoWidth*scale);canvas.height=Math.round(view.videoHeight*scale);
            context.drawImage(view,0,0,canvas.width,canvas.height);
            const pixels=context.getImageData(0,0,canvas.width,canvas.height),qr=decode(pixels.data,pixels.width,pixels.height);
            if(qr)accept(qr.data);
          }
          timer=setTimeout(frame,250);
        }
        frame();
      }catch{
        if(disposed)return;
        stopCamera();if(alive.current){setStatus('Fotocamera non disponibile.');setError('Consenti l’accesso alla fotocamera nelle impostazioni del browser, oppure usa una foto del QR.');}
      }
    }
    void start();
    return()=>{disposed=true;alive.current=false;stopCamera();clearTimeout(timer);document.removeEventListener('visibilitychange',hidden);previous?.focus();};
  },[]);
  async function readImage(file:File|undefined){
    if(!file)return;
    setError('');setReading(true);
    const url=URL.createObjectURL(file);
    try {
      if(file.size>15*1024*1024)throw new Error('Scegli una foto inferiore a 15 MB.');
      const picture=new Image();picture.src=url;await picture.decode();
      if(!alive.current)return;
      const {default:decode}=await import('jsqr');
      const scale=Math.min(1,1600/Math.max(picture.naturalWidth,picture.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.round(picture.naturalWidth*scale);canvas.height=Math.round(picture.naturalHeight*scale);
      const context=canvas.getContext('2d')!;context.drawImage(picture,0,0,canvas.width,canvas.height);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height),qr=decode(pixels.data,pixels.width,pixels.height);
      if(!qr)throw new Error('QR non leggibile. Usa una foto nitida con il codice intero.');
      accept(qr.data);
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Immagine non leggibile.');}
    finally{URL.revokeObjectURL(url);if(alive.current)setReading(false);}
  }
  return <div className="qr-scanner-backdrop"><section ref={panel} className="qr-scanner" role="dialog" aria-modal="true" aria-labelledby="qr-title" onKeyDown={event=>{
    if(event.key==='Escape')onClose();
    if(event.key==='Tab'){const elements=event.currentTarget.querySelectorAll<HTMLElement>('button,input');const first=elements[0],last=elements[elements.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  }}><button className="phone-secondary" onClick={onClose}>Chiudi scanner</button><h2 id="qr-title">Collega l’iPad.</h2><p role="status">{status}</p><video ref={video} autoPlay playsInline muted aria-label="Anteprima fotocamera QR"/>
    {error&&<p className="phone-error" role="alert">{error}</p>}
    <label className="qr-photo">{reading?'Lettura foto…':'Scatta o scegli una foto del QR'}<input type="file" accept="image/*" capture="environment" disabled={reading} onChange={event=>{void readImage(event.target.files?.[0]);event.target.value='';}}/></label>
    <p className="small">Le immagini vengono lette sul telefono. Dopo la scansione conferma che il codice coincide con quello sull’iPad.</p>
  </section></div>;
}
