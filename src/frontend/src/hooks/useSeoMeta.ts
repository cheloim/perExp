import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import publicRoutes from "../data/publicRoutes.json";

interface RouteMeta {
  path: string;
  title: string;
  description: string;
}

const SITE_NAME = "Oikonomia";

function matchRoute(pathname: string): RouteMeta | undefined {
  const exact = publicRoutes.find((r: { path: string }) => r.path === pathname);
  if (exact) return exact;
  const base = pathname.replace(/\/+$/, "") || "/";
  return publicRoutes.find((r: { path: string }) => r.path === base);
}

export default function useSeoMeta(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    const route = matchRoute(pathname);
    if (!route) return;

    document.title = route.title || SITE_NAME;

    const metaTags: Record<string, string> = {
      description: route.description,
      "og:title": route.title,
      "og:description": route.description,
      "og:url": `https://oikonomia.ar${pathname}`,
      "og:type": "website",
      "og:site_name": SITE_NAME,
      "twitter:card": "summary_large_image",
      "twitter:title": route.title,
      "twitter:description": route.description,
    };

    for (const [name, content] of Object.entries(metaTags)) {
      let el =
        document.querySelector<HTMLMetaElement>(`meta[property="${name}"]`) ||
        document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        if (name.startsWith("og:") || name === "og:type" || name === "og:site_name") {
          el.setAttribute("property", name);
        } else {
          el.setAttribute("name", name);
        }
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    }

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", `https://oikonomia.ar${pathname}`);
  }, [pathname]);
}
