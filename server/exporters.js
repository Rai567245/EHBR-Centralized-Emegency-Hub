'use strict';
/**
 * CSV, XLSX and PDF writers for the Reports Generator. Zero dependencies (Node built-ins only).
 *
 * Every writer takes the same neutral `doc` (see reportgen.js) so the preview, the PDF, the spreadsheet and the CSV
 * can never disagree. A null cell means "no data recorded" and is kept distinct from a real 0 in every format.
 */
const zlib = require('zlib');
const T = require('./timeutil');

// ---------------------------------------------------------------- shared formatting
function fmtDuration(min) {
  if (min === null || min === undefined || Number.isNaN(Number(min))) return '—';
  const m = Number(min);
  if (m < 1) return '<1 min';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${Math.floor(m / 1440)}d ${Math.round((m % 1440) / 60)}h`;
}
/** One formatter for preview + PDF, so on-screen and printed numbers are identical. */
function formatCell(v, col, tz) {
  if (v === null || v === undefined || v === '') return '—';
  switch (col.type) {
    case 'int': return Number(v).toLocaleString('en-US');
    case 'pct': return `${Number(v).toFixed(1)}%`;
    case 'num': return Number(v).toFixed(col.digits === undefined ? 1 : col.digits);
    case 'minutes': return fmtDuration(v);
    case 'datetime': return T.fmtDateTime(v, tz);
    default: return String(v);
  }
}

// ---------------------------------------------------------------- CSV
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = "'" + s;      // spreadsheet formula injection guard
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** The record list when the report has one, otherwise every table in long ("tidy") form. UTF-8 with BOM, CRLF line ends. */
function toCsv(doc) {
  const rows = [];
  if (doc.list) {
    rows.push(doc.list.columns.map((c) => c.label + (c.type === 'minutes' ? ' (minutes)' : '')));
    for (const r of doc.list.rows) rows.push(doc.list.columns.map((c) => cellValue(r[c.key], c, doc.tz)));
  } else {
    rows.push(['Section', 'Item', 'Metric', 'Value']);
    for (const s of doc.summary) rows.push(['Summary', s.label, 'Value', s.value]);
    for (const sec of doc.sections) {
      const [first, ...rest] = sec.columns;
      for (const r of [...sec.rows, ...(sec.total ? [sec.total] : [])]) for (const c of rest) rows.push([sec.title, r[first.key], c.label + (c.type === 'minutes' ? ' (minutes)' : ''), cellValue(r[c.key], c, doc.tz)]);
    }
  }
  return Buffer.from('\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
}
/** Raw, machine-readable cell value for CSV: ISO-like local times, plain numbers, empty for "not recorded". */
function cellValue(v, col, tz) {
  if (v === null || v === undefined) return '';
  if (col.type === 'datetime') return T.fmtDateTime(v, tz);
  if (col.type === 'pct' || col.type === 'num' || col.type === 'minutes') return Number(v);
  if (col.type === 'int') return Number(v);
  return v;
}

// ---------------------------------------------------------------- ZIP (for XLSX)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0; let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const out = [], central = []; let offset = 0;
  const now = new Date(), time = (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1), date = ((now.getUTCFullYear() - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    out.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, cd, end]);
}

// ---------------------------------------------------------------- XLSX
const xe = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
// style ids (see STYLES below)
const S = { normal: 0, header: 1, bold: 2, datetime: 3, int: 4, pct: 5, dec: 6, title: 7, wrap: 8, boldInt: 9, boldPct: 10, boldDec: 11, muted: 12, banner: 13 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="#,##0.0"/></numFmts>
<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF9B1C1C"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC41E3A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF9CA3AF"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="3" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** cell: { v, k: 's'|'n'|'d', s: style } | null. rows: array of arrays. */
function sheetXml(rows, { widths = [], freeze = 0, filterRow = null, filterCols = 0 } = {}) {
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const views = freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  let body = '';
  rows.forEach((row, r) => {
    const cells = row.map((c, i) => {
      if (c === null || c === undefined || c.v === null || c.v === undefined || c.v === '') return c && c.s ? `<c r="${colName(i)}${r + 1}" s="${c.s}"/>` : '';
      const ref = `${colName(i)}${r + 1}`, st = c.s ? ` s="${c.s}"` : '';
      if (c.k === 's') return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(c.v)}</t></is></c>`;
      return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
    }).join('');
    const ht = row.ht ? ` ht="${row.ht}" customHeight="1"` : '';
    body += `<row r="${r + 1}"${ht}>${cells}</row>`;
  });
  const af = filterRow !== null && filterCols ? `<autoFilter ref="A${filterRow + 1}:${colName(filterCols - 1)}${filterRow + 1 + 0}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData>${af}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
}
const txt = (v, s = 0) => ({ v, k: 's', s });
function typed(v, col, tz, total = false) {
  if (v === null || v === undefined) return null;                          // not recorded -> genuinely empty cell
  switch (col.type) {
    case 'int': return { v: Number(v), k: 'n', s: total ? S.boldInt : S.int };
    case 'pct': return { v: Number(v) / 100, k: 'n', s: total ? S.boldPct : S.pct };
    case 'num': case 'minutes': return { v: Number(v), k: 'n', s: total ? S.boldDec : S.dec };
    case 'datetime': return { v: T.excelSerial(v, tz), k: 'n', s: S.datetime };
    default: return txt(String(v), total ? S.bold : 0);
  }
}
const headerLabel = (c) => c.label + (c.type === 'minutes' ? ' (minutes)' : c.type === 'datetime' ? ' (local time)' : '');
const widthOf = (c, rows, tz) => {
  let w = headerLabel(c).length;
  for (const r of rows.slice(0, 300)) { const v = r[c.key]; if (v === null || v === undefined) continue; w = Math.max(w, c.type === 'datetime' ? 16 : String(c.type === 'int' || c.type === 'num' || c.type === 'minutes' || c.type === 'pct' ? formatCell(v, c, tz) : v).length); }
  return Math.min(60, Math.max(9, Math.ceil(w * 1.15) + 2));
};
function safeSheetName(name, used) {
  let n = String(name).replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  let base = n, i = 2;
  while (used.has(n.toLowerCase())) { n = `${base.slice(0, 28)} ${i++}`; }
  used.add(n.toLowerCase());
  return n;
}
function toXlsx(doc) {
  const tz = doc.tz, used = new Set(), sheets = [];
  // ---- Summary sheet
  const meta = [
    ['Report', doc.title], ['Barangay', doc.barangay], ['Reporting period', `${doc.period.label}`], ['Time zone', `${doc.tz} (${doc.tzOffset}); all times shown in this zone`],
    ['Filters', doc.filters.length ? doc.filters.map(([k, v]) => `${k}: ${v}`).join('; ') : 'None (all records in the period)'],
    ['Matching records', doc.matching], ['Generated', T.fmtDateTime(Date.parse(doc.generatedAt), tz)], ['Generated by', doc.generatedBy],
  ];
  const sum = [[txt(doc.title, S.title)], [txt(doc.confidentiality, S.banner)], []];
  for (const [k, v] of meta) sum.push([txt(k, S.bold), typeof v === 'number' ? { v, k: 'n', s: S.int } : txt(v, S.wrap)]);
  if (doc.summary.length) {
    sum.push([], [txt('Summary', S.header), txt('Value', S.header), txt('Note', S.header)]);
    for (const c of doc.summary) sum.push([txt(c.label, S.bold), txt(String(c.value), S.wrap), txt(c.note || '', S.muted)]);
  }
  if (doc.notes.length) { sum.push([], [txt('Data notes', S.header), txt('', S.header), txt('', S.header)]); for (const n of doc.notes) sum.push([txt('•', S.bold), txt(n, S.wrap)]); }
  if (doc.definitions.length) { sum.push([], [txt('Definitions', S.header), txt('', S.header), txt('', S.header)]); for (const [k, v] of doc.definitions) sum.push([txt(k, S.bold), txt(v, S.wrap)]); }
  sheets.push({ name: safeSheetName('Summary', used), xml: sheetXml(sum, { widths: [30, 70, 45] }) });
  // ---- one sheet per table
  for (const sec of doc.sections) {
    const rows = [sec.columns.map((c) => txt(headerLabel(c), S.header))];
    for (const r of sec.rows) rows.push(sec.columns.map((c) => typed(r[c.key], c, tz)));
    if (sec.total) rows.push(sec.columns.map((c, i) => (i === 0 ? txt(String(sec.total[c.key] ?? 'Total'), S.bold) : typed(sec.total[c.key], c, tz, true))));
    sheets.push({ name: safeSheetName(sec.title, used), xml: sheetXml(rows, { widths: sec.columns.map((c) => widthOf(c, sec.rows, tz)), freeze: 1, filterRow: 0, filterCols: sec.columns.length }) });
  }
  // ---- record list
  if (doc.list) {
    const L = doc.list, rows = [L.columns.map((c) => txt(headerLabel(c), S.header))];
    for (const r of L.rows) rows.push(L.columns.map((c) => typed(r[c.key], c, tz)));
    sheets.push({ name: safeSheetName(L.title || 'Records', used), xml: sheetXml(rows, { widths: L.columns.map((c) => widthOf(c, L.rows, tz)), freeze: 1, filterRow: 0, filterCols: L.columns.length }) });
  }
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
  ];
  return zip(files);
}

// ---------------------------------------------------------------- PDF
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const CP1252 = { 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2026: 0x85, 0x20ac: 0x80, 0x2122: 0x99 };
/** JS string -> WinAnsi byte string (what a base-14 PDF font expects). */
function winAnsi(s) {
  let o = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c === 0xa0) o += ' ';
    else if (c >= 32 && c <= 126) o += ch;
    else if (c >= 0xa1 && c <= 0xff) o += String.fromCharCode(c);
    else if (CP1252[c]) o += String.fromCharCode(CP1252[c]);
    else if (c === 9 || c === 10 || c === 13) o += ' ';
    else if (c === 0x2264) o += '<='; else if (c === 0x2265) o += '>='; else if (c === 0x2192) o += '->'; else if (c === 0x2212) o += '-';
    else o += '?';
  }
  return o;
}
const charW = (code, bold) => { const t = bold ? W_BOLD : W_REG; return code >= 32 && code <= 126 ? t[code - 32] : 556; };
const textW = (s, size, bold) => { let w = 0; const b = winAnsi(s); for (let i = 0; i < b.length; i++) w += charW(b.charCodeAt(i), bold); return (w * size) / 1000; };
const pdfStr = (b) => '(' + b.replace(/[\\()]/g, '\\$&') + ')';
const hex = (h) => { const n = parseInt(h.slice(1), 16); return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255}`.replace(/(\.\d{3})\d+/g, '$1'); };
const BRAND = '#c41e3a', INK = '#1e1e1e', MUTED = '#6b7280', LINE = '#d1d5db', ZEBRA = '#f6f7f9', AMBER_BG = '#fef3c7', AMBER_INK = '#92400e';

