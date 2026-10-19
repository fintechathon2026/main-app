import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Reins",
    short_name: "Reins",
    description: "An AI finance agent that acts only inside your signed mandate.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f6f3",
    theme_color: "#12130f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
