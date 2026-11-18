import 'package:flutter/gestures.dart';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' show LatLng;

import '../models/models.dart';
import '../phone.dart';
import '../services/api.dart';
import '../services/session.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets/async_body.dart';
import '../widgets/sos_sheet.dart';

typedef _MapData = (List<PublicReport>, List<EvacCenter>, List<Blockage>);

// Colour is kept only where it carries meaning (marker type, status dot,
// selected filter, SOS). Everything else is neutral, like the Create a Report screen.
const Color _mapRed = Color(0xFFC7193D);
const Color _mapOrange = Color(0xFFE7A12D);
const Color _mapGreen = Color(0xFF269B50);
const Color _mapSlate = Color(0xFF64748B);
const Color _mapBorder = Color(0xFFE2E4EA);
//const Color _mapSurface = Color(0xFFF3F4F8);
const Color _mapRedTint = Color(0xFFFDEEF0);

enum _Kind { incident, hazard, evac, blocked }

Color _kindColor(_Kind k) => switch (k) {
      _Kind.incident => _mapRed,
      _Kind.hazard => _mapOrange,
      _Kind.evac => _mapGreen,
      _Kind.blocked => _mapSlate,
    };

IconData _kindIcon(_Kind k) => switch (k) {
      _Kind.incident => Icons.local_fire_department,
      _Kind.hazard => Icons.warning_rounded,
      _Kind.evac => Icons.shield_rounded,
      _Kind.blocked => Icons.block,
    };

/// Picks an icon from the report's type text (e.g. "Fire", "Road accident").
/// Matching is by keyword, so it still works if the wording varies slightly.
IconData _reportIcon(String type, _Kind kind) {
  final t = type.toLowerCase();
  bool has(List<String> words) => words.any(t.contains);

  if (has(['fire', 'smoke', 'burn', 'explosion'])) {
    return Icons.local_fire_department;
  }
  if (has(['accident', 'crash', 'collision', 'vehicular'])) {
    return Icons.car_crash;
  }
  if (has(['medical', 'injur', 'ambulance', 'unconscious', 'heart', 'sick'])) {
    return Icons.medical_services;
  }
  if (has(['flood', 'water level', 'storm surge'])) return Icons.flood;
  if (has(['earthquake', 'quake'])) return Icons.vibration;
  if (has(['landslide', 'mudslide'])) return Icons.terrain;
  if (has(['tree'])) return Icons.park;
  if (has(['electric', 'power', 'outage', 'blackout', 'wire'])) {
    return Icons.bolt;
  }
  if (has([
    'theft',
    'robbery',
    'crime',
    'assault',
    'violence',
    'shooting',
    'fight',
    'gunshot',
  ])) {
    return Icons.local_police;
  }
  if (has(['missing'])) return Icons.person_search;
  if (has(['animal', 'snake', 'dog'])) return Icons.pets;
  if (has(['garbage', 'trash', 'waste'])) return Icons.delete_outline;
  if (has(['pothole', 'road'])) return Icons.add_road;
  if (has(['storm', 'typhoon', 'wind', 'rain'])) return Icons.thunderstorm;

  // Unknown type: neutral icon by kind, not the flame.
  return kind == _Kind.incident
      ? Icons.report_problem_outlined
      : Icons.warning_rounded;
}

Color _statusColorFor(String status) {
  switch (status.toUpperCase()) {
    case 'VERIFIED':
    case 'OPEN':
    case 'DISPATCHED':
    case 'RESPONDING':
      return _mapGreen;
    case 'PENDING':
    case 'STANDBY':
      return _mapOrange;
    case 'REJECTED':
    case 'CLOSED':
    case 'BLOCKED':
      return _mapRed;
    default:
      return _mapSlate;
  }
}

class _Item {
  _Item(
    this.kind,
    this.tag,
    this.place,
    this.meta,
    this.status,
    this.lat,
    this.lng, {
    this.report,
    this.center,
    this.blockage,
  });

