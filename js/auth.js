/* =====================================================================
   auth.js
   PURPOSE: everything about "who is logged in and where do they belong".
   Load order in every page:  Supabase CDN -> supabaseClient.js -> auth.js

   REMINDER: the page guard below is only a CONVENIENCE (it redirects
   people to the right place). The REAL protection is the RLS policies
   in the database.
   ===================================================================== */

/* ---------- 1. WHERE EACH ROLE LANDS AFTER LOGIN ---------- */
const ROLE_HOME = {
  'Customer':           'customer/dashboard.html',
  'Delivery Rider':     'rider/dashboard.html',
  'Warehouse Staff':    'warehouse/dashboard.html',
  'Dispatcher':         'dispatcher/dashboard.html',
  'Operations Manager': 'manager/dashboard.html',
  'Finance Officer':    'finance/dashboard.html',
  'Administrator':      'administrator/dashboard.html'
};

/* ---------- 2. PATH HELPER ----------
   Pages in sub-folders need "../" to reach the site root.
   Each page declares it: <body data-root="../"> (or "./" for root pages). */
function root() {
  return document.body.dataset.root || './';
}

/* ---------- 3. GET THE LOGGED-IN USER'S PROFILE ----------
   Returns { user_id, full_name, email, role_name } or null if not
   logged in / account not active. */
async function getProfile() {
  // 3a. Is there a valid session (logged in)?
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData.session;
  if (!session) return null;

  // 3b. Read the profile row (RLS lets users read only their own row)
  const { data, error } = await sb
    .from('users')
    .select('user_id, full_name, email, status, roles(role_name)')
    .eq('user_id', session.user.id)
    .single();
  if (error || !data) return null;

  // 3c. Account Management Policy: inactive/locked accounts cannot enter
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

/* ---------- 4. PAGE GUARD ----------
   Call at the top of every protected page:
      const me = await requireRole(['Customer']);
   - not logged in      -> sent to login.html
   - wrong role         -> sent to their own dashboard
   - allowed            -> page becomes visible, returns the profile */
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
  document.body.classList.remove('guarded');   // un-hide the page
  return me;
}

/* ---------- 5. LOGIN ----------
   Returns { ok: true, role } or { ok: false, message } */
async function loginUser(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: 'Incorrect email or password.' };

  const me = await getProfile();
  if (!me) return { ok: false, message: 'This account is inactive or locked. Contact an administrator.' };
  return { ok: true, role: me.role_name };
}

/* ---------- 6. LOGOUT ---------- */
async function logoutUser() {
  await sb.auth.signOut();
  location.replace(root() + 'login.html');
}

/* ---------- 7. CUSTOMER REGISTRATION ----------
   The extra info goes into user metadata; the database trigger
   `handle_new_user` copies it into users + customers tables.
   NOTE: the role is NOT sent from here, self-signups are always Customer. */
async function registerCustomer({ full_name, contact_no, address, email, password }) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name, contact_no, address } }
  });
  if (error) return { ok: false, message: error.message };
  // data.session is null when "Confirm email" is enabled in Supabase
  return { ok: true, needsConfirmation: !data.session };
}

/* ---------- EMAIL OTP RESEND COOLDOWN ----------
   Limits resend buttons in the browser; Supabase Auth rate limits still apply. */
function startResendCooldown(button, label, seconds = 60) {
  if (button._resendCooldownTimer) clearInterval(button._resendCooldownTimer);

  let remaining = seconds;
  button.disabled = true;
  button.textContent = `${label} (${remaining}s)`;
  button._resendCooldownTimer = setInterval(() => {
    remaining--;
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

/* ---------- 8. PASSWORD POLICY CHECK (client side) ----------
   The server (Supabase Auth > Password settings) should enforce the same rule too. */
function passwordRequirementStatus(pw) {
  return {
    length: pw.length >= 8 && pw.length <= 20,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw)
  };
}

function updatePasswordRequirements(pw, container) {
  const status = passwordRequirementStatus(pw);
  container.querySelectorAll('[data-password-rule]').forEach(item => {
    const met = status[item.dataset.passwordRule];
    item.classList.toggle('met', met);
    const label = item.textContent.replace('✓', '').trim();
    item.setAttribute('aria-label', `${label}: ${met ? 'met' : 'not met'}`);
    item.querySelector('span').textContent = met ? '✓' : '';
  });
}

function passwordProblem(pw) {
  const status = passwordRequirementStatus(pw);
  if (!status.length)    return 'Password must be 8 to 20 characters.';
  if (!status.uppercase) return 'Add a capital letter (A to Z).';
  if (!status.lowercase) return 'Add a lowercase letter (a to z).';
  if (!status.number)    return 'Add a number (0 to 9).';
  if (!status.symbol)    return 'Add a symbol (for example ! or #).';
  return null;
}

/* ---------- 9. XSS PROTECTION ----------
   ALWAYS wrap user-supplied text in esc() before putting it into innerHTML. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- 10. SMALL UI HELPERS ---------- */

// "Out for Delivery" -> <span class="pill st-out-for-delivery">Out for Delivery</span>
function statusPill(status) {
  const cls = 'st-' + String(status).toLowerCase().replace(/\s+/g, '-');
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

// Shows a message in an element: showMsg(el, 'Saved', 'ok') or 'error'
function showMsg(el, text, type) {
  el.textContent = text;
  el.className = 'msg ' + (type || '');
  el.hidden = !text;
}

// Renders a vertical route-style timeline from tracking events (oldest first)
function renderTimeline(events) {
  if (!events.length) return '<p class="muted">No tracking events yet.</p>';
  return '<ol class="timeline">' + events.map(event => `
    <li>
      <div class="tl-head">
        <strong>${esc(event.status)}</strong>
        <span class="muted">${formatDate(event.created_at)}</span>
      </div>
      ${event.location ? `<p>${esc(event.location)}</p>` : ''}
      ${event.notes ? `<p>${esc(event.notes)}</p>` : ''}
    </li>
  `).join('') + '</ol>';
}