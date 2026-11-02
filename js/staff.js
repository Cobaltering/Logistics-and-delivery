/* =====================================================================
   staff.js
   Gamit ng: warehouse, dispatcher, manager, finance, administrator.
   Ang Supabase ang may huling desisyon kung sino ang puwedeng gumawa ng ano.

   MGA BAHAGI NG FILE (hanapin ang numero):
   1. SETTINGS         - role at kung anong tab ang puwede
   2. SIMULA           - pag-open ng dashboard
   3. MGA TAB          - paglipat ng tab
   4. LOAD NG DATA     - kumuha ng shipments at iba pa
   5. STATS            - mga bilang sa taas
   6. SHIPMENTS        - table ng shipments at mga button
   7. ASSIGN RIDER     - pagbigay ng rider
   8. PAYMENTS         - mga bayad
   9. CASES            - complaints at incidents
   10. ADMIN           - users, warehouses, audit log
   11. WAREHOUSE       - gumawa at mag-assign ng warehouse
   12. TRACKING DIALOG - sarahan ng tracking window
   ===================================================================== */


/* =====================================================================
   1. SETTINGS
   ===================================================================== */

// Role ng nakalogin (galing sa <body data-role="...">)
const STAFF_ROLE = document.body.dataset.role;

// Anong mga tab ang puwede sa bawat role
const STAFF_CAPABILITIES = {
  'Administrator':      ['overview', 'shipments', 'assignments', 'payments', 'cases', 'admin'],
  'Operations Manager': ['overview', 'shipments', 'assignments', 'payments', 'cases'],
  'Dispatcher':         ['overview', 'shipments', 'assignments', 'cases'],
  'Warehouse Staff':    ['overview', 'shipments'],
  'Finance Officer':    ['overview', 'shipments', 'payments']
};

// Mga status na hindi na "active"
const CLOSED_STATUSES = ['Delivered', 'Lost', 'Suspicious'];

// Mga variable na paulit-ulit gamitin
let staffProfile = null;      // impormasyon ng nakalogin
let staffShipments = [];      // lahat ng shipments
let staffRoles = [];          // listahan ng roles
let staffWarehouses = [];     // listahan ng warehouses

// Tinitingnan kung puwede ng role na ito ang isang tab
function canUse(tabName) {
  return (STAFF_CAPABILITIES[STAFF_ROLE] || []).includes(tabName);
}


/* =====================================================================
   2. SIMULA (tumatakbo pagbukas ng page)
   ===================================================================== */

(async function startStaffDashboard() {
  // I-check kung tama ang role. Kung hindi, titigil dito.
  staffProfile = await requireRole([STAFF_ROLE]);
  if (!staffProfile) return;

  // Ipakita ang pangalan
  document.getElementById('userName').textContent = staffProfile.full_name;

  // Mga button at form na laging nandiyan
  document.getElementById('logoutBtn').addEventListener('click', logoutUser);
  document.getElementById('shipmentSearch').addEventListener('input', renderShipments);
  document.getElementById('refreshBtn').addEventListener('click', loadStaffData);
  document.getElementById('shipmentRows').addEventListener('click', handleShipmentAction);
  document.getElementById('staffTabs').addEventListener('click', event => {
    const button = event.target.closest('button[data-tab]');
    if (button) selectStaffTab(button.dataset.tab);
  });

  // Mga ito ay wala sa ibang dashboard, kaya may "?"
  document.getElementById('caseRows')?.addEventListener('click', handleCaseUpdate);
  document.getElementById('assignForm')?.addEventListener('submit', assignRider);
  document.getElementById('paymentForm')?.addEventListener('submit', recordPayment);
  document.getElementById('adminUsers')?.addEventListener('click', handleUserUpdate);
  document.getElementById('warehouseAssignForm')?.addEventListener('submit', assignWarehouse);
  document.getElementById('warehouseCreateForm')?.addEventListener('submit', createWarehouse);

  configureStaffTabs();
  await loadStaffData();
})();


