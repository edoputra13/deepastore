import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  // 1. Mengambil semua produk untuk ditampilkan di halaman publik
  if (req.method === 'GET') {
    try {
      const products = await sql`SELECT * FROM products ORDER BY created_at DESC`;
      return res.status(200).json(products);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // 2. Menyimpan produk baru dari halaman Admin
  if (req.method === 'POST') {
    try {
      const { name, price, description, image_url } = req.body;
      await sql`
        INSERT INTO products (name, price, description, image_url)
        VALUES (${name}, ${price}, ${description}, ${image_url})
      `;
      return res.status(200).json({ message: 'Produk berhasil ditambahkan!' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ message: 'Method tidak diizinkan' });
}
