// Test script to verify video clipping works
// Run with: node scripts/test-clip.js

const testClip = async () => {
    try {
        const response = await fetch('http://localhost:3000/api/clip-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                videoUrl: 'https://www.youtube.com/watch?v=hMtUIctc6Rw',
                startTime: '00:00:48',
                endTime: '00:00:53'
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ Video clip created successfully!');
            console.log('Clip URL:', data.clipUrl);
            console.log('Duration:', data.duration, 'seconds');

            // Step 2: Verify the clip can be served
            const serveResponse = await fetch(`http://localhost:3000${data.clipUrl}`);
            if (serveResponse.ok) {
                console.log('✅ Video clip served successfully!');
            } else {
                console.error('❌ Failed to serve clip:', serveResponse.status);
            }
        } else {
            console.error('❌ Failed to create clip:', data.error);
        }
    } catch (error) {
        console.error('❌ Request failed:', error.message);
    }
};

testClip();
