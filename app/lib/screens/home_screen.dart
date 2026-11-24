import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';
import '../phone.dart';
import '../services/api.dart';
import '../services/report_queue.dart';
import '../services/session.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets/announcement_card.dart';
import '../widgets/async_body.dart';
import '../widgets/emergency_numbers.dart';
import '../widgets/sos_sheet.dart';
import 'queued_reports_screen.dart';
import 'report_reply_sheet.dart';

// Clean palette: light grey cards on white with black text. Red is kept only
// for SOS and the alert icon.
const Color _homeSurface = Color(0xFFF3F4F8);

// Every icon on this screen uses this one neutral colour.
const Color _homeIcon = EhbrColors.ink;

/// Announcements, evacuation centers, whether we are offline, the resident's
/// own reports and the roads currently blocked.
typedef _HomeData = (
  List<Announcement>,
  List<EvacCenter>,
  bool,
  List<Report>,
  List<Blockage>,
);

/// The extras on Home must never break the screen, so a failure just means
/// "nothing to show".
Future<T> _safe<T>(Future<T> f, T fallback) async {
  try {
    return await f;
  } catch (_) {
    return fallback;
  }
}

/// The newest report that is still being handled, if any.
Report? _activeReport(List<Report> reports) {
  final open = reports
      .where((r) => const ['NEW', 'VERIFIED', 'DISPATCHED'].contains(r.status))
      .toList()
    ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return open.isEmpty ? null : open.first;
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.reloadToken,
    required this.onReport,
    required this.onOpenNews,
    required this.onOpenReports,
    required this.onOpenMap,
    this.onOpenContacts,
  });

  final int reloadToken;

  /// Opens the Create Report form, optionally pre-selecting a type.
  final ValueChanged<String?> onReport;

  /// Opens the News tab, on a specific announcement when an id is given.
  final ValueChanged<String?> onOpenNews;

  /// Opens My Reports (Profile tab), on one report when an id is given.
  final ValueChanged<String?> onOpenReports;

  /// Opens the Map tab.
  final VoidCallback onOpenMap;

  /// Opens the Contacts tab. When null, the "See all" link next to Emergency Contacts is hidden.
  final VoidCallback? onOpenContacts;

  Future<_HomeData> _load() async {
    try {
      final r = await Future.wait<Object>([
        Api.announcements(),
        Api.centers(),
        _safe<List<Report>>(Api.myReports(), <Report>[]),
        _safe<List<Blockage>>(Api.blockages(), <Blockage>[]),
      ]);

      return (
        r[0] as List<Announcement>,
        r[1] as List<EvacCenter>,
        false,
        r[2] as List<Report>,
        r[3] as List<Blockage>,
      );
    } on ApiException catch (e) {
      // Offline: SOS, reporting and saved emergency numbers remain available.
      if (e.isUnavailable) {
        return (<Announcement>[], <EvacCenter>[], true, <Report>[], <Blockage>[]);
      }
      rethrow;
    }
  }

  @override
  Widget build(BuildContext context) {
    return AsyncBody<_HomeData>(
      load: _load,
      placeholder: const _HomeSkeleton(),
      reloadToken: reloadToken,
      builder: (context, data, refresh) {
        final cfg = Session.config;
        final announcements = data.$1;
        final offline = data.$3;
        final active = _activeReport(data.$4);
        final blockages = data.$5;

        final centers = data.$2.where((c) => c.status != 'closed').toList();

        final alert = announcements.cast<Announcement?>().firstWhere(
              (a) =>
                  a!.category == 'alert' &&
                  DateTime.now().difference(a.createdAt).inHours < 48,
              orElse: () => null,
            );

        final contacts = cfg.contacts;

        return _ScrollEdge(
          child: RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
            children: [
              if (offline)
                const _Notice(
                  icon: Icons.wifi_off_rounded,
                  text:
                      'Can’t reach the barangay server right now. Calling, reporting and your saved numbers still work.',
                ),

              ValueListenableBuilder<int>(
                valueListenable: ReportQueue.changes,
                builder: (context, _, __) {
                  final n = ReportQueue.pending.length;

                  if (n == 0) {
                    return const SizedBox.shrink();
                  }

                  return _Notice(
                    icon: Icons.schedule_send_outlined,
                    text:
                        '$n report${n == 1 ? '' : 's'} waiting to send – tap to view',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const QueuedReportsScreen(),
                      ),
                    ),
                  );
                },
              ),

              // SOS button and the resident's active report, in one card.
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _homeSurface,
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Column(
                  children: [
                    // Tapping opens the emergency options sheet.
                    _SosButton(
                      number: cfg.sosNumber,
                      hold: false,
                      onCall: () => showSosSheet(context),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Tap to view emergency options',
                      style: manrope(11, FontWeight.w500, EhbrColors.muted),
                    ),
                    if (active != null) ...[
                      const SizedBox(height: 12),
                      _ActiveReportCard(
                        report: active,
                        onOpen: () => onOpenReports(active.id),
                        onReply: () => _replyTo(context, active, refresh),
                      ),
                    ],
                  ],
                ),
              ),

              const SizedBox(height: 20),
              const _SectionTitle('Report'),
              const SizedBox(height: 12),

              // Two big cards, like the lime / black cards in the reference.
              Row(
                children: [
                  Expanded(
                    child: _ActionCard(
                      icon: Icons.error_outline,
                      title: 'Report Incident',
                      body:
                          'Immediately report an incident (e.g., accident, injuries, etc.)',
                      onTap: () => onReport(null),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _ActionCard(
                      icon: Icons.warning_amber_rounded,
                      title: 'Report Hazard',
                      body:
                          'Your observation keeps everyone safe. Report potential risks!',
                      onTap: () => onReport('Other hazard'),
                    ),
                  ),
                ],
              ),

              if (contacts.isNotEmpty) ...[
                const SizedBox(height: 24),
                _HomeContacts(
                  contacts: [
                    for (final c in contacts) _HomeContact(c.name, c.number, '${c.category}'),
                  ],
                  onCall: (c) => callNumber(context, c.number),
                  onSeeAll: onOpenContacts,
                ),
              ],

              if (offline) ...[
                const SizedBox(height: 20),
                const EmergencyNumbersCard(),
              ] else ...[
                const SizedBox(height: 24),
                Row(
                  children: [
                    const Expanded(
                      child: _SectionTitle('Evacuation & Safe Zones'),
                    ),
                    if (centers.length > 1)
                      GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: onOpenMap,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Text(
                            'See all',
                            style: manrope(
                              12,
                              FontWeight.w700,
                              EhbrColors.ink,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                if (centers.isEmpty)
                  const EmptyState(
                    icon: Icons.shield_outlined,
                    title: 'No evacuation centers listed yet',
                    message: 'Your barangay will add them here.',
                  )
                else
                  for (final c in centers.take(1)) ...[
                    _CenterCard(c),
                    const SizedBox(height: 10),
                  ],
                if (alert != null || blockages.isNotEmpty) ...[
                  _StatusCard(
                    alert: alert,
                    blockCount: blockages.length,
                    onAlert: alert == null ? null : () => onOpenNews(alert.id),
                    onBlock: onOpenMap,
                  ),
                ],
                SizedBox(
                  height: alert != null || blockages.isNotEmpty ? 24 : 14,
                ),
                Row(
                  children: [
                    const Expanded(
                      child: _SectionTitle('Announcements'),
                    ),
                    if (announcements.length > 3)
                      GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => onOpenNews(null),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Text(
                            'See all',
                            style: manrope(
                              12,
                              FontWeight.w700,
                              EhbrColors.ink,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                if (announcements.isEmpty)
                  const EmptyState(
                    icon: Icons.campaign_outlined,
                    title: 'No announcements yet',
                    message:
                        'Alerts and advisories from the barangay will show up here.',
                  )
                else
                  for (final a in announcements.take(3)) ...[
                    _AnnouncementTile(
                      a,
                      onTap: () => onOpenNews(a.id),
                    ),
                    const SizedBox(height: 10),
                  ],
              ],
            ],
          ),
        ),
        );
      },
    );
  }
}

/// Draws a thin divider under the top bar once the page has scrolled, so
/// content never slides under the white bar with no visible edge.
class _ScrollEdge extends StatefulWidget {
  const _ScrollEdge({required this.child});

  final Widget child;

  @override
  State<_ScrollEdge> createState() => _ScrollEdgeState();
}

class _ScrollEdgeState extends State<_ScrollEdge> {
  bool _scrolled = false;

  bool _onScroll(ScrollNotification n) {
    if (n.metrics.axis != Axis.vertical) return false;
    if (n is! ScrollUpdateNotification && n is! ScrollEndNotification) {
      return false;
    }
    final s = n.metrics.pixels > 4;
    if (s != _scrolled) setState(() => _scrolled = s);
    return false;
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        NotificationListener<ScrollNotification>(
          onNotification: _onScroll,
          child: widget.child,
        ),
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: IgnorePointer(
            child: AnimatedOpacity(
              opacity: _scrolled ? 1 : 0,
              duration: const Duration(milliseconds: 150),
              child: Container(height: 1, color: const Color(0xFFE2E4EA)),
            ),
          ),
        ),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: manrope(
        16,
        FontWeight.w800,
        EhbrColors.ink,
      ),
    );
  }
}

/// Calls immediately, or after a 3-second hold when [hold] is enabled.
class _SosButton extends StatefulWidget {
  const _SosButton({
    required this.number,
    required this.hold,
    required this.onCall,
  });

  final String number;
  final bool hold;
  final VoidCallback onCall;

  @override
  State<_SosButton> createState() => _SosButtonState();
}

class _SosButtonState extends State<_SosButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 3),
  )..addStatusListener((s) {
      if (s == AnimationStatus.completed) {
        HapticFeedback.heavyImpact();
        widget.onCall();
        _c.reset();
      }
    });

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _release() {
    if (widget.hold && _c.status != AnimationStatus.completed) {
      _c.reset();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: (_) {
        if (widget.hold) {
          _c.forward();
        }
      },
      onPointerUp: (_) => _release(),
      onPointerCancel: (_) => _release(),
      child: Material(
        color: EhbrColors.sos,
        elevation: 0,
        borderRadius: BorderRadius.circular(16),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: widget.hold
              ? () {
                  ScaffoldMessenger.of(context)
                    ..hideCurrentSnackBar()
                    ..showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Keep holding for 3 seconds to call.',
                        ),
                      ),
                    );
                }
              : () {
                  HapticFeedback.mediumImpact();
                  widget.onCall();
                },
          child: SizedBox(
            height: 60,
            width: double.infinity,
            child: Stack(
              fit: StackFit.expand,
              children: [
                // Hold-progress animation.
                AnimatedBuilder(
                  animation: _c,
                  builder: (_, __) => FractionallySizedBox(
                    alignment: Alignment.centerLeft,
                    widthFactor: _c.value,
                    child: Container(
                      color: Colors.black.withValues(alpha: .22),
                    ),
                  ),
                ),

                // One phone icon and text, centered as a single group.
                Center(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.phone,
                        color: Colors.white,
                        size: 20,
                      ),
                      const SizedBox(width: 10),
                      Text(
                        widget.hold
                            ? 'Hold to Call Emergency / SOS'
                            : 'Call Emergency / SOS',
                        textAlign: TextAlign.center,
                        style: manrope(
                          16,
                          FontWeight.w700,
                          Colors.white,
                          spacing: .256,
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

/// Large rounded neutral card for the two report actions.
class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.title,
    required this.body,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String body;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _homeSurface,
      borderRadius: BorderRadius.circular(22),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        child: SizedBox(
          height: 176,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(icon, color: _homeIcon, size: 20),
                    ),
                    const Spacer(),
                    const Icon(
                      Icons.north_east_rounded,
                      color: EhbrColors.muted,
                      size: 18,
                    ),
                  ],
                ),
                const Spacer(),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: manrope(15, FontWeight.w800, EhbrColors.ink),
                ),
                const SizedBox(height: 4),
                Text(
                  body,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: manrope(11, FontWeight.w500, EhbrColors.muted),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HomeContact {
  const _HomeContact(this.name, this.number, this.category);
  final String name, number, category;
}

/// Order the four Home slots are filled in after favorites. Keep in sync with the admin console's categories.
const List<String> _homeCatOrder = ['police', 'fire', 'medical', 'barangay', 'disaster', 'local', 'utility', 'other'];

const Map<String, IconData> _homeCatIcons = {
  'police': Icons.local_police_outlined,
  'fire': Icons.local_fire_department_outlined,
  'medical': Icons.medical_services_outlined,
  'barangay': Icons.account_balance_outlined,
  'disaster': Icons.warning_amber_rounded,
  'local': Icons.local_phone_outlined,
  'utility': Icons.build_circle_outlined,
  'other': Icons.phone_in_talk_outlined,
};

/// Emergency Contacts on Home: up to four wide tiles in a 2 x 2 grid.
/// Favorites (starred on the Contacts tab) come first, then the rest by category.
class _HomeContacts extends StatefulWidget {
  const _HomeContacts({required this.contacts, required this.onCall, this.onSeeAll});

  final List<_HomeContact> contacts;
  final void Function(_HomeContact) onCall;
  final VoidCallback? onSeeAll;

  @override
  State<_HomeContacts> createState() => _HomeContactsState();
}

class _HomeContactsState extends State<_HomeContacts> {
  // Same key the Contacts tab saves its stars under.
  static const _favKey = 'favorite_contacts';
  Set<String> _favs = {};

  @override
  void initState() {
    super.initState();
    _loadFavs();
  }

  @override
  void didUpdateWidget(covariant _HomeContacts oldWidget) {
    super.didUpdateWidget(oldWidget);
    _loadFavs();
  }

  Future<void> _loadFavs() async {
    try {
      final p = await SharedPreferences.getInstance();
      final f = (p.getStringList(_favKey) ?? <String>[]).toSet();
      if (mounted && (f.length != _favs.length || !f.containsAll(_favs))) setState(() => _favs = f);
    } catch (_) {}
  }

  List<_HomeContact> _pick() {
    final all = widget.contacts;
    int rank(_HomeContact c) {
      final i = _homeCatOrder.indexOf(c.category);
      return i < 0 ? _homeCatOrder.length - 1 : i;
    }

    final favs = all.where((c) => _favs.contains(c.number)).toList();
    final rest = all.where((c) => !_favs.contains(c.number)).toList()
      ..sort((a, b) {
        final r = rank(a).compareTo(rank(b));
        return r != 0 ? r : all.indexOf(a).compareTo(all.indexOf(b));
      });
    return [...favs, ...rest].take(4).toList();
  }

  @override
  Widget build(BuildContext context) {
    final picks = _pick();
    final rows = <Widget>[];
    for (var i = 0; i < picks.length; i += 2) {
      final a = picks[i];
      final b = i + 1 < picks.length ? picks[i + 1] : null;
      rows.add(
        Padding(
          padding: EdgeInsets.only(top: i == 0 ? 0 : 10),
          // IntrinsicHeight keeps the two tiles in a row the same height.
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _HomeContactTile(contact: a, onTap: () => widget.onCall(a))),
                const SizedBox(width: 10),
                Expanded(
                  child: b == null ? const SizedBox.shrink() : _HomeContactTile(contact: b, onTap: () => widget.onCall(b)),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const _SectionTitle('Emergency Contacts'),
            const Spacer(),
            if (widget.onSeeAll != null)
              TextButton(
                onPressed: widget.onSeeAll,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  minimumSize: const Size(0, 32),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Text('See all', style: manrope(12, FontWeight.w700, EhbrColors.brand)),
              ),
          ],
        ),
        const SizedBox(height: 12),
        ...rows,
      ],
    );
  }
}

class _HomeContactTile extends StatelessWidget {
  const _HomeContactTile({required this.contact, required this.onTap});

  final _HomeContact contact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _homeSurface,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          // Minimum height, so every tile matches even when a name is short.
          constraints: const BoxConstraints(minHeight: 76),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                  child: Icon(_homeCatIcons[contact.category] ?? Icons.phone_in_talk_outlined, color: _homeIcon, size: 18),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        contact.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: manrope(12, FontWeight.w700, EhbrColors.ink),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        contact.number,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: manrope(11, FontWeight.w600, EhbrColors.muted),
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

class _CenterCard extends StatelessWidget {
  const _CenterCard(this.c);

  final EvacCenter c;

  @override
  Widget build(BuildContext context) {
    final open = c.status == 'open';

    final sub = [
      if (c.address.isNotEmpty) c.address,
      if (c.capacity > 0) '${c.occupied}/${c.capacity} inside',
    ].join(' · ');

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _homeSurface,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.shield_outlined,
              color: _homeIcon,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  c.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: manrope(
                    14,
                    FontWeight.w700,
                    EhbrColors.ink,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  open
                      ? 'Open${sub.isEmpty ? '' : ' · $sub'}'
                      : 'Standby${sub.isEmpty ? '' : ' · $sub'}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: manrope(
                    11,
                    FontWeight.w500,
                    EhbrColors.muted,
                  ),
                ),
                if (c.capacity > 0) ...[
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(
                      value: (c.occupied / c.capacity).clamp(0.0, 1.0),
                      minHeight: 4,
                      backgroundColor: Colors.white,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        c.occupied / c.capacity >= .9
                            ? EhbrColors.sos
                            : EhbrColors.ink,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (c.lat != null && c.lng != null) ...[
            const SizedBox(width: 10),
            FilledButton(
              onPressed: () => openDirections(c.lat!, c.lng!),
              style: FilledButton.styleFrom(
                backgroundColor: EhbrColors.ink,
                foregroundColor: Colors.white,
                shape: const StadiumBorder(),
                minimumSize: const Size(64, 36),
                padding: const EdgeInsets.symmetric(horizontal: 16),
              ),
              child: Text(
                'Route',
                style: manrope(
                  12,
                  FontWeight.w700,
                  Colors.white,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Announcement row on Home: soft grey card; only the category label is coloured.
class _AnnouncementTile extends StatelessWidget {
  const _AnnouncementTile(
    this.a, {
    required this.onTap,
  });

  final Announcement a;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = categoryColor(a.category);

    return Material(
      color: _homeSurface,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        // One fixed card size, so every announcement looks the same
        // whatever the length of its title or message.
        child: SizedBox(
          height: 124,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: .12),
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Text(
                        categoryTag(a.category),
                        style: manrope(10, FontWeight.w700, color),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      ago(a.createdAt),
                      style: manrope(
                        11,
                        FontWeight.w500,
                        EhbrColors.muted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        a.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: manrope(
                          13,
                          FontWeight.w700,
                          EhbrColors.ink,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Flexible(
                        child: Text(
                          a.body,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: manrope(
                            12,
                            FontWeight.w400,
                            EhbrColors.muted,
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

/// Opens the reply sheet for a report the barangay asked about.
Future<void> _replyTo(
  BuildContext context,
  Report r,
  Future<void> Function() refresh,
) async {
  final out = await showReplySheet(
    context,
    reportId: r.id,
    question: r.infoMessage,
  );

  if (out == null || !context.mounted) return;

  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(
          out == ReplyOutcome.sent
              ? 'Your reply was sent to the barangay.'
              : 'Saved. It will be sent when you are back online.',
        ),
      ),
    );

  await refresh();
}

/// Slim card for the resident's own report that is still being handled.
/// When the barangay asked for more details it turns into a reply prompt.
class _ActiveReportCard extends StatelessWidget {
  const _ActiveReportCard({
    required this.report,
    required this.onOpen,
    required this.onReply,
  });

  final Report report;
  final VoidCallback onOpen;
  final VoidCallback onReply;

  String get _status => switch (report.status) {
        'VERIFIED' => 'Verified by the barangay',
        'DISPATCHED' => 'Responders are on the way',
        _ => 'Received, waiting for review',
      };

  @override
  Widget build(BuildContext context) {
    final reply = report.canReply;
    final question = (report.infoMessage ?? '').trim();

    final sub = reply
        ? (question.isEmpty ? 'The barangay needs more details.' : question)
        : '$_status · ${ago(report.createdAt)}';

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: reply ? onReply : onOpen,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  color: _homeSurface,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  reply ? Icons.mark_chat_unread_outlined : Icons.assignment_outlined,
                  color: _homeIcon,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      reply ? 'Reply needed' : 'Your report',
                      style: manrope(
                        10,
                        FontWeight.w700,
                        reply ? EhbrColors.sos : EhbrColors.muted,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      report.type,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: manrope(14, FontWeight.w700, EhbrColors.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      sub,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: manrope(11, FontWeight.w500, EhbrColors.muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              if (reply)
                FilledButton(
                  onPressed: onReply,
                  style: FilledButton.styleFrom(
                    backgroundColor: EhbrColors.ink,
                    foregroundColor: Colors.white,
                    shape: const StadiumBorder(),
                    minimumSize: const Size(64, 36),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                  child: Text(
                    'Reply',
                    style: manrope(12, FontWeight.w700, Colors.white),
                  ),
                )
              else
                const Icon(
                  Icons.chevron_right_rounded,
                  size: 20,
                  color: EhbrColors.muted,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Alert and blocked-road notices in one quiet card instead of two banners.
class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.alert,
    required this.blockCount,
    required this.onAlert,
    required this.onBlock,
  });

  final Announcement? alert;
  final int blockCount;
  final VoidCallback? onAlert;
  final VoidCallback onBlock;

  Widget _row(IconData icon, Color color, String text, VoidCallback? onTap) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Row(
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: manrope(12, FontWeight.w700, EhbrColors.ink),
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: EhbrColors.muted,
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final a = alert;

    return Material(
      color: _homeSurface,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          if (a != null)
            _row(
              Icons.warning_amber_rounded,
              EhbrColors.sos,
              '${a.title} · ${ago(a.createdAt)}',
              onAlert,
            ),
          if (a != null && blockCount > 0)
            const Divider(height: 2, thickness: 2, color: Colors.white),
          if (blockCount > 0)
            _row(
              Icons.block,
              _homeIcon,
              '$blockCount road${blockCount == 1 ? '' : 's'} blocked · See on map',
              onBlock,
            ),
        ],
      ),
    );
  }
}

/// Grey placeholder blocks shown while Home loads, so the layout does not jump.
class _HomeSkeleton extends StatefulWidget {
  const _HomeSkeleton();

  @override
  State<_HomeSkeleton> createState() => _HomeSkeletonState();
}

class _HomeSkeletonState extends State<_HomeSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 800),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Widget _b(double h, {double? w, double r = 18}) => Container(
        height: h,
        width: w,
        decoration: BoxDecoration(
          color: const Color(0xFFEBECF1),
          borderRadius: BorderRadius.circular(r),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: FadeTransition(
        opacity: Tween<double>(begin: .45, end: 1).animate(
          CurvedAnimation(parent: _c, curve: Curves.easeInOut),
        ),
        child: ListView(
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
          children: [
            _b(96, r: 22),
            const SizedBox(height: 20),
            _b(16, w: 80, r: 6),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _b(176, r: 22)),
                const SizedBox(width: 12),
                Expanded(child: _b(176, r: 22)),
              ],
            ),
            const SizedBox(height: 24),
            _b(16, w: 150, r: 6),
            const SizedBox(height: 12),
            _b(76),
            const SizedBox(height: 24),
            _b(16, w: 130, r: 6),
            const SizedBox(height: 12),
            for (var i = 0; i < 3; i++) ...[
              _b(124),
              const SizedBox(height: 10),
            ],
          ],
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.text,
    this.onTap,
  });

  final IconData icon;
  final String text;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: const Color(0xFFFFF4D6),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(
            color: Color(0xFFF2D58A),
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 12,
            ),
            child: Row(
              children: [
                Icon(
                  icon,
                  size: 18,
                  color: _homeIcon,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    text,
                    style: manrope(
                      12,
                      FontWeight.w700,
                      const Color(0xFF8A6100),
                    ),
                  ),
                ),
                if (onTap != null)
                  const Icon(
                    Icons.chevron_right_rounded,
                    size: 18,
                    color: Color(0xFF8A6100),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
