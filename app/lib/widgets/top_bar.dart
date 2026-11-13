
import 'package:flutter/material.dart';

import '../theme.dart';

const Color _ehbrLogoRed = Color(0xFFC7193D);

class EhbrTopBar extends StatelessWidget {
  const EhbrTopBar({
    super.key,
    this.subtitle = '',
    this.accent = _ehbrLogoRed,
    this.unread = 0,
    this.onBell,
  });

  final String subtitle;
  final Color accent;
  final int unread;
  final VoidCallback? onBell;

  @override
  Widget build(BuildContext context) {
    final location = subtitle.trim().isNotEmpty
        ? subtitle.trim()
        : 'Barangay Rizal, Taguig';

    return Container(
      height: 64,
      color: EhbrColors.ink,
      padding: const EdgeInsets.only(left: 16, right: 6),
      child: Row(
        children: [
          // EHBR logo
          SizedBox(
            width: 40,
            height: 40,
            child: Image.asset(
              'assets/images/ehbr_logo.png',
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) {
                debugPrint('EHBR logo loading error: $error');

                return const Icon(
                  Icons.broken_image_outlined,
                  color: Colors.white,
                  size: 24,
                );
              },
            ),
          ),

          const SizedBox(width: 8),

          // Barangay location and application name
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  location,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: manrope(
                    11,
                    FontWeight.w400,
                    Colors.white,
                  ),
                ),

                const SizedBox(height: 3),

                Text(
                  'Emergency Hub',
                  style: manrope(
                    16,
                    FontWeight.w800,
                    _ehbrLogoRed,
                  ),
                ),
              ],
            ),
          ),

          // Notifications
          if (onBell != null)
            Stack(
              clipBehavior: Clip.none,
              children: [
                IconButton(
                  tooltip: 'Notifications',
                  onPressed: onBell,
                  icon: const Icon(
                    Icons.notifications_none_rounded,
                    color: Colors.white,
                    size: 26,
                  ),
                ),

                // Unread notification badge
                if (unread > 0)
                  Positioned(
                    right: 6,
                    top: 6,
                    child: IgnorePointer(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 1,
                        ),
                        constraints: const BoxConstraints(
                          minWidth: 16,
                        ),
                        decoration: BoxDecoration(
                          color: EhbrColors.sos,
                          borderRadius: BorderRadius.circular(99),
                          border: Border.all(
                            color: EhbrColors.ink,
                            width: 1.5,
                          ),
                        ),
                        child: Text(
                          unread > 9 ? '9+' : '$unread',
                          textAlign: TextAlign.center,
                          style: manrope(
                            9,
                            FontWeight.w800,
                            Colors.white,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
