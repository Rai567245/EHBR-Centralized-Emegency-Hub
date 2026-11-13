import 'package:flutter/material.dart';

import '../theme.dart';

const Color _zRed = Color(0xFFC7193D);
const Color _zBorder = Color(0xFFE2E4EA);
const Color _zSurface = Color(0xFFF3F4F8);

/// A form field that looks like the other text inputs but opens a bottom sheet
/// of options instead of the native dropdown popup (which floats over the
/// field, hides its label and gives no clear "selected" state).
///
/// Drop-in replacement for `DropdownButtonFormField<String>`:
///
/// ```dart
/// SelectSheetField(
///   value: _zone,
///   options: zoneOptions,
///   hint: 'Select zone',
///   sheetTitle: 'Select zone / purok',
///   icon: Icons.map_outlined,
///   onChanged: (v) => setState(() => _zone = v),
///   validator: (v) => v == null ? 'Select your zone' : null,
/// )
/// ```
class SelectSheetField extends StatelessWidget {
  const SelectSheetField({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    required this.hint,
    required this.sheetTitle,
    this.icon,
    this.validator,
  });

  final String? value;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final String hint;
  final String sheetTitle;
  final IconData? icon;
  final FormFieldValidator<String>? validator;

  Future<void> _open(BuildContext context, FormFieldState<String> field) async {
    FocusScope.of(context).unfocus();
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _OptionsSheet(
        title: sheetTitle,
        options: options,
        selected: value,
      ),
    );
    if (picked != null) {
      field.didChange(picked);
      onChanged(picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Keyed by value so the field re-syncs when the parent changes it
    // (e.g. after a save resets the form).
    return FormField<String>(
      key: ValueKey(value),
      initialValue: value,
      validator: validator,
      builder: (field) {
        final hasError = field.hasError;
        final borderColor = hasError ? _zRed : _zBorder;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              button: true,
              label: value == null ? hint : '$sheetTitle: $value',
              child: Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => _open(context, field),
                  child: Ink(
                    height: 50,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    decoration: BoxDecoration(
                      border: Border.all(color: borderColor),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        if (icon != null) ...[
                          Icon(icon, color: EhbrColors.muted, size: 20),
                          const SizedBox(width: 10),
                        ],
                        Expanded(
                          child: Text(
                            value ?? hint,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: value == null
                                ? manrope(13, FontWeight.w400, EhbrColors.muted)
                                : manrope(13, FontWeight.w500, EhbrColors.ink),
                          ),
                        ),
                        const Icon(
                          Icons.keyboard_arrow_down_rounded,
                          color: EhbrColors.muted,
                          size: 22,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            if (hasError)
              Padding(
                padding: const EdgeInsets.only(top: 6, left: 12),
                child: Text(
                  field.errorText!,
                  style: manrope(11, FontWeight.w600, _zRed),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _OptionsSheet extends StatelessWidget {
  const _OptionsSheet({
    required this.title,
    required this.options,
    required this.selected,
  });

  final String title;
  final List<String> options;
  final String? selected;

  @override
  Widget build(BuildContext context) {
    final maxHeight = MediaQuery.sizeOf(context).height * 0.6;

    return Container(
      constraints: BoxConstraints(maxHeight: maxHeight),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 10),
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: _zBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: manrope(16, FontWeight.w800, EhbrColors.ink),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded,
                        color: EhbrColors.muted, size: 22),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: _zBorder),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                itemCount: options.length,
                separatorBuilder: (_, __) => const SizedBox(height: 4),
                itemBuilder: (context, i) {
                  final option = options[i];
                  final isSelected = option == selected;
                  return Material(
                    color: isSelected
                        ? _zRed.withValues(alpha: .08)
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(12),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      splashColor: _zSurface,
                      highlightColor: _zSurface,
                      onTap: () => Navigator.pop(context, option),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 14),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                option,
                                style: manrope(
                                  14,
                                  isSelected ? FontWeight.w700 : FontWeight.w500,
                                  isSelected ? _zRed : EhbrColors.ink,
                                ),
                              ),
                            ),
                            if (isSelected)
                              const Icon(Icons.check_rounded,
                                  color: _zRed, size: 20),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}