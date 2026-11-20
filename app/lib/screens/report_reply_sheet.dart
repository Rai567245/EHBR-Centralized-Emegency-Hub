import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../location.dart';
import '../services/api.dart';
import '../services/report_queue.dart';
import '../theme.dart';
import 'report_screen.dart' show pickPhotoSource;

enum ReplyOutcome { sent, queued }

/// Floating confirmation, same look as the "notification removed" snackbar.
void showFloatingSnack(
  BuildContext context,
  String text, {
  IconData icon = Icons.check_circle_outline_rounded,
  double bottom = 110, // clears the floating nav bar; use 16 on pages without it
}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: EhbrColors.ink,
        margin: EdgeInsets.fromLTRB(16, 0, 16, bottom),
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        duration: const Duration(seconds: 4),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        content: Row(
          children: [
            Icon(icon, size: 20, color: Colors.white),
            const SizedBox(width: 10),
            Expanded(
              child: Text(text, style: manrope(13, FontWeight.w600, Colors.white)),
            ),
          ],
        ),
      ),
    );
}

/// Opens the reply sheet and shows the confirmation snackbar itself.
/// Returns null if the resident closed it without sending.
Future<ReplyOutcome?> showReplySheet(
  BuildContext context, {
  required String reportId,
  String? question,
}) async {
  final outcome = await showModalBottomSheet<ReplyOutcome>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => ReportReplySheet(reportId: reportId, question: question),
  );

  if (outcome != null && context.mounted) {
    final sent = outcome == ReplyOutcome.sent;
    showFloatingSnack(
      context,
      sent
          ? 'Reply sent to the barangay'
          : 'No connection. Reply saved and will be sent automatically.',
      icon: sent ? Icons.check_circle_outline_rounded : Icons.schedule_rounded,
    );
  }
  return outcome;
}

class ReportReplySheet extends StatefulWidget {
  const ReportReplySheet({super.key, required this.reportId, this.question});
  final String reportId;

  /// What the barangay asked (Report.infoMessage).
  final String? question;

  @override
  State<ReportReplySheet> createState() => _ReportReplySheetState();
}

class _ReportReplySheetState extends State<ReportReplySheet> {
  static const _red = Color(0xFFD92F32);
  static const _border = Color(0xFFD9DCE3);
  static const _maxPhotos = 3;

  final _msg = TextEditingController();
  final _where = TextEditingController();
  final List<Uint8List> _photos = [];
  double? _lat, _lng;
  bool _gpsBusy = false, _busy = false;
  String? _error;

  // One id for this reply. If the send succeeds but the answer is lost, the
  // queued retry carries the same id and the server ignores the duplicate.
  late final String _clientId = ReportQueue.newClientId();

