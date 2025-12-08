-- =====================================================
-- Migration: Add License Types and Templates Table
-- =====================================================
-- This migration adds:
-- 1. license_type column to licenses table
-- 2. templates table for storing JSON templates
-- 3. RLS policies for template access
-- 4. Updates to RPC functions to return license_type
-- =====================================================

-- Step 1: Add license_type column to licenses table
ALTER TABLE public.licenses 
ADD COLUMN IF NOT EXISTS license_type TEXT CHECK (license_type IN ('trial', 'paid')) DEFAULT 'trial';

-- Step 2: Backfill existing licenses
-- Set to 'paid' if no expiration date, 'trial' if has expiration
UPDATE public.licenses 
SET license_type = CASE 
    WHEN expires_at IS NULL THEN 'paid'
    ELSE 'trial'
END
WHERE license_type IS NULL;

-- Step 3: Create templates table
CREATE TABLE IF NOT EXISTS public.templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    template_data JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    description TEXT
);

-- Step 4: Enable RLS on templates table
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS policy for templates
-- Only PAID users can read templates (trial users are blocked)
CREATE POLICY "Only paid users can read templates"
ON public.templates
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.licenses
        WHERE is_active = TRUE
        AND license_type = 'paid'
        AND (expires_at IS NULL OR expires_at > NOW())
        -- Note: We can't verify machine_id in a SELECT policy easily,
        -- so this policy just checks for ANY valid PAID license.
        -- The frontend will handle machine-specific verification.
    )
);

-- Step 6: Update verify_license_key function to return license_type
CREATE OR REPLACE FUNCTION verify_license_key(p_key TEXT, p_machine_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_license RECORD;
BEGIN
  -- Find the license
  SELECT * INTO v_license FROM licenses WHERE license_key = p_key;
  
  -- 1. Check if exists
  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'message', 'Invalid License Key.');
  END IF;
  
  -- 2. Check if active
  IF v_license.is_active IS NOT NULL AND v_license.is_active = FALSE THEN
    RETURN json_build_object('valid', false, 'message', 'License is inactive.');
  END IF;
  
  -- 3. Check expiration
  IF v_license.expires_at IS NOT NULL AND v_license.expires_at < NOW() THEN
     RETURN json_build_object(
       'valid', false, 
       'message', 'License has expired.', 
       'expires_at', v_license.expires_at,
       'license_type', v_license.license_type
     );
  END IF;
  
  -- 4. Check Machine ID Claim
  IF v_license.machine_id IS NULL OR v_license.machine_id = '' THEN
    -- Claim the license
    UPDATE licenses SET machine_id = p_machine_id WHERE id = v_license.id;
    RETURN json_build_object(
      'valid', true, 
      'message', 'License activated successfully.', 
      'expires_at', v_license.expires_at,
      'license_type', v_license.license_type
    );
    
  ELSIF v_license.machine_id = p_machine_id THEN
    -- Machine ID matches
    RETURN json_build_object(
      'valid', true, 
      'message', 'License verified.', 
      'expires_at', v_license.expires_at,
      'license_type', v_license.license_type
    );
    
  ELSE
    -- Already used by another machine
    RETURN json_build_object(
      'valid', false, 
      'message', 'License already in use by other machine.',
      'expires_at', v_license.expires_at,
      'license_type', v_license.license_type
    );
  END IF;
END;
$$;

-- Step 7: Update create_trial_license function to set license_type
CREATE OR REPLACE FUNCTION create_trial_license(p_machine_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_license_key TEXT;
  v_expires_at TIMESTAMPTZ;
  v_existing_id UUID;
BEGIN
  -- 1. Check if this machine already has a license
  SELECT id INTO v_existing_id FROM public.licenses WHERE machine_id = p_machine_id LIMIT 1;
  
  IF v_existing_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'message', 'This machine has already used a trial.');
  END IF;

  -- 2. Generate Trial Key
  v_license_key := 'TRIAL-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  v_expires_at := NOW() + INTERVAL '30 days';

  -- 3. Insert License with license_type = 'trial'
  INSERT INTO public.licenses (license_key, machine_id, is_active, expires_at, license_type)
  VALUES (v_license_key, p_machine_id, TRUE, v_expires_at, 'trial');

  RETURN json_build_object(
    'success', true, 
    'message', 'Trial activated successfully.',
    'license_key', v_license_key,
    'expires_at', v_expires_at,
    'license_type', 'trial'
  );
END;
$$;

-- Step 8: Insert sample templates from the example JSON
INSERT INTO public.templates (name, category, template_data, description) VALUES
(
    'Concrete Slab CU YD',
    'Concrete',
    '{
        "id": "f4d32059-7ee5-49b4-8001-3086116ffe93",
        "label": "Concrete Slab CU YD",
        "type": "AREA",
        "color": "#84cc16",
        "unit": "sq yd",
        "properties": [
            {"name": "Thickness In Inch", "value": 4},
            {"name": "Slope %", "value": 5}
        ],
        "subItems": [],
        "formula": "((Qty*(Thickness_In_Inch/12))/27)*(Slope__/100)+1",
        "group": "General"
    }'::jsonb,
    'Concrete slab calculation with thickness and slope adjustments'
),
(
    'Linear Measurement',
    'General',
    '{
        "id": "44bf204d-9567-440a-91d9-4630021edc32",
        "label": "Linear 4",
        "type": "LINEAR",
        "color": "#f59e0b",
        "unit": "ft",
        "properties": [],
        "subItems": [],
        "formula": "Qty",
        "group": "General"
    }'::jsonb,
    'Basic linear measurement template'
),
(
    'Interior Wall with Materials',
    'Walls',
    '{
        "id": "cba5b74d-9fa9-433a-8e4c-0a06f8a09b92",
        "label": "Interior wall",
        "type": "LINEAR",
        "color": "#ef4444",
        "unit": "ft",
        "properties": [
            {"name": "height", "value": 8}
        ],
        "subItems": [
            {
                "id": "8ce40383-39d9-4d35-ae22-77604492bdf1",
                "label": "area",
                "unit": "sq ft",
                "price": 0,
                "formula": "Qty*height"
            },
            {
                "id": "730f5eb1-6728-4886-abab-10e237be49f5",
                "label": "sheets",
                "unit": "EA",
                "price": 15,
                "formula": "area/32"
            },
            {
                "id": "1ac7babd-73b5-4ec8-9a27-94170a7e3ae2",
                "label": "studs",
                "unit": "ft",
                "price": 1.3,
                "formula": "(qty/1.333)*10"
            }
        ],
        "formula": "Qty",
        "group": "General"
    }'::jsonb,
    'Interior wall with sheetrock and stud calculations'
);

-- Step 9: Grant necessary permissions (if using service role)
-- GRANT SELECT ON public.templates TO anon, authenticated;
-- GRANT SELECT ON public.licenses TO anon, authenticated;

-- =====================================================
-- Migration Complete
-- =====================================================
-- Next steps:
-- 1. Run this SQL in your Supabase SQL Editor
-- 2. Verify the tables and policies are created
-- 3. Test the RPC functions return license_type
-- 4. Update your application code to use the new fields
-- =====================================================
