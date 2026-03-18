/**
 * Office Admin Portal — Backend API (Final)
 * Dynamic floors stored in DB — add/rename/remove floors any time.
 */

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  credentials: true
}));

const pool = new Pool({
  connectionString: process.env.Database,
  ssl: { rejectUnauthorized: false }
});

/* ── auto-migrate: create tables if not exist ── */
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS floors (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS grocery_items (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL UNIQUE,
      unit       VARCHAR(20) NOT NULL,
      category   VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS grocery_purchases (
      id         SERIAL PRIMARY KEY,
      item_id    INTEGER NOT NULL REFERENCES grocery_items(id) ON DELETE CASCADE,
      month      SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
      year       SMALLINT NOT NULL,
      qty        DECIMAL(10,2) NOT NULL,
      price      DECIMAL(10,2) DEFAULT 0,
      vendor     VARCHAR(100),
      date       DATE,
      notes      TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (item_id, month, year)
    );

    CREATE TABLE IF NOT EXISTS floor_distributions (
      id          SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES grocery_purchases(id) ON DELETE CASCADE,
      floor_id    INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      qty         DECIMAL(10,2) NOT NULL DEFAULT 0,
      UNIQUE (purchase_id, floor_id)
    );

    CREATE TABLE IF NOT EXISTS spend_categories (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL UNIQUE,
      color      VARCHAR(7) DEFAULT '#6366f1',
      icon       VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS monthly_budgets (
      id            SERIAL PRIMARY KEY,
      category_id   INTEGER NOT NULL REFERENCES spend_categories(id) ON DELETE CASCADE,
      month         SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
      year          SMALLINT NOT NULL,
      budget_amount DECIMAL(12,2) NOT NULL,
      notes         TEXT,
      created_at    TIMESTAMP DEFAULT NOW(),
      UNIQUE (category_id, month, year)
    );

    CREATE TABLE IF NOT EXISTS spend_entries (
      id           SERIAL PRIMARY KEY,
      category_id  INTEGER REFERENCES spend_categories(id) ON DELETE SET NULL,
      spend_date   DATE NOT NULL,
      amount       DECIMAL(12,2) NOT NULL,
      purpose      TEXT NOT NULL,
      payment_mode VARCHAR(30) DEFAULT 'cash',
      vendor       VARCHAR(100),
      invoice_ref  VARCHAR(100),
      approved_by  VARCHAR(100),
      notes        TEXT,
      created_at   TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS grocery_categories (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  /* seed default floors if empty */
  const fc = await pool.query('SELECT COUNT(*) FROM floors');
  if (parseInt(fc.rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO floors (name, sort_order) VALUES
        ('Floor 1',1),('Floor 2',2),('Floor 3',3),('Floor 4',4),('Floor 5',5)
    `);
  }

  /* seed default categories if empty */
  const cc = await pool.query('SELECT COUNT(*) FROM spend_categories');
  if (parseInt(cc.rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO spend_categories (name,color,icon) VALUES
        ('Groceries & Supplies','#10b981','🛒'),
        ('Maintenance & Repairs','#f59e0b','🔧'),
        ('Utilities','#3b82f6','💡'),
        ('Housekeeping','#8b5cf6','🧹'),
        ('Office Supplies','#06b6d4','📦'),
        ('Transportation','#ec4899','🚗'),
        ('Miscellaneous','#6b7280','📋')
    `);
  }

  /* seed default grocery items if empty */
  const ic = await pool.query('SELECT COUNT(*) FROM grocery_items');
  if (parseInt(ic.rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO grocery_items (name,unit,category) VALUES
        ('Rice','kg','food'),('Sugar','kg','food'),('Tea','kg','food'),
        ('Coffee','kg','food'),('Cooking Oil','litre','food'),
        ('Detergent','kg','cleaning'),('Toilet Paper','rolls','cleaning'),
        ('Hand Sanitizer','litre','cleaning'),('Garbage Bags','packs','cleaning')
    `);
  }

  /* seed default grocery categories if empty */
  const gc = await pool.query('SELECT COUNT(*) FROM grocery_categories');
  if (parseInt(gc.rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO grocery_categories (name) VALUES
        ('food'),('cleaning'),('stationary'),('miscellaneous')
    `);
  }

  console.log('✅ Migration complete');
}

/* ── health ── */
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status:'ok', db:'connected', time:new Date().toISOString() }); }
  catch (e) { res.status(500).json({ status:'error', message:e.message }); }
});

