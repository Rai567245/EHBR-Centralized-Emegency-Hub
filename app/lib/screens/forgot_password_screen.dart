import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/password_rules.dart';

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({
    super.key,
    this.initialContact = '',
  });

  final String initialContact;

  @override
  State<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState
    extends State<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();

  late final TextEditingController _contact =
      TextEditingController(text: widget.initialContact);

  final _code = TextEditingController();
  final _codeFocus = FocusNode();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  // Shared design tokens (same values as the other restyled screens).
  static const Color _red = Color(0xFFC9183A);
  static const Color _border = Color(0xFFE2E4EA);
  static const Color _tile = Color(0xFFF3F4F8);
  static const Color _iconDark = Color(0xFF3A3F4B);
  static const Color _muted = Color(0xFF6B7280);
  static const Color _hint = Color(0xFF9AA0AE);
  static const Color _errorRed = Color(0xFFD32F2F);

  static const int _resendSeconds = 60;

  /// 0 = contact number, 1 = enter code, 2 = new password.
  int _stage = 0;

  /// Becomes true after the first tap on Reset Password; from then on the
  /// password fields validate live so the user sees what to fix.
  bool _triedSubmit = false;

  bool _hideNew = true;
  bool _hideConfirm = true;
  bool _requested = false;
  bool _staffAsked = false;

  bool _busy = false;

  /// True while the entered code is being checked with the server.
  bool _verifying = false;
  bool _done = false;

  int _cooldown = 0;
  Timer? _ticker;

  String? _error;

  /// Message shown under the code boxes (wrong or expired code).
  String? _codeError;

  bool get _email => Session.config.emailReset;

  bool get _validContact => _contact.text.trim().length >= 7;

  /// Reset codes are always 6 digits.
  static const int _codeLen = 6;

  bool get _codeComplete => _code.text.length == _codeLen;

  bool get _passwordReady =>
      PasswordRules.ok(_password.text) &&
      _confirm.text.isNotEmpty &&
      _confirm.text == _password.text;

  @override
  void initState() {
    super.initState();
    _contact.addListener(_refresh);
    _code.addListener(_onCodeChanged);
    _codeFocus.addListener(_refresh);
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  /// Typing a new digit clears the "wrong code" message.
  void _onCodeChanged() {
    if (_codeError != null && _code.text.isNotEmpty) _codeError = null;
    _refresh();
  }

  /// Plain-language message for a failed code check.
  String _codeProblem(ApiException e) {
    if (e.status == 400) {
      return 'That code is incorrect or has expired. Check it and try again, or request a new one.';
    }
    if (e.status == 404) {
      return 'We couldn’t check your code right now. Please try again in a moment.';
    }
    return e.message;
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _contact.removeListener(_refresh);
    _code.removeListener(_onCodeChanged);
    _codeFocus.removeListener(_refresh);
    _contact.dispose();
    _code.dispose();
    _codeFocus.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------
  // Logic (same API calls as before)
  // ---------------------------------------------------------------

  String get _cooldownText {
    final m = _cooldown ~/ 60;
    final s = (_cooldown % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  void _startCooldown() {
    _ticker?.cancel();
    setState(() => _cooldown = _resendSeconds);
    _ticker = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      setState(() {
        _cooldown--;
        if (_cooldown <= 0) {
          _cooldown = 0;
          t.cancel();
        }
      });
    });
  }

  Future<void> _request({bool staff = false}) async {
    if (!_validContact) {
      setState(() {
        _error = 'Enter the contact number you signed up with';
      });
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await Api.forgotPassword(
        _contact.text.trim(),
        staff: staff,
      );

      if (!mounted) return;

      setState(() {
        _requested = true;
        if (staff || !_email) {
          _staffAsked = true;
        }
        _stage = 1;
        _code.clear();
      });
      _startCooldown();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _error = e.message);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  void _haveCodeAlready() {
    if (!_validContact) {
      setState(() {
        _error = 'Enter the contact number you signed up with';
      });
      return;
    }
    setState(() {
      _stage = 1;
      _error = null;
      _requested = false;
    });
  }

  /// Step 2 -> 3: ask the server if the code is correct. The code is NOT
  /// used up by this check, it is still needed in step 3 to set the password.
  Future<void> _verify() async {
    if (!_codeComplete || _verifying || _busy) return;

    setState(() {
      _verifying = true;
      _error = null;
      _codeError = null;
    });

    try {
      await Api.verifyResetCode(
        _contact.text.trim(),
        _code.text.trim(),
      );

      // Ignore the answer if the resident already left this step.
      if (!mounted || _stage != 1) return;

      setState(() {
        _stage = 2;
        _error = null;
        _codeError = null;
      });
    } on ApiException catch (e) {
      if (!mounted || _stage != 1) return;
      setState(() => _codeError = _codeProblem(e));
      // Wrong or expired: clear the boxes so the code can be typed again.
      _code.clear();
      _codeFocus.requestFocus();
    } finally {
      if (mounted) {
        setState(() => _verifying = false);
      }
    }
  }

  Future<void> _reset() async {
    setState(() => _triedSubmit = true);
    if (!_form.currentState!.validate()) return;
    if (!_passwordReady) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await Api.resetPassword(
        _contact.text.trim(),
        _code.text.trim(),
        _password.text,
      );

      if (mounted) {
        setState(() => _done = true);
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _error = e.message);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  void _backToLogin() {
    Navigator.of(context).pop();
  }

  /// Wrong number: go back to the contact step and start over.
  void _editContact() {
    _ticker?.cancel();
    setState(() {
      _stage = 0;
      _requested = false;
      _staffAsked = false;
      _cooldown = 0;
      _error = null;
      _codeError = null;
      _code.clear();
    });
  }

  void _back() {
    if (_done || _stage == 0) {
      _backToLogin();
    } else if (_stage == 1) {
      _editContact();
    } else {
      setState(() {
        _stage = 1;
        _error = null;
        _triedSubmit = false;
      });
    }
  }

  // ---------------------------------------------------------------
  // Shared pieces
  // ---------------------------------------------------------------

  Widget _buildLogo() {
    return Image.asset(
      'assets/images/ehbr_logo.png',
      width: 44,
      height: 44,
      fit: BoxFit.contain,
      errorBuilder: (context, error, stackTrace) {
        return const SizedBox(
          width: 44,
          height: 44,
          child: Icon(
            Icons.broken_image_outlined,
            size: 32,
            color: _iconDark,
          ),
        );
      },
    );
  }

  Widget _buildBackButton() {
    return Align(
      alignment: Alignment.centerLeft,
      child: IconButton(
        onPressed: (_busy || _verifying) ? null : _back,
        tooltip: 'Back',
        icon: const Icon(
          Icons.arrow_back,
          color: EhbrColors.ink,
          size: 22,
        ),
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints(
          minWidth: 48,
          minHeight: 48,
        ),
      ),
    );
  }

  Widget _buildHeader({
    required String title,
    required String description,
  }) {
    return Column(
      children: [
        _buildBackButton(),
        const SizedBox(height: 2),
        _buildLogo(),
        const SizedBox(height: 12),
        Text(
          title,
          textAlign: TextAlign.center,
          style: manrope(
            20,
            FontWeight.w700,
            EhbrColors.ink,
          ),
        ),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Text(
            description,
            textAlign: TextAlign.center,
            style: manrope(
              13,
              FontWeight.w400,
              _muted,
            ),
          ),
        ),
      ],
    );
  }

  /// Icon inside a soft grey square, used as the field prefix.
  Widget _iconTile(IconData icon) {
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: _tile,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(
          icon,
          size: 18,
          color: _iconDark,
        ),
      ),
    );
  }

  OutlineInputBorder _outline(Color color, [double width = 1]) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide(color: color, width: width),
    );
  }

  InputDecoration _inputDecoration({
    required String hint,
    required IconData icon,
    Widget? suffix,
  }) {
    return InputDecoration(
      hintText: hint,
      hintStyle: manrope(
        13,
        FontWeight.w400,
        _hint,
      ),
      prefixIcon: _iconTile(icon),
      suffixIcon: suffix,
      filled: true,
      fillColor: Colors.white,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 15,
      ),
      prefixIconConstraints: const BoxConstraints(
        minWidth: 48,
        minHeight: 48,
      ),
      suffixIconConstraints: const BoxConstraints(
        minWidth: 48,
        minHeight: 48,
      ),
      border: _outline(_border),
      enabledBorder: _outline(_border),
      disabledBorder: _outline(_border),
      focusedBorder: _outline(_red, 1.4),
      errorBorder: _outline(_errorRed),
      focusedErrorBorder: _outline(_errorRed, 1.4),
      errorStyle: manrope(
        11,
        FontWeight.w500,
        _errorRed,
      ),
    );
  }

  TextStyle get _inputText => manrope(
        14,
        FontWeight.w500,
        EhbrColors.ink,
      );

  Widget _fieldLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: manrope(
          13,
          FontWeight.w700,
          EhbrColors.ink,
        ),
      ),
    );
  }

  /// Red primary button.
  Widget _buildPrimaryButton({
    required String label,
    required VoidCallback? onPressed,
    bool busy = false,
    bool enabled = true,
  }) {
    final active = enabled && onPressed != null && !busy;

    return SizedBox(
      width: double.infinity,
      height: 50,
      child: ElevatedButton(
        onPressed: active ? onPressed : (busy ? () {} : null),
        style: ButtonStyle(
          backgroundColor: WidgetStateProperty.resolveWith<Color>(
            (states) {
              if (states.contains(WidgetState.disabled)) {
                return _tile;
              }
              return _red;
            },
          ),
          foregroundColor: WidgetStateProperty.resolveWith<Color>(
            (states) {
              if (states.contains(WidgetState.disabled)) {
                return _hint;
              }
              return Colors.white;
            },
          ),
          elevation: WidgetStateProperty.all(0),
          padding: WidgetStateProperty.all(
            const EdgeInsets.symmetric(horizontal: 12),
          ),
          shape: WidgetStateProperty.resolveWith<OutlinedBorder>(
            (states) {
              final disabled = states.contains(WidgetState.disabled);
              return RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: disabled
                    ? const BorderSide(color: _border)
                    : BorderSide.none,
              );
            },
          ),
        ),
        child: busy
            ? const SizedBox(
                width: 21,
                height: 21,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : Text(
                label,
                textAlign: TextAlign.center,
                style: manrope(
                  15,
                  FontWeight.w700,
                  active ? Colors.white : _hint,
                ),
              ),
      ),
    );
  }

  /// Low-emphasis action: plain text plus a small chevron.
  Widget _buildLinkAction({
    required String label,
    required VoidCallback? onPressed,
  }) {
    return Center(
      child: TextButton(
        onPressed: onPressed,
        style: TextButton.styleFrom(
          minimumSize: const Size(0, 44),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          foregroundColor: EhbrColors.ink,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                label,
                textAlign: TextAlign.center,
                style: manrope(
                  14,
                  FontWeight.w600,
                  EhbrColors.ink,
                ),
              ),
            ),
            const SizedBox(width: 2),
            const Icon(
              Icons.chevron_right_rounded,
              size: 20,
              color: _iconDark,
            ),
          ],
        ),
      ),
    );
  }

  /// Neutral banner: soft tint, thin border, dark icon.
  Widget _buildBanner(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _tile,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(
              Icons.info_outline,
              size: 20,
              color: _iconDark,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: manrope(
                13,
                FontWeight.w400,
                EhbrColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// "Prompt text" followed by a red tappable action.
  Widget _buildPromptLink(
    String prompt,
    String action,
    VoidCallback onTap,
  ) {
    return Center(
      child: Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            '$prompt ',
            style: manrope(
              13,
              FontWeight.w400,
              _muted,
            ),
          ),
          TextButton(
            onPressed: onTap,
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 44),
              padding: const EdgeInsets.symmetric(horizontal: 4),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              action,
              style: manrope(
                13,
                FontWeight.w700,
                _red,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBackToLoginText() {
    return _buildPromptLink(
      'Remembered it?',
      'Back to Login',
      _backToLogin,
    );
  }

  // ---------------------------------------------------------------
  // Code entry boxes
  // ---------------------------------------------------------------

  Widget _otpBoxes() {
    final len = _codeLen;
    final text = _code.text;
    final focused = _codeFocus.hasFocus;
    final current = text.length >= len ? len - 1 : text.length;

    return Semantics(
      label:
          'Verification code, ${text.length} of $len digits entered',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          _codeFocus.requestFocus();
          SystemChannels.textInput.invokeMethod<void>('TextInput.show');
        },
        child: Stack(
          children: [
            Row(
              children: [
                for (var i = 0; i < len; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  Expanded(
                    child: Container(
                      height: 56,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: _codeError != null
                              ? _errorRed
                              : (focused && i == current)
                                  ? _red
                                  : _border,
                          width: (_codeError != null ||
                                  (focused && i == current))
                              ? 1.4
                              : 1,
                        ),
                      ),
                      child: Text(
                        i < text.length ? text[i] : '',
                        style: manrope(
                          20,
                          FontWeight.w700,
                          EhbrColors.ink,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
            // Hidden field that receives the typing, pasting and autofill.
            Positioned(
              left: 0,
              top: 0,
              child: SizedBox(
                width: 1,
                height: 1,
                child: Opacity(
                  opacity: 0,
                  child: TextField(
                    controller: _code,
                    focusNode: _codeFocus,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    showCursor: false,
                    enableInteractiveSelection: false,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(len),
                    ],
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      counterText: '',
                      isDense: true,
                      contentPadding: EdgeInsets.zero,
                    ),
                    style: const TextStyle(fontSize: 1),
                    onSubmitted: (_) => _verify(),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Red message under the code boxes, centred like the rest of this step.
  Widget _codeErrorRow(String message) {
    return Semantics(
      liveRegion: true,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(
              Icons.error_outline,
              size: 16,
              color: _errorRed,
            ),
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              message,
              textAlign: TextAlign.center,
              style: manrope(
                12,
                FontWeight.w600,
                _errorRed,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _resendRow() {
    if (_cooldown > 0) {
      return Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.schedule,
            size: 16,
            color: _iconDark,
          ),
          const SizedBox(width: 6),
          Text(
            'Resend code in $_cooldownText',
            style: manrope(
              13,
              FontWeight.w500,
              _muted,
            ),
          ),
        ],
      );
    }

    return _buildPromptLink(
      _requested ? 'Didn’t get it?' : 'Need a new code?',
      _requested ? 'Resend code' : 'Send a code',
      (_busy || _verifying) ? () {} : () => _request(staff: _staffAsked),
    );
  }

  // ---------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final hotline = Session.config.hotline;

    return PopScope(
      canPop: _done || _stage == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            keyboardDismissBehavior:
                ScrollViewKeyboardDismissBehavior.onDrag,
            child: _done
                ? _success()
                : Form(
                    key: _form,
                    child: switch (_stage) {
                      0 => _stageContact(),
                      1 => _stageCode(hotline),
                      _ => _stagePassword(),
                    },
                  ),
          ),
        ),
      ),
    );
  }

  // Step 1: contact number.
  Widget _stageContact() {
    final description = _email
        ? 'Enter the mobile number linked to your account. If it has a recovery email, we will email you a 6-digit code to reset your password.'
        : 'For your safety, the barangay office confirms your identity before giving you a reset code.';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildHeader(
          title: 'Forgot Password?',
          description: description,
        ),
        const SizedBox(height: 20),

        _fieldLabel('Registered contact number'),

        TextFormField(
          controller: _contact,
          keyboardType: TextInputType.phone,
          style: _inputText,
          cursorColor: EhbrColors.ink,
          decoration: _inputDecoration(
            hint: 'Enter your contact number',
            icon: Icons.phone_outlined,
          ),
        ),

        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 1),
              child: Icon(
                Icons.info_outline,
                size: 15,
                color: _iconDark,
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'We will only send a code if this number is registered.',
                style: manrope(
                  12,
                  FontWeight.w400,
                  _muted,
                ),
              ),
            ),
          ],
        ),

        FormError(_error),

        const SizedBox(height: 20),

        _buildPrimaryButton(
          label: 'Send Verification Code',
          onPressed: _busy ? null : () => _request(),
          busy: _busy,
          enabled: _validContact,
        ),

        const SizedBox(height: 8),
        _buildLinkAction(
          label: 'I already have a code',
          onPressed: _haveCodeAlready,
        ),

        const SizedBox(height: 8),
        _buildBackToLoginText(),
      ],
    );
  }

  // Step 2: Verify Your Identity (code entry, checked with the server).
  Widget _stageCode(String hotline) {
    final description = _staffAsked
        ? 'Enter the 6-digit code from the barangay office.'
        : _requested
            ? 'If this number has a recovery email, we sent a $_codeLen-digit code to it.'
            : 'Enter the $_codeLen-digit code you received.';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildHeader(
          title: 'Verify Your Identity',
          description: description,
        ),
        const SizedBox(height: 20),

        if (_staffAsked) ...[
          _buildBanner(
            'Your request has been sent. Barangay staff can now see it. '
            '${hotline.isNotEmpty ? 'Call $hotline or visit' : 'Visit'} '
            'the barangay hall, confirm your identity, and request your '
            '6-digit code. It is valid for 30 minutes.',
          ),
          const SizedBox(height: 20),
        ],

        _otpBoxes(),

        if (_codeError != null) ...[
          const SizedBox(height: 12),
          _codeErrorRow(_codeError!),
        ],

        const SizedBox(height: 16),
        _resendRow(),

        if (_requested && !_staffAsked) ...[
          const SizedBox(height: 4),
          Text(
            'Check your spam folder too. The code expires in 15 minutes and can only be used once.',
            textAlign: TextAlign.center,
            style: manrope(
              12,
              FontWeight.w400,
              _muted,
            ),
          ),
        ],

        FormError(_error),

        const SizedBox(height: 20),

        _buildPrimaryButton(
          label: 'Verify',
          onPressed: _verify,
          busy: _verifying,
          enabled: _codeComplete,
        ),

        if (_email && !_staffAsked) ...[
          const SizedBox(height: 8),
          _buildPromptLink(
            'No email, or it did not arrive?',
            'Ask the barangay office',
            (_busy || _verifying) ? () {} : () => _request(staff: true),
          ),
        ],

        const SizedBox(height: 4),
        _buildPromptLink(
          'Wrong number?',
          'Edit contact number',
          _editContact,
        ),
      ],
    );
  }

  // Step 3: Create New Password.
  Widget _stagePassword() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildHeader(
          title: 'Create New Password',
          description:
              'Your new password must be different from the one you used before.',
        ),

        const SizedBox(height: 20),

        _fieldLabel('New password'),
        TextFormField(
          controller: _password,
          obscureText: _hideNew,
          style: _inputText,
          cursorColor: EhbrColors.ink,
          autovalidateMode: _triedSubmit
              ? AutovalidateMode.always
              : AutovalidateMode.disabled,
          onChanged: (_) => setState(() {}),
          decoration: _inputDecoration(
            hint: 'Enter a new password',
            icon: Icons.lock_outline,
            suffix: IconButton(
              onPressed: () {
                setState(() => _hideNew = !_hideNew);
              },
              tooltip: _hideNew ? 'Show password' : 'Hide password',
              icon: Icon(
                // Icon shows the current state: crossed-out eye = hidden.
                _hideNew
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                color: _iconDark,
                size: 20,
              ),
            ),
          ),
          validator: (value) {
            return PasswordRules.ok(value ?? '')
                ? null
                : 'Password does not meet the rules below';
          },
        ),

        const SizedBox(height: 14),

        _fieldLabel('Confirm new password'),
        TextFormField(
          controller: _confirm,
          obscureText: _hideConfirm,
          style: _inputText,
          cursorColor: EhbrColors.ink,
          textInputAction: TextInputAction.done,
          autovalidateMode: _triedSubmit
              ? AutovalidateMode.always
              : AutovalidateMode.disabled,
          onChanged: (_) => setState(() {}),
          decoration: _inputDecoration(
            hint: 'Re-enter the new password',
            icon: Icons.lock_outline,
            suffix: IconButton(
              onPressed: () {
                setState(() => _hideConfirm = !_hideConfirm);
              },
              tooltip:
                  _hideConfirm ? 'Show password' : 'Hide password',
              icon: Icon(
                _hideConfirm
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                color: _iconDark,
                size: 20,
              ),
            ),
          ),
          validator: (value) {
            if (value == null || value.isEmpty) {
              return 'Re-enter your new password';
            }
            if (value != _password.text) {
              return 'Passwords do not match';
            }
            return null;
          },
          onFieldSubmitted: (_) => _reset(),
        ),

        const SizedBox(height: 16),

        PasswordRules(password: _password.text),

        FormError(_error),

        const SizedBox(height: 20),

        _buildPrimaryButton(
          label: 'Reset Password',
          onPressed: _reset,
          busy: _busy,
        ),
      ],
    );
  }

  /// Green success badge: soft ring, solid circle, white check. Pops in once.
  Widget _successBadge() {
    const green = Color(0xFF15803D);
    const tint = Color(0xFFE8F5EC);

    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0.6, end: 1),
      duration: const Duration(milliseconds: 420),
      curve: Curves.easeOutBack,
      builder: (context, scale, child) {
        return Opacity(
          opacity: scale.clamp(0.0, 1.0),
          child: Transform.scale(scale: scale, child: child),
        );
      },
      child: Container(
        width: 112,
        height: 112,
        decoration: const BoxDecoration(
          color: tint,
          shape: BoxShape.circle,
        ),
        alignment: Alignment.center,
        child: Container(
          width: 76,
          height: 76,
          decoration: const BoxDecoration(
            color: green,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.check_rounded,
            size: 44,
            color: Colors.white,
          ),
        ),
      ),
    );
  }

  Widget _success() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildBackButton(),
        const SizedBox(height: 32),
        Center(child: _buildLogo()),
        const SizedBox(height: 32),
        Center(child: _successBadge()),
        const SizedBox(height: 24),
        Text(
          'Password changed',
          textAlign: TextAlign.center,
          style: manrope(
            22,
            FontWeight.w800,
            EhbrColors.ink,
          ),
        ),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            'Your password was updated and you were signed out everywhere. Log in with your new password.',
            textAlign: TextAlign.center,
            style: manrope(
              13,
              FontWeight.w400,
              _muted,
            ).copyWith(height: 1.45),
          ),
        ),
        const SizedBox(height: 32),
        _buildPrimaryButton(
          label: 'Back to Login',
          onPressed: _backToLogin,
        ),
      ],
    );
  }
}