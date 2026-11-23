import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uuid/uuid.dart';

import '../location.dart';
import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';

// Same neutral surface colours as the other restyled screens.
const Color _sBorder = Color(0xFFE2E4EA);
const Color _sSurface = Color(0xFFF3F4F8);
const Color _sRedDark = Color(0xFF9E1230);

/// Opens the SOS bottom sheet (Figma: RES-SOS). Confirm → find location →
/// 4-second cancel window → alert responders + open the dialer.
/// Handles "no location", "dialer didn't open" and "can't place a call".
Future<void> showSosSheet(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => const _SosSheet(),
    );

enum _Stage { confirm, locating, connecting, noLocation, failed, noSignal, sent }

class _SosSheet extends StatefulWidget {
  const _SosSheet();
  @override
  State<_SosSheet> createState() => _SosSheetState();
}

class _SosSheetState extends State<_SosSheet> with SingleTickerProviderStateMixin {
  _Stage _stage = _Stage.confirm;
  ({double lat, double lng})? _where;
  int _left = 4;
  int _failures = 0;
  Timer? _timer;
  bool _locating = false;

  /// One id for this sheet, so a retry can never file a second SOS (the server ignores repeats).
  final String _clientId = const Uuid().v4();

  /// Shown under the steps when the alert could not be sent (rate limit / no connection).
  String? _alertNote;

  /// The last SOS this phone sent (kept while the app is open). Within 5 minutes
  /// the sheet offers "Call Again" instead of sending a second alert.
  static DateTime? _lastAt;
  static String? _lastId;
  static const _cooldown = Duration(minutes: 5);
  static bool get _hasRecent => _lastAt != null && DateTime.now().difference(_lastAt!) < _cooldown;

  late final AnimationController _hold =
      AnimationController(vsync: this, duration: const Duration(seconds: 3))
        ..addStatusListener((s) {
          if (s == AnimationStatus.completed) {
            HapticFeedback.heavyImpact();
            _start();
          }
        });

  String get _number => Session.config.sosNumber;
  String get _hotline => Session.config.hotline;

  @override
  void initState() {
    super.initState();
    if (_hasRecent) _stage = _Stage.sent;
  }

  @override
  void dispose() {
    _timer?.cancel();
    _hold.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    if (_locating) return;
    _locating = true;
    setState(() => _stage = _Stage.locating);
    try {
      _where = await currentLocation().timeout(const Duration(seconds: 8));
    } catch (_) {
      _where = null;
    }
    _locating = false;
    if (!mounted) return;
    if (_where == null) {
      setState(() => _stage = _Stage.noLocation);
    } else {
      _connect();
    }
  }

