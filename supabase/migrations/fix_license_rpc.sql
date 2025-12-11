-- Drop the existing function first to be safe (optional if using CREATE OR REPLACE with same signature)
-- But ensuring we set the ORDER BY correctly is key.

CREATE OR REPLACE FUNCTION get_license_by_machine(p_machine_id text)
RETURNS SETOF licenses
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM licenses
  WHERE machine_id = p_machine_id
  ORDER BY 
    -- Order by license_type: 'paid' (1) comes before 'trial' (2) or others
    -- We can use a CASE statement for custom ordering
    CASE 
      WHEN license_type = 'paid' THEN 1 
      WHEN license_type = 'trial' THEN 2
      ELSE 3 
    END ASC,
    -- Then by expiration date, newest first
    expires_at DESC
  LIMIT 1;
$$;
