import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../phone.dart';
import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/password_rules.dart';

// Same neutral surface colours as the Home, Map, Contacts, News and Profile screens.
const Color _bBorder = Color(0xFFE2E4EA);
const Color _bSurface = Color(0xFFF3F4F8);
const Color _bRedTint = Color(0xFFFDEEF0);
const Color _bRedBorder = Color(0xFFF2B8C0);
const Color _bGreen = Color(0xFF16A34A);

// Every icon on these pages uses this one neutral colour.
const Color _bIcon = EhbrColors.ink;

Widget _page(BuildContext context, String title, List<Widget> children) => Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        iconTheme: const IconThemeData(color: EhbrColors.ink),
        title: Text(title, style: manrope(18, FontWeight.w800, EhbrColors.ink)),
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 32), children: children),
    );

/// White bordered card with an optional neutral icon tile and trailing widget.
Widget _card(String title, String body, {IconData? icon, Widget? trailing}) => Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _bBorder),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (icon != null) ...[
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: _bSurface, borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 20, color: _bIcon),
          ),
          const SizedBox(width: 12),
        ],
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: manrope(14, FontWeight.w700, EhbrColors.ink)),
            const SizedBox(height: 4),
            Text(body, style: manrope(12, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.45)),
          ]),
        ),
        if (trailing != null) ...[
          const SizedBox(width: 8),
          trailing,
        ],
      ]),
    );

Widget _outlineBtn(String label, VoidCallback onTap) => SizedBox(
      width: double.infinity,
      height: 48,
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          foregroundColor: EhbrColors.ink,
          side: const BorderSide(color: _bBorder),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        onPressed: onTap,
        child: Text(label, style: manrope(14, FontWeight.w700, EhbrColors.ink)),
      ),
    );

/// Figma: Profile – Notifications.
class NotificationsInfoScreen extends StatelessWidget {
  const NotificationsInfoScreen({super.key});
  @override
  Widget build(BuildContext context) => _page(context, 'Notifications', [
        _card('Emergency alerts', 'Urgent warnings for your zone. Always on for your safety.',
            icon: Icons.warning_amber_rounded, trailing: const Icon(Icons.check_circle_rounded, color: _bIcon)),
        _card('Report updates', 'You will get a notification when staff verify, dispatch or resolve your report.',
            icon: Icons.description_outlined, trailing: const Icon(Icons.check_circle_rounded, color: _bIcon)),
        _card('Barangay announcements', 'Hazard advisories, notices and events from Barangay Rizal.',
            icon: Icons.campaign_outlined, trailing: const Icon(Icons.check_circle_rounded, color: _bIcon)),
        const SizedBox(height: 6),
        Text('Permissions are managed in your phone’s settings. If you are not receiving alerts, make sure notifications are allowed for this app.',
            style: manrope(12, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.45)),
        const SizedBox(height: 16),
        _outlineBtn('Open Phone Settings', () => Geolocator.openAppSettings()),
      ]);
}

/// Figma: Profile – Privacy & Security.
class PrivacyScreen extends StatefulWidget {
  const PrivacyScreen({super.key});
  @override
  State<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends State<PrivacyScreen> {
  String _loc = 'Checking…';

  @override
  void initState() {
    super.initState();
    Geolocator.checkPermission().then((p) {
      if (!mounted) return;
      setState(() => _loc = (p == LocationPermission.always || p == LocationPermission.whileInUse) ? 'Allowed' : 'Not allowed');
    }).catchError((_) {
      if (mounted) setState(() => _loc = 'Unknown');
    });
  }

  /// Neutral pill; only the small dot carries the status colour.
  Widget _locPill() {
    final dot = switch (_loc) {
      'Allowed' => const Color(0xFF15803D),
      'Not allowed' => EhbrColors.brand,
      _ => EhbrColors.muted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _bBorder),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(_loc, style: manrope(10, FontWeight.w700, EhbrColors.ink)),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) => _page(context, 'Privacy & Security', [
        _card('Location permission', 'Used to show nearby reports and to attach your position to reports and SOS.',
            icon: Icons.location_on_outlined, trailing: _locPill()),
        _card('How your data is used', 'Your name and number are visible only to barangay staff. Public reports show your location and type, never your name. You choose what to share each time.',
            icon: Icons.shield_outlined),
        _card('Account security', 'Update your login password. You will be signed in on this phone only.',
            icon: Icons.lock_outline_rounded,
            trailing: TextButton(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ChangePasswordScreen())),
              child: Text('Change', style: manrope(13, FontWeight.w800, EhbrColors.brand)),
            )),
        const SizedBox(height: 8),
        _outlineBtn('Open Phone Settings', () => Geolocator.openAppSettings()),
      ]);
}

