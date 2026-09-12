'use client';
import {useEffect,useState} from 'react';
import {emptyView,type LeaderboardView} from '@/lib/arkiv/model';
export function SeasonLeaderboard() {
  const [view,setView]=useState<LeaderboardView>({...emptyView(),status:'connecting',message:'Connecting to the season leaderboard…'});
  const [received,setReceived]=useState(0),[now,setNow]=useState(0);
  useEffect(()=>{
    const stream=new EventSource('/api/leaderboard/stream');
    stream.addEventListener('standings',event=>{try {const next=JSON.parse((event as MessageEvent).data);setView(next);setReceived(Date.now());setNow(Date.now());} catch {setView(old=>({...old,status:'unavailable'}));}});
    stream.onerror=()=>setView(old=>({...old,status:'unavailable',message:'Reconnecting. Standings may be out of date.'}));
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return ()=>{stream.close();clearInterval(timer);};
  },[]);
  const stale=view.status!=='live'||now-received>15000;
  const remaining=Math.max(0,view.remainingSeconds-Math.floor((now-received)/1000));
  const countdown=stale?'Waiting for connection':remaining>0?`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'Waiting for season change';
  return <section className="phone-card season-card" aria-label="Season leaderboard">
    <span className="eyebrow">LEADERBOARD · ARKIV</span><h2>{view.season?`Season ${view.season.id}`:'Seasons'}</h2>
    {view.status!=='disabled'&&<p className="season-countdown">{view.season?'Next season':'First season'} · <strong>{countdown}</strong></p>}
    <p role="status">{view.message || (stale?'Reconnecting. Standings may be out of date.':'Live standings · 3 matches: 30 pts · 5 matches: 100 pts')}</p>
    {view.rows.length>0?<table className="season-table"><thead><tr><th>Rank / player</th><th>Wins</th><th>Points</th></tr></thead><tbody>{view.rows.map((row,index)=><tr key={row.player}><td><span>{index+1}.</span> <a href={`https://basescan.org/address/${row.player}`} target="_blank" rel="noreferrer">{row.player.slice(0,6)}…{row.player.slice(-4)}</a></td><td>{row.wins}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table>:view.status==='live'&&view.season&&<p>No spins in this season yet.</p>}
    <small>Season points reset together. Your wallet and prizes stay yours.</small>
  </section>;
}
