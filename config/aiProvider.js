// Multi-Provider AI System with Automatic Fallback
// Priority: Gemini (medical) → Groq (fast) → Hugging Face (backup)
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

// Provider configuration
const PROVIDERS = {
	GEMINI: 'gemini',
	GROQ: 'groq',
	HUGGINGFACE: 'huggingface',
	OPENAI: 'openai',
	OPENROUTER: 'openrouter',
	PERPLEXITY: 'perplexity'
};

// Get OpenRouter clients (supports multiple keys)
function getOpenRouterClient(modelType = 'gemini') {
	// Primary OpenRouter key (for Gemini)
	const primaryKey = process.env.GEMINI_API_KEY;
	// Secondary OpenRouter key (for Anthropic/Claude)
	const secondaryKey = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY;
	// Perplexity key (might be OpenRouter format)
	const perplexityKey = process.env.PERPLEXITY_API_KEY;
	
	// Check for Perplexity via OpenRouter
	if (modelType === 'perplexity' && perplexityKey && perplexityKey.startsWith('sk-or-v1-')) {
		return { isOpenRouter: true, apiKey: perplexityKey.trim() };
	}
	
	if (modelType === 'gemini' && primaryKey && primaryKey.startsWith('sk-or-v1-')) {
		return { isOpenRouter: true, apiKey: primaryKey.trim() };
	}
	
	if (modelType === 'anthropic' && secondaryKey && secondaryKey.startsWith('sk-or-v1-')) {
		return { isOpenRouter: true, apiKey: secondaryKey.trim() };
	}
	
	// Fallback to primary key if secondary not available
	if (primaryKey && primaryKey.startsWith('sk-or-v1-')) {
		return { isOpenRouter: true, apiKey: primaryKey.trim() };
	}
	
	return null;
}

// Get provider clients
function getGeminiClient() {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
		return null;
	}
	
	// Check if it's an OpenRouter key (starts with sk-or-v1-)
	if (apiKey.trim().startsWith('sk-or-v1-')) {
		// Use OpenRouter instead of direct Gemini API
		return { isOpenRouter: true, apiKey: apiKey.trim() };
	}
	
	// Standard Gemini API key
	return new GoogleGenerativeAI(apiKey.trim());
}

function getGroqClient() {
	const apiKey = process.env.GROQ_API_KEY;
	if (!apiKey || apiKey === 'your_groq_api_key_here' || apiKey.trim() === '') {
		return null;
	}
	return new Groq({ apiKey: apiKey.trim() });
}

function getOpenAIClient() {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey || apiKey === 'your_openai_api_key_here') {
		return null;
	}
	return new OpenAI({ apiKey });
}

