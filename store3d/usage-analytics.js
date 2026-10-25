// Owner reports live in Google Analytics, never in the customer interface.
(() => {
  'use strict';
  const canonical = 'https://nextgensalaya.github.io/AI-Item-Location/';
  const page = new URL(window.location.href);
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
  // No product searches, barcode values, shopping lists or user IDs are sent.
  // Enhanced measurement is disabled for this stream in the Analytics console.
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  script.referrerPolicy = 'no-referrer';
  document.head.appendChild(script);
})();
