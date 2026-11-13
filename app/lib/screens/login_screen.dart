import 'package:flutter/material.dart';

import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/auth_widgets.dart';
import 'app_shell.dart';
import 'create_account_screen.dart';
import 'forgot_password_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _contact = TextEditingController();
  final _password = TextEditingController();

  // The red is kept for the main action so it draws attention.
  static const Color _red = Color(0xFFC9183A);

  // Same neutral colours as the rest of the restyled screens.
  static const Color _border = Color(0xFFE2E4EA);

  bool _hide = true;
  bool _remember = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _contact.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_form.currentState!.validate()) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final out = await Api.login(
        _contact.text.trim(),
        _password.text,
      );

      await Session.signIn(out, remember: _remember);

      if (!mounted) return;

      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(
          builder: (_) => const AppShell(),
        ),
        (_) => false,
      );
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

  void _forgot() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ForgotPasswordScreen(
          initialContact: _contact.text.trim(),
        ),
      ),
    );
  }

  /// Light, bordered input (replaces the dark filled input on this screen only).
  InputDecoration _decoration({
    required String hint,
    required IconData icon,
    Widget? suffix,
  }) {
    OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: color, width: width),
        );

    return InputDecoration(
      hintText: hint,
      hintStyle: manrope(13, FontWeight.w400, EhbrColors.muted),
      prefixIcon: Icon(icon, color: EhbrColors.muted, size: 20),
      suffixIcon: suffix,
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      errorStyle: manrope(11, FontWeight.w600, _red),
      border: border(_border),
      enabledBorder: border(_border),
      focusedBorder: border(_red, 1.4),
      errorBorder: border(_red),
      focusedErrorBorder: border(_red, 1.4),
    );
  }

  Widget _fieldLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text,
        style: manrope(12, FontWeight.w700, EhbrColors.ink),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cfg = Session.config;

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 40, 16, 24),
          child: Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // EHBR emblem
                Center(
                  child: EhbrEmblem(size: 44),
                ),

                const SizedBox(height: 10),

                // App title
                Text(
                  'Emergency Hub',
                  textAlign: TextAlign.center,
                  style: manrope(
                    24,
                    FontWeight.w800,
                    EhbrColors.ink,
                  ),
                ),

                const SizedBox(height: 2),

                // Location subtitle
                Text(
                  cfg.locationLine.isNotEmpty
                      ? cfg.locationLine
                      : 'Barangay Rizal, Taguig',
                  textAlign: TextAlign.center,
                  style: manrope(
                    13,
                    FontWeight.w400,
                    EhbrColors.muted,
                  ),
                ),

                const SizedBox(height: 32),

                // Contact number
                _fieldLabel('Contact number'),

                TextFormField(
                  controller: _contact,
                  keyboardType: TextInputType.phone,
                  style: manrope(13, FontWeight.w500, EhbrColors.ink),
                  cursorColor: _red,
                  decoration: _decoration(
                    hint: 'Enter your contact number',
                    icon: Icons.phone_outlined,
                  ),
                  validator: (v) {
                    if (v == null || v.trim().length < 7) {
                      return 'Enter a valid contact number';
                    }
                    return null;
                  },
                ),

                const SizedBox(height: 16),

                // Password
                _fieldLabel('Password'),

                TextFormField(
                  controller: _password,
                  obscureText: _hide,
                  style: manrope(13, FontWeight.w500, EhbrColors.ink),
                  cursorColor: _red,
                  decoration: _decoration(
                    hint: 'Enter password',
                    icon: Icons.lock_outline_rounded,
                    suffix: IconButton(
                      tooltip: _hide ? 'Show password' : 'Hide password',
                      onPressed: () {
                        setState(() => _hide = !_hide);
                      },
                      icon: Icon(
                        // Icon shows the current state: crossed-out eye = hidden.
                        _hide
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        color: EhbrColors.muted,
                        size: 20,
                      ),
                    ),
                  ),
                  validator: (v) {
                    if (v == null || v.isEmpty) {
                      return 'Enter your password';
                    }
                    return null;
                  },
                  onFieldSubmitted: (_) => _login(),
                ),

                const SizedBox(height: 12),

                // Remember Me and Forgot Password
                Row(
                  children: [
                    Expanded(
                      child: SquareCheck(
                        value: _remember,
                        onChanged: (v) {
                          setState(() => _remember = v);
                        },
                        label: Text(
                          'Remember Me',
                          style: manrope(
                            13,
                            FontWeight.w500,
                            EhbrColors.ink,
                          ),
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: _forgot,
                      style: TextButton.styleFrom(
                        foregroundColor: EhbrColors.ink,
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        minimumSize: Size.zero,
                        tapTargetSize:
                            MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: Text(
                        'Forgot password?',
                        style: manrope(
                          13,
                          FontWeight.w700,
                          EhbrColors.ink,
                        ),
                      ),
                    ),
                  ],
                ),

                // Login error
                if (_error != null) ...[
                  const SizedBox(height: 6),
                  FormError(_error),
                ],

                const SizedBox(height: 24),

                // Login button (kept red: it is the main action)
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: FilledButton(
                    onPressed: _busy ? null : _login,
                    style: FilledButton.styleFrom(
                      backgroundColor: _red,
                      foregroundColor: Colors.white,
                      // Stays red while signing in, so the spinner is visible on red.
                      disabledBackgroundColor: _red.withValues(alpha: .85),
                      disabledForegroundColor: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: _busy
                        ? const SizedBox(
                            width: 21,
                            height: 21,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(
                            'Login',
                            style: manrope(
                              16,
                              FontWeight.w700,
                              Colors.white,
                            ),
                          ),
                  ),
                ),

                const SizedBox(height: 24),

                // Sign up
                Center(
                  child: Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        "Don't have an account? ",
                        style: manrope(
                          14,
                          FontWeight.w500,
                          EhbrColors.muted,
                        ),
                      ),
                      GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  const CreateAccountScreen(),
                            ),
                          );
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Text(
                            'Sign up',
                            style: manrope(
                              14,
                              FontWeight.w700,
                              _red,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}