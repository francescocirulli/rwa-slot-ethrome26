'use client';
import {useEffect,useRef,useState} from 'react';
export function PhoneExplorer({player=''}:{player?:string}) {
  const [view,setView]=useState<'explore'|'summary'|null>(null);
  const [frameStatus,setFrameStatus]=useState<'loading'|'ready'|'error'>('loading'),[attempt,setAttempt]=useState(0);
  const close=useRef<HTMLButtonElement>(null),frame=useRef<HTMLIFrameElement>(null),opener=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    setView(null);
  },[player]);
  useEffect(()=>{
    if(!view)return;
    setFrameStatus('loading');
    const timeout=setTimeout(()=>setFrameStatus('error'),12000);
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';close.current?.focus();
    const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==frame.current?.contentWindow)return;if(event.data?.type==='arkiv-explorer-ready'){clearTimeout(timeout);setFrameStatus('ready');}if(event.data?.type==='arkiv-explorer-close')setView(null);if(event.data?.type==='arkiv-explorer-focus-close')close.current?.focus();};
    window.addEventListener('message',receive);
    return()=>{clearTimeout(timeout);document.body.style.overflow=overflow;window.removeEventListener('message',receive);opener.current?.focus();};
  },[view,attempt]);
  const source=`/terminal/explorer.html#view=${view}${player?`&player=${encodeURIComponent(player)}`:''}`;
  return <section id="game-explorer" className="phone-card explorer-card" aria-label="Game archive">
    <span className="eyebrow">THE RECORD · POWERED BY ARKIV</span><h2>Every spin.<br/>On the record.</h2><p>Find a winning combination. Explore the receipts. See your season in numbers.</p>
    <div className="explorer-launchers"><button className="phone-primary" onClick={event=>{opener.current=event.currentTarget;setView('explore');}}>Game Explorer ↗</button><button className="phone-secondary" onClick={event=>{opener.current=event.currentTarget;setView('summary');}}>My summary ↗</button></div>
    {view&&<div className="phone-explorer-overlay" role="dialog" aria-modal="true" aria-label="Game Explorer and summary" onKeyDown={event=>{if(event.key==='Escape')setView(null);if(event.key==='Tab'&&event.target===close.current){event.preventDefault();frame.current?.contentWindow?.postMessage({type:'arkiv-explorer-focus',last:event.shiftKey},location.origin);}}}>
      <div className="explorer-toolbar"><span>WALL STREET SLOT / THE RECORD</span><button ref={close} onClick={()=>setView(null)}>Back to activity ×</button></div>
      {frameStatus==='loading'&&<p className="explorer-load-state" role="status">Loading the archive…</p>}
      {frameStatus==='error'&&<div className="explorer-load-state" role="alert"><p>The archive could not open. Try again or open it in a separate page.</p><button className="phone-secondary" onClick={()=>setAttempt(value=>value+1)}>Retry archive</button><a href={source} target="_blank" rel="noreferrer">Open archive ↗</a></div>}
      <iframe key={`${view}:${attempt}`} ref={frame} title="Game archive workspace" hidden={frameStatus==='error'} src={source}/>
    </div>}
  </section>;
}
