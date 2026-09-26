export type Currency = 'USD' | 'EUR' | 'JPY';

const CURRENCIES = {
  USD: { prefix: '$', suffix: '', digits: 2 },
  EUR: { prefix: '', suffix: ' EUR', digits: 2 },
  JPY: { prefix: '', suffix: ' JPY', digits: 0 },
};

export function roundHalfAway(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = Number((Math.abs(value) * factor).toPrecision(12));
  return (Math.sign(value) * Math.round(scaled)) / factor;
}

export function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatMoney(amount: number, currency: Currency = 'USD'): string {
  const c = CURRENCIES[currency];
  const rounded = roundHalfAway(amount, c.digits);
  const sign = rounded < 0 ? '-' : '';
  const [whole = '0', fraction] = Math.abs(rounded).toFixed(c.digits).split('.');
  const grouped = groupThousands(whole);
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return `${sign}${c.prefix}${body}${c.suffix}`;
}
