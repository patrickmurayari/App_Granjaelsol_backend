CREATE TABLE IF NOT EXISTS card_settlements (
  id                      SERIAL PRIMARY KEY,
  liquidation_number      TEXT        NOT NULL UNIQUE,
  payment_date            DATE,
  presentation_date       DATE,
  card_type               TEXT,
  gross_amount            NUMERIC(14, 2) DEFAULT 0,
  net_amount              NUMERIC(14, 2) DEFAULT 0,
  arancel_amount          NUMERIC(14, 2) DEFAULT 0,
  iva_amount              NUMERIC(14, 2) DEFAULT 0,
  tax_withholding_amount  NUMERIC(14, 2) DEFAULT 0,
  financial_cost_amount   NUMERIC(14, 2) DEFAULT 0,
  created_at              TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_settlements_payment_date
  ON card_settlements (payment_date);

CREATE INDEX IF NOT EXISTS idx_card_settlements_card_type
  ON card_settlements (card_type);
