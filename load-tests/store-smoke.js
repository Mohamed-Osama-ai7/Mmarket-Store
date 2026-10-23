import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '60s', target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const health = http.get(`${baseUrl}/api/v1/health/ready`);
  check(health, { 'API readiness returns 200': (response) => response.status === 200 });
  const products = http.get(`${baseUrl}/api/v1/product?page=1&pageSize=12&sort=newest`);
  check(products, {
    'product list returns 200': (response) => response.status === 200,
    'product response is JSON': (response) => (response.headers['Content-Type'] || '').includes('application/json'),
  });
  sleep(1);
}
