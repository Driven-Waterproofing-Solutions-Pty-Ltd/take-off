-- Per-tenant Xero org configuration, resolved lazily from the Xero API the
-- first time a quote/invoice is pushed and then cached here. This replaces two
-- hardcoded literals in pushToXero that were correct only for whatever Driven's
-- org happened to use the day they were written:
--
--   * gst_output_tax_type — pushToXero hardcoded 'OUTPUT', but modern AU
--     GST-registered orgs use 'OUTPUT2' ("GST on Income"); 'OUTPUT' is a
--     legacy code retained only on long-standing orgs. Sending the wrong code
--     can make Xero reject the line or apply a deactivated rate, silently
--     mis-recording GST. We now read /TaxRates and pick the active
--     GST-on-income rate per tenant rather than guessing.
--   * sales_account_code — pushToXero hardcoded '200' (Sales). Kept as the
--     default, but overridable per org without a code change.
--
-- resolved_at lets resolveGstOutputTaxType refresh the cache periodically so a
-- tax-rate change in Xero is picked up without a redeploy.
CREATE TABLE IF NOT EXISTS xero_org_config (
  tenant_id            TEXT PRIMARY KEY REFERENCES xero_tokens(tenant_id) ON DELETE CASCADE,
  gst_output_tax_type  TEXT,
  sales_account_code   TEXT,
  resolved_at          INTEGER
);
