import './slate.css';
const root=document.getElementById('root')!;
root.innerHTML='<main><div class="slate-kicker">STREAMDIRECTOR AI · LIVE VERIFICATION</div><h1>A moment worth keeping.</h1><p>Recording clock · UTC</p><div id="clock"></div><div id="unix"></div><div class="slate-footer">Deterministic bookmarks · Transparent reactions · Editor markers</div></main>';
setInterval(()=>{const now=new Date();document.getElementById('clock')!.textContent=now.toISOString().slice(11,23);document.getElementById('unix')!.textContent=String(now.getTime());},33);
