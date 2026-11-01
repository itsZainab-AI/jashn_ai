async function submitAuth(authForm) {
  const status = authForm.querySelector('.auth-status');
  const submit = authForm.querySelector('[type="submit"]');
  const data = Object.fromEntries(new FormData(authForm));
  status.textContent = '';
  $('#resend-verification').hidden = true;
  submit.disabled = true;
  try {
    const response = await fetch(`/api/auth/${authForm.dataset.authForm}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'We couldn’t complete that request.');
      error.code = result.code;
      throw error;
    }
    authForm.reset();
    if (result.token) setStoredToken(result.token);
    if (authForm.dataset.authForm === 'register') {
      if (result.token) {
        setUser(result.user);
        showScreen('hero');
      } else {
        showScreen('account-action-screen');
        showAccountPanel('verification-panel');
        $('#verification-message').textContent = result.message;
      }
    } else {
      setUser(result.user);
      showScreen('hero');
    }
  } catch (error) {
    status.textContent = error.message;
    if (error.code === 'EMAIL_NOT_VERIFIED') $('#resend-verification').hidden = false;
  } finally {
    authForm.querySelector('[name="password"]').value = '';
    submit.disabled = false;
  }
}

function showAccountPanel(panelId) {
  ['verification-panel', 'reset-request-panel', 'reset-complete-panel'].forEach((id) => {
    $(`#${id}`).hidden = id !== panelId;
  });
  $('#account-action-status').textContent = '';
  showScreen('account-action-screen');
}

document.querySelectorAll('[data-account-action="password-reset"]').forEach((button) => {
  button.onclick = () => showAccountPanel('reset-request-panel');
});

$('#resend-verification').onclick = () => {
  const emailInput = $('#login-screen [name="email"]');
  showAccountPanel('verification-panel');
  $('#resend-form [name="email"]').value = emailInput.value;
  $('#verification-message').textContent =
    'Enter the email address for your account and we’ll send a fresh link if verification is still needed.';
};

function handleAccountForm(formId, endpoint, onSuccess) {
  const accountForm = $(`#${formId}`);
  accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = accountForm.querySelector('.auth-status');
    const submit = accountForm.querySelector('[type="submit"]');
    status.textContent = '';
    submit.disabled = true;
    try {
      const payload = Object.fromEntries(new FormData(accountForm));
      if (formId === 'reset-complete-form') payload.token = passwordResetToken;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'We couldn’t complete that request.');
      onSuccess(result, accountForm);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      const passwordInput = accountForm.querySelector('[name="password"]');
      if (passwordInput) passwordInput.value = '';
      submit.disabled = false;
    }
  });
}

handleAccountForm('resend-form', '/api/auth/verification/resend', (result, accountForm) => {
  accountForm.querySelector('.auth-status').textContent = result.message;
  accountForm.reset();
});

handleAccountForm(
  'reset-request-form',
  '/api/auth/password-reset/request',
  (result, accountForm) => {
    accountForm.querySelector('.auth-status').textContent = result.message;
    accountForm.reset();
  },
);

let passwordResetToken = '';
handleAccountForm(
  'reset-complete-form',
  '/api/auth/password-reset/complete',
  (result, accountForm) => {
    accountForm.reset();
    passwordResetToken = '';
    $('#login-screen .auth-status').textContent = result.message;
    showScreen('login-screen');
  },
);

$('#dashboard-link').onclick = loadDashboard;
