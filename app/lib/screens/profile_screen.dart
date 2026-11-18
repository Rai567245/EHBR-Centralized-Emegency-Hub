import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/api.dart';
import '../services/report_queue.dart';
import '../services/session.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets/async_body.dart';
import 'account_details_screen.dart';
import 'login_screen.dart';
import 'profile_pages.dart';
import 'queued_reports_screen.dart';

// Same neutral surface colours as the Home, Map, Contacts and News screens.
const Color _pBorder = Color(0xFFE2E4EA);
const Color _pSurface = Color(0xFFF3F4F8);

// Selected filter chip: red outline with a soft red tint (same as the Map screen).
const Color _pRed = Color(0xFFC7193D);
const Color _pRedTint = Color(0xFFFDEEF0);

// Every icon on this screen uses this one neutral colour.
const Color _pIcon = EhbrColors.ink;

// Shared look for the pop-up dialogs: white (no pink tint from the brand colour) and rounded.
const Color _dlgBg = Colors.white;
const Color _dlgTint = Colors.transparent;
ShapeBorder _dlgShape() =>
    RoundedRectangleBorder(borderRadius: BorderRadius.circular(16));

/// Resident-friendly wording + colour for a report status.
String statusLabel(String s) => switch (s) {
      'NEW' => 'Received',
      'VERIFIED' => 'Verified',
      'DISPATCHED' => 'Responders on the way',
      'RESOLVED' => 'Resolved',
      _ => 'Not accepted',
    };

/// Short wording used in compact places (list pills and filter chips).
String statusShortLabel(String s) => switch (s) {
      'NEW' => 'Received',
      'VERIFIED' => 'Verified',
      'DISPATCHED' => 'Responding',
      'RESOLVED' => 'Resolved',
      _ => 'Not accepted',
    };

Color statusColor(String s) => switch (s) {
      'NEW' => EhbrColors.advisory,
      'VERIFIED' => const Color(0xFF15803D),
      'DISPATCHED' => EhbrColors.brand,
      _ => EhbrColors.muted,
    };

class ProfileTab extends StatefulWidget {
  const ProfileTab(
      {super.key, required this.reloadToken, this.openReportsRequest = 0});
  final int reloadToken;

  /// Increases each time something asks to jump straight to "My Reports".
  final int openReportsRequest;

  @override
  State<ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<ProfileTab> {
  bool _showReports = false;
  bool _offline = false;

  @override
  void didUpdateWidget(covariant ProfileTab old) {
    super.didUpdateWidget(old);
    if (widget.openReportsRequest != old.openReportsRequest) {
      setState(() => _showReports = true);
    }
  }

  Future<List<Report>> _loadReports() async {
    try {
      final r = await Api.myReports();
      _offline = false;
      return r;
    } on ApiException catch (e) {
      if (e.isUnavailable) {
        _offline = true; // show the profile anyway; the counts just can't load
        return <Report>[];
      }
      rethrow;
    }
  }

  /// Asks for confirmation, then logs out and returns to the login screen.
  Future<void> _logout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _LogoutDialog(pending: ReportQueue.pending.length),
    );
    if (ok != true || !mounted) return;

