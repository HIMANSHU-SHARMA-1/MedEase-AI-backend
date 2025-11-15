import mongoose from 'mongoose';

const BookmarkSchema = new mongoose.Schema(
	{
		diseaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Disease' },
		title: { type: String, trim: true }
	},
	{ _id: false }
);

const UserSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true },
		email: { type: String, required: true, unique: true, lowercase: true, index: true },
		passwordHash: { type: String, required: true },
		role: { type: String, enum: ['user', 'admin'], default: 'user' },
		bookmarks: [BookmarkSchema],
		refreshToken: { type: String, default: null }
	},
	{ timestamps: true }
);

export default mongoose.model('User', UserSchema);


