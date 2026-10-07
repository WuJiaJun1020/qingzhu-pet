/* Background inspection belongs to the scene, never to the desktop pet window. */
(() => {
  const scene=document.querySelector('.scene');
  const select=document.getElementById('background');
  const modes=[...select.options].map(option=>option.value);
  function apply(mode) {
    if(!modes.includes(mode))mode='shop';
    select.value=mode;scene.dataset.background=mode;
    window.PetSelect.sync();
    try {localStorage.setItem('panel-background',JSON.stringify({mode}));} catch (_) {}
  }
  let saved;
  try {saved=JSON.parse(localStorage.getItem('panel-background'));} catch (_) {}
  apply(saved?.mode);
  select.addEventListener('change',()=>apply(select.value));
})();
