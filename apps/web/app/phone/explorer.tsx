'use client';
import {useEffect,useRef,useState} from 'react';
export function PhoneExplorer({player=''}:{player?:string}) {
  const [view,setView]=useState<'explore'|'summary'|null>(null);
  const close=useRef<HTMLButtonElement>(null),frame=useRef<HTMLIFrameElement>(null),opener=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    setView(null);
  },[player]);
  useEffect(()=>{
    if(!view)return;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';close.current?.focus();
    const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==frame.current?.contentWindow)return;if(event.data?.type==='arkiv-explorer-close')setView(null);if(event.data?.type==='arkiv-explorer-focus-close')close.current?.focus();};
    window.addEventListener('message',receive);
    return()=>{document.body.style.overflow=overflow;window.removeEventListener('message',receive);opener.current?.focus();};
  },[view]);
  return <section id="game-explorer" className="phone-card explorer-card" aria-label="Game archive">
    <span className="eyebrow">THE RECORD · POWERED BY ARKIV</span><h2>Every spin.<br/>On the record.</h2><p>Find a winning combination. Explore the receipts. See your season in numbers.</p>
    <div className="explorer-launchers"><button className="phone-primary" onClick={event=>{opener.current=event.currentTarget;setView('explore');}}>Game Explorer ↗</button><button className="phone-secondary" onClick={event=>{opener.current=event.currentTarget;setView('summary');}}>My summary ↗</button></div>
    {view&&<div className="phone-explorer-overlay" role="dialog" aria-modal="true" aria-label="Game Explorer and summary" onKeyDown={event=>{if(event.key==='Escape')setView(null);if(event.key==='Tab'&&event.target===close.current){event.preventDefault();frame.current?.contentWindow?.postMessage({type:'arkiv-explorer-focus',last:event.shiftKey},location.origin);}}}>
      <div className="explorer-toolbar"><span>WALL STREET SLOT / THE RECORD</span><button ref={close} onClick={()=>setView(null)}>Back to activity ×</button></div>
      <iframe ref={frame} title="Game archive workspace" src={`/terminal/explorer.html#view=${view}${player?`&player=${encodeURIComponent(player)}`:''}`}/>
    </div>}
  </section>;
}
