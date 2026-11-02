-- Logistics and Delivery application update for the existing Supabase schema.
-- Do not run 01_schema.sql against this database; it describes a different schema.
-- Existing signup, initial-event, immutable-history, and audit triggers are preserved.

-- 1. Add the two fields needed for warehouse scoping and completed assignments.
alter table public.shipments
  add column if not exists warehouse_id integer references public.warehouses(warehouse_id);

alter table public.delivery_assignments
  add column if not exists completed_at timestamptz;

create index if not exists delivery_assignments_active_shipment_idx
  on public.delivery_assignments (shipment_id)
  where completed_at is null;

-- Remove duplicate triggers from the earlier draft if it was accidentally applied.
-- The original on_auth_user_created, trg_shipment_created, and tracking triggers
-- listed in the schema report are intentionally left untouched.
drop trigger if exists integrated_auth_user_created on auth.users;
drop trigger if exists integrated_create_rider_profile on public.users;
drop trigger if exists integrated_tracking_event_status on public.tracking_events;
drop trigger if exists integrated_tracking_event_immutable on public.tracking_events;
drop trigger if exists integrated_shipment_created_event on public.shipments;
drop trigger if exists integrated_shipment_status_requires_event on public.shipments;
drop trigger if exists integrated_tracking_notification on public.tracking_events;

do $$
declare
  audit_table text;
begin
  foreach audit_table in array array[
    'users', 'customers', 'shipments', 'packages', 'delivery_assignments',
    'tracking_events', 'delivery_proof', 'payments', 'complaints', 'incidents'
  ] loop
    execute format(
      'drop trigger if exists integrated_audit_%I on public.%I',
      audit_table, audit_table
    );
  end loop;
end;
$$;

-- 2. Resolve the signed-in employee's warehouse for row-level access checks.
create or replace function public.current_warehouse_id()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select u.warehouse_id
  from public.users u
  where u.user_id = auth.uid()
    and u.status = 'active'
$$;

-- Share one ownership/assignment rule across shipment-related tables.
create or replace function public.can_access_shipment(target_shipment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shipments s
    where s.shipment_id = target_shipment_id
      and (
        s.customer_id = public.current_customer_id()
        or public.current_role_name() in (
          'Administrator', 'Operations Manager', 'Dispatcher', 'Finance Officer'
        )
        or (
          public.current_role_name() = 'Warehouse Staff'
          and s.warehouse_id = public.current_warehouse_id()
        )
        or (
          public.current_role_name() = 'Delivery Rider'
          and exists (
            select 1
            from public.delivery_assignments da
            where da.shipment_id = s.shipment_id
              and da.rider_id = public.current_rider_id()
              and da.completed_at is null
          )
        )
      )
  )
$$;

revoke all on function public.current_warehouse_id() from public;
revoke all on function public.can_access_shipment(uuid) from public;
grant execute on function public.current_warehouse_id() to authenticated;
grant execute on function public.can_access_shipment(uuid) to authenticated;