  final _Kind kind;
  final String tag;
  final String place;
  final String meta;
  final String status;
  final double? lat;
  final double? lng;

  final PublicReport? report;
  final EvacCenter? center;
  final Blockage? blockage;

  bool get hasPoint => lat != null && lng != null;

  /// Icon for list rows, map markers and the preview sheet.
  /// Reports use their own type; centers and blockages use the kind icon.
  IconData get icon => isReport ? _reportIcon(tag, kind) : _kindIcon(kind);

  bool get isReport => report != null;
  bool get isCenter => center != null;
  bool get isBlockage => blockage != null;
}

/// Verified / dispatched reports and evacuation centers around the barangay.
class MapScreen extends StatefulWidget {
  const MapScreen({super.key, required this.reloadToken});

  final int reloadToken;

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final MapController _mapController = MapController();

  _Kind? _filter;

  // ----------------------------------------------------------
  // Filter chip row: snap, tap-to-center glide
  // ----------------------------------------------------------

  final ScrollController _chipScroll = ScrollController();
  final GlobalKey _chipViewportKey = GlobalKey();
  final List<GlobalKey> _chipKeys = List.generate(5, (_) => GlobalKey());

  // True only while the user's own finger drove the scroll, so our
  // programmatic glide/snap animations never re-trigger a snap.
  bool _userScrolling = false;

  @override
  void dispose() {
    _chipScroll.dispose();
    super.dispose();
  }

  /// Chip's left edge and width, relative to the chip row's viewport.
  (double left, double width, double viewport)? _chipRect(int index) {
    final chipBox = _chipKeys[index].currentContext?.findRenderObject();
    final viewBox = _chipViewportKey.currentContext?.findRenderObject();
    if (chipBox is! RenderBox || viewBox is! RenderBox) return null;
    if (!chipBox.attached || !viewBox.attached) return null;

    final left = chipBox.localToGlobal(Offset.zero, ancestor: viewBox).dx;
    return (left, chipBox.size.width, viewBox.size.width);
  }

  void _animateChipsBy(double delta, Duration duration, Curve curve) {
    if (!_chipScroll.hasClients) return;
    final pos = _chipScroll.position;
    final target = (pos.pixels + delta).clamp(
      pos.minScrollExtent,
      pos.maxScrollExtent,
    );
    if ((target - pos.pixels).abs() < 1) return; // already there
    _chipScroll.animateTo(target, duration: duration, curve: curve);
  }

  /// Tap: glide so the chip sits in the middle of the row.
  void _centerChip(int index) {
    final r = _chipRect(index);
    if (r == null) return;
    final (left, width, viewport) = r;
    _animateChipsBy(
      (left + width / 2) - viewport / 2,
      const Duration(milliseconds: 320),
      Curves.easeOutCubic,
    );
  }

  /// Swipe end: settle the nearest chip's left edge at the row's left edge.
  void _snapToNearestChip() {
    double? best;
    for (var i = 0; i < _chipKeys.length; i++) {
      final r = _chipRect(i);
      if (r == null) continue;
      final left = r.$1;
      if (best == null || left.abs() < best.abs()) best = left;
    }
    if (best == null) return;
    _animateChipsBy(
      best,
      const Duration(milliseconds: 220),
      Curves.easeOut,
    );
  }

  bool _onChipScroll(ScrollNotification n) {
    if (n.depth != 0) return false;
    if (n is ScrollStartNotification) {
      _userScrolling = n.dragDetails != null;
    } else if (n is ScrollEndNotification && _userScrolling) {
      _userScrolling = false;
      _snapToNearestChip();
    }
    return false;
  }

  // ----------------------------------------------------------
  // Data
  // ----------------------------------------------------------

  Future<_MapData> _load() async {
    final r = await Future.wait<Object>([
      Api.publicReports(),
      Api.centers(),
      Api.blockages(),
    ]);

    return (
      r[0] as List<PublicReport>,
      r[1] as List<EvacCenter>,
      r[2] as List<Blockage>,
    );
  }

