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

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');

  try {
    // --- MEMBER ACTIONS ---
    if (action === 'get_members' && req.method === 'GET') {
      const members = await sql`SELECT id, username, password, stamps, created_at FROM royal_members ORDER BY created_at DESC`;
      return res.status(200).json(members);
    }

    if (action === 'create_member' && req.method === 'POST') {
      const { username, password } = req.body;
      const result = await sql`
        INSERT INTO royal_members (username, password, stamps)
        VALUES (${username}, ${password}, 0)
        RETURNING id, username, stamps
      `;
      return res.status(201).json(result[0]);
    }

    if (action === 'login_member' && req.method === 'POST') {
      const { username, password } = req.body;
      const rows = await sql`
        SELECT id, username, stamps FROM royal_members
        WHERE LOWER(username) = LOWER(${username}) AND password = ${password}
        LIMIT 1
      `;
      if (rows.length === 0) return res.status(401).json({ error: 'Username atau password salah!' });
      return res.status(200).json(rows[0]);
    }

    if (action === 'get_member_profile' && req.method === 'GET') {
      const username = url.searchParams.get('username');
      const rows = await sql`
        SELECT id, username, stamps FROM royal_members
        WHERE LOWER(username) = LOWER(${username})
        LIMIT 1
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Member tidak ditemukan' });
      return res.status(200).json(rows[0]);
    }

    if (action === 'change_password' && req.method === 'PATCH') {
      const { username, oldPassword, newPassword } = req.body;
      const updated = await sql`
        UPDATE royal_members SET password = ${newPassword}
        WHERE LOWER(username) = LOWER(${username}) AND password = ${oldPassword}
        RETURNING id, username
      `;
      if (updated.length === 0) return res.status(400).json({ error: 'Password lama tidak sesuai!' });
      return res.status(200).json({ success: true });
    }

    if (action === 'admin_reset_pass' && req.method === 'PATCH') {
      const { id, newPassword } = req.body;
      await sql`UPDATE royal_members SET password = ${newPassword} WHERE id = ${Number(id)}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'delete_member' && req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      await sql`DELETE FROM royal_members WHERE id = ${Number(id)}`;
      return res.status(200).json({ success: true });
    }

    // --- STAMP ACTIONS ---
    if (action === 'get_stamps' && req.method === 'GET') {
      const stamps = await sql`SELECT * FROM royal_stamps ORDER BY created_at DESC`;
      return res.status(200).json(stamps);
    }

    if (action === 'generate_stamp' && req.method === 'POST') {
      const { code, customer_note, expires_at } = req.body;
      const created = await sql`
        INSERT INTO royal_stamps (code, customer_note, expires_at)
        VALUES (${code}, ${customer_note}, ${expires_at})
        RETURNING *
      `;
      return res.status(201).json(created[0]);
    }

    if (action === 'claim_stamp' && req.method === 'POST') {
      const { username, code } = req.body;

      const stamps = await sql`SELECT * FROM royal_stamps WHERE UPPER(code) = UPPER(${code}) LIMIT 1`;
      if (stamps.length === 0) return res.status(404).json({ error: 'Kode stamp tidak valid!' });

      const stamp = stamps[0];
      if (stamp.is_redeemed) return res.status(400).json({ error: 'Kode stamp sudah pernah digunakan!' });
      if (new Date() > new Date(stamp.expires_at)) return res.status(400).json({ error: 'Kode stamp sudah expired!' });

      const members = await sql`SELECT * FROM royal_members WHERE LOWER(username) = LOWER(${username}) LIMIT 1`;
      if (members.length === 0) return res.status(404).json({ error: 'Akun member tidak ditemukan!' });
      if (members[0].stamps >= 10) return res.status(400).json({ error: 'Stamp sudah penuh (10/10)!' });

      await sql`
        UPDATE royal_stamps
        SET is_redeemed = TRUE, redeemed_by = ${username}, redeemed_at = NOW()
        WHERE id = ${stamp.id}
      `;
      const updatedMember = await sql`
        UPDATE royal_members
        SET stamps = stamps + 1
        WHERE id = ${members[0].id}
        RETURNING stamps
      `;

      return res.status(200).json({ stamps: updatedMember[0].stamps });
    }

    if (action === 'redeem_reward' && req.method === 'POST') {
      const { username } = req.body;
      await sql`UPDATE royal_members SET stamps = 0 WHERE LOWER(username) = LOWER(${username})`;
      return res.status(200).json({ stamps: 0 });
    }

    if (action === 'clear_expired' && req.method === 'DELETE') {
      await sql`DELETE FROM royal_stamps WHERE is_redeemed = FALSE AND expires_at < NOW()`;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (error) {
    console.error('Database Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
