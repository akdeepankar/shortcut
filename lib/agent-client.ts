
const KIBANA_URL = process.env.KIBANA_URL || 'https://my-elasticsearch-project-e39dd8.kb.us-central1.gcp.elastic.cloud:443';
const API_KEY = process.env.ELASTIC_API_KEY || 'c3NQZVVKd0J0bTdQT3lMSkx6cEE6cTBVNzFWVlZBNlpFNjh6VENkb1hNUQ==';
const AGENT_ID = 'video_transcript_agent';

interface AgentResponse {
    reply: string;
    conversation_id: string;
    timestamps?: Array<{ start: string; end: string; text: string }>;
}

export async function askAgent(query: string, conversationId?: string): Promise<AgentResponse | null> {
    try {
        const payload: any = {
            input: query,
            agent_id: AGENT_ID
        };

        if (conversationId) {
            payload.conversation_id = conversationId;
        }

        const response = await fetch(`${KIBANA_URL}/api/agent_builder/converse`, {
            method: 'POST',
            headers: {
                'Authorization': `ApiKey ${API_KEY}`,
                'kbn-xsrf': 'true',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Agent API Error:', response.status, errorText);
            throw new Error(`Agent API failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        // Map Kibana Agent response to AgentResponse
        const reply = data.response?.message || (data.messages && data.messages.length > 0 ? data.messages[data.messages.length - 1].content : 'No reply text found.');

        // Extract timestamps if present in the response
        const timestamps = data.response?.timestamps || data.timestamps || [];

        return {
            reply: reply,
            conversation_id: data.conversation_id || '',
            timestamps: timestamps.length > 0 ? timestamps : undefined
        };
    } catch (error: any) {
        console.error('Agent Request Failed:', error);
        return {
            reply: `Debug Error: ${error.message}`,
            conversation_id: ''
        };
    }
}