/* ══════════════════════════════════════════
   FLOORS
══════════════════════════════════════════ */

app.get('/api/floors', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM floors ORDER BY sort_order, id')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/floors', async (req, res) => {
  const { name } = req.body;
  try {
    const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order),0) AS m FROM floors');
    const r = await pool.query(
      'INSERT INTO floors (name, sort_order) VALUES ($1, $2) RETURNING *',
      [name, parseInt(maxOrder.rows[0].m) + 1]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/floors/:id', async (req, res) => {
  const { name } = req.body;
  try {
    const r = await pool.query('UPDATE floors SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/floors/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM floors WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════
   GROCERY — CATEGORIES
══════════════════════════════════════════ */

app.get('/api/grocery/categories', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM grocery_categories ORDER BY name')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grocery/categories', async (req, res) => {
  const { name } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO grocery_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *',
      [name.trim().toLowerCase()]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/grocery/categories/:id', async (req, res) => {
  const { name } = req.body;
  try {
    const r = await pool.query(
      'UPDATE grocery_categories SET name=$1 WHERE id=$2 RETURNING *',
      [name.trim().toLowerCase(), req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/grocery/categories/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM grocery_categories WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════
   GROCERY — ITEMS
══════════════════════════════════════════ */

app.get('/api/grocery/items', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM grocery_items ORDER BY name')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grocery/items', async (req, res) => {
  const { name, unit, category } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO grocery_items (name,unit,category) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET unit=EXCLUDED.unit,category=EXCLUDED.category RETURNING *',
      [name, unit, category]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/grocery/items/:id', async (req, res) => {
  const { name, unit, category } = req.body;
  try {
    const r = await pool.query('UPDATE grocery_items SET name=$1,unit=$2,category=$3 WHERE id=$4 RETURNING *', [name,unit,category,req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/grocery/items/:id', async (req, res) => {
  try { await pool.query('DELETE FROM grocery_items WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════
   GROCERY — PURCHASES  (dynamic floors)
══════════════════════════════════════════ */

app.get('/api/grocery/purchases', async (req, res) => {
  const { month, year } = req.query;
  try {
    let q = `
      SELECT gp.id, gi.name AS item_name, gi.unit, gi.category,
        gp.item_id, gp.month, gp.year, gp.qty, gp.price,
        ROUND(gp.qty * gp.price, 2) AS total_cost,
        gp.vendor, gp.date, gp.notes,
        COALESCE((SELECT SUM(fd.qty) FROM floor_distributions fd WHERE fd.purchase_id=gp.id), 0) AS total_dist,
        gp.qty - COALESCE((SELECT SUM(fd.qty) FROM floor_distributions fd WHERE fd.purchase_id=gp.id), 0) AS remaining,
        COALESCE((
          SELECT json_agg(json_build_object('floor_id',fd.floor_id,'floor_name',f.name,'qty',fd.qty) ORDER BY f.sort_order)
          FROM floor_distributions fd JOIN floors f ON f.id=fd.floor_id WHERE fd.purchase_id=gp.id
        ), '[]'::json) AS floor_breakdown
      FROM grocery_purchases gp
      JOIN grocery_items gi ON gi.id=gp.item_id
      WHERE 1=1`;
    const params = [];
    if (month) { params.push(month); q += ` AND gp.month=$${params.length}`; }
    if (year)  { params.push(year);  q += ` AND gp.year=$${params.length}`; }
    q += ' ORDER BY gp.year DESC, gp.month DESC, gi.name';
    res.json((await pool.query(q, params)).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST — body: { item_id, month, year, qty, price, vendor, date, notes,
                  floors: [ {floor_id, qty}, ... ] } */
app.post('/api/grocery/purchases', async (req, res) => {
  const { item_id, month, year, qty, price, vendor, date, notes, floors = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* upsert purchase */
    const r = await client.query(`
      INSERT INTO grocery_purchases (item_id,month,year,qty,price,vendor,date,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (item_id,month,year) DO UPDATE SET
        qty=EXCLUDED.qty, price=EXCLUDED.price, vendor=EXCLUDED.vendor,
        date=EXCLUDED.date, notes=EXCLUDED.notes
      RETURNING *`,
      [item_id, month, year, qty, price||0, vendor, date, notes]
    );
    const purchaseId = r.rows[0].id;

    /* replace all distributions */
    await client.query('DELETE FROM floor_distributions WHERE purchase_id=$1', [purchaseId]);
    for (const f of floors) {
      if (Number(f.qty) > 0) {
        await client.query(
          'INSERT INTO floor_distributions (purchase_id,floor_id,qty) VALUES ($1,$2,$3)',
          [purchaseId, f.floor_id, f.qty]
        );
      }
    }

    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.delete('/api/grocery/purchases/:id', async (req, res) => {
  try { await pool.query('DELETE FROM grocery_purchases WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/grocery/stats', async (req, res) => {
  const { month, year } = req.query;
  try {
    const summary = await pool.query(`
      SELECT COUNT(*) AS total_items,
        COALESCE(SUM(qty*price),0) AS total_cost,
        COALESCE(SUM(qty),0) AS total_qty,
        COALESCE((SELECT SUM(fd.qty) FROM floor_distributions fd JOIN grocery_purchases gp ON gp.id=fd.purchase_id WHERE gp.month=$1 AND gp.year=$2),0) AS total_dist,
        COALESCE(SUM(qty),0) - COALESCE((SELECT SUM(fd.qty) FROM floor_distributions fd JOIN grocery_purchases gp ON gp.id=fd.purchase_id WHERE gp.month=$1 AND gp.year=$2),0) AS total_remaining
      FROM grocery_purchases WHERE month=$1 AND year=$2`, [month, year]);

    const floorStats = await pool.query(`
      SELECT f.id AS floor_id, f.name AS floor_name, f.sort_order,
        COALESCE(SUM(fd.qty),0) AS total_assigned
      FROM floors f
      LEFT JOIN floor_distributions fd ON fd.floor_id=f.id
      LEFT JOIN grocery_purchases gp ON gp.id=fd.purchase_id AND gp.month=$1 AND gp.year=$2
      GROUP BY f.id, f.name, f.sort_order
      ORDER BY f.sort_order`, [month, year]);

    res.json({ summary: summary.rows[0], floorStats: floorStats.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════
   BUDGET — CATEGORIES
══════════════════════════════════════════ */

app.get('/api/budget/categories', async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM spend_categories ORDER BY name')).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/budget/categories', async (req, res) => {
  const { name, color, icon } = req.body;
  try {
    const r = await pool.query('INSERT INTO spend_categories (name,color,icon) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET color=EXCLUDED.color,icon=EXCLUDED.icon RETURNING *', [name,color||'#6366f1',icon]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/budget/categories/:id', async (req, res) => {
  const { name, color, icon } = req.body;
  try {
    const r = await pool.query('UPDATE spend_categories SET name=$1,color=$2,icon=$3 WHERE id=$4 RETURNING *', [name,color,icon,req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/budget/categories/:id', async (req, res) => {
  try { await pool.query('DELETE FROM spend_categories WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════
   BUDGET — MONTHLY BUDGETS
══════════════════════════════════════════ */

app.get('/api/budget/monthly', async (req, res) => {
  const { month, year } = req.query;
  try {
    const r = await pool.query('SELECT mb.*, sc.name AS category_name, sc.color, sc.icon FROM monthly_budgets mb JOIN spend_categories sc ON sc.id=mb.category_id WHERE mb.month=$1 AND mb.year=$2', [month,year]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/budget/monthly', async (req, res) => {
  const { category_id, month, year, budget_amount, notes } = req.body;
  try {
    const r = await pool.query('INSERT INTO monthly_budgets (category_id,month,year,budget_amount,notes) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (category_id,month,year) DO UPDATE SET budget_amount=EXCLUDED.budget_amount,notes=EXCLUDED.notes RETURNING *', [category_id,month,year,budget_amount,notes]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/budget/monthly/:id', async (req, res) => {
  try { await pool.query('DELETE FROM monthly_budgets WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════
   BUDGET — SPEND ENTRIES
══════════════════════════════════════════ */

app.get('/api/budget/spends', async (req, res) => {
  const { month, year, category_id } = req.query;
  try {
    let q = `SELECT se.*, sc.name AS category_name, sc.color AS category_color, sc.icon AS category_icon FROM spend_entries se LEFT JOIN spend_categories sc ON sc.id=se.category_id WHERE EXTRACT(MONTH FROM se.spend_date)=$1 AND EXTRACT(YEAR FROM se.spend_date)=$2`;
    const params = [month, year];
    if (category_id) { params.push(category_id); q += ` AND se.category_id=$${params.length}`; }
    q += ' ORDER BY se.spend_date DESC, se.id DESC';
    const rows = (await pool.query(q, params)).rows;
    res.json(rows.map(s => ({ ...s, date:s.spend_date, amt:s.amount, cat:s.category_id, mode:s.payment_mode, approved:s.approved_by })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/budget/spends', async (req, res) => {
  const { cat, date, amt, purpose, mode, vendor, invoice, approved, notes } = req.body;
  try {
    const r = await pool.query('INSERT INTO spend_entries (category_id,spend_date,amount,purpose,payment_mode,vendor,invoice_ref,approved_by,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [cat||null,date,amt,purpose,mode||'cash',vendor,invoice,approved,notes]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/budget/spends/:id', async (req, res) => {
  const { cat, date, amt, purpose, mode, vendor, invoice, approved, notes } = req.body;
  try {
    const r = await pool.query('UPDATE spend_entries SET category_id=$1,spend_date=$2,amount=$3,purpose=$4,payment_mode=$5,vendor=$6,invoice_ref=$7,approved_by=$8,notes=$9 WHERE id=$10 RETURNING *', [cat||null,date,amt,purpose,mode||'cash',vendor,invoice,approved,notes,req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/budget/spends/:id', async (req, res) => {
  try { await pool.query('DELETE FROM spend_entries WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/budget/stats', async (req, res) => {
  const { month, year } = req.query;
  try {
    const totals = await pool.query(`SELECT COALESCE((SELECT SUM(budget_amount) FROM monthly_budgets WHERE month=$1 AND year=$2),0) AS total_budget, COALESCE((SELECT SUM(amount) FROM spend_entries WHERE EXTRACT(MONTH FROM spend_date)=$1 AND EXTRACT(YEAR FROM spend_date)=$2),0) AS total_spent`, [month,year]);
    const byCategory = await pool.query(`SELECT sc.name,sc.color,sc.icon, COALESCE(mb.budget_amount,0) AS budget, COALESCE(SUM(se.amount),0) AS spent FROM spend_categories sc LEFT JOIN monthly_budgets mb ON mb.category_id=sc.id AND mb.month=$1 AND mb.year=$2 LEFT JOIN spend_entries se ON se.category_id=sc.id AND EXTRACT(MONTH FROM se.spend_date)=$1 AND EXTRACT(YEAR FROM se.spend_date)=$2 GROUP BY sc.id,sc.name,sc.color,sc.icon,mb.budget_amount ORDER BY spent DESC`, [month,year]);
    const weekly = await pool.query(`SELECT CEIL(EXTRACT(DAY FROM spend_date)/7.0)::int AS week_num, SUM(amount) AS total FROM spend_entries WHERE EXTRACT(MONTH FROM spend_date)=$1 AND EXTRACT(YEAR FROM spend_date)=$2 GROUP BY week_num ORDER BY week_num`, [month,year]);
    const byPayment = await pool.query(`SELECT payment_mode, SUM(amount) AS total, COUNT(*) AS count FROM spend_entries WHERE EXTRACT(MONTH FROM spend_date)=$1 AND EXTRACT(YEAR FROM spend_date)=$2 GROUP BY payment_mode ORDER BY total DESC`, [month,year]);
    res.json({ totals:totals.rows[0], byCategory:byCategory.rows, weekly:weekly.rows, byPayment:byPayment.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
migrate().then(() => {
  app.listen(PORT, () => console.log(`\n✅  Office Admin API → http://localhost:${PORT}/api/health\n`));
}).catch(e => { console.error('Migration failed:', e); process.exit(1); });

module.exports = app;
