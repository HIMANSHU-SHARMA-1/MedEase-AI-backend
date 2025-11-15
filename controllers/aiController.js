import { generateAIResponse } from '../config/aiProvider.js';
import { getConsensusResponse, getQuickResponse } from '../services/consensusAI.js';
import Disease from '../models/Disease.js';
import History from '../models/History.js';
import { enrichMedications } from '../services/drugInfo.js';
import { fetchSpecialists } from '../services/specialistFinder.js';

const DISCLAIMER =
	'This information is for educational purposes only and not a substitute for professional medical advice.';

const LANGUAGE_NAMES = {
	en: 'English',
	hi: 'Hindi'
};

function languageCodeToName(code) {
	return LANGUAGE_NAMES[code] || code;
}

function buildInterpretPrompt(parsedText) {
	return `You are an expert medical report interpreter with access to evidence-based medical literature. Analyze the lab report with scientific rigor and provide fact-based, clinically relevant insights.

CRITICAL REQUIREMENTS:
1. Base all interpretations on established medical reference ranges (WHO, CDC, NIH, clinical guidelines)
2. Cite specific lab values with their clinical significance
3. Provide evidence-based explanations, not speculation
4. Include statistical prevalence data when relevant (e.g., "affects ~X% of population")
5. Reference peer-reviewed sources or clinical guidelines when possible
6. Distinguish between correlation and causation
7. Include differential diagnosis considerations when appropriate

ANALYZE AND PROVIDE:
• Key abnormal lab values: For each abnormal value, include:
  - Exact numeric value vs. reference range (MUST include reference_range in format "min-max", e.g., "10-20" or "12.5 - 15.3")
  - Clinical significance (what this indicates physiologically)
  - Potential causes (prioritize most common first)
  - Urgency level (immediate attention needed vs. routine follow-up)
  - CRITICAL: Always provide reference_range for comparison (use standard medical reference ranges from WHO, CDC, or clinical guidelines)
  
• Probable disease/condition: 
  - Primary diagnosis with confidence level (high/moderate/low)
  - Alternative diagnoses to consider
  - ICD-10 code if applicable
  
• Severity assessment: Use objective criteria (mild/moderate/severe/critical) based on:
  - Lab value deviation from normal
  - Clinical presentation indicators
  - Risk of complications
  
• Cause: Evidence-based explanation including:
  - Pathophysiology (how the disease develops)
  - Risk factors (modifiable and non-modifiable)
  - Epidemiology (who is most affected)
  - Genetic factors if relevant
  
• Symptoms: 
  - Primary symptoms with frequency (% of cases)
  - Early warning signs
  - Progression timeline
  - Red flag symptoms requiring immediate care
  
• Treatments: Evidence-based interventions:
  - First-line treatments (with success rates if known)
  - Alternative therapies
  - Lifestyle modifications with expected outcomes
  - Treatment duration and monitoring requirements
  
• Medications: Generic names with:
  - Mechanism of action (how it works in the body)
  - Typical dosage ranges
  - Expected time to see effects
  - Common side effects (with frequency)
  
• Prevention: Evidence-based strategies:
  - Primary prevention (before disease develops)
  - Secondary prevention (early detection)
  - Effectiveness data when available
  
• Emergency home remedy: Only include if:
  - Supported by medical literature
  - Low risk of harm
  - Clearly state it's temporary until professional care
  - Include contraindications
  
• Video resources: Three high-quality educational videos from:
  - Medical institutions (Mayo Clinic, Cleveland Clinic, Johns Hopkins)
  - Medical education platforms (Osmosis, Armando Hasudungan, Khan Academy Medicine)
  - Public health organizations (WHO, CDC, NHS)
  - Include: title, channel, URL, why it's valuable, duration, and learning objectives

OUTPUT FORMAT: Strict JSON with these EXACT keys and types:
- probable_disease: STRING (just the disease name, e.g., "Anemia", NOT an object)
- abnormal_values: ARRAY of objects with { test, value, unit, reference_range (e.g., "10-20" or "12.5 - 15.3"), interpretation, flag, severity }
- cause: STRING (plain text explanation, NOT an object)
- symptoms: ARRAY of STRINGS (e.g., ["Fatigue", "Weakness"], NOT array of objects)
- treatments: ARRAY of STRINGS (e.g., ["Iron supplements", "Blood transfusion"], NOT array of objects)
- medications: ARRAY of STRINGS (generic drug names only)
- prevention: ARRAY of STRINGS (e.g., ["Eat iron-rich foods", "Regular checkups"], NOT array of objects)
- severity: STRING (e.g., "mild", "moderate", "severe", NOT an object)
- typical_duration: STRING (e.g., "2-4 weeks", NOT an object)
- emergency_home_remedy: STRING or ARRAY of STRINGS
- video_resources: ARRAY of objects with { title, url, channel, duration, reason }

CRITICAL: All fields must be simple types (string, array of strings, or array of simple objects). Do NOT nest complex objects in cause, symptoms, treatments, prevention, or severity fields.

Be precise, factual, and cite evidence. Avoid vague statements. Use medical terminology appropriately but explain complex concepts.

Extracted text:
"""${parsedText}"""`;
}


function buildVideoPrompt(diseaseName, language = 'en') {
	const languageName = languageCodeToName(language);
	return `You are a medical content curator specializing in evidence-based medical education. Find the most current, authoritative educational videos about "${diseaseName}" in ${languageName}.

PRIORITY SOURCES (in order):
1. Medical institutions: Mayo Clinic, Cleveland Clinic, Johns Hopkins, Stanford Medicine, Harvard Medical School
2. Medical education platforms: Osmosis, Armando Hasudungan, Khan Academy Medicine, Lecturio
3. Public health organizations: WHO, CDC, NHS, NIH
4. Medical journals with video content: NEJM, The Lancet, BMJ
5. Regional medical universities/hospitals (for ${languageName} content)

VIDEO CRITERIA:
• Must be published within last 3 years (prefer latest)
• Audio and captions in ${languageName}
• Free to view, publicly accessible
• Evidence-based content (not promotional or opinion-based)
• Appropriate for patient education (clear, accurate, non-alarming)
• Include duration, view count (if available), and publication date

FOR EACH VIDEO PROVIDE:
- title: Exact video title
- url: Direct YouTube or platform URL (verify it's accessible)
- channel: Official channel name
- duration: Video length (e.g., "15:30")
- reason: Specific learning objectives this video covers (e.g., "Explains pathophysiology with animations", "Covers treatment protocols per latest guidelines")
- audio_url: Link to audio-only version or podcast if available
- language: "${language}"
- published_date: When available
- view_count: If available (indicates popularity/trust)

Return JSON with key "videos": array of 3 items. Prioritize the most recent, highest-quality content from authoritative sources.`;
}

function safeJsonParse(text) {
	try {
		return JSON.parse(text);
	} catch {
		// try to extract JSON substring
		const start = text.indexOf('{');
		const end = text.lastIndexOf('}');
		if (start !== -1 && end !== -1) {
			try {
				return JSON.parse(text.slice(start, end + 1));
			} catch {
				return null;
			}
		}
		return null;
	}
}

const FLAG_TERMS = [
	'critical high',
	'critical low',
	'very high',
	'very low',
	'high',
	'low',
	'elevated',
	'reduced',
	'above normal',
	'below normal',
	'above range',
	'below range'
];
const FLAG_REGEX = new RegExp(`\\b(${FLAG_TERMS.join('|')})\\b`, 'i');
const NORMAL_REGEX = /\b(wnl|within normal limits|normal|negative)\b/i;
const RANGE_REGEX = /(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to|TO)\s*(-?\d+(?:\.\d+)?)/i;
const UNIT_REGEX = /([a-zA-Z%\/]+(?:\^[\d]+)?)$/;
const NUMBER_REGEX = /-?\d+(?:\.\d+)?/g;

