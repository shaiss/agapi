const request = require('supertest');
const { expect } = require('chai');
const { authenticate } = require('./auth-helper');

// Base URL for the API
const baseUrl = process.env.BASE_URL || 'http://localhost:5000';

// Test suite for labs API endpoints
describe('Labs API', () => {
  let authCookie = null;
  let testLabId = null;
  let testCircleId = null;

  // Authentication before all tests
  before(async () => {
    try {
      authCookie = await authenticate();
    } catch (error) {
      console.error('Authentication failed:', error.message);
      throw error;
    }
  });

  // Test creating a new lab
  describe('Lab Creation', () => {
    it('Can create a new lab', async () => {
      const labData = {
        name: 'Test Lab',
        description: 'A test lab for API testing',
        experimentType: 'a_b_test',
        goals: 'Test the lab creation API',
        successMetrics: {
          metrics: [
            {
              name: 'Engagement',
              target: 80,
              priority: 'high'
            }
          ]
        }
      };

      const response = await request(baseUrl)
        .post('/api/labs')
        .set('Cookie', authCookie)
        .send(labData);

      expect(response.status).to.equal(201);
      expect(response.body).to.have.property('id');
      expect(response.body.name).to.equal(labData.name);
      expect(response.body.experimentType).to.equal(labData.experimentType);
      expect(response.body.status).to.equal('draft'); // Default status

      // Save the lab ID for later tests
      testLabId = response.body.id;
      console.log(`Created test lab with ID: ${testLabId}`);
    });

    it('Cannot create a lab without required fields', async () => {
      const response = await request(baseUrl)
        .post('/api/labs')
        .set('Cookie', authCookie)
        .send({
          // Missing name and experimentType
          description: 'An invalid lab that should fail'
        });

      expect(response.status).to.be.oneOf([400, 422]);
      // Expect some kind of validation error message
      expect(response.body).to.have.property('message');
    });
  });

  // Test getting labs
  describe('Lab Retrieval', () => {
    it('Can get all labs', async () => {
      const response = await request(baseUrl)
        .get('/api/labs')
        .set('Cookie', authCookie);

      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array');
      // Should have at least the one we created
      expect(response.body.length).to.be.at.least(1);
    });

    it('Can get a specific lab by ID', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const response = await request(baseUrl)
        .get(`/api/labs/${testLabId}`)
        .set('Cookie', authCookie);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('id', testLabId);
      expect(response.body).to.have.property('name');
      expect(response.body).to.have.property('experimentType');
    });

    it('Returns 404 for non-existent lab', async () => {
      const response = await request(baseUrl)
        .get('/api/labs/99999') // Assuming this ID does not exist
        .set('Cookie', authCookie);

      expect(response.status).to.equal(404);
    });
  });

  // Test updating a lab
  describe('Lab Updates', () => {
    it('Can update a lab', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const updateData = {
        name: 'Updated Test Lab',
        description: 'An updated test lab description',
        goals: 'Updated goals for testing'
      };

      const response = await request(baseUrl)
        .patch(`/api/labs/${testLabId}`)
        .set('Cookie', authCookie)
        .send(updateData);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('id', testLabId);
      expect(response.body.name).to.equal(updateData.name);
      expect(response.body.description).to.equal(updateData.description);
      expect(response.body.goals).to.equal(updateData.goals);
    });

    it('Can update lab status', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const statusUpdate = {
        status: 'active'
      };

      const response = await request(baseUrl)
        .patch(`/api/labs/${testLabId}/status`)
        .set('Cookie', authCookie)
        .send(statusUpdate);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('id', testLabId);
      expect(response.body.status).to.equal(statusUpdate.status);
      expect(response.body).to.have.property('launchedAt'); // Should set the launch date
    });

    it('Validates lab status updates', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const statusUpdate = {
        status: 'invalid_status' // Invalid status
      };

      const response = await request(baseUrl)
        .patch(`/api/labs/${testLabId}/status`)
        .set('Cookie', authCookie)
        .send(statusUpdate);

      expect(response.status).to.be.oneOf([400, 422]);
      expect(response.body).to.have.property('message');
    });
  });

  // Test lab circles
  describe('Lab Circles', () => {
    // Create a test circle to use with lab
    before(async () => {
      // Skip circle creation if we already have one
      if (testCircleId) return;

      const circleData = {
        name: 'Test Lab Circle',
        description: 'A circle for testing lab functionality',
        visibility: 'public'
      };

      const response = await request(baseUrl)
        .post('/api/circles')
        .set('Cookie', authCookie)
        .send(circleData);

      if (response.status === 201 && response.body && response.body.id) {
        testCircleId = response.body.id;
        console.log(`Created test circle with ID: ${testCircleId}`);
      } else {
        console.warn('Failed to create test circle. Circle tests may fail.');
      }
    });

    it('Can add a circle to a lab', async () => {
      if (!testLabId || !testCircleId) {
        throw new Error('Test lab ID or circle ID not available. Previous tests may have failed.');
      }

      const circleData = {
        circleId: testCircleId,
        role: 'treatment'
      };

      const response = await request(baseUrl)
        .post(`/api/labs/${testLabId}/circles`)
        .set('Cookie', authCookie)
        .send(circleData);

      expect(response.status).to.equal(201);
      expect(response.body).to.have.property('id');
      expect(response.body).to.have.property('labId', testLabId);
      expect(response.body).to.have.property('circleId', testCircleId);
      expect(response.body).to.have.property('role', circleData.role);
    });

    it('Can get circles for a lab', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const response = await request(baseUrl)
        .get(`/api/labs/${testLabId}/circles`)
        .set('Cookie', authCookie);

      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array');
      // Should have at least the one we added
      expect(response.body.length).to.be.at.least(1);
      
      // Verify the circle details
      const circleFound = response.body.some(c => c.circle && c.circle.id === testCircleId);
      expect(circleFound).to.be.true;
    });

    it('Can get circle stats for a lab', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const response = await request(baseUrl)
        .get(`/api/labs/${testLabId}/circles/stats`)
        .set('Cookie', authCookie);

      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('object');
      expect(response.body).to.have.property('circles');
      expect(response.body.circles).to.be.an('array');
    });

    it('Can update a circle role in a lab', async () => {
      if (!testLabId || !testCircleId) {
        throw new Error('Test lab ID or circle ID not available. Previous tests may have failed.');
      }

      const updateData = {
        role: 'control'
      };

      const response = await request(baseUrl)
        .patch(`/api/labs/${testLabId}/circles/${testCircleId}`)
        .set('Cookie', authCookie)
        .send(updateData);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('labId', testLabId);
      expect(response.body).to.have.property('circleId', testCircleId);
      expect(response.body).to.have.property('role', updateData.role);
    });
  });

  // Test lab duplication
  describe('Lab Duplication', () => {
    it('Can duplicate a lab', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const response = await request(baseUrl)
        .post(`/api/labs/${testLabId}/duplicate`)
        .set('Cookie', authCookie);

      expect(response.status).to.equal(201);
      expect(response.body).to.have.property('id');
      expect(response.body.id).to.not.equal(testLabId); // Should be a new ID
      expect(response.body.name).to.include('Copy'); // Name should indicate it's a copy
    });
  });

  // Test lab posts
  describe('Lab Posts', () => {
    it('Can get posts for a lab', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const response = await request(baseUrl)
        .get(`/api/labs/${testLabId}/posts`)
        .set('Cookie', authCookie);

      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array');
      // May be empty if no posts exist yet
    });
  });

  // Test lab deletion (do this last)
  describe('Lab Deletion', () => {
    it('Can remove a circle from a lab', async () => {
      if (!testLabId || !testCircleId) {
        throw new Error('Test lab ID or circle ID not available. Previous tests may have failed.');
      }

      const response = await request(baseUrl)
        .delete(`/api/labs/${testLabId}/circles/${testCircleId}`)
        .set('Cookie', authCookie);

      expect(response.status).to.equal(200);
      // Should return success message or deleted record
      if (response.body.message) {
        expect(response.body.message).to.include('success');
      } else {
        expect(response.body).to.have.property('circleId', testCircleId);
      }
    });

    it('Can delete a lab', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const response = await request(baseUrl)
        .delete(`/api/labs/${testLabId}`)
        .set('Cookie', authCookie);

      expect(response.status).to.equal(200);
      // Should return success message or deleted record
      if (response.body.message) {
        expect(response.body.message).to.include('success');
      } else {
        expect(response.body).to.have.property('id', testLabId);
      }
    });

    it('Cannot access a deleted lab', async () => {
      if (!testLabId) {
        throw new Error('Test lab ID not available. Lab creation test may have failed.');
      }

      const response = await request(baseUrl)
        .get(`/api/labs/${testLabId}`)
        .set('Cookie', authCookie);

      expect(response.status).to.equal(404);
    });
  });
});