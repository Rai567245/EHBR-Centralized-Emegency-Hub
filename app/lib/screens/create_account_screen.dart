import 'package:flutter/material.dart';

import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/password_rules.dart';
import '../widgets/zone_picker_field.dart';
import 'app_shell.dart';

const Color _ehbrRed = Color(0xFFC7193D);

// Same neutral surface colours as the Home, Map, Contacts, News and Profile screens.
const Color _cBorder = Color(0xFFE2E4EA);
const Color _cSurface = Color(0xFFF3F4F8);

TextStyle get _inputStyle => manrope(13, FontWeight.w500, EhbrColors.ink);

/// Light, bordered input look (replaces the dark filled inputs on this screen only).
InputDecoration _fieldDeco({required String hint, IconData? icon, Widget? suffix}) {
  OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: color, width: width),
      );
  return InputDecoration(
    filled: true,
    fillColor: Colors.white,
    hintText: hint,
    hintStyle: manrope(13, FontWeight.w400, EhbrColors.muted),
    prefixIcon: icon == null ? null : Icon(icon, color: EhbrColors.muted, size: 20),
    suffixIcon: suffix,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    errorStyle: manrope(11, FontWeight.w600, _ehbrRed),
    border: border(_cBorder),
    enabledBorder: border(_cBorder),
    focusedBorder: border(_ehbrRed, 1.4),
    errorBorder: border(_ehbrRed),
    focusedErrorBorder: border(_ehbrRed, 1.4),
  );
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text, style: manrope(12, FontWeight.w700, EhbrColors.ink)),
      );
}

/// Main action button: red, rounded, with a spinner while [busy].
class _CtaButton extends StatelessWidget {
  const _CtaButton({required this.label, required this.onPressed, this.busy = false});
  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    return SizedBox(
      width: double.infinity,
      height: 50,
      child: FilledButton(
        onPressed: enabled ? onPressed : null,
        style: FilledButton.styleFrom(
          backgroundColor: _ehbrRed,
          foregroundColor: Colors.white,
          // While busy the button stays red; otherwise disabled is soft grey.
          disabledBackgroundColor:
              busy ? _ehbrRed.withValues(alpha: .85) : _cSurface,
          disabledForegroundColor: EhbrColors.muted,
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        child: busy
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
              )
            : Text(
                label,
                style: manrope(
                  15,
                  FontWeight.w700,
                  enabled ? Colors.white : EhbrColors.muted,
                ),
              ),
      ),
    );
  }
}

/// Step 1: biodata. Step 2: confirm information and accept terms.
/// A privacy notice is displayed before the account is created.
class CreateAccountScreen extends StatefulWidget {
  const CreateAccountScreen({super.key});

  @override
  State<CreateAccountScreen> createState() => _CreateAccountScreenState();
}

class _CreateAccountScreenState extends State<CreateAccountScreen> {
  final _form = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _contact = TextEditingController();
  final _address = TextEditingController();
  final _email = TextEditingController();
  final _zoneText = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  int _step = 0;
  String? _zone;
  bool _hidePw = true;
  bool _agreed = false;
  bool _busy = false;
  String? _error;

  List<String> get _zones => Session.config.zones;

  String get _zoneValue =>
      _zones.isEmpty ? _zoneText.text.trim() : (_zone ?? '');

  @override
  void dispose() {
    for (final controller in [
      _first,
      _last,
      _contact,
      _email,
      _address,
      _zoneText,
      _password,
      _confirm,
    ]) {
      controller.dispose();
    }

    super.dispose();
  }

  String? _required(String? value, String what) =>
      (value == null || value.trim().isEmpty) ? 'Enter $what' : null;

  void _continue() {
    if (!_form.currentState!.validate()) return;

    setState(() {
      _step = 1;
      _error = null;
    });
  }

  Future<void> _showPrivacyNotice() async {
    if (_busy || !_agreed) return;

    final accepted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _PrivacyNoticeSheet(),
    );

