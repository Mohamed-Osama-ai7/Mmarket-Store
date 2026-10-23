// Local Docker/dev defaults. For a Vercel deployment, set apiURL and socketURL to the
// public Railway backend origin, e.g. https://your-api.up.railway.app/api/v1/.
// Do not put secrets in this file; it is downloaded by every site visitor.
window.__MMARKET_CONFIG__ = window.__MMARKET_CONFIG__ || {
  apiURL: '/api/v1/',
  mediaURL: '/api/v1/media/products/',
  socketPath: '/socket.io',
  socketURL: ''
};
