const menuLinks = [...document.querySelectorAll('.site-header nav a')];
const sections = menuLinks.map(link => document.querySelector(link.getAttribute('href')));
let scheduled = false;
function updateActiveSection() {
  const offset = document.querySelector('.site-header').offsetHeight + 100;
  let active = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= offset) active = section;
  }
  for (const link of menuLinks) {
    if (link.getAttribute('href') === `#${active.id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
  scheduled = false;
}
window.addEventListener('scroll', () => {
  if (!scheduled) { scheduled = true; requestAnimationFrame(updateActiveSection); }
}, { passive: true });
window.addEventListener('resize', updateActiveSection);
document.getElementById('year').textContent = new Date().getFullYear();
updateActiveSection();