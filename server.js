/**
 * Office Admin Portal — Backend API
 * Node.js + Express + PostgreSQL
 *
 * Start: node server.js
 * Requires: DATABASE_URL in .env  (see .env.example)
 */

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/office_admin',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/* ─── health check ─── */
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

/* ══════════════════════════════════════════════
   GROCERY — ITEMS
══════════════════════════════════════════════ */

app.get('/api/grocery/items', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM grocery_items ORDER BY name');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grocery/items', async (req, res) => {
  const { name, unit, category } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO grocery_items (name, unit, category) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET unit=EXCLUDED.unit, category=EXCLUDED.category RETURNING *',
      [name, unit, category]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════════
   GROCERY — PURCHASES  (floors saved inline)
══════════════════════════════════════════════ */

app.get('/api/grocery/purchases', async (req, res) => {
  const { month, year } = req.query;
  try {
    let q = `
      SELECT
        gp.id,
        gi.name  AS item_name,
        gi.unit,
        gi.category,
        gp.item_id,
        gp.month,
        gp.year,
        gp.qty,
        gp.price,
        gp.qty * gp.price                                              AS total_cost,
        gp.vendor,
        gp.date,
        gp.notes,
        COALESCE(gp.floor1,0) + COALESCE(gp.floor2,0) + COALESCE(gp.floor3,0) +
          COALESCE(gp.floor4,0) + COALESCE(gp.floor5,0)               AS total_dist,
        gp.qty - (COALESCE(gp.floor1,0) + COALESCE(gp.floor2,0) + COALESCE(gp.floor3,0) +
          COALESCE(gp.floor4,0) + COALESCE(gp.floor5,0))              AS remaining,
        json_build_array(
          json_build_object('floor',1,'qty',COALESCE(gp.floor1,0)),
          json_build_object('floor',2,'qty',COALESCE(gp.floor2,0)),
          json_build_object('floor',3,'qty',COALESCE(gp.floor3,0)),
          json_build_object('floor',4,'qty',COALESCE(gp.floor4,0)),
          json_build_object('floor',5,'qty',COALESCE(gp.floor5,0))
        )                                                               AS floor_breakdown
      FROM grocery_purchases gp
      JOIN grocery_items gi ON gi.id = gp.item_id
      WHERE 1=1`;
    const params = [];
    if (month) { params.push(month); q += ` AND gp.month = $${params.length}`; }
    if (year)  { params.push(year);  q += ` AND gp.year  = $${params.length}`; }
    q += ' ORDER BY gp.year DESC, gp.month DESC, gi.name';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST — create/update purchase (floors included in body as { 1:x, 2:x, 3:x, 4:x, 5:x }) */
app.post('/api/grocery/purchases', async (req, res) => {
  const { item_id, month, year, qty, price, vendor, date, notes, floors = {} } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO grocery_purchases
        (item_id, month, year, qty, price, vendor, date, notes, floor1, floor2, floor3, floor4, floor5)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (item_id, month, year) DO UPDATE SET
        qty    = EXCLUDED.qty,
        price  = EXCLUDED.price,
        vendor = EXCLUDED.vendor,
        date   = EXCLUDED.date,
        notes  = EXCLUDED.notes,
        floor1 = EXCLUDED.floor1,
        floor2 = EXCLUDED.floor2,
        floor3 = EXCLUDED.floor3,
        floor4 = EXCLUDED.floor4,
        floor5 = EXCLUDED.floor5
      RETURNING *`,
      [item_id, month, year, qty, price||0, vendor, date, notes,
       floors[1]||0, floors[2]||0, floors[3]||0, floors[4]||0, floors[5]||0]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/grocery/purchases/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM grocery_purchases WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Stats endpoint */
app.get('/api/grocery/stats', async (req, res) => {
  const { month, year } = req.query;
  try {
    const summary = await pool.query(`
      SELECT
        COUNT(*)                                                           AS total_items,
        COALESCE(SUM(qty * price), 0)                                     AS total_cost,
        COALESCE(SUM(qty), 0)                                             AS total_qty,
        COALESCE(SUM(COALESCE(floor1,0)+COALESCE(floor2,0)+COALESCE(floor3,0)+COALESCE(floor4,0)+COALESCE(floor5,0)), 0) AS total_dist,
        COALESCE(SUM(qty) - SUM(COALESCE(floor1,0)+COALESCE(floor2,0)+COALESCE(floor3,0)+COALESCE(floor4,0)+COALESCE(floor5,0)), 0) AS total_remaining
      FROM grocery_purchases WHERE month=$1 AND year=$2`, [month, year]);

    const floorStats = await pool.query(`
      SELECT
        1 AS floor_number, COALESCE(SUM(floor1),0) AS total_assigned FROM grocery_purchases WHERE month=$1 AND year=$2
      UNION ALL SELECT 2, COALESCE(SUM(floor2),0) FROM grocery_purchases WHERE month=$1 AND year=$2
      UNION ALL SELECT 3, COALESCE(SUM(floor3),0) FROM grocery_purchases WHERE month=$1 AND year=$2
      UNION ALL SELECT 4, COALESCE(SUM(floor4),0) FROM grocery_purchases WHERE month=$1 AND year=$2
      UNION ALL SELECT 5, COALESCE(SUM(floor5),0) FROM grocery_purchases WHERE month=$1 AND year=$2
      ORDER BY floor_number`, [month, year]);

    res.json({ summary: summary.rows[0], floorStats: floorStats.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════════
   BUDGET — CATEGORIES
══════════════════════════════════════════════ */

app.get('/api/budget/categories', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM spend_categories ORDER BY name');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/budget/categories', async (req, res) => {
  const { name, color, icon } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO spend_categories (name,color,icon) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET color=EXCLUDED.color, icon=EXCLUDED.icon RETURNING *',
      [name, color||'#6366f1', icon]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════════
   BUDGET — MONTHLY TARGETS
══════════════════════════════════════════════ */

app.get('/api/budget/monthly', async (req, res) => {
  const { month, year } = req.query;
  try {
    const r = await pool.query(`
      SELECT mb.*, sc.name AS category_name, sc.color, sc.icon
      FROM monthly_budgets mb
      JOIN spend_categories sc ON sc.id = mb.category_id
      WHERE mb.month=$1 AND mb.year=$2`, [month, year]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/budget/monthly', async (req, res) => {
  const { category_id, month, year, budget_amount, notes } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO monthly_budgets (category_id, month, year, budget_amount, notes)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (category_id, month, year) DO UPDATE SET
        budget_amount = EXCLUDED.budget_amount, notes = EXCLUDED.notes
      RETURNING *`, [category_id, month, year, budget_amount, notes]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════════
   BUDGET — SPEND ENTRIES
══════════════════════════════════════════════ */

app.get('/api/budget/spends', async (req, res) => {
  const { month, year, category_id } = req.query;
  try {
    let q = `
      SELECT se.*, sc.name AS category_name, sc.color AS category_color, sc.icon AS category_icon
      FROM spend_entries se
      LEFT JOIN spend_categories sc ON sc.id = se.category_id
      WHERE EXTRACT(MONTH FROM se.spend_date)=$1 AND EXTRACT(YEAR FROM se.spend_date)=$2`;
    const params = [month, year];
    if (category_id) { params.push(category_id); q += ` AND se.category_id=$${params.length}`; }
    q += ' ORDER BY se.spend_date DESC, se.id DESC';
    const r = await pool.query(q, params);
    // normalise field names to match frontend expectations
    res.json(r.rows.map(s => ({
      ...s,
      date: s.spend_date,
      amt:  s.amount,
      cat:  s.category_id,
      mode: s.payment_mode,
      approved: s.approved_by
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/budget/spends', async (req, res) => {
  const { cat, date, amt, purpose, mode, vendor, invoice, approved, notes } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO spend_entries
        (category_id, spend_date, amount, purpose, payment_mode, vendor, invoice_ref, approved_by, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [cat||null, date, amt, purpose, mode||'cash', vendor, invoice, approved, notes]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/budget/spends/:id', async (req, res) => {
  const { cat, date, amt, purpose, mode, vendor, invoice, approved, notes } = req.body;
  try {
    const r = await pool.query(`
      UPDATE spend_entries SET
        category_id=$1, spend_date=$2, amount=$3, purpose=$4,
        payment_mode=$5, vendor=$6, invoice_ref=$7, approved_by=$8, notes=$9
      WHERE id=$10 RETURNING *`,
      [cat||null, date, amt, purpose, mode||'cash', vendor, invoice, approved, notes, req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/budget/spends/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM spend_entries WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Stats */
app.get('/api/budget/stats', async (req, res) => {
  const { month, year } = req.query;
  try {
    const totals = await pool.query(`
      SELECT
        COALESCE((SELECT SUM(budget_amount) FROM monthly_budgets WHERE month=$1 AND year=$2),0) AS total_budget,
        COALESCE((SELECT SUM(amount) FROM spend_entries WHERE EXTRACT(MONTH FROM spend_date)=$1 AND EXTRACT(YEAR FROM spend_date)=$2),0) AS total_spent`,
      [month, year]);

    const byCategory = await pool.query(`
      SELECT sc.name, sc.color, sc.icon,
        COALESCE(mb.budget_amount,0) AS budget,
        COALESCE(SUM(se.amount),0)  AS spent
      FROM spend_categories sc
      LEFT JOIN monthly_budgets mb ON mb.category_id=sc.id AND mb.month=$1 AND mb.year=$2
      LEFT JOIN spend_entries se ON se.category_id=sc.id
        AND EXTRACT(MONTH FROM se.spend_date)=$1 AND EXTRACT(YEAR FROM se.spend_date)=$2
      GROUP BY sc.id,sc.name,sc.color,sc.icon,mb.budget_amount
      HAVING COALESCE(mb.budget_amount,0)>0 OR COALESCE(SUM(se.amount),0)>0
      ORDER BY spent DESC`, [month, year]);

    const weekly = await pool.query(`
      SELECT CEIL(EXTRACT(DAY FROM spend_date)/7.0)::int AS week_num, SUM(amount) AS total
      FROM spend_entries
      WHERE EXTRACT(MONTH FROM spend_date)=$1 AND EXTRACT(YEAR FROM spend_date)=$2
      GROUP BY week_num ORDER BY week_num`, [month, year]);

    const byPayment = await pool.query(`
      SELECT payment_mode, SUM(amount) AS total, COUNT(*) AS count
      FROM spend_entries
      WHERE EXTRACT(MONTH FROM spend_date)=$1 AND EXTRACT(YEAR FROM spend_date)=$2
      GROUP BY payment_mode ORDER BY total DESC`, [month, year]);

    res.json({
      totals:     totals.rows[0],
      byCategory: byCategory.rows,
      weekly:     weekly.rows,
      byPayment:  byPayment.rows
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── start ─── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`\n✅  Office Admin API → http://localhost:${PORT}/api/health\n`));
module.exports = app;
