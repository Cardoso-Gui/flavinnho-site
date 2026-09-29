const aftermovies = document.querySelectorAll('.aftermovie-video');
aftermovies.forEach(video => {
  video.addEventListener('play', () => {
    aftermovies.forEach(other => { if (other !== video) other.pause(); });
  });
});
