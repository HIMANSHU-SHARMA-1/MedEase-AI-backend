import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Tesseract from 'tesseract.js';
import { createMulter } from '../utils/uploader.js';
import pdfParse from 'pdf-parse';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const upload = createMulter().single('report');

export async function extractText(req, res) {
	try {
		if (!req.file) {
			return res.status(400).json({ message: 'No file uploaded' });
		}
		const filePath = req.file.path;
		const mime = req.file.mimetype || '';
		let text = '';

		if (mime === 'application/pdf') {
			// Fast path: extract text from PDF without OCR
			const buffer = await fs.readFile(filePath);
			const result = await pdfParse(buffer);
			text = (result.text || '').trim();
		} else {
			// Image path: use Tesseract OCR
			const { data } = await Tesseract.recognize(filePath, 'eng');
			text = (data && data.text ? data.text : '').trim();
		}

		// Delete the file after processing for privacy
		await fs.unlink(filePath).catch(() => {});

		if (!text) {
			return res.status(422).json({ message: 'Could not extract text from the provided file.' });
		}

		res.json({ parsedText: text, fileName: req.file.originalname });
	} catch (err) {
		console.error('Text extraction error:', err.message, err.stack);
		// Best effort cleanup
		if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
		
		// Provide more specific error messages
		if (err.message?.includes('pdf-parse')) {
			return res.status(500).json({ message: 'PDF parsing failed. Please ensure pdf-parse is installed: npm install pdf-parse' });
		}
		if (err.message?.includes('tesseract') || err.message?.includes('Tesseract')) {
			return res.status(500).json({ message: 'OCR failed. Please try a clearer image or PDF.' });
		}
		res.status(500).json({ message: 'Text extraction failed: ' + (err.message || 'Unknown error') });
	}
}


