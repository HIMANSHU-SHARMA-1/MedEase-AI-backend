import { Router } from 'express';
import { body } from 'express-validator';
import { interpretReport } from '../controllers/aiController.js';
import { handleValidation } from '../middlewares/validators.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = Router();

router.post(
	'/interpret',
	requireAuth(),
	[body('parsedText').isString().isLength({ min: 5 })],
	handleValidation,
	interpretReport
);

export default router;


