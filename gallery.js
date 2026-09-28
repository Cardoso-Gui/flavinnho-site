(() => {
  const carousel = document.querySelector('.photo-carousel');
  if (!carousel) return;
  const deck = carousel.querySelector('.photo-deck');
  const cards = [...deck.querySelectorAll('.photo-card')];
  const controls = carousel.querySelector('.gallery-controls');
  const play = carousel.querySelector('.gallery-play');
  const counter = carousel.querySelector('.gallery-counter');
  const status = carousel.querySelector('.gallery-status');
  const viewer = document.querySelector('.photo-viewer');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let userPaused = reducedMotion.matches;
  let hovered = false;
  let focused = false;
  let inView = true;
  let pointer = null;
  let suppressClick = false;
  let timer;

  function schedule() {
    clearTimeout(timer);
    if (userPaused || hovered || focused || !inView || document.hidden || viewer.open || pointer) return;
    timer = setTimeout(() => select(current + 1), 2500);
  }

  function render() {
    const step = Math.min(deck.clientWidth * .38, 265);
    cards.forEach((card, index) => {
      let offset = (index - current + cards.length) % cards.length;
      if (offset > cards.length / 2) offset -= cards.length;
      const distance = Math.abs(offset);
      card.style.setProperty('--shift', `${offset * step}px`);
      card.style.setProperty('--depth', `${-distance * 150}px`);
      card.style.setProperty('--angle', `${-Math.sign(offset) * Math.min(distance * 38, 55)}deg`);
      card.style.setProperty('--layer', 10 - distance);
      card.style.setProperty('--opacity', distance > 2 ? 0 : distance === 2 ? .4 : 1);
      card.classList.toggle('is-active', distance === 0);
      card.classList.toggle('is-away', distance > 2);
      card.tabIndex = distance === 0 ? 0 : -1;
      card.setAttribute('aria-hidden', distance === 0 ? 'false' : 'true');
    });
    counter.innerHTML = `${String(current + 1).padStart(2, '0')} <span>/ ${cards.length}</span>`;
    play.innerHTML = userPaused ? 'REPRODUZIR <span aria-hidden="true">▶</span>' : 'PAUSAR <span aria-hidden="true">Ⅱ</span>';
    play.setAttribute('aria-label', userPaused ? 'Iniciar passagem automática' : 'Pausar passagem automática');
  }

  function select(index, manual = false) {
    const cardHadFocus = cards.includes(document.activeElement);
    current = (index + cards.length) % cards.length;
    render();
    if (cardHadFocus) cards[current].focus({ preventScroll: true });
    if (manual) status.textContent = `Foto ${current + 1} de ${cards.length}: ${cards[current].querySelector('img').alt}`;
    schedule();
  }

  controls.querySelectorAll('[data-direction]').forEach(button => {
    button.addEventListener('click', () => select(current + Number(button.dataset.direction), true));
  });
  play.addEventListener('click', () => {
    userPaused = !userPaused;
    focused = false;
    render();
    schedule();
  });
  carousel.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      select(current + (event.key === 'ArrowRight' ? 1 : -1), true);
    }
  });
  deck.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') { hovered = true; schedule(); }
  });
  deck.addEventListener('pointerleave', () => { hovered = false; schedule(); });
  carousel.addEventListener('focusin', () => { focused = true; schedule(); });
  carousel.addEventListener('focusout', event => {
    if (!carousel.contains(event.relatedTarget)) { focused = false; schedule(); }
  });
  deck.addEventListener('dragstart', event => event.preventDefault());
  deck.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dragging: false };
    suppressClick = false;
    schedule();
  });
  deck.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer.dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.dragging && Math.abs(pointer.dx) > 12 && Math.abs(pointer.dx) > Math.abs(dy)) {
      pointer.dragging = true;
      deck.setPointerCapture(event.pointerId);
      deck.classList.add('is-dragging');
    }
  });
  function endDrag(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const drag = pointer;
    pointer = null;
    deck.classList.remove('is-dragging');
    if (deck.hasPointerCapture(event.pointerId)) deck.releasePointerCapture(event.pointerId);
    if (drag.dragging && event.type === 'pointerup') {
      suppressClick = true;
      if (Math.abs(drag.dx) > 35) select(current + (drag.dx < 0 ? 1 : -1), true);
    }
    schedule();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  cards.forEach((card, index) => card.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); suppressClick = false; return; }
    if (index !== current) { event.preventDefault(); select(index, true); return; }
    if (typeof viewer.showModal !== 'function') return;
    event.preventDefault();
    const image = card.querySelector('img');
    viewer.querySelector('img').src = card.href;
    viewer.querySelector('img').alt = image.alt;
    viewer.showModal();
    schedule();
  }));
  viewer.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => {
    if (event.target !== viewer) return;
    const rect = viewer.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
  });
  viewer.addEventListener('close', () => {
    cards[current].focus({ preventScroll: true });
    schedule();
  });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) userPaused = true;
    render();
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    schedule();
  }, { threshold: .2 }).observe(deck);
  new ResizeObserver(render).observe(deck);
  carousel.classList.add('is-ready');
  controls.hidden = false;
  render();
  schedule();
})();