-- 3. Book a shipment and its package atomically; the existing shipment trigger
--    will create the initial tracking event.
create or replace function public.create_shipment_with_package(
  p_recipient_name text,
  p_recipient_contact text,
  p_pickup_address text,
  p_delivery_address text,
  p_package_description text,
  p_package_weight_kg numeric,
  p_package_declared_value numeric default 0
)
returns table (shipment_id uuid, tracking_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_customer_id uuid;
  created_shipment_id uuid;
  created_tracking_no text;
begin
  if coalesce(public.current_role_name(), '') <> 'Customer' then
    raise exception 'Only customer accounts may book shipments';
  end if;

  owner_customer_id := public.current_customer_id();
  if owner_customer_id is null then
    raise exception 'A customer profile is required to book a shipment';
  end if;
  if nullif(trim(p_recipient_name), '') is null
     or nullif(trim(p_recipient_contact), '') is null
     or nullif(trim(p_pickup_address), '') is null
     or nullif(trim(p_delivery_address), '') is null
     or nullif(trim(p_package_description), '') is null
     or p_package_weight_kg is null or p_package_weight_kg <= 0
     or coalesce(p_package_declared_value, 0) < 0 then
    raise exception 'Shipment and package fields are invalid';
  end if;

  insert into public.shipments as created (
    customer_id, recipient_name, recipient_contact,
    pickup_address, delivery_address, status
  ) values (
    owner_customer_id, trim(p_recipient_name), trim(p_recipient_contact),
    trim(p_pickup_address), trim(p_delivery_address), 'Created'
  )
  returning created.shipment_id, created.tracking_no
  into created_shipment_id, created_tracking_no;

  insert into public.packages (shipment_id, description, weight_kg, declared_value)
  values (
    created_shipment_id, trim(p_package_description), p_package_weight_kg,
    coalesce(p_package_declared_value, 0)
  );

  return query select created_shipment_id, created_tracking_no;
end;
$$;

revoke all on function public.create_shipment_with_package(text, text, text, text, text, numeric, numeric) from public;
grant execute on function public.create_shipment_with_package(text, text, text, text, text, numeric, numeric) to authenticated;

-- 4. Replace the active rider assignment within one transaction.
--    The existing unique key on (shipment_id, rider_id) is reused on reassignment.
create or replace function public.assign_shipment_rider_integrated(
  p_shipment_id uuid,
  p_rider_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_role_name(), '') not in (
    'Administrator', 'Operations Manager', 'Dispatcher'
  ) then
    raise exception 'You are not allowed to assign riders';
  end if;
  if not exists (
    select 1 from public.shipments s where s.shipment_id = p_shipment_id
  ) then
    raise exception 'Shipment does not exist';
  end if;
  if not exists (
    select 1 from public.riders r where r.rider_id = p_rider_id
  ) then
    raise exception 'Rider does not exist';
  end if;

  update public.delivery_assignments da
  set completed_at = now()
  where da.shipment_id = p_shipment_id
    and da.completed_at is null;

  insert into public.delivery_assignments (
    shipment_id, rider_id, assigned_by, assigned_at, completed_at
  ) values (
    p_shipment_id, p_rider_id, auth.uid(), now(), null
  )
  on conflict (shipment_id, rider_id) do update
  set assigned_by = excluded.assigned_by,
      assigned_at = excluded.assigned_at,
      completed_at = null;
end;
$$;

revoke all on function public.assign_shipment_rider_integrated(uuid, uuid) from public;
grant execute on function public.assign_shipment_rider_integrated(uuid, uuid) to authenticated;

-- 5. Save delivery proof and the Delivered tracking event atomically.
--    The existing apply_tracking_event trigger validates proof and updates shipment status.
create or replace function public.complete_delivery_with_proof_integrated(
  p_shipment_id uuid,
  p_recipient_name text,
  p_proof_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_role_name(), '') <> 'Delivery Rider'
     or not exists (
       select 1 from public.delivery_assignments da
       where da.shipment_id = p_shipment_id
         and da.rider_id = public.current_rider_id()
         and da.completed_at is null
     ) then
    raise exception 'Only the assigned rider may confirm this delivery';
  end if;
  if nullif(trim(p_recipient_name), '') is null
     or nullif(trim(p_proof_url), '') is null then
    raise exception 'Recipient name and proof are required';
  end if;

  insert into public.delivery_proof (
    shipment_id, rider_id, recipient_name, proof_url, delivered_at
  ) values (
    p_shipment_id, public.current_rider_id(), trim(p_recipient_name),
    trim(p_proof_url), now()
  );

  insert into public.tracking_events (
    shipment_id, status, notes, created_by
  ) values (
    p_shipment_id, 'Delivered',
    'Received by ' || trim(p_recipient_name), auth.uid()
  );
end;
$$;

revoke all on function public.complete_delivery_with_proof_integrated(uuid, text, text) from public;
grant execute on function public.complete_delivery_with_proof_integrated(uuid, text, text) to authenticated;

-- 6. Preserve the existing tracking trigger's proof and incident behavior while
--    enforcing valid status transitions and preventing direct status edits.
create or replace function public.apply_tracking_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  select s.status into current_status
  from public.shipments s
  where s.shipment_id = new.shipment_id
  for update;

  if current_status is null then
    raise exception 'Shipment does not exist';
  end if;

  if not (
    (current_status = 'Created' and new.status in ('Created', 'Picked Up', 'Lost', 'Suspicious'))
    or (current_status = 'Picked Up' and new.status in ('In Transit', 'Lost', 'Suspicious'))
    or (current_status = 'In Transit' and new.status in ('At Warehouse', 'Out for Delivery', 'Lost', 'Suspicious'))
    or (current_status = 'At Warehouse' and new.status in ('In Transit', 'Out for Delivery', 'Lost', 'Suspicious'))
    or (current_status = 'Out for Delivery' and new.status in ('Delivered', 'Failed Delivery', 'Lost', 'Suspicious'))
    or (current_status = 'Failed Delivery' and new.status in ('Out for Delivery', 'Lost', 'Suspicious'))
  ) then
    raise exception 'Invalid shipment status transition from % to %', current_status, new.status;
  end if;

  if new.status = 'Delivered' and not exists (
    select 1
    from public.delivery_proof p
    where p.shipment_id = new.shipment_id
      and nullif(trim(p.recipient_name), '') is not null
      and nullif(trim(p.proof_url), '') is not null
      and p.delivered_at is not null
  ) then
    raise exception 'Cannot mark as Delivered without delivery time, recipient information, and proof';
  end if;

  perform set_config('app.tracking_event_update', 'true', true);
  update public.shipments s
  set status = new.status,
      delivered_at = case when new.status = 'Delivered' then now() else s.delivered_at end
  where s.shipment_id = new.shipment_id;
  perform set_config('app.tracking_event_update', 'false', true);

  if new.status in ('Lost', 'Suspicious') then
    insert into public.incidents (shipment_id, type, description, reported_by, status)
    values (
      new.shipment_id, new.status, new.notes, new.created_by, 'Open'
    );
  end if;

  if new.status = 'Delivered' then
    update public.delivery_assignments da
    set completed_at = now()
    where da.shipment_id = new.shipment_id
      and da.rider_id = public.current_rider_id()
      and da.completed_at is null;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_direct_shipment_status_change_integrated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and current_setting('app.tracking_event_update', true) is distinct from 'true' then
    raise exception 'Shipment status changes must be recorded as tracking events';
  end if;
  return new;
end;
$$;

drop trigger if exists integrated_shipment_status_requires_event on public.shipments;
create trigger integrated_shipment_status_requires_event
  before update of status on public.shipments
  for each row execute function public.prevent_direct_shipment_status_change_integrated();

-- Tracking changes also notify the shipment owner; existing tracking and audit
-- triggers remain in place and continue to run.
create or replace function public.notify_tracking_event_integrated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, message, is_read)
  select c.user_id,
         'Shipment ' || s.tracking_no || ' status updated to ' || new.status || '.',
         false
  from public.shipments s
  join public.customers c on c.customer_id = s.customer_id
  where s.shipment_id = new.shipment_id;
  return new;