  String _reportStatus(String status) {
    switch (status.toUpperCase()) {
      case 'DISPATCHED':
        return 'RESPONDING';
      case 'VERIFIED':
        return 'VERIFIED';
      case 'PENDING':
        return 'PENDING';
      case 'REJECTED':
        return 'REJECTED';
      default:
        return status.isEmpty ? 'UNKNOWN' : status.toUpperCase();
    }
  }

  List<_Item> _items(_MapData d) => [
        for (final r in d.$1)
          _Item(
            r.kind.toLowerCase() == 'incident' ? _Kind.incident : _Kind.hazard,
            r.type,
            r.locationText.isEmpty
                ? 'Location shared with responders'
                : r.locationText,
            'Reported ${ago(r.createdAt)}',
            _reportStatus(r.status),
            r.lat,
            r.lng,
            report: r,
          ),
        for (final c in d.$2.where(
          (c) => c.status.toLowerCase() != 'closed',
        ))
          _Item(
            _Kind.evac,
            c.name,
            c.address.isEmpty ? 'Evacuation center' : c.address,
            c.capacity > 0
                ? '${c.occupied}/${c.capacity} inside'
                : 'Capacity not set',
            c.status.toLowerCase() == 'open' ? 'OPEN' : 'STANDBY',
            c.lat,
            c.lng,
            center: c,
          ),
        for (final b in d.$3)
          _Item(
            _Kind.blocked,
            b.reason,
            b.title,
            b.until != null
                ? 'Expected to reopen ${stamp(b.until!)}'
                : b.details.isNotEmpty
                    ? b.details
                    : 'Blocked ${ago(b.createdAt)}',
            'BLOCKED',
            b.lat,
            b.lng,
            blockage: b,
          ),
      ];

  void _zoomIn() {
    final camera = _mapController.camera;
    _mapController.move(camera.center, camera.zoom + 1);
  }

  void _zoomOut() {
    final camera = _mapController.camera;
    _mapController.move(camera.center, camera.zoom - 1);
  }

