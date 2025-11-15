import mongoose from 'mongoose';

const HistorySchema = new mongoose.Schema(
	{
		userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
		fileName: { type: String },
		detectedDisease: { type: String },
		parsedText: { type: String },
		aiSummary: { type: mongoose.Schema.Types.Mixed },
		videoResources: { type: [mongoose.Schema.Types.Mixed], default: [] },
		specialistProviders: { type: [mongoose.Schema.Types.Mixed], default: [] },
		createdAt: { type: Date, default: Date.now }
	},
	{ versionKey: false }
);

export default mongoose.model('History', HistorySchema);


