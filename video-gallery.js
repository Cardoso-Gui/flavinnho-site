document.querySelectorAll('.aftermovie-load').forEach(button => {
  button.addEventListener('click', () => {
    const host = button.closest('.aftermovie-player');
    const player = document.createElement('iframe');
    player.src = host.dataset.playerSrc;
    player.title = host.dataset.playerTitle;
    player.allow = 'fullscreen';
    player.allowFullscreen = true;
    host.replaceChildren(player);
    player.focus();
  });
});
