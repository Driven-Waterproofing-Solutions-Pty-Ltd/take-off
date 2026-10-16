-- Per-project dismiss for the "Ready to invoice" queue. Heuristic queue
-- (items priced AND no past_quotes INVOICE row yet) catches projects that
-- aren't really ready — still on site, waiting on variation, customer
-- dispute. snoozed_until is an epoch-ms cutoff: the queue hides the row
-- while now() < snoozed_until, and NULL means "not snoozed".
ALTER TABLE projects ADD COLUMN snoozed_until INTEGER;
