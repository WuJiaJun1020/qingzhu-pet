/* The fixed viewport clips overflow; frame contents never move the canvas. */
(() => {
  const canvas=document.getElementById('canvas');
  window.petAPI.onPlayerLayout(p=>{
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return;
    canvas.style.setProperty('--panel-x',p.x+'px');canvas.style.setProperty('--panel-y',p.y+'px');
  });
  window.PanelPlacement={host(mode){document.body.dataset.host=mode;}};
})();
