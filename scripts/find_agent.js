const https = require('https');

const ES_URL = 'https://my-elasticsearch-project-e39dd8.es.us-central1.gcp.elastic.cloud:443';
const API_KEY = 'c3NQZVVKd0J0bTdQT3lMSkx6cEE6cTBVNzFWVlZBNlpFNjh6VENkb1hNUQ==';

// Guessing Kibana URL
const KIBANA_URL = ES_URL.replace('.es.', '.kb.');

console.log('Trying Kibana URL:', KIBANA_URL);

const options = {
    hostname: new URL(KIBANA_URL).hostname,
    port: 443,
    path: '/api/agent_builder/agents',
    method: 'GET',
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
            if (res.statusCode === 200) {
                const agents = JSON.parse(data).body; // The response structure usually wraps items
                // Or sometimes it's an array directly or { items: [] }
                // Let's just log the full raw response or a snippet if too large
                console.log('Response snippets:', data.substring(0, 500));

                const parsed = JSON.parse(data);
                const list = Array.isArray(parsed) ? parsed : (parsed.items || parsed.body || []);

                const agent = list.find(a => a.name === 'video_transcript_agent');
                if (agent) {
                    console.log('FOUND AGENT:', agent);
                    console.log(`AGENT_ID=${agent.id}`);
                } else {
                    console.log('Agent "video_transcript_agent" not found in list.');
                    console.log('Available agents:', list.map(a => a.name));
                }
            } else {
                console.log('Error body:', data);
            }
        } catch (e) {
            console.error('Parse error:', e, data);
        }
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
