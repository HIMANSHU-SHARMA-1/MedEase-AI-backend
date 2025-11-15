// YouTube Data API v3 Integration
// Reliable fallback for video recommendations using YouTube's search API

const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3/search';

/**
 * Search YouTube for medical education videos about a disease
 * @param {string} diseaseName - Name of the disease
 * @param {string} language - Language code (en, hi)
 * @returns {Promise<Array>} Array of video objects
 */
export async function searchYouTubeVideos(diseaseName, language = 'en') {
	// Check API key from environment at runtime
	const apiKey = process.env.YOUTUBE_API_KEY;
	
	if (!apiKey || apiKey.trim() === '') {
		console.warn('⚠️  YouTube API key not configured, skipping YouTube search');
		console.warn('   Set YOUTUBE_API_KEY in server/.env file');
		return [];
	}

	console.log(`🔑 Using YouTube API key: ${apiKey.substring(0, 10)}...`);

	const languageName = language === 'hi' ? 'Hindi' : 'English';
	
	// Build search query - focus on the disease name with medical education terms
	const query = `${diseaseName} medical education ${languageName}`;
	
	// Priority channels for medical content
	const preferredChannels = [
		'Mayo Clinic',
		'Cleveland Clinic',
		'Johns Hopkins Medicine',
		'Osmosis',
		'Khan Academy Medicine',
		'WHO',
		'CDC',
		'NHS',
		'Armando Hasudungan'
	];

	try {
		console.log(`🔍 Searching YouTube for: "${query}"`);
		
		// Search parameters - removed videoCategoryId as it might cause issues
		const params = new URLSearchParams({
			part: 'snippet',
			q: query,
			type: 'video',
			maxResults: '10',
			order: 'relevance',
			relevanceLanguage: language === 'hi' ? 'hi' : 'en',
			key: apiKey
		});

		const url = `${YOUTUBE_API_URL}?${params.toString()}`;
		console.log(`📡 YouTube API URL: ${YOUTUBE_API_URL} (query length: ${query.length})`);

		const response = await fetch(url);
		
		if (!response.ok) {
			const errorText = await response.text();
			let errorData;
			try {
				errorData = JSON.parse(errorText);
			} catch {
				errorData = { error: { message: errorText } };
			}
			
			const errorMsg = errorData.error?.message || response.statusText;
			console.error(`❌ YouTube API error (${response.status}):`, errorMsg);
			
			// Provide helpful error messages
			if (response.status === 403) {
				console.error('   💡 This usually means:');
				console.error('   1. YouTube Data API v3 is not enabled in Google Cloud Console');
				console.error('   2. API key restrictions are blocking the request');
				console.error('   3. API key quota exceeded');
			} else if (response.status === 400) {
				console.error('   💡 This usually means invalid API key or request format');
			}
			
			throw new Error(`YouTube API error (${response.status}): ${errorMsg}`);
		}

		const data = await response.json();
		const items = data.items || [];

		if (items.length === 0) {
			console.warn(`⚠️  No YouTube videos found for: "${query}"`);
			console.warn('   Try a different search term or check if videos exist on YouTube');
			return [];
		}

		console.log(`✅ Found ${items.length} YouTube videos`);

		// Process and prioritize videos
		const videos = items
			.map((item, index) => {
				if (!item.id || !item.id.videoId) {
					console.warn(`⚠️  Item ${index} missing videoId:`, JSON.stringify(item).substring(0, 100));
					return null;
				}
				
				const snippet = item.snippet || {};
				const videoId = item.id.videoId;
				const title = snippet.title || '';
				const channelTitle = snippet.channelTitle || '';
				
				// Validate required fields
				if (!videoId || !title) {
					console.warn(`⚠️  Item ${index} missing required fields - videoId: ${videoId}, title: ${title}`);
					return null;
				}
				
				// Check if from preferred channel
				const isPreferred = preferredChannels.some(channel => 
					channelTitle.toLowerCase().includes(channel.toLowerCase())
				);

				const video = {
					title: title.trim(),
					url: `https://www.youtube.com/watch?v=${videoId}`,
					channel: channelTitle || 'Unknown Channel',
					duration: '', // YouTube API doesn't provide duration in search results
					reason: `Educational video about ${diseaseName}${channelTitle ? ` from ${channelTitle}` : ''}`,
					publishedDate: snippet.publishedAt ? new Date(snippet.publishedAt).toISOString().split('T')[0] : '',
					viewCount: null, // Not available in search results
					language: language,
					isPreferred: isPreferred,
					description: snippet.description || ''
				};
				
				// Validate the video object
				if (!video.title || !video.url || !video.url.includes('youtube.com')) {
					console.warn(`⚠️  Invalid video object:`, video);
					return null;
				}
				
				return video;
			})
			.filter(video => video !== null) // Remove null entries
			// Sort: preferred channels first, then by relevance
			.sort((a, b) => {
				if (a.isPreferred && !b.isPreferred) return -1;
				if (!a.isPreferred && b.isPreferred) return 1;
				return 0;
			})
			// Take top 5
			.slice(0, 5)
			.map(({ isPreferred, description, ...video }) => {
				// Ensure all required fields are strings
				return {
					title: String(video.title || '').trim(),
					url: String(video.url || '').trim(),
					channel: String(video.channel || 'Unknown').trim(),
					duration: String(video.duration || '').trim(),
					reason: String(video.reason || '').trim(),
					publishedDate: String(video.publishedDate || '').trim(),
					viewCount: video.viewCount,
					language: String(video.language || language).trim()
				};
			});

		console.log(`✅ Processed ${videos.length} YouTube videos`);
		if (videos.length > 0) {
			videos.forEach((v, i) => {
				console.log(`   ${i + 1}. "${v.title}" - ${v.channel}`);
				console.log(`      URL: ${v.url}`);
			});
		} else {
			console.warn('⚠️  No valid videos after processing!');
		}
		return videos;

	} catch (err) {
		console.error('❌ YouTube search error:', err.message);
		if (err.stack) {
			console.error('Stack:', err.stack);
		}
		return [];
	}
}

/**
 * Get video details including duration and view count
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<Object>} Video details
 */
export async function getYouTubeVideoDetails(videoId) {
	if (!YOUTUBE_API_KEY) return null;

	try {
		const params = new URLSearchParams({
			part: 'contentDetails,statistics',
			id: videoId,
			key: YOUTUBE_API_KEY
		});

		const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`);
		
		if (!response.ok) return null;

		const data = await response.json();
		const item = data.items?.[0];
		
		if (!item) return null;

		// Parse duration (ISO 8601 format: PT1H2M10S)
		const duration = parseDuration(item.contentDetails?.duration || '');
		const viewCount = parseInt(item.statistics?.viewCount || '0', 10);

		return { duration, viewCount };
	} catch (err) {
		console.warn('Failed to get video details:', err.message);
		return null;
	}
}

/**
 * Parse ISO 8601 duration to MM:SS or HH:MM:SS format
 */
function parseDuration(isoDuration) {
	if (!isoDuration) return '';
	
	const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
	if (!match) return '';

	const hours = parseInt(match[1] || '0', 10);
	const minutes = parseInt(match[2] || '0', 10);
	const seconds = parseInt(match[3] || '0', 10);

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

