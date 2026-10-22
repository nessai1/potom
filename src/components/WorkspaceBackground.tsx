import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useRef, useState } from "react";
import "../styles/workspace-background.css";

interface WorkspaceBackgroundProps {
  theme: "light" | "dark";
}

const colors = {
  light: ["#ed85b4", "#f3ad7b", "#bbc0c8", "#f8c6d7"],
  dark: ["#733a57", "#86523d", "#373c46", "#4e414b"],
};

interface ShaderCapabilities {
  available: boolean;
  maxPixelCount: number;
}

let shaderCapabilities: ShaderCapabilities | undefined;

function getShaderCapabilities(): ShaderCapabilities {
  if (shaderCapabilities) return shaderCapabilities;
  const fallback = { available: false, maxPixelCount: 96_000 };
  if (typeof WebGL2RenderingContext === "undefined") return fallback;

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!context) return (shaderCapabilities = fallback);
    const info = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      context.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER),
    );
    // Software WebGL shares the CPU with task editing and dragging. Render the
    // same Paper shader at a smaller resolution so it cannot monopolize input.
    const software =
      /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
    shaderCapabilities = {
      available: true,
      maxPixelCount: software ? 96_000 : 1_000_000,
    };
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    shaderCapabilities = fallback;
  }
  return shaderCapabilities;
}

export default function WorkspaceBackground({
  theme,
}: WorkspaceBackgroundProps) {
  const root = useRef<HTMLDivElement>(null);
  const [capabilities, setCapabilities] = useState<ShaderCapabilities>({
    available: false,
    maxPixelCount: 96_000,
  });
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [visible, setVisible] = useState(() => !document.hidden);
  const [inViewport, setInViewport] = useState(true);

  useEffect(() => {
    setCapabilities(getShaderCapabilities());
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media?.matches ?? false);
    const updateVisibility = () => setVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    media?.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);

    const node = root.current;
    const useFallback = () =>
      setCapabilities((current) => ({ ...current, available: false }));
    node?.addEventListener("webglcontextlost", useFallback, true);
    node?.addEventListener("webglcontextcreationerror", useFallback, true);

    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(([entry]) => {
            setInViewport(entry?.isIntersecting ?? false);
          });
    if (node) observer?.observe(node);

    return () => {
      media?.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      node?.removeEventListener("webglcontextlost", useFallback, true);
      node?.removeEventListener("webglcontextcreationerror", useFallback, true);
      observer?.disconnect();
    };
  }, []);

  const playing = visible && inViewport && !reducedMotion;

  return (
    <div
      ref={root}
      className="workspace-background"
      aria-hidden="true"
      data-renderer={capabilities.available ? "mesh-gradient" : "fallback"}
      data-motion={capabilities.available && playing ? "playing" : "paused"}
    >
      {capabilities.available && (
        <MeshGradient
          className="workspace-shader"
          colors={colors[theme]}
          distortion={0.85}
          swirl={0.32}
          grainMixer={0.12}
          grainOverlay={0.09}
          speed={playing ? 0.78 : 0}
          width="100%"
          height="100%"
          minPixelRatio={1}
          maxPixelCount={capabilities.maxPixelCount}
        />
      )}
    </div>
  );
}
