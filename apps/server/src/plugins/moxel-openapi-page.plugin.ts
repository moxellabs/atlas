import { Elysia } from "elysia";

import { VERSION } from "../constants";
import {
	moxelBandedFieldScript,
	moxelOpenApiCss,
	moxelOpenApiPolishScript,
	moxelScalarCustomCss,
	SCALAR_CDN_URL,
} from "../openapi/moxel-theme";

const scalarConfiguration = {
	url: "/openapi.json",
	layout: "modern",
	forceDarkModeState: "dark",
	theme: "none",
	withDefaultFonts: false,
	documentDownloadType: "none",
	defaultHttpClient: {
		targetKey: "shell",
		clientKey: "curl",
	},
	hideClientButton: true,
	hideDarkModeToggle: true,
	hideTestRequestButton: false,
	showDeveloperTools: "never",
	agent: {
		disabled: true,
	},
	mcp: {
		name: "MOXEL ATLAS Local API",
		url: "/mcp",
		disabled: true,
	},
	telemetry: false,
	customCss: moxelScalarCustomCss,
	_integration: "elysiajs",
};

/** Serves the Scalar-backed OpenAPI reference at docs and compatibility routes. */
export const moxelOpenApiPagePlugin = new Elysia({ name: "moxel-openapi-page" })
	.get(
		"/docs",
		() =>
			new Response(renderMoxelOpenApiPage(), {
				headers: {
					"content-type": "text/html; charset=utf-8",
				},
			}),
		{
			detail: {
				hide: true,
			},
		},
	)
	.get(
		"/openapi",
		() =>
			new Response(renderMoxelOpenApiPage(), {
				headers: {
					"content-type": "text/html; charset=utf-8",
				},
			}),
		{
			detail: {
				hide: true,
			},
		},
	)
	.get(
		"/favicon.ico",
		() =>
			new Response(null, {
				status: 204,
				headers: {
					"cache-control": "public, max-age=86400",
				},
			}),
		{
			detail: {
				hide: true,
			},
		},
	);

/** Renders the custom documentation shell that hosts the Scalar API reference web component. */
function renderMoxelOpenApiPage(): string {
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MOXEL ATLAS API Reference</title>
    <meta name="description" content="MOXEL ATLAS API Reference for local Atlas docs, retrieval, repository inspection, operations, and MCP bridge access." />
    <style>${moxelOpenApiCss}</style>
  </head>
  <body class="moxel-openapi-body">
    <canvas id="banded-field" aria-hidden="true"></canvas>
    <div class="noise" aria-hidden="true"></div>
    <div class="moxel-openapi-shell">
      <header class="moxel-topbar">
        <div class="moxel-wordmark">MOXEL ATLAS API Reference</div>
        <div class="moxel-meta">BANDED INTELLIGENCE · LOCAL API · ${escapeHtml(VERSION)}</div>
        <div class="moxel-status" aria-hidden="true"></div>
      </header>
      <main class="moxel-reference">
        <script id="api-reference" data-configuration='${escapeAttribute(JSON.stringify(scalarConfiguration))}'></script>
      </main>
    </div>
    <script>${moxelBandedFieldScript}</script>
    <script>${moxelOpenApiPolishScript}</script>
    <script src="${SCALAR_CDN_URL}" crossorigin></script>
  </body>
</html>`;
}

/** Escapes body text inserted into the server-rendered OpenAPI shell. */
function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/** Escapes a string for safe placement inside an HTML attribute value. */
function escapeAttribute(value: string): string {
	return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
