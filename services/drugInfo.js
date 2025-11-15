const RXNAV_BASE = 'https://rxnav.nlm.nih.gov/REST';
const OPEN_FDA_BASE = 'https://api.fda.gov/drug/label.json';
const DRUGBANK_BASE = 'https://api.drugbank.com/v1';

const memoryCache = new Map();

function cacheKey(prefix, identifier) {
	return `${prefix}:${identifier.toLowerCase()}`;
}

async function fetchJson(url, options = {}) {
	const response = await fetch(url, {
		...options,
		headers: {
			Accept: 'application/json',
			...(options.headers || {})
		}
	});
	if (!response.ok) {
		throw new Error(`Request failed (${response.status}): ${url}`);
	}
	return await response.json();
}

async function getRxNormData(drugName) {
	if (!drugName) return null;
	const key = cacheKey('rxnorm', drugName);
	if (memoryCache.has(key)) return memoryCache.get(key);

	try {
		const name = encodeURIComponent(drugName);
		const rxcuiResp = await fetchJson(`${RXNAV_BASE}/rxcui.json?name=${name}`);
		const rxCUI = rxcuiResp?.idGroup?.rxnormId?.[0] || null;
		let brandNames = [];

		if (rxCUI) {
			const related = await fetchJson(
				`${RXNAV_BASE}/rxcui/${rxCUI}/related.json?tty=BN`
			);
			brandNames =
				related?.relatedGroup?.conceptGroup
					?.flatMap((group) => group.conceptProperties || [])
					?.map((item) => item.name)
					?.filter(Boolean) || [];
		}

		const payload = { rxCUI, brandNames };
		memoryCache.set(key, payload);
		return payload;
	} catch (err) {
		console.warn(`RxNorm lookup failed for ${drugName}:`, err.message);
		return null;
	}
}

async function getOpenFDAWarnings(genericName) {
	if (!genericName) return null;
	const key = cacheKey('openfda', genericName);
	if (memoryCache.has(key)) return memoryCache.get(key);

	try {
		const query = encodeURIComponent(`openfda.generic_name:"${genericName}"`);
		const data = await fetchJson(`${OPEN_FDA_BASE}?search=${query}&limit=1`);
		const result = data?.results?.[0];
		if (!result) {
			memoryCache.set(key, null);
			return null;
		}

		const warnings = result.warnings || result['warnings_and_cautions'] || [];
		const adverseReactions = result['adverse_reactions'] || [];
		const indications = result.indications_and_usage || [];

		const payload = {
			labelId: result.id || '',
			warnings: Array.isArray(warnings) ? warnings : [warnings].filter(Boolean),
			adverseReactions: Array.isArray(adverseReactions)
				? adverseReactions
				: [adverseReactions].filter(Boolean),
			indications: Array.isArray(indications) ? indications : [indications].filter(Boolean),
			source: result['source'] || 'OpenFDA Drug Label'
		};
		memoryCache.set(key, payload);
		return payload;
	} catch (err) {
		console.warn(`OpenFDA lookup failed for ${genericName}:`, err.message);
		return null;
	}
}

async function getDrugBankInfo(drugName) {
	const apiKey = process.env.DRUGBANK_API_KEY;
	if (!apiKey) return null;

	const key = cacheKey('drugbank', drugName);
	if (memoryCache.has(key)) return memoryCache.get(key);

	try {
		const url = `${DRUGBANK_BASE}/drug_names?q=${encodeURIComponent(drugName)}`;
		const data = await fetchJson(url, {
			headers: {
				Authorization: apiKey
			}
		});
		const result = Array.isArray(data) ? data[0] : data;
		if (!result) {
			memoryCache.set(key, null);
			return null;
		}
		const payload = {
			name: result.name || drugName,
			description: result.description || '',
			mechanism: result.mechanism_of_action || '',
			dosageForms: result.dosages || [],
			interactions: result.drug_interactions || []
		};
		memoryCache.set(key, payload);
		return payload;
	} catch (err) {
		console.warn(`DrugBank lookup failed for ${drugName}:`, err.message);
		return null;
	}
}

