const fs = require('fs');
let c = fs.readFileSync('features/chat/src/composer/Composer.tsx', 'utf8');

const s1 = `                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
                    <line x1="7" y1="8" x2="7" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="17" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>`;

const r1 = `                  <svg width="24" height="24" viewBox="0 0 24 24" focusable="false" aria-hidden="true" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="text-white">
                    <path d="M10 3.1a.9.9 0 0 1 .9.9v16a.9.9 0 0 1-1.8 0V4a.9.9 0 0 1 .9-.9M15 5.6a.9.9 0 0 1 .9.9v10a.9.9 0 0 1-1.8 0v-10a.9.9 0 0 1 .9-.9M5 8.6a.9.9 0 0 1 .9.9v5a.9.9 0 0 1-1.8 0v-5a.9.9 0 0 1 .9-.9M20 9.1a.9.9 0 0 1 .9.9v4a.9.9 0 0 1-1.8 0v-4a.9.9 0 0 1 .9-.9"/>
                  </svg>`;

const s2 = `                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-black">
                    <line x1="7" y1="8" x2="7" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="17" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>`;

const r2 = `                  <svg width="24" height="24" viewBox="0 0 24 24" focusable="false" aria-hidden="true" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="text-black">
                    <path d="M10 3.1a.9.9 0 0 1 .9.9v16a.9.9 0 0 1-1.8 0V4a.9.9 0 0 1 .9-.9M15 5.6a.9.9 0 0 1 .9.9v10a.9.9 0 0 1-1.8 0v-10a.9.9 0 0 1 .9-.9M5 8.6a.9.9 0 0 1 .9.9v5a.9.9 0 0 1-1.8 0v-5a.9.9 0 0 1 .9-.9M20 9.1a.9.9 0 0 1 .9.9v4a.9.9 0 0 1-1.8 0v-4a.9.9 0 0 1 .9-.9"/>
                  </svg>`;

const s3 = `                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-black">
                            <line x1="7" y1="8" x2="7" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            <line x1="17" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                          </svg>`;

const r3 = `                          <svg width="24" height="24" viewBox="0 0 24 24" focusable="false" aria-hidden="true" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="text-black">
                            <path d="M10 3.1a.9.9 0 0 1 .9.9v16a.9.9 0 0 1-1.8 0V4a.9.9 0 0 1 .9-.9M15 5.6a.9.9 0 0 1 .9.9v10a.9.9 0 0 1-1.8 0v-10a.9.9 0 0 1 .9-.9M5 8.6a.9.9 0 0 1 .9.9v5a.9.9 0 0 1-1.8 0v-5a.9.9 0 0 1 .9-.9M20 9.1a.9.9 0 0 1 .9.9v4a.9.9 0 0 1-1.8 0v-4a.9.9 0 0 1 .9-.9"/>
                          </svg>`;

// We just replace ignoring whitespace variations using regex
function replaceIgnoringWhitespace(str, search, replacement) {
  const pattern = search.replace(/\s+/g, '\\s+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(pattern);
  return str.replace(regex, replacement);
}

let c2 = replaceIgnoringWhitespace(c, s1, r1);
c2 = replaceIgnoringWhitespace(c2, s2, r2);
c2 = replaceIgnoringWhitespace(c2, s3, r3);

if (c !== c2) {
  fs.writeFileSync('features/chat/src/composer/Composer.tsx', c2);
  console.log('Replaced successfully');
} else {
  console.log('No replacement matched');
}
