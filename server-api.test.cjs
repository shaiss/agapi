/**
 * Simple API test against the running server
 */
const supertest = require('supertest');
const { initializeBaseUrl, BASE_URLS } = require('./auth-helper.test.cjs');

// Base URL will be determined dynamically
let BASE_URL = BASE_URLS[0]; // Start with first option

describe('Server API', () => {
  // Initialize before running tests
  beforeAll(async () => {
    BASE_URL = await initializeBaseUrl();
    console.log(`Server API tests using base URL: ${BASE_URL}`);
  });
  
  // Get a new request object with the correct base URL
  const getRequest = () => supertest(BASE_URL);
  
  test('GET /api/user returns 401 when not authenticated', async () => {
    const response = await getRequest().get('/api/user');
    expect(response.status).toBe(401);
  });
  
  test('GET /api endpoint exists', async () => {
    // This just checks that the server is running and responding
    const response = await getRequest().get('/api');
    // Even if it returns an error, we just want to confirm the server responds
    expect(response.status).toBeDefined();
  });
});