  void _showPreview(_Item item) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      useSafeArea: true,
      builder: (sheetContext) {
        return _MapPreviewSheet(
          item: item,
          onDirections: item.hasPoint
              ? () {
                  Navigator.pop(sheetContext);
                  openDirections(item.lat!, item.lng!);
                }
              : null,
          onSos: item.isReport
              ? () {
                  Navigator.pop(sheetContext);
                  showSosSheet(context);
                }
              : null,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AsyncBody<_MapData>(
      load: _load,
      reloadToken: widget.reloadToken,
      builder: (context, data, refresh) {
        final all = _items(data);

        int count(_Kind k) => all.where((i) => i.kind == k).length;

        final shown =
            all.where((i) => _filter == null || i.kind == _filter).toList();

        final chips = <(String, _Kind?, int)>[
          ('ALL', null, all.length),
          ('Incidents', _Kind.incident, count(_Kind.incident)),
          ('Hazards', _Kind.hazard, count(_Kind.hazard)),
          ('Evacuate', _Kind.evac, count(_Kind.evac)),
          ('Blocked', _Kind.blocked, count(_Kind.blocked)),
        ];

        final pts = [
          for (final i in all.where((i) => i.hasPoint)) LatLng(i.lat!, i.lng!),
        ];

        final cfg = Session.config;

        return Column(
          children: [
            // Header.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Nearby Reports',
                      style: manrope(18, FontWeight.w800, EhbrColors.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Verified reports, evacuation centers and blocked roads.',
                      style: manrope(12, FontWeight.w400, EhbrColors.muted),
                    ),
                  ],
                ),
              ),
            ),

            // Category filters.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: SizedBox(
                key: _chipViewportKey,
                width: double.infinity,
                child: NotificationListener<ScrollNotification>(
                  onNotification: _onChipScroll,
                  child: ScrollConfiguration(
                    behavior: const MaterialScrollBehavior().copyWith(
                      dragDevices: {
                        PointerDeviceKind.touch,
                        PointerDeviceKind.mouse,
                        PointerDeviceKind.trackpad,
                      },
                    ),
                    child: SingleChildScrollView(
                      controller: _chipScroll,
                      scrollDirection: Axis.horizontal,
                      physics: const BouncingScrollPhysics(
                        parent: AlwaysScrollableScrollPhysics(),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (final (idx, c) in chips.indexed) ...[
                            _MapFilterChip(
                              key: _chipKeys[idx],
                              label: c.$1,
                              count: c.$3,
                              selected: _filter == c.$2,
                              onTap: () {
                                setState(() => _filter = c.$2);
                                _centerChip(idx);
                              },
                            ),
                            const SizedBox(width: 8),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),

            // Map and controls.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Container(
                height: 223,
                width: double.infinity,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: _mapBorder),
                ),
                child: Stack(
                  children: [
                    FlutterMap(
                      mapController: _mapController,
                      options: MapOptions(
                        initialCenter: pts.length == 1
                            ? pts.first
                            : LatLng(cfg.lat, cfg.lng),
                        initialZoom: pts.length == 1 ? 16 : 15,
                        initialCameraFit: pts.length >= 2
                            ? CameraFit.coordinates(
                                coordinates: pts,
                                padding: const EdgeInsets.all(40),
                                maxZoom: 16,
                              )
                            : cfg.hasBorder
                                ? CameraFit.bounds(
                                    bounds: _borderBounds(cfg.boundary),
                                    padding: const EdgeInsets.all(12),
                                  )
                                : null,
                        interactionOptions: const InteractionOptions(
                          flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
                        ),
                        minZoom: (cfg.hasBorder || cfg.radiusKm > 0) ? 12 : 3,
                        cameraConstraint: cfg.hasBorder
                            ? CameraConstraint.containCenter(
                                bounds: _borderBounds(cfg.boundary),
                              )
                            : cfg.radiusKm > 0
                                ? CameraConstraint.containCenter(
                                    bounds: _areaBounds(
                                      cfg.lat,
                                      cfg.lng,
                                      cfg.radiusKm,
                                    ),
                                  )
                                : const CameraConstraint.unconstrained(),
                      ),
                      children: [
                        TileLayer(
                          urlTemplate:
                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName: 'ph.barangay.ehbr',
                        ),
                        if (cfg.hasBorder)
                          PolygonLayer(
                            polygons: [
                              Polygon(
                                points: [
                                  for (final p in cfg.boundary)
                                    LatLng(p[0], p[1]),
                                ],
                                color: const Color(0x14C8203C),
                                borderColor: const Color(0xFFC8203C),
                                borderStrokeWidth: 2.5,
                              ),
                            ],
                          ),
                        MarkerLayer(
                          markers: [
                            for (final i in shown.where(
                              (i) => i.hasPoint,
                            ))
                              Marker(
                                point: LatLng(i.lat!, i.lng!),
                                width: 36,
                                height: 40,
                                child: GestureDetector(
                                  onTap: () => _showPreview(i),
                                  child: _Pin(i),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),

                    // OpenStreetMap attribution.
                    Positioned(
                      left: 6,
                      bottom: 6,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.9),
                          borderRadius: BorderRadius.circular(5),
                        ),
                        child: Text(
                          '© OpenStreetMap contributors',
                          style: manrope(8, FontWeight.w500, EhbrColors.ink),
                        ),
                      ),
                    ),

                    // Zoom controls.
                    Positioned(
                      right: 10,
                      bottom: 10,
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: _mapBorder),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _MapControlButton(
                              icon: Icons.add,
                              tooltip: 'Zoom in',
                              onTap: _zoomIn,
                            ),
                            Container(
                              width: 36,
                              height: 1,
                              color: _mapBorder,
                            ),
                            _MapControlButton(
                              icon: Icons.remove,
                              tooltip: 'Zoom out',
                              onTap: _zoomOut,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Nearby report list.
            Expanded(
              child: RefreshIndicator(
                onRefresh: refresh,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
                  children: [
                    Text(
                      shown.isEmpty
                          ? 'Nothing to show'
                          : '${shown.length} item${shown.length == 1 ? '' : 's'} nearby',
                      style: manrope(12, FontWeight.w700, EhbrColors.muted),
                    ),
                    const SizedBox(height: 10),
                    if (shown.isEmpty)
                      const EmptyState(
                        icon: Icons.map_outlined,
                        title: 'No reports or evacuation centers yet',
                        message:
                            'Verified reports and evacuation centers appear here once the barangay confirms them.',
                      ),
                    for (final i in shown) ...[
                      _Row(
                        i,
                        onTap: () => _showPreview(i),
                      ),
                      const SizedBox(height: 10),
                    ],
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

// ------------------------------------------------------------
// INTERACTIVE PREVIEW BOTTOM SHEET
// ------------------------------------------------------------

class _MapPreviewSheet extends StatelessWidget {
  const _MapPreviewSheet({
    required this.item,
    this.onDirections,
    this.onSos,
  });

  final _Item item;
  final VoidCallback? onDirections;
  final VoidCallback? onSos;

  Color get _categoryColor => _kindColor(item.kind);

  IconData get _categoryIcon => item.icon;

  String get _title => switch (item.kind) {
        _Kind.incident => 'Incident Details',
        _Kind.hazard => 'Hazard Details',
        _Kind.evac => 'Evacuation Center',
        _Kind.blocked => 'Road Blockage Details',
      };

  Widget _sectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        title,
        style: manrope(11, FontWeight.w700, EhbrColors.muted, spacing: .6),
      ),
    );
  }

  Widget _infoRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: EhbrColors.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: manrope(10, FontWeight.w500, EhbrColors.muted),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: manrope(12, FontWeight.w600, EhbrColors.ink),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Neutral pill. A small coloured dot is shown only when [dot] is given.
  Widget _badge(String label, {Color? dot}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _mapBorder),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot != null) ...[
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: manrope(10, FontWeight.w700, EhbrColors.ink),
            ),
          ),
        ],
      ),
    );
  }

  Widget _primaryButton({
    required String label,
    required IconData icon,
    required Color color,
    required VoidCallback? onTap,
  }) {
    return SizedBox(
      width: double.infinity,
      height: 46,
      child: ElevatedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 18),
        label: Text(
          label,
          style: manrope(13, FontWeight.w700, Colors.white),
        ),
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          foregroundColor: Colors.white,
          disabledBackgroundColor: color.withValues(alpha: .4),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
    );
  }

  Widget _secondaryButton({
    required String label,
    required IconData icon,
    required VoidCallback? onTap,
  }) {
    return SizedBox(
      width: double.infinity,
      height: 46,
      child: OutlinedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 18),
        label: Text(
          label,
          style: manrope(13, FontWeight.w700, EhbrColors.ink),
        ),
        style: OutlinedButton.styleFrom(
          foregroundColor: EhbrColors.ink,
          side: const BorderSide(color: _mapBorder),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
    );
  }

  // Incident and hazard use the same public report model.
  Widget _buildReportContent() {
    final r = item.report!;

    final sectionLabel = item.kind == _Kind.incident
        ? 'INCIDENT INFORMATION'
        : 'HAZARD INFORMATION';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle(sectionLabel),
        _infoRow(Icons.category_outlined, 'Category', r.type),
        _infoRow(Icons.verified_outlined, 'Status', item.status),
        _infoRow(Icons.priority_high_rounded, 'Urgency', r.urgency),
        _infoRow(
          Icons.calendar_today_outlined,
          'Reported',
          stamp(r.createdAt),
        ),
        _infoRow(
          Icons.location_on_outlined,
          'Location',
          r.locationText.isEmpty ? 'Location not provided' : r.locationText,
        ),
      ],
    );
  }

  Widget _buildCenterContent() {
    final c = item.center!;

    final occupancyAvailable = c.capacity > 0;
    final occupancyPercent = occupancyAvailable
        ? (c.occupied / c.capacity).clamp(0.0, 1.0).toDouble()
        : 0.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle('CENTER INFORMATION'),
        _infoRow(
          Icons.shield_outlined,
          'Center Status',
          c.status.toUpperCase(),
        ),
        _infoRow(
          Icons.location_on_outlined,
          'Address',
          c.address.isEmpty ? 'Address unavailable' : c.address,
        ),
        const Divider(height: 8, color: _mapBorder),
        const SizedBox(height: 12),
        _sectionTitle('OCCUPANCY INFORMATION'),
        if (occupancyAvailable) ...[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Current Occupancy',
                style: manrope(11, FontWeight.w600, EhbrColors.ink),
              ),
              Text(
                '${c.occupied} / ${c.capacity}',
                style: manrope(12, FontWeight.w800, EhbrColors.ink),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: LinearProgressIndicator(
              value: occupancyPercent,
              minHeight: 8,
              backgroundColor: const Color(0xFFE8EBEF),
              valueColor: AlwaysStoppedAnimation<Color>(
                occupancyPercent >= .9 ? _mapRed : _mapGreen,
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${(occupancyPercent * 100).round()}% capacity occupied',
            style: manrope(10, FontWeight.w500, EhbrColors.muted),
          ),
        ] else
          Text(
            'Occupancy information is currently unavailable.',
            style: manrope(11, FontWeight.w500, EhbrColors.muted),
          ),
      ],
    );
  }

