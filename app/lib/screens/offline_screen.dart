import 'package:flutter/material.dart';

import '../phone.dart';
import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/auth_widgets.dart';

const Color _cBorder = Color(0xFFE2E4EA);
const Color _cSurface = Color(0xFFF3F4F8);

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

  List<(String, String, String, IconData)> _entries() {
    final out = <(String, String, String, IconData)>[];
    try {
      final cfg = Session.config;
      if (cfg.sosNumber.isNotEmpty) {
        out.add(('National Emergency Hotline', cfg.sosNumber, 'Same number the SOS button dials', Icons.notifications_none_rounded));
      }
      if (cfg.hotline.isNotEmpty) {
        out.add(('Barangay hotline', cfg.hotline, 'Barangay office', Icons.account_balance_outlined));
      }
      for (final c in cfg.contacts.where((c) => c.category == 'local')) {
        out.add((c.name, c.number, 'Local emergency contact', Icons.local_phone_outlined));
      }
      for (final c in cfg.contacts.where((c) => c.category == 'utility')) {
        out.add((c.name, c.number, 'Utility / disaster desk', Icons.build_circle_outlined));
      }
    } catch (_) {
      // config never loaded on this phone: use the fallback below
    }
    if (out.isEmpty) {
      out.add(('National Emergency Hotline', '911', 'Same number the SOS button dials', Icons.notifications_none_rounded));
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final entries = _entries();
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
            Text('Tapping Call opens your phone\u2019s dialer. Calls don\u2019t need mobile data.',
                style: manrope(11, FontWeight.w400, EhbrColors.muted)),
            const SizedBox(height: 12),
            for (final e in entries) _OfflineContactRow(name: e.$1, number: e.$2, subtitle: e.$3, icon: e.$4),
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