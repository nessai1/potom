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

let supportsWebGL: boolean | undefined;

function canRenderShader() {
  if (supportsWebGL !== undefined) return supportsWebGL;
  if (typeof WebGL2RenderingContext === "undefined") return false;

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      stencil: false,
    });
    supportsWebGL = context !== null;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    supportsWebGL = false;
  }
  return supportsWebGL;
}

export default function WorkspaceBackground({
  theme,
}: WorkspaceBackgroundProps) {
  const root = useRef<HTMLDivElement>(null);
  const [shaderAvailable, setShaderAvailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [visible, setVisible] = useState(() => !document.hidden);
  const [inViewport, setInViewport] = useState(true);

  useEffect(() => {
    setShaderAvailable(canRenderShader());
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media?.matches ?? false);
    const updateVisibility = () => setVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    media?.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);

    const node = root.current;
    const useFallback = () => setShaderAvailable(false);
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
      data-renderer={shaderAvailable ? "mesh-gradient" : "fallback"}
      data-motion={shaderAvailable && playing ? "playing" : "paused"}
    >
      {shaderAvailable && (
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
          maxPixelCount={1_000_000}
        />
      )}
    </div>
  );
}