function normalizeFlagWord(word) {
	const lower = word.toLowerCase();
	if (lower.includes('critical') && lower.includes('high')) return 'Critical High';
	if (lower.includes('critical') && lower.includes('low')) return 'Critical Low';
	if (lower.includes('high') || lower.includes('above') || lower.includes('elevated')) return 'High';
	if (lower.includes('low') || lower.includes('below') || lower.includes('reduced')) return 'Low';
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function deriveSeverity(word) {
	const lower = word.toLowerCase();
	if (lower.includes('critical')) return 'critical';
	if (lower.includes('high') || lower.includes('above') || lower.includes('elevated')) return 'high';
	if (lower.includes('low') || lower.includes('below') || lower.includes('reduced')) return 'low';
	return '';
}

function parseAbnormalRow(row, fallbackTest) {
	const flagMatch = row.match(FLAG_REGEX);
	if (!flagMatch) return null;
	const flagWord = flagMatch[1];
	if (NORMAL_REGEX.test(flagWord)) return null;

	const normalizedFlag = normalizeFlagWord(flagWord);
	const severity = deriveSeverity(flagWord);

	let working = row.slice(0, flagMatch.index).trim();

	// Extract reference range - try multiple patterns
	let referenceRange = '';
	
	// Pattern 1: Standard range format "10-20" or "10 - 20"
	const rangeMatch = working.match(RANGE_REGEX);
	if (rangeMatch) {
		referenceRange = `${rangeMatch[1]} - ${rangeMatch[2]}`;
		working = (working.slice(0, rangeMatch.index) + working.slice(rangeMatch.index + rangeMatch[0].length)).trim();
	} else {
		// Pattern 2: Look for reference range in parentheses or brackets
		const parenMatch = working.match(/\(([^)]*reference[^)]*)\)/i) || working.match(/\[([^\]]*reference[^\]]*)\]/i);
		if (parenMatch) {
			const refText = parenMatch[1];
			const refRangeMatch = refText.match(RANGE_REGEX);
			if (refRangeMatch) {
				referenceRange = `${refRangeMatch[1]} - ${refRangeMatch[2]}`;
			}
		}
		
		// Pattern 3: Look for "ref:" or "reference:" followed by range
		const refLabelMatch = working.match(/(?:ref|reference):\s*([0-9.\s\-–—to]+)/i);
		if (refLabelMatch) {
			const refText = refLabelMatch[1];
			const refRangeMatch = refText.match(RANGE_REGEX);
			if (refRangeMatch) {
				referenceRange = `${refRangeMatch[1]} - ${refRangeMatch[2]}`;
			}
		}
	}

	// Extract numeric value
	let value = '';
	const values = working.match(NUMBER_REGEX);
	if (values && values.length) {
		value = values[values.length - 1];
		const idx = working.lastIndexOf(value);
		if (idx !== -1) {
			working = working.slice(0, idx).trim();
		}
	}

	// Extract unit (last token with letters or /)
	let unit = '';
	const unitMatch = working.match(UNIT_REGEX);
	if (unitMatch) {
		unit = unitMatch[1];
		working = working.slice(0, unitMatch.index).trim();
	}

	let testName = working || fallbackTest || '';
	testName = testName.replace(/\s{2,}/g, ' ').trim();
	if (!testName || !value) return null;

	return {
		test: testName,
		value,
		unit,
		referenceRange,
		flag: normalizedFlag,
		severity,
		interpretation: `${normalizedFlag} value${referenceRange ? ` (reference ${referenceRange})` : ''}`
	};
}

function extractAbnormalFromText(text) {
	console.log('📄 Extracting abnormal values from text (length:', text.length, 'chars)');
	
	// Clean and normalize text
	const cleanedLines = text
		.split(/\r?\n+/)
		.map((line) => {
			// Replace tabs with spaces, normalize whitespace
			line = line.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();
			// Fix common OCR errors (be careful not to break numbers)
			line = line.replace(/\|/g, '|'); // Keep pipes for table parsing
			return line;
		})
		.filter((line) => line && !/^[-=._]+$/.test(line) && line.length > 3);

	console.log('📊 Total lines after cleaning:', cleanedLines.length);

	// Strategy 1: Look for table-like structures (common in lab reports)
	const tableRows = [];
	const findings = [];
	
	// Pattern: Test Name | Value | Unit | Reference Range | Flag
	// Also handle: Test Name Value Unit (Reference Range) Flag
	for (let i = 0; i < cleanedLines.length; i++) {
		const line = cleanedLines[i];
		
		// Skip headers
		if (/^(test|parameter|name|value|result|unit|reference|normal|range|flag|status)/i.test(line) && 
		    !/\d/.test(line)) {
			continue;
		}
		
		// Look for lines with numbers (potential lab values)
		if (!/\d/.test(line)) continue;
		
		// Try to extract test data from this line
		const extracted = extractTestDataFromLine(line, cleanedLines[i + 1], cleanedLines[i - 1]);
		if (extracted && extracted.flag && !NORMAL_REGEX.test(extracted.flag)) {
			findings.push(extracted);
			console.log('✅ Extracted:', extracted.test, '=', extracted.value, 'Range:', extracted.referenceRange);
		}
	}

	// Strategy 2: Original buffer-based approach for multi-line entries
	const rows = [];
	let buffer = [];

	for (const line of cleanedLines) {
		// Ignore section headers like "BIOCHEMISTRY"
		if (!/\d/.test(line) && !buffer.length) {
			buffer.push(line);
			continue;
		}

		if (buffer.length) {
			buffer.push(line);
		} else {
			buffer = [line];
		}

		const joined = buffer.join(' ').trim();
		if (FLAG_REGEX.test(joined) || NORMAL_REGEX.test(joined) || joined.length > 180) {
			if (FLAG_REGEX.test(joined) && !NORMAL_REGEX.test(joined)) {
				rows.push(joined);
			}
			buffer = [];
		}
	}

	// Parse buffer-based rows
	let lastTest = '';
	for (const row of rows) {
		const parsed = parseAbnormalRow(row, lastTest);
		if (parsed) {
			// Check if we already have this test
			const existing = findings.find(f => 
				f.test.toLowerCase().trim() === parsed.test.toLowerCase().trim()
			);
			if (!existing) {
			findings.push(parsed);
				console.log('✅ Extracted (buffer):', parsed.test, '=', parsed.value, 'Range:', parsed.referenceRange);
			}
			lastTest = parsed.test;
		}
	}
	
	console.log('📋 Total findings extracted:', findings.length);
	return findings;
}

/**
 * Extract test data from a single line (handles table-like formats)
 */
function extractTestDataFromLine(line, nextLine = '', prevLine = '') {
	// Common patterns in lab reports:
	// 1. "Test Name    12.5    g/dL    (10-15)    H"
	// 2. "Test Name: 12.5 g/dL Reference: 10-15 Flag: H"
	// 3. "Test Name | 12.5 | g/dL | 10-15 | H"
	// 4. "Test Name 12.5 g/dL 10-15 H"
	
	// Check if line has a flag
	const flagMatch = line.match(FLAG_REGEX);
	if (!flagMatch) return null;
	
	const flagWord = flagMatch[1];
	if (NORMAL_REGEX.test(flagWord)) return null;
	
	// Split by common delimiters (pipes, multiple spaces, colons)
	const parts = line
		.split(/\s*\|\s*|\s{2,}|\s*:\s*/)
		.map(p => p.trim())
		.filter(p => p);
	
	let test = '';
	let value = '';
	let unit = '';
	let referenceRange = '';
	let flag = normalizeFlagWord(flagWord);
	
	// Try to identify parts
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		
		// Check if it's a numeric value
		if (/^-?\d+\.?\d*$/.test(part) && !value) {
			value = part;
			continue;
		}
		
		// Check if it's a reference range
		const rangeMatch = part.match(RANGE_REGEX);
		if (rangeMatch && !referenceRange) {
			referenceRange = `${rangeMatch[1]} - ${rangeMatch[2]}`;
			continue;
		}
		
		// Check if it's a unit (contains letters and maybe / or %)
		if (/^[a-zA-Z%\/]+$/.test(part) && !unit && value) {
			unit = part;
			continue;
		}
		
		// Check if it's a flag
		if (FLAG_REGEX.test(part) && part === flagWord) {
			// Already captured
			continue;
		}
		
		// Otherwise, it's likely part of the test name
		if (!value && !referenceRange) {
			test += (test ? ' ' : '') + part;
		}
	}
	
	// If we didn't get a reference range, look in parentheses or brackets
	if (!referenceRange) {
		const parenMatch = line.match(/[\(\[][^\)\]]*(\d+\.?\d*)\s*[-–—to]\s*(\d+\.?\d*)[^\)\]]*[\)\]]/i);
		if (parenMatch) {
			const rangeMatch = parenMatch[0].match(RANGE_REGEX);
			if (rangeMatch) {
				referenceRange = `${rangeMatch[1]} - ${rangeMatch[2]}`;
			}
		}
	}
	
	// If still no reference range, check next/previous lines
	if (!referenceRange) {
		const context = (prevLine + ' ' + nextLine).toLowerCase();
		const contextRangeMatch = context.match(/(?:ref|reference|normal|range)[:\s]*(\d+\.?\d*)\s*[-–—to]\s*(\d+\.?\d*)/i);
		if (contextRangeMatch) {
			referenceRange = `${contextRangeMatch[1]} - ${contextRangeMatch[2]}`;
		}
	}
	
	// Validate we have at least test name and value
	if (!test || !value) return null;
	
	return {
		test: test.trim(),
		value: value.trim(),
		unit: unit.trim() || '',
		referenceRange: referenceRange.trim() || '',
		flag: flag,
		severity: deriveSeverity(flagWord),
		interpretation: `${flag} value${referenceRange ? ` (reference ${referenceRange})` : ''}`
	};
}