export async function enrichMedications(medications = []) {
	const uniqueNames = Array.from(
		new Set(
			medications
				.filter(Boolean)
				.map((name) => String(name).trim())
				.filter(Boolean)
		)
	);

	const limited = uniqueNames.slice(0, 5);

	const results = [];
	for (const med of limited) {
		const [rxnorm, fda, drugbank] = await Promise.all([
			getRxNormData(med),
			getOpenFDAWarnings(med),
			getDrugBankInfo(med)
		]);

		const flipkartUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(`${med} medicine`)}`;
		const apolloUrl = `https://www.apollopharmacy.in/search-medicines/${encodeURIComponent(med)}`;
		const medisureUrl = `https://www.medisure.in/search?query=${encodeURIComponent(med)}`;

		// Generate concise 5-6 key points about what the medicine does
		let effectSummary = '';
		const effectPoints = [];
		
		// Helper to extract meaningful sentences (not too short, not too long)
		function extractKeySentences(text, maxSentences = 3) {
			if (!text || typeof text !== 'string') return [];
			// Split by sentence endings, filter meaningful ones
			const sentences = text
				.split(/[.!?]+/)
				.map(s => s.trim())
				.filter(s => s.length > 25 && s.length < 200) // Meaningful length
				.slice(0, maxSentences);
			return sentences;
		}
		
		// Priority 1: Mechanism of action (most important)
		if (drugbank?.mechanism) {
			const points = extractKeySentences(drugbank.mechanism, 3);
			effectPoints.push(...points);
		}
		
		// Priority 2: FDA indications (what it's used for)
		if (Array.isArray(fda?.indications) && fda.indications.length > 0) {
			const firstIndication = fda.indications[0];
			if (typeof firstIndication === 'string') {
				if (firstIndication.length > 100) {
					// Long indication - extract key sentences
					const points = extractKeySentences(firstIndication, 2);
					effectPoints.push(...points);
				} else {
					// Short indication - use as is
					effectPoints.push(firstIndication);
				}
			}
		}
		
		// Priority 3: Description (if we need more points)
		if (drugbank?.description && effectPoints.length < 4) {
			const points = extractKeySentences(drugbank.description, 2);
			effectPoints.push(...points);
		}
		
		// Limit to 5-6 points, remove duplicates, and format
		const uniquePoints = Array.from(new Set(effectPoints.map(p => p.toLowerCase())))
			.map(lower => effectPoints.find(p => p.toLowerCase() === lower))
			.filter(Boolean)
			.slice(0, 6);
		
		if (uniquePoints.length > 0) {
			// Format as a single string with separators for frontend to split
			effectSummary = uniquePoints
				.map(point => {
					const cleaned = point.trim().replace(/\s+/g, ' ');
					// Ensure it ends with punctuation
					return cleaned.match(/[.!?]$/) ? cleaned : cleaned + '.';
				})
				.join(' | '); // Use | as separator for frontend parsing
		} else {
			effectSummary = 'Consult your healthcare provider for detailed pharmacology and effects.';
		}

		results.push({
			name: med,
			rxCUI: rxnorm?.rxCUI || null,
			brandNames: rxnorm?.brandNames || [],
			fdaWarnings: fda?.warnings || [],
			fdaAdverseReactions: fda?.adverseReactions || [],
			fdaIndications: fda?.indications || [],
			drugBank: drugbank,
			effect: effectSummary,
			pharmacyLinks: [
				{ name: 'Flipkart Health+', url: flipkartUrl },
				{ name: 'Apollo Pharmacy', url: apolloUrl },
				{ name: 'Medisure', url: medisureUrl }
			],
			sources: [
				rxnorm?.rxCUI ? 'RxNorm' : null,
				fda ? 'OpenFDA' : null,
				drugbank ? 'DrugBank' : null
			].filter(Boolean)
		});
	}

	return results;
}

export { getRxNormData, getOpenFDAWarnings, getDrugBankInfo };


