(() => {
  const carousel = document.querySelector('.photo-carousel');
  if (!carousel) return;
  const deck = carousel.querySelector('.photo-deck');
  const cards = [...deck.querySelectorAll('.photo-card')];
  const controls = carousel.querySelector('.gallery-controls');
  const playButton = carousel.querySelector('.gallery-play');
  const photoCounter = carousel.querySelector('.gallery-counter');
  const liveStatus = carousel.querySelector('.gallery-status');
  const viewer = document.querySelector('.photo-viewer');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const AUTOPLAY_DELAY_MS = 2500;
  const DRAG_START_DISTANCE_PX = 12;
  const SWIPE_DISTANCE_PX = 35;

  let currentPhotoIndex = 0;
  let userPaused = reducedMotion.matches;
  let hovered = false;
  let focused = false;
  let inView = true;
  let pointer = null;
  let suppressClick = false;
  let autoplayTimer;

  function scheduleAutoplay() {
    clearTimeout(autoplayTimer);
    if (userPaused || hovered || focused || !inView || document.hidden || viewer.open || pointer) return;
    autoplayTimer = setTimeout(() => selectPhoto(currentPhotoIndex + 1), AUTOPLAY_DELAY_MS);
  }

  function renderCarousel() {
    const step = Math.min(deck.clientWidth * .38, 265);
    cards.forEach((card, index) => {
      // Wrap the offset so the nearest cards stay on each side of the active photo.
      let offset = (index - currentPhotoIndex + cards.length) % cards.length;
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
    photoCounter.innerHTML = `${String(currentPhotoIndex + 1).padStart(2, '0')} <span>/ ${cards.length}</span>`;
    playButton.innerHTML = userPaused ? 'REPRODUZIR <span aria-hidden="true">▶</span>' : 'PAUSAR <span aria-hidden="true">Ⅱ</span>';
    playButton.setAttribute('aria-label', userPaused ? 'Iniciar passagem automática' : 'Pausar passagem automática');
  }

  function selectPhoto(index, manual = false) {
    const cardHadFocus = cards.includes(document.activeElement);
    currentPhotoIndex = (index + cards.length) % cards.length;
    renderCarousel();
    if (cardHadFocus) cards[currentPhotoIndex].focus({ preventScroll: true });
    if (manual) liveStatus.textContent = `Foto ${currentPhotoIndex + 1} de ${cards.length}: ${cards[currentPhotoIndex].querySelector('img').alt}`;
    scheduleAutoplay();
  }

  controls.querySelectorAll('[data-direction]').forEach(button => {
    button.addEventListener('click', () => selectPhoto(currentPhotoIndex + Number(button.dataset.direction), true));
  });
  playButton.addEventListener('click', () => {
    userPaused = !userPaused;
    focused = false;
    renderCarousel();
    scheduleAutoplay();
  });
  carousel.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      selectPhoto(currentPhotoIndex + (event.key === 'ArrowRight' ? 1 : -1), true);
    }
  });
  deck.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') { hovered = true; scheduleAutoplay(); }
  });
  deck.addEventListener('pointerleave', () => { hovered = false; scheduleAutoplay(); });
  carousel.addEventListener('focusin', () => { focused = true; scheduleAutoplay(); });
  carousel.addEventListener('focusout', event => {
    if (!carousel.contains(event.relatedTarget)) { focused = false; scheduleAutoplay(); }
  });
  deck.addEventListener('dragstart', event => event.preventDefault());
  deck.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dragging: false };
    suppressClick = false;
    scheduleAutoplay();
  });
  deck.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer.dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.dragging && Math.abs(pointer.dx) > DRAG_START_DISTANCE_PX && Math.abs(pointer.dx) > Math.abs(dy)) {
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
      // A completed swipe must not also open the photo viewer through its click event.
      suppressClick = true;
      if (Math.abs(drag.dx) > SWIPE_DISTANCE_PX) selectPhoto(currentPhotoIndex + (drag.dx < 0 ? 1 : -1), true);
    }
    scheduleAutoplay();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  cards.forEach((card, index) => card.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); suppressClick = false; return; }
    if (index !== currentPhotoIndex) { event.preventDefault(); selectPhoto(index, true); return; }
    if (typeof viewer.showModal !== 'function') return;
    event.preventDefault();
    const image = card.querySelector('img');
    viewer.querySelector('img').src = card.href;
    viewer.querySelector('img').alt = image.alt;
    viewer.showModal();
    scheduleAutoplay();
  }));
  viewer.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => {
    if (event.target !== viewer) return;
    const rect = viewer.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
  });
  viewer.addEventListener('close', () => {
    cards[currentPhotoIndex].focus({ preventScroll: true });
    scheduleAutoplay();
  });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) userPaused = true;
    renderCarousel();
    scheduleAutoplay();
  });
  document.addEventListener('visibilitychange', scheduleAutoplay);
  new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    scheduleAutoplay();
  }, { threshold: .2 }).observe(deck);
  new ResizeObserver(renderCarousel).observe(deck);
  carousel.classList.add('is-ready');
  controls.hidden = false;
  renderCarousel();
  scheduleAutoplay();
})();
