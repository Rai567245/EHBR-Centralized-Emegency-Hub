import 'package:flutter/material.dart';

import 'package:shared_preferences/shared_preferences.dart';

import '../phone.dart';
import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/auth_widgets.dart';

const Color _cBorder = Color(0xFFE2E4EA);
const Color _cSurface = Color(0xFFF3F4F8);

/// Category -> (description, icon). Keep the keys in sync with CATS in the admin console (pages/settings.js)
/// and CONTACT_CATEGORIES in server.js.
const Map<String, (String, IconData)> _offlineCats = {
  'local': ('Local emergency contact', Icons.local_phone_outlined),
  'police': ('Police', Icons.local_police_outlined),
  'fire': ('Fire protection', Icons.local_fire_department_outlined),
  'medical': ('Medical / ambulance', Icons.medical_services_outlined),
  'barangay': ('Barangay office', Icons.account_balance_outlined),
  'disaster': ('Disaster response', Icons.warning_amber_rounded),
  'utility': ('Utility / disaster desk', Icons.build_circle_outlined),
  'other': ('Emergency contact', Icons.phone_outlined),
};

typedef _Entry = (String, String, String, IconData);

/// After the national hotline and any starred contacts, the other contacts are listed in this order.
const List<String> _offlinePriority = ['police', 'fire', 'medical', 'barangay', 'disaster', 'local', 'utility', 'other'];

/// Shown at app start when the server can't be reached (no internet / data).
/// Lets the person retry and call emergency numbers without any connection.
/// Numbers come from the copy of the config saved on the phone; if there is
/// none yet (first launch ever), it falls back to the national hotline.
class OfflineScreen extends StatefulWidget {
  const OfflineScreen({super.key, required this.onReconnected});

  /// Called once the server answers again (the splash restarts its normal boot).
  final VoidCallback onReconnected;

  @override
  State<OfflineScreen> createState() => _OfflineScreenState();
}

class _OfflineScreenState extends State<OfflineScreen> {
  bool _checking = false;

