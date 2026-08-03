import moxelOpenApiCss from "./openapi.css" with { type: "text" };
import moxelOpenApiPolishScript from "./openapi-polish.js" with { type: "text" };
import moxelScalarCustomCss from "./openapi-scalar-overrides.css" with { type: "text" };

/** Stable marker used by tests to prove the Moxel-branded OpenAPI shell is served. */
export const MOXEL_SCALAR_THEME_MARKER = "moxel-atlas-openapi-theme";

/** CDN used by the custom Moxel OpenAPI shell to mount Scalar inside our page chrome. */
export const SCALAR_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.52.5/dist/browser/standalone.min.js";

export { moxelOpenApiCss, moxelOpenApiPolishScript, moxelScalarCustomCss };
