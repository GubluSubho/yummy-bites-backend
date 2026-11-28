const mongoose = require('mongoose');
const PrintFile = require('../models/PrintFile');
const PrintConfig = require('../models/PrintConfig');

const DEFAULTS = {
  bwPerPage: 5,
  colorPerPage: 10,
  laminationPerPage: 15,
  binding: [
    { key: 'spiral', label: 'Spiral binding', base: 20, perPage: 0.5 },
    { key: 'comb', label: 'Comb binding', base: 25, perPage: 0.5 },
    { key: 'soft', label: 'Soft cover binding', base: 40, perPage: 0.4 },
  ],
};

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

function shape(doc) {
  return {
    bwPerPage: doc.bwPerPage,
    colorPerPage: doc.colorPerPage,
    laminationPerPage: doc.laminationPerPage,
    binding: (doc.binding || []).map((b) => ({ key: b.key, label: b.label, base: b.base, perPage: b.perPage })),
  };
}

async function getConfig(restaurantId) {
  let doc = await PrintConfig.findOne({ restaurantId }).lean();
  if (!doc) {
    try {
      doc = (await PrintConfig.create({ restaurantId, ...DEFAULTS })).toObject();
    } catch (e) {
      doc = await PrintConfig.findOne({ restaurantId }).lean();
    }
  }
  return shape(doc || DEFAULTS);
}

function cleanConfig(input, current) {
  const out = {};
  for (const k of ['bwPerPage', 'colorPerPage', 'laminationPerPage']) {
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < 1 || n > 500) return { error: 'Prices must be whole rupees from 1 to 500' };
    out[k] = n;
  }
  const given = Array.isArray(input.binding) ? input.binding : [];
  out.binding = [];
  for (const cur of current.binding) {
    const g = given.find((b) => b && b.key === cur.key) || cur;
    const base = Number(g.base);
    const perPage = Number(g.perPage);
    if (!Number.isFinite(base) || base < 0 || base > 2000) return { error: 'Check the starting price for ' + cur.label };
    if (!Number.isFinite(perPage) || perPage < 0 || perPage > 50) return { error: 'Check the per-page price for ' + cur.label };
    out.binding.push({ key: cur.key, label: cur.label, base: Math.round(base * 100) / 100, perPage: Math.round(perPage * 100) / 100 });
  }
  return { config: out };
}

function expandRange(text, total) {
  const set = new Set();
  const parts = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { error: 'Enter the pages, like 1-5, 8' };
  for (const p of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(p);
    if (!m) return { error: 'Use pages like 1-5, 8, 10-12' };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > total) return { error: 'Pages must be between 1 and ' + total };
    for (let i = a; i <= b; i++) set.add(i);
  }
  return { pages: [...set].sort((x, y) => x - y) };
}

function compress(pages) {
  const out = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? pages[i] + '-' + pages[j] : String(pages[i]));
    i = j + 1;
  }
  return out.join(', ');
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '...' : s);