export async function fetchVideoResources(diseaseName, language = 'en') {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`🎬 VIDEO RESOURCE FETCH: Starting for "${diseaseName}" (${language})`);
	console.log(`${'='.repeat(60)}`);
	
	try {
		// Step 1: Get captions/keywords from AI API
		console.log(`\n📝 STEP 1: Getting captions/keywords from AI API...`);
		let captions = await getDiseaseCaptionsFromAI(diseaseName, language);
		
		if (!captions || captions.length === 0) {
			console.warn(`   ⚠️  No captions generated, using disease name directly`);
			// Fallback: use disease name directly
			captions = [diseaseName];
		}
		
		console.log(`   ✅ Generated ${captions.length} search captions:`, captions);
		
		// Step 2: Search YouTube with each caption
		console.log(`\n🔍 STEP 2: Searching YouTube API with captions...`);
		const { searchYouTubeVideos } = await import('../services/youtubeSearch.js');
		
		const allVideos = [];
		const seenVideoIds = new Set();
		
		for (const caption of captions) {
			console.log(`   🔍 Searching: "${caption}"`);
			try {
				const videos = await searchYouTubeVideos(caption, language);
				
				if (videos && Array.isArray(videos) && videos.length > 0) {
					// Filter duplicates by video ID
					for (const video of videos) {
						if (video && video.url) {
							const videoId = extractVideoIdFromUrl(video.url);
							if (videoId && !seenVideoIds.has(videoId)) {
								seenVideoIds.add(videoId);
								allVideos.push(video);
							}
						}
					}
					console.log(`   ✅ Found ${videos.length} videos (${allVideos.length} unique total)`);
				}
				
				// Stop if we have enough videos
				if (allVideos.length >= 10) {
					console.log(`   ✅ Collected ${allVideos.length} videos, stopping search`);
					break;
				}
			} catch (err) {
				console.warn(`   ⚠️  Search failed for "${caption}":`, err.message);
			}
		}
		
		if (allVideos.length === 0) {
			console.warn(`   ⚠️  No videos found from any caption`);
			// Fallback: Fetch web-based resources instead
			console.log(`   🔄 Fetching web-based resources as fallback...`);
			return await fetchWebResources(diseaseName, language);
		}
		
		console.log(`\n📊 STEP 3: Processing ${allVideos.length} videos...`);
		
		// Step 3: Process and validate videos
		const processedVideos = allVideos
			.filter((item) => {
				if (!item || typeof item !== 'object') {
					return false;
				}
				const hasUrl = item?.url && typeof item.url === 'string' && item.url.trim().length > 0;
				const hasTitle = item?.title && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.trim() !== 'Untitled';
				const isYouTube = hasUrl && (item.url.includes('youtube.com') || item.url.includes('youtu.be'));
				return hasUrl && hasTitle && isYouTube;
			})
			.map((item) => ({
					title: String(item.title || '').trim(),
					url: String(item.url || '').trim(),
				channel: String(item.channel || item.channelTitle || 'Unknown').trim(),
					duration: String(item.duration || '').trim(),
				reason: String(item.reason || `Educational video about ${diseaseName}`).trim(),
				publishedDate: String(item.publishedDate || '').trim(),
				viewCount: item.viewCount || null,
					language: String(language).trim(),
				refreshedAt: new Date()
			}))
			.filter(v => v.title.length >= 2 && v.url.length > 0)
			.slice(0, 10); // Limit to top 10
		
		console.log(`   ✅ Processed ${processedVideos.length} valid videos`);
		if (processedVideos.length > 0) {
			processedVideos.slice(0, 3).forEach((v, i) => {
				console.log(`      ${i + 1}. "${v.title}" - ${v.channel}`);
			});
		}
		
		console.log(`${'='.repeat(60)}\n`);
		return processedVideos;
	} catch (err) {
		console.error(`\n❌ VIDEO FETCH FAILED:`, err.message);
		console.error(`   Stack:`, err.stack?.split('\n').slice(0, 3).join('\n'));
		console.log(`   🔄 Attempting to fetch web-based resources as fallback...`);
		try {
			return await fetchWebResources(diseaseName, language);
		} catch (webErr) {
			console.error(`   ❌ Web resources fetch also failed:`, webErr.message);
			console.log(`${'='.repeat(60)}\n`);
			return [];
		}
	}
}

/**
 * Fetch web-based resources (articles, medical websites) when videos are unavailable
 */
async function fetchWebResources(diseaseName, language = 'en') {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`🌐 WEB RESOURCE FETCH: Starting for "${diseaseName}" (${language})`);
	console.log(`${'='.repeat(60)}`);
	
	const languageName = language === 'hi' ? 'Hindi' : 'English';
	
	const prompt = `You are a medical content curator. For the disease/condition "${diseaseName}", find 5-8 high-quality web-based educational resources (articles, medical websites, patient guides) in ${languageName}.

PRIORITY SOURCES (in order):
1. Medical institutions: Mayo Clinic, Cleveland Clinic, Johns Hopkins, WebMD, Healthline, MedlinePlus
2. Government health organizations: WHO, CDC, NIH, NHS
3. Medical journals: NEJM, The Lancet, BMJ (patient education sections)
4. Patient advocacy organizations and support groups
5. Medical education platforms: UpToDate Patient Info, Merck Manuals

RESOURCE CRITERIA:
• Must be publicly accessible (free to view)
• Evidence-based content from authoritative sources
• Published within last 5 years (prefer latest)
• Appropriate for patient education
• Available in ${languageName} or English

FOR EACH RESOURCE PROVIDE:
- title: Exact article/page title
- url: Direct URL to the resource
- source: Organization/website name (e.g., "Mayo Clinic", "CDC")
- description: Brief summary of what the resource covers (1-2 sentences)
- type: Resource type (e.g., "Article", "Patient Guide", "Fact Sheet", "Medical Encyclopedia Entry")

Return ONLY valid JSON with this structure:
{
  "web_resources": [
    {
      "title": "Type 2 Diabetes - Symptoms and Causes",
      "url": "https://www.mayoclinic.org/diseases-conditions/type-2-diabetes/symptoms-causes/syc-20351193",
      "source": "Mayo Clinic",
      "description": "Comprehensive overview of symptoms, causes, and risk factors",
      "type": "Article"
    }
  ]
}

Return ONLY the JSON, no markdown code blocks, no explanations.`;

	try {
		console.log(`   🤖 Calling AI API to generate web resources...`);
		const { generateAIResponse } = await import('../config/aiProvider.js');
		
		const response = await generateAIResponse(
			[{ role: 'user', content: prompt }],
			'You are a medical content curator. Return only valid JSON with key "web_resources" as an array of objects with title, url, source, description, and type fields. No markdown code blocks.',
			{ 
				preferredProviders: ['gemini', 'openrouter', 'groq'],
				temperature: 0.3,
				maxTokens: 2000
			}
		);
		
		console.log(`   ✅ AI response received (${response.content?.length || 0} chars)`);
		
		// Parse JSON response
		let parsed = null;
		try {
			let cleaned = response.content.trim();
			if (cleaned.startsWith('```')) {
				cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
			}
			const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				cleaned = jsonMatch[0];
			}
			parsed = JSON.parse(cleaned);
		} catch (parseErr) {
			console.error(`   ❌ Failed to parse AI response:`, parseErr.message);
			console.error(`   Raw response:`, response.content?.substring(0, 200));
			// Return empty array if parsing fails
			return [];
		}
		
		const webResources = parsed.web_resources || parsed.webResources || [];
		
		if (!Array.isArray(webResources) || webResources.length === 0) {
			console.warn(`   ⚠️  No web resources in response, using fallback`);
			return generateFallbackWebResources(diseaseName, language);
		}
		
		// Validate and process web resources
		const processedResources = webResources
			.filter(resource => {
				if (!resource || typeof resource !== 'object') return false;
				const hasTitle = resource.title && typeof resource.title === 'string' && resource.title.trim().length > 0;
				const hasUrl = resource.url && typeof resource.url === 'string' && resource.url.trim().length > 0;
				// Validate URL format
				try {
					new URL(resource.url);
					return hasTitle && hasUrl;
				} catch {
					return false;
				}
			})
			.map((resource, index) => ({
				title: String(resource.title || '').trim(),
				url: String(resource.url || '').trim(),
				source: String(resource.source || resource.organization || 'Medical Resource').trim(),
				description: String(resource.description || resource.summary || '').trim(),
				type: String(resource.type || 'Article').trim(),
				language: String(language).trim(),
				refreshedAt: new Date(),
				isWebResource: true // Flag to distinguish from videos
			}))
			.slice(0, 8); // Limit to 8 resources
		
		console.log(`   ✅ Processed ${processedResources.length} web resources`);
		if (processedResources.length > 0) {
			processedResources.slice(0, 3).forEach((r, i) => {
				console.log(`      ${i + 1}. "${r.title}" - ${r.source}`);
			});
		}
		
		console.log(`${'='.repeat(60)}\n`);
		return processedResources;
	} catch (err) {
		console.error(`\n❌ WEB RESOURCE FETCH FAILED:`, err.message);
		console.error(`   Stack:`, err.stack?.split('\n').slice(0, 3).join('\n'));
		console.log(`   🔄 Using fallback web resources...`);
		return generateFallbackWebResources(diseaseName, language);
	}
}

