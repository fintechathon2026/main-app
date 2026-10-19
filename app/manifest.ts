import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Reins",
    short_name: "Reins",
    description: "An AI finance agent that acts only inside the rules you sign.",
    start_url: "/",
    display: "standalone",
    background_color: "#16161B",
    theme_color: "#16161B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
