// Opens the viewer's More options and picks Delete, which opens the confirm (nothing is deleted).
(async () => {
  document.querySelector('.applet-view-header button[aria-label="More options"]').click();
  await new Promise((r) => setTimeout(r, 600));
  const row = [...document.querySelectorAll('.sb-menu .sb-menu-item')].find((e) => e.querySelector('.sb-menu-item__label')?.textContent.trim() === 'Delete');
  row?.click();
})();
