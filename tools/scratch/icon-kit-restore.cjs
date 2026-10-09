// Puts the icon-font kit URLs in apps/studio/index.html back to what they were before the
// media work's subset rebuild (Oct 4) — the Luminous one is also HEAD's; the Google one is the
// newer uncommitted kit that was on disk then, not HEAD's older v459.
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../../apps/studio/index.html');
const BEFORE = {
  'Luminous Symbols': 'https://fonts.gstatic.com/l/font?kit=daaOSSYgOGmYaRLpq55MPuzv2kUKwTXcoFHm2zCWlB3F1WQIV8RopohwcDXo4e5J9gZ4U7xddIimtf_IVhIHUUZE2MAXvEMvroe_2ApV2xaXBT7_w4L0SiM4QAb2SyCCIIR2Vd32BxhHrLxVQhjz0lNhWG-AzoQxyiw_4BQArjOuLkAHWWzgSSXkQq311CLLTp-lxr_gUH7GySbVwVnWfH9H-VV9cB1tnzcw4zuAw4CuzQxOTdUu_1t9cDgSsJ5m_Z1NqTB3TSX1A8vda9bZpIPP2IESJ2Qwf9_vn6yH6ZH91CAOdMWdC2ATmPB2QW-mJafEJ4mudD9qX7wGAl5VYNuUtD6NCNCeDu20WI-AvieR9QKMTraNsI6SsKnCmWc8mm3LKA&skey=bef131c18897d264&v=v56',
  'Google Symbols': 'https://fonts.gstatic.com/l/font?kit=Hhy3U5Ak9u-oMExPeInvcuEmPosC9zS3FYkFU68cPrjdKM1pSPywlmmzc_ohQP9PrGumSDfXZxlcLqnGuwPZJRKqKpOpSuTF7kQwhmtXzkHcoEOgsYHkl5BgOC1ej9pybUE9mnaifXDG1-UgKGE4z1f76ptOd5KApKwIkqxW988wC6bIwdpT3B480wbDv2ozwGq17jKXOhJvCPiJut_OSVfMZLcLr3-YMl7xSaNO3fV6b7WNRnsChu1zrJk5-XEqn2GdISb1-bYBB_lD1t1jV1OE7SU7osWo3yNZsTNIvBwjHuhJgx5TxvxA6wB-RnE-PtJD1euOjKALxOoWSiMCv6CJaiIQZ_AtHO97v6JBhdEG41Dc_gtxuqLmV4q9zDPfxfpA2w&skey=f8ec4d50247dc1c1&v=v463',
};

let html = fs.readFileSync(FILE, 'utf8');
for (const [family, url] of Object.entries(BEFORE)) {
  const m = html.match(new RegExp(`font-family:\\s*"${family}";[\\s\\S]{0,1200}?src:\\s*url\\("([^"]+)"\\)`));
  if (!m) throw new Error(`${family} @font-face not found`);
  if (m[1] === url) { console.log(`${family}: already the pre-change kit`); continue; }
  html = html.replace(m[1], url);
  console.log(`${family}: restored`);
}
fs.writeFileSync(FILE, html);
