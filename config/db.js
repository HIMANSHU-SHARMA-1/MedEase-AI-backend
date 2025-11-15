import mongoose from 'mongoose';

// Cache the connection to reuse in serverless environments
let cachedConnection = null;

export async function connectDB() {
	// Reuse existing connection if available (important for serverless)
	if (cachedConnection && mongoose.connection.readyState === 1) {
		return cachedConnection;
	}
	
	const mongoUri = process.env.MONGO_URI;
	if (!mongoUri) {
		throw new Error('MONGO_URI not set in environment variables');
	}
	
	console.log('Attempting to connect to MongoDB...');
	mongoose.set('strictQuery', true);
	
	try {
		// Try multiple connection options
		const connectionOptions = {
			autoIndex: true,
			serverSelectionTimeoutMS: 15000,
			retryWrites: true,
			w: 'majority',
			// Try authSource=admin if default fails
			authSource: 'admin'
		};
		
		cachedConnection = await mongoose.connect(mongoUri, connectionOptions);
		console.log('✅ MongoDB connected successfully');
		return cachedConnection;
	} catch (error) {
		console.error('❌ MongoDB connection error:', error.message);
		throw error;
	}
}


