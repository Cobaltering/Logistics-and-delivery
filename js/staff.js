/* staff.js
   Shared data loading and interactions for warehouse, dispatch, manager,
   finance, and administrator dashboards. Supabase RLS remains authoritative. */
const STAFF_ROLE = document.body.dataset.role;
const STAFF_CAPABILITIES = {
  'Administrator': ['overview', 'shipments', 'assignments', 'payments', 'cases', 'admin'],
  'Operations Manager': ['overview', 'shipments', 'assignments', 'payments', 'cases'],
  'Dispatcher': ['overview', 'shipments', 'assignments', 'cases'],
  'Warehouse Staff': ['overview', 'shipments'],
  'Finance Officer': ['overview', 'shipments', 'payments']
};

let staffProfile = null;
let staffShipments = [];
let staffRoles = [];
let staffWarehouses = [];

// Starts the dashboard after Supabase confirms the signed-in user's role.
(async function startStaffDashboard() {
  staffProfile = await requireRole([STAFF_ROLE]);
  if (!staffProfile) return;

  document.getElementById('userName').textContent = staffProfile.full_name;
  document.getElementById('logoutBtn').addEventListener('click', logoutUser);
  configureStaffTabs();
  document.getElementById('shipmentSearch').addEventListener('input', renderShipments);
  document.getElementById('refreshBtn').addEventListener('click', loadStaffData);
  document.getElementById('staffTabs').addEventListener('click', event => {
    const button = event.target.closest('button[data-tab]');
    if (button) selectStaffTab(button.dataset.tab);
  });
  document.getElementById('shipmentRows').addEventListener('click', handleShipmentAction);
  document.getElementById('caseRows')?.addEventListener('click', handleCaseUpdate);
  document.getElementById('assignForm')?.addEventListener('submit', assignRider);
  document.getElementById('paymentForm')?.addEventListener('submit', recordPayment);
  document.getElementById('adminUsers')?.addEventListener('click', handleUserUpdate);
  document.getElementById('warehouseAssignForm')?.addEventListener('submit', assignWarehouse);
  document.getElementById('warehouseCreateForm')?.addEventListener('submit', createWarehouse);

  await loadStaffData();
})();

// Shows only the sections this role is permitted to use.
function configureStaffTabs() {
  const allowed = STAFF_CAPABILITIES[STAFF_ROLE] || [];
  document.querySelectorAll('#staffTabs [data-tab]').forEach(button => {
    button.hidden = !allowed.includes(button.dataset.tab);
  });
}

// Switches the visible staff dashboard section when its tab is selected.
function selectStaffTab(tabName) {
  document.querySelectorAll('#staffTabs [data-tab]').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.tab === tabName));
  });
  document.querySelectorAll('[data-staff-panel]').forEach(panel => {
    panel.hidden = panel.dataset.staffPanel !== tabName;
  });
}

// Loads shipment data and the additional records permitted for this role.
async function loadStaffData() {
  const notice = document.getElementById('staffNotice');
  showMsg(notice, '', '');

  const { data, error } = await sb
    .from('shipments')
    .select('shipment_id, tracking_no, recipient_name, status, created_at, warehouse_id')
    .order('created_at', { ascending: false });

  if (error) {
    showMsg(notice, 'Could not load shipments. Check your Supabase schema and access policies.', 'error');
    return;
  }
  staffShipments = data || [];
  renderShipments();
  renderStats();
  populateAssignmentOptions();
  populatePaymentOptions();

  if (STAFF_ROLE === 'Finance Officer' || STAFF_ROLE === 'Administrator' || STAFF_ROLE === 'Operations Manager') {
    await loadPayments();
  }
  if (STAFF_CAPABILITIES[STAFF_ROLE].includes('cases')) await loadCases();
  if (STAFF_ROLE === 'Administrator') await loadAdminData();
}

