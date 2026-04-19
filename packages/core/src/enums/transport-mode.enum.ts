/** Server transports supported by ATLAS. */
export const TRANSPORT_MODES = ["stdio", "http"] as const;

/** Server transport mode. */
export type TransportMode = (typeof TRANSPORT_MODES)[number];
