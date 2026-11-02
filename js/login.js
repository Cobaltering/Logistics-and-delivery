// login.js - ang mga nangyayari sa login page

// ===== MGA BAGAY SA PAGE =====
const form = document.getElementById('loginForm');
const msg = document.getElementById('msg');
const loginBtn = document.getElementById('loginBtn');

// ===== MGA SETTING =====
const MAX_FAILED_ATTEMPTS = 5;      // ilang beses pwedeng magkamali
const LOCKOUT_SECONDS = 30;         // gaano katagal maghihintay pagkatapos

let failedAttempts = 0;
let lockedUntil = 0;


// ===== KUNG NAKA-LOGIN NA, SKIP ANG FORM =====
async function skipLoginIfLoggedIn() {
    const me = await getProfile();
    if (me) {
        location.replace(ROLE_HOME[me.role_name]);
    }
}


// ===== NAKA-LOCK BA ANG USER? =====
// Ibabalik ang natitirang segundo, o 0 kung hindi naka-lock
function secondsLeftInLockout() {
    if (Date.now() >= lockedUntil) return 0;
    return Math.ceil((lockedUntil - Date.now()) / 1000);
}


// ===== BILANGIN ANG MALING TRY =====
function countFailedAttempt() {
    failedAttempts++;
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
        failedAttempts = 0;
    }
}


// ===== KAPAG PININDOT ANG SIGN IN =====
async function handleLogin(event) {
    event.preventDefault();

    // 1. Naka-lock ba?
    const secs = secondsLeftInLockout();
    if (secs > 0) {
        showMsg(msg, `Too many attempts. Try again in ${secs} seconds.`, 'error');
        return;
    }

    // 2. Basahin ang form
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) {
        showMsg(msg, 'Enter your email and password.', 'error');
        return;
    }

    // 3. Subukang mag-login
    loginBtn.disabled = true;
    const result = await loginUser(email, password);
    loginBtn.disabled = false;

    // 4. Mali ang login
    if (!result.ok) {
        countFailedAttempt();
        showMsg(msg, result.message, 'error');
        return;
    }

    // 5. Tama: pumunta sa dashboard ng user
    location.replace(ROLE_HOME[result.role]);
}


// ===== SIMULA =====
skipLoginIfLoggedIn();
form.addEventListener('submit', handleLogin);