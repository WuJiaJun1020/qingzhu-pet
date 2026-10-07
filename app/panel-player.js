(() => {
  const stage=document.querySelector('.stage');
  let scheduled=false, previous='';
  function report() {
    scheduled=false;
    const rect=stage.getBoundingClientRect();
    const bounds={x:Math.round(rect.x),y:Math.round(rect.y),width:Math.floor(rect.width),height:Math.floor(rect.height)};
    const key=JSON.stringify(bounds);if(key===previous)return;previous=key;
    window.petAPI.playerRegion(bounds).catch(console.error);
  }
  function schedule() {if(!scheduled){scheduled=true;requestAnimationFrame(report);}}
  new ResizeObserver(schedule).observe(stage);
  window.addEventListener('resize',schedule);
  window.addEventListener('pageshow',schedule);
  schedule();
})();