    await Session.signOut();

    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  /// Opens the full-screen Account details page (replaces the old pop-up dialog).
  Future<void> _account() async {
    if (Session.user == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const AccountDetailsScreen()),
    );
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    if (_showReports) {
      return _MyReports(onBack: () => setState(() => _showReports = false));
    }
    final u = Session.user;
    return AsyncBody<List<Report>>(
      load: _loadReports,
      reloadToken: widget.reloadToken,
      builder: (context, reports, refresh) {
        final open = reports
            .where((r) => ['NEW', 'VERIFIED', 'DISPATCHED'].contains(r.status))
            .length;
        final resolved = reports.where((r) => r.status == 'RESOLVED').length;
        final menu = <(IconData, String, bool, VoidCallback)>[
          (
            Icons.description_outlined,
            'My Reports',
            false,
            () => setState(() => _showReports = true)
          ),
          (Icons.badge_outlined, 'Account details', false, _account),
          (
            Icons.notifications_none_rounded,
            'Notifications',
            false,
            () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const NotificationsInfoScreen()))
          ),
          (
            Icons.lock_outline_rounded,
            'Privacy & Security',
            false,
            () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const PrivacyScreen()))
          ),
          (
            Icons.help_outline_rounded,
            'Help & Support',
            false,
            () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const HelpScreen()))
          ),
          (Icons.logout_rounded, 'Log-out', true, _logout),
        ];
        return RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
            children: [
              // Profile summary.
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: _pBorder),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: const BoxDecoration(
                              color: EhbrColors.ink, shape: BoxShape.circle),
                          child: const Icon(Icons.account_circle_outlined,
                              color: Colors.white, size: 28),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(u?.fullName ?? 'Resident',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: manrope(
                                      18, FontWeight.w800, EhbrColors.ink)),
                              const SizedBox(height: 4),
                              Text('Resident',
                                  style: manrope(
                                      13, FontWeight.w500, EhbrColors.muted)),
                              if (u != null && u.zone.isNotEmpty) ...[
                                const SizedBox(height: 2),
                                Text(u.zone,
                                    style: manrope(
                                        12, FontWeight.w500, EhbrColors.muted)),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                            child: _Stat('Reports',
                                _offline ? '–' : '${reports.length}')),
                        const SizedBox(width: 10),
                        Expanded(
                            child: _Stat('Open', _offline ? '–' : '$open')),
                        const SizedBox(width: 10),
                        Expanded(
                            child: _Stat(
                                'Resolved', _offline ? '–' : '$resolved')),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              Text('Account Menu',
                  style: manrope(16, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 12),
              for (var i = 0; i < menu.length; i++) ...[
                _MenuItem(
                    icon: menu[i].$1,
                    label: menu[i].$2,
                    muted: menu[i].$3,
                    onTap: menu[i].$4),
                if (i != menu.length - 1) const SizedBox(height: 10),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// Log-out confirmation: icon, short explanation, and a warning if reports are still waiting to send.
class _LogoutDialog extends StatelessWidget {
  const _LogoutDialog({required this.pending});
  final int pending;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: _dlgBg,
      surfaceTintColor: _dlgTint,
      shape: _dlgShape(),
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 52,
                height: 52,
                decoration: const BoxDecoration(
                    color: _pSurface, shape: BoxShape.circle),
                child:
                    const Icon(Icons.logout_rounded, color: _pIcon, size: 24),
              ),
            ),
            const SizedBox(height: 16),
            Text('Log out?',
                textAlign: TextAlign.center,
                style: manrope(18, FontWeight.w800, EhbrColors.ink)),
            const SizedBox(height: 8),
            Text('You will need to log in again to report or see your reports.',
                textAlign: TextAlign.center,
                style: manrope(13, FontWeight.w400, EhbrColors.muted)
                    .copyWith(height: 1.45)),
            if (pending > 0) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF4D6),
                  border: Border.all(color: const Color(0xFFF2D58A)),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.schedule_send_outlined,
                        size: 18, color: _pIcon),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        '$pending report${pending == 1 ? '' : 's'} still waiting to send. '
                        'They stay on this phone and send after you log in again.',
                        style: manrope(12, FontWeight.w600, EhbrColors.ink)
                            .copyWith(height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 46,
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context, false),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: EhbrColors.ink,
                        side: const BorderSide(color: _pBorder),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                      child: Text('Cancel',
                          style: manrope(14, FontWeight.w700, EhbrColors.ink)),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: SizedBox(
                    height: 46,
                    child: FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      style: FilledButton.styleFrom(
                        backgroundColor: EhbrColors.brand,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                      child: Text('Log out',
                          style: manrope(14, FontWeight.w700, Colors.white)),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value);
  final String label, value;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
            color: _pSurface, borderRadius: BorderRadius.circular(12)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: manrope(11, FontWeight.w500, EhbrColors.muted)),
            const SizedBox(height: 4),
            Text(value, style: manrope(18, FontWeight.w800, EhbrColors.ink)),
          ],
        ),
      );
}

class _MenuItem extends StatelessWidget {
  const _MenuItem(
      {required this.icon,
      required this.label,
      required this.onTap,
      this.muted = false});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final fg = muted ? EhbrColors.muted : EhbrColors.ink;
    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: _pBorder),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                    color: _pSurface, borderRadius: BorderRadius.circular(10)),
                child: Icon(icon,
                    size: 20, color: muted ? EhbrColors.muted : _pIcon),
              ),
              const SizedBox(width: 12),
              Expanded(
                  child: Text(label, style: manrope(14, FontWeight.w700, fg))),
              const Icon(Icons.chevron_right_rounded,
                  size: 20, color: EhbrColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}