  Widget _buildBlockageContent() {
    final b = item.blockage!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle('ROAD BLOCKAGE INFORMATION'),
        _infoRow(Icons.block, 'Reason', b.reason),
        _infoRow(Icons.location_on_outlined, 'Location', b.title),
        _infoRow(
          Icons.calendar_today_outlined,
          'Reported',
          stamp(b.createdAt),
        ),
        if (b.until != null)
          _infoRow(
            Icons.schedule,
            'Expected Reopening',
            stamp(b.until!),
          ),
        if (b.details.isNotEmpty) ...[
          const Divider(height: 8, color: _mapBorder),
          const SizedBox(height: 12),
          _sectionTitle('ADDITIONAL INFORMATION'),
          Text(
            b.details,
            style: manrope(11, FontWeight.w500, EhbrColors.ink),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * .72,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(22),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle.
          Padding(
            padding: const EdgeInsets.only(top: 10, bottom: 6),
            child: Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD5D8DE),
                borderRadius: BorderRadius.circular(10),
              ),
            ),
          ),

          // Sheet header.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 10, 12),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: _categoryColor.withValues(alpha: .1),
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(
                    _categoryIcon,
                    color: _categoryColor,
                    size: 21,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _title,
                        style: manrope(15, FontWeight.w800, EhbrColors.ink),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.place,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: manrope(11, FontWeight.w500, EhbrColors.muted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(
                    minWidth: 40,
                    minHeight: 40,
                  ),
                  padding: EdgeInsets.zero,
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, size: 22),
                  color: EhbrColors.muted,
                  tooltip: 'Close',
                ),
              ],
            ),
          ),

          const Divider(height: 1, color: _mapBorder),

          // Scrollable details.
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Category and status badges.
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _badge(item.tag),
                      _badge(item.status, dot: _statusColorFor(item.status)),
                    ],
                  ),

                  const SizedBox(height: 16),

                  if (item.isReport)
                    _buildReportContent()
                  else if (item.isCenter)
                    _buildCenterContent()
                  else if (item.isBlockage)
                    _buildBlockageContent(),

                  const SizedBox(height: 8),

                  // Actions.
                  if (item.isReport) ...[
                    _primaryButton(
                      label: 'Call SOS',
                      icon: Icons.sos_rounded,
                      color: _mapRed,
                      onTap: onSos,
                    ),
                    const SizedBox(height: 8),
                    _secondaryButton(
                      label: 'Get Directions',
                      icon: Icons.directions_outlined,
                      onTap: onDirections,
                    ),
                  ] else if (item.isCenter || item.isBlockage) ...[
                    _primaryButton(
                      label: 'Get Directions',
                      icon: Icons.directions_outlined,
                      color: EhbrColors.ink,
                      onTap: onDirections,
                    ),
                  ],

                  const SizedBox(height: 6),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------
