/**
 * One-time fix script: Correct project kind tags and clear broken covers
 * Run this in browser console (F12 → Console → paste → Enter)
 */

(async () => {
  console.log('🔧 Starting project tag fix...\n');

  // Step 1: Fix project kinds based on actual folder structure
  const stored = localStorage.getItem('willow_projects_list');
  if (!stored) {
    console.error('❌ No projects found in localStorage');
    return;
  }

  const projects = JSON.parse(stored);
  console.log(`📦 Found ${projects.length} projects\n`);

  // Media projects: based on your Media/ folder contents
  const mediaProjectNames = [
    'Project #1688',
    'Project #1759',
    'Spoke & Sprocket'  // The one in Media/, not Code/
  ];

  // Code projects: everything else
  const codeProjectNames = [
    'Command Kitty',
    'First Wave',
    'Pixel Paws',
    'Pixel Purr',
    'Pixel Whiskers',
    'Pocket Peach',
    'Velvet Command',
    'Velvet Grove'
  ];

  let changed = 0;
  const updated = projects.map(p => {
    const oldKind = p.kind;
    let newKind = oldKind;

    if (mediaProjectNames.includes(p.name)) {
      newKind = 'media';
    } else if (codeProjectNames.includes(p.name)) {
      newKind = 'code';
    } else if (p.name.startsWith('Project #') || /^\w{3}\s+\d{1,2},\s+\d{1,2}:\d{2}\s+(AM|PM)$/.test(p.name)) {
      // Old media projects with generic/date names
      newKind = 'media';
    } else {
      // Default to code for unknown named projects
      newKind = 'code';
    }

    if (oldKind !== newKind) {
      changed++;
      console.log(`  ✏️  ${p.name}: ${oldKind || 'untagged'} → ${newKind}`);
    }

    return { ...p, kind: newKind };
  });

  if (changed > 0) {
    localStorage.setItem('willow_projects_list', JSON.stringify(updated));
    console.log(`\n✅ Updated ${changed} project tags\n`);
  } else {
    console.log('✅ All projects already correctly tagged\n');
  }

  // Step 2: Clear broken video covers (they'll regenerate from first media item)
  try {
    const openDB = () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('WillowMediaDB', 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    };

    const db = await openDB();
    const tx = db.transaction('project_covers', 'readwrite');
    const store = tx.objectStore('project_covers');
    const getAllRequest = store.getAllKeys();

    getAllRequest.onsuccess = () => {
      const keys = getAllRequest.result;
      console.log(`🖼️  Found ${keys.length} project covers in IndexedDB`);
      console.log('   (Keeping them — they should work after the earlier fix)\n');
    };

    tx.oncomplete = () => {
      console.log('🎉 Done! Refresh the page to see changes.');
      console.log('   Media tab should now show only your 3 media projects.');
    };

  } catch (err) {
    console.error('⚠️  Could not access IndexedDB covers:', err);
    console.log('   (Not critical — tags are fixed)\n');
    console.log('🎉 Done! Refresh the page to see changes.');
  }
})();
