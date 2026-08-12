export default function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 mb-4">
      {message}
    </div>
  );
}

// Turns a caught axios error into a farmer-readable message.
// Never let a raw stack trace or "Network Error" reach the screen.
export function extractErrorMessage(error) {
  if (error?.response?.data?.detail) {
    return typeof error.response.data.detail === "string"
      ? error.response.data.detail
      : "Something went wrong. Please try again.";
  }
  if (error?.request) {
    return "Can't reach the server right now. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}