/* =====================================================================
   3. MGA TAB
   ===================================================================== */

// Itago ang mga tab na hindi para sa role na ito
function configureStaffTabs() {
  document.querySelectorAll('#staffTabs [data-tab]').forEach(button => {
    button.hidden = !canUse(button.dataset.tab);
  });
}

// Lumipat sa tab na pinindot
function selectStaffTab(tabName) {
  // Ang napiling tab ang may "selected"
  document.querySelectorAll('#staffTabs [data-tab]').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.tab === tabName));
  });
  // Ipakita lang ang laman ng napiling tab
  document.querySelectorAll('[data-staff-panel]').forEach(panel => {
    panel.hidden = panel.dataset.staffPanel !== tabName;
  });
}


/* =====================================================================
   4. LOAD NG DATA
   ===================================================================== */

// Kunin ang lahat ng data na kailangan ng role na ito
async function loadStaffData() {
  const notice = document.getElementById('staffNotice');
  showMsg(notice, '', '');

  // Kunin ang shipments
  const { data, error } = await sb
    .from('shipments')
    .select('shipment_id, tracking_no, recipient_name, status, created_at, warehouse_id')
    .order('created_at', { ascending: false });

  if (error) {
    showMsg(notice, 'Could not load shipments. Check your Supabase schema and access policies.', 'error');
    return;
  }

  staffShipments = data || [];

  // Ipakita sa screen
  renderShipments();
  renderStats();
  populateAssignmentOptions();
  populatePaymentOptions();

  // Kunin ang iba pang data ayon sa role
  if (canUse('payments')) await loadPayments();
  if (canUse('cases')) await loadCases();
  if (STAFF_ROLE === 'Administrator') await loadAdminData();
}


/* =====================================================================
   5. STATS (mga bilang sa taas)
   ===================================================================== */

function renderStats() {
  // Bilangin ang bawat uri
  const total = staffShipments.length;
  const active = staffShipments.filter(s => !CLOSED_STATUSES.includes(s.status)).length;
  const delivered = staffShipments.filter(s => s.status === 'Delivered').length;
  const attention = staffShipments.filter(s => ['Failed Delivery', 'Lost', 'Suspicious'].includes(s.status)).length;

  // Mga card na ipapakita
  const cards = [
    ['Total shipments', total],
    ['Active', active],
    ['Delivered', delivered],
    ['Needs attention', attention]
  ];

  document.getElementById('stats').innerHTML = cards
    .map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join('');
}


/* =====================================================================
   6. SHIPMENTS (table)
   ===================================================================== */

// Ipakita ang mga shipment sa table (kasama ang search)
function renderShipments() {
  const search = document.getElementById('shipmentSearch').value.trim().toLowerCase();

  // Hanapin ang tugma sa tracking no, pangalan, o status
  const filtered = staffShipments.filter(shipment => {
    const text = `${shipment.tracking_no} ${shipment.recipient_name} ${shipment.status}`.toLowerCase();
    return text.includes(search);
  });

  // Ipakita ang "walang laman" na mensahe kung wala
  document.getElementById('emptyShipments').hidden = filtered.length !== 0;

  // Gumawa ng row para sa bawat shipment
  document.getElementById('shipmentRows').innerHTML = filtered.map(shipment => {

    // Button para sa warehouse staff (kapag "In Transit")
    let warehouseButton = '';
    if (STAFF_ROLE === 'Warehouse Staff' && shipment.status === 'In Transit') {
      warehouseButton = `<button class="btn small secondary" data-action="warehouse" data-id="${esc(shipment.shipment_id)}">Receive at warehouse</button>`;
    }

    // Button na "Assign rider" (para sa admin, manager, dispatcher)
    let assignButton = '';
    if (canUse('assignments')) {
      assignButton = `<button class="btn small secondary" data-action="assign">Assign rider</button>`;
    }

    return `<tr>
      <td><strong>${esc(shipment.tracking_no)}</strong></td>
      <td>${esc(shipment.recipient_name)}</td>
      <td>${statusPill(shipment.status)}</td>
      <td>${formatDate(shipment.created_at)}</td>
      <td class="row">
        <button class="btn small secondary" data-action="history" data-id="${esc(shipment.shipment_id)}" data-track="${esc(shipment.tracking_no)}">Tracking</button>
        ${warehouseButton}${assignButton}
      </td>
    </tr>`;
  }).join('');
}

