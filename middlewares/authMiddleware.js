import jwt from 'jsonwebtoken';
import User from '../models/User.js';

function getJwtSecret() {
	const secret =
		process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'dev_jwt_secret' : null);
	if (!secret) {
		throw new Error('JWT_SECRET is not configured');
	}
	return secret;
}

export function requireAuth(requiredRoles = []) {
	return async (req, res, next) => {
		try {
			const authHeader = req.headers.authorization || '';
			const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
			if (!token) {
				return res.status(401).json({ message: 'Unauthorized' });
			}
			const payload = jwt.verify(token, getJwtSecret());
			const user = await User.findById(payload.id).lean();
			if (!user) return res.status(401).json({ message: 'Unauthorized' });
			if (requiredRoles.length && !requiredRoles.includes(user.role)) {
				return res.status(403).json({ message: 'Forbidden' });
			}
			req.user = { id: user._id.toString(), role: user.role, email: user.email };
			next();
		} catch (err) {
			return res.status(401).json({ message: 'Unauthorized' });
		}
	};
}

export function generateTokens(userId) {
	const secret = getJwtSecret();
	const accessToken = jwt.sign({ id: userId }, secret, { expiresIn: '1h' });
	const refreshToken = jwt.sign({ id: userId }, secret, { expiresIn: '7d' });
	return { accessToken, refreshToken };
}