// Calculates the headline operational counts from the authorized shipments.
function renderStats() {
  const counts = {
    total: staffShipments.length,
    active: staffShipments.filter(s => !['Delivered', 'Lost', 'Suspicious'].includes(s.status)).length,
    delivered: staffShipments.filter(s => s.status === 'Delivered').length,
    attention: staffShipments.filter(s => ['Failed Delivery', 'Lost', 'Suspicious'].includes(s.status)).length
  };
  document.getElementById('stats').innerHTML = [
    ['Total shipments', counts.total],
    ['Active', counts.active],
    ['Delivered', counts.delivered],
    ['Needs attention', counts.attention]
  ].map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join('');
}

// Applies the search filter and safely renders shipment rows and available actions.
function renderShipments() {
  const needle = document.getElementById('shipmentSearch').value.trim().toLowerCase();
  const filtered = staffShipments.filter(shipment =>
    `${shipment.tracking_no} ${shipment.recipient_name} ${shipment.status}`.toLowerCase().includes(needle)
  );
  const tbody = document.getElementById('shipmentRows');
  document.getElementById('emptyShipments').hidden = filtered.length !== 0;
  tbody.innerHTML = filtered.map(shipment => {
    const warehouseAction = STAFF_ROLE === 'Warehouse Staff' && shipment.status === 'In Transit'
      ? `<button class="btn small secondary" data-action="warehouse" data-id="${esc(shipment.shipment_id)}">Receive at warehouse</button>`
      : '';
    const assignAction = ['Administrator', 'Operations Manager', 'Dispatcher'].includes(STAFF_ROLE)
      ? `<button class="btn small secondary" data-action="assign">Assign rider</button>`
      : '';
    return `<tr>
      <td><strong>${esc(shipment.tracking_no)}</strong></td>
      <td>${esc(shipment.recipient_name)}</td>
      <td>${statusPill(shipment.status)}</td>
      <td>${formatDate(shipment.created_at)}</td>
      <td class="row">
        <button class="btn small secondary" data-action="history" data-id="${esc(shipment.shipment_id)}" data-track="${esc(shipment.tracking_no)}">Tracking</button>
        ${warehouseAction}${assignAction}
      </td>
    </tr>`;
  }).join('');
}

// Handles tracking-history, rider-assignment navigation, and warehouse receipt actions.
async function handleShipmentAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  if (button.dataset.action === 'assign') {
    selectStaffTab('assignments');
    const shipmentSelect = document.getElementById('assignmentShipment');
    const row = button.closest('tr');
    const trackingNo = row.querySelector('td strong').textContent;
    const shipment = staffShipments.find(item => item.tracking_no === trackingNo);
    if (shipment) shipmentSelect.value = shipment.shipment_id;
    return;
  }

  if (button.dataset.action === 'history') {
    const { data, error } = await sb.from('tracking_events')
      .select('status, location, notes, created_at')
      .eq('shipment_id', button.dataset.id)
      .order('created_at', { ascending: true });
    const box = document.getElementById('trackingDetails');
    document.getElementById('trackingTitle').textContent = `Tracking ${button.dataset.track}`;
    box.innerHTML = error ? '<p class="msg error">Could not load tracking history.</p>' : renderTimeline(data || []);
    document.getElementById('trackingDialog').showModal();
    return;
  }

  if (button.dataset.action === 'warehouse') {
    button.disabled = true;
    const { error } = await sb.from('tracking_events').insert({
      shipment_id: button.dataset.id,
      status: 'At Warehouse',
      location: 'Warehouse',
      notes: 'Shipment received at warehouse',
      created_by: staffProfile.user_id
    });
    button.disabled = false;
    if (error) return showMsg(document.getElementById('staffNotice'), error.message, 'error');
    showMsg(document.getElementById('staffNotice'), 'Shipment received and tracking history updated.', 'ok');
    await loadStaffData();
  }
}