// FILTER CHIP
// ------------------------------------------------------------

class _MapFilterChip extends StatelessWidget {
  const _MapFilterChip({
    super.key,
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = label == 'ALL' ? label : '$label ($count)';

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
          height: 32,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? _mapRedTint : Colors.white,
            border: Border.all(
              color: selected ? _mapRed : _mapBorder,
              width: 1.2,
            ),
            borderRadius: BorderRadius.circular(10),
          ),
          child: AnimatedDefaultTextStyle(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOut,
            style: manrope(
              11,
              FontWeight.w600,
              selected ? _mapRed : EhbrColors.ink,
            ),
            child: Text(text),
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------
// MAP ZOOM CONTROL
// ------------------------------------------------------------

class _MapControlButton extends StatelessWidget {
  const _MapControlButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          width: 36,
          height: 36,
          child: Icon(
            icon,
            size: 20,
            color: EhbrColors.ink,
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------
// MAP MARKER
// ------------------------------------------------------------

class _Pin extends StatelessWidget {
  const _Pin(this.item);

  final _Item item;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 30,
        height: 30,
        decoration: BoxDecoration(
          color: _kindColor(item.kind),
          shape: BoxShape.circle,
          border: Border.all(
            color: Colors.white,
            width: 2,
          ),
          boxShadow: const [
            BoxShadow(
              color: Color(0x44000000),
              blurRadius: 4,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Icon(
          item.icon,
          color: Colors.white,
          size: 17,
        ),
      ),
    );
  }
}

// ------------------------------------------------------------
// REPORT / EVACUATION CENTER / BLOCKAGE CARD
// ------------------------------------------------------------

class _Row extends StatelessWidget {
  const _Row(
    this.i, {
    required this.onTap,
  });

  final _Item i;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = _kindColor(i.kind);

    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: _mapBorder),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // Type icon: the only colour on the card.
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: .1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(i.icon, color: color, size: 19),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      i.tag,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: manrope(13, FontWeight.w700, EhbrColors.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      i.place,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: manrope(12, FontWeight.w500, EhbrColors.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      i.meta,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: manrope(11, FontWeight.w500, EhbrColors.muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),

              // Status pill. Tapping it still opens directions, as before.
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: i.hasPoint ? () => openDirections(i.lat!, i.lng!) : null,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: _mapBorder),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 7,
                            height: 7,
                            decoration: BoxDecoration(
                              color: _statusColorFor(i.status),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            i.status,
                            maxLines: 1,
                            style: manrope(
                              10,
                              FontWeight.w700,
                              EhbrColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (i.hasPoint) ...[
                      const SizedBox(height: 6),
                      const Icon(
                        Icons.directions_outlined,
                        size: 18,
                        color: EhbrColors.muted,
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------
// MAP BOUNDS
// ------------------------------------------------------------

/// A box around the barangay: centre ± radius.
LatLngBounds _areaBounds(
  double lat,
  double lng,
  double radiusKm,
) {
  final r = radiusKm * 1.25;
  final dLat = r / 111.32;
  final dLng = r / (111.32 * math.cos(lat * math.pi / 180));

  return LatLngBounds(
    LatLng(lat - dLat, lng - dLng),
    LatLng(lat + dLat, lng + dLng),
  );
}

/// Bounding box of the border plus 15% room.
LatLngBounds _borderBounds(List<List<double>> ring) {
  final lats = ring.map((p) => p[0]);
  final lngs = ring.map((p) => p[1]);

  final a = lats.reduce(math.min);
  final b = lats.reduce(math.max);
  final x = lngs.reduce(math.min);
  final y = lngs.reduce(math.max);

  final pa = (b - a) * 0.15 + 0.0005;
  final px = (y - x) * 0.15 + 0.0005;

  return LatLngBounds(
    LatLng(a - pa, x - px),
    LatLng(b + pa, y + px),
  );
}