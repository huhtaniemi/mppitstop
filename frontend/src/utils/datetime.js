const DATE_LOCALE = 'fi-FI';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(DATE_LOCALE, {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

export function parseAppDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = String(value).trim();
  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/
  );
  if (m) {
    const [, y, mo, d, h, mi, s, ms] = m;
    // Parse DB naive timestamp as local wall-clock time.
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s || 0),
      Number((ms || '0').padEnd(3, '0'))
    );
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatInfoDate(value) {
  if (!value) return 'Unknown';
  const d = parseAppDate(value);
  if (!d) return String(value);
  return DATE_TIME_FORMATTER.format(d);
}
