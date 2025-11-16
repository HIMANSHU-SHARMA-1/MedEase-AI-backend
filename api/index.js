import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { getProviderStatus } from '../config/aiProvider.js';
import authRoutes from '../routes/authRoutes.js';
import uploadRoutes from '../routes/uploadRoutes.js';
import aiRoutes from '../routes/aiRoutes.js';
import diseaseRoutes from '../routes/diseaseRoutes.js';
import adminRoutes from '../routes/adminRoutes.js';
import { apiLimiter } from '../middlewares/rateLimiter.js';

const app = express();

// Basic middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS - simplified for Vercel
app.use((req, res, next) => {
	const origin = req.headers.origin;
	const allowedOrigins = process.env.CLIENT_ORIGIN 
		? process.env.CLIENT_ORIGIN.split(',')
		: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];
	
	if (!origin || 
		origin.includes('.vercel.app') || 
		origin.includes('vercel.app') ||
		allowedOrigins.includes(origin) ||
		origin.startsWith('http://localhost:')) {
		res.header('Access-Control-Allow-Origin', origin || '*');
		res.header('Access-Control-Allow-Credentials', 'true');
		res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
		res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	}
	
	if (req.method === 'OPTIONS') {
		return res.sendStatus(200);
	}
	next();
});

// Add morgan logging
app.use(morgan('dev'));

// Enhanced CORS
app.use(cors({ 
	origin: (origin, callback) => {
		if (!origin) return callback(null, true);
		if (origin.includes('.vercel.app') || origin.includes('vercel.app')) {
			return callback(null, true);
		}
		const allowedOrigins = process.env.CLIENT_ORIGIN 
			? process.env.CLIENT_ORIGIN.split(',')
			: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];
		if (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:')) {
			callback(null, true);
		} else {
			callback(new Error('Not allowed by CORS'));
		}
	},
	credentials: true 
}));

// Rate limiter
app.use('/api/ai', apiLimiter);
app.use('/api/upload', apiLimiter);

// Load routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/diseases', diseaseRoutes);
app.use('/api/admin', adminRoutes);

// Root endpoint
app.get('/', (_req, res) => {
	res.json({ 
		status: 'ok', 
		message: 'MedEase API Server is running',
		timestamp: new Date().toISOString(),
		endpoints: {
			test: '/test',
			health: '/health',
			status: '/api/status'
		}
	});
});

// Simple test endpoint
app.get('/test', (_req, res) => {
	res.json({ 
		status: 'ok', 
		message: 'Server is running',
		timestamp: new Date().toISOString()
	});
});

// Healthcheck
app.get('/health', async (_req, res) => {
	try {
		const providerStatus = getProviderStatus();
		const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
		res.json({
			status: 'ok',
			timestamp: new Date().toISOString(),
			services: {
				mongodb: dbStatus,
				aiProviders: {
					available: providerStatus.available,
					gemini: providerStatus.gemini,
					groq: providerStatus.groq,
					huggingface: providerStatus.huggingface,
					openai: providerStatus.openai
				}
			}
		});
	} catch (error) {
		res.status(500).json({
			status: 'error',
			message: error.message,
			timestamp: new Date().toISOString()
		});
	}
});

// API Status endpoint
app.get('/api/status', async (_req, res) => {
	try {
		const providerStatus = getProviderStatus();
		res.json({
			server: 'running',
			timestamp: new Date().toISOString(),
			apis: {
				authentication: {
					status: 'available',
					endpoints: ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me']
				},
				upload: {
					status: 'available',
					endpoints: ['POST /api/upload/report']
				},
				ai: {
					status: providerStatus.available.length > 0 ? 'available' : 'unavailable',
					providers: {
						gemini: providerStatus.gemini,
						groq: providerStatus.groq,
						openai: providerStatus.openai,
						huggingface: providerStatus.huggingface,
						openrouter: providerStatus.openrouter,
						anthropic: providerStatus.anthropic
					},
					availableProviders: providerStatus.available,
					consensus: providerStatus.consensus,
					endpoints: ['POST /api/ai/interpret'],
					apiKeyStatus: {
						GEMINI_API_KEY: process.env.GEMINI_API_KEY 
							? (process.env.GEMINI_API_KEY.startsWith('sk-or-v1-') ? 'OpenRouter key set' : 'Direct API key set')
							: 'not set',
						ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'set' : 'not set',
						GROQ_API_KEY: process.env.GROQ_API_KEY ? 'set' : 'not set',
						OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'set' : 'not set',
						HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY ? 'set' : 'not set'
					}
				},
				diseases: {
					status: 'available',
					endpoints: [
						'GET /api/diseases',
						'GET /api/diseases/:id',
						'GET /api/diseases/:id/localized',
						'POST /api/diseases/bookmark'
					]
				},
				video: {
					status: process.env.VIDEO_GENERATION_API_KEY ? 'configured' : 'not configured',
					apiKey: process.env.VIDEO_GENERATION_API_KEY ? 'set' : 'not set'
				},
				audio: {
					status: process.env.AUDIO_GENERATION_API_KEY ? 'configured' : 'not configured',
					apiKey: process.env.AUDIO_GENERATION_API_KEY ? 'set' : 'not set'
				},
				translation: {
					status: providerStatus.available.length > 0 ? 'available' : 'unavailable',
					languages: ['en', 'hi']
				}
			}
		});
	} catch (error) {
		res.status(500).json({
			status: 'error',
			message: error.message,
			timestamp: new Date().toISOString()
		});
	}
});

// Connect to database (non-blocking, don't throw if it fails)
if (process.env.MONGO_URI) {
	connectDB()
		.then(() => {
			console.log('✅ Database connected successfully');
		})
		.catch((err) => {
			console.error('⚠️ Database connection error (continuing without DB):', err.message);
		});
} else {
	console.warn('⚠️ MONGO_URI not set - database features will be unavailable');
}

// Global error handler
app.use((err, req, res, next) => {
	console.error('Unhandled error:', err);
	res.status(err.status || 500).json({
		status: 'error',
		message: err.message || 'Internal Server Error',
		timestamp: new Date().toISOString()
	});
});

// 404 handler
app.use((req, res) => {
	res.status(404).json({ message: 'Not Found' });
});

// For Vercel serverless: export the app directly
export default app;

// For traditional server: start listening (only if not in Vercel)
if (process.env.VERCEL !== '1' && !process.env.VERCEL) {
	const PORT = process.env.PORT || 5000;
	connectDB()
		.then(() => {
			app.listen(PORT, () => {
				console.log(`Server running on port ${PORT}`);
			});
		})
		.catch((err) => {
			console.error('Failed to start server', err);
			process.exit(1);
		});
}
