'use strict';
const api = window.petAPI, surface = document.getElementById('surface'), color = document.getElementById('color');
const modes = ['checker','black','dark','white','blue','pink','custom'];
function select(mode) {
  if(!modes.includes(mode)) mode='checker';
  surface.dataset.mode = mode;
  document.documentElement.style.setProperty('--board-color',color.value);
  for(const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
  localStorage.setItem('board-mode',mode); localStorage.setItem('board-color',color.value);
}
const stored = localStorage.getItem('board-color');
if(stored && /^#[0-9a-f]{6}$/i.test(stored)) color.value = stored;
select(localStorage.getItem('board-mode') || 'checker');
for(const button of document.querySelectorAll('[data-mode]')) button.onclick = () => select(button.dataset.mode);
color.oninput = () => select('custom');
const run = p => p.catch(e => { const el=document.getElementById('error');el.textContent=e.message;el.hidden=false; });
document.getElementById('center').onclick = () => run(api.placeOnBoard());
document.addEventListener('keydown',e => { if(e.key==='Escape') run(api.closeBoard()); });
