// Production runtime configuration for Vercel storefront.
// Do not put secrets in this file; it is downloaded by every site visitor.
window.__MMARKET_CONFIG__ = window.__MMARKET_CONFIG__ || {
  apiURL: 'https://mmarket-store-backend.onrender.com/api/v1/',
  mediaURL: 'https://mmarket-store-backend.onrender.com/api/v1/media/products/',
  socketPath: '/socket.io',
  socketURL: 'https://mmarket-store-backend.onrender.com'
};