// Kapag may pinindot na button sa table ng shipments
async function handleShipmentAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;

  // ----- "Assign rider": pumunta sa tab ng assignments -----
  if (action === 'assign') {
    selectStaffTab('assignments');

    // Hanapin ang shipment gamit ang tracking no sa row
    const trackingNo = button.closest('tr').querySelector('td strong').textContent;
    const shipment = staffShipments.find(item => item.tracking_no === trackingNo);

    // Piliin ito sa dropdown
    if (shipment) document.getElementById('assignmentShipment').value = shipment.shipment_id;
    return;
  }

  // ----- "Tracking": ipakita ang history -----
  if (action === 'history') {
    const { data, error } = await sb.from('tracking_events')
      .select('status, location, notes, created_at')
      .eq('shipment_id', button.dataset.id)
      .order('created_at', { ascending: true });

    document.getElementById('trackingTitle').textContent = `Tracking ${button.dataset.track}`;
    document.getElementById('trackingDetails').innerHTML = error
      ? '<p class="msg error">Could not load tracking history.</p>'
      : renderTimeline(data || []);
    document.getElementById('trackingDialog').showModal();
    return;
  }

  // ----- "Receive at warehouse": i-save na dumating na sa warehouse -----
  if (action === 'warehouse') {
    const notice = document.getElementById('staffNotice');

    button.disabled = true;
    const { error } = await sb.from('tracking_events').insert({
      shipment_id: button.dataset.id,
      status: 'At Warehouse',
      location: 'Warehouse',
      notes: 'Shipment received at warehouse',
      created_by: staffProfile.user_id
    });
    button.disabled = false;

    if (error) return showMsg(notice, error.message, 'error');
    showMsg(notice, 'Shipment received and tracking history updated.', 'ok');
    await loadStaffData();
  }
}


/* =====================================================================
   7. ASSIGN RIDER
   ===================================================================== */

// Ilagay ang mga shipment at rider sa dropdown ng assignment form
function populateAssignmentOptions() {
  if (!canUse('assignments')) return;

  const shipmentSelect = document.getElementById('assignmentShipment');
  if (!shipmentSelect) return;

  // Mga shipment na hindi pa tapos
  shipmentSelect.innerHTML = staffShipments
    .filter(s => !CLOSED_STATUSES.includes(s.status))
    .map(s => `<option value="${esc(s.shipment_id)}">${esc(s.tracking_no)} — ${esc(s.recipient_name)}</option>`)
    .join('');

  // Mga rider
  sb.from('riders').select('rider_id, users(full_name)').then(({ data, error }) => {
    if (error) {
      return showMsg(document.getElementById('staffNotice'), 'Could not load riders: ' + error.message, 'error');
    }
    document.getElementById('assignmentRider').innerHTML = (data || [])
      .map(r => `<option value="${esc(r.rider_id)}">${esc(r.users?.full_name || 'Rider')}</option>`)
      .join('');
  });
}

