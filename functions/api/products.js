import { neon } from '@neondatabase/serverless';

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    const baseHeaders = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Prefer, Authorization',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    };

    const jsonResponse = (data, status = 200) => {
        return new Response(JSON.stringify(data), { status, headers: baseHeaders });
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: baseHeaders });
    }

    if (!env.DATABASE_URL) {
        return jsonResponse({
            error: 'Environment variable DATABASE_URL belum diatur di Cloudflare Pages (Settings > Environment Variables).'
        }, 500);
    }

    const sql = neon(env.DATABASE_URL);

    try {
        // Pastikan tabel otomatis tersedia di Neon PostgreSQL
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

        let body = {};
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
            try {
                body = await request.json();
            } catch (e) {
                body = {};
            }
        }

        // ============================================================
        // 1. ROYAL LOYALTY CARD ENDPOINTS (MEMBER & ADMIN)
        // ============================================================
        if (action) {
            // A. Validasi & Profil Member (Auto-Logout saat dihapus admin)
            if (action === 'get_member_profile' && request.method === 'GET') {
                const username = String(url.searchParams.get('username') || '').trim().toLowerCase();
                if (!username) {
                    return jsonResponse({ error: 'Username wajib diisi' }, 400);
                }

                const rows = await sql`
                    SELECT id, username, stamps 
                    FROM royal_members 
                    WHERE LOWER(username) = ${username} 
                    LIMIT 1
                `;

                if (!rows || rows.length === 0) {
                    return jsonResponse({
                        error: 'Akun member tidak ditemukan atau telah dihapus oleh admin.',
                        deleted: true
                    }, 404);
                }

                return jsonResponse(rows[0], 200);
            }

            // B. Login Member
            if (action === 'login_member' && request.method === 'POST') {
                const cleanUser = String(body.username || '').trim().toLowerCase();
                const cleanPass = String(body.password || '');

                if (!cleanUser || !cleanPass) {
                    return jsonResponse({ error: 'Username dan password wajib diisi!' }, 400);
                }

                const rows = await sql`
                    SELECT id, username, password, stamps 
                    FROM royal_members 
                    WHERE LOWER(username) = ${cleanUser} 
                    LIMIT 1
                `;

                if (!rows || rows.length === 0 || rows[0].password !== cleanPass) {
                    return jsonResponse({ error: 'Username atau password salah!' }, 401);
                }

                return jsonResponse({
                    id: rows[0].id,
                    username: rows[0].username,
                    stamps: rows[0].stamps || 0
                }, 200);
            }

            // C. Ubah Password Member
            if (action === 'change_password' && request.method === 'PATCH') {
                const cleanUser = String(body.username || '').trim().toLowerCase();
                const { oldPassword, newPassword } = body;

                if (!cleanUser || !oldPassword || !newPassword) {
                    return jsonResponse({ error: 'Data tidak lengkap!' }, 400);
                }

                const rows = await sql`
                    SELECT id, password 
                    FROM royal_members 
                    WHERE LOWER(username) = ${cleanUser} 
                    LIMIT 1
                `;

                if (!rows || rows.length === 0) {
                    return jsonResponse({ error: 'Akun member tidak ditemukan atau telah dihapus.' }, 404);
                }

                if (rows[0].password !== String(oldPassword)) {
                    return jsonResponse({ error: 'Password lama salah!' }, 401);
                }

                await sql`
                    UPDATE royal_members 
                    SET password = ${String(newPassword)} 
                    WHERE id = ${rows[0].id}
                `;

                return jsonResponse({ success: true, message: 'Password berhasil diperbarui' }, 200);
            }

            // D. Klaim Kode Stamp (Expired otomatis dalam 1 Hari / 24 Jam)
            if (action === 'claim_stamp' && request.method === 'POST') {
                const cleanUser = String(body.username || '').trim().toLowerCase();
                const cleanCode = String(body.code || '').trim().toUpperCase();

                if (!cleanUser || !cleanCode) {
                    return jsonResponse({ error: 'Username dan kode wajib diisi!' }, 400);
                }

                const memberRows = await sql`
                    SELECT id, username, stamps 
                    FROM royal_members 
                    WHERE LOWER(username) = ${cleanUser} 
                    LIMIT 1
                `;

                if (!memberRows || memberRows.length === 0) {
                    return jsonResponse({ error: 'Akun member tidak ditemukan atau telah dihapus oleh admin.' }, 404);
                }

                const codeRows = await sql`
                    SELECT id, is_used, created_at,
                           (created_at < NOW() - INTERVAL '1 day') AS is_expired
                    FROM royal_stamp_codes 
                    WHERE UPPER(code) = ${cleanCode} 
                    LIMIT 1
                `;

                if (!codeRows || codeRows.length === 0) {
                    return jsonResponse({ error: 'Kode redeem tidak valid!' }, 400);
                }

                if (codeRows[0].is_used) {
                    return jsonResponse({ error: 'Kode redeem sudah pernah digunakan!' }, 400);
                }

                if (codeRows[0].is_expired) {
                    return jsonResponse({ error: 'Kode redeem sudah kedaluwarsa (batas waktu 1 hari telah habis)!' }, 400);
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

                return jsonResponse({
                    success: true,
                    stamps: updatedMember[0].stamps
                }, 200);
            }

            // E. Klaim Hadiah 10 Stamp & Reset ke 0
            if (action === 'redeem_reward' && request.method === 'POST') {
                const cleanUser = String(body.username || '').trim().toLowerCase();

                const memberRows = await sql`
                    SELECT id, stamps 
                    FROM royal_members 
                    WHERE LOWER(username) = ${cleanUser} 
                    LIMIT 1
                `;

                if (!memberRows || memberRows.length === 0) {
                    return jsonResponse({ error: 'Akun member tidak ditemukan.' }, 404);
                }

                await sql`
                    UPDATE royal_members 
                    SET stamps = 0 
                    WHERE id = ${memberRows[0].id}
                `;

                return jsonResponse({ success: true, stamps: 0 }, 200);
            }

            // F. Endpoint Admin: List / Create / Update / Delete Member & Kode
            if (action === 'list_members' && request.method === 'GET') {
                const members = await sql`
                    SELECT id, username, password, stamps, created_at 
                    FROM royal_members 
                    ORDER BY id DESC
                `;
                return jsonResponse(members, 200);
            }

            if (action === 'create_member' && request.method === 'POST') {
                const cleanUser = String(body.username || '').trim().toLowerCase().replace(/^@/, '');
                const password = String(body.password || '');
                if (!cleanUser || !password) {
                    return jsonResponse({ error: 'Username dan password wajib diisi' }, 400);
                }

                const inserted = await sql`
                    INSERT INTO royal_members (username, password, stamps)
                    VALUES (${cleanUser}, ${password}, ${Number(body.stamps) || 0})
                    RETURNING id, username, password, stamps
                `;
                return jsonResponse(inserted[0], 201);
            }

            if (action === 'update_member' && request.method === 'PATCH') {
                if (!body.id) return jsonResponse({ error: 'ID member wajib diisi' }, 400);

                const updated = await sql`
                    UPDATE royal_members
                    SET 
                        username = COALESCE(${body.username ? String(body.username).trim().toLowerCase().replace(/^@/, '') : null}, username),
                        password = COALESCE(${body.password ? String(body.password) : null}, password),
                        stamps = COALESCE(${body.stamps !== undefined ? Number(body.stamps) : null}, stamps)
                    WHERE id = ${Number(body.id)}
                    RETURNING id, username, password, stamps
                `;
                if (!updated || updated.length === 0) {
                    return jsonResponse({ error: 'Member tidak ditemukan' }, 404);
                }
                return jsonResponse(updated[0], 200);
            }

            if (action === 'delete_member' && request.method === 'DELETE') {
                const targetId = url.searchParams.get('id') || body.id;
                const targetUser = url.searchParams.get('username') || body.username;

                if (targetId) {
                    await sql`DELETE FROM royal_members WHERE id = ${Number(targetId)}`;
                } else if (targetUser) {
                    await sql`DELETE FROM royal_members WHERE LOWER(username) = ${String(targetUser).trim().toLowerCase()}`;
                } else {
                    return jsonResponse({ error: 'Parameter id atau username wajib disertakan' }, 400);
                }

                return jsonResponse({ success: true, deleted: true }, 200);
            }

            if (action === 'list_codes' && request.method === 'GET') {
                const codes = await sql`
                    SELECT id, code, is_used, used_by, created_at,
                           (created_at + INTERVAL '1 day') AS expires_at,
                           (NOT is_used AND created_at < NOW() - INTERVAL '1 day') AS is_expired
                    FROM royal_stamp_codes 
                    ORDER BY id DESC
                `;
                return jsonResponse(codes, 200);
            }

            if (action === 'create_code' && request.method === 'POST') {
                const cleanCode = String(body.code || '').trim().toUpperCase();
                if (!cleanCode) return jsonResponse({ error: 'Kode tidak boleh kosong' }, 400);

                const inserted = await sql`
                    INSERT INTO royal_stamp_codes (code, is_used, created_at)
                    VALUES (${cleanCode}, FALSE, CURRENT_TIMESTAMP)
                    RETURNING id, code, is_used, used_by, created_at,
                              (created_at + INTERVAL '1 day') AS expires_at,
                              FALSE AS is_expired
                `;
                return jsonResponse(inserted[0], 201);
            }

            if (action === 'delete_code' && request.method === 'DELETE') {
                const targetId = url.searchParams.get('id') || body.id;
                if (!targetId) return jsonResponse({ error: 'ID kode wajib disertakan' }, 400);

                await sql`DELETE FROM royal_stamp_codes WHERE id = ${Number(targetId)}`;
                return jsonResponse({ success: true }, 200);
            }

            return jsonResponse({ error: `Action '${action}' tidak dikenali` }, 400);
        }

        // ============================================================
        // 2. KATALOG PRODUK ENDPOINTS (CRUD DEFAULT)
        // ============================================================
        if (request.method === 'GET') {
            const products = await sql`
                SELECT * FROM products ORDER BY id ASC
            `;
            return jsonResponse(products || [], 200);
        }

        if (request.method === 'POST') {
            const { name, category, price, price_3d, price_7d, price_1m, stock, description, image } = body;
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
            return jsonResponse(inserted, 201);
        }

        if (request.method === 'PATCH' || request.method === 'PUT') {
            const queryId = url.searchParams.get('id');
            const rawId = queryId ? String(queryId).replace('eq.', '') : body.id;
            if (!rawId) return jsonResponse({ error: 'ID produk wajib disertakan' }, 400);

            const { name, category, price, price_3d, price_7d, price_1m, stock, description, image } = body;
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
            return jsonResponse(updated, 200);
        }

        if (request.method === 'DELETE') {
            const queryId = url.searchParams.get('id');
            const rawId = queryId ? String(queryId).replace('eq.', '') : body.id;
            if (!rawId) return jsonResponse({ error: 'ID produk wajib disertakan' }, 400);

            await sql`DELETE FROM products WHERE id = ${Number(rawId)}`;
            return jsonResponse({ success: true }, 200);
        }

        return jsonResponse({ error: 'Method tidak diizinkan' }, 405);
    } catch (error) {
        return jsonResponse({ error: error.message || 'Terjadi kesalahan pada server Cloudflare' }, 500);
    }
}
