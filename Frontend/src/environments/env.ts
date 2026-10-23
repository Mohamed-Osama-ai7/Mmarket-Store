export interface MmarketRuntimeConfig {
  apiURL?: string;
  mediaURL?: string;
  socketPath?: string;
  socketURL?: string;
}

const runtimeConfig = typeof window !== 'undefined'
  ? (window as Window & { __MMARKET_CONFIG__?: MmarketRuntimeConfig }).__MMARKET_CONFIG__
  : undefined;

export const environment = {
  // Defaults work with the included Docker/Nginx and Angular development proxies.
  // For Vercel + Railway, set apiURL, mediaURL and socketURL in public/runtime-config.js.
  apiURL: (runtimeConfig?.apiURL || '/api/v1/').replace(/\/$/, '') + '/',
  mediaURL: runtimeConfig?.mediaURL || '/api/v1/media/products/',
  socketPath: runtimeConfig?.socketPath || '/socket.io',
  socketURL: runtimeConfig?.socketURL || '',
  isProduction: false
};
