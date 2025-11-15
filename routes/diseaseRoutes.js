import { Router } from 'express';
import { body } from 'express-validator';
import { addBookmark, getDisease, getDiseaseLocalized, getHistory } from '../controllers/diseaseController.js';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { handleValidation } from '../middlewares/validators.js';
import Disease from '../models/Disease.js';
import { fetchVideoResources } from '../controllers/aiController.js';

const router = Router();

router.get('/:id/localized', requireAuth(), getDiseaseLocalized);
router.get('/:id', requireAuth(), getDisease);
router.get('/', requireAuth(), getHistory);
router.post('/:id/refresh-videos', requireAuth(), async (req, res) => {
	try {
		const { id } = req.params;
		const disease = await Disease.findById(id);
		if (!disease) return res.status(404).json({ message: 'Not found' });
		
		console.log(`\n${'='.repeat(60)}`);
		console.log(`🔄 FORCE REFRESH: Starting for "${disease.name}"`);
		console.log(`${'='.repeat(60)}`);
		
		// Clear existing videos for English
		const others = (disease.videoResources || []).filter((it) => it.language !== 'en');
		disease.videoResources = others;
		await disease.save();
		console.log(`   🗑️  Cleared existing English videos`);
		
		// Force fetch new videos directly
		console.log(`   🔍 Fetching videos using Gemini + YouTube...`);
		const videos = await fetchVideoResources(disease.name, 'en');
		
		console.log(`   📊 Fetch returned: ${videos ? videos.length : 0} videos`);
		
		if (!videos || !Array.isArray(videos)) {
			console.error(`   ❌ Videos is not an array:`, typeof videos);
			return res.json({ 
				message: 'Video fetch returned invalid data', 
				count: 0, 
				videos: [],
				error: 'Videos is not an array'
			});
		}
		
		// Validate videos before saving
		const validatedVideos = videos.filter(v => {
			if (!v || typeof v !== 'object') {
				console.warn(`   ⚠️  Skipping invalid video (not object):`, v);
				return false;
			}
			const hasTitle = v.title && typeof v.title === 'string' && v.title.trim().length >= 2;
			const hasUrl = v.url && typeof v.url === 'string' && (v.url.includes('youtube.com') || v.url.includes('youtu.be'));
			
			if (!hasTitle || !hasUrl) {
				console.warn(`   ⚠️  Skipping invalid video:`, {
					hasTitle,
					hasUrl,
					title: v.title,
					url: v.url
				});
				return false;
			}
			return true;
		});
		
		console.log(`   ✅ Validated ${validatedVideos.length} videos (from ${videos.length} total)`);
		
		if (validatedVideos.length > 0) {
			// Ensure all required fields are set
			const finalVideos = validatedVideos.map(v => ({
				title: String(v.title || '').trim(),
				url: String(v.url || '').trim(),
				channel: String(v.channel || 'Unknown').trim(),
				duration: String(v.duration || '').trim(),
				reason: String(v.reason || `Educational video about ${disease.name}`).trim(),
				publishedDate: String(v.publishedDate || '').trim(),
				viewCount: v.viewCount || null,
				language: String(v.language || 'en').trim(),
				refreshedAt: new Date()
			}));
			
			disease.videoResources = [...others, ...finalVideos];
			await disease.save();
			
			console.log(`   ✅ Saved ${finalVideos.length} videos to database`);
			finalVideos.slice(0, 3).forEach((v, i) => {
				console.log(`      ${i + 1}. "${v.title}" - ${v.url}`);
			});
			console.log(`${'='.repeat(60)}\n`);
			
			res.json({ 
				message: 'Videos refreshed successfully', 
				count: finalVideos.length, 
				videos: finalVideos 
			});
		} else {
			console.warn(`   ⚠️  No valid videos after validation`);
			console.log(`${'='.repeat(60)}\n`);
			res.json({ 
				message: 'No valid videos found after validation', 
				count: 0, 
				videos: [],
				debug: {
					rawVideosCount: videos.length,
					validatedCount: validatedVideos.length
				}
			});
		}
	} catch (err) {
		console.error(`\n❌ REFRESH ERROR:`, err.message);
		console.error(`   Stack:`, err.stack?.split('\n').slice(0, 5).join('\n'));
		console.log(`${'='.repeat(60)}\n`);
		res.status(500).json({ 
			message: 'Failed to refresh videos', 
			error: err.message,
			stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
		});
	}
});
router.post(
	'/bookmark',
	requireAuth(),
	[body('diseaseId').isString(), body('title').optional().isString()],
	handleValidation,
	addBookmark
);

export default router;


