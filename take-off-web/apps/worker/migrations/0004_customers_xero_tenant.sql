-- Tenant-scope customers so a Xero reconnect to a different tenant doesn't
-- leave stale ContactIDs in `customers` that recallCustomer/push would
-- silently surface against the wrong tenant. syncXeroContacts stamps this
-- on every row; recallCustomer + pushToXero filter by the active tenant.
ALTER TABLE customers ADD COLUMN xero_tenant_id TEXT;

-- Backfill: tag every existing Xero-synced customer with the currently
-- active tenant (the only one connected at the time this migration runs).
-- Manual-only rows stay NULL and continue to surface for any tenant.
UPDATE customers SET xero_tenant_id = (
  SELECT tenant_id FROM xero_tokens ORDER BY updated_at DESC LIMIT 1
)
WHERE xero_contact_id IS NOT NULL AND xero_tenant_id IS NULL;
