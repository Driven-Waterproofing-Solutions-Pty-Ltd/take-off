-- Update existing templates to remove the hardcoded "group" field from template_data
-- and rely on the category column instead

-- Update template_data to remove the "group" field
UPDATE public.templates
SET template_data = template_data - 'group';

-- This removes the "group" key from all template_data JSONB objects
-- The frontend will now use the category column to populate the group field