// Price one print, binding or lamination line. Everything is recomputed on the server.
async function quoteLine({ userId, config, service, job }) {
  const j = job || {};

  if (service === 'print') {
    if (!mongoose.isValidObjectId(j.fileId)) return { error: 'Upload a file first' };
    const file = await PrintFile.findOne({ _id: j.fileId, userId }).select('name pages pagesExact');
    if (!file) return { error: 'That file is no longer available. Please upload it again.' };

    const total = file.pagesExact && file.pages ? file.pages : toInt(j.pages);
    if (!total || total < 1 || total > 500) return { error: 'Enter the number of pages (1 to 500)' };
    const copies = toInt(j.copies);
    if (!copies || copies < 1 || copies > 50) return { error: 'Copies must be from 1 to 50' };

    const orientation = j.orientation === 'landscape' ? 'landscape' : 'portrait';
    const mode = j.color === 'color' || j.color === 'mixed' ? j.color : 'bw';

    let selected = [];
    let range = '';
    const rangeText = String(j.range || '').trim().slice(0, 120);
    if (rangeText) {
      const r = expandRange(rangeText, total);
      if (r.error) return { error: r.error };
      selected = r.pages;
      range = compress(selected);
    } else {
      for (let i = 1; i <= total; i++) selected.push(i);
    }

    let colorPages = [];
    if (mode === 'color') {
      colorPages = selected;
    } else if (mode === 'mixed') {
      const r = expandRange(String(j.colorPages || '').slice(0, 200), total);
      if (r.error) return { error: 'Pick the colour pages. ' + r.error };
      const inSelection = new Set(selected);
      colorPages = r.pages.filter((p) => inSelection.has(p));
      if (colorPages.length === 0) return { error: 'Pick at least one colour page, or choose Black & White' };
    }

    const colorCount = colorPages.length;
    const bwCount = selected.length - colorCount;
    let price = Math.ceil((bwCount * config.bwPerPage + colorCount * config.colorPerPage) * copies);

    // Optional finishing on the same job: binding (one per copy) and lamination (per page, per copy)
    const finish = j.finish || {};
    const extras = [];
    let bindKey = '';
    let lamPages = 0;
    if (finish.binding) {
      const type = (config.binding || []).find((b) => b.key === finish.binding);
      if (!type) return { error: 'Choose a binding type' };
      price += Math.ceil(type.base + type.perPage * selected.length) * copies;
      extras.push(type.label);
      bindKey = type.key;
    }
    if (finish.lamination) {
      lamPages = toInt(finish.laminationPages) || selected.length;
      if (lamPages < 1 || lamPages > selected.length) return { error: 'Lamination pages must be from 1 to ' + selected.length };
      price += lamPages * config.laminationPerPage * copies;
      extras.push('Lamination (' + plural(lamPages, 'page', 'pages') + ')');
    }

    const colourLabel = colorCount === 0 ? 'B&W' : bwCount === 0 ? 'Colour' : 'Colour pages ' + compress(colorPages) + ', rest B&W';
    const detail = [
      plural(selected.length, 'page', 'pages'),
      colourLabel,
      plural(copies, 'copy', 'copies'),
      orientation === 'landscape' ? 'Landscape' : 'Portrait',
      range ? 'pages ' + range : '',
      ...extras.map((e) => '+ ' + e),
    ].filter(Boolean).join(' | ');

    return {
      price,
      title: 'Print: ' + short(file.name, 28),
      detail,
      job: {
        fileId: String(file._id), fileName: file.name, totalPages: total, range, pages: selected.length, copies,
        color: colorCount === 0 ? 'bw' : bwCount === 0 ? 'color' : 'mixed',
        colorPages: compress(colorPages), colorCount, bwCount, orientation,
        finish: { binding: bindKey, lamination: !!lamPages, laminationPages: lamPages },
      },
    };
  }

  if (service === 'binding') {
    const type = (config.binding || []).find((b) => b.key === j.type);
    if (!type) return { error: 'Choose a binding type' };
    const pages = toInt(j.pages);
    if (!pages || pages < 1 || pages > 500) return { error: 'Enter the number of pages (1 to 500)' };
    return { price: Math.ceil(type.base + type.perPage * pages), title: 'Binding: ' + type.label, detail: plural(pages, 'page', 'pages'), job: { type: type.key, pages } };
  }

  if (service === 'lamination') {
    const pages = toInt(j.pages);
    if (!pages || pages < 1 || pages > 200) return { error: 'Enter the number of pages (1 to 200)' };
    return { price: pages * config.laminationPerPage, title: 'Lamination', detail: plural(pages, 'page', 'pages'), job: { pages } };
  }

  return { error: 'Unknown service' };
}

module.exports = { DEFAULTS, getConfig, cleanConfig, expandRange, compress, quoteLine };