/**
 * Generate fallback web resources when AI fails
 */
function generateFallbackWebResources(diseaseName, language = 'en') {
	console.log(`   📋 Generating fallback web resources for "${diseaseName}"...`);
	
	const baseResources = [
		{
			title: `${diseaseName} - Mayo Clinic`,
			url: `https://www.mayoclinic.org/diseases-conditions/${diseaseName.toLowerCase().replace(/\s+/g, '-')}/symptoms-causes/syc-20350000`,
			source: 'Mayo Clinic',
			description: 'Comprehensive medical information from Mayo Clinic',
			type: 'Article'
		},
		{
			title: `${diseaseName} - MedlinePlus`,
			url: `https://medlineplus.gov/${diseaseName.toLowerCase().replace(/\s+/g, '')}.html`,
			source: 'MedlinePlus (NIH)',
			description: 'Patient-friendly health information from the National Institutes of Health',
			type: 'Patient Guide'
		},
		{
			title: `${diseaseName} - WebMD`,
			url: `https://www.webmd.com/${diseaseName.toLowerCase().replace(/\s+/g, '-')}/default.htm`,
			source: 'WebMD',
			description: 'Medical information and patient resources',
			type: 'Article'
		},
		{
			title: `${diseaseName} - Healthline`,
			url: `https://www.healthline.com/health/${diseaseName.toLowerCase().replace(/\s+/g, '-')}`,
			source: 'Healthline',
			description: 'Evidence-based health information and resources',
			type: 'Article'
		},
		{
			title: `${diseaseName} - CDC`,
			url: `https://www.cdc.gov/search.html?q=${encodeURIComponent(diseaseName)}`,
			source: 'Centers for Disease Control (CDC)',
			description: 'Public health information and guidelines',
			type: 'Fact Sheet'
		}
	];
	
	return baseResources.map(resource => ({
		...resource,
		language: String(language).trim(),
		refreshedAt: new Date(),
		isWebResource: true
					}));
			}

/**
 * Step 1: Get captions/keywords from AI API for the identified disease
 */
async function getDiseaseCaptionsFromAI(diseaseName, language = 'en') {
	const languageName = language === 'hi' ? 'Hindi' : 'English';
	
	const prompt = `You are a medical content expert. For the disease/condition "${diseaseName}", generate 3-5 search captions or keywords that would be effective for finding educational YouTube videos about this disease.

IMPORTANT: Return ONLY valid JSON with this exact structure:
{
  "captions": ["caption1", "caption2", "caption3"]
}

REQUIREMENTS:
1. Each caption should be 2-6 words optimized for YouTube search
2. Include medical terms, symptoms, treatments, or patient education phrases
3. For ${languageName} content, include ${languageName} search terms if applicable
4. Captions should be specific enough to find educational videos from trusted medical sources

Example for "Type 2 Diabetes":
{
  "captions": [
    "type 2 diabetes explained",
    "diabetes treatment guide",
    "diabetes symptoms causes",
    "managing type 2 diabetes",
    "diabetes patient education"
  ]
}

Return ONLY the JSON, no markdown, no explanations.`;

	try {
		console.log(`   🤖 Calling AI API to generate captions...`);
		const { generateAIResponse } = await import('../config/aiProvider.js');
		const response = await generateAIResponse(
			[{ role: 'user', content: prompt }],
			'You are a medical content expert. Return only valid JSON with key "captions" as an array of strings. No markdown code blocks.',
			{ 
				preferredProviders: ['gemini', 'openrouter', 'groq'],
				temperature: 0.3,
				maxTokens: 500
			}
		);
		
		console.log(`   ✅ AI response received (${response.content?.length || 0} chars)`);
		
		// Parse JSON response
		let parsed = null;
		try {
			// Remove markdown code blocks if present
			let cleaned = response.content.trim();
			if (cleaned.startsWith('```')) {
				cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
			}
			parsed = JSON.parse(cleaned);
		} catch (parseErr) {
			console.error(`   ❌ Failed to parse AI response:`, parseErr.message);
			console.error(`   Raw response:`, response.content?.substring(0, 200));
			// Fallback: create basic captions from disease name
			return [
				`${diseaseName} explained`,
				`${diseaseName} treatment`,
				`${diseaseName} symptoms`
			];
		}
		
		const captions = parsed.captions || parsed.keywords || [];
		
		if (!Array.isArray(captions) || captions.length === 0) {
			console.warn(`   ⚠️  No captions in response, using fallback`);
			return [
				`${diseaseName} explained`,
				`${diseaseName} treatment`,
				`${diseaseName} symptoms`
			];
		}
		
		// Filter and validate captions
		const validCaptions = captions
			.filter(c => c && typeof c === 'string' && c.trim().length > 0)
			.map(c => c.trim())
			.slice(0, 5); // Max 5 captions
		
		return validCaptions.length > 0 ? validCaptions : [`${diseaseName} medical education`];
	} catch (err) {
		console.error(`   ❌ AI API failed:`, err.message);
		// Fallback: create basic captions
		return [
			`${diseaseName} medical education`,
			`${diseaseName} explained`,
			`${diseaseName} treatment`
		];
	}
}

/**
 * Enrich abnormal findings with reference ranges using Groq AI API
 */
async function enrichFindingsWithReferenceRanges(findings) {
	if (!findings || findings.length === 0) return findings;
	
	console.log(`\n🔍 Using Groq AI to fetch reference ranges for ${findings.length} findings...`);
	
	// Build detailed test list with values and units
	const testList = findings.map((f, i) => 
		`${i + 1}. ${f.test}${f.value ? ` (Value: ${f.value})` : ''}${f.unit ? ` (Unit: ${f.unit})` : ''}`
	).join('\n');
	
	const prompt = `You are a medical laboratory expert with access to standard clinical reference ranges from WHO, CDC, NIH, and clinical laboratory standards.

For each of the following lab tests, provide the standard reference range (normal values) in the exact format requested.

Lab Tests:
${testList}

CRITICAL REQUIREMENTS:
1. Return ONLY valid JSON with this exact structure:
{
  "reference_ranges": [
    { "test": "Exact Test Name", "reference_range": "10-20" },
    { "test": "Another Test", "reference_range": "5.0 - 15.5" }
  ]
}

2. Match test names exactly (case-insensitive, but preserve original capitalization in response)
3. Reference range format: "min-max" (e.g., "10-20", "12.5 - 15.3", "0.5-2.0")
4. Use standard medical reference ranges from:
   - WHO (World Health Organization) guidelines
   - CDC (Centers for Disease Control) standards
   - Clinical laboratory reference values
   - Established medical literature
5. If a test has different ranges for different populations (e.g., male/female, age groups), provide the most common/adult range
6. If test name doesn't match exactly, use the closest medical term match
7. If you cannot find a reference range, use "Not available" as the reference_range value

EXAMPLES:
- Hemoglobin: "12.0 - 17.5" (g/dL)
- Glucose: "70 - 100" (mg/dL)
- Creatinine: "0.6 - 1.2" (mg/dL)
- Total Cholesterol: "< 200" (mg/dL)

Return ONLY the JSON, no markdown code blocks, no explanations, no additional text.`;

	try {
		const { generateAIResponse } = await import('../config/aiProvider.js');
		
		// Use Groq specifically for reference ranges (fast and reliable)
		console.log('   🤖 Calling Groq AI API...');
		const response = await generateAIResponse(
			[{ role: 'user', content: prompt }],
			'You are a medical laboratory expert. Return only valid JSON with key "reference_ranges" as an array of objects with "test" and "reference_range" fields. No markdown code blocks.',
			{ 
				preferredProviders: ['groq'], // Prioritize Groq for speed
				temperature: 0.1, // Low temperature for accuracy
				maxTokens: 2000
			}
		);
		
		console.log(`   ✅ Groq response received (${response.content?.length || 0} chars)`);
		
		// Parse JSON response
		let parsed = null;
		try {
			let cleaned = response.content.trim();
			// Remove markdown code blocks if present
			if (cleaned.startsWith('```')) {
				cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
			}
			// Try to extract JSON if wrapped in text
			const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				cleaned = jsonMatch[0];
			}
			parsed = JSON.parse(cleaned);
		} catch (parseErr) {
			console.error('   ❌ Failed to parse Groq response:', parseErr.message);
			console.error('   Raw response preview:', response.content?.substring(0, 200));
			return findings; // Return original if parsing fails
		}
		
		const referenceRanges = parsed.reference_ranges || parsed.referenceRanges || [];
		console.log(`   📋 Groq returned ${referenceRanges.length} reference ranges`);
		
		// Match and enrich findings
		let enrichedCount = 0;
		const enrichedFindings = findings.map(finding => {
			// Try to find matching reference range (case-insensitive, flexible matching)
			const match = referenceRanges.find(rr => {
				if (!rr.test || !finding.test) return false;
				
				const rrTest = rr.test.toLowerCase().trim();
				const findingTest = finding.test.toLowerCase().trim();
				
				// Exact match
				if (rrTest === findingTest) return true;
				
				// Partial match (contains)
				if (rrTest.includes(findingTest) || findingTest.includes(rrTest)) return true;
				
				// Word-by-word match (handles abbreviations)
				const rrWords = rrTest.split(/\s+/);
				const findingWords = findingTest.split(/\s+/);
				const commonWords = rrWords.filter(w => findingWords.includes(w));
				if (commonWords.length >= Math.min(rrWords.length, findingWords.length) * 0.6) {
					return true;
				}
				
				return false;
			});
			
			if (match && match.reference_range && match.reference_range !== 'Not available') {
				enrichedCount++;
				console.log(`   ✅ Enriched "${finding.test}": ${match.reference_range}`);
				return {
					...finding,
					referenceRange: match.reference_range || match.referenceRange || ''
				};
			}
			
			return finding;
		});
		
		console.log(`   ✅ Successfully enriched ${enrichedCount} out of ${findings.length} findings with Groq`);
		return enrichedFindings;
	} catch (err) {
		console.error('   ❌ Groq reference range enrichment failed:', err.message);
		console.error('   Stack:', err.stack?.split('\n').slice(0, 3).join('\n'));
		return findings; // Return original if enrichment fails
	}
}

