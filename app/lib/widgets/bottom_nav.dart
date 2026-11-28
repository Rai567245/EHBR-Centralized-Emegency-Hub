import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

// Active tab: brand red icon and label on a pale red pill (same red tint as
// the selected filter chips on the Map screen).
const Color _navActive = EhbrColors.brand;
const Color _navActiveTint = Color(0x1FC41E3A); // brand at 12%

/// Floating white bottom navigation.
///
/// Every tab looks the same when active (filled icon, bold label, pale red
/// pill) and muted grey with an outline icon when not.
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
  /// always uses the brand red.
  final Color activeColor;

  // (outlined icon, filled icon used when selected, label)
  static const _items = <(IconData, IconData, String)>[
    (Icons.home_outlined, Icons.home_rounded, 'Home'),
    (Icons.map_outlined, Icons.map_rounded, 'Map'),
    (Icons.support_agent_outlined, Icons.support_agent_rounded, 'Contacts'),
    (Icons.newspaper_outlined, Icons.newspaper_rounded, 'News'),
    (Icons.person_outline_rounded, Icons.person_rounded, 'Profile'),
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
      height: 64,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: const Color(0xFFE8EAEF)),
        boxShadow: const [
          BoxShadow(color: Color(0x14101828), blurRadius: 16, offset: Offset(0, 4)),
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
    final color = selected ? _navActive : EhbrColors.muted;

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
            // Pale pill that widens behind the active icon.
            AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              width: selected ? 56 : 32,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected ? _navActiveTint : Colors.transparent,
                borderRadius: BorderRadius.circular(15),
              ),
              // Outline -> filled swap with a small pop.
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 180),
                switchInCurve: Curves.easeOutBack,
                transitionBuilder: (child, anim) =>
                    ScaleTransition(scale: anim, child: child),
                child: Icon(
                  icon,
                  key: ValueKey(selected),
                  size: 24,
                  color: color,
                ),
              ),
            ),
            const SizedBox(height: 2),
            AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 180),
              style: manrope(
                10.5,
                selected ? FontWeight.w800 : FontWeight.w600,
                color,
              ),
              child: Text(label, maxLines: 1),
            ),
          ],
        ),
      ),
    );
  }
}
