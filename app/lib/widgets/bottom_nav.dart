import 'package:flutter/material.dart';

import '../theme.dart';

/// Floating bottom navigation.
///
/// The active tab looks the same on every tab (filled icon, bold label, soft pill),
/// and inactive tabs are slightly dimmed white. Before, a tab could be drawn in grey
/// when active, which made it look dimmer than the inactive ones.
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

  /// Kept so existing callers still compile. The active colour is now fixed
  /// (see [_active]) so it never changes between tabs.
  final Color activeColor;

  static const Color _active = EhbrColors.brandLight;

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
      height: 58,
      decoration: BoxDecoration(
        color: EhbrColors.ink,
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [
          BoxShadow(color: Color(0x33000000), blurRadius: 14, offset: Offset(0, 4)),
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
                onTap: () => widget.onTap?.call(i),
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
    final color = selected ? EhbrBottomNav._active : Colors.white.withValues(alpha: .7);

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
                color: selected ? EhbrBottomNav._active.withValues(alpha: .16) : Colors.transparent,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, size: 22, color: color),
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