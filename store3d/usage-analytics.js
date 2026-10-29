// Owner reports live in Google Analytics, never in the customer interface.
(() => {
  'use strict';
  const canonical = 'https://nextgensalaya.github.io/AI-Item-Location/';
  const page = new URL(window.location.href);
  // Staff testing is opt-in per browser tab and survives refreshes in that tab.
  let testing = page.searchParams.get('usage_test') === '1';
  try {
    if (page.searchParams.get('usage_test') === '0') window.sessionStorage.removeItem('makro-usage-test');
    if (testing) window.sessionStorage.setItem('makro-usage-test', '1');
    testing ||= window.sessionStorage.getItem('makro-usage-test') === '1';
  } catch { /* The explicit test URL still works when browser storage is blocked. */ }
  if (testing) return;
  if (page.origin !== 'https://nextgensalaya.github.io' ||
      !['/AI-Item-Location/', '/AI-Item-Location/index.html'].includes(page.pathname) ||
      window.__makroUsageStarted) return;
  window.__makroUsageStarted = true;

  const measurementId = 'G-3G89YCPEFP';
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', measurementId, {
    page_location: canonical,
    page_referrer: '',
    page_title: 'Makro AI Item Location | Salaya',
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_path: '/AI-Item-Location/',
    cookie_flags: 'SameSite=Lax;Secure'
  });
  const languages = new Set(['th', 'en', 'zh', 'my', 'ko', 'ja', 'ru']);
  let catalog = new Map(), english = {}, currentLanguage = '', pending, timer;
  const sent = new Map();
  const normalize = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const limited = value => Array.from(value).slice(0, 100).join('');
  function emit(name, values, dedupeKey) {
    const now = Date.now();
    if (dedupeKey && now - (sent.get(dedupeKey) || 0) < 30000) return;
    if (dedupeKey) sent.set(dedupeKey, now);
    if (sent.size > 100) sent.delete(sent.keys().next().value);
    gtag('event', name, { ui_language: currentLanguage || 'th', ...values });
  }
  function flush() {
    clearTimeout(timer);
    if (!pending) return;
    const p = pending; pending = undefined;
    emit('product_search', p.values, 'search:' + p.key);
  }
  window.makroUsage = {
    catalog(rows) {
      catalog = new Map(rows.map(r => [String(r[0]), { id: String(r[0]), name: String(r[1]), barcode: String(r[2]) }]));
    },
    english(names) { english = names; },
    navigation(kind) {
      if (!['product', 'bay', 'guided'].includes(kind)) return;
      emit('navigation_start', { navigation_type: kind }, 'navigation:' + kind);
    },
    language(value) {
      if (!languages.has(value) || currentLanguage === value) return;
      currentLanguage = value;
      emit('app_language', {});
    },
    search(query, resultIds) {
      clearTimeout(timer); pending = undefined;
      const q = normalize(query);
      if (q.length < 2) return;
      const results = [...new Set(resultIds.map(String))].map(id => catalog.get(id)).filter(Boolean);
      let term = '';
      // Only transmit phrases found verbatim in the public catalog. Never send
      // arbitrary free text, emails, phone numbers or unmatched barcode values.
      const exact = /^\d+$/.test(q) && results.find(p => p.id === q || p.barcode === q);
      if (exact) term = limited(exact.name);
      else if (q.length <= 80 && !/[\d@\r\n]/.test(q)) {
        for (const p of results) {
          const name = [p.name, english[p.id] || ''].map(normalize).find(n => n.includes(q));
          if (name) { term = name.slice(name.indexOf(q), name.indexOf(q) + q.length); break; }
        }
      }
      const status = !results.length ? 'no_results' : term ? 'matched' : 'withheld';
      pending = { key: q + ':' + currentLanguage, query: q, ids: new Set(results.map(p => p.id)), values: {
        safe_search_term: term || '(' + status + ')', result_count: results.length, search_status: status, ui_language: currentLanguage || 'th'
      } };
      timer = setTimeout(flush, 1200);
    },
    select(id, query) {
      const p = catalog.get(String(id)), q = normalize(query);
      if (!p || q.length < 2) return;
      if (pending && pending.query === q) flush();
      emit('product_search_select', { product_id: p.id, product_name: limited(p.name) }, 'select:' + q + ':' + p.id);
    }
  };
  // No shopping lists, favourites, user IDs or raw search strings are sent.
  // Enhanced measurement is disabled for this stream in the Analytics console.
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  script.referrerPolicy = 'no-referrer';
  document.head.appendChild(script);
})();
