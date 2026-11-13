import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../location.dart';
import '../models/models.dart';
import '../phone.dart';
import '../services/api.dart';
import '../services/report_queue.dart';
import '../services/session.dart';
import '../theme.dart';
import '../util.dart';
import 'queued_reports_screen.dart';
import 'report_result_views.dart';

/// Create a Report. Lives inside the Home tab (top bar + nav stay visible).
class ReportScreen extends StatefulWidget {
  const ReportScreen({
    super.key,
    required this.onBack,
    required this.onSubmitted,
    required this.onViewReports,
    this.initialType,
  });
  final VoidCallback onBack;
  final VoidCallback onSubmitted;
  final VoidCallback onViewReports;
  final String? initialType;
  @override
  State<ReportScreen> createState() => _ReportScreenState();
}
class _ReportScreenState extends State<ReportScreen> {
  static const _urgencies = ['Low', 'Medium', 'High', 'Critical'];
  static const _bg = Color(0xFFF7F8FA);
  static const _border = Color(0xFFD9DCE3);
  static const _red = Color(0xFFD92F32);
  static const _redLight = Color(0xFFFFF0F1);
  final _desc = TextEditingController();
  final List<Uint8List> _photos = [];
  static const _maxPhotos = 3;
  final _where = TextEditingController();
  final DateTime _when = DateTime.now();
  final MenuController _incidentMenuController = MenuController();
  bool _incidentMenuOpen = false;
  String? _type;
  String? _startType; // type the form opened with (from Home), not an edit
  String _urgency = 'Medium';
  bool _hideName = true;
  double? _lat, _lng;
  bool _gpsBusy = false;
  bool _busy = false;
  String? _error;
  Report? _done;
  QueuedReport? _queued;
  @override
  void initState() {
    super.initState();

    if (widget.initialType != null &&
        Session.config.allTypes.contains(widget.initialType)) {
      _type = widget.initialType;
      _startType = _type;
    }
  }

