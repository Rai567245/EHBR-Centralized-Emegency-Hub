import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/zone_picker_field.dart';

// Same neutral surface colours as the other restyled screens.
const Color _aBorder = Color(0xFFE2E4EA);
const Color _aSurface = Color(0xFFF3F4F8);
const Color _aRed = Color(0xFFC7193D);
const Color _aGreen = Color(0xFF16A34A);

/// Full-screen "Account details": every detail of the resident's account with its label,
/// editable in one place. Saved changes go to the barangay's records, so staff see them
/// in the admin console (Database → Residents).
///
/// Needs `Api.updateProfile` (POST /api/me/profile) for name, address, zone and contact.
/// The email uses the existing `Api.setEmail`.
class AccountDetailsScreen extends StatefulWidget {
  const AccountDetailsScreen({super.key});

  @override
  State<AccountDetailsScreen> createState() => _AccountDetailsScreenState();
}

class _AccountDetailsScreenState extends State<AccountDetailsScreen> {
  final _form = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _contact = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();
  final _zoneText = TextEditingController();
  final _password = TextEditingController();

  late AppUser _orig;
  String? _zone;
  bool _hidePw = true;
  bool _busy = false;
  String? _error;

  List<String> get _zones => Session.config.zones;
  String get _zoneValue => _zones.isEmpty ? _zoneText.text.trim() : (_zone ?? '');

  static String _digits(String v) => v.replaceAll(RegExp(r'[\s\-()]'), '');

  @override
  void initState() {
    super.initState();
    _orig = Session.user ??
        AppUser(id: '', role: 'resident', firstName: '', lastName: '', contact: '', address: '', zone: '');
    _fill(_orig);
  }

  void _fill(AppUser u) {
    _first.text = u.firstName;
    _last.text = u.lastName;
    _contact.text = u.contact;
    _email.text = u.email;
    _address.text = u.address;
    _zoneText.text = u.zone;
    _zone = u.zone.isEmpty ? null : u.zone;
  }

  @override
  void dispose() {
    for (final c in [_first, _last, _contact, _email, _address, _zoneText, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  // ---- what changed

  bool get _contactChanged => _digits(_contact.text.trim()) != _orig.contact;
  bool get _emailChanged => _email.text.trim().toLowerCase() != _orig.email.toLowerCase();
  bool get _profileChanged =>
      _first.text.trim() != _orig.firstName ||
      _last.text.trim() != _orig.lastName ||
      _address.text.trim() != _orig.address ||
      _zoneValue != _orig.zone ||
      _contactChanged;
  bool get _needsPassword => _contactChanged || _emailChanged;
  bool get _canSave => (_profileChanged || _emailChanged) && !_busy;

  // ---- save

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_needsPassword && _password.text.isEmpty) {
      setState(() => _error = 'Enter your current password to change your contact number or email.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    var savedProfile = false;
    try {
      if (_profileChanged) {
        final u = await Api.updateProfile({
          'firstName': _first.text.trim(),
          'lastName': _last.text.trim(),
          'address': _address.text.trim(),
          'zone': _zoneValue,
          'contact': _digits(_contact.text.trim()),
          if (_contactChanged) 'password': _password.text,
        });
        await Session.updateUser(u);
        _orig = u;
        savedProfile = true;
      }
      if (_emailChanged) {
        final u = await Api.setEmail(_email.text.trim(), _password.text);
        await Session.updateUser(u);
        _orig = u;
      }
      if (!mounted) return;
      _password.clear();
      _fill(_orig);
      FocusScope.of(context).unfocus();
      _showSuccess('Account details updated');
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _error = savedProfile
            ? 'Your details were saved, but the email could not be changed: ${e.message}'
            : e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---- feedback + leave guard

  bool get _isDirty => _profileChanged || _emailChanged;

  void _showSuccess(String message) {
    ScaffoldMessenger.of(context)
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
                decoration: const BoxDecoration(color: _aGreen, shape: BoxShape.circle),
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

  Future<void> _onBackAttempt() async {
    if (_busy) return; // don't leave mid-save
    FocusScope.of(context).unfocus();
    final discard = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _DiscardChangesSheet(),
    );
    if (discard == true && mounted) Navigator.of(context).pop();
  }

  // ---- UI helpers

  InputDecoration _deco({required String hint, IconData? icon, Widget? suffix}) {
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
      errorStyle: manrope(11, FontWeight.w600, _aRed),
      border: border(_aBorder),
      enabledBorder: border(_aBorder),
      focusedBorder: border(_aRed, 1.4),
      errorBorder: border(_aRed),
      focusedErrorBorder: border(_aRed, 1.4),
    );
  }

  TextStyle get _input => manrope(13, FontWeight.w500, EhbrColors.ink);

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(top: 22, bottom: 12),
        child: Text(title, style: manrope(14, FontWeight.w800, EhbrColors.ink)),
      );

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text, style: manrope(12, FontWeight.w700, EhbrColors.ink)),
      );

  Widget _hint(String text) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(text, style: manrope(11, FontWeight.w400, EhbrColors.muted)),
      );