// Fills shipment and rider lists used by dispatch assignment forms.
function populateAssignmentOptions() {
  if (!['Administrator', 'Operations Manager', 'Dispatcher'].includes(STAFF_ROLE)) return;
  const shipmentSelect = document.getElementById('assignmentShipment');
  if (!shipmentSelect) return;
  shipmentSelect.innerHTML = staffShipments
    .filter(s => !['Delivered', 'Lost', 'Suspicious'].includes(s.status))
    .map(s => `<option value="${esc(s.shipment_id)}">${esc(s.tracking_no)} — ${esc(s.recipient_name)}</option>`).join('');

  sb.from('riders').select('rider_id, users(full_name)').then(({ data, error }) => {
    if (error) return showMsg(document.getElementById('staffNotice'), 'Could not load riders: ' + error.message, 'error');
    document.getElementById('assignmentRider').innerHTML = (data || [])
      .map(r => `<option value="${esc(r.rider_id)}">${esc(r.users?.full_name || 'Rider')}</option>`).join('');
  });
}

// Uses one database transaction to replace the shipment's active rider assignment.
async function assignRider(event) {
  event.preventDefault();
  const shipmentId = document.getElementById('assignmentShipment').value;
  const riderId = document.getElementById('assignmentRider').value;
  const message = document.getElementById('assignmentMsg');
  if (!shipmentId || !riderId) return showMsg(message, 'Choose a shipment and rider.', 'error');

  const button = document.getElementById('assignBtn');
  button.disabled = true;
  const { error } = await sb.rpc('assign_shipment_rider_integrated', {
    p_shipment_id: shipmentId,
    p_rider_id: riderId
  });
  button.disabled = false;
  if (error) return showMsg(message, 'Could not assign rider: ' + error.message, 'error');
  showMsg(message, 'Rider assigned successfully.', 'ok');
  await loadStaffData();
}

// Populates the shipment selector on payment-entry pages.
function populatePaymentOptions() {
  if (!['Finance Officer', 'Administrator'].includes(STAFF_ROLE)) return;
  const paymentShipment = document.getElementById('paymentShipment');
  if (!paymentShipment) return;
  paymentShipment.innerHTML = staffShipments
    .map(s => `<option value="${esc(s.shipment_id)}">${esc(s.tracking_no)} — ${esc(s.recipient_name)}</option>`).join('');
}

// Loads payment records for finance staff and read-only management reports.
async function loadPayments() {
  const { data, error } = await sb.from('payments')
    .select('payment_id, shipment_id, amount, method, status, paid_at, shipments(tracking_no, recipient_name)')
    .order('created_at', { ascending: false });
  const tbody = document.getElementById('paymentRows');
  if (error) {
    tbody.innerHTML = '<tr><td colspan="5">Unable to load payment records.</td></tr>';
    return;
  }
  tbody.innerHTML = (data || []).map(payment => `<tr>
    <td>${esc(payment.shipments?.tracking_no || '—')}</td>
    <td>${esc(payment.shipments?.recipient_name || '—')}</td>
    <td>₱${Number(payment.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
    <td>${esc(payment.method)}</td>
    <td>${esc(payment.status)}</td>
  </tr>`).join('');
  document.getElementById('emptyPayments').hidden = (data || []).length !== 0;
}

// Adds a payment record using the existing payments table columns and allowed statuses.
async function recordPayment(event) {
  event.preventDefault();
  const shipmentId = document.getElementById('paymentShipment').value;
  const amount = Number(document.getElementById('paymentAmount').value);
  const status = document.getElementById('paymentStatus').value;
  const message = document.getElementById('paymentMsg');
  if (!shipmentId || !(amount >= 0)) return showMsg(message, 'Select a shipment and enter a valid amount.', 'error');

  const payment = {
    shipment_id: shipmentId,
    amount,
    method: document.getElementById('paymentMethod').value,
    status,
    paid_at: status === 'Paid' ? new Date().toISOString() : null
  };
  const button = document.getElementById('paymentBtn');
  button.disabled = true;
  const { error } = await sb.from('payments').insert(payment);
  button.disabled = false;
  if (error) return showMsg(message, 'Could not save payment: ' + error.message, 'error');
  showMsg(message, 'Payment record saved.', 'ok');
  event.target.reset();
  await loadPayments();
}

