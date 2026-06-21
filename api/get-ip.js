// Vercel serverless function: returns the caller's IP address.
// Vercel sets x-forwarded-for on every request that reaches a function -- this is
// documented Vercel platform behavior, not something guaranteed by the web standard,
// so it's worth re-checking Vercel's docs if this ever stops working as expected.
module.exports = (req, res) => {
    const xff = req.headers['x-forwarded-for'];
    const ip = (xff ? xff.split(',')[0] : req.socket?.remoteAddress || '').trim();
    res.status(200).json({ ip: ip || null });
};