/// Dark pill snackbar with a green check, used for "saved" confirmations.
/// Takes the messenger so it still works after the screen has been popped.
void _showSuccessSnack(ScaffoldMessengerState messenger, String message) {
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        elevation: 0,
        backgroundColor: EhbrColors.ink,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        duration: const Duration(seconds: 3),
        content: Row(
          children: [
            Container(
              width: 24,
              height: 24,
              decoration: const BoxDecoration(color: _bGreen, shape: BoxShape.circle),
              child: const Icon(Icons.check_rounded, size: 16, color: Colors.white),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(message, style: manrope(13, FontWeight.w600, Colors.white)),
            ),
          ],
        ),
      ),
    );
}

/// Label above, lock icon, and a show/hide eye (crossed-out eye = hidden).
/// Same look as the login and forgot-password screens.
class _PasswordField extends StatefulWidget {
  const _PasswordField({
    required this.label,
    required this.hint,
    required this.controller,
    required this.autovalidate,
    this.validator,
    this.onChanged,
    this.onSubmitted,
    this.action = TextInputAction.next,
  });

  final String label;
  final String hint;
  final TextEditingController controller;
  final bool autovalidate;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onSubmitted;
  final TextInputAction action;

  @override
  State<_PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<_PasswordField> {
  bool _hide = true;

  @override
  Widget build(BuildContext context) {
    OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: color, width: width),
        );

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(widget.label, style: manrope(12, FontWeight.w700, EhbrColors.ink)),
          ),
          TextFormField(
            controller: widget.controller,
            obscureText: _hide,
            textInputAction: widget.action,
            onChanged: widget.onChanged,
            onFieldSubmitted: widget.onSubmitted == null ? null : (_) => widget.onSubmitted!(),
            validator: widget.validator,
            autovalidateMode:
                widget.autovalidate ? AutovalidateMode.always : AutovalidateMode.disabled,
            style: manrope(13, FontWeight.w500, EhbrColors.ink),
            cursorColor: EhbrColors.brand,
            decoration: InputDecoration(
              hintText: widget.hint,
              hintStyle: manrope(13, FontWeight.w400, EhbrColors.muted),
              prefixIcon: const Icon(Icons.lock_outline_rounded, color: EhbrColors.muted, size: 20),
              suffixIcon: IconButton(
                tooltip: _hide ? 'Show password' : 'Hide password',
                onPressed: () => setState(() => _hide = !_hide),
                icon: Icon(
                  _hide ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                  color: EhbrColors.muted,
                  size: 20,
                ),
              ),
              filled: true,
              fillColor: Colors.white,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              errorStyle: manrope(11, FontWeight.w600, EhbrColors.brand),
              border: border(_bBorder),
              enabledBorder: border(_bBorder),
              focusedBorder: border(EhbrColors.brand, 1.4),
              errorBorder: border(EhbrColors.brand),
              focusedErrorBorder: border(EhbrColors.brand, 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

/// Uses the server's POST /api/me/password.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _cur = TextEditingController(), _new = TextEditingController(), _again = TextEditingController();
  bool _busy = false;

  /// After the first tap on Save, fields validate live so the user sees what to fix.
  bool _triedSubmit = false;
  String? _error;

  @override
  void dispose() {
    _cur.dispose();
    _new.dispose();
    _again.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() {
      _triedSubmit = true;
      _error = null;
    });
    if (!_form.currentState!.validate()) return;

    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await Api.changePassword(_cur.text, _new.text);
      if (!mounted) return;
      navigator.pop();
      _showSuccessSnack(messenger, 'Password updated');
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return _page(context, 'Change Password', [
      Form(
        key: _form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Choose a strong password you have not used before.',
                style: manrope(13, FontWeight.w400, EhbrColors.muted)),
            const SizedBox(height: 18),
            _PasswordField(
              label: 'Current password',
              hint: 'Enter your current password',
              controller: _cur,
              autovalidate: _triedSubmit,
              validator: (v) => (v == null || v.isEmpty) ? 'Enter your current password' : null,
            ),
            _PasswordField(
              label: 'New password',
              hint: 'Enter a new password',
              controller: _new,
              autovalidate: _triedSubmit,
              onChanged: (_) => setState(() {}),
              validator: (v) =>
                  PasswordRules.ok(v ?? '') ? null : 'Password does not meet the rules below',
            ),
            _PasswordField(
              label: 'Confirm new password',
              hint: 'Re-enter the new password',
              controller: _again,
              autovalidate: _triedSubmit,
              action: TextInputAction.done,
              onSubmitted: _save,
              validator: (v) {
                if (v == null || v.isEmpty) return 'Re-enter your new password';
                if (v != _new.text) return 'Passwords do not match';
                return null;
              },
            ),
            const SizedBox(height: 2),
            PasswordRules(password: _new.text),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: manrope(12, FontWeight.w600, EhbrColors.brand)),
            ],
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: EhbrColors.brand,
                  disabledBackgroundColor: EhbrColors.brand.withValues(alpha: .85),
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: _busy ? null : _save,
                child: _busy
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                      )
                    : Text('Save Changes', style: manrope(15, FontWeight.w700, Colors.white)),
              ),
            ),
          ],
        ),
      ),
    ]);
  }
}

