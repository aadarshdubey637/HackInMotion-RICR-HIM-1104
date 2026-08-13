const STYLES = {
  none: "bg-green-100 text-green-800",
  low: "bg-green-100 text-green-800",
  moderate: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
  unknown: "bg-gray-100 text-gray-600",
};

const LABELS = {
  none: "All clear",
  low: "Low risk",
  moderate: "Moderate risk",
  high: "High risk",
  unknown: "Unknown",
};

export default function RiskBadge({ level }) {
  const style = STYLES[level] || STYLES.unknown;
  const label = LABELS[level] || "Unknown";
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