// Loads complaint and incident records visible to operational staff.
async function loadCases() {
  const [complaintResult, incidentResult] = await Promise.all([
    sb.from('complaints').select('complaint_id, subject, status, created_at, shipments(tracking_no)').order('created_at', { ascending: false }),
    sb.from('incidents').select('incident_id, type, description, status, created_at, shipments(tracking_no)').order('created_at', { ascending: false })
  ]);
  const complaints = complaintResult.error ? [] : complaintResult.data || [];
  const incidents = incidentResult.error ? [] : incidentResult.data || [];
  const box = document.getElementById('caseRows');
  const rows = [
    ...incidents.map(item => `<tr><td>Incident</td><td>${esc(item.shipments?.tracking_no || '—')}</td><td>${esc(item.type)}: ${esc(item.description || '—')}</td><td>${renderCaseStatus('incidents', item.incident_id, item.status, ['Open', 'Investigating', 'Closed'])}</td><td>${formatDate(item.created_at)}</td></tr>`),
    ...complaints.map(item => `<tr><td>Complaint</td><td>${esc(item.shipments?.tracking_no || '—')}</td><td>${esc(item.subject)}</td><td>${renderCaseStatus('complaints', item.complaint_id, item.status, ['Open', 'In Review', 'Resolved'])}</td><td>${formatDate(item.created_at)}</td></tr>`)
  ];
  box.innerHTML = rows.join('');
  document.getElementById('emptyCases').hidden = rows.length !== 0;
  if (complaintResult.error || incidentResult.error) {
    showMsg(document.getElementById('staffNotice'), 'Some incident or complaint records could not be loaded.', 'error');
  }
}

// Gives permitted operational managers a status control for incidents and complaints.
function renderCaseStatus(table, recordId, status, choices) {
  const canManage = table === 'incidents'
    ? ['Administrator', 'Operations Manager'].includes(STAFF_ROLE)
    : ['Administrator', 'Operations Manager'].includes(STAFF_ROLE);
  if (!canManage) return esc(status);
  return `<div class="row"><select data-case-status="${esc(table)}" data-id="${esc(recordId)}" aria-label="Case status">
    ${choices.map(choice => `<option ${choice === status ? 'selected' : ''}>${esc(choice)}</option>`).join('')}
  </select><button class="btn small secondary" data-action="save-case" data-table="${esc(table)}" data-id="${esc(recordId)}">Save</button></div>`;
}

// Updates a case status; database row-level policies enforce which roles can save each type.
async function handleCaseUpdate(event) {
  const button = event.target.closest('button[data-action="save-case"]');
  if (!button) return;
  const select = button.parentElement.querySelector('[data-case-status]');
  const table = button.dataset.table;
  const idColumn = table === 'incidents' ? 'incident_id' : 'complaint_id';
  const { error } = await sb.from(table).update({ status: select.value }).eq(idColumn, button.dataset.id);
  if (error) return showMsg(document.getElementById('staffNotice'), 'Could not update case: ' + error.message, 'error');
  showMsg(document.getElementById('staffNotice'), 'Case status updated.', 'ok');
  await loadCases();
}

