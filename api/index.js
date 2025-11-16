import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from '../config/db.js';
import { getProviderStatus } from '../config/aiProvider.js';
import mongoose from 'mongoose';
import authRoutes from '../routes/authRoutes.js';
import uploadRoutes from '../routes/uploadRoutes.js';
import aiRoutes from '../routes/aiRoutes.js';
import diseaseRoutes from '../routes/diseaseRoutes.js';
import adminRoutes from '../routes/adminRoutes.js';
import { apiLimiter } from '../middlewares/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// CORS - allow localhost ports in development and Vercel domains
const allowedOrigins = process.env.CLIENT_ORIGIN 
	? process.env.CLIENT_ORIGIN.split(',')
	: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];

app.use(cors({ 
	origin: (origin, callback) => {
		// Allow requests with no origin (like mobile apps or curl requests)
		if (!origin) return callback(null, true);
		
		// Allow Vercel preview and production domains
		if (origin.includes('.vercel.app') || origin.includes('vercel.app')) {
			return callback(null, true);
		}
		
		if (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:')) {
			callback(null, true);
		} else {
			callback(new Error('Not allowed by CORS'));
		}
	},
	credentials: true 
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Security: rate limit AI and upload endpoints
app.use('/api/ai', apiLimiter);
app.use('/api/upload', apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/diseases', diseaseRoutes);
app.use('/api/admin', adminRoutes);

// Simple test endpoint (before everything else) - no dependencies
app.get('/test', (_req, res) => {
	try {
		res.json({ 
			status: 'ok', 
			message: 'Server is running',
			timestamp: new Date().toISOString(),
			environment: process.env.NODE_ENV || 'development'
		});
	} catch (error) {
		res.status(500).json({ 
			status: 'error', 
			message: error.message 
		});
	}
});

// Healthcheck (before auth routes, no auth required)
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

// API Status endpoint - shows which APIs are working
app.get('/api/status', async (_req, res) => {
	const providerStatus = getProviderStatus();
	const status = {
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
	};
	res.json(status);
});

// Global error handler (must be before 404)
app.use((err, req, res, next) => {
	console.error('Unhandled error:', err);
	res.status(err.status || 500).json({
		status: 'error',
		message: err.message || 'Internal Server Error',
		timestamp: new Date().toISOString()
	});
});

// 404
app.use((req, res) => {
	res.status(404).json({ message: 'Not Found' });
});

// Connect to database (for both serverless and traditional server)
// Don't block on connection - let it connect in background
// In serverless, connection is cached and reused
// Wrap in try-catch to prevent crashes
try {
	connectDB()
		.then(() => {
			console.log('Database connected successfully');
		})
		.catch((err) => {
			console.error('Database connection error:', err.message);
			// Don't throw - let the app continue without DB for health checks
		});
} catch (err) {
	console.error('Error initializing database connection:', err.message);
}

// For Vercel serverless: export the app directly
// @vercel/node automatically handles Express apps
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
