// List available Gemini models for your API key
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey || apiKey === 'your_gemini_api_key_here') {
	console.error('❌ GEMINI_API_KEY not set in .env');
	process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
	try {
		// Try to get available models
		const models = await genAI.listModels();
		console.log('✅ Available models:');
		for await (const model of models) {
			console.log(`  - ${model.name}`);
		}
	} catch (err) {
		console.error('❌ Error listing models:', err.message);
		console.log('\n📋 Trying direct API call to test key...');
		
		// Try a simple test with different API versions
		const testModels = [
			'gemini-pro',
			'gemini-1.5-pro',
			'gemini-1.5-flash',
			'models/gemini-pro',
			'models/gemini-1.5-pro'
		];
		
		for (const modelName of testModels) {
			try {
				const model = genAI.getGenerativeModel({ model: modelName });
				const result = await model.generateContent('Hello');
				const response = await result.response;
				console.log(`✅ Model "${modelName}" works!`);
				console.log(`   Response: ${response.text().substring(0, 50)}...`);
				process.exit(0);
			} catch (e) {
				console.log(`❌ ${modelName}: ${e.message.substring(0, 100)}`);
			}
		}
		
		console.log('\n⚠️  No working models found. Possible issues:');
		console.log('   1. API key might be invalid');
		console.log('   2. API key might not have access to Gemini models');
		console.log('   3. Region/API restrictions');
		console.log('\n💡 Try getting a new API key from: https://aistudio.google.com/app/apikey');
	}
}

listModels();

