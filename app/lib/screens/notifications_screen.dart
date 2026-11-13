import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';
import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets/async_body.dart';

// Same neutral surface colours as the Home, Map, Contacts, News and Profile screens.
const Color _nBorder = Color(0xFFE2E4EA);
const Color _nSurface = Color(0xFFF3F4F8);
const Color _nRedTint = Color(0xFFFDEEF0);

/// The bell: everything the barangay sent you. Pops with the tab to open
/// (1 = Map, 3 = News, 4 = Profile) when a notification is tapped.
///
/// Long-press a notification (or tap "Select") to remove one or several at once.
/// Removing hides them on THIS phone only; nothing is deleted on the server.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  static IconData _icon(String kind) => switch (kind) {
        'alert' => Icons.warning_amber_rounded,
        'report' => Icons.description_outlined,
        'security' => Icons.lock_outline_rounded,
        _ => Icons.campaign_outlined,
      };

  static int _tab(String kind) => switch (kind) {
        'alert' => 1,
        'report' => 4,
        'security' => 4,
        _ => 3,
      };

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  NotificationFeed? _feed;
  Set<String> _dismissed = {};
  final Set<String> _selected = {};
  bool _selecting = false;

  // One list per signed-in resident, kept on the phone.
  String get _key => 'ehbr_dismissed_notifications_${Session.user?.id ?? ''}';

  List<AppNotification> get _visible =>
      (_feed?.items ?? const <AppNotification>[]).where((n) => !_dismissed.contains(n.id)).toList();

  Future<void> _loadDismissed(NotificationFeed feed) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = (prefs.getStringList(_key) ?? <String>[]).toSet();
      // Forget ids the server no longer sends, so the saved list never grows forever.
      final kept = stored.intersection(feed.items.map((n) => n.id).toSet());
      if (kept.length != stored.length) await prefs.setStringList(_key, kept.toList());
      _dismissed = kept;
    } catch (_) {
      // If saving is not possible, nothing is hidden; the list still works.
    }
  }

  Future<void> _saveDismissed() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_key, _dismissed.toList());
    } catch (_) {}
  }

  Future<NotificationFeed> _load() async {
    final feed = await Api.notifications();
    try {
      await Api.markNotificationsRead(); // the badge clears; this list still shows what was new
    } catch (_) {}
    await _loadDismissed(feed);
    if (mounted) {
      setState(() {
        _feed = feed;
        _selected.removeWhere((id) => _dismissed.contains(id));
      });
    }
    return feed;
  }

  // ---- selection

  void _enterSelect([String? id]) => setState(() {
        _selecting = true;
        if (id != null) _selected.add(id);
      });

  void _exitSelect() => setState(() {
        _selecting = false;
        _selected.clear();
      });

  void _toggle(String id) => setState(() {
        if (!_selected.add(id)) _selected.remove(id);
      });

  // ---- removing

  Future<void> _deleteSelected() async {
    final count = _selected.length;
    if (count == 0) return;

    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _RemoveDialog(count: count),
    );
    if (ok != true || !mounted) return;

    final removed = Set<String>.of(_selected);
    setState(() {
      _dismissed.addAll(removed);
      _selected.clear();
      _selecting = false;
    });
    await _saveDismissed();
    if (!mounted) return;
    _showRemovedSnack(removed);
  }

  Future<void> _undoRemove(Set<String> removed) async {
    if (!mounted) return;
    setState(() => _dismissed.removeAll(removed));
    await _saveDismissed();
  }

  /// Floating confirmation with an Undo action.
  void _showRemovedSnack(Set<String> removed) {
    final text = removed.length == 1
        ? '1 notification removed'
        : '${removed.length} notifications removed';

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          backgroundColor: EhbrColors.ink,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          padding: const EdgeInsets.fromLTRB(14, 4, 6, 4),
          duration: const Duration(seconds: 5),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          content: Row(
            children: [
              const Icon(
                Icons.check_circle_outline_rounded,
                size: 20,
                color: Colors.white,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  text,
                  style: manrope(13, FontWeight.w600, Colors.white),
                ),
              ),
            ],
          ),
          action: SnackBarAction(
            label: 'Undo',
            textColor: Colors.white,
            onPressed: () => _undoRemove(removed),
          ),
        ),
      );
  }

  // ---- UI

  Widget _header(List<AppNotification> visible) {
    if (_selecting) {
      final allSelected = visible.isNotEmpty && _selected.length == visible.length;
      return Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
        child: Row(
          children: [
            IconButton(
              tooltip: 'Cancel selection',
              onPressed: _exitSelect,
              icon: const Icon(Icons.close, color: EhbrColors.ink),
            ),
            Expanded(
              child: Text('${_selected.length} selected', style: manrope(18, FontWeight.w800, EhbrColors.ink)),
            ),
            TextButton(
              onPressed: () => setState(() {
                if (allSelected) {
                  _selected.clear();
                } else {
                  _selected
                    ..clear()
                    ..addAll(visible.map((n) => n.id));
                }
              }),
              child: Text(allSelected ? 'Clear' : 'Select all', style: manrope(13, FontWeight.w700, EhbrColors.brand)),
            ),
            IconButton(
              tooltip: 'Delete selected',
              onPressed: _selected.isEmpty ? null : _deleteSelected,
              icon: Icon(Icons.delete_outline_rounded, color: _selected.isEmpty ? EhbrColors.muted : EhbrColors.ink),
            ),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back, color: EhbrColors.ink),
          ),
          Expanded(child: Text('Notifications', style: manrope(20, FontWeight.w800, EhbrColors.ink))),
          if (visible.isNotEmpty)
            TextButton(
              onPressed: _enterSelect,
              child: Text('Select', style: manrope(13, FontWeight.w700, EhbrColors.brand)),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visible;

    return PopScope(
      canPop: !_selecting,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _selecting) _exitSelect();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Column(
            children: [
              _header(visible),
              Expanded(
                child: AsyncBody<NotificationFeed>(
                  load: _load,
                  builder: (context, feed, refresh) {
                    final items = _visible;
                    return RefreshIndicator(
                      onRefresh: refresh,
                      child: items.isEmpty
                          ? ListView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              children: const [
                                SizedBox(height: 60),
                                EmptyState(
                                  icon: Icons.notifications_none_rounded,
                                  title: 'No notifications yet',
                                  message: 'Alerts from the barangay and updates on your reports will appear here.',
                                ),
                              ],
                            )
                          : ListView.separated(
                              physics: const AlwaysScrollableScrollPhysics(),
                              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                              itemCount: items.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 10),
                              itemBuilder: (_, i) => _NotificationCard(
                                n: items[i],
                                selecting: _selecting,
                                selected: _selected.contains(items[i].id),
                                onTap: () => _selecting
                                    ? _toggle(items[i].id)
                                    : Navigator.of(context).pop(NotificationsScreen._tab(items[i].kind)),
                                onLongPress: _selecting ? null : () => _enterSelect(items[i].id),
                              ),
                            ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------
// REMOVE CONFIRMATION DIALOG
// ------------------------------------------------------------

/// Asks before hiding notifications. Pops true when the person confirms.
class _RemoveDialog extends StatelessWidget {
  const _RemoveDialog({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final title = count == 1
        ? 'Remove this notification?'
        : 'Remove $count notifications?';

    return Dialog(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Icon in a soft grey square, like the other cards.
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: _nSurface,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Icon(
                Icons.delete_outline_rounded,
                size: 24,
                color: EhbrColors.ink,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: manrope(17, FontWeight.w800, EhbrColors.ink),
            ),
            const SizedBox(height: 8),
            Text(
              'They will be removed from this phone only. '
              'Your reports and the barangay’s records are not affected.',
              textAlign: TextAlign.center,
              style: manrope(13, FontWeight.w400, EhbrColors.muted)
                  .copyWith(height: 1.45),
            ),
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context, false),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 46),
                      foregroundColor: EhbrColors.ink,
                      side: const BorderSide(color: _nBorder),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: Text(
                      'Cancel',
                      style: manrope(14, FontWeight.w700, EhbrColors.ink),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 46),
                      backgroundColor: EhbrColors.brand,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: Text(
                      'Remove',
                      style: manrope(14, FontWeight.w700, Colors.white),
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

// ------------------------------------------------------------
// NOTIFICATION CARD
// ------------------------------------------------------------

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({
    required this.n,
    required this.selecting,
    required this.selected,
    required this.onTap,
    required this.onLongPress,
  });

  final AppNotification n;
  final bool selecting, selected;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? _nRedTint : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: selected ? EhbrColors.brand : _nBorder, width: selected ? 1.4 : 1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (selecting) ...[
                _Check(selected: selected),
                const SizedBox(width: 12),
              ],
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: _nSurface, borderRadius: BorderRadius.circular(10)),
                child: Icon(NotificationsScreen._icon(n.kind), color: EhbrColors.ink, size: 19),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(n.title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: manrope(13, FontWeight.w700, EhbrColors.ink)),
                        ),
                        if (n.unread)
                          const Padding(
                            padding: EdgeInsets.only(left: 8),
                            child: Icon(Icons.circle, size: 9, color: EhbrColors.brand),
                          ),
                      ],
                    ),
                    if (n.body.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(n.body,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: manrope(12, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.4)),
                    ],
                    const SizedBox(height: 6),
                    Text(ago(n.createdAt), style: manrope(11, FontWeight.w500, EhbrColors.muted)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Round tick box shown in selection mode.
class _Check extends StatelessWidget {
  const _Check({required this.selected});
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 7),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        width: 22,
        height: 22,
        decoration: BoxDecoration(
          color: selected ? EhbrColors.ink : Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: selected ? EhbrColors.ink : EhbrColors.muted, width: 1.5),
        ),
        child: selected ? const Icon(Icons.check, size: 14, color: Colors.white) : null,
      ),
    );
  }
}