class _MyReports extends StatefulWidget {
  const _MyReports({required this.onBack});
  final VoidCallback onBack;

  @override
  State<_MyReports> createState() => _MyReportsState();
}

class _MyReportsState extends State<_MyReports> {
  /// Selected status group. null = all.
  /// Keys: NEW, VERIFIED, DISPATCHED, RESOLVED, OTHER (not accepted).
  String? _filter;

  static const _knownStatuses = {'NEW', 'VERIFIED', 'DISPATCHED', 'RESOLVED'};

  String _group(String status) =>
      _knownStatuses.contains(status) ? status : 'OTHER';

  // ----------------------------------------------------------
  // Filter chip row: snap, tap-to-center glide
  // ----------------------------------------------------------

  final ScrollController _chipScroll = ScrollController();
  final GlobalKey _chipViewportKey = GlobalKey();

  // One key per chip id ('ALL', 'NEW', ...). Chips with no reports are
  // hidden, so keys are created on demand; a hidden chip has no context
  // and is skipped when measuring.
  final Map<String, GlobalKey> _chipKeys = {};

  GlobalKey _keyFor(String id) => _chipKeys.putIfAbsent(id, () => GlobalKey());

  // True only while the user's own finger drove the scroll, so our
  // programmatic glide/snap animations never re-trigger a snap.
  bool _userScrolling = false;

  @override
  void dispose() {
    _chipScroll.dispose();
    super.dispose();
  }

  /// Chip's left edge and width, relative to the chip row's viewport.
  (double left, double width, double viewport)? _chipRect(String id) {
    final chipBox = _chipKeys[id]?.currentContext?.findRenderObject();
    final viewBox = _chipViewportKey.currentContext?.findRenderObject();
    if (chipBox is! RenderBox || viewBox is! RenderBox) return null;
    if (!chipBox.attached || !viewBox.attached) return null;

    final left = chipBox.localToGlobal(Offset.zero, ancestor: viewBox).dx;
    return (left, chipBox.size.width, viewBox.size.width);
  }

  void _animateChipsBy(double delta, Duration duration, Curve curve) {
    if (!_chipScroll.hasClients) return;
    final pos = _chipScroll.position;
    final target = (pos.pixels + delta).clamp(
      pos.minScrollExtent,
      pos.maxScrollExtent,
    );
    if ((target - pos.pixels).abs() < 1) return; // already there
    _chipScroll.animateTo(target, duration: duration, curve: curve);
  }

  /// Tap: glide so the chip sits in the middle of the row.
  void _centerChip(String id) {
    final r = _chipRect(id);
    if (r == null) return;
    final (left, width, viewport) = r;
    _animateChipsBy(
      (left + width / 2) - viewport / 2,
      const Duration(milliseconds: 320),
      Curves.easeOutCubic,
    );
  }

  /// Swipe end: settle the nearest chip's left edge at the row's left edge.
  void _snapToNearestChip() {
    double? best;
    for (final id in _chipKeys.keys) {
      final r = _chipRect(id);
      if (r == null) continue;
      final left = r.$1;
      if (best == null || left.abs() < best.abs()) best = left;
    }
    if (best == null) return;
    _animateChipsBy(
      best,
      const Duration(milliseconds: 220),
      Curves.easeOut,
    );
  }

  bool _onChipScroll(ScrollNotification n) {
    if (n.depth != 0) return false;
    if (n is ScrollStartNotification) {
      _userScrolling = n.dragDetails != null;
    } else if (n is ScrollEndNotification && _userScrolling) {
      _userScrolling = false;
      _snapToNearestChip();
    }
    return false;
  }

  // ----------------------------------------------------------
  // Report details
  // ----------------------------------------------------------

  void _details(BuildContext context, Report r) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        final screenHeight = MediaQuery.of(sheetContext).size.height;

