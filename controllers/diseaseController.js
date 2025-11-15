import Disease from '../models/Disease.js';
import User from '../models/User.js';
import History from '../models/History.js';
import { translateSummary } from '../services/translation.js';
import { fetchVideoResources } from './aiController.js';
import { fetchSpecialists } from '../services/specialistFinder.js';

const VIDEO_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days
const SPECIALIST_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function isFresh(resource) {
	if (!resource?.refreshedAt) return false;
	const refreshed = new Date(resource.refreshedAt).getTime();
	return Date.now() - refreshed < VIDEO_REFRESH_INTERVAL_MS;
}

function isSpecialistFresh(provider) {
	if (!provider?.refreshedAt) return false;
	const refreshed = new Date(provider.refreshedAt).getTime();
	return Date.now() - refreshed < SPECIALIST_REFRESH_INTERVAL_MS;
}

async function ensureVideoResources(diseaseDoc, language) {
	console.log(`🎥 Ensuring video resources for "${diseaseDoc.name}" in ${language}`);
	const existing = (diseaseDoc.videoResources || []).filter((it) => it.language === language);
	
	// Check if existing videos are valid (have title and URL)
	const validExisting = existing.filter(v => 
		v.title && 
		v.title.trim() !== '' && 
		v.title !== 'Untitled Video' && 
		v.url && 
		v.url.includes('youtube.com')
	);
	
	console.log(`  📊 Existing videos: ${existing.length} total, ${validExisting.length} valid`);
	
		// Always fetch videos if none exist, too few, or existing ones are invalid
		if (!validExisting || validExisting.length < 2) {
			console.log(`  🔄 No valid videos (${validExisting.length} valid out of ${existing.length} total), fetching new ones...`);
		} else {
			const fresh = validExisting.filter(isFresh);
			
			if (fresh.length > 0) {
				console.log(`  ✅ Using ${fresh.length} cached videos`);
				return fresh;
			}
		}

	// Fetch new videos if none exist or they're stale
	console.log(`  🔄 Fetching new videos...`);
	console.log(`  📋 Disease name: "${diseaseDoc.name}"`);
	console.log(`  🌐 Language: ${language}`);
	
	try {
		const fetched = await fetchVideoResources(diseaseDoc.name, language);
		console.log(`  📊 Fetch result: ${fetched ? fetched.length : 0} videos`);
		
		if (!fetched || !fetched.length) {
			console.warn(`  ⚠️  No videos fetched on first attempt`);
			console.warn(`  🔄 Retrying with simplified query...`);
			
			// Retry with simplified disease name (remove special characters)
			const simplifiedName = diseaseDoc.name.replace(/[^\w\s]/g, '').trim();
			if (simplifiedName !== diseaseDoc.name) {
				console.log(`  🔄 Trying simplified name: "${simplifiedName}"`);
				const retryFetched = await fetchVideoResources(simplifiedName, language);
				if (retryFetched && retryFetched.length > 0) {
					const validatedRetry = retryFetched.filter(v => {
						if (!v || typeof v !== 'object') return false;
						return v.title && typeof v.title === 'string' && v.title.trim().length >= 2 &&
						       v.url && typeof v.url === 'string' && (v.url.includes('youtube.com') || v.url.includes('youtu.be'));
					});
					if (validatedRetry.length > 0) {
						const others = (diseaseDoc.videoResources || []).filter((it) => it.language !== language);
						diseaseDoc.videoResources = [...others, ...validatedRetry];
						await diseaseDoc.save();
						console.log(`  ✅ Fetched and saved ${validatedRetry.length} validated videos (with simplified name)`);
						return validatedRetry;
					}
				}
			}
			
			// Final retry after delay
			await new Promise(resolve => setTimeout(resolve, 2000));
			const finalRetry = await fetchVideoResources(diseaseDoc.name, language);
			if (finalRetry && finalRetry.length > 0) {
				const validatedFinal = finalRetry.filter(v => {
					if (!v || typeof v !== 'object') return false;
					return v.title && typeof v.title === 'string' && v.title.trim().length >= 2 &&
					       v.url && typeof v.url === 'string' && (v.url.includes('youtube.com') || v.url.includes('youtu.be'));
				});
				if (validatedFinal.length > 0) {
					const others = (diseaseDoc.videoResources || []).filter((it) => it.language !== language);
					diseaseDoc.videoResources = [...others, ...validatedFinal];
					await diseaseDoc.save();
					console.log(`  ✅ Fetched and saved ${validatedFinal.length} validated videos (after final retry)`);
					return validatedFinal;
				}
			}
			
			console.warn(`  ⚠️  Still no videos after all retries`);
			console.warn(`  📝 Returning ${validExisting.length} valid existing videos (if any)`);
			return validExisting;
		}

		// Validate fetched videos before saving
		const validatedFetched = fetched.filter(v => {
			if (!v || typeof v !== 'object') return false;
			const hasTitle = v.title && typeof v.title === 'string' && v.title.trim().length >= 2;
			const hasUrl = v.url && typeof v.url === 'string' && (v.url.includes('youtube.com') || v.url.includes('youtu.be'));
			if (!hasTitle || !hasUrl) {
				console.warn(`  ⚠️  Skipping invalid video before save:`, {
					hasTitle,
					hasUrl,
					title: v.title,
					url: v.url
				});
				return false;
			}
			return true;
		});
		
		if (validatedFetched.length === 0) {
			console.warn(`  ⚠️  No valid videos to save after validation`);
			return validExisting;
		}
		
		const others = (diseaseDoc.videoResources || []).filter((it) => it.language !== language);
		diseaseDoc.videoResources = [...others, ...validatedFetched];
		await diseaseDoc.save();
		console.log(`  ✅ Fetched and saved ${validatedFetched.length} validated videos`);
		validatedFetched.slice(0, 3).forEach((v, i) => {
			console.log(`     ${i + 1}. "${v.title}" - ${v.url}`);
		});
		return validatedFetched;
	} catch (err) {
		console.error(`  ❌ Video fetch failed:`, err.message);
		console.error(`  📋 Error type: ${err.constructor.name}`);
		if (err.stack) {
			console.error(`  📚 Stack trace:`, err.stack.split('\n').slice(0, 5).join('\n'));
		}
		// Return valid existing videos if any, otherwise empty array
		const fallback = validExisting.length > 0 ? validExisting : [];
		console.log(`  🔄 Returning ${fallback.length} valid videos as fallback`);
		return fallback;
	}
}

