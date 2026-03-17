-- ============================================================
-- OFFICE ADMIN PORTAL  —  PostgreSQL Schema  v2
-- Floors stored as columns directly on grocery_purchases
-- (simpler, faster, no JOIN needed for distribution data)
-- ============================================================

-- Run:  psql -U postgres -d office_admin -f schema.sql

-- ── Grocery items master catalog ──
CREATE TABLE IF NOT EXISTS grocery_items (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  unit        VARCHAR(20)  NOT NULL,           -- kg, litre, pieces, rolls, etc.
  category    VARCHAR(50),                     -- food, cleaning, stationary, misc
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ── Monthly bulk purchases  (one row per item per month) ──
CREATE TABLE IF NOT EXISTS grocery_purchases (
  id          SERIAL PRIMARY KEY,
  item_id     INTEGER      NOT NULL REFERENCES grocery_items(id) ON DELETE CASCADE,
  month       SMALLINT     NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        SMALLINT     NOT NULL,
  qty         NUMERIC(10,2) NOT NULL,          -- total quantity purchased
  price       NUMERIC(10,2) DEFAULT 0,         -- unit price
  vendor      VARCHAR(100),
  date        DATE,
  notes       TEXT,
  -- Floor distributions (stored inline — no separate join needed)
  floor1      NUMERIC(10,2) DEFAULT 0,
  floor2      NUMERIC(10,2) DEFAULT 0,
  floor3      NUMERIC(10,2) DEFAULT 0,
  floor4      NUMERIC(10,2) DEFAULT 0,
  floor5      NUMERIC(10,2) DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (item_id, month, year)
);

-- ── Spend categories ──
CREATE TABLE IF NOT EXISTS spend_categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  color       VARCHAR(7)   DEFAULT '#6366f1',
  icon        VARCHAR(20),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ── Monthly budget targets per category ──
CREATE TABLE IF NOT EXISTS monthly_budgets (
  id              SERIAL PRIMARY KEY,
  category_id     INTEGER NOT NULL REFERENCES spend_categories(id) ON DELETE CASCADE,
  month           SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year            SMALLINT NOT NULL,
  budget_amount   NUMERIC(12,2) NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (category_id, month, year)
);

-- ── Individual spend entries ──
CREATE TABLE IF NOT EXISTS spend_entries (
  id              SERIAL PRIMARY KEY,
  category_id     INTEGER REFERENCES spend_categories(id) ON DELETE SET NULL,
  spend_date      DATE NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  purpose         TEXT NOT NULL,
  payment_mode    VARCHAR(30) DEFAULT 'cash',  -- cash,card,upi,cheque,bank_transfer,other
  vendor          VARCHAR(100),
  invoice_ref     VARCHAR(100),
  approved_by     VARCHAR(100),
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── Useful indexes ──
CREATE INDEX IF NOT EXISTS idx_gp_month_year    ON grocery_purchases (month, year);
CREATE INDEX IF NOT EXISTS idx_se_spend_date    ON spend_entries (spend_date);
CREATE INDEX IF NOT EXISTS idx_se_category      ON spend_entries (category_id);
CREATE INDEX IF NOT EXISTS idx_mb_month_year    ON monthly_budgets (month, year);

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO grocery_items (name, unit, category) VALUES
  ('Rice',            'kg',     'food'),
  ('Sugar',           'kg',     'food'),
  ('Tea',             'kg',     'food'),
  ('Coffee',          'kg',     'food'),
  ('Cooking Oil',     'litre',  'food'),
  ('Soap',            'pieces', 'cleaning'),
  ('Detergent',       'kg',     'cleaning'),
  ('Toilet Paper',    'rolls',  'cleaning'),
  ('Hand Sanitizer',  'litre',  'cleaning'),
  ('Garbage Bags',    'packs',  'cleaning')
ON CONFLICT (name) DO NOTHING;

INSERT INTO spend_categories (name, color, icon) VALUES
  ('Groceries & Supplies',  '#10b981', '🛒'),
  ('Maintenance & Repairs', '#f59e0b', '🔧'),
  ('Utilities',             '#3b82f6', '💡'),
  ('Housekeeping',          '#8b5cf6', '🧹'),
  ('Office Supplies',       '#06b6d4', '📦'),
  ('Transportation',        '#ec4899', '🚗'),
  ('Miscellaneous',         '#6b7280', '📋')
ON CONFLICT (name) DO NOTHING;
