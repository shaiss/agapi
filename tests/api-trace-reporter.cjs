/**
 * API Trace Reporter for Jest
 * 
 * This reporter generates detailed API trace reports from API calls logged
 * during test execution using the api-trace-logger module.
 */
const fs = require('fs');
const path = require('path');
const apiTraceLogger = require('./api-trace-logger.cjs');

class ApiTraceReporter {
  constructor(globalConfig, options) {
    this.globalConfig = globalConfig;
    this.options = options || {};
    this.outputDir = options.outputDir || './test-reports';
    this.outputFile = options.outputFile || 'api-trace-report.json';
    this.htmlReport = options.htmlReport || 'api-trace-report.html';
  }

  onRunStart() {
    // Clear previous API calls
    apiTraceLogger.clearApiCalls();
  }

  onTestStart(test) {
    // Track the current test
    apiTraceLogger.initializeTest({
      name: test.name,
      path: test.path,
      fullName: test.fullName
    });
  }

  onTestEnd() {
    // Clear current test
    apiTraceLogger.clearTest();
  }

  onRunComplete() {
    const apiCalls = apiTraceLogger.getApiCalls();
    
    // If no API calls, no need to generate reports
    if (apiCalls.length === 0) {
      console.log('\nNo API calls were traced during test execution.');
      return;
    }
    
    // Ensure the output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    // Write the API calls to a JSON file
    const outputPath = path.join(this.outputDir, this.outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(apiCalls, null, 2));
    
    // Generate an HTML report for easier viewing
    this.generateHtmlReport(apiCalls);
    
    console.log(`\nAPI Trace Report generated: ${outputPath}`);
    console.log(`HTML Report generated: ${path.join(this.outputDir, this.htmlReport)}`);
    console.log(`Total API calls traced: ${apiCalls.length}`);
  }