async function ensureSpecialists(diseaseDoc) {
	const existing = diseaseDoc.specialistProviders || [];
	const fresh = existing.filter(isSpecialistFresh);
	if (fresh.length) return fresh;

	const fetched = await fetchSpecialists(diseaseDoc.name);
	if (!fetched.length) return existing;

	const enriched = fetched.map((item) => ({
		...item,
		refreshedAt: new Date()
	}));
	diseaseDoc.specialistProviders = enriched;
	await diseaseDoc.save();
	return enriched;
}

export async function getDisease(req, res) {
	try {
		const { id } = req.params;
		const disease = await Disease.findById(id);
		if (!disease) return res.status(404).json({ message: 'Not found' });
		
		// Always fetch videos and specialists with error handling
		const [videoResources, specialistProviders] = await Promise.allSettled([
			ensureVideoResources(disease, 'en').catch(err => {
				console.warn('Video fetch failed in getDisease:', err.message);
				return [];
			}),
			ensureSpecialists(disease).catch(err => {
				console.warn('Specialist fetch failed in getDisease:', err.message);
				return [];
			})
		]);
		
		const payload = disease.toObject();
		
		// Ensure globalStatistics and patientImpactFacts are properly included
		// Convert Mongoose document to plain object if needed
		if (disease.globalStatistics) {
			payload.globalStatistics = disease.globalStatistics.toObject ? disease.globalStatistics.toObject() : disease.globalStatistics;
		}
		if (disease.patientImpactFacts) {
			payload.patientImpactFacts = disease.patientImpactFacts.toObject ? disease.patientImpactFacts.toObject() : disease.patientImpactFacts;
		}
		
		// Log global statistics and patient impact facts
		console.log(`📊 Disease "${disease.name}" data check:`, {
			hasGlobalStats: !!payload.globalStatistics,
			hasPatientImpact: !!payload.patientImpactFacts,
			globalStatsFields: payload.globalStatistics ? Object.keys(payload.globalStatistics).filter(k => payload.globalStatistics[k] && k !== 'lastUpdated') : [],
			patientImpactCategories: payload.patientImpactFacts ? Object.keys(payload.patientImpactFacts).filter(k => Array.isArray(payload.patientImpactFacts[k]) && payload.patientImpactFacts[k].length > 0) : [],
			globalStatsSample: payload.globalStatistics ? {
				prevalence: payload.globalStatistics.globalPrevalence?.substring(0, 50),
				incidence: payload.globalStatistics.incidenceRate?.substring(0, 50)
			} : null
		});
		
		// Always include videoResources (even if empty array)
		const videos = videoResources.status === 'fulfilled' ? (videoResources.value || []) : [];
		
		// Ensure videos have all required fields before sending
		const validatedVideos = videos.map((video, index) => {
			if (!video || typeof video !== 'object') {
				console.warn(`⚠️  Video ${index + 1} is not an object:`, video);
				return null;
			}
			
			// Ensure all required fields exist
			const validated = {
				title: String(video.title || '').trim(),
				url: String(video.url || '').trim(),
				channel: String(video.channel || 'Unknown').trim(),
				duration: String(video.duration || '').trim(),
				reason: String(video.reason || '').trim(),
				publishedDate: String(video.publishedDate || '').trim(),
				viewCount: video.viewCount || null,
				language: String(video.language || 'en').trim(),
				refreshedAt: video.refreshedAt || new Date()
			};
			
			// Final validation
			if (!validated.title || validated.title.length < 2) {
				console.warn(`⚠️  Video ${index + 1} has invalid title: "${validated.title}"`);
				return null;
			}
			if (!validated.url || (!validated.url.includes('youtube.com') && !validated.url.includes('youtu.be'))) {
				console.warn(`⚠️  Video ${index + 1} has invalid URL: "${validated.url}"`);
				return null;
			}
			
			return validated;
		}).filter(v => v !== null);
		
		payload.videoResources = validatedVideos;
		payload.specialistProviders = specialistProviders.status === 'fulfilled' ? (specialistProviders.value || []) : [];
		
		console.log(`✅ Returning disease "${disease.name}" with ${validatedVideos.length} validated videos`);
		if (validatedVideos.length > 0) {
			validatedVideos.slice(0, 3).forEach((v, i) => {
				console.log(`   Video ${i + 1}: "${v.title}" - ${v.url}`);
			});
		} else {
			console.warn(`   ⚠️  No valid videos found for disease "${disease.name}"`);
			if (videos.length > 0) {
				console.warn(`   📋 Raw videos received: ${videos.length}, but all failed validation`);
				videos.slice(0, 2).forEach((v, i) => {
					console.warn(`      Raw video ${i + 1}:`, {
						hasTitle: !!v?.title,
						hasUrl: !!v?.url,
						title: v?.title,
						url: v?.url
					});
				});
			}
		}
		
		res.json(payload);
	} catch (err) {
		console.error('getDisease error:', err.message, err.stack);
		res.status(500).json({ 
			message: 'Failed to fetch disease',
			error: process.env.NODE_ENV === 'development' ? err.message : undefined
		});
	}
}

