import { Router } from 'express';
import { extractText, upload } from '../controllers/uploadController.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/report', requireAuth(), upload, extractText);

export default router;