end;
$$;

drop trigger if exists integrated_tracking_notification on public.tracking_events;
create trigger integrated_tracking_notification
  after insert on public.tracking_events
  for each row execute function public.notify_tracking_event_integrated();

-- Extend existing audit coverage without replacing the audit triggers already installed.
do $$
declare
  audit_table text;
  audit_key text;
begin
  for audit_table, audit_key in
    select * from (values
      ('customers', 'customer_id'),
      ('delivery_assignments', 'assignment_id'),
      ('tracking_events', 'event_id'),
      ('packages', 'package_id'),
      ('incidents', 'incident_id'),
      ('riders', 'rider_id')
    ) as audit_tables(table_name, key_column)
  loop
    if not exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = audit_table
        and not t.tgisinternal
        and t.tgfoid = 'public.log_audit()'::regprocedure
    ) then
      execute format(
        'create trigger integrated_audit_%I after insert or update or delete on public.%I for each row execute function public.log_audit(%L)',
        audit_table, audit_table, audit_key
      );
    end if;
  end loop;
end;
$$;

-- 7. Replace policies that previously allowed access beyond each role's scope.
drop policy if exists shipments_read on public.shipments;
drop policy if exists shipments_warehouse_access on public.shipments;
create policy shipments_read on public.shipments
  for select to authenticated using (public.can_access_shipment(shipment_id));

drop policy if exists assignments_read on public.delivery_assignments;
create policy assignments_read on public.delivery_assignments
  for select to authenticated using (
    public.current_role_name() in ('Administrator', 'Operations Manager', 'Dispatcher')
    or (
      rider_id = public.current_rider_id()
      and completed_at is null
    )
  );

