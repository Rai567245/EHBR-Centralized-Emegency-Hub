import 'dart:async';

import 'package:flutter/material.dart';

import '../services/api.dart';
import '../services/push.dart';
import '../services/report_queue.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/bottom_nav.dart';
import '../widgets/top_bar.dart';
import 'contacts_screen.dart';
import 'home_screen.dart';
import 'map_screen.dart';
import 'news_screen.dart';
import 'notifications_screen.dart';
import 'profile_screen.dart';
import 'report_screen.dart';

/// Top bar + floating bottom nav around the five tabs.
/// A tab refreshes its data quietly every time you switch back to it.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell>
    with WidgetsBindingObserver {
  int _tab = 0;
  int _unread = 0;
  int _reportsRequest = 0;

  Timer? _poll;
  Timer? _flushTimer;

  final List<int> _tokens = [0, 0, 0, 0, 0];

  /// Raised to restart a tab: when you tap the tab you are already on, and
  /// when you leave Profile. A new number gives that tab a fresh state
  /// (filters cleared, sub-pages closed, scrolled to the top).
  final List<int> _resets = [0, 0, 0, 0, 0];

  bool _reporting = false;
  String? _reportType;

  /// Keyboard state. Read straight from the window (not MediaQuery), and also
  /// inferred from "a text field has focus" for platforms such as Flutter web
  /// that resize the page without reporting a keyboard height.
  bool _insetOpen = false;
  bool _typing = false;

  /// What the nav bar actually follows. It hides the moment the keyboard
  /// opens, but only comes back once the keyboard has finished sliding away,
  /// so the bar never appears mid-animation and visibly drops down.
  bool _kbOpen = false;
  Timer? _kbTimer;

  void _syncKeyboard() {
    // The bar hides when the window reports a keyboard, or while a text field
    // has focus on the Create a Report form. Search boxes on Contacts / News
    // keep the nav bar visible at the bottom.
    final open = _insetOpen || (_typing && _tab == 0 && _reporting);
    if (open) {
      _kbTimer?.cancel();
      if (!_kbOpen) setState(() => _kbOpen = true);
    } else if (_kbOpen && !(_kbTimer?.isActive ?? false)) {
      _kbTimer = Timer(const Duration(milliseconds: 350), () {
        if (mounted && !(_insetOpen || (_typing && _tab == 0 && _reporting))) {
          setState(() => _kbOpen = false);
        }
      });
    }
  }

  @override
  void initState() {
    super.initState();

    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_onFocusChanged);

    ReportQueue.load().then((_) => _flushQueue());

    _refreshUnread();

    _poll = Timer.periodic(
      const Duration(seconds: 45),
      (_) => _refreshUnread(),
    );

    // Saved (offline) reports go out as soon as there is a connection again.
    _flushTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => _flushQueue(),
    );

    Push.start(
      onForeground: _onPush,
      onOpened: _openNotifications,
    );
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_onFocusChanged);
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _flushTimer?.cancel();
    _kbTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    final open = View.of(context).viewInsets.bottom > 0;
    if (open != _insetOpen && mounted) {
      _insetOpen = open;
      _syncKeyboard();
    }
  }

  void _onFocusChanged() {
    final ctx = FocusManager.instance.primaryFocus?.context;
    final typing = ctx != null &&
        (ctx.widget is EditableText ||
            ctx.findAncestorWidgetOfExactType<EditableText>() != null);
    if (mounted && typing != _typing) {
      _typing = typing;
      _syncKeyboard();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _flushQueue();
      _refreshUnread();

      setState(() => _tokens[_tab]++);
    }
  }

  Future<void> _flushQueue() async {
    final sent = await ReportQueue.flush();

    if (sent.isEmpty || !mounted) return;

    setState(() {
      for (var i = 0; i < _tokens.length; i++) {
        _tokens[i]++;
      }
    });

    _refreshUnread();

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            sent.length == 1
                ? 'Your saved report ${sent.first.id} was sent to the barangay.'
                : '${sent.length} saved reports were sent to the barangay.',
          ),
          duration: const Duration(seconds: 6),
        ),
      );
  }

  Future<void> _refreshUnread() async {
    try {
      final feed = await Api.notifications();

      if (mounted && feed.unread != _unread) {
        setState(() => _unread = feed.unread);
      }
    } catch (_) {
      // Offline – keep the last number.
    }
  }

  /// A push arrived while the app is open.
  void _onPush(String title, String body) {
    if (!mounted) return;

    _refreshUnread();

    setState(() {
      for (var i = 0; i < _tokens.length; i++) {
        _tokens[i]++;
      }
    });

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            body.isEmpty ? title : '$title – $body',
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
          duration: const Duration(seconds: 6),
          action: SnackBarAction(
            label: 'View',
            onPressed: _openNotifications,
          ),
        ),
      );
  }

  Future<void> _openNotifications() async {
    if (!mounted) return;

    final tab = await Navigator.of(context).push<int>(
      MaterialPageRoute(
        builder: (_) => const NotificationsScreen(),
      ),
    );

    if (!mounted) return;

    setState(() => _unread = 0);

    if (tab != null) {
      _select(tab);
    }
  }

  void _select(int i) {
    setState(() {
      if (i == _tab) {
        // Tapping the tab you are already on starts it over (filters cleared,
        // back to the top). Not Home while a report is being written, so a
        // stray tap can never lose it.
        if (!(i == 0 && _reporting)) _resets[i]++;
      } else if (_tab == 4) {
        // Leaving Profile closes any page inside it, such as My Reports.
        _resets[4]++;
      }

      if (i != _tab || _reporting) {
        _tokens[i]++;
      }

      _tab = i;

      if (i != 0) {
        _reporting = false;
      }
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _syncKeyboard();
    });
  }

  List<Widget> get _pages => [
        _reporting
            ? ReportScreen(
                key: ValueKey(_reportType),
                initialType: _reportType,
                onBack: () => setState(() => _reporting = false),
                onSubmitted: () => setState(() {
                  _tokens[0]++;
                  _tokens[4]++;
                }),
                onViewReports: () {
                  setState(() => _reportsRequest++);
                  _select(4);
                },
              )
            : HomeScreen(
                reloadToken: _tokens[0],
                onReport: (type) => setState(() {
                  _reporting = true;
                  _reportType = type;
                }),
                onOpenNews: () => _select(3),
              ),
        MapScreen(reloadToken: _tokens[1]),
        ContactsScreen(reloadToken: _tokens[2]),
        NewsTab(reloadToken: _tokens[3]),
        ProfileTab(
          reloadToken: _tokens[4],
          openReportsRequest: _reportsRequest,
        ),
      ];

  @override
  Widget build(BuildContext context) {
    final onHome = _tab == 0 && !_reporting;
    final pages = _pages;

    // Keyboard height. The Scaffold does NOT resize (so the floating nav bar
    // stays at the bottom and the keyboard simply covers it); instead the
    // tab content is shortened by the keyboard height below.
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;

    return Scaffold(
      backgroundColor: Colors.white,
      resizeToAvoidBottomInset: false,
      body: Stack(
        children: [
          Column(
            children: [
              // Shared header displayed on every tab, including Home.
              SafeArea(
                bottom: false,
                child: EhbrTopBar(
                  subtitle: Session.config.locationLine,
                  accent: onHome
                      ? EhbrColors.brand
                      : EhbrColors.muted,
                  unread: _unread,
                  onBell: _openNotifications,
                ),
              ),

              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(bottom: keyboard),
                  // The shell already made room for the keyboard, so tabs
                  // must not subtract it a second time.
                  child: MediaQuery.removeViewInsets(
                    context: context,
                    removeBottom: true,
                    child: IndexedStack(
                      index: _tab,
                      children: [
                        for (var i = 0; i < pages.length; i++)
                          KeyedSubtree(
                            key: ValueKey('tab$i-${_resets[i]}'),
                            child: pages[i],
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),

          // Bottom navigation (and its fade) are hidden while typing.
          if (!_kbOpen) ...[
          // Bottom navigation background gradient.
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 130,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.white.withValues(alpha: 0),
                      Colors.white,
                    ],
                    stops: const [0, .5],
                  ),
                ),
              ),
            ),
          ),

          // Floating bottom navigation.
          Positioned(
            left: 16,
            right: 16,
            bottom: 0,
            child: SafeArea(
              top: false,
              minimum: const EdgeInsets.only(bottom: 27),
              child: EhbrBottomNav(
                index: _tab,
                activeColor: onHome
                    ? EhbrColors.brandLight
                    : EhbrColors.muted,
                onTap: _select,
              ),
            ),
          ),
          ],
        ],
      ),
    );
  }
}