  generateHtmlReport(apiCalls) {
    const htmlPath = path.join(this.outputDir, this.htmlReport);
    
    // Group API calls by test
    const testGroups = {};
    apiCalls.forEach(call => {
      if (!call.test) {
        // For API calls not associated with a test
        if (!testGroups['Unassociated API Calls']) {
          testGroups['Unassociated API Calls'] = [];
        }
        testGroups['Unassociated API Calls'].push(call);
        return;
      }
      
      const testName = call.test.fullName;
      if (!testGroups[testName]) {
        testGroups[testName] = [];
      }
      testGroups[testName].push(call);
    });
    
    // Generate HTML
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>API Trace Report</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 20px;
          background-color: #f5f5f5;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          background-color: #fff;
          padding: 20px;
          border-radius: 5px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
          color: #2c3e50;
          border-bottom: 2px solid #3498db;
          padding-bottom: 10px;
        }
        h2 {
          color: #2c3e50;
          margin-top: 30px;
          padding-bottom: 8px;
          border-bottom: 1px solid #ddd;
        }
        .test-name {
          background-color: #f8f9fa;
          padding: 10px;
          border-radius: 4px;
          margin-bottom: 15px;
          border-left: 4px solid #3498db;
        }
        .api-call {
          border: 1px solid #ddd;
          border-radius: 4px;
          margin-bottom: 15px;
          background-color: #fff;
        }
        .api-call-header {
          display: flex;
          justify-content: space-between;
          background-color: #e9ecef;
          padding: 8px 15px;
          cursor: pointer;
          user-select: none;
        }
        .api-call-method {
          font-weight: bold;
          margin-right: 10px;
        }
        .method-GET { color: #28a745; }
        .method-POST { color: #007bff; }
        .method-PUT, .method-PATCH { color: #fd7e14; }
        .method-DELETE { color: #dc3545; }
        .status-success { color: #28a745; }
        .status-redirect { color: #fd7e14; }
        .status-client-error { color: #dc3545; }
        .status-server-error { color: #dc3545; }
        .api-call-details {
          padding: 15px;
          display: none;
          border-top: 1px solid #ddd;
        }
        .active .api-call-details {
          display: block;
        }
        .detail-section {
          margin-bottom: 15px;
        }
        .detail-section h4 {
          margin-bottom: 5px;
          color: #555;
        }
        pre {
          background-color: #f8f9fa;
          padding: 10px;
          border-radius: 4px;
          overflow: auto;
          margin: 0;
        }
        .summary {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #e9ecef;
          border-radius: 4px;
        }
        .menu {
          position: sticky;
          top: 10px;
          max-height: calc(100vh - 40px);
          overflow-y: auto;
          background-color: #fff;
          padding: 15px;
          border-radius: 4px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          margin-bottom: 20px;
        }
        .menu ul {
          list-style-type: none;
          padding: 0;
          margin: 0;
        }
        .menu li {
          margin-bottom: 8px;
        }
        .menu a {
          color: #3498db;
          text-decoration: none;
        }
        .menu a:hover {
          text-decoration: underline;
        }
        .two-columns {
          display: grid;
          grid-template-columns: 1fr 3fr;
          gap: 20px;
        }
        .stats {
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }
        .stat-item {
          background-color: #e9ecef;
          border-radius: 4px;
          padding: 10px 15px;
          flex: 1;
          min-width: 150px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .stat-label {
          font-size: 12px;
          color: #6c757d;
          margin-bottom: 5px;
        }
        .stat-value {
          font-size: 18px;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>API Trace Report</h1>
        <div class="summary">
          <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Total API Calls:</strong> ${apiCalls.length}</p>
          <p><strong>Tests:</strong> ${Object.keys(testGroups).length}</p>
        </div>
        
        <div class="stats">
          <div class="stat-item">
            <div class="stat-label">Total API Calls</div>
            <div class="stat-value">${apiCalls.length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">GET Requests</div>
            <div class="stat-value">${apiCalls.filter(call => call.request?.method === 'GET').length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">POST Requests</div>
            <div class="stat-value">${apiCalls.filter(call => call.request?.method === 'POST').length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">PUT/PATCH Requests</div>
            <div class="stat-value">${apiCalls.filter(call => ['PUT', 'PATCH'].includes(call.request?.method)).length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">DELETE Requests</div>
            <div class="stat-value">${apiCalls.filter(call => call.request?.method === 'DELETE').length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Average Response Time</div>
            <div class="stat-value">${Math.round(apiCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / apiCalls.length)}ms</div>
          </div>
        </div>
        
        <div class="two-columns">
          <div class="menu">
            <h3>Tests</h3>
            <ul>
              ${Object.keys(testGroups).map(testName => 
                `<li><a href="#${encodeURIComponent(testName)}">${testName}</a></li>`
              ).join('')}
            </ul>
          </div>
          
          <div class="content">
    `;
    
    // Add each test group
    Object.entries(testGroups).forEach(([testName, calls]) => {
      html += `
        <div class="test-group">
          <h2 id="${encodeURIComponent(testName)}" class="test-name">${testName}</h2>
      `;
      
      // Add each API call
      calls.forEach((call, index) => {
        const statusCode = call.response?.status;
        let statusClass = '';
        
        if (statusCode >= 200 && statusCode < 300) statusClass = 'status-success';
        else if (statusCode >= 300 && statusCode < 400) statusClass = 'status-redirect';
        else if (statusCode >= 400 && statusCode < 500) statusClass = 'status-client-error';
        else if (statusCode >= 500) statusClass = 'status-server-error';
        
        html += `
          <div class="api-call" data-call-id="${index}">
            <div class="api-call-header">
              <span>
                <span class="api-call-method method-${call.request?.method}">${call.request?.method || 'UNKNOWN'}</span>
                <span class="api-call-url">${call.request?.url || 'Unknown URL'}</span>
              </span>
              <span class="api-call-status ${statusClass}">${statusCode || 'No response'} (${call.duration || 0}ms)</span>
            </div>
            <div class="api-call-details">
              <div class="detail-section">
                <h4>Request</h4>
                <pre>${JSON.stringify(call.request || {}, null, 2)}</pre>
              </div>
              <div class="detail-section">
                <h4>Response</h4>
                <pre>${JSON.stringify(call.response || {}, null, 2)}</pre>
              </div>
              ${call.error ? `
              <div class="detail-section">
                <h4>Error</h4>
                <pre>${JSON.stringify(call.error, null, 2)}</pre>
              </div>
              ` : ''}
              <div class="detail-section">
                <h4>Timestamp</h4>
                <pre>${call.timestamp}</pre>
              </div>
            </div>
          </div>
        `;
      });
      
      html += `</div>`;
    });
    
    html += `
          </div>
        </div>
      </div>
      <script>
        // Add click handlers to expand/collapse API call details
        document.querySelectorAll('.api-call-header').forEach(header => {
          header.addEventListener('click', () => {
            const call = header.parentElement;
            call.classList.toggle('active');
          });
        });
      </script>
    </body>
    </html>
    `;
    
    fs.writeFileSync(htmlPath, html);
  }
}

module.exports = ApiTraceReporter;