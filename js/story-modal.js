const story = document.querySelector('.story');

// Keep the original expandable story available if dialogs are unsupported.
if (story && typeof HTMLDialogElement !== 'undefined' && HTMLDialogElement.prototype.showModal) {
  const dialog = document.createElement('dialog');
  dialog.id = 'story-dialog';
  dialog.className = 'story-dialog';
  dialog.setAttribute('aria-labelledby', 'story-dialog-title');
  dialog.innerHTML = '<div class="story-dialog-header"><h2 id="story-dialog-title">Minha história</h2><button type="button" class="story-close" aria-label="Fechar história" autofocus>×</button></div><div class="story-dialog-content"></div>';
  const content = dialog.querySelector('.story-dialog-content');
  const intro = document.querySelector('.about-copy .body-copy');
  if (intro) content.append(intro.cloneNode(true));
  story.querySelectorAll('p').forEach(paragraph => content.append(paragraph.cloneNode(true)));

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'story-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', dialog.id);
  trigger.innerHTML = 'CONHEÇA MINHA HISTÓRIA <span aria-hidden="true">+</span>';
  story.replaceWith(trigger);
  document.body.append(dialog);

  trigger.addEventListener('click', () => {
    dialog.showModal();
    content.scrollTop = 0;
  });
  dialog.querySelector('.story-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));
}
