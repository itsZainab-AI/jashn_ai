'use strict';
const $ = (s) => document.querySelector(s);
const form = $('#wizard'),
  steps = [...form.querySelectorAll('.step')];
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let step = 0;
let currentUser = null;
const TOKEN_KEY = 'jashn_demo_token';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
function setStoredToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
function fetchWithAuth(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

function showScreen(id) {
  [
    'splash-screen',
    'hero',
    'login-screen',
    'register-screen',
    'account-action-screen',
    'dashboard-screen',
  ].forEach((screenId) => {
    $(`#${screenId}`).hidden = screenId !== id;
  });
  form.hidden = true;
  $('#loading').hidden = true;
  $('#result').hidden = true;
  $('#rsvpView').hidden = true;
  $('#account-nav').hidden = id === 'splash-screen';
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

function setUser(user) {
  currentUser = user;
  if (!user) setStoredToken('');
  $('#guest-nav').hidden = Boolean(user);
  $('#user-nav').hidden = !user;
  $('#user-greeting').textContent = user ? `Hi, ${user.name}` : '';
  $('#account-status').textContent = '';
}

$('#enter-app').onclick = () => showScreen('hero');
document.querySelectorAll('[data-screen]').forEach((button) => {
  button.addEventListener('click', () => showScreen(button.dataset.screen));
});
document.querySelectorAll('[data-auth-form]').forEach((authForm) => {
  authForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAuth(authForm);
  });
});