// Generate response with automatic fallback
export async function generateAIResponse(messages, systemPrompt = null, options = {}) {
	const { preferredProviders = [], temperature = 0.2, maxTokens = 4000, model = null } = options;

	const providers = getAvailableProviders(preferredProviders);
	
	if (providers.length === 0) {
		// Diagnostic: Check what API keys are set
		const keys = {
			GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'set' : 'not set',
			GROQ_API_KEY: process.env.GROQ_API_KEY ? 'set' : 'not set',
			OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'set' : 'not set',
			HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY ? 'set' : 'not set'
		};
		console.error('❌ No AI providers available. API key status:', keys);
		throw new Error('No AI providers configured. Please set at least one API key in server/.env');
	}
	
	console.log(`🔍 Available providers: ${providers.map(p => p.name).join(', ')}`);
	let lastError = null;
	const errors = [];
	
	// Try each provider in order
	for (const provider of providers) {
		try {
			console.log(`🤖 Trying ${provider.name}${model ? ` (${model})` : ` (${provider.model})`}...`);
			const result = await callProvider(provider.name, messages, systemPrompt, {
				temperature,
				maxTokens,
				model: model || provider.model
			});
			const actualModel = model || provider.model;
			console.log(`✅ Successfully used ${provider.name} (${actualModel})`);
			return {
				content: result,
				provider: provider.name,
				model: actualModel
			};
		} catch (err) {
			lastError = err;
			const errorMsg = err.message || err.toString();
			const errorInfo = {
				provider: provider.name,
				error: errorMsg.substring(0, 200),
				code: err.code,
				status: err.response?.status,
				statusText: err.response?.statusText
			};
			errors.push(errorInfo);
			console.log(`❌ ${provider.name} failed: ${errorMsg.substring(0, 200)}`);
			
			// Log full error in development
			if (process.env.NODE_ENV === 'development') {
				console.error(`Full error for ${provider.name}:`, {
					message: err.message,
					stack: err.stack?.split('\n').slice(0, 5).join('\n'),
					response: err.response ? {
						status: err.response.status,
						statusText: err.response.statusText,
						data: err.response.data
					} : null
				});
			}
			
			// If it's a rate limit, try next provider immediately
			if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests') || errorMsg.includes('Quota exceeded') || errorMsg.includes('rate limit')) {
				console.log(`⏭️  Rate limit on ${provider.name}, trying next provider...`);
				continue;
			}
			
			// If it's a critical error (invalid key), skip this provider
			if (errorMsg.includes('API key') || errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('invalid') || errorMsg.includes('Unauthorized') || errorMsg.includes('authentication')) {
				console.log(`⚠️  ${provider.name} has authentication issues, skipping...`);
				continue;
			}
			
			// For other errors, try next provider
			continue;
		}
	}
	
	// All providers failed - provide detailed error message
	console.error('❌ All AI providers failed. Error summary:');
	errors.forEach((err, idx) => {
		console.error(`  ${idx + 1}. ${err.provider}: ${err.error}`);
		if (err.status) console.error(`     Status: ${err.status} ${err.statusText || ''}`);
	});
	
	const errorDetails = lastError ? {
		message: lastError.message,
		code: lastError.code,
		status: lastError.response?.status,
		statusText: lastError.response?.statusText
	} : { message: 'Unknown error' };
	
	throw new Error(`All AI providers failed. Please check your API keys and try again. The system tried all available providers but none succeeded. Last error: ${lastError?.message || 'Unknown error'}`);
}

// Get list of available providers in priority order
function getAvailableProviders(preferredOrder = []) {
	const providers = [];
	
	// 1. Gemini (best for medical content) - supports both direct API and OpenRouter
	if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here') {
		const client = getGeminiClient();
		if (client) {
			// Determine if using OpenRouter or direct API
			const isOpenRouter = client.isOpenRouter === true;
			providers.push({
				name: isOpenRouter ? PROVIDERS.OPENROUTER : PROVIDERS.GEMINI,
				model: isOpenRouter 
					? (process.env.GEMINI_MODEL || 'google/gemini-2.0-flash-exp')
					: (process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'),
				client: client,
				apiKey: isOpenRouter ? client.apiKey : null
			});
		}
	}
	
	// 2. Groq (fast, high free tier)
	if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here') {
		providers.push({
			name: PROVIDERS.GROQ,
			model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
			client: getGroqClient()
		});
	}
	
	// 3. Hugging Face (backup)
	if (process.env.HUGGINGFACE_API_KEY && process.env.HUGGINGFACE_API_KEY !== 'your_huggingface_api_key_here') {
		providers.push({
			name: PROVIDERS.HUGGINGFACE,
			model: process.env.HUGGINGFACE_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2',
			client: null // Hugging Face uses REST API
		});
	}
	
	// 4. OpenAI (if configured)
	if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
		providers.push({
			name: PROVIDERS.OPENAI,
			model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
			client: getOpenAIClient()
		});
	}
	
	// 5. Perplexity (if configured - check if it's OpenRouter key or direct API)
	const perplexityKey = process.env.PERPLEXITY_API_KEY;
	if (perplexityKey && perplexityKey !== 'your_perplexity_api_key_here') {
		// Check if it's an OpenRouter key
		if (perplexityKey.startsWith('sk-or-v1-')) {
			// Use OpenRouter to access Perplexity models
			const openRouterClient = getOpenRouterClient('perplexity');
			if (openRouterClient) {
				providers.push({
					name: PROVIDERS.OPENROUTER,
					model: process.env.PERPLEXITY_MODEL || 'perplexity/llama-3.1-sonar-large-32k-online',
					client: openRouterClient,
					apiKey: openRouterClient.apiKey
				});
			}
		} else {
			// Direct Perplexity API
			providers.push({
				name: PROVIDERS.PERPLEXITY,
				model: process.env.PERPLEXITY_MODEL || 'llama-3.1-sonar-large-32k-online',
				client: null // Perplexity uses REST API
			});
		}
	}
	
	if (preferredOrder.length === 0) {
		return providers;
	}

	// Reorder based on preferred order while keeping only available ones
	const orderMap = new Map(preferredOrder.map((name, index) => [name, index]));
	return [...providers].sort((a, b) => {
		const aRank = orderMap.has(a.name) ? orderMap.get(a.name) : Number.MAX_SAFE_INTEGER;
		const bRank = orderMap.has(b.name) ? orderMap.get(b.name) : Number.MAX_SAFE_INTEGER;
		return aRank - bRank;
	});
}

