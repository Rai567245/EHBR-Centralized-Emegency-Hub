import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/api.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets/announcement_card.dart';
import '../widgets/async_body.dart';

// Same neutral surface colours as the Home, Map and Contacts screens.
const Color _nBorder = Color(0xFFE2E4EA);
const Color _nRed = Color(0xFFC7193D);
const Color _nRedTint = Color(0xFFFDEEF0);

/// News tab: list ⇄ article. The top bar and nav stay put.
class NewsTab extends StatefulWidget {
  const NewsTab({super.key, required this.reloadToken});
  final int reloadToken;

  @override
  State<NewsTab> createState() => _NewsTabState();
}

class _NewsTabState extends State<NewsTab> {
  Announcement? _open;

  @override
  Widget build(BuildContext context) {
    final open = _open;
    if (open != null) return _Article(a: open, onBack: () => setState(() => _open = null));
    return AsyncBody<List<Announcement>>(
      load: Api.announcements,
      reloadToken: widget.reloadToken,
      builder: (context, list, refresh) =>
          _NewsList(items: list, onRefresh: refresh, onOpen: (a) => setState(() => _open = a)),
    );
  }
}

class _NewsList extends StatefulWidget {
  const _NewsList({required this.items, required this.onRefresh, required this.onOpen});
  final List<Announcement> items;
  final Future<void> Function() onRefresh;
  final ValueChanged<Announcement> onOpen;

  @override
  State<_NewsList> createState() => _NewsListState();
}

class _NewsListState extends State<_NewsList> {
  String? _filter; // null = all
  String _query = '';

  bool _matches(Announcement a) {
    if (_filter != null && a.category != _filter) return false;
    final q = _query.trim().toLowerCase();
    return q.isEmpty || a.title.toLowerCase().contains(q) || a.body.toLowerCase().contains(q);
  }

  @override
  Widget build(BuildContext context) {
    final visible = widget.items.where(_matches).toList();
    final alerts = visible.where((a) => a.category != 'event').toList();
    final community = visible.where((a) => a.category == 'event').toList();
    final chips = <(String, String?)>[('ALL', null), ('Alert', 'alert'), ('Advisory', 'advisory'), ('Event', 'event')];

    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Text('News & Announcements', style: manrope(20, FontWeight.w800, EhbrColors.ink)),
          const SizedBox(height: 14),

          // Search on its own full-width row.
          TextField(
            onChanged: (v) => setState(() => _query = v),
            style: manrope(13, FontWeight.w500, EhbrColors.ink),
            cursorColor: EhbrColors.brand,
            decoration: InputDecoration(
              hintText: 'Search announcements',
              hintStyle: manrope(13, FontWeight.w500, EhbrColors.muted),
              prefixIcon: const Icon(Icons.search, color: EhbrColors.muted, size: 20),
              filled: true,
              fillColor: Colors.white,
              contentPadding: const EdgeInsets.symmetric(vertical: 13),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _nBorder),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _nBorder),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: EhbrColors.brand, width: 1.4),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Category filters.
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final c in chips) ...[
                  _FilterChip(label: c.$1, selected: _filter == c.$2, onTap: () => setState(() => _filter = c.$2)),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
          const SizedBox(height: 20),

          if (widget.items.isEmpty)
            const EmptyState(
              icon: Icons.campaign_outlined,
              title: 'No announcements yet',
              message: 'When the barangay posts an alert, advisory or event it will appear here.',
            )
          else if (visible.isEmpty)
            const EmptyState(title: 'No announcements match your search')
          else ...[
            if (alerts.isNotEmpty) ...[
              Text('Alerts & Advisories', style: manrope(16, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 12),
              for (final a in alerts) _NewsCard(a, onTap: () => widget.onOpen(a)),
            ],
            if (community.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text('Community Updates', style: manrope(16, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 12),
              for (final a in community) _NewsCard(a, onTap: () => widget.onOpen(a)),
            ],
            const SizedBox(height: 14),
            Center(
              child: Text('You’re up to date with barangay notices.',
                  style: manrope(12, FontWeight.w600, EhbrColors.muted)),
            ),
          ],
        ],
      ),
    );
  }
}

/// Category label: a soft tint with coloured text. The only colour on a news card.
class _CategoryLabel extends StatelessWidget {
  const _CategoryLabel(this.category);
  final String category;

  @override
  Widget build(BuildContext context) {
    final color = categoryColor(category);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .1), borderRadius: BorderRadius.circular(6)),
      child: Text(categoryTag(category), style: manrope(10, FontWeight.w700, color)),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          height: 32,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? _nRedTint : Colors.white,
            border: Border.all(color: selected ? _nRed : _nBorder, width: selected ? 1.4 : 1),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            label,
            style: manrope(11, selected ? FontWeight.w700 : FontWeight.w500, selected ? _nRed : EhbrColors.ink),
          ),
        ),
      ),
    );
  }
}

class _NewsCard extends StatelessWidget {
  const _NewsCard(this.a, {required this.onTap});
  final Announcement a;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: _nBorder),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _CategoryLabel(a.category),
                    const Spacer(),
                    Text(ago(a.createdAt), style: manrope(11, FontWeight.w500, EhbrColors.muted)),
                  ],
                ),
                const SizedBox(height: 10),
                Text(a.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: manrope(14, FontWeight.w700, EhbrColors.ink)),
                const SizedBox(height: 4),
                Text(a.body,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: manrope(12, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.45)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Article extends StatelessWidget {
  const _Article({required this.a, required this.onBack});
  final Announcement a;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
      children: [
        Row(
          children: [
            GestureDetector(
              onTap: onBack,
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(color: EhbrColors.ink, shape: BoxShape.circle),
                child: const Icon(Icons.chevron_left, color: Colors.white, size: 18),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: onBack,
              child: Text('Back to News', style: manrope(14, FontWeight.w600, EhbrColors.ink)),
            ),
            const Spacer(),
            _CategoryLabel(a.category),
          ],
        ),
        const SizedBox(height: 20),
        Text(stamp(a.createdAt), style: manrope(11, FontWeight.w500, EhbrColors.muted)),
        const SizedBox(height: 8),
        Text(a.title, style: manrope(20, FontWeight.w800, EhbrColors.ink).copyWith(height: 26 / 20)),
        const SizedBox(height: 14),
        const Divider(height: 1, thickness: 1, color: _nBorder),
        const SizedBox(height: 14),
        Text(a.body, style: manrope(13, FontWeight.w400, EhbrColors.ink).copyWith(height: 20 / 13)),
      ],
    );
  }
}