// Pag-submit ng assign form: bigyan ng rider ang shipment
async function assignRider(event) {
  event.preventDefault();

  const shipmentId = document.getElementById('assignmentShipment').value;
  const riderId = document.getElementById('assignmentRider').value;
  const message = document.getElementById('assignmentMsg');
  const button = document.getElementById('assignBtn');

  if (!shipmentId || !riderId) return showMsg(message, 'Choose a shipment and rider.', 'error');

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


/* =====================================================================
   8. PAYMENTS
   ===================================================================== */

// Ilagay ang mga shipment sa dropdown ng payment form (finance at admin lang)
function populatePaymentOptions() {
  if (!['Finance Officer', 'Administrator'].includes(STAFF_ROLE)) return;

  const paymentShipment = document.getElementById('paymentShipment');
  if (!paymentShipment) return;

  paymentShipment.innerHTML = staffShipments
    .map(s => `<option value="${esc(s.shipment_id)}">${esc(s.tracking_no)} — ${esc(s.recipient_name)}</option>`)
    .join('');
}

// Kunin at ipakita ang listahan ng mga bayad
async function loadPayments() {
  const { data, error } = await sb.from('payments')
    .select('payment_id, shipment_id, amount, method, status, paid_at, shipments(tracking_no, recipient_name)')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('paymentRows');

  if (error) {
    tbody.innerHTML = '<tr><td colspan="5">Unable to load payment records.</td></tr>';
    return;
  }

  const payments = data || [];

  tbody.innerHTML = payments.map(payment => {
    // Halimbawa: ₱1,500.00
    const amount = Number(payment.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 });

    return `<tr>
      <td>${esc(payment.shipments?.tracking_no || '—')}</td>
      <td>${esc(payment.shipments?.recipient_name || '—')}</td>
      <td>₱${amount}</td>
      <td>${esc(payment.method)}</td>
      <td>${esc(payment.status)}</td>
    </tr>`;
  }).join('');

  document.getElementById('emptyPayments').hidden = payments.length !== 0;
}

// Pag-submit ng payment form: mag-save ng bagong bayad
async function recordPayment(event) {
  event.preventDefault();

  const shipmentId = document.getElementById('paymentShipment').value;
  const amount = Number(document.getElementById('paymentAmount').value);
  const status = document.getElementById('paymentStatus').value;
  const message = document.getElementById('paymentMsg');
  const button = document.getElementById('paymentBtn');

  if (!shipmentId || !(amount >= 0)) {
    return showMsg(message, 'Select a shipment and enter a valid amount.', 'error');
  }

  // Ang laman na ise-save
  const payment = {
    shipment_id: shipmentId,
    amount: amount,
    method: document.getElementById('paymentMethod').value,
    status: status,
    paid_at: status === 'Paid' ? new Date().toISOString() : null   // may petsa lang kung "Paid"
  };

  button.disabled = true;
  const { error } = await sb.from('payments').insert(payment);
  button.disabled = false;

  if (error) return showMsg(message, 'Could not save payment: ' + error.message, 'error');

  showMsg(message, 'Payment record saved.', 'ok');
  event.target.reset();
  await loadPayments();
}


/* =====================================================================
   9. CASES (complaints at incidents)
   ===================================================================== */

// Kunin at ipakita ang complaints at incidents
async function loadCases() {
  const [complaintResult, incidentResult] = await Promise.all([
    sb.from('complaints')
      .select('complaint_id, subject, status, created_at, shipments(tracking_no)')
      .order('created_at', { ascending: false }),
    sb.from('incidents')
      .select('incident_id, type, description, status, created_at, shipments(tracking_no)')
      .order('created_at', { ascending: false })
  ]);

  // Kung may error, walang laman
  const complaints = complaintResult.error ? [] : complaintResult.data || [];
  const incidents = incidentResult.error ? [] : incidentResult.data || [];

  // Row ng bawat incident
  const incidentRows = incidents.map(item => `<tr>
    <td>Incident</td>
    <td>${esc(item.shipments?.tracking_no || '—')}</td>
    <td>${esc(item.type)}: ${esc(item.description || '—')}</td>
    <td>${renderCaseStatus('incidents', item.incident_id, item.status, ['Open', 'Investigating', 'Closed'])}</td>
    <td>${formatDate(item.created_at)}</td>
  </tr>`);

  // Row ng bawat complaint
  const complaintRows = complaints.map(item => `<tr>
    <td>Complaint</td>
    <td>${esc(item.shipments?.tracking_no || '—')}</td>
    <td>${esc(item.subject)}</td>
    <td>${renderCaseStatus('complaints', item.complaint_id, item.status, ['Open', 'In Review', 'Resolved'])}</td>
    <td>${formatDate(item.created_at)}</td>
  </tr>`);

  const rows = [...incidentRows, ...complaintRows];

  document.getElementById('caseRows').innerHTML = rows.join('');
  document.getElementById('emptyCases').hidden = rows.length !== 0;

  if (complaintResult.error || incidentResult.error) {
    showMsg(document.getElementById('staffNotice'), 'Some incident or complaint records could not be loaded.', 'error');
  }
}