// Call specific provider
async function callProvider(providerName, messages, systemPrompt, options) {
	switch (providerName) {
		case PROVIDERS.GEMINI:
			return await callGemini(messages, systemPrompt, options);
		case PROVIDERS.OPENROUTER:
			return await callOpenRouter(messages, systemPrompt, options);
		case PROVIDERS.GROQ:
			return await callGroq(messages, systemPrompt, options);
		case PROVIDERS.HUGGINGFACE:
			return await callHuggingFace(messages, systemPrompt, options);
		case PROVIDERS.OPENAI:
			return await callOpenAI(messages, systemPrompt, options);
		case PROVIDERS.PERPLEXITY:
			return await callPerplexity(messages, systemPrompt, options);
		default:
			throw new Error(`Unknown provider: ${providerName}`);
	}
}

// OpenRouter implementation (supports multiple models via OpenRouter)
async function callOpenRouter(messages, systemPrompt, options = {}) {
	// Determine which API key and model to use
	const requestedModel = options.model || process.env.GEMINI_MODEL || 'google/gemini-2.0-flash-exp';
	
	// Check if requesting Perplexity model - use PERPLEXITY_API_KEY if it's OpenRouter format
	let apiKey = null;
	if (requestedModel.includes('perplexity')) {
		const perplexityKey = process.env.PERPLEXITY_API_KEY;
		if (perplexityKey && perplexityKey.startsWith('sk-or-v1-')) {
			apiKey = perplexityKey;
		} else {
			apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
		}
	} else if (requestedModel.includes('anthropic') || requestedModel.includes('claude')) {
		apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
	} else {
		apiKey = process.env.GEMINI_API_KEY;
	}
	
	if (!apiKey) {
		const keySource = requestedModel.includes('perplexity')
			? 'PERPLEXITY_API_KEY'
			: requestedModel.includes('anthropic') || requestedModel.includes('claude')
			? 'ANTHROPIC_API_KEY or OPENROUTER_API_KEY'
			: 'GEMINI_API_KEY';
		throw new Error(`OpenRouter API key not configured - ${keySource} is missing or empty`);
	}
	if (!apiKey.startsWith('sk-or-v1-')) {
		throw new Error(`OpenRouter API key format invalid - key should start with 'sk-or-v1-' but starts with: ${apiKey.substring(0, Math.min(15, apiKey.length))}...`);
	}
	
	const model = requestedModel;
	const { temperature = 0.2, maxTokens = 4000 } = options;
	
	// Build message array (OpenRouter uses OpenAI-compatible format)
	const messageArray = [];
	if (systemPrompt) {
		messageArray.push({ role: 'system', content: systemPrompt });
	}
	messageArray.push(...messages);
	
	try {
		const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': process.env.CLIENT_ORIGIN || 'http://localhost:5173',
				'X-Title': 'MedEase - Medical Report Analysis'
			},
			body: JSON.stringify({
				model: model,
				messages: messageArray,
				temperature: Math.max(0, Math.min(2, temperature)), // Clamp between 0-2
				max_tokens: Math.max(1, Math.min(32000, maxTokens)) // Clamp between 1-32000
			})
		});
		
		if (!response.ok) {
			let errorText = '';
			try {
				const errorData = await response.json();
				errorText = errorData.error?.message || errorData.message || JSON.stringify(errorData);
			} catch {
				errorText = await response.text();
			}
			
			// Handle specific error codes
			if (response.status === 400) {
				throw new Error(`OpenRouter bad request (400): ${errorText.substring(0, 200)}. Check model name and request format.`);
			}
			if (response.status === 401 || response.status === 403) {
				throw new Error(`OpenRouter authentication failed (${response.status}): Invalid API key.`);
			}
			if (response.status === 429) {
				throw new Error(`OpenRouter rate limit (429): ${errorText.substring(0, 200)}`);
			}
			
			throw new Error(`OpenRouter API error (${response.status}): ${errorText.substring(0, 200)}`);
		}
		
		const data = await response.json();
		const content = data.choices?.[0]?.message?.content;
		
		if (!content || content.trim().length === 0) {
			throw new Error('OpenRouter returned empty response');
		}
		
		return content;
	} catch (err) {
		// Try fallback models if model not found
		if (err.message?.includes('404') || err.message?.includes('not found') || err.message?.includes('model')) {
			const fallbackModels = model.includes('perplexity')
				? [
					'perplexity/llama-3.1-sonar-large-32k-online',
					'perplexity/llama-3.1-sonar-huge-128k-online',
					'perplexity/llama-3.1-sonar-small-32k-online',
					'google/gemini-2.0-flash-exp' // Fallback to Gemini if Perplexity unavailable
				]
				: model.includes('anthropic') || model.includes('claude')
				? [
					'anthropic/claude-3-haiku',
					'anthropic/claude-3-opus',
					'google/gemini-2.0-flash-exp' // Fallback to Gemini if Claude unavailable
				]
				: [
					'google/gemini-2.0-flash',
					'google/gemini-pro',
					'google/gemini-flash-1.5',
					'anthropic/claude-3-haiku' // Fallback to Claude if Gemini unavailable
				];
			
			for (const fallbackModel of fallbackModels) {
				if (fallbackModel === model) continue;
				try {
					const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${apiKey}`,
							'Content-Type': 'application/json',
							'HTTP-Referer': process.env.CLIENT_ORIGIN || 'http://localhost:5173',
							'X-Title': 'MedEase - Medical Report Analysis'
						},
						body: JSON.stringify({
							model: fallbackModel,
							messages: messageArray,
							temperature: Math.max(0, Math.min(2, temperature)), // Clamp between 0-2
							max_tokens: Math.max(1, Math.min(32000, maxTokens)) // Clamp between 1-32000
						})
					});
					
					if (response.ok) {
						const data = await response.json();
						const content = data.choices?.[0]?.message?.content;
						if (content && content.trim().length > 0) {
							return content;
						}
					} else if (response.status === 400) {
						// Bad request - don't try more fallbacks for this model type
						console.log(`  Model ${fallbackModel} returned 400, skipping remaining fallbacks`);
						break;
					}
				} catch {
					continue;
				}
			}
		}
		throw err;
	}
}

// Gemini implementation (direct API)
async function callGemini(messages, systemPrompt, options = {}) {
	const genAI = getGeminiClient();
	if (!genAI || genAI.isOpenRouter) {
		throw new Error('Gemini client not available');
	}
	
	const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
	const { temperature = 0.2, maxTokens = 4000 } = options;

	const generationConfig = { temperature, maxOutputTokens: maxTokens };
	const geminiModel = genAI.getGenerativeModel({ model, generationConfig });
	
	// Combine system prompt and messages
	let fullPrompt = '';
	if (systemPrompt) {
		fullPrompt += systemPrompt + '\n\n';
	}
	
	for (const msg of messages) {
		if (msg.role === 'user') {
			fullPrompt += msg.content + '\n';
		} else if (msg.role === 'assistant') {
			fullPrompt += 'Assistant: ' + msg.content + '\n';
		}
	}
	
	try {
		const result = await geminiModel.generateContent({
			contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
			generationConfig
		});
		const response = await result.response;
		const text = response.text();
		if (!text || text.trim().length === 0) {
			throw new Error('Gemini returned empty response');
		}
		return text;
	} catch (err) {
		// Try fallback models if 404
		if (err.message?.includes('404') || err.message?.includes('not found')) {
			const fallbackModels = [
				'gemini-2.0-flash',
				'gemini-2.5-flash',
				'gemini-2.5-pro',
				'gemini-2.0-flash-lite'
			];
			
			for (const fallbackModelName of fallbackModels) {
				if (fallbackModelName === model) continue;
				try {
					const fallbackModel = genAI.getGenerativeModel({ model: fallbackModelName });
					const result = await fallbackModel.generateContent(fullPrompt);
					const response = await result.response;
					const text = response.text();
					if (text && text.trim().length > 0) {
						return text;
					}
				} catch {
					continue;
				}
			}
		}
		throw err;
	}
}

// Groq implementation
async function callGroq(messages, systemPrompt, options = {}) {
	const groq = getGroqClient();
	if (!groq) {
		throw new Error('Groq client not available');
	}
	
	// Try multiple Groq models in order
	const models = [
		process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
		'llama-3.3-70b-versatile',
		'llama-3.1-8b-instant',
		'llama-3.1-70b-versatile',
		'llama-3-8b-8192',
		'mixtral-8x7b-32768'
	];
	
	let lastError = null;
	for (const model of models) {
		try {
	
			const messageArray = [];
			if (systemPrompt) {
				messageArray.push({ role: 'system', content: systemPrompt });
			}
			messageArray.push(...messages);
			
			const completion = await groq.chat.completions.create({
				model,
				messages: messageArray,
				temperature: options.temperature ?? 0.2,
				max_tokens: options.maxTokens ?? 4000
			});
			
			return completion.choices?.[0]?.message?.content || '{}';
		} catch (err) {
			lastError = err;
			if (err.message?.includes('decommissioned') || err.message?.includes('not found') || err.message?.includes('404')) {
				console.log(`  Model ${model} not available, trying next...`);
				continue;
			}
			throw err;
		}
	}
	
	throw new Error(`All Groq models failed: ${lastError?.message || 'Unknown error'}`);
}

// Hugging Face implementation (REST API)
async function callHuggingFace(messages, systemPrompt, options = {}) {
	const apiKey = process.env.HUGGINGFACE_API_KEY;
	if (!apiKey || apiKey === 'your_huggingface_api_key_here') {
		throw new Error('Hugging Face API key not configured');
	}
	
	// Try multiple Hugging Face models
	const models = [
		process.env.HUGGINGFACE_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2',
		'mistralai/Mistral-7B-Instruct-v0.2',
		'meta-llama/Llama-2-7b-chat-hf',
		'google/flan-t5-large'
	];
	
	let lastError = null;
	for (const model of models) {
		try {
			// Build messages into prompt
			let prompt = '';
			if (systemPrompt) {
				prompt += systemPrompt + '\n\n';
			}
			for (const msg of messages) {
				if (msg.role === 'user') {
					prompt += msg.content + '\n';
				}
			}
			
			const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					inputs: prompt,
					parameters: {
						max_new_tokens: Math.min(options.maxTokens ?? 2000, 2000),
						temperature: options.temperature ?? 0.2,
						return_full_text: false
					}
				})
			});
			
			if (!response.ok) {
				if (response.status === 410 || response.status === 404) {
					console.log(`  Model ${model} not available (${response.status}), trying next...`);
					lastError = new Error(`Model ${model} not available`);
					continue;
				}
				const error = await response.text();
				throw new Error(`Hugging Face API error: ${response.status} - ${error}`);
			}
			
			const data = await response.json();
			
			// Handle different response formats
			if (Array.isArray(data) && data[0]?.generated_text) {
				return data[0].generated_text.trim();
			} else if (data.generated_text) {
				return data.generated_text.trim();
			} else if (typeof data === 'string') {
				return data.trim();
			}
			
			throw new Error('Unexpected Hugging Face response format');
		} catch (err) {
			lastError = err;
			if (err.message?.includes('410') || err.message?.includes('404') || err.message?.includes('not available')) {
				console.log(`  Model ${model} failed, trying next...`);
				continue;
			}
			throw err;
		}
	}
	
	throw new Error(`All Hugging Face models failed: ${lastError?.message || 'Unknown error'}`);
}

// Perplexity implementation (REST API)
async function callPerplexity(messages, systemPrompt, options = {}) {
	const apiKey = process.env.PERPLEXITY_API_KEY;
	if (!apiKey || apiKey === 'your_perplexity_api_key_here' || apiKey.trim() === '') {
		throw new Error('Perplexity API key not configured');
	}
	
	const model = process.env.PERPLEXITY_MODEL || 'llama-3.1-sonar-large-32k-online';
	
	try {
		// Build messages array
		const messageArray = [];
		if (systemPrompt) {
			messageArray.push({ role: 'system', content: systemPrompt });
		}
		messageArray.push(...messages);
		
		const response = await fetch('https://api.perplexity.ai/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey.trim()}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: model,
				messages: messageArray,
				temperature: options.temperature ?? 0.2,
				max_tokens: options.maxTokens ?? 4000
			})
		});
		
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
		}
		
		const data = await response.json();
		return data.choices?.[0]?.message?.content || '{}';
	} catch (err) {
		throw new Error(`Perplexity API failed: ${err.message}`);
	}
}

// OpenAI implementation
async function callOpenAI(messages, systemPrompt, options = {}) {
	const openai = getOpenAIClient();
	if (!openai) {
		throw new Error('OpenAI client not available');
	}
	
	const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
	
	const messageArray = [];
	if (systemPrompt) {
		messageArray.push({ role: 'system', content: systemPrompt });
	}
	messageArray.push(...messages);
	
	const completion = await openai.chat.completions.create({
		model,
		messages: messageArray,
		temperature: options.temperature ?? 0.2,
		max_tokens: options.maxTokens ?? 4000
	});
	
	return completion.choices?.[0]?.message?.content || '{}';
}

// Get provider status for health check
export function getProviderStatus() {
	const providers = getAvailableProviders();
	const geminiKey = process.env.GEMINI_API_KEY;
	const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY;
	const isOpenRouter = geminiKey && geminiKey.startsWith('sk-or-v1-');
	const hasAnthropic = anthropicKey && anthropicKey.startsWith('sk-or-v1-');
	
	return {
		available: providers.map(p => p.name),
		gemini: geminiKey && geminiKey !== 'your_gemini_api_key_here' 
			? (isOpenRouter ? 'configured (via OpenRouter)' : 'configured') 
			: 'not configured',
		anthropic: hasAnthropic ? 'configured (via OpenRouter)' : 'not configured',
		openrouter: isOpenRouter || hasAnthropic ? 'configured' : 'not configured',
		groq: process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here' ? 'configured' : 'not configured',
		huggingface: process.env.HUGGINGFACE_API_KEY && process.env.HUGGINGFACE_API_KEY !== 'your_huggingface_api_key_here' ? 'configured' : 'not configured',
		openai: process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' ? 'configured' : 'not configured',
		consensus: (isOpenRouter || hasAnthropic) && (process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY) ? 'enabled' : 'partial'
	};
}

export { PROVIDERS };
