const queries = ['intercom', 'stripe', 'plaid', 'square', 'cloudflare', 'hubspot', 'pipedream', 'paypal', 'deepwiki', 'devin', 'robot', 'brain', 'ai'];

async function search() {
  for (const q of queries) {
    try {
      const res = await fetch(\`https://api.iconify.design/search?query=\${q}\`);
      const data = await res.json();
      console.log(q, ':', data.icons ? data.icons.slice(0, 3).join(', ') : 'none');
    } catch (e) {
      console.error(q, e.message);
    }
  }
}
search();
