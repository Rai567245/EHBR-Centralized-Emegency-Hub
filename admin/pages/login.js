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

    passwordToggle.addEventListener('click', () => {

      const isPassword =
        password.type === 'password';

      password.type = isPassword
        ? 'text'
        : 'password';

      passwordToggle.setAttribute(
        'aria-label',
        isPassword ? 'Hide password' : 'Show password'
      );

      passwordToggle.setAttribute(
        'aria-pressed',
        String(isPassword)
      );

      passwordToggle.innerHTML = isPassword
        ? `
          <svg viewBox="0 0 24 24"
               aria-hidden="true">
            <path d="M3 3l18 18"/>
            <path d="M10.6 10.6a2 2 0 002.8 2.8"/>
            <path d="M9.9 5.2A10.8 10.8 0 0112 5
              c6.5 0 10 7 10 7a16 16 0 01-3
              3.8"/>
            <path d="M6.2 6.2A16.5 16.5 0 002
              12s3.5 7 10 7c1.3 0 2.5-.3
              3.5-.8"/>
          </svg>
        `
        : `
          <svg viewBox="0 0 24 24"
               aria-hidden="true">
            <path d="M2 12s3.5-7 10-7
              10 7 10 7-3.5 7-10
              7-10-7-10-7z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        `;

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