/// Figma: Profile – Help & Support.
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cfg = Session.config;
    const faqs = [
      ('How do I report an incident?', 'Tap Report Incident on Home, pick the type, describe what happened and confirm the location. Staff review it and you get a notification when it changes.'),
      ('What happens when I press SOS?', 'The SOS sheet opens. Hold the button for 3 seconds, and your phone dials the emergency line while your location is prepared for responders. You can cancel during the countdown.'),
      ('Why was my report queued?', 'You had no internet. The report is saved on your phone and sends by itself when you are back online. Nothing is lost.'),
      ('I can’t log in', 'Use Forgot password on the login screen. If you have no recovery email, ask the barangay office for a reset code.'),
    ];
    return _page(context, 'Help & Support', [
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: _bRedTint, borderRadius: BorderRadius.circular(12), border: Border.all(color: _bRedBorder)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.warning_amber_rounded, size: 20, color: _bIcon),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('In an emergency', style: manrope(14, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 4),
              Text('Call ${cfg.sosNumber} or hold the SOS button on Home. Do not wait for a report to be reviewed.',
                  style: manrope(12, FontWeight.w400, EhbrColors.ink).copyWith(height: 1.45)),
            ]),
          ),
        ]),
      ),
      const SizedBox(height: 24),
      Text('Frequently asked questions', style: manrope(16, FontWeight.w800, EhbrColors.ink)),
      const SizedBox(height: 12),
      for (final f in faqs)
        Container(
          margin: const EdgeInsets.only(bottom: 10),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: _bBorder),
            borderRadius: BorderRadius.circular(12),
          ),
          clipBehavior: Clip.antiAlias,
          child: Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: const EdgeInsets.symmetric(horizontal: 14),
              shape: const Border(),
              collapsedShape: const Border(),
              iconColor: _bIcon,
              collapsedIconColor: EhbrColors.muted,
              title: Text(f.$1, style: manrope(13, FontWeight.w700, EhbrColors.ink)),
              childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              expandedAlignment: Alignment.centerLeft,
              children: [Text(f.$2, style: manrope(12, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.45))],
            ),
          ),
        ),
      if (cfg.hotline.isNotEmpty) ...[
        const SizedBox(height: 12),
        _outlineBtn('Call Barangay Hall · ${cfg.hotline}', () => confirmCall(context, 'Barangay Hall', cfg.hotline)),
      ],
    ]);
  }
}