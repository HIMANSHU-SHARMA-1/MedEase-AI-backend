// Test script to find available Gemini models
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey || apiKey === 'your_gemini_api_key_here') {
	console.error('❌ GEMINI_API_KEY not set in .env');
	process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const modelsToTest = [
	'gemini-1.5-flash-latest',
	'gemini-1.5-pro-latest',
	'gemini-1.5-flash',
	'gemini-1.5-pro',
	'gemini-pro'
];

console.log('🧪 Testing Gemini models...\n');

for (const modelName of modelsToTest) {
	try {
		console.log(`Testing: ${modelName}...`);
		const model = genAI.getGenerativeModel({ model: modelName });
		const result = await model.generateContent('Say "Hello" in JSON format: {"message": "hello"}');
		const response = await result.response;
		const text = response.text();
		console.log(`✅ ${modelName} - WORKING!`);
		console.log(`   Response: ${text.substring(0, 100)}...\n`);
		break; // Found a working model
	} catch (err) {
		console.log(`❌ ${modelName} - Failed: ${err.message}\n`);
	}
}

