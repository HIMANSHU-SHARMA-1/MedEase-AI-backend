import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 60,
	standardHeaders: true,
	legacyHeaders: false,
	message: { message: 'Too many requests, please try again later.' }
});