/**
 * Fetch global statistics and patient impact facts for a disease using Perplexity AI
 */
async function fetchGlobalStatisticsAndPatientImpact(diseaseName) {
	console.log(`   🤖 Calling Perplexity AI to analyze global cases and statistics for "${diseaseName}"...`);
	
	const prompt = `You are a medical epidemiologist and patient care expert with access to REAL-TIME medical data via Perplexity's live search capabilities. Analyze the disease/condition "${diseaseName}" and provide comprehensive GLOBAL CASE ANALYSIS and worldwide statistics with SPECIFIC NUMBERS AND FIGURES from current medical databases.

IMPORTANT: Use Perplexity's real-time search to find the LATEST statistics from WHO, CDC, NIH, peer-reviewed journals, and global health databases. Focus on:
- Total number of cases worldwide (current and historical)
- Annual new case numbers globally
- Country-by-country breakdown if available
- Regional distribution of cases
- Recent outbreaks or trends
- Global burden of disease

CRITICAL: Return ONLY valid JSON with this exact structure. ALL values must include specific numbers, percentages, or figures:
{
  "global_statistics": {
    "global_prevalence": "e.g., Affects 422 million people worldwide (8.5% of global population) or 1 in 12 adults. Current global cases: 150 million active cases as of 2024",
    "incidence_rate": "e.g., 2.5 million new cases per year globally, or 3,500 new cases per 100,000 people annually. Peak incidence in [specific countries/regions]",
    "mortality_rate": "e.g., 5.2% mortality rate, or 1.5 million deaths per year globally. Case fatality rate: 2.3% in developed countries vs 8.7% in developing regions",
    "affected_regions": ["Asia (45% of cases - 68 million cases)", "Americas (30% of cases - 45 million cases)", "Europe (20% of cases - 30 million cases)", "Africa (5% of cases - 7.5 million cases)"],
    "age_groups": "e.g., Most common in ages 45-64 (35% of cases), ages 65+ (28%), ages 25-44 (25%), under 25 (12%). Peak age: 50-60 years",
    "gender_distribution": "e.g., 55% males, 45% females, or 1.2:1 male-to-female ratio. Higher prevalence in [specific gender] by [percentage]",
    "economic_impact": "e.g., Costs $327 billion annually in healthcare expenses globally, or $8,500 per patient per year. Lost productivity: $150 billion/year",
    "trends": "e.g., Increasing by 2.3% per year globally, or 15% increase over the last decade. Recent surge in [regions] with [percentage] increase in 2023-2024",
    "case_distribution": "e.g., Top 5 countries: USA (25 million cases), China (18 million), India (15 million), Brazil (12 million), Russia (8 million). These account for 52% of global cases"
  },
  "patient_impact_facts": {
    "lifestyle_impact": [
      "Requires dietary modifications in 85% of cases",
      "Exercise restrictions affect 60% of patients",
      "Daily medication adherence needed in 90% of cases",
      "Sleep pattern changes in 40% of patients"
    ],
    "work_impact": [
      "Average 5-10 days of work absence per year",
      "30% of patients require job modifications",
      "Productivity reduction of 15-25% during flare-ups",
      "Disability claims in 8% of severe cases"
    ],
    "family_impact": [
      "Genetic counseling recommended for 25% of cases",
      "Family screening advised for first-degree relatives (30% increased risk)",
      "Caregiver support needed in 20% of cases",
      "Impact on family finances in 35% of households"
    ],
    "financial_impact": [
      "Average treatment cost: $2,500-$5,000 per year",
      "Insurance coverage varies: 70-90% typically covered",
      "Out-of-pocket expenses: $500-$1,500 annually",
      "Lost income: $3,000-$8,000 per year for severe cases"
    ],
    "emotional_impact": [
      "Anxiety affects 45% of patients",
      "Depression reported in 30% of cases",
      "Support groups available in 60% of regions",
      "Mental health counseling recommended for 25% of patients"
    ],
    "long_term_outlook": [
      "5-year survival rate: 85-95% with proper treatment",
      "10-year prognosis: Good in 70% of cases with management",
      "Requires lifelong monitoring in 80% of cases",
      "Quality of life maintained in 75% of patients"
    ],
    "quality_of_life": [
      "Minimal impact with proper management in 70% of cases",
      "Daily activities affected in 40% of patients",
      "Social activities reduced in 25% of cases",
      "Overall QoL score: 7.2/10 with treatment (vs 4.5/10 without)"
    ],
    "precautions": [
      "Avoid certain medications in 60% of cases",
      "Regular monitoring every 3-6 months required",
      "Emergency action plan needed for 15% of patients",
      "Vaccination considerations for 50% of cases"
    ]
  }
}

REQUIREMENTS:
1. Use Perplexity's REAL-TIME search to find the LATEST global case data from WHO, CDC, NIH, peer-reviewed journals, and medical databases
2. ALWAYS include specific numbers, percentages, or figures - avoid vague statements like "common" or "rare"
3. Include recent data (within last 5 years when possible, prioritize 2023-2024 data)
4. Provide country-specific breakdowns when available (top 5-10 countries with highest case counts)
5. Include regional case distribution with percentages and absolute numbers
6. Mention any recent outbreaks, epidemics, or significant changes in case numbers
7. Make patient impact facts practical with QUANTITATIVE data
8. Focus on facts that directly affect the patient's daily life with MEASURABLE IMPACT
9. Use actual statistics and research findings - cite data sources when possible
10. If exact numbers aren't available, provide ranges (e.g., "15-25%") or estimates with context and year
11. For "case_distribution", list top countries/regions with specific case numbers and percentages

Return ONLY the JSON, no markdown code blocks, no explanations. Use Perplexity's live search to get the most current worldwide case statistics.`;

		try {
		const { generateAIResponse } = await import('../config/aiProvider.js');
		
		// Check if Perplexity API key is an OpenRouter key
		const perplexityKey = process.env.PERPLEXITY_API_KEY || '';
		const isOpenRouterKey = perplexityKey.startsWith('sk-or-v1-');
		
		// Try Perplexity first, then fallback to other providers
		let preferredProviders = isOpenRouterKey 
			? ['openrouter'] // OpenRouter can access Perplexity models
			: ['perplexity']; // Direct Perplexity API
		
		const model = isOpenRouterKey 
			? 'perplexity/llama-3.1-sonar-large-32k-online' // Perplexity via OpenRouter
			: undefined; // Use default from env
		
		console.log(`   🔑 Attempting ${isOpenRouterKey ? 'OpenRouter' : 'Perplexity'} API for statistics`);
		console.log(`   📝 Model: ${model || 'default'}`);
		console.log(`   🔑 API Key present: ${perplexityKey ? 'Yes' : 'No'}`);
		
		let response = null;
		let lastError = null;
		
		// Try Perplexity first
		try {
			response = await generateAIResponse(
				[{ role: 'user', content: prompt }],
				'You are a medical epidemiologist with access to real-time medical data. Return only valid JSON with "global_statistics" and "patient_impact_facts" objects. Include specific numbers and figures. No markdown code blocks.',
				{ 
					preferredProviders: preferredProviders,
					model: model, // Specify Perplexity model if using OpenRouter
					temperature: 0.1, // Very low temperature for accuracy
					maxTokens: 4000
				}
			);
			
			if (response && response.content && response.content.trim().length > 0) {
				console.log(`   ✅ Perplexity response received successfully`);
			} else {
				throw new Error('Empty response from Perplexity');
			}
		} catch (perplexityErr) {
			console.warn(`   ⚠️  Perplexity failed: ${perplexityErr.message}`);
			lastError = perplexityErr;
			
			// Fallback to other providers in order: Hugging Face, OpenAI, Gemini
			const fallbackProviders = [
				{ name: 'Hugging Face', providers: ['huggingface'] },
				{ name: 'OpenAI', providers: ['openai'] },
				{ name: 'Gemini', providers: ['gemini', 'openrouter'] }
			];
			
			for (const fallback of fallbackProviders) {
				try {
					console.log(`   🔄 Trying fallback: ${fallback.name}...`);
					response = await generateAIResponse(
						[{ role: 'user', content: prompt }],
						'You are a medical epidemiologist with access to real-time medical data. Return only valid JSON with "global_statistics" and "patient_impact_facts" objects. Include specific numbers and figures. No markdown code blocks.',
						{ 
							preferredProviders: fallback.providers,
							temperature: 0.1,
							maxTokens: 4000
						}
					);
					
					if (response && response.content && response.content.trim().length > 0) {
						console.log(`   ✅ ${fallback.name} response received successfully`);
						break; // Success, exit fallback loop
					} else {
						throw new Error(`Empty response from ${fallback.name}`);
					}
		} catch (fallbackErr) {
					console.warn(`   ⚠️  ${fallback.name} failed: ${fallbackErr.message}`);
					lastError = fallbackErr;
					continue; // Try next fallback
				}
			}
		}
		
		// If all providers failed
		if (!response || !response.content || response.content.trim().length === 0) {
			console.error('   ❌ All providers failed. Last error:', lastError?.message);
			throw lastError || new Error('All AI providers failed to generate response');
		}
		
		console.log(`   ✅ Response received (${response?.content?.length || 0} chars)`);
		console.log(`   📄 Response preview: ${response?.content?.substring(0, 200) || 'No content'}...`);
		console.log(`   📦 Response structure:`, {
			hasContent: !!response?.content,
			hasProvider: !!response?.provider,
			hasModel: !!response?.model,
			contentType: typeof response?.content
		});
		
		// Check if response has content
		if (!response || !response.content || response.content.trim().length === 0) {
			console.error('   ❌ Empty response from Perplexity API');
			return { globalStatistics: null, patientImpactFacts: null };
		}
		
		// Parse JSON response
		let parsed = null;
		try {
			let cleaned = response.content.trim();
			if (cleaned.startsWith('```')) {
				cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
			}
			const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				cleaned = jsonMatch[0];
			}
			parsed = JSON.parse(cleaned);
			console.log('   ✅ Successfully parsed JSON response');
		} catch (parseErr) {
			console.error('   ❌ Failed to parse Perplexity response:', parseErr.message);
			console.error('   Raw response preview:', response.content?.substring(0, 500));
			console.error('   Parse error details:', parseErr);
			return { globalStatistics: null, patientImpactFacts: null };
		}
		
		const globalStats = parsed.global_statistics || parsed.globalStatistics || {};
		const patientFacts = parsed.patient_impact_facts || parsed.patientImpactFacts || {};
		
		// Helper function to normalize string arrays (local to this function)
		const normalizeStringArrayLocal = (arr) => {
			if (!arr) return [];
			if (Array.isArray(arr)) {
				return arr.filter(Boolean).map(item => String(item).trim()).filter(item => item.length > 0);
			}
			if (typeof arr === 'string') {
				return [arr.trim()].filter(item => item.length > 0);
			}
			return [];
		};
		
		// Normalize the data
		const globalStatistics = {
			globalPrevalence: globalStats.global_prevalence || globalStats.globalPrevalence || '',
			incidenceRate: globalStats.incidence_rate || globalStats.incidenceRate || '',
			mortalityRate: globalStats.mortality_rate || globalStats.mortalityRate || '',
			affectedRegions: Array.isArray(globalStats.affected_regions || globalStats.affectedRegions) 
				? (globalStats.affected_regions || globalStats.affectedRegions)
				: [],
			ageGroups: globalStats.age_groups || globalStats.ageGroups || '',
			genderDistribution: globalStats.gender_distribution || globalStats.genderDistribution || '',
			economicImpact: globalStats.economic_impact || globalStats.economicImpact || '',
			trends: globalStats.trends || '',
			caseDistribution: globalStats.case_distribution || globalStats.caseDistribution || '', // New field for case breakdown
			lastUpdated: new Date()
		};
		
		const patientImpactFacts = {
			lifestyleImpact: normalizeStringArrayLocal(patientFacts.lifestyle_impact || patientFacts.lifestyleImpact),
			workImpact: normalizeStringArrayLocal(patientFacts.work_impact || patientFacts.workImpact),
			familyImpact: normalizeStringArrayLocal(patientFacts.family_impact || patientFacts.familyImpact),
			financialImpact: normalizeStringArrayLocal(patientFacts.financial_impact || patientFacts.financialImpact),
			emotionalImpact: normalizeStringArrayLocal(patientFacts.emotional_impact || patientFacts.emotionalImpact),
			longTermOutlook: normalizeStringArrayLocal(patientFacts.long_term_outlook || patientFacts.longTermOutlook),
			qualityOfLife: normalizeStringArrayLocal(patientFacts.quality_of_life || patientFacts.qualityOfLife),
			precautions: normalizeStringArrayLocal(patientFacts.precautions || []),
			lastUpdated: new Date()
		};
		
		const providerUsed = response?.provider || 'Unknown';
		console.log(`   ✅ Successfully parsed global statistics and patient impact facts from ${providerUsed}`);
		console.log(`   📊 Global stats fields with data: ${Object.keys(globalStatistics).filter(k => globalStatistics[k] && k !== 'lastUpdated').length}`);
		console.log(`   📊 Global stats details:`, {
			hasPrevalence: !!globalStatistics.globalPrevalence,
			hasIncidence: !!globalStatistics.incidenceRate,
			hasMortality: !!globalStatistics.mortalityRate,
			hasCaseDistribution: !!globalStatistics.caseDistribution,
			affectedRegionsCount: globalStatistics.affectedRegions?.length || 0
		});
		console.log(`   👤 Patient impact categories with data: ${Object.keys(patientImpactFacts).filter(k => Array.isArray(patientImpactFacts[k]) && patientImpactFacts[k].length > 0).length}`);
		console.log(`   👤 Patient impact details:`, {
			lifestyle: patientImpactFacts.lifestyleImpact?.length || 0,
			work: patientImpactFacts.workImpact?.length || 0,
			family: patientImpactFacts.familyImpact?.length || 0,
			financial: patientImpactFacts.financialImpact?.length || 0,
			emotional: patientImpactFacts.emotionalImpact?.length || 0,
			longTerm: patientImpactFacts.longTermOutlook?.length || 0,
			qualityOfLife: patientImpactFacts.qualityOfLife?.length || 0,
			precautions: patientImpactFacts.precautions?.length || 0
		});
		return { globalStatistics, patientImpactFacts };
	} catch (err) {
		console.error('   ❌ Perplexity API failed:', err.message);
		console.error('   Error type:', err.constructor.name);
		console.error('   Stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
		console.error('   Full error:', err);
		return { globalStatistics: null, patientImpactFacts: null };
	}
}

