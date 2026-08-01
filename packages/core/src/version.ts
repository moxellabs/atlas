import packageJson from "../../../package.json" with { type: "json" };

/** Release version shared by every Atlas runtime surface. */
export const ATLAS_VERSION = packageJson.version;
