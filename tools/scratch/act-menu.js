// Opens the viewer's More options and picks the row named in the file name's sibling:
// window.__probeRow, else "Edit description".
(async () => {
  const label = window.__probeRow || 'Edit description';
  document.querySelector('.applet-view-header button[aria-label="More options"]').click();
  await new Promise((r) => setTimeout(r, 600));
  const row = [...document.querySelectorAll('.sb-menu .sb-menu-item')].find((e) => e.querySelector('.sb-menu-item__label')?.textContent.trim() === label);
  row?.click();
})();
