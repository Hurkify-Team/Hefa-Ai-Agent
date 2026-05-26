import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HEFAMAA Smart Registry Agent",
    short_name: "HEFAMAA Agent",
    description: "Facility data capture dashboard for HEFAMAA registry workflows.",
    start_url: "/data-capture",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#06241f",
    icons: [],
  };
}
