import { generateAIResponse } from '../config/aiProvider.js';

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

function buildPrompt(diseaseName, region) {
	return `You are a healthcare navigator with access to verified medical directories. Recommend up to four medical specialists in ${region} who are qualified to treat "${diseaseName}".

SPECIALIST SELECTION CRITERIA:
1. Match the specialist type to the disease (e.g., Nephrologist for kidney disease, Cardiologist for heart conditions)
2. Prioritize specialists from:
   - Accredited hospitals (JCI, NABH, or equivalent)
   - Medical colleges/teaching hospitals
   - Recognized medical centers
   - Board-certified practitioners
3. Include diverse geographic locations within ${region} when possible
4. Verify credentials are publicly verifiable

FOR EACH SPECIALIST PROVIDE:
- name: Full name (Dr. [Name] if applicable)
- speciality: Exact medical specialty (e.g., "Nephrologist", "Endocrinologist", "Cardiologist")
- hospital: Full hospital/clinic name (prefer well-known institutions)
- city: Specific city name within ${region}
- contact: Phone number or appointment booking URL (only if publicly available)
- google_maps_query: Searchable phrase for Google Maps (e.g., "Dr. [Name] [Speciality] [Hospital] [City]")

IMPORTANT:
- Only include real, verifiable specialists
- Do not make up names or credentials
- If you cannot find verified specialists, return an empty array
- Focus on specialists who actually treat this condition (not general practitioners unless appropriate)

Return JSON: { "specialists": [ { "name": "", "speciality": "", "hospital": "", "city": "", "contact": "", "google_maps_query": "" } ] }.
Be factual and accurate - only include specialists you can verify exist.`;
}

export async function fetchSpecialists(diseaseName, region = 'India') {
	try {
		const response = await generateAIResponse(
			[{ role: 'user', content: buildPrompt(diseaseName, region) }],
			'Return valid JSON only.',
			{ preferredProviders: ['gemini', 'groq'], temperature: 0.2, maxTokens: 1200 }
		);
		const parsed = safeJsonParse(response.content) || {};
		const list = Array.isArray(parsed.specialists) ? parsed.specialists : [];
		const now = new Date();
		return list
			.filter((item) => item?.name && item?.speciality)
			.map((item) => {
				const query =
					item.google_maps_query ||
					`${item.speciality} ${item.hospital || ''} ${item.city || ''} ${diseaseName}`;
				return {
					name: item.name,
					speciality: item.speciality,
					hospital: item.hospital || '',
					city: item.city || '',
					contact: item.contact || '',
					mapUrl: `https://www.google.com/maps/search/${encodeURIComponent(query.trim())}`,
					refreshedAt: now
				};
			});
	} catch (err) {
		console.warn('Specialist lookup failed:', err.message);
		return [];
	}
}

