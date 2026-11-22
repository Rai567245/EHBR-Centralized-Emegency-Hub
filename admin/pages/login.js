'use strict';

(() => {

  const { $ } = EH;

  const form = $('#loginForm');
  const username = $('#u');
  const password = $('#p');
  const error = $('#err');
  const submitButton = $('#go');

  const passwordToggle = $('#togglePassword');
  const forgotPassword = $('#forgotPassword');
  const recoveryNote = $('#recoveryNote');


  /* =====================================================
     CHECK EXISTING ADMIN SESSION
     ===================================================== */

  if (localStorage.getItem(EH.TOKEN) && EH.api) {

    // Already signed in? Go straight to the dashboard.

    try {

      const user = JSON.parse(
        localStorage.getItem(EH.USER)
      );

      if (user && user.role === 'admin') {
        location.href = 'index.html';
      }

    } catch {
      // Invalid stored user information.
      // Stay on the login page.
    }

  }


  /* =====================================================
     PASSWORD VISIBILITY TOGGLE
     ===================================================== */

  if (passwordToggle && password) {

    // The icon shows the CURRENT state:
    // crossed-out eye = password is hidden, open eye = password is visible.

    const EYE = `
      <svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    `;

    const EYE_OFF = `
      <svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9.9 9.9a3 3 0 104.2 4.2"/>
        <path d="M10.7 5.1A10.4 10.4 0 0112 5c7 0 10 7 10 7a13.2 13.2 0 01-1.7 2.7"/>
        <path d="M6.6 6.6A13.5 13.5 0 002 12s3 7 10 7a9.7 9.7 0 005.4-1.6"/>
        <path d="M2 2l20 20"/>
      </svg>
    `;

    const setPasswordVisible = (visible) => {

      password.type = visible ? 'text' : 'password';

      passwordToggle.setAttribute(
        'aria-label',
        visible ? 'Hide password' : 'Show password'
      );

      passwordToggle.setAttribute(
        'title',
        visible ? 'Hide password' : 'Show password'
      );

      passwordToggle.setAttribute(
        'aria-pressed',
        String(visible)
      );

      passwordToggle.innerHTML = visible ? EYE : EYE_OFF;

    };

    setPasswordVisible(false);

    passwordToggle.addEventListener('click', () => {
      setPasswordVisible(password.type === 'password');
    });

  }


  /* =====================================================
     FORGOT PASSWORD INFORMATION
     ===================================================== */

  if (forgotPassword && recoveryNote) {

    forgotPassword.addEventListener('click', () => {

      const isHidden = recoveryNote.hidden;

      recoveryNote.hidden = !isHidden;

      forgotPassword.setAttribute(
        'aria-expanded',
        String(isHidden)
      );

    });

  }


  /* =====================================================
     LOGIN FORM SUBMISSION
     ===================================================== */

  form.addEventListener('submit', async (event) => {

    event.preventDefault();

    // Hide previous errors.

    error.hidden = true;
    error.textContent = '';

    // Get form values.

    const contact = username.value.trim();
    const passwordValue = password.value;


    // Validate required fields.

    if (!contact || !passwordValue) {

      error.textContent =
        'Enter your username and password.';

      error.hidden = false;

      if (!contact) {
        username.focus();
      } else {
        password.focus();
      }

      return;

    }


    // Prevent multiple submissions.

    submitButton.disabled = true;
    submitButton.textContent = 'Signing in...';


    try {

      // Existing backend authentication request.

      const out = await EH.api('/auth/login', {
        method: 'POST',

        body: {
          contact,
          password: passwordValue
        },

        auth: false
      });


      // Verify administrator role.

      if (!out.user || out.user.role !== 'admin') {

        throw new Error(
          'This account is not an administrator.'
        );

      }


      // Store authentication information.

      localStorage.setItem(
        EH.TOKEN,
        out.token
      );

      localStorage.setItem(
        EH.USER,
        JSON.stringify(out.user)
      );


      // Redirect to the existing admin dashboard.

      location.href = 'index.html';

    } catch (exception) {

      // Display authentication errors.

      error.textContent =
        exception.message ||
        'Unable to sign in. Please try again.';

      error.hidden = false;

      // Restore button state.

      submitButton.disabled = false;
      submitButton.textContent = 'Sign In';

    }

  });


})();