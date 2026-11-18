import 'package:flutter/material.dart';

import '../theme.dart';

// Shared design tokens (same values as the other restyled screens).
const Color _ehbrRed = Color(0xFFC7193D);
const Color _cBorder = Color(0xFFE2E4EA);
const Color _cSurface = Color(0xFFF3F4F8);

/// Temporary red approximation of the EHBR emblem.
/// Replace with the official SVG or PNG asset for an exact match.
class EhbrEmblem extends StatelessWidget {
  const EhbrEmblem({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/ehbr_logo.png',
      width: size,
      height: size,
      fit: BoxFit.contain,
      errorBuilder: (context, error, stackTrace) {
        return Icon(
          Icons.broken_image_outlined,
          size: size,
          color: Colors.red,
        );
      },
    );
  }
}

/// Light, bordered input used on the login and sign-up screens.
///
/// The name `darkDecoration` is kept so existing screens still compile,
/// but the look is now white with a thin border and a red focus border.
InputDecoration darkDecoration({
  required String hint,
  IconData? icon,
  Widget? suffix,
}) {
  OutlineInputBorder border(Color color, [double width = 1]) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide(color: color, width: width),
    );
  }

  return InputDecoration(
    filled: true,
    fillColor: Colors.white,
    hintText: hint,
    hintStyle: manrope(
      13,
      FontWeight.w400,
      EhbrColors.muted,
    ),
    prefixIcon: icon == null
        ? null
        : Icon(
            icon,
            color: EhbrColors.muted,
            size: 20,
          ),
    suffixIcon: suffix,
    contentPadding: const EdgeInsets.symmetric(
      horizontal: 14,
      vertical: 14,
    ),
    errorStyle: manrope(
      11,
      FontWeight.w600,
      _ehbrRed,
    ),
    border: border(_cBorder),
    enabledBorder: border(_cBorder),
    focusedBorder: border(_ehbrRed, 1.4),
    errorBorder: border(_ehbrRed),
    focusedErrorBorder: border(_ehbrRed, 1.4),
  );
}

/// Input text style to pair with [darkDecoration] (now dark text on white).
TextStyle get darkInputStyle =>
    manrope(13, FontWeight.w500, EhbrColors.ink);

/// Label displayed above an input field.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text,
        style: manrope(
          13,
          FontWeight.w700,
          EhbrColors.ink,
        ),
      ),
    );
  }
}

/// Reusable primary action button (red by default).
/// Disabled is soft grey; busy stays red with a white spinner.
class AuthButton extends StatelessWidget {
  const AuthButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
    this.color = _ehbrRed,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;

    return Material(
      color: busy
          ? color.withValues(alpha: .85)
          : enabled
              ? color
              : _cSurface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: enabled ? onPressed : null,
        child: SizedBox(
          height: 50,
          width: double.infinity,
          child: Center(
            child: busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: Colors.white,
                    ),
                  )
                : Text(
                    label,
                    textAlign: TextAlign.center,
                    style: manrope(
                      15,
                      FontWeight.w700,
                      enabled ? Colors.white : EhbrColors.muted,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

/// Red inline error message for forms.
class FormError extends StatelessWidget {
  const FormError(this.message, {super.key});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return message == null
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 1),
                  child: Icon(
                    Icons.error_outline,
                    size: 16,
                    color: _ehbrRed,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    message!,
                    style: manrope(
                      12,
                      FontWeight.w600,
                      _ehbrRed,
                    ),
                  ),
                ),
              ],
            ),
          );
  }
}

/// Square checkbox with a label. Checked state is red.
class SquareCheck extends StatelessWidget {
  const SquareCheck({
    super.key,
    required this.value,
    required this.onChanged,
    required this.label,
  });

  final bool value;
  final ValueChanged<bool> onChanged;
  final Widget label;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onChanged(!value),
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: Checkbox(
                value: value,
                onChanged: (v) => onChanged(v ?? false),
                activeColor: _ehbrRed,
                checkColor: Colors.white,
                side: const BorderSide(
                  color: EhbrColors.muted,
                  width: 1.5,
                ),
                materialTapTargetSize:
                    MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(5),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Flexible(child: label),
          ],
        ),
      ),
    );
  }
}