// Gumawa ng dropdown ng status + Save button (admin at manager lang). Ang iba, teksto lang.
function renderCaseStatus(table, recordId, status, choices) {
  const canEdit = ['Administrator', 'Operations Manager'].includes(STAFF_ROLE);
  if (!canEdit) return esc(status);

  const options = choices
    .map(choice => `<option ${choice === status ? 'selected' : ''}>${esc(choice)}</option>`)
    .join('');

  return `<div class="row">
    <select data-case-status="${esc(table)}" data-id="${esc(recordId)}" aria-label="Case status">${options}</select>
    <button class="btn small secondary" data-action="save-case" data-table="${esc(table)}" data-id="${esc(recordId)}">Save</button>
  </div>`;
}

// Pag-click ng "Save" sa status ng case
async function handleCaseUpdate(event) {
  const button = event.target.closest('button[data-action="save-case"]');
  if (!button) return;

  const notice = document.getElementById('staffNotice');
  const select = button.parentElement.querySelector('[data-case-status]');
  const table = button.dataset.table;
  const idColumn = table === 'incidents' ? 'incident_id' : 'complaint_id';

  const { error } = await sb.from(table).update({ status: select.value }).eq(idColumn, button.dataset.id);

  if (error) return showMsg(notice, 'Could not update case: ' + error.message, 'error');
  showMsg(notice, 'Case status updated.', 'ok');
  await loadCases();
}


/* =====================================================================
   10. ADMIN (users, warehouses, audit log)
   ===================================================================== */