export async function getHistory(req, res) {
	try {
		const items = await History.find({ userId: req.user.id })
			.sort({ createdAt: -1 })
			.limit(50)
			.lean();
		res.json(items);
	} catch {
		res.status(500).json({ message: 'Failed to fetch history' });
	}
}

export async function getDiseaseLocalized(req, res) {
	try {
		const { id } = req.params;
		const language = (req.query.lang || 'en').toLowerCase();
		const disease = await Disease.findById(id);
		if (!disease) return res.status(404).json({ message: 'Not found' });

		if (language === 'en') {
			try {
				const [videoResources, specialistProviders] = await Promise.all([
					ensureVideoResources(disease, 'en'),
					ensureSpecialists(disease)
				]);
				return res.json({
					language: 'en',
					summary: disease.aiSummary,
					videoResources: videoResources || [],
					narration: '',
					specialistProviders: specialistProviders || []
				});
			} catch (err) {
				console.error('Error fetching English resources:', err.message);
				return res.json({
					language: 'en',
					summary: disease.aiSummary,
					videoResources: [],
					narration: '',
					specialistProviders: []
				});
			}
		}

		try {
			const { translateSummary, translateGlobalStatsAndImpact } = await import('../services/translation.js');
			
			const [videoResources, translation, statsTranslation, specialistProviders] = await Promise.all([
				ensureVideoResources(disease, language).catch(err => {
					console.warn('Video fetch failed:', err.message);
					return [];
				}),
				translateSummary(disease.aiSummary, language).catch(err => {
					console.warn('Translation failed:', err.message);
					return { summary: disease.aiSummary, narration: '' };
				}),
				translateGlobalStatsAndImpact(disease.globalStatistics, disease.patientImpactFacts, language).catch(err => {
					console.warn('Global stats translation failed:', err.message);
					return { 
						globalStatistics: disease.globalStatistics || {}, 
						patientImpactFacts: disease.patientImpactFacts || {} 
					};
				}),
				ensureSpecialists(disease).catch(err => {
					console.warn('Specialist fetch failed:', err.message);
					return [];
				})
			]);

			res.json({
				language,
				summary: translation.summary || disease.aiSummary,
				videoResources: videoResources || [],
				narration: translation.narration || '',
				specialistProviders: specialistProviders || [],
				globalStatistics: statsTranslation.globalStatistics || disease.globalStatistics || {},
				patientImpactFacts: statsTranslation.patientImpactFacts || disease.patientImpactFacts || {}
			});
		} catch (err) {
			console.error('Localization error:', err.message, err.stack);
			// Return English version as fallback
			res.json({
				language: 'en',
				summary: disease.aiSummary,
				videoResources: [],
				narration: '',
				specialistProviders: []
			});
		}
	} catch (err) {
		console.error('getDiseaseLocalized error:', err.message, err.stack);
		res.status(500).json({ 
			message: 'Failed to localize disease data',
			error: process.env.NODE_ENV === 'development' ? err.message : undefined
		});
	}
}

export async function addBookmark(req, res) {
	try {
		const { diseaseId, title } = req.body;
		await User.updateOne(
			{ _id: req.user.id, 'bookmarks.diseaseId': { $ne: diseaseId } },
			{ $push: { bookmarks: { diseaseId, title } } }
		);
		const user = await User.findById(req.user.id).lean();
		res.json({ bookmarks: user.bookmarks || [] });
	} catch {
		res.status(500).json({ message: 'Failed to bookmark' });
	}
}


