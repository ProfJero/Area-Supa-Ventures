// Registers the service worker (offline shell + fast repeat loads).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}
