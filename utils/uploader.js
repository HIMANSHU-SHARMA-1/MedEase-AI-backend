import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mime from 'mime-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir);
}

export function createMulter() {
	const storage = multer.diskStorage({
		destination: (_req, _file, cb) => cb(null, uploadDir),
		filename: (_req, file, cb) => {
			const ext = mime.extension(file.mimetype) || 'bin';
			cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
		}
	});
	const fileFilter = (_req, file, cb) => {
		const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
		if (allowed.includes(file.mimetype)) cb(null, true);
		else cb(new Error('Invalid file type'));
	};
	return multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });
}