  @override
  void dispose() {
    _msg.dispose();
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
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _gpsBusy = false);
    }
  }

  Future<void> _addPhoto() async {
    if (_photos.length >= _maxPhotos || _busy) return;
    final source = await pickPhotoSource(context);
    if (source == null || !mounted) return;
    try {
      final x = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1280,
        maxHeight: 1280,
        imageQuality: 70,
      );
      if (x == null) return;
      final bytes = await x.readAsBytes();
      if (bytes.length > 1400 * 1024) {
        if (mounted) setState(() => _error = 'That photo is too large. Try a different one.');
        return;
      }
      if (mounted) setState(() => _photos.add(bytes));
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Could not open the camera or gallery. Check the app’s permissions in your phone settings.');
      }
    }
  }

  Future<void> _submit() async {
    if (_busy) return;
    final text = _msg.text.trim(), where = _where.text.trim();
    if (text.isEmpty && where.isEmpty && _lat == null && _photos.isEmpty) {
      setState(() => _error = 'Add a message, a photo or your location.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });

    final payload = <String, dynamic>{
      if (text.isNotEmpty) 'message': text,
      if (where.isNotEmpty) 'locationText': where,
      if (_lat != null) 'lat': _lat,
      if (_lng != null) 'lng': _lng,
      if (_photos.isNotEmpty) 'photos': [for (final b in _photos) base64Encode(b)],
      'clientId': _clientId,
      'repliedAt': DateTime.now().toUtc().toIso8601String(),
    };

    try {
      await Api.replyToReport(widget.reportId, payload);
      if (mounted) Navigator.pop(context, ReplyOutcome.sent);
    } on ApiException catch (e) {
      if (e.isUnavailable) {
        // No signal / server busy: keep the reply on the phone and send it later.
        await ReportQueue.enqueue(payload, kind: 'reply', reportId: widget.reportId);
        if (mounted) Navigator.pop(context, ReplyOutcome.queued);
      } else if (mounted) {
        setState(() => _error = e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  InputDecoration _dec(String hint) {
    OutlineInputBorder b(Color c) => OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: c),
        );
    return InputDecoration(
      hintText: hint,
      hintStyle: manrope(12, FontWeight.w400, EhbrColors.muted),
      isDense: true,
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: b(_border),
      enabledBorder: b(_border),
      focusedBorder: b(_red),
    );
  }

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(top: 12, bottom: 6),
        child: Text(t, style: manrope(12, FontWeight.w700, EhbrColors.ink)),
      );

  @override
  Widget build(BuildContext context) {
    final kb = MediaQuery.viewInsetsOf(context).bottom;
    final q = (widget.question ?? '').trim();

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: EdgeInsets.only(bottom: kb),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
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
              const SizedBox(height: 14),
              Text('Reply to the barangay',
                  style: manrope(18, FontWeight.w800, EhbrColors.ink)),
              const SizedBox(height: 2),
              Text('Report ${widget.reportId}',
                  style: manrope(12, FontWeight.w400, EhbrColors.muted)),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F8FA),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: _border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('The barangay asked',
                        style: manrope(11, FontWeight.w600, EhbrColors.muted)),
                    const SizedBox(height: 4),
                    Text(
                      q.isEmpty ? 'Please send more details about this report.' : q,
                      style: manrope(12.5, FontWeight.w500, EhbrColors.ink)
                          .copyWith(height: 1.4),
                    ),
                  ],
                ),
              ),
              _label('Your reply'),
              TextField(
                controller: _msg,
                enabled: !_busy,
                maxLines: 3,
                maxLength: 300,
                style: manrope(12, FontWeight.w500, EhbrColors.ink),
                decoration: _dec('Write your answer…'),
              ),
              _label('Exact location (street, landmark or purok)'),
              TextField(
                controller: _where,
                enabled: !_busy,
                maxLength: 200,
                buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                style: manrope(12, FontWeight.w500, EhbrColors.ink),
                decoration: _dec('e.g. Beside the covered court, Purok 3'),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: _gpsBusy || _busy ? null : _gps,
                    icon: _gpsBusy
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.my_location, size: 16),
                    label: Text(_lat == null ? 'Use my current GPS' : 'Update GPS',
                        style: manrope(12, FontWeight.w600, _red)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _red,
                      side: const BorderSide(color: _border),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  if (_lat != null) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'GPS attached',
                        style: manrope(11, FontWeight.w600, const Color(0xFF15803D)),
                      ),
                    ),
                  ],
                ],
              ),
              _label('Photos (optional, up to $_maxPhotos)'),
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
                          child: Image.memory(_photos[i],
                              width: 64, height: 64, fit: BoxFit.cover),
                        ),
                        Positioned(
                          top: -6,
                          right: -6,
                          child: InkWell(
                            onTap: _busy ? null : () => setState(() => _photos.removeAt(i)),
                            child: const CircleAvatar(
                              radius: 11,
                              backgroundColor: EhbrColors.ink,
                              child: Icon(Icons.close, size: 14, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    ),
                  if (_photos.length < _maxPhotos)
                    InkWell(
                      onTap: _busy ? null : _addPhoto,
                      borderRadius: BorderRadius.circular(8),
                      child: Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: _border),
                        ),
                        child: const Icon(Icons.add_a_photo_outlined,
                            size: 22, color: EhbrColors.ink),
                      ),
                    ),
                ],
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(_error!,
                      style: manrope(12, FontWeight.w600, const Color(0xFFD32F2F))),
                ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: FilledButton(
                  onPressed: _busy ? null : _submit,
                  style: FilledButton.styleFrom(
                    backgroundColor: _red,
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: _busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                      : Text('Send reply',
                          style: manrope(14, FontWeight.w700, Colors.white)),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: TextButton(
                  onPressed: _busy ? null : () => Navigator.pop(context),
                  child: Text('Cancel',
                      style: manrope(13, FontWeight.w600, EhbrColors.muted)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
