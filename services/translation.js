import { generateAIResponse } from '../config/aiProvider.js';

const LANGUAGE_LABELS = {
	en: 'English',
	hi: 'Hindi'
};

function languageName(code) {
	return LANGUAGE_LABELS[code] || code;
}

function safeJsonParse(text) {
	try {
		return JSON.parse(text);
	} catch {
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

export async function translateSummary(summary, targetLanguage) {
	if (targetLanguage === 'en') {
		return {
			summary: summary,
			narration: ''
		};
	}

	const languageDisplay = languageName(targetLanguage);
	const prompt = `You are a professional medical translator. Translate the following disease summary JSON into ${languageDisplay} (${targetLanguage === 'hi' ? 'हिंदी' : languageDisplay}).

CRITICAL REQUIREMENTS:
1. Translate ALL text content (cause, symptoms, treatments, medications, prevention, etc.) into ${languageDisplay}
2. Preserve the JSON structure exactly - same keys, same array structure
3. Do NOT add new keys or remove existing keys
4. Translate array items (symptoms, treatments, medications, prevention) - each item should be in ${languageDisplay}
5. Keep medical terms accurate - use standard ${languageDisplay} medical terminology
6. Also create a concise narration string in ${languageDisplay} (under 120 words) summarizing the key points for text-to-speech

Return ONLY valid JSON with this exact structure:
{
  "summary": {
    "cause": "translated cause text",
    "symptoms": ["translated symptom 1", "translated symptom 2", ...],
    "treatments": ["translated treatment 1", ...],
    "medications": ["translated medication 1", ...],
    "prevention": ["translated prevention 1", ...],
    "emergencyRemedies": ["translated remedy 1", ...],
    "typicalDuration": "translated duration",
    "severity": "translated severity"
  },
  "narration": "concise summary in ${languageDisplay} for TTS"
}

Disease Summary JSON:
${JSON.stringify(summary, null, 2)}`;

	try {
		const response = await generateAIResponse(
			[{ role: 'user', content: prompt }],
			`You are a professional medical translator specializing in ${languageDisplay}. Return ONLY valid JSON, no markdown, no code blocks.`,
			{ preferredProviders: ['openrouter', 'gemini', 'groq'], temperature: 0.2, maxTokens: 3000 }
		);

		if (!response || !response.content) {
			console.error('Translation: Empty response from AI');
			throw new Error('Translation failed - empty response');
		}

		const parsed = safeJsonParse(response.content);
		if (!parsed || !parsed.summary) {
			console.error('Translation parsing failed. Response:', response.content?.substring(0, 500));
			throw new Error('Translation failed - invalid response format');
		}
		
		// Validate that summary has expected structure
		if (typeof parsed.summary !== 'object') {
			console.error('Translation: summary is not an object. Type:', typeof parsed.summary);
			throw new Error('Translation failed - summary is not an object');
		}
		
		// Ensure all required fields exist
		const translatedSummary = {
			cause: parsed.summary.cause || summary.cause || '',
			symptoms: Array.isArray(parsed.summary.symptoms) ? parsed.summary.symptoms : (summary.symptoms || []),
			treatments: Array.isArray(parsed.summary.treatments) ? parsed.summary.treatments : (summary.treatments || []),
			medications: Array.isArray(parsed.summary.medications) ? parsed.summary.medications : (summary.medications || []),
			prevention: Array.isArray(parsed.summary.prevention) ? parsed.summary.prevention : (summary.prevention || []),
			emergencyRemedies: Array.isArray(parsed.summary.emergencyRemedies) ? parsed.summary.emergencyRemedies : (summary.emergencyRemedies || []),
			typicalDuration: parsed.summary.typicalDuration || summary.typicalDuration || '',
			severity: parsed.summary.severity || summary.severity || ''
		};
		
		return {
			summary: translatedSummary,
			narration: parsed.narration || ''
		};
	} catch (err) {
		console.error('Translation error:', err.message);
		if (err.stack) console.error('Stack:', err.stack);
		// Return original summary if translation fails
		return {
			summary: summary,
			narration: ''
		};
	}
}

/**
 * Translate global statistics and patient impact facts
 */
export async function translateGlobalStatsAndImpact(globalStatistics, patientImpactFacts, targetLanguage) {
	if (targetLanguage === 'en') {
		return {
			globalStatistics: globalStatistics,
			patientImpactFacts: patientImpactFacts
		};
	}

	const languageDisplay = languageName(targetLanguage);
	const prompt = `You are a professional medical translator. Translate the following global statistics and patient impact facts JSON into ${languageDisplay} (${targetLanguage === 'hi' ? 'हिंदी' : languageDisplay}).

CRITICAL REQUIREMENTS:
1. Translate ALL text content into ${languageDisplay} while preserving numbers, percentages, and statistics
2. Keep all numbers, percentages, and figures EXACTLY as they are (e.g., "422 million", "8.5%", "$327 billion")
3. Only translate descriptive text, not the numerical data
4. Preserve the JSON structure exactly - same keys, same array structure
5. Translate array items in patientImpactFacts - each item should be in ${languageDisplay}
6. Keep medical terms accurate - use standard ${languageDisplay} medical terminology

Return ONLY valid JSON with this exact structure:
{
  "global_statistics": {
    "global_prevalence": "translated text with numbers preserved (e.g., 'दुनिया भर में 422 मिलियन लोगों को प्रभावित करता है (8.5% वैश्विक जनसंख्या)')",
    "incidence_rate": "translated text with numbers preserved",
    "mortality_rate": "translated text with numbers preserved",
    "affected_regions": ["translated region 1 with numbers", "translated region 2 with numbers", ...],
    "age_groups": "translated text with numbers preserved",
    "gender_distribution": "translated text with numbers preserved",
    "economic_impact": "translated text with numbers preserved",
    "trends": "translated text with numbers preserved",
    "case_distribution": "translated text with numbers preserved"
  },
  "patient_impact_facts": {
    "lifestyle_impact": ["translated fact 1", "translated fact 2", ...],
    "work_impact": ["translated fact 1", "translated fact 2", ...],
    "family_impact": ["translated fact 1", "translated fact 2", ...],
    "financial_impact": ["translated fact 1", "translated fact 2", ...],
    "emotional_impact": ["translated fact 1", "translated fact 2", ...],
    "long_term_outlook": ["translated fact 1", "translated fact 2", ...],
    "quality_of_life": ["translated fact 1", "translated fact 2", ...],
    "precautions": ["translated fact 1", "translated fact 2", ...]
  }
}

Global Statistics JSON:
${JSON.stringify(globalStatistics || {}, null, 2)}

Patient Impact Facts JSON:
${JSON.stringify(patientImpactFacts || {}, null, 2)}`;

	try {
		const response = await generateAIResponse(
			[{ role: 'user', content: prompt }],
			`You are a professional medical translator specializing in ${languageDisplay}. Return ONLY valid JSON, no markdown, no code blocks. Preserve all numbers and statistics exactly.`,
			{ preferredProviders: ['openrouter', 'gemini', 'groq'], temperature: 0.2, maxTokens: 3000 }
		);

		if (!response || !response.content) {
			console.error('Translation: Empty response from AI for global stats');
			return {
				globalStatistics: globalStatistics,
				patientImpactFacts: patientImpactFacts
			};
		}

		const parsed = safeJsonParse(response.content);
		if (!parsed) {
			console.error('Translation parsing failed for global stats. Response:', response.content?.substring(0, 500));
			return {
				globalStatistics: globalStatistics,
				patientImpactFacts: patientImpactFacts
			};
		}

		// Map translated fields back to original structure
		const translatedGlobalStats = parsed.global_statistics || parsed.globalStatistics || {};
		const translatedPatientImpact = parsed.patient_impact_facts || parsed.patientImpactFacts || {};

		// Merge with original to ensure all fields are present
		const finalGlobalStats = {
			globalPrevalence: translatedGlobalStats.global_prevalence || translatedGlobalStats.globalPrevalence || globalStatistics?.globalPrevalence || '',
			incidenceRate: translatedGlobalStats.incidence_rate || translatedGlobalStats.incidenceRate || globalStatistics?.incidenceRate || '',
			mortalityRate: translatedGlobalStats.mortality_rate || translatedGlobalStats.mortalityRate || globalStatistics?.mortalityRate || '',
			affectedRegions: Array.isArray(translatedGlobalStats.affected_regions || translatedGlobalStats.affectedRegions) 
				? (translatedGlobalStats.affected_regions || translatedGlobalStats.affectedRegions)
				: (globalStatistics?.affectedRegions || []),
			ageGroups: translatedGlobalStats.age_groups || translatedGlobalStats.ageGroups || globalStatistics?.ageGroups || '',
			genderDistribution: translatedGlobalStats.gender_distribution || translatedGlobalStats.genderDistribution || globalStatistics?.genderDistribution || '',
			economicImpact: translatedGlobalStats.economic_impact || translatedGlobalStats.economicImpact || globalStatistics?.economicImpact || '',
			trends: translatedGlobalStats.trends || globalStatistics?.trends || '',
			caseDistribution: translatedGlobalStats.case_distribution || translatedGlobalStats.caseDistribution || globalStatistics?.caseDistribution || '',
			lastUpdated: globalStatistics?.lastUpdated || new Date()
		};

		const finalPatientImpact = {
			lifestyleImpact: Array.isArray(translatedPatientImpact.lifestyle_impact || translatedPatientImpact.lifestyleImpact)
				? (translatedPatientImpact.lifestyle_impact || translatedPatientImpact.lifestyleImpact)
				: (patientImpactFacts?.lifestyleImpact || []),
			workImpact: Array.isArray(translatedPatientImpact.work_impact || translatedPatientImpact.workImpact)
				? (translatedPatientImpact.work_impact || translatedPatientImpact.workImpact)
				: (patientImpactFacts?.workImpact || []),
			familyImpact: Array.isArray(translatedPatientImpact.family_impact || translatedPatientImpact.familyImpact)
				? (translatedPatientImpact.family_impact || translatedPatientImpact.familyImpact)
				: (patientImpactFacts?.familyImpact || []),
			financialImpact: Array.isArray(translatedPatientImpact.financial_impact || translatedPatientImpact.financialImpact)
				? (translatedPatientImpact.financial_impact || translatedPatientImpact.financialImpact)
				: (patientImpactFacts?.financialImpact || []),
			emotionalImpact: Array.isArray(translatedPatientImpact.emotional_impact || translatedPatientImpact.emotionalImpact)
				? (translatedPatientImpact.emotional_impact || translatedPatientImpact.emotionalImpact)
				: (patientImpactFacts?.emotionalImpact || []),
			longTermOutlook: Array.isArray(translatedPatientImpact.long_term_outlook || translatedPatientImpact.longTermOutlook)
				? (translatedPatientImpact.long_term_outlook || translatedPatientImpact.longTermOutlook)
				: (patientImpactFacts?.longTermOutlook || []),
			qualityOfLife: Array.isArray(translatedPatientImpact.quality_of_life || translatedPatientImpact.qualityOfLife)
				? (translatedPatientImpact.quality_of_life || translatedPatientImpact.qualityOfLife)
				: (patientImpactFacts?.qualityOfLife || []),
			precautions: Array.isArray(translatedPatientImpact.precautions)
				? translatedPatientImpact.precautions
				: (patientImpactFacts?.precautions || []),
			lastUpdated: patientImpactFacts?.lastUpdated || new Date()
		};

		return {
			globalStatistics: finalGlobalStats,
			patientImpactFacts: finalPatientImpact
		};
	} catch (err) {
		console.error('Translation error for global stats:', err.message);
		if (err.stack) console.error('Stack:', err.stack);
		// Return original if translation fails
		return {
			globalStatistics: globalStatistics,
			patientImpactFacts: patientImpactFacts
		};
	}
}

