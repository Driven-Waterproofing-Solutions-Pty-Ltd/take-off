-- 1. Create the licenses table
create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  license_key text not null unique,
  machine_id text, -- Null initially, binds on first use
  is_active boolean default true,
  expires_at timestamptz
);

-- 2. Enable Row Level Security (RLS)
alter table public.licenses enable row level security;

-- 3. Create a policy (Optional: strictly lock it down so only the function can access it)
-- We don't strictly need public access policies because we are using a SECURITY DEFINER function.

-- 4. Create the verification function (RPC)
-- This function checks the key, binds the machine ID if it's new, and validates expiration.
create or replace function verify_license_key(p_key text, p_machine_id text)
returns json
language plpgsql
security definer -- Runs with admin privileges to update the table
as $$
declare
  v_license record;
begin
  -- Find the license
  select * into v_license from public.licenses where license_key = p_key;

  -- 1. Check if exists
  if v_license.id is null then
    return json_build_object('valid', false, 'message', 'License key not found.');
  end if;

  -- 2. Check if active
  if v_license.is_active = false then
    return json_build_object('valid', false, 'message', 'License has been deactivated.');
  end if;

  -- 3. Check expiration (if set)
  if v_license.expires_at is not null and v_license.expires_at < now() then
    return json_build_object('valid', false, 'message', 'License has expired.');
  end if;

  -- 4. Machine ID Binding Logic
  if v_license.machine_id is null then
    -- First time use: Bind this machine to the license
    update public.licenses set machine_id = p_machine_id where id = v_license.id;
    return json_build_object('valid', true, 'message', 'License activated successfully.');
  elsif v_license.machine_id != p_machine_id then
    -- Already bound to a different machine
    return json_build_object('valid', false, 'message', 'License is already in use on another machine.');
  else
    -- Machine ID matches
    return json_build_object('valid', true, 'message', 'License verified.');
  end if;
end;
$$;

-- 5. Insert a test key (Optional)
insert into public.licenses (license_key) values ('TEST-1234-5678-9000');


create or replace function verify_license_key(p_key text, p_machine_id text)
returns json
language plpgsql
security definer
as $$
declare
  v_license record;
begin
  select * into v_license from public.licenses where license_key = p_key;
  if v_license.id is null then
    return json_build_object('valid', false, 'message', 'License key not found.');
  end if;
  if v_license.is_active = false then
    return json_build_object('valid', false, 'message', 'License has been deactivated.');
  end if;
  if v_license.expires_at is not null and v_license.expires_at < now() then
    return json_build_object(
      'valid', false, 
      'message', 'License has expired.',
      'expires_at', v_license.expires_at
    );
  end if;
  if v_license.machine_id is null then
    update public.licenses set machine_id = p_machine_id where id = v_license.id;
    return json_build_object(
      'valid', true, 
      'message', 'License activated successfully.',
      'expires_at', v_license.expires_at
    );
  elsif v_license.machine_id != p_machine_id then
    return json_build_object('valid', false, 'message', 'License is already in use on another machine.');
  else
    return json_build_object(
      'valid', true, 
      'message', 'License verified.', 
      'expires_at', v_license.expires_at
    );
  end if;
end;
$$;

create or replace function verify_license_key(p_key text, p_machine_id text)
returns json
language plpgsql
security definer
as $$
declare
  v_license record;
begin
  -- Find the license
  select * into v_license from licenses where license_key = p_key;
  -- 1. Check if exists
  if not found then
    return json_build_object('valid', false, 'message', 'Invalid License Key.');
  end if;
  -- 2. Check if active
  if v_license.is_active is not null and v_license.is_active = false then
    return json_build_object('valid', false, 'message', 'License is inactive.');
  end if;
  -- 3. Check expiration
  if v_license.expires_at is not null and v_license.expires_at < now() then
     return json_build_object('valid', false, 'message', 'License has expired.', 'expires_at', v_license.expires_at);
  end if;
  -- 4. Check Machine ID Claim
  -- If machine_id is NULL or Empty String, claim it now.
  if v_license.machine_id is null or v_license.machine_id = '' then
    update licenses set machine_id = p_machine_id where id = v_license.id;
    return json_build_object('valid', true, 'message', 'License activated successfully.', 'expires_at', v_license.expires_at);
    
  -- If machine_id matches, it's valid.
  elsif v_license.machine_id = p_machine_id then
    return json_build_object('valid', true, 'message', 'License verified.', 'expires_at', v_license.expires_at);
    
  -- Otherwise, it's used by someone else.
  else
    return json_build_object('valid', false, 'message', 'License already in use by other machine.', 'expires_at', v_license.expires_at);
  end if;
end;
$$;

create or replace function create_trial_license(p_machine_id text)
returns json
language plpgsql
security definer
as $$
declare
  v_license_key text;
  v_expires_at timestamptz;
  v_existing_id uuid;
begin
  -- 1. Check if this machine already has a license (prevent infinite trials)
  select id into v_existing_id from public.licenses where machine_id = p_machine_id limit 1;
  
  if v_existing_id is not null then
    return json_build_object('success', false, 'message', 'This machine has already used a trial.');
  end if;

  -- 2. Generate Trial Key
  v_license_key := 'TRIAL-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  v_expires_at := now() + interval '30 days';

  -- 3. Insert License
  insert into public.licenses (license_key, machine_id, is_active, expires_at)
  values (v_license_key, p_machine_id, true, v_expires_at);

  return json_build_object(
    'success', true, 
    'message', 'Trial activated successfully.',
    'license_key', v_license_key,
    'expires_at', v_expires_at
  );
end;
$$;
