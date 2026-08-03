import { describe, expect, test } from "bun:test";
import { moxelBandedFieldScript } from "@atlas/presentation-assets/banded-field";
import {
  MOXEL_SCALAR_THEME_MARKER,
  moxelOpenApiCss,
  moxelOpenApiPolishScript,
  moxelScalarCustomCss,
  SCALAR_CDN_URL,
} from "@atlas/presentation-assets/openapi";
import {
  moxelEvalExplorerScript,
  moxelEvalReportCss,
} from "@atlas/presentation-assets/eval-report";

interface AnimationEnvironment {
  readonly canvas: FakeCanvas | null;
  readonly reducedMotion: boolean;
  readonly drawCount: () => number;
  readonly animationRequests: () => number;
  requestAnimationFrame(): number;
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly style = { width: "", height: "" };

  constructor(private readonly context: Record<string, unknown> | null) {}

  getContext(): Record<string, unknown> | null {
    return this.context;
  }
}

describe("presentation assets", () => {
  test("exports nonempty OpenAPI and eval assets with their runtime markers", () => {
    expect(MOXEL_SCALAR_THEME_MARKER.length).toBeGreaterThan(0);
    expect(SCALAR_CDN_URL).toContain("scalar");
    expect(moxelOpenApiCss).toContain("canvas#banded-field");
    expect(moxelScalarCustomCss).toContain(".scalar-app");
    expect(moxelOpenApiPolishScript).toContain(".moxel-reference");
    expect(moxelEvalReportCss).toContain("canvas#banded-field");
    expect(moxelEvalExplorerScript).toContain("atlas-eval-report-data");
    expect(moxelBandedFieldScript.length).toBeGreaterThan(0);
  });

  test("banded-field exits without drawing when the canvas is absent", () => {
    const environment = createAnimationEnvironment({
      canvas: null,
      reducedMotion: false,
    });

    runBandedField(environment);

    expect(environment.drawCount()).toBe(0);
    expect(environment.animationRequests()).toBe(0);
  });

  test("banded-field draws one static frame when reduced motion is requested", () => {
    const environment = createAnimationEnvironment({ reducedMotion: true });

    runBandedField(environment);

    expect(environment.drawCount()).toBeGreaterThan(0);
    expect(environment.animationRequests()).toBe(0);
  });

  test("banded-field schedules animation in normal motion mode without throwing", () => {
    const environment = createAnimationEnvironment({ reducedMotion: false });

    expect(() => runBandedField(environment)).not.toThrow();
    expect(environment.animationRequests()).toBe(1);
  });
});

function runBandedField(environment: AnimationEnvironment): void {
  const window = {
    devicePixelRatio: 1,
    innerWidth: 320,
    innerHeight: 180,
    addEventListener() {},
    matchMedia() {
      return {
        matches: environment.reducedMotion,
        addEventListener() {},
      };
    },
  };
  const document = {
    getElementById() {
      return environment.canvas;
    },
  };
  const execute = new Function(
    "document",
    "window",
    "HTMLCanvasElement",
    "performance",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    moxelBandedFieldScript,
  );
  execute(
    document,
    window,
    FakeCanvas,
    { now: () => 1_000 },
    () => environment.requestAnimationFrame(),
    () => {},
  );
}

function createAnimationEnvironment(options: {
  readonly canvas?: FakeCanvas | null;
  readonly reducedMotion: boolean;
}): AnimationEnvironment {
  let draws = 0;
  let requests = 0;
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    setTransform() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillRect() {
      draws += 1;
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
  };
  const canvas =
    options.canvas === undefined ? new FakeCanvas(context) : options.canvas;

  return {
    canvas,
    reducedMotion: options.reducedMotion,
    drawCount: () => draws,
    animationRequests: () => requests,
    requestAnimationFrame() {
      requests += 1;
      return requests;
    },
  };
}
