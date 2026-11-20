import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

// Red highlight behind the active tab (same red as the SOS button).
const Color _navActive = EhbrColors.sos;

/// Floating white bottom navigation.
///
/// The active tab looks the same on every tab (filled icon, bold label, lime pill),
/// and inactive tabs are muted grey.
///
/// While the on-screen keyboard is open the bar hides itself, so it never floats
/// above the keyboard no matter which screen or Scaffold it is placed in.
class EhbrBottomNav extends StatefulWidget {
  const EhbrBottomNav({
    super.key,
    this.index = 0,
    this.onTap,
    this.activeColor = EhbrColors.brandLight,
  });

  final int index;
  final ValueChanged<int>? onTap;

  /// Kept so existing callers still compile. It is ignored: the active tab
  /// always uses the lime pill with a black icon.
  final Color activeColor;

  // (outlined icon, filled icon used when selected, label)
  static const _items = <(IconData, IconData, String)>[
    (Icons.home_outlined, Icons.home_rounded, 'Home'),
    (Icons.map_outlined, Icons.map_rounded, 'Map'),
    (Icons.phone_outlined, Icons.phone_rounded, 'Contacts'),
    (Icons.newspaper_outlined, Icons.newspaper_rounded, 'News'),
    (Icons.account_circle_outlined, Icons.account_circle_rounded, 'Profile'),
  ];

  @override
  State<EhbrBottomNav> createState() => _EhbrBottomNavState();
}

class _EhbrBottomNavState extends State<EhbrBottomNav>
    with WidgetsBindingObserver {
  bool _insetOpen = false; // window reports a keyboard
  bool _typing = false; // a text field has focus

  bool get _keyboardOpen => _insetOpen || _typing;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_onFocusChanged);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_onFocusChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Some platforms (e.g. Flutter web on a phone) resize the window for the
  // keyboard without reporting insets, so also treat "a text field is focused"
  // as "keyboard is open".
  void _onFocusChanged() {
    final ctx = FocusManager.instance.primaryFocus?.context;
    final typing = ctx != null &&
        (ctx.widget is EditableText ||
            ctx.findAncestorWidgetOfExactType<EditableText>() != null);
    if (mounted && typing != _typing) setState(() => _typing = typing);
  }

  // Read from the window itself (not MediaQuery) so a parent Scaffold that
  // already resized for the keyboard cannot hide the keyboard from us.
  @override
  void didChangeMetrics() {
    if (!mounted) return;
    final open = View.of(context).viewInsets.bottom > 0;
    if (open != _insetOpen) setState(() => _insetOpen = open);
  }

  @override
  Widget build(BuildContext context) {
    if (_keyboardOpen) return const SizedBox.shrink();

    return Container(
      height: 62,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE2E4EA)),
        boxShadow: const [
          BoxShadow(color: Color(0x1A000000), blurRadius: 18, offset: Offset(0, 4)),
        ],
      ),
      child: Row(
        children: [
          for (var i = 0; i < EhbrBottomNav._items.length; i++)
            Expanded(
              child: _NavItem(
                icon: i == widget.index
                    ? EhbrBottomNav._items[i].$2
                    : EhbrBottomNav._items[i].$1,
                label: EhbrBottomNav._items[i].$3,
                selected: i == widget.index,
                onTap: () {
                  HapticFeedback.selectionClick();
                  widget.onTap?.call(i);
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final iconColor = selected ? Colors.white : EhbrColors.muted;
    final color = selected ? EhbrColors.ink : EhbrColors.muted;

    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              width: 46,
              height: 28,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected ? _navActive : Colors.transparent,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, size: 22, color: iconColor),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              maxLines: 1,
              style: manrope(11, selected ? FontWeight.w700 : FontWeight.w500, color),
            ),
          ],
        ),
      ),
    );
  }
}
