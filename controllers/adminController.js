import Disease from '../models/Disease.js';

export async function listPending(req, res) {
	try {
		const items = await Disease.find({ approved: false }).sort({ createdAt: -1 }).limit(50).lean();
		res.json(items);
	} catch {
		res.status(500).json({ message: 'Failed to fetch pending' });
	}
}

export async function approveDisease(req, res) {
	try {
		const { id } = req.params;
		const { aiSummary, pharmacyLinks } = req.body || {};
		const update = { approved: true };
		if (aiSummary) update.aiSummary = aiSummary;
		if (pharmacyLinks) update.pharmacyLinks = pharmacyLinks;
		const disease = await Disease.findByIdAndUpdate(id, update, { new: true }).lean();
		if (!disease) return res.status(404).json({ message: 'Not found' });
		res.json(disease);
	} catch {
		res.status(500).json({ message: 'Approve failed' });
	}
}