// Kunin ang lahat ng data para sa Administrator
async function loadAdminData() {
  const notice = document.getElementById('staffNotice');

  const [userResult, roleResult, warehouseResult, auditResult] = await Promise.all([
    sb.from('users').select('user_id, full_name, email, status, role_id, warehouse_id').order('full_name'),
    sb.from('roles').select('role_id, role_name').order('role_name'),
    sb.from('warehouses').select('warehouse_id, name').order('name'),
    sb.from('audit_logs')
      .select('log_id, action, table_name, record_id, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
  ]);

  if (userResult.error || roleResult.error || warehouseResult.error) {
    showMsg(notice, 'Could not load administrator data.', 'error');
    return;
  }

  staffRoles = roleResult.data || [];
  staffWarehouses = warehouseResult.data || [];

  renderAdminUsers(userResult.data || []);

  // Dropdown ng warehouse at shipment sa "assign warehouse" form
  document.getElementById('warehouseAssign').innerHTML = staffWarehouses
    .map(w => `<option value="${esc(w.warehouse_id)}">${esc(w.name)}</option>`)
    .join('');
  document.getElementById('warehouseShipment').innerHTML = staffShipments
    .map(s => `<option value="${esc(s.shipment_id)}">${esc(s.tracking_no)} — ${esc(s.recipient_name)}</option>`)
    .join('');

  // Audit log
  const auditRows = auditResult.data || [];
  document.getElementById('auditRows').innerHTML = auditRows.map(log => `<tr>
    <td>${formatDate(log.created_at)}</td>
    <td>${esc(log.action)}</td>
    <td>${esc(log.table_name)}</td>
    <td>${esc(log.record_id || '—')}</td>
  </tr>`).join('');
  document.getElementById('emptyAudit').hidden = auditRows.length > 0;

  if (auditResult.error) {
    showMsg(notice, 'Could not load audit log: ' + auditResult.error.message, 'error');
  }
}

// Ipakita ang table ng mga user (may dropdown ng role, warehouse, at status)
function renderAdminUsers(users) {
  document.getElementById('adminUsers').innerHTML = users.map(user => {

    // Dropdown ng role
    const roleOptions = staffRoles.map(role => {
      const selected = Number(role.role_id) === Number(user.role_id) ? 'selected' : '';
      return `<option value="${role.role_id}" ${selected}>${esc(role.role_name)}</option>`;
    }).join('');

    // Dropdown ng warehouse
    const warehouseOptions = staffWarehouses.map(warehouse => {
      const selected = warehouse.warehouse_id === user.warehouse_id ? 'selected' : '';
      return `<option value="${esc(warehouse.warehouse_id)}" ${selected}>${esc(warehouse.name)}</option>`;
    }).join('');

    // Dropdown ng status
    const statusOptions = ['active', 'inactive', 'locked'].map(status => {
      const selected = user.status === status ? 'selected' : '';
      return `<option ${selected}>${status}</option>`;
    }).join('');

    return `<tr data-user-id="${esc(user.user_id)}">
      <td>${esc(user.full_name)}</td>
      <td>${esc(user.email)}</td>
      <td><select class="user-role" aria-label="Role for ${esc(user.full_name)}">${roleOptions}</select></td>
      <td><select class="user-warehouse" aria-label="Warehouse for ${esc(user.full_name)}">
        <option value="">Not assigned</option>${warehouseOptions}
      </select></td>
      <td><select class="user-status" aria-label="Status for ${esc(user.full_name)}">${statusOptions}</select></td>
      <td><button class="btn small secondary" data-action="save-user">Save</button></td>
    </tr>`;
  }).join('');
}

// Pag-click ng "Save" sa user: i-save ang role, status, at warehouse
async function handleUserUpdate(event) {
  const button = event.target.closest('button[data-action="save-user"]');
  if (!button) return;

  const notice = document.getElementById('staffNotice');
  const row = button.closest('tr');

  const { error } = await sb.from('users').update({
    role_id: Number(row.querySelector('.user-role').value),
    status: row.querySelector('.user-status').value,
    warehouse_id: row.querySelector('.user-warehouse').value || null
  }).eq('user_id', row.dataset.userId);

  if (error) return showMsg(notice, 'Could not update user: ' + error.message, 'error');
  showMsg(notice, 'User account updated.', 'ok');
}


/* =====================================================================
   11. WAREHOUSE
   ===================================================================== */

// Gumawa ng bagong warehouse (admin lang)
async function createWarehouse(event) {
  event.preventDefault();

  const message = document.getElementById('warehouseCreateMsg');
  const name = document.getElementById('warehouseName').value.trim();
  const address = document.getElementById('warehouseAddress').value.trim();
  const button = event.target.querySelector('button[type="submit"]');

  if (!name || !address) return showMsg(message, 'Enter both the warehouse name and address.', 'error');

  button.disabled = true;
  const { error } = await sb.from('warehouses').insert({ name, address });
  button.disabled = false;

  if (error) return showMsg(message, 'Could not add warehouse: ' + error.message, 'error');

  event.target.reset();
  showMsg(message, 'Warehouse added.', 'ok');
  await loadAdminData();
}

// I-assign ang shipment sa isang warehouse
async function assignWarehouse(event) {
  event.preventDefault();

  const message = document.getElementById('warehouseMsg');
  const shipmentId = document.getElementById('warehouseShipment').value;
  const warehouseId = document.getElementById('warehouseAssign').value;

  if (!shipmentId || !warehouseId) return showMsg(message, 'Choose a shipment and warehouse.', 'error');

  const { error } = await sb.from('shipments').update({ warehouse_id: warehouseId }).eq('shipment_id', shipmentId);

  if (error) return showMsg(message, 'Could not assign warehouse: ' + error.message, 'error');

  showMsg(message, 'Warehouse assigned to shipment.', 'ok');
  await loadStaffData();
}


/* =====================================================================
   12. TRACKING DIALOG
   ===================================================================== */

// Isara ang tracking window
document.getElementById('closeTracking').addEventListener('click', () => {
  document.getElementById('trackingDialog').close();
});