  @override
  void dispose() {
    _desc.dispose();
    _where.dispose();
    super.dispose();
  }
  Future<void> _gps() async {
    if (_gpsBusy || _busy) return;
    setState(() {
      _gpsBusy = true;
      _error = null;
    });
    try {
      final p = await currentLocation();
      if (mounted) {
        setState(() {
          _lat = p.lat;
          _lng = p.lng;
          final c = Session.config;
          final outside = c.hasBorder
              ? !insidePolygon(p.lat, p.lng, c.boundary)
              : (c.radiusKm > 0 &&
                  kmBetween(c.lat, c.lng, p.lat, p.lng) > c.radiusKm);
          if (outside) {
            _error =
                'Your GPS location looks outside ${c.barangayName.isEmpty ? 'the barangay' : 'Barangay ${c.barangayName}'}. '
                'You can still send this report – the barangay will see where you are.';
          }
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _gpsBusy = false);
      }
    }
  }

  Future<void> _submit() async {
    final msg = _type == null
        ? 'Choose the type of incident.'
        : _desc.text.trim().length < 3
            ? 'Describe what happened.'
            : (_where.text.trim().isEmpty && _lat == null)
                ? 'Add where it is – type the address/landmark or use GPS.'
                : null;
    if (msg != null) {
      setState(() => _error = msg);
      return;
    }
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    // clientId lets the server ignore a retry of the same report.

    // reportedAt keeps the real time even if it can only be sent later.

    final payload = <String, dynamic>{
      'type': _type,
      'description': _desc.text.trim(),
      'urgency': _urgency,
      'locationText': _where.text.trim(),
      'lat': _lat,
      'lng': _lng,
      'anonymous': Session.config.allowAnonymous && _hideName,
      if (_photos.isNotEmpty)
        'photos': [for (final b in _photos) base64Encode(b)],
      'clientId': ReportQueue.newClientId(),
      'reportedAt': DateTime.now().toUtc().toIso8601String(),
    };

    try {
      final r = await Api.submitReport(payload);
      if (!mounted) return;
      setState(() => _done = r);
      widget.onSubmitted();
    } on ApiException catch (e) {
      if (e.isUnavailable) {
        // No signal or server unavailable: keep the report on the phone.
        final q = await ReportQueue.enqueue(payload);
        if (!mounted) return;
        setState(() => _queued = q);
        widget.onSubmitted();
      } else if (mounted) {
        setState(() => _error = e.message);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _tryNow() async {
    final sent = await ReportQueue.flush();
    if (!mounted || sent.isNotEmpty) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text('Still no connection – it will send automatically.'),
        ),
      );
  }

  /// True when the person has typed or picked something that would be lost
  /// by leaving: not while submitting, and not once the report is sent/queued.
  bool get _dirty {
    if (_done != null || _queued != null || _busy) return false;
    return _desc.text.trim().isNotEmpty ||
        _where.text.trim().isNotEmpty ||
        _photos.isNotEmpty ||
        _lat != null ||
        _type != _startType ||
        _urgency != 'Medium';
  }

  /// Back to Home, asking first if there is an unfinished report.
  Future<void> _handleBack() async {
    if (_busy) return;
    if (!_dirty) {
      widget.onBack();
      return;
    }
    FocusScope.of(context).unfocus();
    final discard = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _DiscardReportSheet(),
    );
    if (discard == true && mounted) widget.onBack();
  }

  @override
  Widget build(BuildContext context) {
    final cfg = Session.config;

    // When the keyboard is open the floating nav bar stays put underneath it
    // (the shell no longer resizes), so lift the form by the keyboard height
    // instead of reserving space for the nav bar.
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;

    return PopScope(
      canPop: false, // device back goes through _handleBack
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _handleBack();
      },
      child: ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: EdgeInsets.fromLTRB(16, 14, 16, keyboard > 0 ? keyboard + 16 : 110),
      children: [
        // Back navigation and emergency shortcut.

        Row(
          children: [
            GestureDetector(
              onTap: _handleBack,
              child: Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: EhbrColors.ink,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.chevron_left,
                  color: Colors.white,
                  size: 21,
                ),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: _handleBack,
              child: Text(
                'Back to Home',
                style: manrope(
                  14,
                  FontWeight.w600,
                  EhbrColors.ink,
                ),
              ),
            ),
            const Spacer(),
            Material(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              child: InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: () => callNumber(context, cfg.sosNumber),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 11,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    border: Border.all(color: _red, width: 1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.phone_outlined,
                        size: 14,
                        color: _red,
                      ),
                      const SizedBox(width: 5),
                      Text(
                        'In danger? Call SOS',
                        style: manrope(
                          11,
                          FontWeight.w600,
                          _red,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),

        const SizedBox(height: 14),

        if (_done != null)
          ReportSubmittedView(
            report: _done!,
            onBack: widget.onBack,
            onViewReports: widget.onViewReports,
          )
        else if (_queued != null)
          ValueListenableBuilder<int>(
            valueListenable: ReportQueue.changes,
            builder: (context, _, __) {
              final sent = ReportQueue.sent[_queued!.localId];

              if (sent != null) {
                return ReportSubmittedView(
                  report: sent,
                  sentFromQueue: true,
                  onBack: widget.onBack,
                  onViewReports: widget.onViewReports,
                );
              }

              return ReportQueuedView(
                queued: _queued!,
                onBack: widget.onBack,
                onRetry: _tryNow,
                onViewQueued: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const QueuedReportsScreen(),
                  ),
                ),
              );
            },
          )
        else
          _form(cfg),
      ],
      ),
    );
  }