  void _connect() {
    _timer?.cancel();
    setState(() {
      _stage = _Stage.connecting;
      _left = 4;
    });

    // Submit the SOS in the background so the emergency call countdown
    // is not delayed if the server is slow or unavailable.
    if (_where != null) {
      unawaited(_submitSos());
    }

    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      if (_left <= 1) {
        t.cancel();
        _dial(_number);
      } else {
        setState(() => _left--);
      }
    });
  }

  Future<void> _submitSos() async {
    final location = _where;
    if (location == null) return;

    try {
      final r = await Api.submitSos({
        'lat': location.lat,
        'lng': location.lng,
        'clientId': _clientId,
      });
      _lastAt = DateTime.now();
      _lastId = r.id;
      if (mounted && _alertNote != null) setState(() => _alertNote = null);
    } catch (e) {
      debugPrint('Failed to submit SOS: $e');
      // Never interrupt the call, but be honest that the alert did not go out.
      final limited = e is ApiException && e.isRateLimited;
      if (mounted) {
        setState(() => _alertNote = limited
            ? 'Too many SOS alerts were sent. Please call the emergency line now.'
            : 'We couldn’t send the alert (no connection). Please call the emergency line now.');
      }
    }
  }

  Future<void> _dial(String number) async {
    bool ok = false;
    try {
      ok = await launchUrl(Uri(scheme: 'tel', path: number));
    } catch (_) {}
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
    } else {
      _failures++;
      setState(() => _stage = _failures >= 2 ? _Stage.noSignal : _Stage.failed);
    }
  }

  Future<void> _text() async {
    final w = _where;
    final body = 'EMERGENCY – I need help.${w == null ? '' : ' My location: https://maps.google.com/?q=${w.lat},${w.lng}'}';
    final to = _hotline.isNotEmpty ? _hotline : _number;
    final ok = await launchUrl(Uri(scheme: 'sms', path: to, queryParameters: {'body': body}));
    if (ok && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final (title, text, steps) = switch (_stage) {
      _Stage.confirm => (
          'Send SOS alert and call?',
          'This alerts Barangay Rizal responders with your live location, then opens your phone’s dialer with the emergency number ready.',
          _steps(0)
        ),
      _Stage.locating => ('Finding you…', 'Getting your location so responders know where you are.', _steps(0)),
      _Stage.connecting => (
          'Sending your alert…',
          'Alerting responders and opening your dialer in a few seconds. Stay where you are if it is safe.',
          _steps(1)
        ),
      _Stage.noLocation => (
          'Can’t find your location',
          'Responders can’t be alerted without your location. You can still open the dialer and tell them exactly where you are.',
          _steps(2)
        ),
      _Stage.failed => ('Couldn’t open the dialer', 'Try again, or use another number.', _steps(4)),
      _Stage.noSignal => (
          'Can’t place a call',
          'We still couldn’t open the dialer. You can send your SOS by text message instead.',
          _steps(3)
        ),
      _Stage.sent => (
          'SOS already sent',
          'You sent an SOS at ${TimeOfDay.fromDateTime(_lastAt ?? DateTime.now()).format(context)}${_lastId == null ? '' : ' ($_lastId)'}. Responders have been alerted, so no second alert is sent.',
          _steps(5)
        ),
    };
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag handle.
            Center(
              child: Container(width: 38, height: 4, decoration: BoxDecoration(color: const Color(0xFFD5D8DE), borderRadius: BorderRadius.circular(4))),
            ),
            const SizedBox(height: 22),

            // SOS badge: a soft ring around the red circle.
            Center(
              child: Container(
                width: 76,
                height: 76,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: EhbrColors.brand.withValues(alpha: .1), shape: BoxShape.circle),
                child: Container(
                  width: 56,
                  height: 56,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(color: EhbrColors.brand, shape: BoxShape.circle),
                  child: Text('SOS', style: manrope(16, FontWeight.w800, Colors.white)),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Title and explanation, centred as one block.
            Text(title, textAlign: TextAlign.center, style: manrope(20, FontWeight.w800, EhbrColors.ink)),
            const SizedBox(height: 8),
            Text(text, textAlign: TextAlign.center, style: manrope(13, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.45)),
            const SizedBox(height: 20),

            // What happens, one numbered line each.
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: _sSurface,
                border: Border.all(color: _sBorder),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(children: [
                for (var i = 0; i < steps.length; i++)
                  Padding(
                    padding: EdgeInsets.only(top: i == 0 ? 0 : 12),
                    child: Row(children: [
                      Container(
                        width: 22,
                        height: 22,
                        alignment: Alignment.center,
                        decoration: const BoxDecoration(color: EhbrColors.ink, shape: BoxShape.circle),
                        child: Text('${i + 1}', style: manrope(11, FontWeight.w700, Colors.white)),
                      ),
                      const SizedBox(width: 12),
                      Expanded(child: Text(steps[i], style: manrope(13, FontWeight.w600, EhbrColors.ink))),
                    ]),
                  ),
              ]),
            ),
            if (_alertNote != null) ...[
              const SizedBox(height: 12),
              Text(_alertNote!, textAlign: TextAlign.center, style: manrope(12, FontWeight.w700, EhbrColors.brand)),
            ],
            const SizedBox(height: 20),
            ..._actions(),
          ],
        ),
      ),
    );
  }

  List<String> _steps(int variant) => switch (variant) {
        // Sending the alert and opening the dialer.
        1 => ['Alerting responders with your location', 'Opening your dialer in a few seconds', 'Tap call in the dialer to connect'],
        // No location found.
        2 => ['Your dialer can still open with $_number ready', 'Tell the responder exactly where you are', 'Or retry your location to alert responders'],
        // Dialer failed twice: text message fallback.
        3 => ['You can send your SOS by text message', 'Your location is included if we found it', 'Or try the dialer again'],
        // Dialer didn't open.
        4 => ['Check that this device can place calls', 'Try opening the dialer again', 'Or call another number below'],
        // An SOS was already sent in the last 5 minutes.
        5 => ['Your alert is already with responders', 'Your dialer opens with $_number ready', 'Tap call in the dialer to connect'],
        // Confirm / locating.
        _ => ['Your live location is shared with responders', 'Barangay responders are alerted right away', 'Your dialer opens with $_number ready. Tap call to connect.'],
      };

  Widget _primary(String label, VoidCallback onTap) => SizedBox(
        width: double.infinity,
        height: 54,
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: EhbrColors.brand,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          onPressed: onTap,
          child: Text(label, style: manrope(16, FontWeight.w800, Colors.white)),
        ),
      );

  Widget _outline(String label, VoidCallback onTap) => SizedBox(
        width: double.infinity,
        height: 50,
        child: OutlinedButton(
          style: OutlinedButton.styleFrom(
            foregroundColor: EhbrColors.ink,
            side: const BorderSide(color: _sBorder),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          onPressed: onTap,
          child: Text(label, style: manrope(14, FontWeight.w700, EhbrColors.ink)),
        ),
      );

  List<Widget> _actions() {
    const gap = SizedBox(height: 10);
    final alt = _number == '911' ? null : '911';
    switch (_stage) {
      case _Stage.confirm:
        return [
          if (Session.config.sosHold) ...[
            Listener(
              onPointerDown: (_) => _hold.forward(),
              onPointerUp: (_) => _hold.status == AnimationStatus.completed ? null : _hold.reset(),
              onPointerCancel: (_) => _hold.reset(),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(
                  height: 54,
                  width: double.infinity,
                  child: Stack(children: [
                    Container(color: EhbrColors.brand),
                    AnimatedBuilder(
                      animation: _hold,
                      builder: (_, __) => FractionallySizedBox(
                        alignment: Alignment.centerLeft,
                        widthFactor: _hold.value,
                        child: Container(color: _sRedDark),
                      ),
                    ),
                    Center(child: Text('Hold to Send SOS', style: manrope(16, FontWeight.w800, Colors.white))),
                  ]),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text('Keep holding for 3 seconds. Let go to stop.', textAlign: TextAlign.center, style: manrope(11, FontWeight.w500, EhbrColors.muted)),
          ] else
            _primary('Send SOS Now', _start),
          const SizedBox(height: 12),
          _outline('Cancel · I don’t need help', () => Navigator.of(context).pop()),
        ];
      case _Stage.locating:
        return [
          const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3, color: EhbrColors.brand)),
            ),
          ),
          gap,
          _outline('Cancel', () => Navigator.of(context).pop()),
        ];
      case _Stage.connecting:
        return [
          _outline('Cancel call (${_left}s)', () {
            _timer?.cancel();
            Navigator.of(context).pop();
          }),
        ];
      case _Stage.noLocation:
        return [_primary('Call Anyway', () => _connect()), gap, _outline('Retry Location', _start)];
      case _Stage.failed:
        return [
          _primary('Retry Call', _connect),
          gap,
          if (alt != null) ...[_outline('Call $alt Instead', () => _dial(alt)), gap],
          if (_hotline.isNotEmpty)
            TextButton(
              onPressed: () => _dial(_hotline),
              child: Text('Call Barangay Hall · $_hotline', style: manrope(13, FontWeight.w700, EhbrColors.brand)),
            ),
        ];
      case _Stage.noSignal:
        return [_primary('Send SOS by Text', _text), gap, _outline('Try Calling Again', _connect)];
      case _Stage.sent:
        return [_primary('Call Again', () => _dial(_number)), gap, _outline('Close', () => Navigator.of(context).pop())];
    }
  }
}
