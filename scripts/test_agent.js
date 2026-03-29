const https = require('https');

const KIBANA_URL = 'https://my-elasticsearch-project-e39dd8.kb.us-central1.gcp.elastic.cloud:443';
const API_KEY = 'c3NQZVVKd0J0bTdQT3lMSkx6cEE6cTBVNzFWVlZBNlpFNjh6VENkb1hNUQ==';
const AGENT_ID = 'video_transcript_agent';
const QUERY = 'What is this video about?';

console.log('Testing Agent:', AGENT_ID);
console.log('Query:', QUERY);

const options = {
    hostname: new URL(KIBANA_URL).hostname,
    port: 443,
    path: '/api/agent_builder/converse',
    method: 'POST',
    headers: {
        'Authorization': `ApiKey ${API_KEY}`,
        'kbn-xsrf': 'true',
        'Content-Type': 'application/json'
    }
};

const req = https.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            console.log('Response:', data);
            const parsed = JSON.parse(data);
            console.log('Parsed:', JSON.stringify(parsed, null, 2));
        } catch (e) {
            console.error('Parse error:', e);
        }
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.write(JSON.stringify({
    input: QUERY,
    agent_id: AGENT_ID
}));

req.end();