        return Container(
          height: screenHeight * 0.68,
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(20),
            ),
          ),
          child: Column(
            children: [
              // Compact drag handle.
              Padding(
                padding: const EdgeInsets.only(top: 9, bottom: 7),
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFD5D8DE),
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),

              // Scrollable report details.
              Expanded(
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 5, 16, 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Report title and status.
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Expanded(
                            child: Text(
                              r.type,
                              style: manrope(
                                16,
                                FontWeight.w800,
                                EhbrColors.ink,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          // Full wording here, there is room for it.
                          _StatusPill(r.status, short: false),
                        ],
                      ),

                      const SizedBox(height: 3),

                      // Report reference and date.
                      Text(
                        '${r.id} · ${stamp(r.createdAt)}',
                        style: manrope(
                          10,
                          FontWeight.w500,
                          EhbrColors.muted,
                        ),
                      ),

                      const SizedBox(height: 11),

                      // Full report description.
                      Text(
                        r.description,
                        style: manrope(
                          12,
                          FontWeight.w400,
                          EhbrColors.ink,
                        ).copyWith(height: 1.4),
                      ),

                      // Report location.
                      if (r.locationText.isNotEmpty) ...[
                        const SizedBox(height: 9),
                        Text(
                          'Location: ${r.locationText}',
                          style: manrope(
                            11,
                            FontWeight.w600,
                            EhbrColors.ink,
                          ).copyWith(height: 1.35),
                        ),
                      ],

                      const SizedBox(height: 14),

                      const Divider(
                        height: 1,
                        color: _pBorder,
                      ),

                      const SizedBox(height: 11),

                      // Progress heading.
                      Text(
                        'Progress',
                        style: manrope(
                          13,
                          FontWeight.w800,
                          EhbrColors.ink,
                        ),
                      ),

                      const SizedBox(height: 8),

                      // Compact report timeline.
                      for (final t in r.timeline)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 7),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Padding(
                                padding: EdgeInsets.only(top: 5),
                                child: Icon(
                                  Icons.circle,
                                  size: 7,
                                  color: EhbrColors.muted,
                                ),
                              ),
                              const SizedBox(width: 9),
                              Expanded(
                                child: Text(
                                  t.text.replaceAll(
                                    RegExp(r'\s*\(.*\)$'),
                                    '',
                                  ),
                                  style: manrope(
                                    11,
                                    FontWeight.w500,
                                    EhbrColors.ink,
                                  ).copyWith(height: 1.35),
                                ),
                              ),
                              const SizedBox(width: 7),
                              Text(
                                ago(t.at),
                                style: manrope(
                                  9,
                                  FontWeight.w400,
                                  EhbrColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// Status filter chips, same look and motion as the Map screen.
  Widget _filterChips(List<Report> reports) {
    int count(String key) =>
        reports.where((r) => _group(r.status) == key).length;

    final all = <(String, String?, int)>[
      ('ALL', null, reports.length),
      ('Received', 'NEW', count('NEW')),
      ('Verified', 'VERIFIED', count('VERIFIED')),
      ('Responding', 'DISPATCHED', count('DISPATCHED')),
      ('Resolved', 'RESOLVED', count('RESOLVED')),
      ('Not accepted', 'OTHER', count('OTHER')),
    ];

    // Hide statuses you have no reports in, unless it is the selected one.
    final chips = all
        .where((c) => c.$2 == null || c.$3 > 0 || c.$2 == _filter)
        .toList();

    return SizedBox(
      key: _chipViewportKey,
      width: double.infinity,
      child: NotificationListener<ScrollNotification>(
        onNotification: _onChipScroll,
        child: ScrollConfiguration(
          behavior: const MaterialScrollBehavior().copyWith(
            dragDevices: {
              PointerDeviceKind.touch,
              PointerDeviceKind.mouse,
              PointerDeviceKind.trackpad,
            },
          ),
          child: SingleChildScrollView(
            controller: _chipScroll,
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(
              parent: AlwaysScrollableScrollPhysics(),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final c in chips) ...[
                  _ReportFilterChip(
                    key: _keyFor(c.$2 ?? 'ALL'),
                    label: c.$1,
                    count: c.$3,
                    selected: _filter == c.$2,
                    onTap: () {
                      setState(() => _filter = c.$2);
                      _centerChip(c.$2 ?? 'ALL');
                    },
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AsyncBody<List<Report>>(
      load: () async {
        try {
          return await Api.myReports();
        } on ApiException catch (e) {
          if (e.isUnavailable) {
            // offline: still show what is waiting on the phone
            return <Report>[];
          }
          rethrow;
        }
      },
      builder: (context, reports, refresh) {
        final shown = reports
            .where((r) => _filter == null || _group(r.status) == _filter)
            .toList();

        return RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
            children: [
              Row(
                children: [
                  GestureDetector(
                    onTap: widget.onBack,
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: const BoxDecoration(
                          color: EhbrColors.ink, shape: BoxShape.circle),
                      child: const Icon(Icons.chevron_left,
                          color: Colors.white, size: 18),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: widget.onBack,
                    child: Text('Back to Profile',
                        style: manrope(14, FontWeight.w600, EhbrColors.ink)),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Text('My Reports',
                  style: manrope(20, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 12),

              // Status filter chips.
              if (reports.isNotEmpty) ...[
                _filterChips(reports),
                const SizedBox(height: 14),
              ] else
                const SizedBox(height: 2),

              // Reports waiting to send are only shown under "ALL".
              if (_filter == null)
                ValueListenableBuilder<int>(
                  valueListenable: ReportQueue.changes,
                  builder: (context, _, __) => Column(
                    children: [
                      for (final q in ReportQueue.pending) ...[
                        Material(
                          color: const Color(0xFFFFF4D6),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                            side: const BorderSide(color: Color(0xFFF2D58A)),
                          ),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(12),
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                  builder: (_) => const QueuedReportsScreen()),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 12),
                              child: Row(
                                children: [
                                  const Icon(Icons.schedule_send_outlined,
                                      size: 18, color: _pIcon),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                        '${q.type} · saved on your phone',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: manrope(13, FontWeight.w700,
                                            EhbrColors.ink)),
                                  ),
                                  Text('Waiting to send',
                                      style: manrope(10, FontWeight.w800,
                                          const Color(0xFF8A6100))),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                      ],
                    ],
                  ),
                ),
              if (reports.isEmpty && ReportQueue.pending.isEmpty)
                const EmptyState(
                  icon: Icons.description_outlined,
                  title: 'You haven’t filed any reports',
                  message:
                      'Use “Report Incident” or “Report Hazard” on the Home screen.',
                )
              else if (reports.isNotEmpty && shown.isEmpty)
                const EmptyState(
                  icon: Icons.filter_list_rounded,
                  title: 'No reports here',
                  message: 'None of your reports have this status right now.',
                ),
              for (final r in shown) ...[
                Material(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: const BorderSide(color: _pBorder),
                  ),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => _details(context, r),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(r.type,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: manrope(
                                        14, FontWeight.w700, EhbrColors.ink)),
                                const SizedBox(height: 3),
                                Text('${r.id} · ${ago(r.createdAt)}',
                                    style: manrope(
                                        11, FontWeight.w500, EhbrColors.muted)),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          // Short wording so the pill is never cut off.
                          _StatusPill(r.status),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
              ],
            ],
          ),
        );
      },
    );
  }
}

// ------------------------------------------------------------
// FILTER CHIP (same look and motion as the Map screen)
// ------------------------------------------------------------

class _ReportFilterChip extends StatelessWidget {
  const _ReportFilterChip({
    super.key,
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = label == 'ALL' ? label : '$label ($count)';

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
          height: 32,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? _pRedTint : Colors.white,
            border: Border.all(
              color: selected ? _pRed : _pBorder,
              width: 1.2,
            ),
            borderRadius: BorderRadius.circular(10),
          ),
          child: AnimatedDefaultTextStyle(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOut,
            style: manrope(
              11,
              FontWeight.w600,
              selected ? _pRed : EhbrColors.ink,
            ),
            child: Text(text),
          ),
        ),
      ),
    );
  }
}

/// Neutral pill; only the small dot carries the status colour.
/// [short] uses the compact wording (e.g. "Responding") for list rows.
class _StatusPill extends StatelessWidget {
  const _StatusPill(this.status, {this.short = true});
  final String status;
  final bool short;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 200),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: _pBorder),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                  color: statusColor(status), shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                short ? statusShortLabel(status) : statusLabel(status),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: manrope(10, FontWeight.w700, EhbrColors.ink),
              ),
            ),
          ],
        ),
      ),
    );
  }
}