  String? _required(String? v, String what) => (v == null || v.trim().isEmpty) ? 'Enter $what' : null;

  @override
  Widget build(BuildContext context) {
    final zoneOptions = [
      ..._zones,
      if (_zone != null && _zone!.isNotEmpty && !_zones.contains(_zone)) _zone!,
    ];

    final scaffold = Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        iconTheme: const IconThemeData(color: EhbrColors.ink),
        title: Text('Account details', style: manrope(18, FontWeight.w800, EhbrColors.ink)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
          child: Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Who this account is.
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: _aBorder),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 52,
                        height: 52,
                        decoration: const BoxDecoration(color: EhbrColors.ink, shape: BoxShape.circle),
                        child: const Icon(Icons.account_circle_outlined, color: Colors.white, size: 26),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _orig.fullName.isEmpty ? 'Resident' : _orig.fullName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: manrope(16, FontWeight.w800, EhbrColors.ink),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _orig.zone.isEmpty ? 'Resident' : 'Resident · ${_orig.zone}',
                              style: manrope(12, FontWeight.w500, EhbrColors.muted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),

                _section('Personal information'),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _label('First name'),
                          TextFormField(
                            controller: _first,
                            style: _input,
                            cursorColor: _aRed,
                            textCapitalization: TextCapitalization.words,
                            decoration: _deco(hint: 'First name'),
                            onChanged: (_) => setState(() {}),
                            validator: (v) => _required(v, 'your first name'),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _label('Last name'),
                          TextFormField(
                            controller: _last,
                            style: _input,
                            cursorColor: _aRed,
                            textCapitalization: TextCapitalization.words,
                            decoration: _deco(hint: 'Last name'),
                            onChanged: (_) => setState(() {}),
                            validator: (v) => _required(v, 'your last name'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                _section('Contact'),
                _label('Contact number'),
                TextFormField(
                  controller: _contact,
                  keyboardType: TextInputType.phone,
                  style: _input,
                  cursorColor: _aRed,
                  decoration: _deco(hint: 'Contact number', icon: Icons.phone_outlined),
                  onChanged: (_) => setState(() {}),
                  validator: (v) => RegExp(r'^\+?\d{7,15}$').hasMatch(_digits((v ?? '').trim()))
                      ? null
                      : 'Enter a valid contact number',
                ),
                _hint('This is the number you log in with.'),
                const SizedBox(height: 16),
                _label('Email (optional)'),
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  style: _input,
                  cursorColor: _aRed,
                  decoration: _deco(hint: 'name@example.com', icon: Icons.email_outlined),
                  onChanged: (_) => setState(() {}),
                  validator: (v) {
                    final t = (v ?? '').trim();
                    return t.isEmpty || RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(t)
                        ? null
                        : 'Enter a valid email, or leave it empty';
                  },
                ),
                _hint('Used only to send a code if you forget your password.'),

                _section('Address'),
                _label('Address'),
                TextFormField(
                  controller: _address,
                  style: _input,
                  cursorColor: _aRed,
                  decoration: _deco(hint: 'Your address', icon: Icons.location_on_outlined),
                  onChanged: (_) => setState(() {}),
                  validator: (v) => _required(v, 'your address'),
                ),
                const SizedBox(height: 16),
                _label('Zone / Purok'),
                if (_zones.isEmpty)
                  TextFormField(
                    controller: _zoneText,
                    style: _input,
                    cursorColor: _aRed,
                    decoration: _deco(hint: 'Your zone / purok', icon: Icons.map_outlined),
                    onChanged: (_) => setState(() {}),
                  )
                else
                  SelectSheetField(
                    value: _zone,
                    options: zoneOptions,
                    hint: 'Select zone',
                    sheetTitle: 'Select zone / purok',
                    icon: Icons.map_outlined,
                    onChanged: (v) => setState(() => _zone = v),
                    validator: (v) => v == null ? 'Select your zone' : null,
                  ),

                // Only asked for when the contact number or email changes.
                if (_needsPassword) ...[
                  const SizedBox(height: 22),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: _aSurface,
                      border: Border.all(color: _aBorder),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.lock_outline_rounded, size: 18, color: EhbrColors.ink),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text('Confirm your password',
                                  style: manrope(13, FontWeight.w800, EhbrColors.ink)),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text('Needed to change your contact number or email.',
                            style: manrope(11, FontWeight.w400, EhbrColors.muted)),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _password,
                          obscureText: _hidePw,
                          style: _input,
                          cursorColor: _aRed,
                          decoration: _deco(
                            hint: 'Current password',
                            icon: Icons.lock_outline_rounded,
                            suffix: IconButton(
                              tooltip: _hidePw ? 'Show password' : 'Hide password',
                              onPressed: () => setState(() => _hidePw = !_hidePw),
                              icon: Icon(
                                _hidePw ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                                color: EhbrColors.muted,
                                size: 20,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                if (_error != null) ...[
                  const SizedBox(height: 14),
                  Text(_error!, style: manrope(12, FontWeight.w600, _aRed)),
                ],

                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: FilledButton(
                    onPressed: _canSave ? _save : null,
                    style: FilledButton.styleFrom(
                      backgroundColor: _aRed,
                      disabledBackgroundColor: _aRed.withValues(alpha: _busy ? .85 : .3),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: _busy
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                          )
                        : Text('Save changes', style: manrope(15, FontWeight.w700, Colors.white)),
                  ),
                ),
                const SizedBox(height: 12),
                Center(
                  child: Text(
                    'Changes are saved to your barangay account and are visible to barangay staff.',
                    textAlign: TextAlign.center,
                    style: manrope(11, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.4),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    // Swiping back / tapping the arrow with unsaved edits asks first.
    return PopScope(
      canPop: !_isDirty || _busy,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _onBackAttempt();
      },
      child: scaffold,
    );
  }
}

/// "Discard changes?" confirmation. Pops `true` to leave, `false`/null to keep editing.
class _DiscardChangesSheet extends StatelessWidget {
  const _DiscardChangesSheet();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: _aBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 22),
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: _aRed.withValues(alpha: .1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.edit_off_outlined, color: _aRed, size: 24),
              ),
              const SizedBox(height: 14),
              Text('Discard changes?', style: manrope(17, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 6),
              Text(
                'You have unsaved changes to your account details. '
                'If you leave now, they will be lost.',
                textAlign: TextAlign.center,
                style: manrope(12.5, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.45),
              ),
              const SizedBox(height: 22),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton(
                  onPressed: () => Navigator.pop(context, false),
                  style: FilledButton.styleFrom(
                    backgroundColor: _aRed,
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text('Keep editing', style: manrope(15, FontWeight.w700, Colors.white)),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context, true),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _aRed,
                    side: const BorderSide(color: _aBorder),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text('Discard changes', style: manrope(14, FontWeight.w700, _aRed)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}