    if (accepted == true && mounted && !_busy) {
      await _create();
    }
  }

  Future<void> _create() async {
    if (_busy) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final out = await Api.register({
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'contact': _contact.text.trim(),
        'email': _email.text.trim(),
        'address': _address.text.trim(),
        'zone': _zoneValue,
        'password': _password.text,
      });

      await Session.signIn(out);

      if (!mounted) return;

      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const AppShell()),
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

  void _back() {
    if (_step == 1) {
      setState(() => _step = 0);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: _busy ? null : _back,
                    padding: EdgeInsets.zero,
                    alignment: Alignment.centerLeft,
                    icon: const Icon(
                      Icons.arrow_back,
                      color: EhbrColors.ink,
                      size: 24,
                    ),
                  ),
                  const Spacer(),
                  const EhbrEmblem(size: 40),
                  const Spacer(),
                  const SizedBox(width: 48),
                ],
              ),
              const SizedBox(height: 4),
              Center(
                child: Text(
                  'Create an Account',
                  style: manrope(24, FontWeight.w800, EhbrColors.ink),
                ),
              ),
              const SizedBox(height: 4),
              Center(
                child: Text(
                  'Help us finish setting up your account.',
                  style: manrope(13, FontWeight.w400, EhbrColors.muted),
                ),
              ),
              const SizedBox(height: 20),
              _Stepper(step: _step),
              const SizedBox(height: 20),
              if (_step == 0) _biodata() else _confirmStep(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _biodata() {
    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _Label('First name'),
                    TextFormField(
                      controller: _first,
                      style: _inputStyle,
                      cursorColor: _ehbrRed,
                      textCapitalization: TextCapitalization.words,
                      decoration: _fieldDeco(hint: 'E.g John'),
                      validator: (v) => _required(v, 'first name'),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _Label('Last name'),
                    TextFormField(
                      controller: _last,
                      style: _inputStyle,
                      cursorColor: _ehbrRed,
                      textCapitalization: TextCapitalization.words,
                      decoration: _fieldDeco(hint: 'E.g Appleseed'),
                      validator: (v) => _required(v, 'last name'),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const _Label('Contact number'),
          TextFormField(
            controller: _contact,
            keyboardType: TextInputType.phone,
            style: _inputStyle,
            cursorColor: _ehbrRed,
            decoration: _fieldDeco(
              hint: 'Enter your contact number',
              icon: Icons.phone_outlined,
            ),
            validator: (v) => (v == null || v.trim().length < 7)
                ? 'Enter a valid contact number'
                : null,
          ),
          const SizedBox(height: 16),
          const _Label('Email (optional – to reset a forgotten password)'),
          TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            style: _inputStyle,
            cursorColor: _ehbrRed,
            decoration: _fieldDeco(
              hint: 'name@example.com',
              icon: Icons.email_outlined,
            ),
            validator: (v) {
              final value = (v ?? '').trim();

              return value.isEmpty ||
                      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                          .hasMatch(value)
                  ? null
                  : 'Enter a valid email, or leave it empty';
            },
          ),
          const SizedBox(height: 16),
          const _Label('Address'),
          TextFormField(
            controller: _address,
            style: _inputStyle,
            cursorColor: _ehbrRed,
            decoration: _fieldDeco(
              hint: 'Enter your address',
              icon: Icons.location_on_outlined,
            ),
            validator: (v) => _required(v, 'your address'),
          ),
          const SizedBox(height: 16),
          const _Label('Zone / Purok'),
          if (_zones.isEmpty)
            TextFormField(
              controller: _zoneText,
              style: _inputStyle,
              cursorColor: _ehbrRed,
              decoration: _fieldDeco(
                hint: 'Enter your zone / purok',
                icon: Icons.location_on_outlined,
              ),
              validator: (v) => _required(v, 'your zone'),
            )
          else
            SelectSheetField(
              value: _zone,
              options: _zones,
              hint: 'Select zone',
              sheetTitle: 'Select zone / purok',
              icon: Icons.location_on_outlined,
              onChanged: (value) => setState(() => _zone = value),
              validator: (value) =>
                  value == null ? 'Select your zone' : null,
            ),
          const SizedBox(height: 16),
          const _Label('Password'),
          TextFormField(
            controller: _password,
            obscureText: _hidePw,
            style: _inputStyle,
            cursorColor: _ehbrRed,
            decoration: _fieldDeco(
              hint: 'Enter a password',
              icon: Icons.lock_outline_rounded,
              suffix: IconButton(
                tooltip: _hidePw ? 'Show password' : 'Hide password',
                onPressed: () =>
                    setState(() => _hidePw = !_hidePw),
                icon: Icon(
                  _hidePw ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                  color: EhbrColors.muted,
                  size: 20,
                ),
              ),
            ),
            onChanged: (_) => setState(() {}),
            validator: (v) => PasswordRules.ok(v ?? '')
                ? null
                : 'Password does not meet the rules below',
          ),
          const SizedBox(height: 10),
          PasswordRules(password: _password.text),
          const SizedBox(height: 16),
          const _Label('Confirm password'),
          TextFormField(
            controller: _confirm,
            obscureText: _hidePw,
            style: _inputStyle,
            cursorColor: _ehbrRed,
            decoration: _fieldDeco(
              hint: 'Confirm password',
              icon: Icons.lock_outline_rounded,
            ),
            validator: (v) =>
                v != _password.text ? 'Passwords do not match' : null,
          ),
          const SizedBox(height: 28),
          _CtaButton(
            label: 'Continue',
            onPressed: _continue,
          ),
        ],
      ),
    );
  }

  Widget _confirmStep() {
    Widget readOnlyField(
      String value, {
      IconData? icon,
      bool chevron = false,
    }) {
      return Container(
        height: 48,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: _cSurface,
          border: Border.all(color: _cBorder),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                color: EhbrColors.muted,
                size: 20,
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: _inputStyle,
              ),
            ),
            if (chevron)
              const Icon(
                Icons.keyboard_arrow_down,
                color: EhbrColors.muted,
                size: 20,
              ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _Label('First name'),
                  readOnlyField(_first.text.trim()),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _Label('Last name'),
                  readOnlyField(_last.text.trim()),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        const _Label('Contact number'),
        readOnlyField(_contact.text.trim(), icon: Icons.phone_outlined),
        if (_email.text.trim().isNotEmpty) ...[
          const SizedBox(height: 16),
          const _Label('Email'),
          readOnlyField(
            _email.text.trim(),
            icon: Icons.email_outlined,
          ),
        ],
        const SizedBox(height: 16),
        const _Label('Address'),
        readOnlyField(
          _address.text.trim(),
          icon: Icons.location_on_outlined,
        ),
        const SizedBox(height: 16),
        const _Label('Zone / Purok'),
        readOnlyField(
          _zoneValue,
          icon: Icons.location_on_outlined,
        ),
        const SizedBox(height: 20),
        SquareCheck(
          value: _agreed,
          onChanged: (value) => setState(() => _agreed = value),
          label: Text(
            'I agree to the Terms and Privacy Policy',
            style: manrope(
              13,
              FontWeight.w500,
              EhbrColors.ink,
            ),
          ),
        ),
        FormError(_error),
        const SizedBox(height: 16),
        _CtaButton(
          label: 'Create an account',
          onPressed: _agreed ? _showPrivacyNotice : null,
          busy: _busy,
        ),
      ],
    );
  }
}

