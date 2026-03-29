'use server';

import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function generateSocialMetadata(segmentText: string) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set');
    }

    try {
        const prompt = `
        Analyze the following video segment transcript and generate professional social media metadata for a viral short-form video (TikTok/Reels/Shorts).
        
        Transcript: "${segmentText}"
        
        Provide the response in the following JSON format:
        {
          "title": "A catchy, click-worthy title",
          "description": "An engaging description with relevant hashtags",
          "tags": ["tag1", "tag2", "tag3"],
          "hook": "The opening line to grab attention",
          "platform_advice": "Specific advice for this type of content"
        }
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are an expert social media manager and content strategist." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error('No content returned from OpenAI');

        return JSON.parse(content);
    } catch (error) {
        console.error('Social metadata generation error:', error);
        throw error;
    }
}
