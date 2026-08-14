import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "today" / "tomorrow" / weekday / short date — how a person refers to a day. */
export function formatDay(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);

  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return date.toLocaleDateString('en-IN', { weekday: 'short' });
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative time for activity feeds. */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** Indian numbering for currency — ₹1,20,000 rather than ₹120,000. */
export function formatRupees(value: number): string {
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Turn an enum-ish token into readable text: HARVEST_READY -> Harvest ready. */
export function humanise(token: string | null | undefined): string {
  if (!token) return '';
  const lower = token.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Title-case a crop key for display: "rice" -> "Rice". */
export function cropLabel(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Pick a weather icon name from the provider's text description. */
export function weatherIcon(
  description: string,
): 'sun' | 'cloud' | 'rain' | 'storm' | 'snow' | 'fog' {
  const d = description.toLowerCase();
  if (d.includes('thunder')) return 'storm';
  if (d.includes('snow')) return 'snow';
  if (d.includes('fog')) return 'fog';
  if (d.includes('rain') || d.includes('drizzle') || d.includes('shower')) return 'rain';
  if (d.includes('cloud') || d.includes('overcast')) return 'cloud';
  return 'sun';
}
