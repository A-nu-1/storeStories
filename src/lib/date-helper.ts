const parseUTC = (timestamp: string): Date => {
  // Ensure timestamp is treated as UTC even if the Z suffix is missing
  if (!timestamp.endsWith("Z") && !timestamp.includes("+")) {
    return new Date(timestamp + "Z");
  }
  return new Date(timestamp);
};

export const formatTimeAgo = (createdAt: string): string => {
  const now = new Date();
  const created = parseUTC(createdAt);
  const diff = now.getTime() - created.getTime();

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const formatTimeRemaining = (expiresAt: string): string => {
  const now = new Date();
  const expires = parseUTC(expiresAt);
  const diff = expires.getTime() - now.getTime();

  if (diff <= 0) return "Expired";

  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m left`;
  }
  return `${minutes}m left`;
};