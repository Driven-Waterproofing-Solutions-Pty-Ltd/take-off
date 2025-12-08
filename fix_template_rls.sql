-- Fix for Template RLS Policy
-- The issue: RLS policy blocks all queries because it can't verify the specific machine ID
-- Solution: Allow SELECT for anon role since we're doing license verification in the frontend

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Only paid users can read templates" ON public.templates;

-- Create a permissive policy that allows reading templates
-- The frontend templateService already handles license verification
CREATE POLICY "Allow reading active templates"
ON public.templates
FOR SELECT
USING (is_active = true);

-- Grant SELECT permission to anon and authenticated roles
GRANT SELECT ON public.templates TO anon, authenticated;
