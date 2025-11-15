// Quick test script to verify YouTube API key works
// Run: node test-youtube-api.js

import dotenv from 'dotenv';
dotenv.config();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!YOUTUBE_API_KEY) {
	console.error('❌ YOUTUBE_API_KEY not found in .env file');
	process.exit(1);
}

console.log(`🔑 Testing YouTube API key: ${YOUTUBE_API_KEY.substring(0, 10)}...`);

const testQuery = 'diabetes medical education';
const params = new URLSearchParams({
	part: 'snippet',
	q: testQuery,
	type: 'video',
	maxResults: '5',
	key: YOUTUBE_API_KEY
});

try {
	const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
	
	if (!response.ok) {
		const errorData = await response.json();
		console.error(`❌ YouTube API Error (${response.status}):`);
		console.error(JSON.stringify(errorData, null, 2));
		
		if (response.status === 403) {
			console.error('\n💡 This usually means:');
			console.error('1. YouTube Data API v3 is not enabled');
			console.error('2. API key restrictions are blocking requests');
			console.error('3. Quota exceeded');
			console.error('\nFix: Go to https://console.cloud.google.com/ and enable YouTube Data API v3');
		}
		process.exit(1);
	}
	
	const data = await response.json();
	const items = data.items || [];
	
	console.log(`✅ Success! Found ${items.length} videos`);
	console.log('\nSample videos:');
	items.slice(0, 3).forEach((item, i) => {
		console.log(`  ${i + 1}. ${item.snippet.title}`);
		console.log(`     Channel: ${item.snippet.channelTitle}`);
		console.log(`     URL: https://www.youtube.com/watch?v=${item.id.videoId}`);
	});
	
	console.log('\n✅ YouTube API is working correctly!');
} catch (err) {
	console.error('❌ Error:', err.message);
	process.exit(1);
}