// Loads account roles, account statuses, and warehouses for administrator controls.
async function loadAdminData() {
  const [userResult, roleResult, warehouseResult, auditResult] = await Promise.all([
    sb.from('users').select('user_id, full_name, email, status, role_id, warehouse_id').order('full_name'),
    sb.from('roles').select('role_id, role_name').order('role_name'),
    sb.from('warehouses').select('warehouse_id, name').order('name'),
    sb.from('audit_logs').select('log_id, action, table_name, record_id, created_at')
      .order('created_at', { ascending: false }).limit(50)
  ]);
  if (userResult.error || roleResult.error || warehouseResult.error) {
    showMsg(document.getElementById('staffNotice'), 'Could not load administrator data.', 'error');
    return;
  }
  staffRoles = roleResult.data || [];
  staffWarehouses = warehouseResult.data || [];
  document.getElementById('adminUsers').innerHTML = (userResult.data || []).map(user => `
    <tr data-user-id="${esc(user.user_id)}">
      <td>${esc(user.full_name)}</td>
      <td>${esc(user.email)}</td>
      <td><select class="user-role" aria-label="Role for ${esc(user.full_name)}">
        ${staffRoles.map(role => `<option value="${role.role_id}" ${Number(role.role_id) === Number(user.role_id) ? 'selected' : ''}>${esc(role.role_name)}</option>`).join('')}
      </select></td>
      <td><select class="user-warehouse" aria-label="Warehouse for ${esc(user.full_name)}">
        <option value="">Not assigned</option>
        ${staffWarehouses.map(warehouse => `<option value="${esc(warehouse.warehouse_id)}" ${warehouse.warehouse_id === user.warehouse_id ? 'selected' : ''}>${esc(warehouse.name)}</option>`).join('')}
      </select></td>
      <td><select class="user-status" aria-label="Status for ${esc(user.full_name)}">
        ${['active', 'inactive', 'locked'].map(status => `<option ${user.status === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select></td>
      <td><button class="btn small secondary" data-action="save-user">Save</button></td>
    </tr>`).join('');

  document.getElementById('warehouseAssign').innerHTML = staffWarehouses
    .map(warehouse => `<option value="${esc(warehouse.warehouse_id)}">${esc(warehouse.name)}</option>`).join('');
  document.getElementById('warehouseShipment').innerHTML = staffShipments
    .map(s => `<option value="${esc(s.shipment_id)}">${esc(s.tracking_no)} — ${esc(s.recipient_name)}</option>`).join('');
  const auditRows = auditResult.data || [];
  document.getElementById('auditRows').innerHTML = auditRows.map(log => `
    <tr><td>${formatDate(log.created_at)}</td><td>${esc(log.action)}</td>
    <td>${esc(log.table_name)}</td><td>${esc(log.record_id || '—')}</td></tr>`).join('');
  document.getElementById('emptyAudit').hidden = auditRows.length > 0;
  if (auditResult.error) {
    showMsg(document.getElementById('staffNotice'), 'Could not load audit log: ' + auditResult.error.message, 'error');
  }
}

// Saves role and active/locked status changes for an existing user account.
async function handleUserUpdate(event) {
  const button = event.target.closest('button[data-action="save-user"]');
  if (!button) return;
  const row = button.closest('tr');
  const { error } = await sb.from('users').update({
    role_id: Number(row.querySelector('.user-role').value),
    status: row.querySelector('.user-status').value,
    warehouse_id: row.querySelector('.user-warehouse').value || null
  }).eq('user_id', row.dataset.userId);
  if (error) return showMsg(document.getElementById('staffNotice'), 'Could not update user: ' + error.message, 'error');
  showMsg(document.getElementById('staffNotice'), 'User account updated.', 'ok');
}

// Creates a warehouse record; database policies restrict this action to administrators.
async function createWarehouse(event) {
  event.preventDefault();
  const message = document.getElementById('warehouseCreateMsg');
  const name = document.getElementById('warehouseName').value.trim();
  const address = document.getElementById('warehouseAddress').value.trim();
  if (!name || !address) return showMsg(message, 'Enter both the warehouse name and address.', 'error');
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  const { error } = await sb.from('warehouses').insert({ name, address });
  button.disabled = false;
  if (error) return showMsg(message, 'Could not add warehouse: ' + error.message, 'error');
  event.target.reset();
  showMsg(message, 'Warehouse added.', 'ok');
  await loadAdminData();
}

// Associates a shipment with a warehouse so only its assigned warehouse staff can access it.
async function assignWarehouse(event) {
  event.preventDefault();
  const shipmentId = document.getElementById('warehouseShipment').value;
  const warehouseId = document.getElementById('warehouseAssign').value;
  if (!shipmentId || !warehouseId) return showMsg(document.getElementById('warehouseMsg'), 'Choose a shipment and warehouse.', 'error');
  const { error } = await sb.from('shipments').update({ warehouse_id: warehouseId }).eq('shipment_id', shipmentId);
  if (error) return showMsg(document.getElementById('warehouseMsg'), 'Could not assign warehouse: ' + error.message, 'error');
  showMsg(document.getElementById('warehouseMsg'), 'Warehouse assigned to shipment.', 'ok');
  await loadStaffData();
}

// Closes the shipment tracking-history dialog.
document.getElementById('closeTracking').addEventListener('click', () => {
  document.getElementById('trackingDialog').close();
});