/**
 * Extract YouTube video ID from URL
 */
function extractVideoIdFromUrl(url) {
	if (!url) return null;
	
	try {
		const urlObj = new URL(url);
		// youtube.com/watch?v=ID
		if (urlObj.hostname.includes('youtube.com')) {
			return urlObj.searchParams.get('v');
		}
		// youtu.be/ID
		if (urlObj.hostname.includes('youtu.be')) {
			const match = urlObj.pathname.match(/\/([a-zA-Z0-9_-]{11})/);
			return match ? match[1] : null;
		}
	} catch {
		// Try regex fallback
		const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
		return match ? match[1] : null;
	}
	
	return null;
}

export async function interpretReport(req, res) {
	try {
		const { parsedText, fileName } = req.body;
		if (!parsedText || parsedText.length < 5) {
			return res.status(400).json({ message: 'parsedText required' });
		}
		
		console.log('🔬 Starting multi-provider consensus analysis...');
		
		// Use multi-provider consensus for fact-based medical analysis
		let aiResponse;
		let result;
		try {
			aiResponse = await getConsensusResponse(
				[{ role: 'user', content: buildInterpretPrompt(parsedText) }],
				'Return only valid JSON for downstream parsing. Be precise and evidence-based.',
				{ sectionType: 'json', minProviders: 1, temperature: 0.1, maxTokens: 4000 }
			);
			result = aiResponse.parsed || safeJsonParse(aiResponse.content) || {};
			result.disclaimer = DISCLAIMER;
			result.aiProvider = aiResponse.providers.join(', '); // Track all providers used
			result.aiModel = aiResponse.models.join(', ');
			result.consensusValidated = aiResponse.validatedBy > 1;
			result.validatedBy = aiResponse.validatedBy;
		} catch (consensusError) {
			console.warn('⚠️  Consensus failed, falling back to single provider:', consensusError.message);
			// Fallback to single provider if consensus fails
			const fallback = await generateAIResponse(
				[{ role: 'user', content: buildInterpretPrompt(parsedText) }],
				'Return only valid JSON for downstream parsing.',
				{ preferredProviders: ['openrouter', 'groq'], temperature: 0.1, maxTokens: 4000 }
			);
			result = safeJsonParse(fallback.content) || {};
			result.disclaimer = DISCLAIMER;
			result.aiProvider = fallback.provider;
			result.aiModel = fallback.model;
			result.consensusValidated = false;
			result.validatedBy = 1;
		}

		// Normalize complex AI responses to match schema
		function normalizeDiseaseName(diseaseData) {
			if (typeof diseaseData === 'string') return diseaseData;
			if (typeof diseaseData === 'object' && diseaseData !== null) {
				return diseaseData.primary_diagnosis || diseaseData.diagnosis || diseaseData.name || 'Unknown';
			}
			return 'Unknown';
		}

		function normalizeCause(causeData) {
			if (typeof causeData === 'string') return causeData;
			if (typeof causeData === 'object' && causeData !== null) {
				const parts = [];
				if (causeData.pathophysiology) parts.push(causeData.pathophysiology);
				if (causeData.epidemiology) parts.push(`Epidemiology: ${causeData.epidemiology}`);
				if (Array.isArray(causeData.risk_factors) && causeData.risk_factors.length) {
					parts.push(`Risk factors: ${causeData.risk_factors.join(', ')}`);
				}
				if (causeData.genetic_factors && causeData.genetic_factors !== 'None') {
					parts.push(`Genetic factors: ${causeData.genetic_factors}`);
				}
				return parts.length > 0 ? parts.join('\n\n') : JSON.stringify(causeData);
			}
			return '';
		}

		function normalizeStringArray(arrayData) {
			if (!arrayData) return [];
			if (Array.isArray(arrayData)) {
				const normalized = [];
				for (const item of arrayData) {
					if (typeof item === 'string') {
						normalized.push(item);
					} else if (typeof item === 'object' && item !== null) {
						// Extract from common object structures
						if (Array.isArray(item.primary_symptoms)) {
							normalized.push(...item.primary_symptoms);
						} else if (Array.isArray(item.primary_prevention)) {
							normalized.push(...item.primary_prevention);
						} else if (Array.isArray(item.first_line_treatments)) {
							normalized.push(...item.first_line_treatments);
						} else if (item.name || item.title || item.text) {
							normalized.push(item.name || item.title || item.text);
						} else {
							// Flatten object to readable strings
							const values = Object.values(item).flat();
							for (const val of values) {
								if (typeof val === 'string' && val.trim()) {
									normalized.push(val);
								} else if (Array.isArray(val)) {
									normalized.push(...val.filter(v => typeof v === 'string'));
								}
							}
						}
					} else {
						const str = String(item).trim();
						if (str) normalized.push(str);
					}
				}
				return normalized.filter(Boolean);
			}
			if (typeof arrayData === 'string') {
				// Try to parse if it's a JSON string
				try {
					const parsed = JSON.parse(arrayData);
					return normalizeStringArray(parsed);
				} catch {
					// If it's a multiline string with array-like syntax, try to extract
					const match = arrayData.match(/\[(.*?)\]/s);
					if (match) {
						try {
							const parsed = JSON.parse(match[0]);
							return normalizeStringArray(parsed);
						} catch {
							// Extract quoted strings
							const quoted = arrayData.match(/'([^']+)'|"([^"]+)"/g);
							if (quoted) {
								return quoted.map(q => q.replace(/['"]/g, '')).filter(Boolean);
							}
						}
					}
					return [arrayData];
				}
			}
			return [];
		}

		function normalizeSeverity(severityData) {
			if (typeof severityData === 'string') return severityData;
			if (typeof severityData === 'object' && severityData !== null) {
				return severityData.assessment || severityData.level || severityData.severity || JSON.stringify(severityData);
			}
			return '';
		}

		// Normalize fields
		const name = normalizeDiseaseName(result.probable_disease) || 'Unknown';
		
		// Process abnormal findings and enrich with reference ranges if missing
		let abnormalFindings = Array.isArray(result.abnormal_values)
			? result.abnormal_values.map((v) => {
					// Extract reference range from multiple possible fields
					let referenceRange = v.reference_range || v.referenceRange || v.range || v.reference || v.ref_range || '';
					
					// If reference range is missing, try to extract from interpretation
					if (!referenceRange && v.interpretation) {
						const rangeMatch = String(v.interpretation).match(/(\d+\.?\d*)\s*[-–—to]\s*(\d+\.?\d*)/i);
						if (rangeMatch) {
							referenceRange = `${rangeMatch[1]} - ${rangeMatch[2]}`;
						}
					}
					
					return {
					test: v.test || v.name || '',
					value: v.value ? String(v.value) : '',
					unit: v.unit || v.units || '',
						referenceRange: referenceRange,
					interpretation: v.interpretation || v.meaning || '',
					flag: v.flag || v.status || '',
					severity: v.severity || v.level || ''
					};
			  })
			: [];
		
		// Merge with findings extracted directly from text (these have reference ranges from document)
		console.log('\n' + '='.repeat(70));
		console.log('📄 STEP: Extracting abnormal values directly from uploaded document...');
		console.log('='.repeat(70));
		const fallbackFindings = extractAbnormalFromText(parsedText);
		
		// Merge: prefer AI findings but use extracted ones if they have better reference ranges
		if (fallbackFindings && fallbackFindings.length > 0) {
			console.log(`\n✅ Found ${fallbackFindings.length} findings from direct text extraction`);
			console.log('   Extracted findings:');
			fallbackFindings.forEach((f, i) => {
				console.log(`   ${i + 1}. ${f.test} = ${f.value} ${f.unit || ''} (Range: ${f.referenceRange || 'N/A'})`);
			});
			
			// Merge findings: use extracted ones if they have reference ranges and AI ones don't
			const mergedFindings = [...abnormalFindings];
			let updatedCount = 0;
			let addedCount = 0;
			
			for (const extracted of fallbackFindings) {
				const existing = mergedFindings.find(f => 
					f.test && extracted.test &&
					f.test.toLowerCase().trim() === extracted.test.toLowerCase().trim()
				);
				
				if (existing) {
					// If extracted has reference range but existing doesn't, use extracted
					if (extracted.referenceRange && !existing.referenceRange) {
						existing.referenceRange = extracted.referenceRange;
						updatedCount++;
						console.log(`   ✅ Updated reference range for "${existing.test}": ${extracted.referenceRange}`);
					}
				} else {
					// New finding from extraction, add it
					mergedFindings.push(extracted);
					addedCount++;
					console.log(`   ➕ Added new finding from extraction: "${extracted.test}" = ${extracted.value} ${extracted.unit || ''}`);
				}
			}
			
			console.log(`\n📊 Merge Summary: ${updatedCount} updated, ${addedCount} added, ${mergedFindings.length} total findings`);
			abnormalFindings = mergedFindings;
		} else {
			console.log('   ⚠️  No findings extracted from document text');
		}
		
		// Enrich findings with reference ranges from Groq AI if still missing
		const findingsNeedingRanges = abnormalFindings.filter(f => !f.referenceRange || f.referenceRange.trim() === '');
		if (findingsNeedingRanges.length > 0) {
			console.log('\n' + '='.repeat(70));
			console.log(`📋 STEP: Enriching ${findingsNeedingRanges.length} findings with missing reference ranges using Groq AI...`);
			console.log('='.repeat(70));
			console.log('   Findings needing ranges:');
			findingsNeedingRanges.forEach((f, i) => {
				console.log(`   ${i + 1}. ${f.test} = ${f.value} ${f.unit || ''}`);
			});
			
			try {
				const enrichedFindings = await enrichFindingsWithReferenceRanges(findingsNeedingRanges);
				// Update findings with enriched data
				let enrichedCount = 0;
				abnormalFindings = abnormalFindings.map(f => {
					const enriched = enrichedFindings.find(e => e.test === f.test);
					if (enriched && enriched.referenceRange && enriched.referenceRange !== f.referenceRange) {
						enrichedCount++;
						return { ...f, referenceRange: enriched.referenceRange };
					}
					return f;
				});
				console.log(`\n✅ Successfully enriched ${enrichedCount} findings with Groq AI`);
			} catch (err) {
				console.error('\n❌ Failed to enrich reference ranges:', err.message);
				console.error('   Stack:', err.stack?.split('\n').slice(0, 3).join('\n'));
			}
		} else {
			console.log('\n✅ All findings already have reference ranges - skipping Groq enrichment');
		}
		
		// Final summary
		console.log('\n' + '='.repeat(70));
		console.log('📊 FINAL ABNORMAL FINDINGS SUMMARY');
		console.log('='.repeat(70));
		console.log(`   Total findings: ${abnormalFindings.length}`);
		const withRanges = abnormalFindings.filter(f => f.referenceRange && f.referenceRange.trim() !== '').length;
		console.log(`   With reference ranges: ${withRanges}/${abnormalFindings.length}`);
		if (abnormalFindings.length > 0) {
			console.log('\n   Final findings list:');
			abnormalFindings.forEach((f, i) => {
				const hasRange = f.referenceRange && f.referenceRange.trim() !== '';
				console.log(`   ${i + 1}. ${f.test} = ${f.value} ${f.unit || ''} | Range: ${hasRange ? f.referenceRange : '❌ Missing'} | Status: ${f.flag || f.severity || 'N/A'}`);
			});
		}
		console.log('='.repeat(70) + '\n');
		const medications = Array.isArray(result.medications)
			? result.medications
					.map((med) =>
						typeof med === 'string'
							? med
							: med.name || med.generic || med.drug || med.title || ''
					)
					.filter(Boolean)
			: typeof result.medications === 'string'
			? [result.medications]
			: [];
		const medicationDetails = medications.length ? await enrichMedications(medications) : [];
		// Fetch global statistics and patient impact facts using Perplexity AI
		console.log('\n' + '='.repeat(70));
		console.log('🌍 STEP: Fetching global statistics and patient impact facts using Perplexity AI...');
		console.log('='.repeat(70));
		let globalStatistics = null;
		let patientImpactFacts = null;
		
		try {
			const statsAndFacts = await fetchGlobalStatisticsAndPatientImpact(name);
			globalStatistics = statsAndFacts.globalStatistics;
			patientImpactFacts = statsAndFacts.patientImpactFacts;
			
			if (globalStatistics) {
				console.log('✅ Global statistics fetched:', {
					hasPrevalence: !!globalStatistics.globalPrevalence,
					hasIncidence: !!globalStatistics.incidenceRate,
					hasMortality: !!globalStatistics.mortalityRate,
					fieldsCount: Object.keys(globalStatistics).filter(k => globalStatistics[k] && k !== 'lastUpdated').length
				});
			}
			
			if (patientImpactFacts) {
				console.log('✅ Patient impact facts fetched:', {
					lifestyle: patientImpactFacts.lifestyleImpact?.length || 0,
					work: patientImpactFacts.workImpact?.length || 0,
					family: patientImpactFacts.familyImpact?.length || 0,
					financial: patientImpactFacts.financialImpact?.length || 0,
					emotional: patientImpactFacts.emotionalImpact?.length || 0,
					totalCategories: Object.keys(patientImpactFacts).filter(k => Array.isArray(patientImpactFacts[k]) && patientImpactFacts[k].length > 0).length
				});
			}
		} catch (err) {
			console.error('⚠️  Failed to fetch global statistics:', err.message);
			console.error('   Stack:', err.stack?.split('\n').slice(0, 3).join('\n'));
		}
		
		const videoResourcesRaw =
			Array.isArray(result.video_resources) && result.video_resources.length
				? result.video_resources
				: null;
		const videoResources = videoResourcesRaw
			? videoResourcesRaw
					.filter((item) => item?.url && item?.title)
					.map((item) => ({
						title: item.title,
						url: item.url,
						channel: item.channel || item.source || '',
						duration: item.duration || '',
						reason: item.reason || item.summary || '',
						audioUrl: item.audio_url || '',
						language: item.language || 'en',
						refreshedAt: new Date()
					}))
			: await fetchVideoResources(name, 'en');
		const specialistProviders = await fetchSpecialists(name);
		const emergencyRemedyRaw =
			result.emergency_home_remedy ||
			result.emergency_home_remedies ||
			result.first_aid ||
			result.emergency_care;
		const emergencyRemedies = Array.isArray(emergencyRemedyRaw)
			? emergencyRemedyRaw.filter(Boolean).map((item) => String(item))
			: emergencyRemedyRaw
			? [String(emergencyRemedyRaw)]
			: [];

		// Log what we're about to save
		console.log('\n' + '='.repeat(70));
		console.log('💾 STEP: Saving disease data to database...');
		console.log('='.repeat(70));
		console.log('   Disease name:', name);
		console.log('   Global statistics:', globalStatistics ? 'Present' : 'Missing');
		if (globalStatistics) {
			console.log('   Global stats fields:', Object.keys(globalStatistics).filter(k => globalStatistics[k] && k !== 'lastUpdated'));
		}
		console.log('   Patient impact facts:', patientImpactFacts ? 'Present' : 'Missing');
		if (patientImpactFacts) {
			const categoriesWithData = Object.keys(patientImpactFacts).filter(k => 
				Array.isArray(patientImpactFacts[k]) && patientImpactFacts[k].length > 0
			);
			console.log('   Patient impact categories:', categoriesWithData.length, categoriesWithData);
		}

		// Upsert Disease (unapproved by default)
		const disease = await Disease.create({
			name,
			aiSummary: {
				cause: normalizeCause(result.cause) || '',
				symptoms: normalizeStringArray(result.symptoms),
				prevention: normalizeStringArray(result.prevention),
				treatments: normalizeStringArray(result.treatments),
				medications,
				medicationDetails,
				emergencyRemedies,
				typicalDuration: result.typical_duration || (typeof result.typical_duration === 'object' ? JSON.stringify(result.typical_duration) : ''),
				severity: normalizeSeverity(result.severity) || '',
				sources: [],
				generatedAt: new Date()
			},
			globalStatistics: globalStatistics || {},
			patientImpactFacts: patientImpactFacts || {},
			abnormalFindings,
			specialistProviders,
			videoResources,
			pharmacyLinks: [],
			approved: false,
			createdBy: req.user ? req.user.id : null,
			aiProvider: aiResponse.provider, // Store which provider was used
			aiModel: aiResponse.model // Store which model was used
		});
		
		console.log('✅ Disease saved with ID:', disease._id);
		console.log('   Saved global statistics:', disease.globalStatistics ? 'Yes' : 'No');
		console.log('   Saved patient impact facts:', disease.patientImpactFacts ? 'Yes' : 'No');
		console.log('='.repeat(70) + '\n');

		// Save History
		if (req.user) {
			await History.create({
				userId: req.user.id,
				fileName: fileName || 'upload',
				detectedDisease: name,
				parsedText,
				aiSummary: disease.aiSummary,
				videoResources,
				specialistProviders
			});
		}

		res.json({ 
			diseaseId: disease._id, 
			disease, 
			disclaimer: DISCLAIMER,
			aiProvider: aiResponse.provider,
			aiModel: aiResponse.model,
			specialistProviders
		});
	} catch (err) {
		console.error('AI interpretation error:', err.message, err.stack);
		console.error('Error details:', JSON.stringify(err, null, 2));
		
		// Multi-provider error handling
		if (err.message?.includes('No AI providers configured')) {
			return res.status(500).json({ 
				message: 'No AI providers configured. Please set at least one API key (GEMINI_API_KEY, GROQ_API_KEY, or HUGGINGFACE_API_KEY) in server/.env' 
			});
		}
		if (err.message?.includes('All AI providers failed')) {
			return res.status(500).json({ 
				message: 'All AI providers failed. Please check your API keys and try again. The system tried all available providers but none succeeded.' 
			});
		}
		if (err.message?.includes('API key') || err.message?.includes('API_KEY') || err.message?.includes('401')) {
			return res.status(500).json({ 
				message: 'One or more AI provider API keys are invalid. Please check your API keys in server/.env' 
			});
		}
		if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
			return res.status(500).json({ 
				message: 'Cannot connect to AI services. Please check your internet connection.' 
			});
		}
		
		// Return error message
		const errorMsg = err.response?.data?.error?.message || err.message || 'Unknown error';
		console.error('Full error object:', err);
		res.status(500).json({ 
			message: `AI interpretation failed: ${errorMsg}`,
			details: process.env.NODE_ENV === 'development' ? err.message : undefined
		});
	}
}



