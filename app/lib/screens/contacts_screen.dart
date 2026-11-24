import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../phone.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/async_body.dart';

// Same neutral surface colours as the Home, Map and Create a Report screens.
const Color _cBorder = Color(0xFFE2E4EA);
const Color _cSurface = Color(0xFFF3F4F8);

// Every icon on this screen uses this one neutral colour.
const Color _cIcon = EhbrColors.brand;

// Content height every contact card is at least (card = this + 24 padding). Fits name + number + 2-line description.
const double _cardMinHeight = 72;

class _Item {
  const _Item(this.name, this.number, this.subtitle, this.icon, this.group);
  final String name, number, subtitle, group;
  final IconData icon;
}

class _Cat {
  const _Cat(this.group, this.subtitle, this.icon);
  final String group, subtitle;
  final IconData icon;
}

/// Categories an admin can pick in Settings → Emergency contacts, in the order they are listed here.
/// Keep the keys in sync with CATS in the admin console (pages/settings.js) and CONTACT_CATEGORIES in server.js.
/// A contact with a category not listed here is shown under 'other' instead of disappearing.
const Map<String, _Cat> _cats = {
  'local': _Cat('Local Emergency Contacts', 'Local emergency contact', Icons.local_phone_outlined),
  'police': _Cat('Police Contacts', 'Police', Icons.local_police_outlined),
  'fire': _Cat('Fire Contacts', 'Fire protection', Icons.local_fire_department_outlined),
  'medical': _Cat('Medical & Ambulance Contacts', 'Medical / ambulance', Icons.medical_services_outlined),
  'barangay': _Cat('Barangay Contacts', 'Barangay office', Icons.account_balance_outlined),
  'disaster': _Cat('Disaster Response (DRRMO)', 'Disaster response', Icons.warning_amber_rounded),
  'utility': _Cat('Utility & Disaster Desk Contacts', 'Utility / disaster desk', Icons.build_circle_outlined),
  'other': _Cat('Other Contacts', 'Emergency contact', Icons.phone_outlined),
};

/// Numbers come from the admin console (Settings → Emergency contacts).
/// Search and Favorites (stars) are kept on the phone.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key, required this.reloadToken});
  final int reloadToken;

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  static const _favKey = 'favorite_contacts';
  final _q = TextEditingController();
  Set<String> _favs = {};

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      if (mounted) setState(() => _favs = (p.getStringList(_favKey) ?? []).toSet());
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _toggle(String number) async {
    setState(() => _favs.contains(number) ? _favs.remove(number) : _favs.add(number));
    try {
      (await SharedPreferences.getInstance()).setStringList(_favKey, _favs.toList());
    } catch (_) {}
  }

  List<_Item> _items() {
    final cfg = Session.config;
    return [
      _Item('National Emergency Hotline', cfg.sosNumber, 'Same number the SOS button dials', Icons.notifications_none_rounded, 'National Emergency Contact'),
      if (cfg.hotline.isNotEmpty)
        _Item('Barangay hotline', cfg.hotline, cfg.locationLine.isEmpty ? 'Barangay office' : cfg.locationLine, Icons.account_balance_outlined, 'Local Emergency Contacts'),
      for (final e in _cats.entries)
        for (final c in cfg.contacts.where((c) => (_cats.containsKey(c.category) ? c.category : 'other') == e.key))
          _Item(c.name, c.number, e.value.subtitle, e.value.icon, e.value.group),
    ];
  }

  Widget _row(_Item i) => _ContactRow(
        item: i,
        favorite: _favs.contains(i.number),
        onFavorite: () => _toggle(i.number),
        onOpen: () => showContactDetails(
          context,
          name: i.name,
          number: i.number,
          category: i.group,
          detail: i.subtitle,
          favorite: _favs.contains(i.number),
          onToggleFavorite: () => _toggle(i.number),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return AsyncBody<bool>(
      load: () async {
        await Session.loadConfig();
        return true;
      },
      reloadToken: widget.reloadToken,
      builder: (context, _, refresh) {
        final all = _items();
        final term = _q.text.trim().toLowerCase();
        final shown = term.isEmpty
            ? all
            : all.where((i) => i.name.toLowerCase().contains(term) || i.number.contains(term) || i.subtitle.toLowerCase().contains(term)).toList();
        final favs = shown.where((i) => _favs.contains(i.number)).toList();
        final groups = <String>[];
        for (final i in shown) {
          if (!groups.contains(i.group)) groups.add(i.group);
        }
        return RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
            children: [
              TextField(
                controller: _q,
                onChanged: (_) => setState(() {}),
                style: manrope(13, FontWeight.w500, EhbrColors.ink),
                cursorColor: EhbrColors.brand,
                decoration: InputDecoration(
                  hintText: 'Search contacts',
                  hintStyle: manrope(13, FontWeight.w500, EhbrColors.muted),
                  prefixIcon: const Icon(Icons.search, color: EhbrColors.muted, size: 20),
                  suffixIcon: term.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear',
                          icon: const Icon(Icons.close, color: EhbrColors.muted, size: 20),
                          onPressed: () => setState(_q.clear),
                        ),
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.symmetric(vertical: 14),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: _cBorder),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: _cBorder),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: EhbrColors.brand, width: 1.4),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              if (favs.isNotEmpty) ...[
                const _Heading('Favorites'),
                for (final i in favs) _row(i),
                const SizedBox(height: 14),
              ],
              for (final g in groups) ...[
                _Heading(g),
                for (final i in shown.where((i) => i.group == g)) _row(i),
                const SizedBox(height: 14),
              ],
              if (shown.isEmpty)
                EmptyState(
                  icon: Icons.search_off_rounded,
                  title: term.isEmpty ? 'No local contacts yet' : 'No contacts found',
                  message: term.isEmpty
                      ? 'Your barangay will add police, fire, medical and utility numbers here.'
                      : 'Nothing matches “${_q.text.trim()}”. Try a different name or number.',
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text(text, style: manrope(16, FontWeight.w800, EhbrColors.ink)),
      );
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({required this.item, required this.favorite, required this.onFavorite, required this.onOpen});
  final _Item item;
  final bool favorite;
  final VoidCallback onFavorite, onOpen;

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
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 6, 12),
            // Every card has the same minimum height, so one- and two-line descriptions line up.
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: _cardMinHeight),
              child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: _cSurface,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(item.icon, size: 20, color: _cIcon),
                ),
                const SizedBox(width: 12),
                // Name, number and description each get their own line, so nothing is cut off mid-sentence.
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: manrope(13, FontWeight.w700, EhbrColors.ink),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.number,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: manrope(12, FontWeight.w600, EhbrColors.ink),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: manrope(11, FontWeight.w500, EhbrColors.muted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  tooltip: favorite ? 'Remove from favorites' : 'Add to favorites',
                  onPressed: onFavorite,
                  icon: Icon(
                    favorite ? Icons.star_rounded : Icons.star_border_rounded,
                    color: favorite ? _cIcon : EhbrColors.muted,
                  ),
                ),
                Material(
                  color: EhbrColors.brand,
                  borderRadius: BorderRadius.circular(10),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => confirmCall(context, item.name, item.number),
                    child: SizedBox(
                      width: 64,
                      height: 36,
                      child: Center(child: Text('CALL', style: manrope(12, FontWeight.w700, Colors.white))),
                    ),
                  ),
                ),
              ],
            ),
            ),
          ),
        ),
      ),
    );
  }
}
