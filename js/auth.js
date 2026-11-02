// auth.js - login, logout, proteksyon ng page, at maliliit na tulong na gamit ng lahat ng page
// Pagkakasunod ng script sa bawat page: Supabase CDN -> supabaseClient.js -> auth.js
//
// PAALALA: Taga-redirect lang ang page guard (para sa ginhawa).
// Ang TOTOONG seguridad ay ang RLS policies sa database.


// =====================================================
// 1. HOME PAGE NG BAWAT ROLE
// Dito pupunta ang bawat role pagkatapos mag-login. Dito magdagdag o magpalit ng role.
// =====================================================
const ROLE_HOME = {
  'Customer':           'customer/dashboard.html',
  'Delivery Rider':     'rider/dashboard.html',
  'Warehouse Staff':    'warehouse/dashboard.html',
  'Dispatcher':         'dispatcher/dashboard.html',
  'Operations Manager': 'manager/dashboard.html',
  'Finance Officer':    'finance/dashboard.html',
  'Administrator':      'administrator/dashboard.html'
};


// =====================================================
// 2. TULONG SA PATH
// Ang mga page na nasa loob ng folder ay kailangan ng "../" para makabalik sa main folder.
// Nilalagay ito sa body tag ng page: <body data-root="../">
// =====================================================
function root() {
  return document.body.dataset.root || './';
}


// =====================================================
// 3. KUNIN ANG USER NA NAKA-LOGIN
// Ibabalik ang { user_id, full_name, email, role_name }
// o null kung hindi naka-login / hindi active ang account.
// =====================================================
async function getProfile() {

  // May naka-login ba?
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData.session;
  if (!session) return null;

  // Kunin ang row ng user sa users table
  const { data, error } = await sb
    .from('users')
    .select('user_id, full_name, email, status, roles(role_name)')
    .eq('user_id', session.user.id)
    .single();
  if (error || !data) return null;

  // Bawal pumasok ang inactive o locked na account
  if (data.status !== 'active') {
    await sb.auth.signOut();
    return null;
  }

  return {
    user_id:   data.user_id,
    full_name: data.full_name,
    email:     data.email,
    role_name: data.roles.role_name
  };
}


// =====================================================
// 4. PAGE GUARD (BANTAY NG PAGE)
// Ilagay sa taas ng bawat protektadong page:
//    const me = await requireRole(['Customer']);
// Hindi naka-login -> login page
// Maling role      -> sarili nilang dashboard
// Tama             -> ipapakita ang page at ibabalik ang user
// =====================================================
async function requireRole(allowedRoles) {
  const me = await getProfile();

  if (!me) {
    location.replace(root() + 'login.html');
    return null;
  }

  if (!allowedRoles.includes(me.role_name)) {
    location.replace(root() + ROLE_HOME[me.role_name]);
    return null;
  }

  document.body.classList.remove('guarded');   // ipakita ang page
  return me;
}


// =====================================================
// 5. LOGIN
// Ibabalik ang { ok: true, role } o { ok: false, message }
// =====================================================
async function loginUser(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, message: 'Incorrect email or password.' };
  }

  const me = await getProfile();
  if (!me) {
    return { ok: false, message: 'This account is inactive or locked. Contact an administrator.' };
  }

  return { ok: true, role: me.role_name };
}


// =====================================================
// 6. LOGOUT
// =====================================================
async function logoutUser() {
  await sb.auth.signOut();
  location.replace(root() + 'login.html');
}


// =====================================================
// 7. REGISTER NG CUSTOMER
// Lahat ng nag-sign up ay "Customer". Ang database na ang kokopya
// ng dagdag na info sa users at customers table.
// =====================================================
async function registerCustomer({ full_name, contact_no, address, email, password }) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name, contact_no, address } }
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  // Kapag walang session, kailangan munang i-confirm ng user ang email
  return { ok: true, needsConfirmation: !data.session };
}