drop policy if exists assignments_write on public.delivery_assignments;
drop policy if exists assignments_insert on public.delivery_assignments;
create policy assignments_insert on public.delivery_assignments
  for insert to authenticated with check (
    public.current_role_name() in ('Administrator', 'Operations Manager', 'Dispatcher')
    and assigned_by = auth.uid()
  );

drop policy if exists assignments_update on public.delivery_assignments;
drop policy if exists tracking_read on public.tracking_events;
create policy tracking_read on public.tracking_events
  for select to authenticated using (public.can_access_shipment(shipment_id));

drop policy if exists tracking_insert on public.tracking_events;
create policy tracking_insert on public.tracking_events
  for insert to authenticated with check (
    created_by = auth.uid()
    and (
      public.current_role_name() in ('Administrator', 'Dispatcher')
      or (
        public.current_role_name() = 'Warehouse Staff'
        and exists (
          select 1 from public.shipments s
          where s.shipment_id = tracking_events.shipment_id
            and s.warehouse_id = public.current_warehouse_id()
        )
      )
      or (
        public.current_role_name() = 'Delivery Rider'
        and exists (
          select 1 from public.delivery_assignments da
          where da.shipment_id = tracking_events.shipment_id
            and da.rider_id = public.current_rider_id()
            and da.completed_at is null
        )
      )
    )
  );

drop policy if exists packages_read on public.packages;
create policy packages_read on public.packages
  for select to authenticated using (public.can_access_shipment(shipment_id));

drop policy if exists packages_insert on public.packages;
create policy packages_insert on public.packages
  for insert to authenticated with check (
    public.current_role_name() in ('Administrator', 'Dispatcher')
    or (
      public.current_role_name() = 'Customer'
      and exists (
        select 1 from public.shipments s
        where s.shipment_id = packages.shipment_id
          and s.customer_id = public.current_customer_id()
      )
    )
  );

drop policy if exists proof_read on public.delivery_proof;
create policy proof_read on public.delivery_proof
  for select to authenticated using (public.can_access_shipment(shipment_id));

drop policy if exists proof_insert on public.delivery_proof;
create policy proof_insert on public.delivery_proof
  for insert to authenticated with check (
    rider_id = public.current_rider_id()
    and exists (
      select 1 from public.delivery_assignments da
      where da.shipment_id = delivery_proof.shipment_id
        and da.rider_id = public.current_rider_id()
        and da.completed_at is null
    )
    and delivered_at is not null
    and nullif(trim(recipient_name), '') is not null
    and nullif(trim(proof_url), '') is not null
  );

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select to authenticated using (public.can_access_shipment(shipment_id));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated with check (
    public.current_role_name() in ('Administrator', 'Finance Officer')
  );

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated using (
    public.current_role_name() in ('Administrator', 'Finance Officer')
  ) with check (
    public.current_role_name() in ('Administrator', 'Finance Officer')
  );

drop policy if exists complaints_insert on public.complaints;
create policy complaints_insert on public.complaints
  for insert to authenticated with check (
    customer_id = public.current_customer_id()
    and public.current_role_name() = 'Customer'
    and (
      shipment_id is null
      or public.can_access_shipment(shipment_id)
    )
  );

drop policy if exists complaints_read on public.complaints;
create policy complaints_read on public.complaints
  for select to authenticated using (
    customer_id = public.current_customer_id()
    or public.current_role_name() in ('Administrator', 'Operations Manager', 'Dispatcher')
  );

drop policy if exists complaints_staff_update on public.complaints;
create policy complaints_staff_update on public.complaints
  for update to authenticated using (
    public.current_role_name() in ('Administrator', 'Operations Manager')
  ) with check (
    public.current_role_name() in ('Administrator', 'Operations Manager')
  );

drop policy if exists warehouses_read on public.warehouses;
drop policy if exists warehouses_staff_read on public.warehouses;
create policy warehouses_read on public.warehouses
  for select to authenticated using (
    public.current_role_name() in (
      'Administrator', 'Operations Manager', 'Dispatcher', 'Finance Officer'
    )
    or (
      public.current_role_name() = 'Warehouse Staff'
      and warehouse_id = public.current_warehouse_id()
    )
  );

drop policy if exists riders_read on public.riders;
create policy riders_read on public.riders
  for select to authenticated using (
    user_id = auth.uid()
    or public.current_role_name() in ('Administrator', 'Operations Manager', 'Dispatcher')
  );
