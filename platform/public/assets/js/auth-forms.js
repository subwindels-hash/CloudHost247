/**
 * Login / register / password-reset forms for the public site.
 *
 * Progressive enhancement: each form works only with JS, but the markup is plain HTML so the
 * pages are crawlable and the fields are labelled and autocompleted correctly without it.
 */

import { authApi, store, describeError } from './api.js';
import { isPasskeySupported, getAssertion } from './webauthn.js';

function bindForm(selector, onSubmit) {
  const form = document.querySelector(selector);
  if (!form) return null;

  const alert = form.querySelector('[data-form-alert]');
  const submit = form.querySelector('button[type="submit"]');

  const fail = (message) => {
    if (!alert) return;
    alert.dataset.state = 'error';
    alert.textContent = message;
  };

  const succeed = (message) => {
    if (!alert) return;
    alert.dataset.state = 'success';
    alert.textContent = message;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit) submit.disabled = true;
    if (alert) {
      alert.dataset.state = '';
      alert.textContent = '';
    }

    const data = Object.fromEntries(new FormData(form).entries());

    try {
      await onSubmit(data, { succeed, form });
    } catch (err) {
      fail(describeError(err));
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  return { form, fail, succeed };
}

/** Where to send the user after a successful sign-in. */
function afterAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  // Only allow same-origin relative paths, so `?next=` cannot be used as an open redirect.
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/app/account';
}

function initLogin() {
  bindForm('[data-login-form]', async (data) => {
    const result = await authApi.login({
      email: data.email,
      password: data.password,
      totpCode: data.totpCode || undefined,
    });

    // MFA is on but no code was supplied: reveal the second factor field instead of failing.
    if (result.mfaRequired) {
      const mfaField = document.querySelector('[data-mfa-field]');
      if (mfaField) {
        mfaField.hidden = false;
        mfaField.querySelector('input')?.focus();
      }
      throw Object.assign(new Error('Enter the six-digit code from your authenticator app'), { details: null });
    }

    store.save(result);
    window.location.href = afterAuthRedirect();
  });
}

/**
 * Passkey sign-in.
 *
 * Deliberately not an auto-triggered ceremony on page load: a WebAuthn prompt that appears before
 * the visitor has asked for anything is confusing, and browsers increasingly refuse unrequested
 * ones. The button is revealed only when the browser can actually run the ceremony.
 *
 * The email field is optional — leaving it blank asks the server for a discoverable-credential
 * sign-in, and the authenticator itself picks the account.
 */
function initPasskeyLogin() {
  const block = document.querySelector('[data-passkey-block]');
  const button = document.querySelector('[data-passkey-login]');
  const hint = document.querySelector('[data-passkey-hint]');
  if (!block || !button) return;

  if (!isPasskeySupported()) return; // Leave the block hidden rather than offering a dead button.
  block.hidden = false;

  const showHint = (message) => {
    if (!hint) return;
    hint.textContent = message;
    hint.hidden = false;
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    if (hint) hint.hidden = true;
    try {
      const email = document.querySelector('#email')?.value?.trim() || undefined;
      const options = await authApi.passkeyLoginOptions(email);
      const response = await getAssertion(options.options);
      const result = await authApi.passkeyLoginVerify(options.challengeId, response);
      store.save(result);
      window.location.href = afterAuthRedirect();
    } catch (err) {
      // A cancelled ceremony is a normal outcome, not an error worth a scary alert.
      if (err?.name === 'NotAllowedError') {
        showHint('Passkey sign-in was cancelled, or your device did not recognise a passkey.');
      } else if (err?.status === 401) {
        showHint('No passkey on this device matches that account. Sign in with your password instead.');
      } else {
        showHint(describeError(err));
      }
    } finally {
      button.disabled = false;
    }
  });
}

function initRegister() {
  bindForm('[data-register-form]', async (data) => {
    if (data.password !== data.confirmPassword) {
      throw Object.assign(new Error('The two passwords do not match'));
    }

    const result = await authApi.register({
      email: data.email,
      password: data.password,
      fullName: data.fullName,
      phone: data.phone || undefined,
      country: data.country || undefined,
    });

    store.save(result);
    window.location.href = afterAuthRedirect();
  });
}

function initForgot() {
  bindForm('[data-forgot-form]', async (data, { succeed }) => {
    await authApi.forgot(data.email);
    // The API answers identically whether or not the address exists, so this copy must not
    // promise delivery.
    succeed('If that email is registered, a reset link is on its way. Check your spam folder too.');
  });
}

function initReset() {
  bindForm('[data-reset-form]', async (data) => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) throw Object.assign(new Error('This reset link is incomplete, request a new one'));
    if (data.password !== data.confirmPassword) {
      throw Object.assign(new Error('The two passwords do not match'));
    }

    const result = await authApi.reset(token, data.password);
    store.save(result);
    window.location.href = '/app/account';
  });
}

function init() {
  initLogin();
  initPasskeyLogin();
  initRegister();
  initForgot();
  initReset();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
