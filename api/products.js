export default async function handler(req, res) {
  // Set header CORS agar diizinkan oleh browser
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Prefer'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const NEON_API_URL = "https://ep-billowing-shadow-bbbzzr6h.rt.c-15.us-east-1.aws.neon.tech/products";

  try {
    const { search } = req.url ? new URL(req.url, `http://${req.headers.host}`) : { search: '' };
    const targetUrl = `${NEON_API_URL}${search}`;

    const fetchOptions = {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
    };

    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();

    res.status(response.status).send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
