import { neon } from '@neondatabase/serverless';

export async function onRequest(context) {
    const { request, env } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Prefer',
        'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!env.DATABASE_URL) {
        return new Response(JSON.stringify({ error: 'DATABASE_URL belum dikonfigurasi di Cloudflare Pages.' }), {
            status: 500,
            headers: corsHeaders
        });
    }

    const sql = neon(env.DATABASE_URL);
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
        // ==========================================
        // A. ROYAL LOYALTY & MEMBER ENDPOINTS
        // ==========================================
        if (action === 'get_member_profile' && request.method === 'GET') {
            const username = (url.searchParams.get('username') || '').trim().toLowerCase();
            if (!username) {
                return new Response(JSON.stringify({ error: 'Username diperlukan' }), { status: 400, headers: corsHeaders });
            }
            const rows = await sql`SELECT username, stamps FROM royal_members WHERE LOWER(username) = ${username} LIMIT 1`;
            if (rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Akun member tidak ditemukan' }), { status: 404, headers: corsHeaders });
            }
            return new Response(JSON.stringify(rows[0]), { status: 200, headers: corsHeaders });
        }

        if (action === 'login_member' && request.method === 'POST') {
            const { username, password } = await request.json();
            const cleanUser = (username || '').trim().toLowerCase();
            const rows = await sql`SELECT username, password, stamps FROM royal_members WHERE LOWER(username) = ${cleanUser} LIMIT 1`;
            if (rows.length === 0 || rows[0].password !== password) {
                return new Response(JSON.stringify({ error: 'Username atau password salah!' }), { status: 401, headers: corsHeaders });
            }
            return new Response(JSON.stringify({ username: rows[0].username, stamps: rows[0].stamps }), { status: 200, headers: corsHeaders });
        }

        if (action === 'change_password' && request.method === 'PATCH') {
            const { username, oldPassword, newPassword } = await request.json();
            const cleanUser = (username || '').trim().toLowerCase();
            const rows = await sql`SELECT password FROM royal_members WHERE LOWER(username) = ${cleanUser} LIMIT 1`;
            if (rows.length === 0 || rows[0].password !== oldPassword) {
                return new Response(JSON.stringify({ error: 'Password lama tidak sesuai!' }), { status: 401, headers: corsHeaders });
            }
            await sql`UPDATE royal_members SET password = ${newPassword} WHERE LOWER(username) = ${cleanUser}`;
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        if (action === 'claim_stamp' && request.method === 'POST') {
            const { username, code } = await request.json();
            const cleanUser = (username || '').trim().toLowerCase();
            const cleanCode = (code || '').trim().toUpperCase();

            const memberRows = await sql`SELECT username, stamps FROM royal_members WHERE LOWER(username) = ${cleanUser} LIMIT 1`;
            if (memberRows.length === 0) {
                return new Response(JSON.stringify({ error: 'Member tidak ditemukan' }), { status: 404, headers: corsHeaders });
            }
            if (memberRows[0].stamps >= 10) {
                return new Response(JSON.stringify({ error: 'Lencana sudah penuh (10/10)! Klaim hadiah Anda terlebih dahulu.' }), { status: 400, headers: corsHeaders });
            }

            const codeRows = await sql`SELECT code, is_used FROM stamp_codes WHERE UPPER(code) = ${cleanCode} LIMIT 1`;
            if (codeRows.length === 0) {
                return new Response(JSON.stringify({ error: 'Kode redeem tidak valid!' }), { status: 404, headers: corsHeaders });
            }
            if (codeRows[0].is_used) {
                return new Response(JSON.stringify({ error: 'Kode redeem ini sudah pernah digunakan!' }), { status: 400, headers: corsHeaders });
            }

            const newStamps = memberRows[0].stamps + 1;
            await sql`UPDATE stamp_codes SET is_used = true, used_by = ${memberRows[0].username}, used_at = NOW() WHERE UPPER(code) = ${cleanCode}`;
            await sql`UPDATE royal_members SET stamps = ${newStamps} WHERE LOWER(username) = ${cleanUser}`;

            return new Response(JSON.stringify({ success: true, stamps: newStamps }), { status: 200, headers: corsHeaders });
        }

        if (action === 'redeem_reward' && request.method === 'POST') {
            const { username } = await request.json();
            const cleanUser = (username || '').trim().toLowerCase();
            await sql`UPDATE royal_members SET stamps = 0 WHERE LOWER(username) = ${cleanUser}`;
            return new Response(JSON.stringify({ success: true, stamps: 0 }), { status: 200, headers: corsHeaders });
        }

        // ==========================================
        // B. KATALOG PRODUK CRUD ENDPOINTS
        // ==========================================
        if (request.method === 'GET') {
            const products = await sql`SELECT * FROM products ORDER BY id ASC`;
            return new Response(JSON.stringify(products), { status: 200, headers: corsHeaders });
        }

        if (request.method === 'POST') {
            const body = await request.json();
            const inserted = await sql`
                INSERT INTO products (name, category, price, price_3d, price_7d, price_1m, stock, image, description)
                VALUES (${body.name}, ${body.category}, ${body.price || 0}, ${body.price_3d || 0}, ${body.price_7d || 0}, ${body.price_1m || 0}, ${body.stock || 0}, ${body.image || ''}, ${body.description || ''})
                RETURNING *
            `;
            return new Response(JSON.stringify(inserted), { status: 201, headers: corsHeaders });
        }

        if (request.method === 'PATCH') {
            const idParam = url.searchParams.get('id') || '';
            const id = idParam.replace('eq.', '');
            const body = await request.json();

            const updated = await sql`
                UPDATE products
                SET
                    name = COALESCE(${body.name ?? null}, name),
                    category = COALESCE(${body.category ?? null}, category),
                    price = COALESCE(${body.price ?? null}, price),
                    price_3d = COALESCE(${body.price_3d ?? null}, price_3d),
                    price_7d = COALESCE(${body.price_7d ?? null}, price_7d),
                    price_1m = COALESCE(${body.price_1m ?? null}, price_1m),
                    stock = COALESCE(${body.stock ?? null}, stock),
                    image = COALESCE(${body.image ?? null}, image),
                    description = COALESCE(${body.description ?? null}, description)
                WHERE id = ${id}
                RETURNING *
            `;
            return new Response(JSON.stringify(updated), { status: 200, headers: corsHeaders });
        }

        if (request.method === 'DELETE') {
            const idParam = url.searchParams.get('id') || '';
            const id = idParam.replace('eq.', '');
            await sql`DELETE FROM products WHERE id = ${id}`;
            return new Response(JSON.stringify({ deleted: true }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: 'Method tidak didukung' }), { status: 405, headers: corsHeaders });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}