  Future<void> _addPhoto() async {
    if (_photos.length >= _maxPhotos || _busy) return;

    final source = await _pickPhotoSource(context);
    if (source == null || !mounted) return;

    try {
      // Compress images so uploads and offline storage remain manageable.
      final x = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1280,
        maxHeight: 1280,
        imageQuality: 70,
      );
      if (x == null) return;

      final bytes = await x.readAsBytes();
      if (bytes.length > 1400 * 1024) {
        if (mounted) {
          setState(
              () => _error = 'That photo is too large. Try a different one.');
        }
        return;
      }

      if (mounted) {
        setState(() => _photos.add(bytes));
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not open the camera or gallery. Check the app’s permissions in your phone settings.',
        );
      }
    }
  }

  Widget _photoPicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _Label('Photos (optional, up to 3)'),
        if (_photos.isNotEmpty) ...[
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (var i = 0; i < _photos.length; i++)
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.memory(
                        _photos[i],
                        width: 64,
                        height: 64,
                        fit: BoxFit.cover,
                      ),
                    ),
                    Positioned(
                      top: -6,
                      right: -6,
                      child: InkWell(
                        onTap: _busy
                            ? null
                            : () => setState(() => _photos.removeAt(i)),
                        child: const CircleAvatar(
                          radius: 11,
                          backgroundColor: EhbrColors.ink,
                          child: Icon(
                            Icons.close,
                            size: 14,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 8),
        ],
        if (_photos.length < _maxPhotos)
          InkWell(
            onTap: _addPhoto,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              height: 40,
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: _border),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.cloud_upload_outlined,
                    size: 18,
                    color: EhbrColors.ink,
                  ),
                  const SizedBox(width: 10),
                  Text(
                    'Upload contents',
                    style: manrope(
                      11,
                      FontWeight.w500,
                      EhbrColors.ink,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _form(AppConfig cfg) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: _bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Create a Report',
            style: manrope(
              20,
              FontWeight.w800,
              Colors.black,
            ),
          ),

          const SizedBox(height: 4),

          Text(
            'Tell us what happened, where it is, and attach evidence so responders can act faster.',
            style: manrope(
              12,
              FontWeight.w400,
              EhbrColors.muted,
            ),
          ),

          const SizedBox(height: 12),

          // Incident type.

          const _Label('Type of Incident'),

          _Box(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final menuWidth = constraints.maxWidth;

                return MenuAnchor(
                  controller: _incidentMenuController,
                  alignmentOffset: const Offset(0, 8),
                  onOpen: () => setState(() => _incidentMenuOpen = true),
                  onClose: () => setState(() => _incidentMenuOpen = false),
                  style: MenuStyle(
                    backgroundColor:
                        const WidgetStatePropertyAll<Color>(Colors.white),

                    surfaceTintColor:
                        const WidgetStatePropertyAll<Color>(Colors.transparent),

                    shadowColor: WidgetStatePropertyAll<Color>(
                      Colors.black.withValues(alpha: 0.12),
                    ),

                    elevation: const WidgetStatePropertyAll<double>(6),

                    padding: const WidgetStatePropertyAll<EdgeInsets>(
                      EdgeInsets.symmetric(vertical: 5),
                    ),

                    // Force the dropdown menu to match the selection bar width.

                    minimumSize: WidgetStatePropertyAll<Size>(
                      Size(menuWidth, 0),
                    ),

                    maximumSize: WidgetStatePropertyAll<Size>(
                      Size(menuWidth, 300),
                    ),

                    shape: WidgetStatePropertyAll<OutlinedBorder>(
                      RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                        side: const BorderSide(color: _border),
                      ),
                    ),
                  ),
                  menuChildren: [
                    for (final incidentType in cfg.allTypes)
                      MenuItemButton(
                        onPressed: _busy
                            ? null
                            : () => setState(() => _type = incidentType),
                        style: ButtonStyle(
                          minimumSize: const WidgetStatePropertyAll<Size>(
                            Size.fromHeight(42),
                          ),

                          padding: const WidgetStatePropertyAll<EdgeInsets>(
                            EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 10,
                            ),
                          ),

                          foregroundColor: WidgetStatePropertyAll<Color>(
                            incidentType == _type ? _red : EhbrColors.ink,
                          ),

                          // Subtle gray hover and focus effect.

                          backgroundColor:
                              WidgetStateProperty.resolveWith<Color?>(
                            (states) {
                              if (states.contains(WidgetState.hovered) ||
                                  states.contains(WidgetState.focused)) {
                                return const Color(0xFFF2F2F2);
                              }

                              return Colors.white;
                            },
                          ),

                          overlayColor: const WidgetStatePropertyAll<Color>(
                            Colors.transparent,
                          ),
                        ),
                        child: SizedBox(
                          width: menuWidth - 28,
                          child: Text(
                            incidentType,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: manrope(
                              11,
                              incidentType == _type
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                              incidentType == _type ? _red : EhbrColors.ink,
                            ),
                          ),
                        ),
                      ),
                  ],
                  builder: (context, controller, child) {
                    return SizedBox(
                      width: double.infinity,
                      height: 40,
                      child: Material(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(10),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(10),
                          onTap: _busy
                              ? null
                              : () {
                                  if (controller.isOpen) {
                                    controller.close();
                                  } else {
                                    controller.open();
                                  }
                                },
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    _type ?? 'Choose incident type',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: manrope(
                                      11,
                                      FontWeight.w500,
                                      _type == null
                                          ? EhbrColors.muted
                                          : EhbrColors.ink,
                                    ),
                                  ),
                                ),
                                Icon(
                                  _incidentMenuOpen
                                      ? Icons.keyboard_arrow_up_rounded
                                      : Icons.keyboard_arrow_down_rounded,
                                  size: 21,
                                  color: EhbrColors.ink,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),

          const SizedBox(height: 10),

          // Description.

          const _Label('Description'),

          _Box(
            height: 70,
            child: TextField(
              controller: _desc,
              maxLines: 3,
              maxLength: 1000,
              enabled: !_busy,
              buildCounter: (
                _, {
                required currentLength,
                required isFocused,
                maxLength,
              }) =>
                  null,
              style: manrope(
                11,
                FontWeight.w500,
                EhbrColors.ink,
              ),
              decoration: InputDecoration(
                border: InputBorder.none,
                hintText: 'Describe what happened and who is affected...',
                hintStyle: manrope(
                  11,
                  FontWeight.w400,
                  EhbrColors.muted,
                ),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),

          const SizedBox(height: 10),

          // Location.

          const _Label('Location'),

          _Box(
            child: Row(
              children: [
                const Icon(
                  Icons.location_on_outlined,
                  size: 18,
                  color: _red,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _where,
                    enabled: !_busy,
                    maxLength: 200,
                    buildCounter: (
                      _, {
                      required currentLength,
                      required isFocused,
                      maxLength,
                    }) =>
                        null,
                    style: manrope(
                      11,
                      FontWeight.w500,
                      EhbrColors.ink,
                    ),
                    decoration: InputDecoration(
                      border: InputBorder.none,
                      isDense: true,
                      hintText: _lat == null
                          ? 'Use my current location (GPS)'
                          : 'Current GPS location attached',
                      hintStyle: manrope(
                        11,
                        FontWeight.w400,
                        EhbrColors.muted,
                      ),
                    ),
                  ),
                ),
                GestureDetector(
                  onTap: _gpsBusy || _busy ? null : _gps,
                  child: _gpsBusy
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          'Change',
                          style: manrope(
                            12,
                            FontWeight.w600,
                            _red,
                          ),
                        ),
                ),
              ],
            ),
          ),

          if (_lat != null)
            Padding(
              padding: const EdgeInsets.only(top: 6, left: 4),
              child: Text(
                'GPS attached (${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)})',
                style: manrope(
                  10,
                  FontWeight.w600,
                  const Color(0xFF15803D),
                ),
              ),
            ),

          const SizedBox(height: 10),

          // Photo upload.

          _photoPicker(),

          const SizedBox(height: 10),

          // Urgency.

          const _Label('Urgency'),

          Row(
            children: [
              for (final u in _urgencies) ...[
                Expanded(
                  child: GestureDetector(
                    onTap: _busy ? null : () => setState(() => _urgency = u),
                    child: Container(
                      height: 40,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: u == _urgency ? _redLight : Colors.white,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: u == _urgency ? _red : _border,
                          width: u == _urgency ? 1.4 : 1,
                        ),
                      ),
                      child: Text(
                        u,
                        style: manrope(
                          12,
                          u == _urgency ? FontWeight.w700 : FontWeight.w500,
                          u == _urgency ? _red : EhbrColors.ink,
                        ),
                      ),
                    ),
                  ),
                ),
                if (u != _urgencies.last) const SizedBox(width: 8),
              ],
            ],
          ),

          const SizedBox(height: 10),

          // Date and privacy information.

          Row(
            children: [
              Expanded(
                child: _InfoCard(
                  label: 'Date / Time',
                  value: stamp(_when),
                ),
              ),
              if (cfg.allowAnonymous) ...[
                const SizedBox(width: 8),
                Expanded(
                  child: _InfoCard(
                    label: 'Privacy',
                    value: _hideName
                        ? 'Public · name hidden'
                        : 'Name visible to staff',
                    onTap: _busy
                        ? null
                        : () => setState(() => _hideName = !_hideName),
                  ),
                ),
              ],
            ],
          ),

          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(
                _error!,
                style: manrope(
                  12,
                  FontWeight.w600,
                  const Color(0xFFD32F2F),
                ),
              ),
            ),

          const SizedBox(height: 10),

          // Submit.

          Material(
            color: _busy ? _red.withValues(alpha: .7) : _red,
            borderRadius: BorderRadius.circular(10),
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: _busy ? null : _submit,
              child: SizedBox(
                height: 40,
                width: double.infinity,
                child: Center(
                  child: _busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.2,
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          'Submit Report',
                          style: manrope(
                            14,
                            FontWeight.w700,
                            Colors.white,
                          ),
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.label,
    required this.value,
    this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(
            color: const Color(0xFFE0E3E8),
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                color: Color(0xFF667085),
              ),
            ),
            const SizedBox(height: 5),
            Text(
              value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: Color(0xFF202124),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text,
        style: manrope(
          12,
          FontWeight.w700,
          EhbrColors.ink,
        ),
      ),
    );
  }
}

