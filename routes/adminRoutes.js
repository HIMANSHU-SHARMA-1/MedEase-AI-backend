import { Router } from 'express';
import { approveDisease, listPending } from '../controllers/adminController.js';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { handleValidation } from '../middlewares/validators.js';

const router = Router();

router.get('/pending', requireAuth(['admin']), listPending);
router.post(
	'/approve/:id',
	requireAuth(['admin']),
	// optional validations for updated content
	[],
	handleValidation,
	approveDisease
);

export default router;


