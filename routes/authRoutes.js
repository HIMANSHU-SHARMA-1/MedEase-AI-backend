import { Router } from 'express';
import { body } from 'express-validator';
import { handleValidation } from '../middlewares/validators.js';
import { login, me, refresh, register } from '../controllers/authController.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = Router();

router.post(
	'/register',
	[
		body('name').isString().isLength({ min: 2 }),
		body('email').isEmail(),
		body('password').isLength({ min: 6 })
	],
	handleValidation,
	register
);

router.post('/login', [body('email').isEmail(), body('password').isString()], handleValidation, login);
router.post('/refresh', [body('refreshToken').isString()], handleValidation, refresh);
router.get('/me', requireAuth(), me);

export default router;