// =====================================================
// 8. HINTAY BAGO MAKAPAG-RESEND
// Dini-disable ang button at nagbibilang pababa (60 segundo kung walang ibang bigay).
// =====================================================
function startResendCooldown(button, label, seconds = 60) {

  // Itigil muna ang bilang na tumatakbo pa sa button na ito
  if (button._resendCooldownTimer) {
    clearInterval(button._resendCooldownTimer);
  }

  let remaining = seconds;
  button.disabled = true;
  button.textContent = `${label} (${remaining}s)`;

  button._resendCooldownTimer = setInterval(() => {
    remaining--;

    // Tapos na ang oras: buksan ulit ang button
    if (remaining <= 0) {
      clearInterval(button._resendCooldownTimer);
      button._resendCooldownTimer = null;
      button.disabled = false;
      button.textContent = label;
      return;
    }

    button.textContent = `${label} (${remaining}s)`;
  }, 1000);
}


// =====================================================
// 9. MGA RULE NG PASSWORD
// =====================================================

// Sinusuri ang bawat rule. Ibabalik ang true/false sa bawat isa.
function passwordRequirementStatus(pw) {
  return {
    length:    pw.length >= 8 && pw.length <= 20,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number:    /[0-9]/.test(pw),
    symbol:    /[^A-Za-z0-9]/.test(pw)
  };
}

// Nilalagyan ng tsek ang mga rule sa listahan sa page
function updatePasswordRequirements(pw, container) {
  const status = passwordRequirementStatus(pw);

  container.querySelectorAll('[data-password-rule]').forEach(item => {
    const met = status[item.dataset.passwordRule];
    const label = item.textContent.replace('✓', '').trim();

    item.classList.toggle('met', met);
    item.setAttribute('aria-label', `${label}: ${met ? 'met' : 'not met'}`);
    item.querySelector('span').textContent = met ? '✓' : '';
  });
}

// Ibabalik ang unang problema bilang text, o null kung ayos ang password
function passwordProblem(pw) {
  const status = passwordRequirementStatus(pw);

  if (!status.length)    return 'Password must be 8 to 20 characters.';
  if (!status.uppercase) return 'Add a capital letter (A to Z).';
  if (!status.lowercase) return 'Add a lowercase letter (a to z).';
  if (!status.number)    return 'Add a number (0 to 9).';
  if (!status.symbol)    return 'Add a symbol (for example ! or #).';
  return null;
}


// =====================================================
// 10. LIGTAS NA TEXT (proteksyon laban sa XSS)
// LAGING gamitin ang esc() sa text ng user bago ilagay sa innerHTML.
// =====================================================
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// =====================================================
// 11. MALILIIT NA TULONG SA DISPLAY
// =====================================================

// Badge ng status. "Out for Delivery" -> <span class="pill st-out-for-delivery">
function statusPill(status) {
  const cls = 'st-' + String(status).toLowerCase().replace(/\s+/g, '-');
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}

// Petsa bilang text. Halimbawa: "Nov 2, 2026, 3:30 PM"
function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

// Nagpapakita ng mensahe sa isang element. type = 'ok' o 'error'
function showMsg(el, text, type) {
  el.textContent = text;
  el.className = 'msg ' + (type || '');
  el.hidden = !text;
}

// Timeline ng tracking (pinakaluma ang una)
function renderTimeline(events) {
  if (!events.length) {
    return '<p class="muted">No tracking events yet.</p>';
  }

  const items = events.map(event => `
    <li>
      <div class="tl-head">
        <strong>${esc(event.status)}</strong>
        <span class="muted">${formatDate(event.created_at)}</span>
      </div>
      ${event.location ? `<p>${esc(event.location)}</p>` : ''}
      ${event.notes ? `<p>${esc(event.notes)}</p>` : ''}
    </li>
  `).join('');

  return '<ol class="timeline">' + items + '</ol>';
}