class _PrivacyNoticeSheet extends StatelessWidget {
  const _PrivacyNoticeSheet();

  @override
  Widget build(BuildContext context) {
    final screenHeight = MediaQuery.of(context).size.height;

    return Container(
      constraints: BoxConstraints(
        maxHeight: screenHeight * 0.85,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(24),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              width: 42,
              height: 5,
              decoration: BoxDecoration(
                color: const Color(0xFFD4D4D8),
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 20, 14, 12),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: _cSurface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(
                      Icons.shield_outlined,
                      color: EhbrColors.ink,
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Your Privacy Matters',
                          style: manrope(
                            18,
                            FontWeight.w800,
                            EhbrColors.ink,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'EHBR Data Privacy Notice',
                          style: manrope(
                            12,
                            FontWeight.w400,
                            EhbrColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.pop(context, false),
                    icon: const Icon(
                      Icons.close,
                      color: EhbrColors.ink,
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: _cBorder),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(22, 18, 22, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF5E5),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: const Color(0xFFF2D6A5),
                        ),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.info_outline,
                            color: EhbrColors.ink,
                            size: 20,
                          ),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              'Development draft: The official EHBR '
                              'Privacy Policy has not yet been finalized '
                              'or approved by the barangay.',
                              style: manrope(
                                12,
                                FontWeight.w500,
                                const Color(0xFF795000),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Introduction',
                      style: _sectionTitleStyle(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'The Emergency Hub Barangay System (EHBR) is '
                      'designed to support resident account management '
                      'and access to barangay services. This notice '
                      'explains the personal information requested '
                      'during registration and the privacy details '
                      'that must be finalized by the barangay.',
                      style: _bodyStyle(),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      '1. Personal Information Collected',
                      style: _sectionTitleStyle(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'The registration form requests the following '
                      'information:',
                      style: _bodyStyle(),
                    ),
                    const SizedBox(height: 8),
                    _bullet('First and last name'),
                    _bullet('Contact number'),
                    _bullet('Email address (optional)'),
                    _bullet('Residential address'),
                    _bullet('Zone / Purok'),
                    _bullet('Account credentials'),
                    const SizedBox(height: 18),
                    Text(
                      '2. Purpose of Collection',
                      style: _sectionTitleStyle(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'The information is intended to support resident '
                      'registration, account authentication, and access '
                      'to the services provided through EHBR. The '
                      'barangay must specify and approve the complete '
                      'purposes for which each category of information '
                      'will be processed.',
                      style: _bodyStyle(),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      '3. Data Protection',
                      style: _sectionTitleStyle(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'EHBR includes an administrative Data & Privacy '
                      'section describing safeguards such as masked '
                      'contact numbers, administrative access '
                      'restrictions, and access logging. The actual '
                      'implementation and effectiveness of these '
                      'safeguards must be verified before they are '
                      'presented as confirmed protections in the '
                      'official notice.',
                      style: _bodyStyle(),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      '4. Data Sharing and Retention',
                      style: _sectionTitleStyle(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '[The barangay must identify authorized recipients '
                      'or third parties, applicable sharing arrangements, '
                      'and the approved retention period for personal '
                      'information.]',
                      style: _bodyStyle(),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      '5. Your Privacy Rights',
                      style: _sectionTitleStyle(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Under the Data Privacy Act of 2012 (Republic Act '
                      'No. 10173), data subjects have rights concerning '
                      'their personal information, subject to applicable '
                      'legal conditions and limitations. These include '
                      'the right to be informed, access, object, correct, '
                      'request erasure or blocking where applicable, '
                      'and seek remedies for violations.',
                      style: _bodyStyle(),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      '6. Privacy Contact Information',
                      style: _sectionTitleStyle(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '[The barangay must provide the identity and '
                      'contact details of its Personal Information '
                      'Controller or authorized representative and '
                      'designated Data Protection Officer.]',
                      style: _bodyStyle(),
                    ),
                    const SizedBox(height: 18),
                    const Divider(color: _cBorder),
                    const SizedBox(height: 8),
                    Text(
                      'Legal Reference',
                      style: _sectionTitleStyle(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Republic Act No. 10173 – Data Privacy Act of 2012 '
                      'and its Implementing Rules and Regulations.',
                      style: _bodyStyle(),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'This development draft is not a substitute for '
                      'the barangay-approved Privacy Notice. Final '
                      'wording and processing details must be reviewed '
                      'by the barangay’s designated privacy officer.',
                      style: manrope(
                        11,
                        FontWeight.w500,
                        EhbrColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const Divider(height: 1, color: _cBorder),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 14, 22, 18),
              child: Column(
                children: [
                  _CtaButton(
                    label: 'I Understand and Agree',
                    onPressed: () => Navigator.pop(context, true),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context, false),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: EhbrColors.ink,
                        side: const BorderSide(color: _cBorder),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: Text(
                        'Cancel',
                        style: manrope(
                          14,
                          FontWeight.w700,
                          EhbrColors.ink,
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
    );
  }

  static TextStyle _sectionTitleStyle() =>
      manrope(14, FontWeight.w700, EhbrColors.ink);

  static TextStyle _bodyStyle() =>
      manrope(12, FontWeight.w400, const Color(0xFF52525B)).copyWith(height: 1.45);

  static Widget _bullet(String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Icon(
              Icons.circle,
              size: 5,
              color: EhbrColors.ink,
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              value,
              style: _bodyStyle(),
            ),
          ),
        ],
      ),
    );
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.step});

  final int step;

  @override
  Widget build(BuildContext context) {
    Widget segment(int index, String label) {
      final reached = step >= index;
      final current = step == index;

      return Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 20,
                  height: 20,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: reached ? _ehbrRed : Colors.white,
                    border: Border.all(color: reached ? _ehbrRed : _cBorder, width: 1.4),
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '${index + 1}',
                    style: manrope(
                      10,
                      FontWeight.w700,
                      reached ? Colors.white : EhbrColors.muted,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: manrope(
                      12,
                      current ? FontWeight.w700 : FontWeight.w500,
                      current ? EhbrColors.ink : EhbrColors.muted,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Container(
              height: 4,
              decoration: BoxDecoration(
                color: reached ? _ehbrRed : _cBorder,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ],
        ),
      );
    }

    return Row(
      children: [
        segment(0, 'Biodata information'),
        const SizedBox(width: 16),
        segment(1, 'Confirm information'),
      ],
    );
  }
}