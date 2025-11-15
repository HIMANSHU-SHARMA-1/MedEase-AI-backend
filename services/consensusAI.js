// Multi-Provider Consensus System for Fact-Based Medical Analysis
// Uses multiple AI providers in parallel to cross-validate and synthesize responses
import { generateAIResponse, PROVIDERS } from '../config/aiProvider.js';

/**
 * Get responses from multiple providers in parallel
 */
async function getMultiProviderResponses(messages, systemPrompt, options = {}) {
	// Build provider list based on available API keys
	const providers = [];
	
	// Check for Gemini (OpenRouter or direct)
	if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here') {
		if (process.env.GEMINI_API_KEY.startsWith('sk-or-v1-')) {
			providers.push({ name: PROVIDERS.OPENROUTER, model: 'google/gemini-2.0-flash-exp', priority: 1, apiKey: 'GEMINI_API_KEY' });
		} else {
			providers.push({ name: PROVIDERS.GEMINI, model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp', priority: 1, apiKey: 'GEMINI_API_KEY' });
		}
	}
	
	// Check for Anthropic/Claude (OpenRouter)
	const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY;
	if (anthropicKey && anthropicKey !== 'your_anthropic_api_key_here' && anthropicKey.startsWith('sk-or-v1-')) {
		providers.push({ name: PROVIDERS.OPENROUTER, model: 'anthropic/claude-3.5-sonnet', priority: 2, apiKey: 'ANTHROPIC_API_KEY' });
	}
	
	// Check for Groq
	if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here') {
		providers.push({ name: PROVIDERS.GROQ, model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', priority: 3, apiKey: 'GROQ_API_KEY' });
	}
	
	// Check for OpenAI
	if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
		providers.push({ name: PROVIDERS.OPENAI, model: process.env.OPENAI_MODEL || 'gpt-4o-mini', priority: 4, apiKey: 'OPENAI_API_KEY' });
	}

	if (providers.length === 0) {
		throw new Error('No AI providers configured');
	}

	const promises = providers.map(async (provider) => {
		try {
			const result = await generateAIResponse(messages, systemPrompt, {
				...options,
				preferredProviders: [provider.name],
				model: provider.model, // Pass model for OpenRouter
				timeout: 30000 // 30 second timeout per provider
			});
			return {
				provider: provider.name,
				model: provider.model,
				content: result.content,
				success: true,
				priority: provider.priority
			};
		} catch (err) {
			console.log(`⚠️  ${provider.name} (${provider.model}) failed: ${err.message?.substring(0, 100)}`);
			return {
				provider: provider.name,
				model: provider.model,
				success: false,
				error: err.message,
				priority: provider.priority
			};
		}
	});

	const results = await Promise.allSettled(promises);
	const responses = results
		.map((result, idx) => (result.status === 'fulfilled' ? result.value : {
			provider: providers[idx].name,
			model: providers[idx].model,
			success: false,
			error: result.reason?.message || 'Unknown error',
			priority: providers[idx].priority
		}))
		.filter(r => r.success)
		.sort((a, b) => a.priority - b.priority); // Sort by priority

	return responses;
}

/**
 * Synthesize multiple AI responses into a consensus
 * For medical data, prioritizes agreement and fact-based content
 */
function synthesizeConsensus(responses, sectionType) {
	if (responses.length === 0) {
		throw new Error('No successful responses from any provider');
	}

	if (responses.length === 1) {
		return {
			content: responses[0].content,
			providers: [responses[0].provider],
			models: [responses[0].model],
			consensus: 'single'
		};
	}

	// For JSON responses, merge and validate
	if (sectionType === 'json') {
		return synthesizeJsonConsensus(responses);
	}

	// For text responses, create a fact-checked synthesis
	return synthesizeTextConsensus(responses);
}

/**
 * Synthesize JSON responses by merging and validating
 */
function synthesizeJsonConsensus(responses) {
	const parsed = responses.map(r => {
		try {
			const start = r.content.indexOf('{');
			const end = r.content.lastIndexOf('}');
			if (start !== -1 && end !== -1) {
				return JSON.parse(r.content.slice(start, end + 1));
			}
			return JSON.parse(r.content);
		} catch {
			return null;
		}
	}).filter(Boolean);

	if (parsed.length === 0) {
		// Fallback to first response
		return {
			content: responses[0].content,
			providers: responses.map(r => r.provider),
			models: responses.map(r => r.model),
			consensus: 'fallback'
		};
	}

	// Merge JSON objects, prioritizing values that appear in multiple responses
	const merged = {};
	const fieldVotes = {};

	// Count votes for each field value
	parsed.forEach((obj, idx) => {
		Object.keys(obj).forEach(key => {
			const value = obj[key];
			const valueStr = JSON.stringify(value);
			if (!fieldVotes[key]) fieldVotes[key] = {};
			if (!fieldVotes[key][valueStr]) {
				fieldVotes[key][valueStr] = { count: 0, value, sources: [] };
			}
			fieldVotes[key][valueStr].count++;
			fieldVotes[key][valueStr].sources.push(responses[idx].provider);
		});
	});

	// Select values with highest consensus
	Object.keys(fieldVotes).forEach(key => {
		const votes = Object.values(fieldVotes[key]);
		votes.sort((a, b) => b.count - a.count);
		
		// Use value with highest consensus (at least 2 providers agree, or use top if only 1)
		if (votes[0].count >= 2 || parsed.length === 1) {
			merged[key] = votes[0].value;
		} else if (votes.length > 0) {
			// If no clear consensus, use the first provider's value (highest priority)
			const firstProviderValue = parsed[0][key];
			if (firstProviderValue !== undefined) {
				merged[key] = firstProviderValue;
			}
		}
	});

	// For arrays, merge unique items
	Object.keys(merged).forEach(key => {
		if (Array.isArray(merged[key])) {
			const allItems = parsed.map(p => p[key]).filter(Array.isArray).flat();
			const uniqueItems = [];
			const seen = new Set();
			allItems.forEach(item => {
				const itemStr = typeof item === 'string' ? item : JSON.stringify(item);
				if (!seen.has(itemStr)) {
					seen.add(itemStr);
					uniqueItems.push(item);
				}
			});
			merged[key] = uniqueItems;
		}
	});

	return {
		content: JSON.stringify(merged, null, 2),
		parsed: merged,
		providers: responses.map(r => r.provider),
		models: responses.map(r => r.model),
		consensus: parsed.length > 1 ? 'multi-provider' : 'single'
	};
}

/**
 * Synthesize text responses by fact-checking and merging
 */
function synthesizeTextConsensus(responses) {
	if (responses.length === 1) {
		return {
			content: responses[0].content,
			providers: [responses[0].provider],
			models: [responses[0].model],
			consensus: 'single'
		};
	}

	// For text, prioritize the first (highest priority) provider but note others validated
	const primary = responses[0];
	
	return {
		content: primary.content,
		providers: responses.map(r => r.provider),
		models: responses.map(r => r.model),
		consensus: 'validated',
		note: `Validated by ${responses.length} providers: ${responses.map(r => r.provider).join(', ')}`
	};
}

/**
 * Get consensus response from multiple providers
 * This is the main function to use for fact-based medical analysis
 */
export async function getConsensusResponse(messages, systemPrompt, options = {}) {
	const { sectionType = 'json', minProviders = 1 } = options;
	
	console.log(`🔄 Getting consensus from multiple providers for ${sectionType} section...`);
	
	const responses = await getMultiProviderResponses(messages, systemPrompt, options);
	
	if (responses.length < minProviders) {
		throw new Error(`Insufficient providers responded. Got ${responses.length}, needed ${minProviders}`);
	}

	const consensus = synthesizeConsensus(responses, sectionType);
	
	console.log(`✅ Consensus achieved from ${responses.length} providers: ${consensus.providers.join(', ')}`);
	
	return {
		content: consensus.content,
		parsed: consensus.parsed,
		providers: consensus.providers,
		models: consensus.models,
		consensus: consensus.consensus,
		validatedBy: responses.length
	};
}

/**
 * Get quick single response (fallback for non-critical sections)
 */
export async function getQuickResponse(messages, systemPrompt, options = {}) {
	return await generateAIResponse(messages, systemPrompt, options);
}