  // Same key the Contacts tab saves its stars under.
  static const _favKey = 'favorite_contacts';
  // Contacts shown under the national hotline until "Show all contacts" is tapped.
  static const _initialCount = 4;
  Set<String> _favs = {};
  bool _showAll = false;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      if (mounted) setState(() => _favs = (p.getStringList(_favKey) ?? <String>[]).toSet());
    }).catchError((_) {});
  }

  Future<void> _retry() async {
    if (_checking) return;
    setState(() => _checking = true);
    try {
      await Api.configJson(); // public endpoint, no login needed
      if (!mounted) return;
      widget.onReconnected();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _checking = false);
      final msg = e.isOffline
          ? 'Still no connection. Please try again.'
          : 'The server is busy right now. Please try again in a moment.';
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          behavior: SnackBarBehavior.floating,
          backgroundColor: EhbrColors.ink,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          content: Row(
            children: [
              const Icon(Icons.wifi_off_rounded, color: Colors.white, size: 20),
              const SizedBox(width: 12),
              Expanded(child: Text(msg, style: manrope(13, FontWeight.w600, Colors.white))),
            ],
          ),
          action: SnackBarAction(
            label: 'Dismiss',
            textColor: Colors.white,
            onPressed: () {},
          ),
        ));
    }
  }

  /// National hotline first, then starred contacts, then the rest by priority (police, fire, medical...).
  List<_Entry> _entries() {
    const _Entry national = ('National Emergency Hotline', '911', 'Same number the SOS button dials', Icons.notifications_none_rounded);
    _Entry? top;
    final pool = <(_Entry, int)>[]; // (entry, priority rank)
    try {
      final cfg = Session.config;
      if (cfg.sosNumber.isNotEmpty) {
        top = ('National Emergency Hotline', cfg.sosNumber, 'Same number the SOS button dials', Icons.notifications_none_rounded);
      }
      if (cfg.hotline.isNotEmpty) {
        pool.add((('Barangay hotline', cfg.hotline, 'Barangay office', Icons.account_balance_outlined), _offlinePriority.indexOf('barangay')));
      }
      for (final c in cfg.contacts) {
        final k = _offlineCats.containsKey(c.category) ? c.category : 'other'; // unknown categories are listed under 'other'
        final m = _offlineCats[k]!;
        pool.add(((c.name, c.number, m.$1, m.$2), _offlinePriority.indexOf(k)));
      }
    } catch (_) {
      // config never loaded on this phone: use the fallback below
    }
    final order = [for (var i = 0; i < pool.length; i++) i];
    order.sort((a, b) {
      final fa = _favs.contains(pool[a].$1.$2), fb = _favs.contains(pool[b].$1.$2);
      if (fa != fb) return fa ? -1 : 1;
      if (!fa && pool[a].$2 != pool[b].$2) return pool[a].$2.compareTo(pool[b].$2);
      return a.compareTo(b); // keeps the admin's order (and makes the sort stable)
    });
    return [top ?? national, for (final i in order) pool[i].$1];
  }

  @override
  Widget build(BuildContext context) {
    final entries = _entries();
    final shown = _showAll ? entries : entries.take(1 + _initialCount).toList();
    final hidden = entries.length - shown.length;
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 32, 16, 32),
          children: [
            const Center(child: EhbrEmblem(size: 72)),
            const SizedBox(height: 24),
            Center(
              child: Container(
                width: 56,
                height: 56,
                decoration: const BoxDecoration(color: _cSurface, shape: BoxShape.circle),
                child: const Icon(Icons.wifi_off_rounded, size: 28, color: EhbrColors.muted),
              ),
            ),
            const SizedBox(height: 14),
            Text('You\u2019re offline',
                textAlign: TextAlign.center, style: manrope(20, FontWeight.w800, EhbrColors.ink)),
            const SizedBox(height: 8),
            Text(
              'We can\u2019t reach the server. Check your internet or mobile data and try again.',
              textAlign: TextAlign.center,
              style: manrope(13, FontWeight.w400, EhbrColors.muted),
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 50,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: EhbrColors.brand, shape: const StadiumBorder()),
                onPressed: _checking ? null : _retry,
                child: _checking
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                      )
                    : Text('Try again', style: manrope(15, FontWeight.w700, Colors.white)),
              ),
            ),
            const SizedBox(height: 28),
            Text('Emergency contacts', style: manrope(16, FontWeight.w800, EhbrColors.ink)),
            const SizedBox(height: 2),
            Text('Saved on this phone, so they may be out of date. Tapping Call opens your phone\u2019s dialer. Calls don\u2019t need mobile data.',
                style: manrope(11, FontWeight.w400, EhbrColors.muted)),
            const SizedBox(height: 12),
            for (final e in shown) _OfflineContactRow(name: e.$1, number: e.$2, subtitle: e.$3, icon: e.$4),
            if (entries.length > 1 + _initialCount)
              SizedBox(
                width: double.infinity,
                height: 46,
                child: OutlinedButton(
                  onPressed: () => setState(() => _showAll = !_showAll),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: EhbrColors.ink,
                    side: const BorderSide(color: _cBorder),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        _showAll ? 'Show fewer contacts' : 'Show all contacts ($hidden more)',
                        style: manrope(13, FontWeight.w700, EhbrColors.ink),
                      ),
                      const SizedBox(width: 6),
                      Icon(_showAll ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded, size: 20),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _OfflineContactRow extends StatelessWidget {
  const _OfflineContactRow({required this.name, required this.number, required this.subtitle, required this.icon});
  final String name, number, subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: _cBorder),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => confirmCall(context, name, number),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: _cSurface, borderRadius: BorderRadius.circular(10)),
                  child: Icon(icon, size: 20, color: EhbrColors.brand),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: manrope(13, FontWeight.w700, EhbrColors.ink)),
                      const SizedBox(height: 2),
                      Text(number,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: manrope(12, FontWeight.w600, EhbrColors.ink)),
                      const SizedBox(height: 2),
                      Text(subtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: manrope(11, FontWeight.w500, EhbrColors.muted)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  width: 64,
                  height: 36,
                  decoration: BoxDecoration(color: EhbrColors.brand, borderRadius: BorderRadius.circular(10)),
                  alignment: Alignment.center,
                  child: Text('CALL', style: manrope(12, FontWeight.w700, Colors.white)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
