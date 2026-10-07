(() => {
  'use strict';
  const controls = [];
  let opened, menu, active = 0;
  const options = control => [...control.select.options];
  const isDisabled = control => control.select.disabled || !!control.select.closest('fieldset:disabled') || !options(control).length;
  function close(restoreFocus = true) {
    if (!opened) return;
    const control = opened;
    control.button.setAttribute('aria-expanded', 'false');
    opened = null; menu.remove(); menu = null;
    if (restoreFocus && !isDisabled(control)) control.button.focus({preventScroll:true});
  }
  function highlight(index) {
    const items = [...menu.children];
    if (!items.length) return;
    active = Math.max(0, Math.min(items.length - 1, index));
    items.forEach((item, i) => item.classList.toggle('focused', i === active));
    menu.setAttribute('aria-activedescendant', items[active].id);
    items[active].scrollIntoView({block:'nearest'});
  }
  function choose(index) {
    const control = opened, option = options(control)[index];
    if (!option || option.disabled || isDisabled(control)) return;
    close(); control.select.value = option.value; sync(control);
    control.select.dispatchEvent(new Event('change', {bubbles:true}));
  }
  function open(control, initial) {
    if (isDisabled(control)) return;
    if (opened === control) return close();
    close(false); opened = control;
    menu = document.createElement('div'); menu.id = control.button.id + '-menu';
    menu.className = 'ui-select-menu'; menu.role = 'listbox'; menu.tabIndex = -1;
    menu.setAttribute('aria-label', control.button.getAttribute('aria-label'));
    options(control).forEach((option, i) => {
      const row = document.createElement('div'); row.className = 'ui-select-option';
      row.id = menu.id + '-' + i; row.role = 'option'; row.dataset.value = option.value;
      row.setAttribute('aria-selected', String(option.selected)); row.setAttribute('aria-disabled', String(option.disabled));
      const mark = document.createElement('span'); mark.className = 'ui-select-check'; mark.textContent = '✓';
      const label = document.createElement('span'); label.textContent = option.label;
      row.append(mark, label); row.onclick = () => choose(i);
      row.onpointermove = () => { if (active !== i) highlight(i); };
      menu.append(row);
    });
    document.body.append(menu);
    const rect = control.button.getBoundingClientRect(), width = Math.min(innerWidth - 16, Math.max(rect.width, 220));
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const bottom = below >= Math.min(240, menu.scrollHeight) || below >= above;
    const height = Math.min(280, Math.max(48, bottom ? below : above));
    menu.style.width = width + 'px'; menu.style.maxHeight = height + 'px';
    menu.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left)) + 'px';
    menu.style.top = (bottom ? rect.bottom + 6 : Math.max(8, rect.top - Math.min(menu.scrollHeight, height) - 6)) + 'px';
    control.button.setAttribute('aria-expanded', 'true');
    control.button.setAttribute('aria-controls', menu.id);
    menu.onkeydown = e => {
      if (e.key === 'Tab') return close();
      if (['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'ArrowDown') highlight(active + 1);
      if (e.key === 'ArrowUp') highlight(active - 1);
      if (e.key === 'Home') highlight(0);
      if (e.key === 'End') highlight(menu.children.length - 1);
      if (e.key === 'Enter' || e.key === ' ') choose(active);
      if (e.key === 'Escape') close();
    };
    menu.focus({preventScroll:true}); highlight(initial ?? Math.max(0, control.select.selectedIndex));
  }
  function sync(control) {
    const disabled = isDisabled(control);
    const signature = options(control).map(option => option.value + ':' + option.label + ':' + option.disabled).join('|');
    if (opened === control && (disabled || signature !== control.signature)) close(false);
    control.signature = signature;
    control.button.disabled = disabled;
    control.text.textContent = control.select.selectedOptions[0]?.label || '选择动作';
    if (opened === control) for (const row of menu.children) row.setAttribute('aria-selected', String(row.dataset.value === control.select.value));
  }
  for (const select of document.querySelectorAll('select:not(#background)')) {
    const label = document.querySelector('label[for="' + select.id + '"]');
    const wrapper = document.createElement('span'); wrapper.className = 'ui-select'; wrapper.dataset.for = select.id;
    const button = document.createElement('button'); button.type = 'button'; button.id = select.id + '-toggle';
    button.className = 'ui-select-trigger'; button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', select.getAttribute('aria-label') || label?.textContent.trim() || '选择');
    const text = document.createElement('span'); text.className = 'ui-select-value';
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.classList.add('ui-select-arrow'); arrow.setAttribute('viewBox', '0 0 16 16'); arrow.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M4 6 8 10 12 6'); arrow.append(path);
    button.append(text, arrow); select.before(wrapper); wrapper.append(select, button);
    select.classList.add('ui-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    if (label) label.htmlFor = button.id;
    const control = {select, button, text}; controls.push(control);
    button.onclick = () => open(control);
    button.onkeydown = e => {
      if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        open(control, e.key === 'Home' ? 0 : e.key === 'End' ? options(control).length - 1 : undefined);
      }
    };
    select.addEventListener('change', () => sync(control)); sync(control);
    new MutationObserver(() => sync(control)).observe(select, {subtree:true, childList:true, characterData:true, attributes:true});
  }
  document.addEventListener('pointerdown', e => { if (opened && !menu.contains(e.target) && !opened.button.contains(e.target)) close(false); }, true);
  document.addEventListener('scroll', e => { if (opened && e.target !== menu) close(false); }, true);
  window.addEventListener('resize', () => close(false)); window.addEventListener('blur', () => close(false));
  const observer = new MutationObserver(() => controls.forEach(sync));
  for (const fieldset of document.querySelectorAll('fieldset')) observer.observe(fieldset, {attributes:true, attributeFilter:['disabled']});
  window.PetSelect = {sync:() => controls.forEach(sync), close};
})();
