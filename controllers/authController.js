import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { generateTokens } from '../middlewares/authMiddleware.js';

export async function register(req, res) {
	try {
		const { name, email, password } = req.body;
		const existing = await User.findOne({ email });
		if (existing) return res.status(400).json({ message: 'Email already registered' });
		const passwordHash = await bcrypt.hash(password, 10);
		const user = await User.create({ name, email, passwordHash });
		const { accessToken, refreshToken } = generateTokens(user._id.toString());
		user.refreshToken = refreshToken;
		await user.save();
		res.status(201).json({
			user: { id: user._id, name: user.name, email: user.email, role: user.role },
			accessToken,
			refreshToken
		});
	} catch (err) {
		res.status(500).json({ message: 'Registration failed' });
	}
}

export async function login(req, res) {
	try {
		const { email, password } = req.body;
		const user = await User.findOne({ email });
		if (!user) return res.status(400).json({ message: 'Invalid credentials' });
		const valid = await bcrypt.compare(password, user.passwordHash);
		if (!valid) return res.status(400).json({ message: 'Invalid credentials' });
		const { accessToken, refreshToken } = generateTokens(user._id.toString());
		user.refreshToken = refreshToken;
		await user.save();
		res.json({
			user: { id: user._id, name: user.name, email: user.email, role: user.role },
			accessToken,
			refreshToken
		});
	} catch {
		res.status(500).json({ message: 'Login failed' });
	}
}

export async function refresh(req, res) {
	try {
		const { refreshToken } = req.body;
		if (!refreshToken) return res.status(400).json({ message: 'Missing token' });
		const user = await User.findOne({ refreshToken });
		if (!user) return res.status(401).json({ message: 'Unauthorized' });
		const { accessToken, refreshToken: newRefresh } = generateTokens(user._id.toString());
		user.refreshToken = newRefresh;
		await user.save();
		res.json({ accessToken, refreshToken: newRefresh });
	} catch {
		res.status(401).json({ message: 'Unauthorized' });
	}
}

export async function me(req, res) {
	try {
		const User = (await import('../models/User.js')).default;
		const user = await User.findById(req.user.id).select('-passwordHash -refreshToken').lean();
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}
		res.json({ user });
	} catch (err) {
		console.error('Error in /me endpoint:', err);
		res.status(500).json({ message: 'Failed to fetch user data' });
	}
}