function wrapText(s, maxW, size, bold, maxLines = 99) {
  const out = []; let line = '';
  const push = () => { out.push(line); line = ''; };
  for (const para of String(s).split(/\r?\n/)) {
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (textW(word, size, bold) > maxW) {                                  // break words that cannot fit on a line
        let cut = word.length; while (cut > 1 && textW(word.slice(0, cut), size, bold) > maxW - (line ? textW(line + ' ', size, bold) : 0)) cut--;
        if (line && cut <= 1) { push(); continue; }
        line = line ? `${line} ${word.slice(0, cut)}` : word.slice(0, cut); word = word.slice(cut); push();
      }
      const next = line ? `${line} ${word}` : word;
      if (textW(next, size, bold) <= maxW) line = next; else { push(); line = word; }
    }
    if (line || !para) push();
  }
  if (out.length > maxLines) { const kept = out.slice(0, maxLines); let last = kept[maxLines - 1]; while (last.length > 1 && textW(last + '…', size, bold) > maxW) last = last.slice(0, -1); kept[maxLines - 1] = last + '…'; return kept; }
  return out;
}

class Pdf {
  constructor(landscape) {
    this.W = landscape ? 841.89 : 595.28; this.H = landscape ? 595.28 : 841.89; this.m = 36; this.pages = []; this.footerH = 30;
    this.newPage();
  }
  newPage() { this.cur = []; this.pages.push(this.cur); this.y = this.m; return this.cur; }
  get cw() { return this.W - this.m * 2; }
  get bottom() { return this.H - this.m - this.footerH; }
  ensure(h, onBreak) { if (this.y + h > this.bottom) { this.newPage(); if (onBreak) onBreak(); } }
  text(x, yTop, s, size, { bold = false, color = INK } = {}) { this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${hex(color)} rg ${x.toFixed(2)} ${(this.H - yTop - size * 0.8).toFixed(2)} Td ${pdfStr(winAnsi(s))} Tj ET`); }
  rect(x, yTop, w, h, { fill = null, stroke = null, lw = 0.5 } = {}) {
    const ops = [`${x.toFixed(2)} ${(this.H - yTop - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`];
    this.cur.push(`${fill ? hex(fill) + ' rg ' : ''}${stroke ? hex(stroke) + ' RG ' + lw + ' w ' : ''}${ops[0]} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }
  hline(x1, x2, yTop, color = LINE, lw = 0.5) { this.cur.push(`${hex(color)} RG ${lw} w ${x1.toFixed(2)} ${(this.H - yTop).toFixed(2)} m ${x2.toFixed(2)} ${(this.H - yTop).toFixed(2)} l S`); }
  build({ title, footerLeft, confidentiality }) {
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesObj = add(null), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const info = add(`<< /Title ${pdfStr(winAnsi(title))} /Producer (EHBR Reports Generator) /Creator (EHBR) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
    const kids = [], n = this.pages.length;
    this.pages.forEach((ops, i) => {
      const pg = [...ops];
      // PDF y grows upward: the footer lives in the bottom margin (y = 20..52)
      pg.push(`${hex(LINE)} RG 0.5 w ${this.m} 52 m ${this.W - this.m} 52 l S`);
      pg.push(`BT /F1 7.5 Tf ${hex(MUTED)} rg ${this.m} 41 Td ${pdfStr(winAnsi(footerLeft))} Tj ET`);
      const right = `Page ${i + 1} of ${n}`;
      pg.push(`BT /F1 7.5 Tf ${hex(MUTED)} rg ${(this.W - this.m - textW(right, 7.5, false)).toFixed(2)} 41 Td ${pdfStr(winAnsi(right))} Tj ET`);
      pg.push(`BT /F2 7 Tf ${hex(BRAND)} rg ${this.m} 29 Td ${pdfStr(winAnsi(confidentiality))} Tj ET`);
      const data = zlib.deflateSync(Buffer.from(pg.join('\n'), 'latin1'));
      const content = add({ stream: data });
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${this.W.toFixed(2)} ${this.H.toFixed(2)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; const offs = []; let pos = parts[0].length;
    objs.forEach((o, i) => {
      offs.push(pos);
      const b = o && o.stream ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${o.stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]) : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
      parts.push(b); pos += b.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(parts);
  }
}

function colWidths(cols, rows, avail, tz, size, total) {
  const pad = 10, nat = [], min = [];
  cols.forEach((c) => {
    let w = textW(c.label, size, true) + pad;
    let mn = Math.max(...c.label.split(/\s+/).map((wd) => textW(wd, size, true))) + pad;           // never break a header word
    let widest = 0;
    const vals = rows.slice(0, 250).map((r) => formatCell(r[c.key], c, tz));
    if (total && total[c.key] !== undefined && total[c.key] !== null) vals.push(formatCell(total[c.key], c, tz));
    for (const v of vals) { const vw = textW(v, size, !!total) + pad; widest = Math.max(widest, vw); w = Math.max(w, Math.min(vw, c.type === 'text' ? 190 : 110)); }
    if (c.type !== 'text') mn = Math.max(mn, Math.min(widest, 110));                              // numbers and dates stay on one line
    mn = Math.max(34, mn + 3);                                                                     // small margin: a word exactly as wide as the cell must still fit
    min.push(mn); nat.push(Math.max(34, w, mn));
  });
  const sumN = nat.reduce((a, b) => a + b, 0), sumM = min.reduce((a, b) => a + b, 0);
  if (sumN > avail) {
    if (sumM >= avail) return min.map((w) => (w * avail) / sumM);
    const f = (avail - sumM) / (sumN - sumM);                                                      // shrink only what is above each column's minimum
    return nat.map((w, i) => min[i] + (Math.max(w, min[i]) - min[i]) * f);
  }
  const flex = cols.map((c) => (c.type === 'text' ? 1 : 0)), fs = flex.reduce((a, b) => a + b, 0), extra = avail - sumN;
  return nat.map((w, i) => w + (fs ? (extra * flex[i]) / fs : extra / cols.length));
}

function drawTable(p, cols, rows, total, tz, { size = 8, maxRows = Infinity, width = null } = {}) {
  const tw = Math.min(width || p.cw, p.cw), widths = colWidths(cols, rows, tw, tz, size, total), lh = size + 3.2, pad = 5;
  const header = () => {
    const lines = cols.map((c, i) => wrapText(c.label, widths[i] - pad * 2, size, true, 3));
    const h = Math.max(...lines.map((l) => l.length)) * lh + 6;
    p.rect(p.m, p.y, tw, h, { fill: '#374151' });
    let x = p.m; cols.forEach((c, i) => { lines[i].forEach((ln, k) => { const tw = textW(ln, size, true); p.text(c.align === 'right' || ['int', 'pct', 'num', 'minutes'].includes(c.type) ? x + widths[i] - pad - tw : x + pad, p.y + 4 + k * lh, ln, size, { bold: true, color: '#ffffff' }); }); x += widths[i]; });
    p.y += h;
  };
  p.ensure(40, null); header();
  const shown = rows.slice(0, maxRows);
  shown.forEach((r, ri) => {
    const cells = cols.map((c, i) => wrapText(formatCell(r[c.key], c, tz), widths[i] - pad * 2, size, false, 4));
    const h = Math.max(...cells.map((l) => l.length)) * lh + 4;
    p.ensure(h, header);
    if (ri % 2) p.rect(p.m, p.y, tw, h, { fill: ZEBRA });
    let x = p.m;
    cols.forEach((c, i) => { const num = ['int', 'pct', 'num', 'minutes'].includes(c.type); cells[i].forEach((ln, k) => { const tw = textW(ln, size, false); p.text(num ? x + widths[i] - pad - tw : x + pad, p.y + 2.5 + k * lh, ln, size, { color: ln === '—' ? MUTED : INK }); }); x += widths[i]; });
    p.y += h;
  });
  if (total) {
    const cells = cols.map((c, i) => wrapText(i === 0 ? String(total[c.key] ?? 'Total') : formatCell(total[c.key], c, tz), widths[i] - pad * 2, size, true, 2));
    const h = Math.max(...cells.map((l) => l.length)) * lh + 5;
    p.ensure(h, header);
    p.hline(p.m, p.m + tw, p.y, INK, 0.8);
    let x = p.m; cols.forEach((c, i) => { const num = ['int', 'pct', 'num', 'minutes'].includes(c.type); cells[i].forEach((ln, k) => { const tw = textW(ln, size, true); p.text(num ? x + widths[i] - pad - tw : x + pad, p.y + 3 + k * lh, ln, size, { bold: true }); }); x += widths[i]; });
    p.y += h;
  }
  p.hline(p.m, p.m + tw, p.y, LINE, 0.5);
  if (rows.length > shown.length) { p.y += 4; p.text(p.m, p.y, `Showing the first ${shown.length.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} rows. Export XLSX or CSV for the complete list.`, 7.5, { color: AMBER_INK }); p.y += 12; }
  p.y += 8;
}

function drawBars(p, items, unit, tz) {
  const max = Math.max(...items.map((i) => i.value), 1), lw = Math.min(150, p.cw * 0.34), bh = 11, gap = 4, vw = 56;
  const barArea = p.cw - lw - vw;
  items.forEach((it) => {
    p.ensure(bh + gap + 2, null);
    const label = wrapText(it.label, lw - 6, 8, false, 1)[0] || '';
    p.text(p.m, p.y + 1.5, label, 8, { color: INK });
    const w = (it.value / max) * barArea;
    if (w > 0) p.rect(p.m + lw, p.y, Math.max(w, 1), bh, { fill: BRAND });
    p.text(p.m + lw + Math.max(w, 1) + 4, p.y + 1.5, it.display, 8, { bold: true });
    p.y += bh + gap;
  });
  p.text(p.m, p.y, unit, 7, { color: MUTED }); p.y += 12;
}

function drawColumns(p, items, unit) {
  const h = 110, labelH = 18; p.ensure(h + labelH + 26, null);
  const max = Math.max(...items.map((i) => i.value), 1), x0 = p.m + 28, w = p.cw - 28, top = p.y + 8, base = top + h;
  const niceMax = Math.max(1, Math.ceil(max / 4) * 4 === 0 ? max : Math.ceil(max / 4) * 4);
  for (let g = 0; g <= 4; g++) { const yy = base - (h * g) / 4; p.hline(x0, x0 + w, yy, g === 0 ? MUTED : '#e5e7eb', 0.5); p.text(p.m, yy - 4, String(Math.round((niceMax * g) / 4 * 10) / 10), 7, { color: MUTED }); }
  const bw = w / items.length, step = Math.max(1, Math.ceil(items.length / 14));
  items.forEach((it, i) => {
    const bhh = (it.value / niceMax) * h, bx = x0 + i * bw + bw * 0.15;
    if (bhh > 0) p.rect(bx, base - bhh, bw * 0.7, bhh, { fill: BRAND });
    if (items.length <= 16 && it.value > 0) p.text(bx + bw * 0.35 - textW(String(it.value), 6.5, true) / 2, base - bhh - 9, String(it.value), 6.5, { bold: true });
    if (i % step === 0) { const t = it.label; p.text(bx + bw * 0.35 - textW(t, 6.5, false) / 2, base + 4, t, 6.5, { color: MUTED }); }
  });
  p.y = base + labelH + 2; p.text(p.m, p.y, unit, 7, { color: MUTED }); p.y += 12;
}

function toPdf(doc) {
  const landscape = !!doc.list;
  const p = new Pdf(landscape), tz = doc.tz, cw = p.cw;
  // ---- title block
  p.rect(0, 0, p.W, 10, { fill: BRAND });
  p.y = 26;
  p.text(p.m, p.y, 'EMERGENCY HUB  ·  ' + doc.barangay.toUpperCase(), 8, { bold: true, color: BRAND }); p.y += 14;
  p.text(p.m, p.y, doc.title, 19, { bold: true }); p.y += 28;
  const meta = [['Reporting period', doc.period.label], ['Time zone', `${doc.tz} (${doc.tzOffset})`], ['Filters', doc.filters.length ? doc.filters.map(([k, v]) => `${k}: ${v}`).join('  ·  ') : 'None (all records in the period)'], ['Generated', `${T.fmtDateTime(Date.parse(doc.generatedAt), tz)} by ${doc.generatedBy}`], ['Matching records', doc.matching.toLocaleString('en-US')]];
  for (const [k, v] of meta) { const lines = wrapText(v, cw - 100, 8.5, false, 3); p.text(p.m, p.y, k, 8.5, { bold: true, color: MUTED }); lines.forEach((ln, i) => p.text(p.m + 100, p.y + i * 11, ln, 8.5)); p.y += Math.max(1, lines.length) * 11 + 2; }
  p.y += 4;
  // ---- summary cards
  if (doc.summary.length) {
    const perRow = Math.min(doc.summary.length, landscape ? 5 : 4), gap = 8, cwid = (cw - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < doc.summary.length; i += perRow) {
      const row = doc.summary.slice(i, i + perRow), noteLines = row.map((c) => (c.note ? wrapText(c.note, cwid - 14, 6.8, false, 3) : []));
      const h = 46 + Math.max(...noteLines.map((l) => l.length)) * 8.4;
      p.ensure(h + 6, null);
      row.forEach((c, j) => {
        const x = p.m + j * (cwid + gap);
        p.rect(x, p.y, cwid, h, { fill: '#ffffff', stroke: LINE });
        p.text(x + 7, p.y + 6, wrapText(c.label, cwid - 14, 7.5, true, 1)[0], 7.5, { bold: true, color: MUTED });
        p.text(x + 7, p.y + 19, wrapText(String(c.value), cwid - 14, 15, true, 1)[0], 15, { bold: true });
        noteLines[j].forEach((ln, k) => p.text(x + 7, p.y + 40 + k * 8.4, ln, 6.8, { color: MUTED }));
      });
      p.y += h + gap;
    }
    p.y += 2;
  }
  // ---- notes
  if (doc.notes.length) {
    const lines = doc.notes.flatMap((n) => wrapText('•  ' + n, cw - 20, 8, false)), h = lines.length * 10.5 + 18;
    p.ensure(Math.min(h, 120), null);
    p.rect(p.m, p.y, cw, h, { fill: AMBER_BG });
    p.text(p.m + 10, p.y + 6, 'Data notes', 8, { bold: true, color: AMBER_INK });
    lines.forEach((ln, i) => { p.ensure(12, null); p.text(p.m + 10, p.y + 17 + i * 10.5, ln, 8, { color: AMBER_INK }); });
    p.y += h + 10;
  }
  if (doc.empty) { p.rect(p.m, p.y, cw, 40, { fill: ZEBRA, stroke: LINE }); p.text(p.m + 12, p.y + 14, 'No records matched the selected period and filters.', 10, { bold: true }); p.y += 52; }
  // ---- sections
  const heading = (t, need = 70) => { p.ensure(need, null); p.text(p.m, p.y, t, 12, { bold: true }); p.y += 17; };
  for (const sec of doc.sections) {
    heading(sec.title, sec.chart && sec.rows.length ? (sec.chart.type === 'column' ? 190 : Math.min(sec.rows.length, 14) * 15 + 90) : 70);
    if (sec.note) { const ls = wrapText(sec.note, cw, 7.8, false); ls.forEach((l) => { p.text(p.m, p.y, l, 7.8, { color: MUTED }); p.y += 10; }); p.y += 3; }
    if (sec.chart && sec.rows.length) {
      const items = sec.rows.map((r) => ({ label: String(r[sec.chart.labelKey]), value: Number(r[sec.chart.valueKey]) || 0, display: formatCell(r[sec.chart.valueKey], sec.columns.find((c) => c.key === sec.chart.valueKey) || {}, tz) }));
      if (sec.chart.type === 'column') drawColumns(p, items, sec.chart.unit); else drawBars(p, items.slice(0, 14), sec.chart.unit, tz);
    }
    drawTable(p, sec.columns, sec.rows, sec.total, tz, { size: 8, width: sec.columns.length <= 3 ? 470 : null });
  }
  if (doc.list) { heading(doc.list.title); drawTable(p, doc.list.columns, doc.list.rows, null, tz, { size: 7, maxRows: 1500 }); }
  if (doc.definitions.length) {
    heading('Definitions');
    for (const [k, v] of doc.definitions) { const ls = wrapText(v, cw - 120, 8, false); p.ensure(ls.length * 10.5 + 4, null); p.text(p.m, p.y, k, 8, { bold: true }); ls.forEach((l, i) => p.text(p.m + 120, p.y + i * 10.5, l, 8, { color: '#374151' })); p.y += ls.length * 10.5 + 4; }
  }
  return p.build({ title: doc.title, footerLeft: `Emergency Hub – ${doc.barangay}  |  ${doc.title}  |  ${doc.period.label}`, confidentiality: doc.confidentiality });
}

module.exports = { toCsv, toXlsx, toPdf, formatCell, fmtDuration, zip, crc32 };