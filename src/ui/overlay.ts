import { ReactionPlayer } from '../overlay-queue.ts';
import type { Alert } from '../presentation.ts';
import './overlay.css';
const root = document.getElementById('root')!, player = new ReactionPlayer();
let offset = 0, displayed: string | null = null;
const source = new EventSource(`/events?mode=${new URLSearchParams(location.search).get('mode') === 'simulated' ? 'simulated' : 'live'}`);
source.addEventListener('ready', event => {
  const ready = JSON.parse(event.data); offset = ready.serverTimeMs - Date.now(); player.reset(ready.cursor);
  root.replaceChildren(); displayed = null;
});
source.addEventListener('alert', event => { player.accept(JSON.parse(event.data), Date.now() + offset); });
source.onerror = () => { player.reset(0); root.replaceChildren(); displayed = null; };
function show(alert: Alert) {
  const element = document.createElement('section'); element.className = `reaction ${alert.tier}`; element.dataset.bookmarkId = alert.id;
  const label = document.createElement('div'); label.className = 'reaction-label';
  label.textContent = `${alert.mode === 'simulated' ? 'SIMULATED · ' : ''}${alert.tier === 'corner' ? 'CHAT MOMENT' : alert.signal.toUpperCase()}`;
  const text = document.createElement('div'); text.className = 'reaction-caption'; text.textContent = alert.caption;
  element.append(label, text); root.replaceChildren(element);
}
function frame() {
  const alert = player.step(Date.now() + offset);
  if ((alert?.id ?? null) !== displayed) { displayed = alert?.id ?? null; if (alert) show(alert); else root.replaceChildren(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
