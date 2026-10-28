import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  PII_TYPES,
  Samaran,
  UU_PDP_CATEGORY,
  addWorkingDays,
  countWorkingDays,
  detectPii,
  formatRupiah,
  formatRupiahShort,
  getHolidays,
  holidaysOn,
  isWorkingDay,
  parseNik,
  parseNpwp,
  parsePhone,
  parseQris,
  parseRupiah,
  partialMask,
  setQrisAmount,
  terbilang,
  type PiiMatch,
  type PiiType,
} from '@lokal-id/core';
import {
  findByPostalCode,
  getWilayah,
  listWilayah,
  parseAlamat,
  postalCodesIn,
  searchWilayah,
  wilayahName,
} from '@lokal-id/core/wilayah';
import {
  detectConfigured, loadConfig, loadDocument, loadIgnore, resolveInRoot, toPosix, walkFiles, type Document, type SamaranConfig,
} from './files.ts';
import { anonymizeFiles, KEMBARAN_NOTE } from './kembaran-files.ts';

const VERSION = '0.8.0';
const FILE_LIMIT = 5000;

const INSTRUCTIONS = `Lokal makes you Indonesia-ready.

Data tools (use them instead of guessing): parse_nik, validate_npwp, parse_phone, format_rupiah, parse_rupiah, search_wilayah, list_wilayah, lookup_kode_pos, parse_alamat, list_holidays, working_days, parse_qris, set_qris_amount. Region lists, kode pos, holidays, NIK structure, Rupiah formatting, and QRIS checksums are easy to get subtly wrong from memory.

Privacy tools (Samaran): when a task touches real user data — logs, CSV/Excel exports, database dumps, support tickets, seed files from production — run scan_pii first, then read it with read_file_masked instead of reading the raw file (also never cat/head/type it in a shell). Identifiers (NIK, KK, NPWP, phone, bank account, BPJS, passport …), names, addresses, birth dates, and the UU PDP categories (religion, marital status, health, finances, criminal records, biometrics) come back as stable placeholders like [NIK_1]. Work with the placeholders; never ask the user for the real values. parse_alamat, parse_nik, parse_phone, and validate_npwp also take those placeholders ([ADDRESS_3], [NIK_1]): they read the real value on the user's machine and return the regions, validity, and operator, with anything about the person (street, RT/RW, birth date) as placeholders. When output must contain the real data (a cleaned CSV, a report), write it with write_file_unmasked, which restores the placeholders on the user's machine. To copy production data to staging, build seeders, or share it with a vendor, use anonymize_file: it writes a copy where every person is a realistic stand-in. If scan_pii reports files it could not scan, tell the user; do not treat them as clean.`;

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/** Counts per type, with custom matches under their rule's label. */
function countByType(types: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of types) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function parts(doc: Exclude<Document, { kind: 'skipped' }>): Array<{ sheet?: string; text: string }> {
  return doc.kind === 'text' ? [{ text: doc.text }] : doc.sheets.map((s) => ({ sheet: s.name, text: s.csv }));
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export interface ServerOptions {
  /**
   * The file tools (scan_pii, read_file_masked, write_file_unmasked). Off for a remote server: it would open the
   * host's files to anyone who can reach it, and it cannot see the user's files anyway.
   */
  files?: boolean;
}

export function createServer(
  root = path.resolve(process.env.LOKAL_ROOT ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()),
  options: ServerOptions = {},
): McpServer {
  const files = options.files !== false;
  const server = new McpServer(
    { name: 'lokal', version: VERSION },
    { instructions: files ? INSTRUCTIONS : INSTRUCTIONS.slice(0, INSTRUCTIONS.indexOf('\n\nPrivacy tools')) },
  );
  // One vault per server process, so placeholders stay stable across calls in a session.
  // The project's own rules in .samaran.json. A broken file stops the file tools rather than mask less than expected.
  let config: SamaranConfig = { custom: [], allow: [] };
  let configError: string | undefined;
  try {
    config = loadConfig(root);
  } catch (e) {
    configError = `${(e as Error).message} Fix .samaran.json, then restart the MCP server.`;
  }
  const samaran = new Samaran({ custom: config.custom, allow: config.allow });
  const isIgnored = loadIgnore(root);
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const inRoot = (p: string) => resolveInRoot(root, p);
  // A placeholder from read_file_masked stands for a value only this server knows. The data tools below work on the
  // real value, and what they say about the person comes back as placeholders too, so the model still sees none of it.
  const fromVault = (input: string) => {
    const value = samaran.unmask(input);
    return value === input ? undefined : value;
  };
  const MASKED_NOTE =
    'The input was a placeholder: read on this machine from the real value. Values about the person are placeholders; write_file_unmasked restores them.';

  server.registerTool(
    'parse_nik',
    {
      title: 'Parse NIK',
      description:
        'Validate an Indonesian NIK (16-digit national ID) by structure and decode it: province, regency, district (Kemendagri), birth date, gender. Cannot prove the NIK is registered at Dukcapil. Also takes a [NIK_n] placeholder from read_file_masked; then the birth date and gender come back as placeholders.',
      inputSchema: { nik: z.string().describe('16-digit NIK; spaces and dots are ignored') },
      annotations: readOnly,
    },
    async ({ nik }) => {
      const real = fromVault(nik);
      if (real === undefined) return json(parseNik(nik, { lookupWilayah: wilayahName }));
      const r = parseNik(real, { lookupWilayah: wilayahName });
      return json({
        input: nik,
        valid: r.valid,
        errors: r.errors,
        warnings: r.warnings,
        provinceCode: r.provinceCode,
        regencyCode: r.regencyCode,
        districtCode: r.districtCode,
        province: r.province,
        regency: r.regency,
        district: r.district,
        gender: r.gender && samaran.placeholder('GENDER', r.gender),
        birthDate: r.birthDate && samaran.placeholder('BIRTH_DATE', r.birthDate),
        note: MASKED_NOTE,
      });
    },
  );

  server.registerTool(
    'validate_npwp',
    {
      title: 'Validate NPWP',
      description:
        'Validate the format of an Indonesian tax ID (NPWP): legacy 15-digit (XX.XXX.XXX.X-XXX.XXX), 16-digit, or NIK used as NPWP for individuals. Returns the 16-digit form DJP uses today. Format only: it does not check the DJP check digit or registration. Also takes an [NPWP_n] or [NIK_n] placeholder from read_file_masked; then only validity and kind come back.',
      inputSchema: { npwp: z.string() },
      annotations: readOnly,
    },
    async ({ npwp }) => {
      const real = fromVault(npwp);
      if (real === undefined) return json(parseNpwp(npwp));
      const r = parseNpwp(real);
      return json({ input: npwp, valid: r.valid, errors: r.errors, kind: r.kind, note: MASKED_NOTE });
    },
  );

  server.registerTool(
    'parse_qris',
    {
      title: 'Read a QRIS payload',
      description:
        'Read and check a QRIS payload (the text inside an Indonesian QRIS payment code): static or dynamic, merchant name and city, NMID, merchant criteria (UMI, UKE, …), amount, tip, merchant accounts, and whether the CRC checksum is intact. Errors and warnings are in Indonesian.',
      inputSchema: { payload: z.string().describe('The QRIS text, starting with 000201') },
      annotations: readOnly,
    },
    async ({ payload }) => json(parseQris(payload)),
  );

  server.registerTool(
    'set_qris_amount',
    {
      title: 'Make a dynamic QRIS with an amount',
      description:
        'Turn a QRIS payload into a dynamic one for an amount in Rupiah, optionally with a fixed or percentage fee, and recompute the CRC. The merchant account is unchanged. Returns the new payload, ready to render as a QR code.',
      inputSchema: {
        payload: z.string(),
        amount: z.union([z.number(), z.string()]).describe('Rupiah, at most 2 decimals, e.g. 25000'),
        fee_fixed: z.union([z.number(), z.string()]).optional().describe('A fixed fee in Rupiah on top of the amount'),
        fee_percent: z.union([z.number(), z.string()]).optional().describe('A percentage fee on top of the amount'),
      },
      annotations: readOnly,
    },
    async ({ payload, amount, fee_fixed, fee_percent }) => {
      if (fee_fixed !== undefined && fee_percent !== undefined) return fail('Use fee_fixed or fee_percent, not both.');
      const tip = fee_fixed !== undefined ? { fixed: fee_fixed } : fee_percent !== undefined ? { percent: fee_percent } : undefined;
      try {
        const out = setQrisAmount(payload, amount, tip ? { tip } : {});
        const info = parseQris(out);
        return json({ payload: out, type: info.type, amount: info.amount, tip: info.tip, merchantName: info.merchantName, nmid: info.nmid });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'parse_phone',
    {
      title: 'Parse Indonesian phone number',
      description:
        'Normalize an Indonesian phone number (08xx, +62, 62, landline with area code) to E.164, display format, WhatsApp form, and original operator (Telkomsel, Indosat, Tri, XL, Axis, Smartfren). Also takes a [PHONE_n] placeholder from read_file_masked; then only validity, type, and operator come back.',
      inputSchema: { phone: z.string() },
      annotations: readOnly,
    },
    async ({ phone }) => {
      const real = fromVault(phone);
      if (real === undefined) return json(parsePhone(phone));
      const r = parsePhone(real);
      return json({
        input: phone,
        valid: r.valid,
        errors: r.errors,
        warnings: r.warnings,
        type: r.type,
        operator: r.operator,
        group: r.group,
        area: r.area,
        note: MASKED_NOTE,
      });
    },
  );

  server.registerTool(
    'format_rupiah',
    {
      title: 'Format Rupiah',
      description:
        'Format an amount as Rupiah the Indonesian way (Rp1.500.000), short form (Rp1,5 jt), and spelled out in words (terbilang) for receipts and invoices.',
      inputSchema: { amount: z.number().describe('Amount in rupiah') },
      annotations: readOnly,
    },
    async ({ amount }) =>
      json({
        formatted: formatRupiah(amount),
        withDecimals: formatRupiah(amount, { decimals: true }),
        short: formatRupiahShort(amount),
        terbilang: terbilang(Math.round(amount), { currency: true }),
        terbilangKuitansi: terbilang(Math.round(amount), { currency: true, case: 'title' }),
      }),
  );

  server.registerTool(
    'parse_rupiah',
    {
      title: 'Parse Rupiah from text',
      description:
        'Turn how Indonesians write money into a number: "Rp 25.000", "1,5jt", "2jtan", "50rb-an", "goceng", "2 ceban", "sejuta setengah", "dua ratus ribu". "m" means miliar.',
      inputSchema: { text: z.string() },
      annotations: readOnly,
    },
    async ({ text }) => json(parseRupiah(text) ?? { amount: null, reason: 'Not a recognizable amount' }),
  );

  server.registerTool(
    'search_wilayah',
    {
      title: 'Search Indonesian regions',
      description:
        'Find official Kemendagri regions by name (provinsi, kabupaten/kota, kecamatan, kelurahan/desa) with their codes. Use for address forms, normalizing user-typed locations, and seed data instead of inventing region names.',
      inputSchema: {
        query: z.string(),
        level: z
          .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
          .optional()
          .describe('1 provinsi, 2 kabupaten/kota, 3 kecamatan, 4 kelurahan/desa'),
        within: z.string().optional().describe('Only search inside this region code, e.g. "32" for Jawa Barat'),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnly,
    },
    async ({ query, level, within, limit }) => json(searchWilayah(query, { level, within, limit })),
  );

  server.registerTool(
    'list_wilayah',
    {
      title: 'List child regions',
      description:
        'List the direct children of a region code — the data behind cascading address dropdowns. No code returns the 38 provinces; "32" returns the kabupaten/kota in Jawa Barat, and so on down to kelurahan/desa (which include their kode pos).',
      inputSchema: { parent_code: z.string().optional() },
      annotations: readOnly,
    },
    async ({ parent_code }) => {
      if (parent_code && !getWilayah(parent_code)) return fail(`Unknown region code: ${parent_code}`);
      return json(
        listWilayah(parent_code).map(({ code, name, type, postalCode }) => ({ code, name, type, postalCode })),
      );
    },
  );

  server.registerTool(
    'lookup_kode_pos',
    {
      title: 'Look up kode pos',
      description:
        'Kode pos (postal codes) for Indonesian regions. Give kode_pos to find the kelurahan/desa that use it, or wilayah_code to list every kode pos inside a region (e.g. "32.76" Kota Depok).',
      inputSchema: {
        kode_pos: z.string().regex(/^\d{5}$/).optional(),
        wilayah_code: z.string().optional(),
      },
      annotations: readOnly,
    },
    async ({ kode_pos, wilayah_code }) => {
      if (kode_pos) {
        const villages = findByPostalCode(kode_pos);
        if (!villages.length) return fail(`No kelurahan/desa uses kode pos ${kode_pos}.`);
        return json(villages.map(({ code, name, type, path: p }) => ({ code, name, type, path: p })));
      }
      if (wilayah_code) {
        const wilayah = getWilayah(wilayah_code);
        if (!wilayah) return fail(`Unknown region code: ${wilayah_code}`);
        return json({ wilayah: wilayah.path, postalCodes: postalCodesIn(wilayah.code) });
      }
      return fail('Give kode_pos or wilayah_code.');
    },
  );

  server.registerTool(
    'parse_alamat',
    {
      title: 'Parse an Indonesian address',
      description:
        'Read a free-text Indonesian address ("Jl. Margonda Raya No. 100 RT 3/5 Kemiri Muka, Beji, Depok 16423") into street, RT/RW, kode pos, and the Kemendagri kelurahan/desa, kecamatan, kabupaten/kota, and provinsi with their codes. Handles missing commas, capitals, abbreviations (Kel., Kec., Kab., Jaksel, Jabar), and left-out levels. Check confidence and issues: a kode pos that belongs to another kelurahan, a village that is not in the data, or an address that fits more than one region (see alternatives). Use it to clean address columns, fill region dropdowns from typed addresses, or check a shipping address. Also takes an [ADDRESS_n] placeholder from read_file_masked: the regions come back as they are, the street and RT/RW as placeholders.',
      inputSchema: { address: z.string().max(2000) },
      annotations: readOnly,
    },
    async ({ address }) => {
      const real = fromVault(address);
      if (real === undefined) return json(parseAlamat(address));
      // The regions are public; the street, house number, and RT/RW narrow it down to a household.
      const r = parseAlamat(real);
      const street = r.street && samaran.placeholder('ADDRESS', r.street);
      const rt = r.rt && samaran.placeholder('ADDRESS', `RT ${r.rt}`);
      const rw = r.rw && samaran.placeholder('ADDRESS', `RW ${r.rw}`);
      let formatted = r.formatted;
      if (formatted && r.street && street) formatted = formatted.replace(r.street, street);
      if (formatted && (r.rt || r.rw)) {
        const written = [r.rt && `RT ${r.rt}`, r.rw && `RW ${r.rw}`].filter(Boolean).join('/');
        formatted = formatted.replace(written, [rt, rw].filter(Boolean).join('/'));
      }
      return json({ ...r, input: address, street, rt, rw, formatted, note: MASKED_NOTE });
    },
  );

  server.registerTool(
    'list_holidays',
    {
      title: 'Indonesian public holidays',
      description:
        'Libur nasional and cuti bersama for a year, from the official SKB 3 Menteri. Only years with a published decree are available; other years return an error rather than a guess.',
      inputSchema: { year: z.number().int() },
      annotations: readOnly,
    },
    async ({ year }) => {
      try {
        return json(getHolidays(year));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'working_days',
    {
      title: 'Indonesian working days',
      description:
        'Working-day math with Indonesian holidays: is a date a working day, the date N working days after a date (SLA, delivery estimates), or the number of working days between two dates (inclusive). Cuti bersama counts as a day off unless cuti_bersama is false (private companies may work on them).',
      inputSchema: {
        from: isoDate,
        to: isoDate.optional(),
        add: z.number().int().optional().describe('Working days to add (negative to go back)'),
        cuti_bersama: z.boolean().default(true),
      },
      annotations: readOnly,
    },
    async ({ from, to, add, cuti_bersama }) => {
      const options = { cutiBersama: cuti_bersama };
      try {
        if (add !== undefined) return json({ from, add, result: addWorkingDays(from, add, options) });
        if (to) return json({ from, to, workingDays: countWorkingDays(from, to, options) });
        return json({ date: from, workingDay: isWorkingDay(from, options), holidays: holidaysOn(from) });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  if (!files) return server;
  const piiTypes = z.array(z.enum(PII_TYPES as [PiiType, ...PiiType[]])).optional();

  server.registerTool(
    'scan_pii',
    {
      title: 'Scan files for Indonesian personal data',
      description:
        'Scan a file or directory (text, CSV, JSON, logs, SQL, .xlsx, .docx, text-based PDF; up to 100 MB each) for personal data — identifiers (NIK, KK, NPWP, phone, email, bank account, BPJS, passport, SIM, NIP, card, plate, IP, coordinates), names, addresses, birth dates, and UU PDP categories (religion, marital status, gender, nationality, health, finances, criminal records, biometrics) — without revealing it: findings show only partially masked values. Also lists files and pages it could not scan (scanned or encrypted PDFs, .xls, .doc, images, archives). Use before reading data files and before committing fixtures or seeders.',
      inputSchema: {
        path: z.string().default('.').describe('File or directory, relative to the project root'),
        types: piiTypes,
        min_confidence: z.enum(['high', 'medium']).default('high'),
      },
      annotations: readOnly,
    },
    async ({ path: target, types, min_confidence }) => {
      let abs: string;
      try {
        abs = inRoot(target);
      } catch (e) {
        return fail((e as Error).message);
      }
      if (configError) return fail(configError);
      if (!existsSync(abs)) return fail(`Not found: ${target}`);

      const files = statSync(abs).isDirectory() ? [...walkFiles(abs, FILE_LIMIT)] : [abs];
      const findings: Array<Record<string, unknown>> = [];
      const totals: string[] = [];
      const skipped: Array<{ file: string; reason: string; dataBearing: boolean }> = [];
      let scanned = 0;
      let withPii = 0;
      let ignored = 0;

      for (const file of files) {
        if (isIgnored(file)) {
          ignored++;
          continue;
        }
        const rel = toPosix(path.relative(root, file)) || path.basename(file);
        let doc: Document;
        try {
          doc = loadDocument(file);
        } catch {
          continue;
        }
        if (doc.kind === 'skipped') {
          skipped.push({ file: rel, reason: doc.reason, dataBearing: doc.dataBearing });
          continue;
        }
        scanned++;
        if (doc.kind === 'sheets' && doc.unscanned) skipped.push({ file: rel, reason: `partly scanned: ${doc.unscanned}`, dataBearing: true });
        let fileHasPii = false;
        for (const part of parts(doc)) {
          const matches = detectConfigured(part.text, { types, minConfidence: min_confidence }, config);
          if (matches.length) fileHasPii = true;
          for (const m of matches) {
            totals.push(m.label ?? m.type);
            if (findings.length < 200) {
              findings.push({
                file: rel,
                sheet: part.sheet,
                line: lineOf(part.text, m.start),
                type: m.type,
                label: m.label,
                uuPdp: UU_PDP_CATEGORY[m.type],
                confidence: m.confidence,
                preview: partialMask(m.type, m.value),
              });
            }
          }
        }
        if (fileHasPii) withPii++;
      }

      const notScanned = skipped.filter((s) => s.dataBearing);
      const byReason: Record<string, number> = {};
      for (const s of notScanned) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
      const spesifik = totals.filter((t) => UU_PDP_CATEGORY[t as PiiType] === 'spesifik').length;

      return json({
        filesScanned: scanned,
        filesWithPii: withPii,
        filesIgnored: ignored,
        fileLimitReached: files.length >= FILE_LIMIT || undefined,
        totals: countByType(totals),
        dataPribadiSpesifik: spesifik || undefined,
        findings,
        truncated: totals.length > findings.length || undefined,
        notScanned: notScanned.length
          ? {
              count: notScanned.length,
              byReason,
              files: notScanned
                .filter((s) => !s.reason.startsWith('image'))
                .slice(0, 30)
                .map((s) => `${s.file} (${s.reason})`),
            }
          : undefined,
        warning: notScanned.length
          ? `${notScanned.length} file(s) may hold personal data but were NOT scanned. Do not treat them as clean.`
          : undefined,
        next: withPii
          ? 'Read these files with read_file_masked, not directly. Files that only hold fake data can be listed in .samaranignore.'
          : undefined,
      });
    },
  );

  server.registerTool(
    'read_file_masked',
    {
      title: 'Read a file with personal data masked',
      description:
        'Read a text, CSV, JSON, log, .xlsx, .docx, or text-based PDF file with Indonesian personal data replaced by stable placeholders ([NIK_1], [PHONE_2], [RELIGION_1] …). The same value always gets the same placeholder in this session, so joins, counts, grouping and deduplication still work. Real values never leave the user\'s machine. Spreadsheets come back as CSV, one block per sheet; Word documents as their text plus each table as CSV; PDFs one block per page.',
      inputSchema: {
        path: z.string(),
        start_line: z.number().int().min(1).default(1),
        max_lines: z.number().int().min(1).max(5000).default(2000),
      },
      annotations: readOnly,
    },
    async ({ path: target, start_line, max_lines }) => {
      let abs: string;
      try {
        abs = inRoot(target);
      } catch (e) {
        return fail((e as Error).message);
      }
      if (configError) return fail(configError);
      if (!existsSync(abs)) return fail(`Not found: ${target}`);
      const doc = loadDocument(abs);
      if (doc.kind === 'skipped') return fail(`Cannot read ${target}: ${doc.reason}.`);

      // Paging through a table: keep the header in view of the detector so its columns stay masked.
      const tabular = (doc.kind === 'sheets' && doc.unit !== 'page') || /\.(csv|tsv)$/i.test(abs);
      const blocks: string[] = [];
      const all: PiiMatch[] = [];
      let textRange = '';
      for (const part of parts(doc)) {
        const lines = part.text.split(/\r?\n/);
        let slice = lines.slice(start_line - 1, start_line - 1 + max_lines).join('\n');
        const withHeader = tabular && start_line > 1;
        if (withHeader) slice = `${lines[0]}\n${slice}`;
        let { text: masked, matches } = samaran.mask(slice);
        if (withHeader) masked = masked.slice(masked.indexOf('\n') + 1);
        for (const m of matches) all.push(m);
        const end = Math.min(lines.length, start_line - 1 + max_lines);
        const range = `lines ${start_line}-${end} of ${lines.length}`;
        if (part.sheet === undefined) {
          textRange = range;
          blocks.push(masked);
        } else {
          const unit = doc.kind === 'sheets' && doc.unit === 'part' ? 'Part' : doc.kind === 'sheets' && doc.unit === 'page' ? 'Page' : 'Sheet';
          blocks.push(`=== ${unit}: ${part.sheet} (${range}) ===\n${masked}`);
        }
      }
      const rel = toPosix(path.relative(root, abs));
      const what =
        doc.kind === 'text'
          ? textRange
          : doc.unit === 'part'
            ? `Word document: text and ${doc.sheets.length - 1} table${doc.sheets.length === 2 ? '' : 's'}, tables as CSV`
            : doc.unit === 'page'
              ? `PDF: ${doc.sheets.length} page${doc.sheets.length === 1 ? '' : 's'} with text`
              : `${doc.sheets.length} sheet${doc.sheets.length === 1 ? '' : 's'}, as CSV`;
      const header = [
        `File: ${rel} (${what})`,
        ...(doc.kind === 'sheets' && doc.unscanned ? [`Not read: ${doc.unscanned}. They may hold personal data, such as an ID card photo.`] : []),
        `Masked: ${all.length ? JSON.stringify(countByType(all.map((m) => m.label ?? m.type))) : 'nothing found'}`,
        '---',
      ];
      return { content: [{ type: 'text' as const, text: `${header.join('\n')}\n${blocks.join('\n\n')}` }] };
    },
  );

  server.registerTool(
    'write_file_unmasked',
    {
      title: 'Write a file, restoring masked values',
      description:
        'Write content to a file after replacing Samaran placeholders ([NIK_1], [PHONE_2] …) from this session with the real values, locally. Use this to produce output (cleaned CSV, reports, migrations) from data you read with read_file_masked.',
      inputSchema: {
        path: z.string(),
        content: z.string(),
        overwrite: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ path: target, content, overwrite }) => {
      let abs: string;
      try {
        abs = inRoot(target);
      } catch (e) {
        return fail((e as Error).message);
      }
      if (existsSync(abs) && !overwrite) return fail(`${target} already exists. Pass overwrite: true to replace it.`);

      const placeholders = content.match(/\[[A-Z_]+_\d+\]/g) ?? [];
      const unknown = [...new Set(placeholders.filter((p) => samaran.unmask(p) === p))];
      const restoredText = samaran.unmask(content);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, restoredText, 'utf8');
      return json({
        wrote: toPosix(path.relative(root, abs)),
        bytes: Buffer.byteLength(restoredText),
        restored: placeholders.filter((p) => !unknown.includes(p)).length,
        unknownPlaceholders: unknown.length ? unknown : undefined,
      });
    },
  );

  server.registerTool(
    'anonymize_file',
    {
      title: 'Make a copy of data with realistic stand-ins (Kembaran)',
      description:
        'Copy SQL dumps, CSV, JSON, or log files with every piece of Indonesian personal data replaced by a realistic stand-in, for staging, seeders, tests, or sharing with a vendor: valid NIKs in the same district with the same gender and birth year, phone numbers on the same operator, names with the same casing, addresses in the same area, e-mail at example.com. The same value gets the same stand-in in every file of one call, so joins still work. Runs on the user\'s machine and returns only counts: you never see the data. Use it instead of reading production data, and when asked to copy production data to staging or build seeders from it.',
      inputSchema: {
        paths: z.array(z.string()).min(1).describe('Input files, relative to the project root'),
        output: z.string().describe('Output file, or a folder when there are several inputs'),
        keep: piiTypes.describe('Types to leave as they are, e.g. ["FINANCIAL"] for a credit simulation'),
        keep_birth_date: z.boolean().default(false).describe('Keep whole birth dates instead of only the year'),
        secret: z.string().optional().describe('The same secret gives the same stand-ins on every run'),
        overwrite: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ paths, output, keep, keep_birth_date, secret, overwrite }) => {
      let inputs: string[];
      let out: string;
      if (configError) return fail(configError);
      try {
        inputs = paths.map(inRoot);
        out = inRoot(output);
        const files = anonymizeFiles(inputs, out, { keep, keepBirthDate: keep_birth_date, secret, overwrite, custom: config.custom });
        return json({
          files: files.map((f) => ({ from: toPosix(path.relative(root, f.from)), to: toPosix(path.relative(root, f.to)), replaced: f.replaced })),
          note: KEMBARAN_NOTE,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  return server;
}

export async function runServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

/**
 * MCP over Streamable HTTP, for clients that only connect to remote servers: ChatGPT connectors, Claude.ai custom
 * connectors. Stateless, data tools only. Put it behind HTTPS to use it from those clients.
 */
export function startHttpServer(port = 3000, host = '127.0.0.1'): Promise<HttpServer> {
  const http = createHttpServer(async (req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Lokal MCP server ${VERSION}. Connect an MCP client to /mcp.\n`);
      return;
    }
    if (pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found. The MCP endpoint is /mcp.\n');
      return;
    }
    if (req.method !== 'POST') {
      // Stateless: no server-initiated stream (GET) and no sessions to end (DELETE).
      res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
      return;
    }
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1024 * 1024) throw new Error('Request too large.');
      }
      const server = createServer(process.cwd(), { files: false });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, JSON.parse(raw));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: (e as Error).message }, id: null }));
      }
    }
  });
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => resolve(http));
  });
}