class _Box extends StatelessWidget {
  const _Box({
    required this.child,
    this.height = 40,
  });

  final Widget child;

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      alignment: Alignment.centerLeft,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFE2E4EA)),
      ),
      child: child,
    );
  }
}

// ------------------------------------------------------------

// PHOTO SOURCE PICKER (camera or gallery)

// ------------------------------------------------------------

const Color _photoBorder = Color(0xFFE2E4EA);

const Color _photoSurface = Color(0xFFF3F4F8);

Future<ImageSource?> _pickPhotoSource(BuildContext context) =>
    showModalBottomSheet<ImageSource>(
      context: context,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _PhotoSourceSheet(),
    );

class _PhotoSourceSheet extends StatelessWidget {
  const _PhotoSourceSheet();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFD5D8DE),
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text('Add a photo',
                  style: manrope(18, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 4),
              Text('Attach evidence so responders can act faster.',
                  style: manrope(12, FontWeight.w400, EhbrColors.muted)),
              const SizedBox(height: 16),
              const _PhotoOption(
                icon: Icons.photo_camera_outlined,
                title: 'Take a photo',
                subtitle: 'Use your camera now',
                source: ImageSource.camera,
              ),
              const SizedBox(height: 10),
              const _PhotoOption(
                icon: Icons.photo_library_outlined,
                title: 'Choose from gallery',
                subtitle: 'Pick a photo already on your phone',
                source: ImageSource.gallery,
              ),
              const SizedBox(height: 14),
              SizedBox(
                height: 48,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: EhbrColors.ink,
                    side: const BorderSide(color: _photoBorder),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text('Cancel',
                      style: manrope(14, FontWeight.w700, EhbrColors.ink)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PhotoOption extends StatelessWidget {
  const _PhotoOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.source,
  });

  final IconData icon;

  final String title, subtitle;

  final ImageSource source;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: _photoBorder),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => Navigator.pop(context, source),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: _photoSurface,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 20, color: EhbrColors.ink),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: manrope(14, FontWeight.w700, EhbrColors.ink)),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: manrope(11, FontWeight.w400, EhbrColors.muted)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded,
                  size: 20, color: EhbrColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Discard report?" confirmation. Pops `true` to leave, `false`/null to keep editing.
class _DiscardReportSheet extends StatelessWidget {
  const _DiscardReportSheet();

  static const Color _line = Color(0xFFE2E4EA);

  @override
  Widget build(BuildContext context) {
    final red = EhbrColors.brand;

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: _line,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 22),
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: red.withValues(alpha: .1),
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.edit_off_outlined, color: red, size: 24),
              ),
              const SizedBox(height: 14),
              Text('Discard report?', style: manrope(17, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 6),
              Text(
                'You have an unfinished report. '
                'If you leave now, what you entered will be lost.',
                textAlign: TextAlign.center,
                style: manrope(12.5, FontWeight.w400, EhbrColors.muted).copyWith(height: 1.45),
              ),
              const SizedBox(height: 22),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton(
                  onPressed: () => Navigator.pop(context, false),
                  style: FilledButton.styleFrom(
                    backgroundColor: red,
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text('Keep editing', style: manrope(15, FontWeight.w700, Colors.white)),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context, true),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: red,
                    side: const BorderSide(color: _line),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text('Discard report', style: manrope(14, FontWeight.w700, red)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}