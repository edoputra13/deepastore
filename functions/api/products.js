const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    // CORS & Anti-Cache Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Prefer, Authorization');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!process.env.DATABASE_URL) {
        return res.status(500).json({ 
            error: 'Environment variable DATABASE_URL belum diatur di Vercel.' 
        });
    }

    const sql = neon(process.env.DATABASE_URL);
    const { action } = req.query;

    try {
        // Pastikan semua tabel tersedia otomatis di Neon PostgreSQL
        await sql`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                category VARCHAR(100) DEFAULT 'Digital',
                price NUMERIC DEFAULT 0,
                price_3d NUMERIC DEFAULT 0,
                price_7d NUMERIC DEFAULT 0,
                price_1m NUMERIC DEFAULT 0,
                stock INTEGER DEFAULT 0,
                description TEXT DEFAULT '',
                image TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS royal_members (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                stamps INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS royal_stamp_codes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) UNIQUE NOT NULL,
                is_used BOOLEAN DEFAULT FALSE,
                used_by VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        // ============================================================
        // 1. ROYAL LOYALTY CARD ENDPOINTS (MEMBER & ADMIN)
        // ============================================================
        if (action) {
            // A. Cek Profil & Validasi Keberadaan Akun Member
            if (action === 'get_member_profile' && req.method === 'GET') {
                const username = String(req.query.username || '').trim().toLowerCase();
                if (!username) {
                    return res.status(400).json({ error: 'Username wajib diisi' });
                }

                const rows = await sql`
                    SELECT id, username, stamps 
                    FROM royal_members 
                    WHERE LOWER(username) = ${username} 
                    LIMIT 1
                `;

                if (!rows || rows.length === 0) {
                    return res.status(404).json({ 
                        error: 'Akun member tidak ditemukan atau telah dihapus oleh admin.',
                        deleted: true 
                    });
                }

                return res.status(200).json(rows[0]);
            }

            // B. Login Member Royal Card
            if (action === 'login_member' && req.method === 'POST') {
                const { username, password } = req.body || {};
                const cleanUser = String(username || '').trim().toLowerCase();
                const cleanPass = String(password || '');

                if (!cleanUser || !cleanPass) {
                    return res.status(400).json({ error: 'Username dan password wajib diisi!' });
                }

                const rows = await sql`
                    SELECT id, username, password, stamps 
                    FROM royal_members 
                    WHERE LOWER(username) = ${cleanUser} 
                    LIMIT 1
                `;

                if (!rows || rows.length === 0 || rows[0].password !== cleanPass) {
                    return res.status(401).json({ error: 'Username atau password salah!' });
                }

                return res.status(200).json({
                    id: rows[0].id,
                    username: rows[0].username,
                    stamps: rows[0].stamps || 0
                });
            }

            // C. Ubah Password Member
            if (action === 'change_password' && req.method === 'PATCH') {
                const { username, oldPassword, newPassword } = req.body || {};
                const cleanUser = String(username || '').trim().toLowerCase();

                if (!cleanUser || !oldPassword || !newPassword) {
                    return res.status(400).json({ error: 'Data tidak lengkap!' });
                }

                const rows = await sql`
                    SELECT id, password 
                    FROM royal_members 
                    WHERE LOWER(username) = ${cleanUser} 
                    LIMIT 1
                `;

                if (!rows || rows.length === 0) {
                    return res.status(404).json({ error: 'Akun member tidak ditemukan atau telah dihapus.' });
                }

                if (rows[0].password !== String(oldPassword)) {
                    return res.status(401).json({ error: 'Password lama salah!' });
                }

                await sql`
                    UPDATE royal_members 
                    SET password = ${String(newPassword)} 
                    WHERE id = ${rows[0].id}
                `;

                return res.status(200).json({ success: true, message: 'Password berhasil diperbarui' });
            }

            // D. Klaim Kode Stamp (DEEPA-XXXXXX)
            if (action === 'claim_stamp' && req.method === 'POST') {
                const { username, code } = req.body || {};
                const cleanUser = String(username || '').trim().toLowerCase();
                const cleanCode = String(code || '').trim().toUpperCase();

                if (!cleanUser || !cleanCode) {
                    return res.status(400).json({ error: 'Username dan kode wajib diisi!' });
                }

                const memberRows = await sql`
                    SELECT id, username, stamps 
                    FROM royal_members 
                    WHERE LOWER(username) = ${cleanUser} 
                    LIMIT 1
                `;

                if (!memberRows || memberRows.length === 0) {
                    return res.status(404).json({ error: 'Akun member tidak ditemukan atau telah dihapus oleh admin.' });
                }

                const codeRows = await sql`
                    SELECT id, is_used 
                    FROM royal_stamp_codes 
                    WHERE UPPER(code) = ${cleanCode} 
                    LIMIT 1
                `;

                if (!codeRows || codeRows.length === 0) {
                    return res.status(400).json({ error: 'Kode redeem tidak valid!' });
                }

                if (codeRows[0].is_used) {
                    return res.status(400).json({ error: 'Kode redeem sudah pernah digunakan!' });
                }

                const currentStamps = Number(memberRows[0].stamps) || 0;
                const updatedStamps = Math.min(currentStamps + 1, 10);

                await sql`
                    UPDATE royal_stamp_codes 
                    SET is_used = TRUE, used_by = ${memberRows[0].username} 
                    WHERE id = ${codeRows[0].id}
                `;

                const updatedMember = await sql`
                    UPDATE royal_members 
                    SET stamps = ${updatedStamps} 
                    WHERE id = ${memberRows[0].id} 
                    RETURNING id, username, stamps
                `;

                return res.status(200).json({
                    success: true,
                    stamps: updatedMember[0].stamps
                });
            }

            // E. Klaim Hadiah 10 Stamp & Reset ke 0
            if (action === 'redeem_reward' && req.method === 'POST') {
                const { username } = req.body || {};
                const cleanUser = String(username || '').trim().toLowerCase();

                const memberRows = await sql`
                    SELECT id, stamps 
                    FROM royal_members 
                    WHERE LOWER(username) = ${cleanUser} 
                    LIMIT 1
                `;

                if (!memberRows || memberRows.length === 0) {
                    return res.status(404).json({ error: 'Akun member tidak ditemukan.' });
                }

                await sql`
                    UPDATE royal_members 
                    SET stamps = 0 
                    WHERE id = ${memberRows[0].id}
                `;

                return res.status(200).json({ success: true, stamps: 0 });
            }

            // F. Endpoint Admin untuk Member & Kode Stamp
            if (action === 'list_members' && req.method === 'GET') {
                const members = await sql`
                    SELECT id, username, password, stamps, created_at 
                    FROM royal_members 
                    ORDER BY id DESC
                `;
                return res.status(200).json(members);
            }

            if (action === 'create_member' && req.method === 'POST') {
                const { username, password, stamps } = req.body || {};
                const cleanUser = String(username || '').trim().toLowerCase().replace(/^@/, '');
                if (!cleanUser || !password) {
                    return res.status(400).json({ error: 'Username dan password wajib diisi' });
                }

                const inserted = await sql`
                    INSERT INTO royal_members (username, password, stamps)
                    VALUES (${cleanUser}, ${String(password)}, ${Number(stamps) || 0})
                    RETURNING id, username, password, stamps
                `;
                return res.status(201).json(inserted[0]);
            }

            if (action === 'update_member' && req.method === 'PATCH') {
                const { id, username, password, stamps } = req.body || {};
                if (!id) return res.status(400).json({ error: 'ID member wajib diisi' });

                const updated = await sql`
                    UPDATE royal_members
                    SET 
                        username = COALESCE(${username ? String(username).trim().toLowerCase().replace(/^@/, '') : null}, username),
                        password = COALESCE(${password ? String(password) : null}, password),
                        stamps = COALESCE(${stamps !== undefined ? Number(stamps) : null}, stamps)
                    WHERE id = ${Number(id)}
                    RETURNING id, username, password, stamps
                `;
                if (!updated || updated.length === 0) {
                    return res.status(404).json({ error: 'Member tidak ditemukan' });
                }
                return res.status(200).json(updated[0]);
            }

            if (action === 'delete_member' && req.method === 'DELETE') {
                const targetId = req.query.id || (req.body && req.body.id);
                const targetUser = req.query.username || (req.body && req.body.username);

                if (targetId) {
                    await sql`DELETE FROM royal_members WHERE id = ${Number(targetId)}`;
                } else if (targetUser) {
                    await sql`DELETE FROM royal_members WHERE LOWER(username) = ${String(targetUser).trim().toLowerCase()}`;
                } else {
                    return res.status(400).json({ error: 'Parameter id atau username wajib disertakan' });
                }

                return res.status(200).json({ success: true, deleted: true });
            }

            if (action === 'list_codes' && req.method === 'GET') {
                const codes = await sql`
                    SELECT id, code, is_used, used_by, created_at 
                    FROM royal_stamp_codes 
                    ORDER BY id DESC
                `;
                return res.status(200).json(codes);
            }

            if (action === 'create_code' && req.method === 'POST') {
                const { code } = req.body || {};
                const cleanCode = String(code || '').trim().toUpperCase();
                if (!cleanCode) return res.status(400).json({ error: 'Kode tidak boleh kosong' });

                const inserted = await sql`
                    INSERT INTO royal_stamp_codes (code, is_used)
                    VALUES (${cleanCode}, FALSE)
                    RETURNING id, code, is_used, used_by
                `;
                return res.status(201).json(inserted[0]);
            }

            if (action === 'delete_code' && req.method === 'DELETE') {
                const targetId = req.query.id || (req.body && req.body.id);
                if (!targetId) return res.status(400).json({ error: 'ID kode wajib disertakan' });

                await sql`DELETE FROM royal_stamp_codes WHERE id = ${Number(targetId)}`;
                return res.status(200).json({ success: true });
            }

            return res.status(400).json({ error: `Action '${action}' tidak dikenali` });
        }

        // ============================================================
        // 2. KATALOG PRODUK ENDPOINTS (CRUD DEFAULT)
        // ============================================================
        if (req.method === 'GET') {
            const products = await sql`
                SELECT * FROM products ORDER BY id ASC
            `;
            return res.status(200).json(products || []);
        }

        if (req.method === 'POST') {
            const { name, category, price, price_3d, price_7d, price_1m, stock, description, image } = req.body || {};
            const inserted = await sql`
                INSERT INTO products (name, category, price, price_3d, price_7d, price_1m, stock, description, image)
                VALUES (
                    ${name},
                    ${category || 'Digital'},
                    ${Number(price) || 0},
                    ${Number(price_3d) || 0},
                    ${Number(price_7d) || 0},
                    ${Number(price_1m) || 0},
                    ${Number(stock) || 0},
                    ${description || ''},
                    ${image || ''}
                )
                RETURNING *
            `;
            return res.status(201).json(inserted);
        }

        if (req.method === 'PATCH' || req.method === 'PUT') {
            const rawId = req.query.id ? String(req.query.id).replace('eq.', '') : (req.body && req.body.id);
            if (!rawId) return res.status(400).json({ error: 'ID produk wajib disertakan' });

            const { name, category, price, price_3d, price_7d, price_1m, stock, description, image } = req.body || {};
            const updated = await sql`
                UPDATE products
                SET
                    name = COALESCE(${name ?? null}, name),
                    category = COALESCE(${category ?? null}, category),
                    price = COALESCE(${price !== undefined ? Number(price) : null}, price),
                    price_3d = COALESCE(${price_3d !== undefined ? Number(price_3d) : null}, price_3d),
                    price_7d = COALESCE(${price_7d !== undefined ? Number(price_7d) : null}, price_7d),
                    price_1m = COALESCE(${price_1m !== undefined ? Number(price_1m) : null}, price_1m),
                    stock = COALESCE(${stock !== undefined ? Number(stock) : null}, stock),
                    description = COALESCE(${description ?? null}, description),
                    image = COALESCE(${image ?? null}, image)
                WHERE id = ${Number(rawId)}
                RETURNING *
            `;
            return res.status(200).json(updated);
        }

        if (req.method === 'DELETE') {
            const rawId = req.query.id ? String(req.query.id).replace('eq.', '') : (req.body && req.body.id);
            if (!rawId) return res.status(400).json({ error: 'ID produk wajib disertakan' });

            await sql`DELETE FROM products WHERE id = ${Number(rawId)}`;
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method tidak diizinkan' });
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server' });
    }
};
