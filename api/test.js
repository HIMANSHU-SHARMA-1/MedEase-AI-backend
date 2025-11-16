export default function handler(req, res) {
	res.json({ 
		status: 'ok', 
		message: 'Test endpoint working',
		timestamp: new Date().toISOString()
	});
}

