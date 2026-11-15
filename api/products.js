import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_Zm5eHBzal6xh@ep-billowing-shadow-bbbzzr6h.c-15.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
  const sql = neon(DATABASE_URL);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Prefer');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. AMBIL SEMUA PRODUK (GET)
    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM products ORDER BY id ASC`;
      return res.status(200).json(rows);
    }

    // 2. TAMBAH PRODUK BARU (POST)
    if (req.method === 'POST') {
      const { name, category, price, price_3d, price_7d, stock, image, description } = req.body;
      const rows = await sql`
        INSERT INTO products (name, category, price, price_3d, price_7d, stock, image, description)
        VALUES (
          ${name}, 
          ${category}, 
          ${Number(price)}, 
          ${Number(price_3d) || Number(price) * 2}, 
          ${Number(price_7d) || Number(price) * 4}, 
          ${Number(stock)}, 
          ${image || ''}, 
          ${description || ''}
        )
        RETURNING *
      `;
      return res.status(201).json(rows);
    }

    // 3. EDIT PRODUK (PATCH)
    if (req.method === 'PATCH') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const idParam = url.searchParams.get('id');
      const id = idParam ? idParam.replace('eq.', '') : null;

      if (!id) return res.status(400).json({ error: 'ID produk tidak ditemukan' });

      const { name, category, price, price_3d, price_7d, stock, image, description } = req.body;
      const rows = await sql`
        UPDATE products
        SET name = ${name}, 
            category = ${category}, 
            price = ${Number(price)}, 
            price_3d = ${Number(price_3d) || Number(price) * 2},
            price_7d = ${Number(price_7d) || Number(price) * 4},
            stock = ${Number(stock)}, 
            image = ${image || ''}, 
            description = ${description || ''}
        WHERE id = ${Number(id)}
        RETURNING *
      `;
      return res.status(200).json(rows);
    }

    // 4. HAPUS PRODUK (DELETE)
    if (req.method === 'DELETE') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const idParam = url.searchParams.get('id');
      const id = idParam ? idParam.replace('eq.', '') : null;

      if (!id) return res.status(400).json({ error: 'ID produk tidak ditemukan' });

      await sql`DELETE FROM products WHERE id = ${Number(id)}`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method tidak didukung' });
  } catch (error) {
    console.error('Database Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
